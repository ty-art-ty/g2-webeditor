#!/usr/bin/env python3
"""Test für Phase 4b Teil 12: Patch-Settings + Morph-Zuweisungen.
patchState trägt settings+morphs; setParam(area=settings) wirkt; setMorph
weist zu / ändert Range (auch negativ) / verschiebt / löscht, mit Undo/Redo.
Benötigt python3-websockets.

Usage: ws-morph-test.py [host] — Default localhost
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


def assigns_of(state, morph):
    return state["morphs"][morph]["assigns"]


def find_assign(state, mid, param):
    for g in state["morphs"]:
        for a in g["assigns"]:
            if a["area"] == "va" and a["module"] == mid and a["param"] == param:
                return g["morph"], a["range"]
    return None


async def expect(ws, msg_type, pred=lambda m: True):
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), 10))
        if msg.get("type") == msg_type and pred(msg):
            return msg


async def main():
    import websockets
    async with websockets.connect(URL) as ws:
        state = json.loads(await asyncio.wait_for(ws.recv(), 10))
        assert state["type"] == "patchState", state
        var = state.get("variation", 0)

        # 1. Struktur: 6 Settings-Module, 8 Morph-Gruppen
        names = [s["name"] for s in state["settings"]]
        assert names == ["Gain", "Glide", "Bend", "Vibrato", "Arpeggiator", "Misc"], names
        assert len(state["morphs"]) == 8, len(state["morphs"])
        labels = [g["label"] for g in state["morphs"]]
        print(f"settings={names}")
        print(f"morphs={labels}")

        def send(obj):
            return ws.send(json.dumps(obj))

        # 2. Settings-Param: Glide (Modul 3) Param 1 (GlideSpeed) setzen + zurück
        glide = next(s for s in state["settings"] if s["name"] == "Glide")
        old = glide["params"][1]["value"]
        new = 42 if old != 42 else 43
        await send({"type": "setParam", "area": "settings", "module": glide["id"],
                    "param": 1, "value": new, "variation": var})
        ev = await expect(ws, "paramChanged", lambda m: m["area"] == "settings")
        assert ev["module"] == glide["id"] and ev["value"] == new, ev
        st = fetch_patch()
        gl = next(s for s in st["settings"] if s["id"] == glide["id"])
        assert gl["params"][1]["value"] == new
        await send({"type": "setParam", "area": "settings", "module": glide["id"],
                    "param": 1, "value": old, "variation": var})
        await expect(ws, "paramChanged",
                     lambda m: m["area"] == "settings" and m["value"] == old)
        print(f"Settings-Param ok (GlideSpeed {old}->{new}->{old})")

        # 3. Morph zuweisen: erstes va-Modul mit Params, Param 0 -> M1 range 100
        mod = next(m for m in state["modules"] if m["area"] == "va" and m["params"])
        mid = mod["id"]
        assert find_assign(state, mid, 0) is None, "Param schon gemorpht — Testabbruch"
        await send({"type": "setMorph", "area": "va", "module": mid, "param": 0,
                    "morph": 0, "range": 100, "variation": var})
        await expect(ws, "morphChanged", lambda m: m["range"] == 100)
        assert find_assign(fetch_patch(), mid, 0) == (0, 100)
        print(f"Morph-Zuweisung ok (va/{mid}:0 -> M1, +100)")

        # 4. Range negativ ändern
        await send({"type": "setMorph", "area": "va", "module": mid, "param": 0,
                    "morph": 0, "range": -56, "variation": var})
        await expect(ws, "morphChanged", lambda m: m["range"] == -56)
        assert find_assign(fetch_patch(), mid, 0) == (0, -56)
        print("Range-Änderung ok (-56, Vorzeichen-Kodierung)")

        # 5. Auf M3 verschieben
        await send({"type": "setMorph", "area": "va", "module": mid, "param": 0,
                    "morph": 2, "range": 77, "variation": var})
        await expect(ws, "morphChanged", lambda m: m["morph"] == 2)
        st = fetch_patch()
        assert find_assign(st, mid, 0) == (2, 77)
        assert not [a for a in assigns_of(st, 0)
                    if a["module"] == mid and a["param"] == 0]
        print("Verschieben ok (M1 -> M3)")

        # 6. Undo: zurück auf M1/-56; Redo: wieder M3/77
        await send({"type": "undo"})
        await expect(ws, "morphChanged", lambda m: m["range"] == -56)
        assert find_assign(fetch_patch(), mid, 0) == (0, -56)
        await send({"type": "redo"})
        await expect(ws, "morphChanged", lambda m: m["morph"] == 2)
        assert find_assign(fetch_patch(), mid, 0) == (2, 77)
        print("setMorph undo/redo ok")

        # 7. Löschen (range 0) und Endzustand prüfen
        await send({"type": "setMorph", "area": "va", "module": mid, "param": 0,
                    "morph": 2, "range": 0, "variation": var})
        await expect(ws, "morphChanged", lambda m: m["range"] == 0)
        st = fetch_patch()
        assert find_assign(st, mid, 0) is None
        gl = next(s for s in st["settings"] if s["name"] == "Glide")
        assert gl["params"][1]["value"] == old
        print("gelöscht, Ausgangszustand wiederhergestellt")
        print("OK")


asyncio.run(main())
