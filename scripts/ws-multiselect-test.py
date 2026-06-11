#!/usr/bin/env python3
"""Test für Phase 4b Teil 7: Multi-Select-Operationen.
Zwei Module + internes Kabel anlegen, copySelection (Kopien inkl. Kabel,
tiefe Param-Kopie, selectionCopied), moveModules (starrer Block, EIN
Undo-Eintrag), Undo/Redo-Ketten, deleteModules (Undo restauriert Module UND
internes Kabel), aufräumen. Benötigt python3-websockets.

Usage: ws-multiselect-test.py [host] — Default localhost
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
    return next((m for m in state["modules"]
                 if m["area"] == "va" and m["id"] == mid), None)


def get_cable(state, fm, fc, tm, tc):
    return next((c for c in state["cables"]
                 if c["area"] == "va"
                 and c["from"] == {"module": fm, "conn": fc}
                 and c["to"] == {"module": tm, "conn": tc}), None)


def mod_keys(state):
    return sorted((m["area"], m["id"]) for m in state["modules"])


def cable_keys(state):
    return sorted((c["area"], c["from"]["module"], c["from"]["conn"],
                   c["to"]["module"], c["to"]["conn"]) for c in state["cables"])


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
        before_mods, before_cables = mod_keys(state), cable_keys(state)
        var = state.get("variation", 0)
        base = max((m["row"] + 10 for m in state["modules"]
                    if m["area"] == "va" and m["col"] == 0), default=0)

        def send(obj):
            return ws.send(json.dumps(obj))

        # 1. Zwei Quellen + internes Kabel (A out0 -> B in0), A param0=42
        srcs = []
        for i in range(2):
            await send({"type": "addModule", "area": "va", "typeName": "OscB",
                        "col": 0, "row": base + i * h})
            srcs.append((await expect(
                ws, "moduleAdded",
                lambda m, r=base + i * h: m["module"]["row"] == r))["module"])
        a, b = srcs[0]["id"], srcs[1]["id"]
        await send({"type": "addCable", "area": "va", "fromOutput": True,
                    "from": {"module": a, "conn": 0}, "to": {"module": b, "conn": 0}})
        cab = await expect(ws, "cableAdded", lambda m: m["from"]["module"] == a)
        await send({"type": "setParam", "area": "va", "module": a,
                    "param": 0, "value": 42, "variation": var})
        await expect(ws, "paramChanged", lambda m: m["module"] == a)
        print(f"Quellen #{a},#{b} + internes Kabel (Farbe {cab['color']}) angelegt")

        # 2. copySelection: Block um 2h nach unten, inkl. internem Kabel
        await send({"type": "copySelection", "area": "va",
                    "modules": [a, b], "dCol": 0, "dRow": 2 * h})
        ca = (await expect(ws, "moduleAdded",
                           lambda m: m["module"]["row"] == base + 2 * h))["module"]
        cb = (await expect(ws, "moduleAdded",
                           lambda m: m["module"]["row"] == base + 3 * h))["module"]
        ccab = await expect(ws, "cableAdded",
                            lambda m: m["from"]["module"] == ca["id"])
        sel = await expect(ws, "selectionCopied")
        assert sorted(sel["modules"]) == sorted([ca["id"], cb["id"]]), sel
        assert ca["params"][0]["value"] == 42, ca["params"][0]
        assert ccab["to"] == {"module": cb["id"], "conn": 0}, ccab
        assert ccab["color"] == cab["color"], (ccab, cab)
        print(f"copySelection ok: Kopien #{ca['id']},#{cb['id']} + internes Kabel")

        # 3. Unabhängigkeit: Param der Kopie ändern darf die Quelle nicht ändern
        await send({"type": "setParam", "area": "va", "module": ca["id"],
                    "param": 0, "value": 7, "variation": var})
        await expect(ws, "paramChanged", lambda m: m["module"] == ca["id"])
        st = fetch_patch()
        sv = get_mod(st, a)["params"][0]["value"]
        cv = get_mod(st, ca["id"])["params"][0]["value"]
        assert (sv, cv) == (42, 7), f"Deep-Copy verletzt: Quelle={sv}, Kopie={cv}"
        print("Unabhängigkeit ok (Quelle 42, Kopie 7)")

        # 4. moveModules: beide Kopien als Block nach Spalte 1 (EIN Undo-Eintrag)
        await send({"type": "moveModules", "area": "va", "moves": [
            {"module": ca["id"], "col": 1, "row": ca["row"]},
            {"module": cb["id"], "col": 1, "row": cb["row"]}]})
        for mid in (ca["id"], cb["id"]):
            mv = await expect(ws, "moduleMoved", lambda m, i=mid: m["module"] == i)
            assert mv["col"] == 1, mv
        st = fetch_patch()
        assert get_mod(st, ca["id"])["col"] == 1 and get_mod(st, cb["id"])["col"] == 1
        print("moveModules ok (Block nach Spalte 1)")

        # 5. Undo moveModules: EIN Undo bringt BEIDE zurück
        await send({"type": "undo"})
        for mid in (ca["id"], cb["id"]):
            mv = await expect(ws, "moduleMoved", lambda m, i=mid: m["module"] == i)
            assert mv["col"] == 0, mv
        print("undo moveModules ok (beide zurück in Spalte 0)")

        # 6. Undo copySelection: Kopien + internes Kabel weg
        await send({"type": "undo"})
        for mid in (ca["id"], cb["id"]):
            await expect(ws, "moduleDeleted", lambda m, i=mid: m["module"] == i)
        st = fetch_patch()
        assert get_mod(st, ca["id"]) is None and get_mod(st, cb["id"]) is None
        assert get_cable(st, ca["id"], 0, cb["id"], 0) is None
        print("undo copySelection ok (Kopien + Kabel weg)")

        # 7. Redo copySelection: identisch zurück (inkl. Kabel und Param-Stand 7)
        await send({"type": "redo"})
        rsel = await expect(ws, "selectionCopied")
        assert sorted(rsel["modules"]) == sorted([ca["id"], cb["id"]]), rsel
        st = fetch_patch()
        rca = get_mod(st, ca["id"])
        assert rca and rca["params"][0]["value"] == 7, rca
        assert get_cable(st, ca["id"], 0, cb["id"], 0), "internes Kabel fehlt nach Redo"
        print("redo copySelection ok (Kopien + Kabel + Params zurück)")
        await send({"type": "undo"})  # Kopien wieder entfernen
        for mid in (ca["id"], cb["id"]):
            await expect(ws, "moduleDeleted", lambda m, i=mid: m["module"] == i)

        # 8. deleteModules: Quellen weg; Undo restauriert Module UND internes Kabel
        await send({"type": "deleteModules", "area": "va", "modules": [a, b]})
        for mid in (a, b):
            await expect(ws, "moduleDeleted", lambda m, i=mid: m["module"] == i)
        assert get_mod(fetch_patch(), a) is None
        await send({"type": "undo"})
        for mid in (a, b):
            await expect(ws, "moduleAdded", lambda m, i=mid: m["module"]["id"] == i)
        st = fetch_patch()
        assert get_mod(st, a)["params"][0]["value"] == 42
        assert get_cable(st, a, 0, b, 0), "internes Kabel fehlt nach deleteModules-Undo"
        print("deleteModules + undo ok (Module + internes Kabel restauriert)")

        # 9. Aufräumen per Redo (löscht beide wieder) und Endzustand prüfen
        await send({"type": "redo"})
        for mid in (a, b):
            await expect(ws, "moduleDeleted", lambda m, i=mid: m["module"] == i)
        st = fetch_patch()
        assert mod_keys(st) == before_mods, "Module: Endzustand != Ausgangszustand"
        assert cable_keys(st) == before_cables, "Kabel: Endzustand != Ausgangszustand"
        print("aufgeräumt: Ausgangszustand wiederhergestellt")
        print("OK")


asyncio.run(main())
