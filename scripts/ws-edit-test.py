#!/usr/bin/env python3
"""Test für Phase 4b Teil 4: Kollisions-Push-Down, renameModule, setModuleColor.
Zwei Module anlegen, eins aufs andere schieben (erwartet: das stehende rutscht
unter das bewegte), umbenennen, umfärben, alles wieder löschen.
Benötigt python3-websockets.

Usage: ws-edit-test.py [host] — Default localhost
"""
import asyncio
import json
import sys
import urllib.request

HOST = sys.argv[1] if len(sys.argv) > 1 else "localhost"
URL = f"ws://{HOST}:8080/ws"
API = f"http://{HOST}:8080/api"


def fetch(path):
    with urllib.request.urlopen(f"{API}{path}", timeout=10) as r:
        return json.load(r)


def mod_keys(state):
    return sorted((m["area"], m["id"]) for m in state["modules"])


async def expect(ws, msg_type, pred):
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), 10))
        if msg.get("type") == msg_type and pred(msg):
            return msg


async def add(ws, type_name, row):
    await ws.send(json.dumps({"type": "addModule", "area": "va",
                              "typeName": type_name, "col": 0, "row": row}))
    msg = await expect(ws, "moduleAdded",
                       lambda m: m["module"]["typeName"] == type_name
                       and m["module"]["row"] == row)
    return msg["module"]


async def main():
    import websockets
    defs = json.load(urllib.request.urlopen(
        f"http://{HOST}:8080/module-defs.json", timeout=10))
    h = defs["OscB"]["height"]
    async with websockets.connect(URL) as ws:
        state = json.loads(await asyncio.wait_for(ws.recv(), 10))
        assert state["type"] == "patchState", state
        before = mod_keys(state)
        base = max((m["row"] + 10 for m in state["modules"] if m["area"] == "va"
                    and m["col"] == 0), default=0)
        print(f"Patch '{state['name']}' — Testbasis va/0/{base}, OscB-Höhe {h}")

        # 1. Zwei Module übereinander anlegen (mit Luft)
        a = await add(ws, "OscB", base)
        b = await add(ws, "OscB", base + h + 5)
        print(f"angelegt: A=#{a['id']}@{a['row']}, B=#{b['id']}@{b['row']}")

        # 2. B exakt auf A schieben → A muss unter B rutschen (Push-Down)
        await ws.send(json.dumps({"type": "moveModule", "area": "va",
                                  "module": b["id"], "col": 0, "row": base}))
        moved_b = await expect(ws, "moduleMoved", lambda m: m["module"] == b["id"])
        moved_a = await expect(ws, "moduleMoved", lambda m: m["module"] == a["id"])
        assert moved_b["row"] == base, moved_b
        assert moved_a["row"] == base + h, f"A nicht gepusht: {moved_a}"
        st = fetch("/patch")
        rows = {m["id"]: m["row"] for m in st["modules"] if m["area"] == "va"}
        assert rows[b["id"]] == base and rows[a["id"]] == base + h
        print(f"Kollision ok: B@{base}, A nach {base + h} gepusht")

        # 3. Rename + Farbe an B
        await ws.send(json.dumps({"type": "renameModule", "area": "va",
                                  "module": b["id"], "name": "KollideB"}))
        await expect(ws, "moduleRenamed",
                     lambda m: m["module"] == b["id"] and m["name"] == "KollideB")
        await ws.send(json.dumps({"type": "setModuleColor", "area": "va",
                                  "module": b["id"], "color": 5}))
        await expect(ws, "moduleColorChanged",
                     lambda m: m["module"] == b["id"] and m["color"] == 5)
        st = fetch("/patch")
        mb = next(m for m in st["modules"] if m["area"] == "va" and m["id"] == b["id"])
        assert mb["name"] == "KollideB" and mb["color"] == 5, mb
        print(f"rename/color ok: name='{mb['name']}', color={mb['color']}")

        # 4. Aufräumen
        for mod in (a, b):
            await ws.send(json.dumps({"type": "deleteModule", "area": "va",
                                      "module": mod["id"]}))
            await expect(ws, "moduleDeleted", lambda m, i=mod["id"]: m["module"] == i)
        assert mod_keys(fetch("/patch")) == before, "Endzustand != Ausgangszustand"
        print("aufgeräumt: Ausgangszustand wiederhergestellt")
        print("OK")


asyncio.run(main())
