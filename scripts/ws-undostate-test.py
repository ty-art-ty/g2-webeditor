#!/usr/bin/env python3
"""Test für Phase 4b Teil 9: undoState-Feedback.
patchState trägt undo{}, jede Verlaufs-Änderung broadcastet undoState mit
Tiefen+Labels, Slot-Wechsel leert den Verlauf. Benötigt python3-websockets.

Usage: ws-undostate-test.py [host] — Default localhost
"""
import asyncio
import json
import sys

HOST = sys.argv[1] if len(sys.argv) > 1 else "localhost"
URL = f"ws://{HOST}:8080/ws"

SLOTS = ["A", "B", "C", "D"]


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
        assert "undo" in state, "patchState ohne undo{}"
        print(f"patchState.undo = {state['undo']}")
        d0 = state["undo"]["undoDepth"]

        def send(obj):
            return ws.send(json.dumps(obj))

        # Mutation -> undoState mit Label addModule, Tiefe+1, redo geleert
        await send({"type": "addModule", "area": "va", "typeName": "OscB",
                    "col": 0, "row": 199})
        mod = (await expect(ws, "moduleAdded"))["module"]
        st = await expect(ws, "undoState")
        assert st["undoDepth"] == d0 + 1 and st["undoLabel"] == "addModule", st
        assert st["redoDepth"] == 0, st

        # undo -> redo-Seite gefüllt
        await send({"type": "undo"})
        st = await expect(ws, "undoState")
        assert st["undoDepth"] == d0 and st["redoDepth"] == 1, st
        assert st["redoLabel"] == "addModule", st

        # redo -> wieder umgekehrt
        await send({"type": "redo"})
        st = await expect(ws, "undoState")
        assert st["undoDepth"] == d0 + 1 and st["redoDepth"] == 0, st
        print("undo/redo-Tiefen+Labels ok")

        # Aufräumen: Modul löschen (depth+1), dann Slot-Rundreise leert alles
        await send({"type": "deleteModule", "area": "va", "module": mod["id"]})
        st = await expect(ws, "undoState",
                          lambda m: m.get("undoLabel") == "deleteModule")
        assert st["undoDepth"] == d0 + 2, st
        cur = SLOTS.index(state["slot"])
        await send({"type": "selectSlot", "slot": (cur + 1) % 4})
        st = await expect(ws, "undoState")
        assert st["undoDepth"] == 0 and st["redoDepth"] == 0, st
        print("Slot-Wechsel leert den Verlauf (undoState 0/0)")
        await send({"type": "selectSlot", "slot": cur})
        await expect(ws, "patchState", lambda m: m["slot"] == state["slot"])
        print("zurück im Start-Slot")
        print("OK")


asyncio.run(main())
