#!/usr/bin/env python3
"""Round-Trip-Test für addCable/deleteCable (Phase 4b Teil 2):
Bestehendes Kabel aus dem patchState löschen (cableDeleted erwarten),
dann wieder anlegen (cableAdded erwarten), State jeweils per /api/patch prüfen.
Hinweis: Die Farbe kann sich beim Wiederanlegen ändern (Server bestimmt sie
aus dem Quell-Connector, ohne Uprate-Logik). Benötigt python3-websockets.

Usage: ws-cable-test.py [host] — Default localhost
"""
import asyncio
import json
import sys
import urllib.request

HOST = sys.argv[1] if len(sys.argv) > 1 else "localhost"
URL = f"ws://{HOST}:8080/ws"
API = f"http://{HOST}:8080/api/patch"


def cable_key(c):
    return (c["area"], c["from"]["module"], c["from"]["conn"],
            c["to"]["module"], c["to"]["conn"])


def fetch_cables():
    with urllib.request.urlopen(API, timeout=10) as r:
        return [cable_key(c) for c in json.load(r)["cables"]]


async def expect(ws, msg_type, key):
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), 10))
        if msg.get("type") == msg_type and cable_key(msg) == key:
            return msg


async def main():
    import websockets
    async with websockets.connect(URL) as ws:
        state = json.loads(await asyncio.wait_for(ws.recv(), 10))
        assert state["type"] == "patchState", state
        assert state["cables"], "Patch hat keine Kabel — anderen Patch laden"
        c = state["cables"][0]
        key = cable_key(c)
        ident = {"area": c["area"], "from": c["from"], "to": c["to"],
                 "fromOutput": c.get("fromOutput", True)}
        print(f"Patch '{state['name']}', {len(state['cables'])} Kabel — Testkabel: {key}")

        # 1. Löschen
        await ws.send(json.dumps({"type": "deleteCable", **ident}))
        await expect(ws, "cableDeleted", key)
        assert key not in fetch_cables(), "Kabel nach Löschen noch im Server-State"
        print("deleteCable: cableDeleted empfangen, Server-State ok")

        # 2. Wieder anlegen
        await ws.send(json.dumps({"type": "addCable", **ident}))
        added = await expect(ws, "cableAdded", key)
        assert key in fetch_cables(), "Kabel nach Anlegen nicht im Server-State"
        print(f"addCable: cableAdded empfangen (Farbe {added['color']}), Server-State ok")

        # 3. Doppeltes Anlegen muss idempotent sein (kein zweites Kabel)
        await ws.send(json.dumps({"type": "addCable", **ident}))
        await asyncio.sleep(1)
        assert fetch_cables().count(key) == 1, "Duplikat-Kabel angelegt"
        print("addCable doppelt: idempotent, kein Duplikat")

        print("OK")


asyncio.run(main())
