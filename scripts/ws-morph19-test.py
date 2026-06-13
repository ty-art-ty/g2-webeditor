#!/usr/bin/env python3
"""Test für Phase 4b Teil 19: Morph-Mode-Toggle (Knob/Morph) + Morph-Labels.

- patchState trägt je Morph label/dial/mode (label jetzt aus der patch-eigenen
  0x5b-Sektion, nicht mehr aus der statischen Default-Liste).
- renameMorph(0, ...) schreibt die Morph-Label-Sektion ans Gerät und broadcastet
  morphLabelsChanged; fetch_patch zeigt das neue Label. Danach Original zurück.
- Morph-Mode = setParam(area=settings, module=1, param=8+morph): Toggle Knob/Morph
  via paramChanged, danach zurück.

Usage: ws-morph19-test.py [host] — Default localhost. Benötigt python3-websockets.
"""
import asyncio
import json
import sys
import urllib.request

HOST = sys.argv[1] if len(sys.argv) > 1 else "localhost"
URL = f"ws://{HOST}:8080/ws"


def fetch_patch():
    with urllib.request.urlopen(f"http://{HOST}:8080/api/patch", timeout=10) as r:
        return json.load(r)


async def expect(ws, msg_type, pred=lambda m: True):
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), 10))
        if msg.get("type") == msg_type and pred(msg):
            return msg


async def main():
    import websockets
    async with websockets.connect(URL) as ws:
        state = json.loads(await asyncio.wait_for(ws.recv(), 10))
        while state.get("type") != "patchState":  # visuals können vorausgehen
            state = json.loads(await asyncio.wait_for(ws.recv(), 10))
        var = state.get("variation", 0)

        assert len(state["morphs"]) == 8, len(state["morphs"])
        g0 = state["morphs"][0]
        old_label = g0["label"]
        old_mode = g0["mode"]
        print(f"morph0: label={old_label!r} dial={g0['dial']} mode={old_mode}")
        print("labels=" + ",".join(g["label"] for g in state["morphs"]))

        def send(obj):
            return ws.send(json.dumps(obj))

        # 1. Morph-Label setzen (max 7 Zeichen) + per fetch_patch prüfen
        new_label = "T19" if old_label != "T19" else "T19b"
        await send({"type": "renameMorph", "morph": 0, "label": new_label})
        ev = await expect(ws, "morphLabelsChanged",
                          lambda m: m["morph"] == 0)
        assert ev["label"] == new_label, ev
        st = fetch_patch()
        assert st["morphs"][0]["label"] == new_label, st["morphs"][0]
        print(f"renameMorph ok ({old_label!r} -> {new_label!r})")

        # 2. Kappung auf 7 Zeichen
        await send({"type": "renameMorph", "morph": 0, "label": "abcdefghij"})
        ev = await expect(ws, "morphLabelsChanged", lambda m: m["morph"] == 0)
        assert ev["label"] == "abcdefg", ev
        print("7-Zeichen-Kappung ok")

        # 3. Original-Label zurück
        await send({"type": "renameMorph", "morph": 0, "label": old_label})
        await expect(ws, "morphLabelsChanged",
                     lambda m: m["morph"] == 0 and m["label"] == old_label)
        assert fetch_patch()["morphs"][0]["label"] == old_label
        print("Label zurückgesetzt")

        # 4. Morph-Mode-Toggle (Knob<->Morph) via setParam settings/1/8 + zurück
        new_mode = 1 - old_mode
        await send({"type": "setParam", "area": "settings", "module": 1,
                    "param": 8, "value": new_mode, "variation": var})
        await expect(ws, "paramChanged",
                     lambda m: m["area"] == "settings" and m["module"] == 1
                     and m["param"] == 8 and m["value"] == new_mode)
        assert fetch_patch()["morphs"][0]["mode"] == new_mode
        print(f"Morph-Mode ok ({old_mode} -> {new_mode})")
        await send({"type": "setParam", "area": "settings", "module": 1,
                    "param": 8, "value": old_mode, "variation": var})
        await expect(ws, "paramChanged",
                     lambda m: m["area"] == "settings" and m["param"] == 8
                     and m["value"] == old_mode)
        assert fetch_patch()["morphs"][0]["mode"] == old_mode
        print("Mode zurückgesetzt, Ausgangszustand wiederhergestellt")
        print("OK")


asyncio.run(main())
