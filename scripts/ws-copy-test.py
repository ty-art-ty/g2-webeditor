#!/usr/bin/env python3
"""Test für Phase 4b Teil 6: copyModule.
Quelle anlegen und präparieren (Param, Farbe, Name), kopieren, Gleichheit
prüfen, Unabhängigkeit prüfen (Param der Kopie ändern darf die Quelle nicht
ändern — Deep-Copy-Falle!), Undo/Redo, aufräumen. Benötigt python3-websockets.

Usage: ws-copy-test.py [host] — Default localhost
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


def get_mod(state, mid):
    return next(m for m in state["modules"] if m["area"] == "va" and m["id"] == mid)


def mod_keys(state):
    return sorted((m["area"], m["id"]) for m in state["modules"])


async def expect(ws, msg_type, pred=lambda m: True):
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), 10))
        if msg.get("type") == msg_type and pred(msg):
            return msg


async def main():
    import websockets
    defs = json.load(urllib.request.urlopen(
        f"http://{HOST}:8080/module-defs.json", timeout=10))
    h = defs["OscB"]["height"]
    async with websockets.connect(URL) as ws:
        state = json.loads(await asyncio.wait_for(ws.recv(), 10))
        assert state["type"] == "patchState", state
        before = mod_keys(state)
        var = state.get("variation", 0)
        base = max((m["row"] + 10 for m in state["modules"]
                    if m["area"] == "va" and m["col"] == 0), default=0)

        def send(obj):
            return ws.send(json.dumps(obj))

        # 1. Quelle anlegen und präparieren
        await send({"type": "addModule", "area": "va", "typeName": "OscB",
                    "col": 0, "row": base})
        src = (await expect(ws, "moduleAdded",
                            lambda m: m["module"]["row"] == base))["module"]
        await send({"type": "setParam", "area": "va", "module": src["id"],
                    "param": 0, "value": 99, "variation": var})
        await expect(ws, "paramChanged", lambda m: m["module"] == src["id"])
        await send({"type": "setModuleColor", "area": "va",
                    "module": src["id"], "color": 7})
        await expect(ws, "moduleColorChanged", lambda m: m["module"] == src["id"])
        await send({"type": "renameModule", "area": "va",
                    "module": src["id"], "name": "Quelle"})
        await expect(ws, "moduleRenamed", lambda m: m["module"] == src["id"])
        print(f"Quelle #{src['id']} präpariert (param0=99, color=7, 'Quelle')")

        # 2. Kopieren (direkt darunter)
        await send({"type": "copyModule", "area": "va", "module": src["id"],
                    "col": 0, "row": base + h})
        cp = (await expect(ws, "moduleAdded"))["module"]
        assert cp["id"] != src["id"]
        assert cp["typeName"] == "OscB" and cp["name"] == "Quelle", cp
        assert cp["color"] == 7 and cp["row"] == base + h, cp
        assert cp["params"][0]["value"] == 99, cp["params"][0]
        print(f"Kopie #{cp['id']} ok (Name/Farbe/Param übernommen)")

        # 3. Unabhängigkeit: Param der Kopie ändern, Quelle muss bleiben
        await send({"type": "setParam", "area": "va", "module": cp["id"],
                    "param": 0, "value": 11, "variation": var})
        await expect(ws, "paramChanged", lambda m: m["module"] == cp["id"])
        st = fetch_patch()
        sv = get_mod(st, src["id"])["params"][0]["value"]
        cv = get_mod(st, cp["id"])["params"][0]["value"]
        assert (sv, cv) == (99, 11), f"Deep-Copy verletzt: Quelle={sv}, Kopie={cv}"
        print("Unabhängigkeit ok (Quelle 99, Kopie 11)")

        # 4. Undo (Kopie weg) + Redo (wieder da, gleicher Zustand zum Undo-Zeitpunkt)
        await send({"type": "undo"})  # macht setParam der Kopie NICHT rückgängig
        # (setParam ist bewusst nicht im Undo-Verlauf) → letzter Eintrag = copyModule
        await expect(ws, "moduleDeleted", lambda m: m["module"] == cp["id"])
        assert not any(k == ("va", cp["id"]) for k in mod_keys(fetch_patch()))
        await send({"type": "redo"})
        rcp = (await expect(ws, "moduleAdded"))["module"]
        assert rcp["id"] == cp["id"] and rcp["name"] == "Quelle", rcp
        print("copyModule undo/redo ok")

        # 5. Aufräumen
        for mid in (cp["id"], src["id"]):
            await send({"type": "deleteModule", "area": "va", "module": mid})
            await expect(ws, "moduleDeleted", lambda m, i=mid: m["module"] == i)
        assert mod_keys(fetch_patch()) == before, "Endzustand != Ausgangszustand"
        print("aufgeräumt: Ausgangszustand wiederhergestellt")
        print("OK")


asyncio.run(main())
