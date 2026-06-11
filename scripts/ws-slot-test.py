#!/usr/bin/env python3
"""Test für Phase 4b Teil 8: Slot-Handling A–D.
Slot wechseln (patchState des neuen Slots inkl. slots-Liste), Mutation landet
im neuen Slot, Undo-Verlauf wird beim Wechsel verworfen, zurückwechseln stellt
die alte Ansicht her. Benötigt python3-websockets.

Usage: ws-slot-test.py [host] — Default localhost
"""
import asyncio
import json
import sys
import urllib.request

HOST = sys.argv[1] if len(sys.argv) > 1 else "localhost"
URL = f"ws://{HOST}:8080/ws"

SLOTS = ["A", "B", "C", "D"]


def fetch_patch():
    with urllib.request.urlopen(f"http://{HOST}:8080/api/patch", timeout=10) as r:
        return json.load(r)


def mod_keys(state):
    return sorted((m["area"], m["id"]) for m in state["modules"])


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
        start_slot = state["slot"]
        start_ix = SLOTS.index(start_slot)
        other_ix = (start_ix + 1) % 4
        assert "slots" in state and len(state["slots"]) == 4, state.get("slots")
        assert [s["slot"] for s in state["slots"]] == SLOTS, state["slots"]
        names = {s["slot"]: s["name"] for s in state["slots"]}
        print(f"Start: Slot {start_slot} ({state['name']}), slots={names}")

        def send(obj):
            return ws.send(json.dumps(obj))

        # 1. Undo-Eintrag im Start-Slot erzeugen (Modul anlegen)
        await send({"type": "addModule", "area": "va", "typeName": "OscB",
                    "col": 0, "row": 199})
        tmp = (await expect(ws, "moduleAdded"))["module"]
        print(f"Wegwerf-Modul #{tmp['id']} im Slot {start_slot} angelegt")

        # 2. Slot wechseln: patchState des neuen Slots kommt, Name passt zur Liste
        await send({"type": "selectSlot", "slot": other_ix})
        st2 = await expect(ws, "patchState", lambda m: m["slot"] == SLOTS[other_ix])
        assert st2["name"] == names[SLOTS[other_ix]], (st2["name"], names)
        assert fetch_patch()["slot"] == SLOTS[other_ix]
        print(f"Slot-Wechsel ok: {SLOTS[other_ix]} ({st2['name']}), "
              f"{len(st2['modules'])} Module")

        # 3. Undo-Verlauf wurde verworfen: undo darf NICHTS tun
        before = mod_keys(fetch_patch())
        await send({"type": "undo"})
        await asyncio.sleep(2)
        assert mod_keys(fetch_patch()) == before, "undo wirkte über Slot-Wechsel hinweg!"
        print("undo nach Slot-Wechsel ist no-op (Verlauf verworfen)")

        # 4. Mutation landet im NEUEN Slot
        await send({"type": "addModule", "area": "va", "typeName": "OscB",
                    "col": 0, "row": 199})
        tmp2 = (await expect(ws, "moduleAdded"))["module"]
        st = fetch_patch()
        assert st["slot"] == SLOTS[other_ix]
        assert any(m["id"] == tmp2["id"] for m in st["modules"])
        await send({"type": "deleteModule", "area": "va", "module": tmp2["id"]})
        await expect(ws, "moduleDeleted", lambda m: m["module"] == tmp2["id"])
        print(f"Mutation im Slot {SLOTS[other_ix]} ok (Modul #{tmp2['id']} an/aus)")

        # 5. Zurückwechseln; Wegwerf-Modul von Schritt 1 ist noch da -> aufräumen
        await send({"type": "selectSlot", "slot": start_ix})
        st3 = await expect(ws, "patchState", lambda m: m["slot"] == start_slot)
        assert st3["name"] == names[start_slot], (st3["name"], names)
        assert any(m["id"] == tmp["id"] for m in st3["modules"]), \
            "Wegwerf-Modul nach Slot-Rundreise verschwunden"
        await send({"type": "deleteModule", "area": "va", "module": tmp["id"]})
        await expect(ws, "moduleDeleted", lambda m: m["module"] == tmp["id"])
        print(f"zurück in Slot {start_slot}, aufgeräumt")
        print("OK")


asyncio.run(main())
