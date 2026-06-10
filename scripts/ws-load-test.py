#!/usr/bin/env python3
"""Phase-3-Test: loadPatch (REST) + selectVariation (WS) gegen echten G2.
Lädt einen anderen Patch, prüft den patchState-Broadcast, lädt das Original zurück.

Usage: ws-load-test.py [host] [bank] [entry_andere] [entry_original]
"""
import asyncio
import json
import sys
import urllib.request

HOST = sys.argv[1] if len(sys.argv) > 1 else "localhost"
BANK = int(sys.argv[2]) if len(sys.argv) > 2 else 2
OTHER = int(sys.argv[3]) if len(sys.argv) > 3 else 1      # '3-Shape synth'
ORIGINAL = int(sys.argv[4]) if len(sys.argv) > 4 else 49  # 'HipHop beat box'


def rest_load(bank, entry):
    req = urllib.request.Request(
        f"http://{HOST}:8080/api/patch/load",
        data=json.dumps({"bank": bank, "slot": entry}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        assert r.status == 202, r.status


async def next_patch_state(ws, timeout=20):
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout))
        if msg.get("type") == "patchState":
            return msg


async def main():
    import websockets
    async with websockets.connect(f"ws://{HOST}:8080/ws") as ws:
        state = await next_patch_state(ws)
        print(f"aktuell: '{state['name']}'")

        # 1. anderen Patch laden -> patchState-Broadcast mit neuem Namen
        rest_load(BANK, OTHER)
        state = await next_patch_state(ws)
        print(f"loadPatch({BANK},{OTHER}) -> '{state['name']}' ({len(state['modules'])} Module)")
        assert state["name"] != "", state

        # 2. Variation wechseln -> variationChanged
        await ws.send(json.dumps({"type": "selectVariation", "variation": 1}))
        while True:
            msg = json.loads(await asyncio.wait_for(ws.recv(), 10))
            if msg.get("type") == "variationChanged":
                print(f"variationChanged: {msg}")
                break
        await ws.send(json.dumps({"type": "selectVariation", "variation": 0}))

        # 3. Original zurückladen
        rest_load(BANK, ORIGINAL)
        state = await next_patch_state(ws)
        print(f"restore -> '{state['name']}'")
        print("LOAD-TEST OK")


asyncio.run(main())
