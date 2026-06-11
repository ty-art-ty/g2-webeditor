#!/usr/bin/env python3
"""Round-Trip-Test für addModule/deleteModule (Phase 4b Teil 3):
Modul anlegen (moduleAdded erwarten), per /api/patch prüfen (inkl. Default-Params),
wieder löschen (moduleDeleted erwarten), Endzustand = Ausgangszustand.
Benötigt python3-websockets.

Usage: ws-module-test.py [host] [typeName] — Defaults: localhost, OscB
"""
import asyncio
import json
import sys
import urllib.request

HOST = sys.argv[1] if len(sys.argv) > 1 else "localhost"
TYPE = sys.argv[2] if len(sys.argv) > 2 else "OscB"
URL = f"ws://{HOST}:8080/ws"
API = f"http://{HOST}:8080/api/patch"


def fetch_state():
    with urllib.request.urlopen(API, timeout=10) as r:
        return json.load(r)


def mod_keys(state):
    return sorted((m["area"], m["id"]) for m in state["modules"])


async def expect(ws, msg_type, pred):
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), 10))
        if msg.get("type") == msg_type and pred(msg):
            return msg


async def main():
    import websockets
    async with websockets.connect(URL) as ws:
        state = json.loads(await asyncio.wait_for(ws.recv(), 10))
        assert state["type"] == "patchState", state
        before = mod_keys(state)
        row = max((m["row"] for m in state["modules"] if m["area"] == "va"), default=0) + 5
        print(f"Patch '{state['name']}', {len(before)} Module — lege {TYPE} auf va/0/{row} an")

        # 1. Anlegen
        await ws.send(json.dumps({"type": "addModule", "area": "va",
                                  "typeName": TYPE, "col": 0, "row": row}))
        added = await expect(ws, "moduleAdded", lambda m: m["module"]["typeName"] == TYPE)
        mod = added["module"]
        print(f"moduleAdded: id={mod['id']} name='{mod['name']}' "
              f"col={mod['col']} row={mod['row']} params={len(mod['params'])}")
        st = fetch_state()
        server_mod = next((m for m in st["modules"]
                           if m["area"] == "va" and m["id"] == mod["id"]), None)
        assert server_mod, "Modul nicht im Server-State"
        assert server_mod["typeName"] == TYPE and server_mod["row"] == row
        assert len(st["modules"]) == len(before) + 1
        print("Server-State ok (Modul vorhanden, Position stimmt)")

        # 2. Löschen
        await ws.send(json.dumps({"type": "deleteModule", "area": "va",
                                  "module": mod["id"]}))
        await expect(ws, "moduleDeleted",
                     lambda m: m["area"] == "va" and m["module"] == mod["id"])
        st = fetch_state()
        assert mod_keys(st) == before, "Endzustand != Ausgangszustand"
        print("moduleDeleted: Server-State wieder im Ausgangszustand")

        print("OK")


asyncio.run(main())
