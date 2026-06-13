#!/usr/bin/env python3
"""Test für Phase 4b Teil 15: Global Knobs + Perf-Store + loadPerf.

Prüft: patchState trägt globalKnobs; assignGlobalKnob/deassignGlobalKnob
broadcasten globalKnobsChanged (inkl. serverseitig aufgelöster Namen) und
räumen sauber auf; storePerf speichert die aktuelle Performance in den ersten
FREIEN Perf-Bank-Platz (broadcastet banksChanged, Eintrag taucht in
/api/perfbanks auf); danach lädt loadPerf genau diesen Eintrag zurück —
das ist verlustfrei, weil es die soeben gespeicherte (identische) Performance
ist. Der gespeicherte Eintrag bleibt am Gerät (kein Lösch-Kommando
implementiert) — Aufräumen ggf. am G2-Panel.

Benötigt python3-websockets.
Usage: ws-perf15-test.py [host] [--no-store]
"""
import asyncio
import json
import sys
import urllib.request

args = [a for a in sys.argv[1:] if not a.startswith("--")]
HOST = args[0] if len(args) > 0 else "localhost"
NO_STORE = "--no-store" in sys.argv
URL = f"ws://{HOST}:8080/ws"


def fetch(path):
    with urllib.request.urlopen(f"http://{HOST}:8080{path}", timeout=10) as r:
        return json.load(r)


async def expect(ws, msg_type, pred=lambda m: True, timeout=10):
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout))
        if msg.get("type") == msg_type and pred(msg):
            return msg


def knob_name(k):
    return f"{k // 24 + 1}{'ABC'[(k % 24) // 8]}{k % 8 + 1}"


async def main():
    import websockets
    async with websockets.connect(URL) as ws:
        state = await expect(ws, "patchState")
        assert "globalKnobs" in state, "patchState ohne globalKnobs"
        knobs0 = state["globalKnobs"]
        slot_letter = state["slot"]
        slot_ix = "ABCD".index(slot_letter)
        print(f"Slot {slot_letter}, {len(knobs0)} Global Knobs zugewiesen")

        def send(obj):
            return ws.send(json.dumps(obj))

        # 1. Ziel-Param: erstes VA-Modul des aktiven Slots mit Params
        mod = next((m for m in state["modules"]
                    if m["area"] == "va" and m["params"]), None)
        assert mod, "kein VA-Modul mit Params im aktiven Slot"
        param = mod["params"][0]

        # 2. Freien Knob suchen und zuweisen
        used = {k["knob"] for k in knobs0}
        free = next(i for i in range(120) if i not in used)
        await send({"type": "assignGlobalKnob", "knob": free, "slot": slot_ix,
                    "area": "va", "module": mod["id"], "param": param["id"]})
        m = await expect(ws, "globalKnobsChanged", lambda m: any(
            k["knob"] == free and k["slot"] == slot_letter
            and k["area"] == "va" and k["module"] == mod["id"]
            and k["param"] == param["id"] for k in m["knobs"]))
        ass = next(k for k in m["knobs"] if k["knob"] == free)
        print(f"assignGlobalKnob {knob_name(free)} -> "
              f"{ass.get('moduleName')}·{ass.get('paramName')} ok")
        assert ass.get("moduleName"), "moduleName fehlt im Broadcast"

        # 3. Wieder lösen
        await send({"type": "deassignGlobalKnob", "knob": free})
        await expect(ws, "globalKnobsChanged",
                     lambda m: all(k["knob"] != free for k in m["knobs"]))
        print(f"deassignGlobalKnob {knob_name(free)} ok")

        if NO_STORE:
            print("PASS (ohne Store/Load, --no-store)")
            return

        # 4. storePerf in den ersten FREIEN Platz (überschreibt nichts)
        perf_name = (state.get("perfSettings") or {}).get("name", "").strip()
        banks = fetch("/api/perfbanks")
        occupied = {(b["bank"], p["slot"]) for b in banks for p in b["patches"]}
        bank, entry = next(((b, s) for b in range(1, 9) for s in range(1, 33)
                            if (b, s) not in occupied), (None, None))
        assert bank, "keine freie Perf-Bank-Position gefunden"
        await send({"type": "storePerf", "bank": bank, "slot": entry})
        await expect(ws, "banksChanged", timeout=20)
        # Bank-Snapshot des Servers prüfen
        banks = fetch("/api/perfbanks")
        stored = next((p for b in banks if b["bank"] == bank
                       for p in b["patches"] if p["slot"] == entry), None)
        assert stored, f"gespeicherter Eintrag {bank}/{entry} fehlt in /api/perfbanks"
        print(f"storePerf -> Bank {bank} Platz {entry} ('{stored['name']}') ok")
        assert stored["name"].strip().lower() == perf_name.lower(), \
            (stored["name"], perf_name)

        # 5. loadPerf: die soeben gespeicherte (identische) Perf zurückladen
        await send({"type": "loadPerf", "bank": bank, "slot": entry})
        st = await expect(ws, "patchState", timeout=30)
        got = (st.get("perfSettings") or {}).get("name", "")
        assert got.strip().lower() == perf_name.lower(), (got, perf_name)
        assert "globalKnobs" in st
        print(f"loadPerf {bank}/{entry} -> patchState mit Perf '{got}' ok")
        print(f"Hinweis: Test-Eintrag bleibt in Perf-Bank {bank} Platz {entry}.")

        print("PASS")


asyncio.run(main())
