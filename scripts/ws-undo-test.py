#!/usr/bin/env python3
"""Test für Phase 4b Teil 5: Undo/Redo über alle Mutationen.
Deckt ab: addModule (undo/redo), moveModule mit Kollisions-Push (undo),
addCable (undo/redo), deleteCable (undo, Farbe erhalten),
deleteModule mit Kabel-Kaskade (undo stellt Modul + Kabel wieder her).
Benötigt python3-websockets.

Usage: ws-undo-test.py [host] — Default localhost
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


def mod_keys(state):
    return sorted((m["area"], m["id"]) for m in state["modules"])


def find_cable(state, fm, fc, tm, tc):
    return next((c for c in state["cables"] if c["area"] == "va"
                 and c["from"]["module"] == fm and c["from"]["conn"] == fc
                 and c["to"]["module"] == tm and c["to"]["conn"] == tc), None)


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
        base = max((m["row"] + 10 for m in state["modules"]
                    if m["area"] == "va" and m["col"] == 0), default=0)
        print(f"Patch '{state['name']}' — Basis va/0/{base}")

        def send(obj):
            return ws.send(json.dumps(obj))

        # --- 1. addModule + undo + redo
        await send({"type": "addModule", "area": "va", "typeName": "OscB",
                    "col": 0, "row": base})
        a = (await expect(ws, "moduleAdded",
                          lambda m: m["module"]["row"] == base))["module"]
        await send({"type": "undo"})
        await expect(ws, "moduleDeleted", lambda m: m["module"] == a["id"])
        assert not any(m["id"] == a["id"] and m["area"] == "va"
                       for m in fetch_patch()["modules"])
        await send({"type": "redo"})
        a2 = (await expect(ws, "moduleAdded"))["module"]
        assert (a2["id"], a2["name"], a2["row"]) == (a["id"], a["name"], a["row"]), a2
        print(f"addModule undo/redo ok (A=#{a['id']} '{a['name']}')")

        # --- 2. zweites Modul, Kollisions-Move + undo
        await send({"type": "addModule", "area": "va", "typeName": "OscB",
                    "col": 0, "row": base + h + 5})
        b = (await expect(ws, "moduleAdded",
                          lambda m: m["module"]["row"] == base + h + 5))["module"]
        await send({"type": "moveModule", "area": "va", "module": b["id"],
                    "col": 0, "row": base})
        await expect(ws, "moduleMoved", lambda m: m["module"] == b["id"]
                     and m["row"] == base)
        await expect(ws, "moduleMoved", lambda m: m["module"] == a["id"]
                     and m["row"] == base + h)
        await send({"type": "undo"})
        moved = {}
        for _ in range(2):
            mm = await expect(ws, "moduleMoved")
            moved[mm["module"]] = mm["row"]
        assert moved[b["id"]] == base + h + 5 and moved[a["id"]] == base, moved
        print("moveModule mit Kollisions-Push: undo stellt beide Positionen wieder her")

        # --- 3. addCable + undo + redo
        cab = {"area": "va", "from": {"module": a["id"], "conn": 0},
               "to": {"module": b["id"], "conn": 0}, "fromOutput": True}
        await send({"type": "addCable", **cab})
        added = await expect(ws, "cableAdded", lambda m: m["from"]["module"] == a["id"])
        color = added["color"]
        await send({"type": "undo"})
        await expect(ws, "cableDeleted", lambda m: m["from"]["module"] == a["id"])
        assert not find_cable(fetch_patch(), a["id"], 0, b["id"], 0)
        await send({"type": "redo"})
        await expect(ws, "cableAdded", lambda m: m["from"]["module"] == a["id"])
        print(f"addCable undo/redo ok (Farbe {color})")

        # --- 4. deleteCable + undo (Farbe muss erhalten bleiben)
        await send({"type": "deleteCable", **cab})
        await expect(ws, "cableDeleted", lambda m: m["from"]["module"] == a["id"])
        await send({"type": "undo"})
        restored = await expect(ws, "cableAdded", lambda m: m["from"]["module"] == a["id"])
        assert restored["color"] == color, restored
        print("deleteCable undo ok (Farbe erhalten)")

        # --- 5. deleteModule mit Kabel + undo (Modul UND Kabel zurück)
        await send({"type": "deleteModule", "area": "va", "module": b["id"]})
        await expect(ws, "moduleDeleted", lambda m: m["module"] == b["id"])
        await send({"type": "undo"})
        rb = (await expect(ws, "moduleAdded"))["module"]
        rc = await expect(ws, "cableAdded", lambda m: m["from"]["module"] == a["id"])
        assert (rb["id"], rb["name"]) == (b["id"], b["name"]), rb
        assert rc["color"] == color, rc
        st = fetch_patch()
        assert find_cable(st, a["id"], 0, b["id"], 0), "Kabel fehlt nach Modul-Undo"
        print("deleteModule undo ok (Modul + Kabel restauriert)")

        # --- Aufräumen (ohne Undo)
        for mid in (b["id"], a["id"]):
            await send({"type": "deleteModule", "area": "va", "module": mid})
            await expect(ws, "moduleDeleted", lambda m, i=mid: m["module"] == i)
        assert mod_keys(fetch_patch()) == before, "Endzustand != Ausgangszustand"
        print("aufgeräumt: Ausgangszustand wiederhergestellt")
        print("OK")


asyncio.run(main())
