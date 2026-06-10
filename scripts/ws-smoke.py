#!/usr/bin/env python3
"""Smoke-Test für die g2web-Bridge: WS verbinden, patchState empfangen,
setParam senden, paramChanged-Broadcast erwarten. Benötigt python3-websockets.

Usage: ws-smoke.py [host] — Default localhost
"""
import asyncio
import json
import sys

HOST = sys.argv[1] if len(sys.argv) > 1 else "localhost"
URL = f"ws://{HOST}:8080/ws"


async def main():
    import websockets
    async with websockets.connect(URL) as ws:
        # 1. Initialer patchState
        state = json.loads(await asyncio.wait_for(ws.recv(), 10))
        assert state["type"] == "patchState", state
        mods = [m for m in state["modules"] if m["params"]]
        m = mods[0]
        p = m["params"][0]
        var = state.get("variation", 0)
        print(f"patchState: '{state['name']}' ({len(state['modules'])} Module) — "
              f"teste Modul {m['id']} '{m['name']}' Param '{p['name']}' = {p['value']}")

        # 2. setParam: Wert togglen (innerhalb min/max)
        new_val = p["min"] if p["value"] > p["min"] else p["max"]
        await ws.send(json.dumps({"type": "setParam", "area": m.get("area", "va"),
                                  "module": m["id"],
                                  "param": p["id"], "value": new_val, "variation": var}))

        # 3. paramChanged-Broadcast abwarten
        async def expect_param_changed():
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("type") == "paramChanged" and msg.get("module") == m["id"] \
                        and msg.get("param") == p["id"]:
                    return msg
        evt = await asyncio.wait_for(expect_param_changed(), 10)
        assert evt["value"] == new_val, evt
        print(f"paramChanged empfangen: {evt}")

        # 4. Wert zurücksetzen
        await ws.send(json.dumps({"type": "setParam", "area": m.get("area", "va"),
                                  "module": m["id"],
                                  "param": p["id"], "value": p["value"], "variation": var}))
        evt = await asyncio.wait_for(expect_param_changed(), 10)
        assert evt["value"] == p["value"], evt
        print(f"zurückgesetzt: {evt}")
        print("WS-SMOKE-TEST OK")


asyncio.run(main())
