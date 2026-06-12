#!/usr/bin/env python3
"""Test für Phase 4b Teil 14: Performance-Mode.

Prüft: patchState trägt perfSettings; setMasterClock/setClockRun,
setPerfSlotSetting (hold/enabled + keyFrom bei aktiviertem Range),
setKeyboardRangeEnabled und renamePerf broadcasten perfSettingsChanged und
landen im Server-State. Alle Werte werden am Ende auf den Ausgangszustand
zurückgesetzt. /api/perfbanks wird gelesen; loadPerf wird NUR mit --load-perf
getestet (ersetzt alle 4 Slots — das aktuelle Gerät-Setup geht verloren,
wenn es nicht gespeichert ist!).

Benötigt python3-websockets.
Usage: ws-perf-test.py [host] [--load-perf]
"""
import asyncio
import json
import sys
import urllib.request

args = [a for a in sys.argv[1:] if not a.startswith("--")]
HOST = args[0] if len(args) > 0 else "localhost"
LOAD_PERF = "--load-perf" in sys.argv
URL = f"ws://{HOST}:8080/ws"


def fetch(path):
    with urllib.request.urlopen(f"http://{HOST}:8080{path}", timeout=10) as r:
        return json.load(r)


async def expect(ws, msg_type, pred=lambda m: True, timeout=10):
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout))
        if msg.get("type") == msg_type and pred(msg):
            return msg


async def main():
    import websockets
    async with websockets.connect(URL) as ws:
        # Erste Message muss nicht der patchState sein — visuals-Broadcasts
        # können sich auf einer frischen Verbindung dazwischenschieben.
        state = await expect(ws, "patchState")
        ps = state.get("perfSettings")
        assert ps, "patchState ohne perfSettings"
        assert {"name", "clockBpm", "clockRun", "keyboardRangeEnabled", "slots"} <= ps.keys(), ps
        assert len(ps["slots"]) == 4, ps["slots"]
        print(f"Perf '{ps['name']}': clock={ps['clockBpm']} run={ps['clockRun']} "
              f"rangeEnabled={ps['keyboardRangeEnabled']}")
        for s in ps["slots"]:
            print(f"  {s['slot']}: enabled={s['enabled']} kbd={s['keyboard']} "
                  f"hold={s['hold']} range={s['keyFrom']}-{s['keyTo']}")

        def send(obj):
            return ws.send(json.dumps(obj))

        # 1. Master-Clock BPM hin und zurück
        bpm0 = ps["clockBpm"]
        bpm1 = bpm0 + 6 if bpm0 < 230 else bpm0 - 6
        await send({"type": "setMasterClock", "bpm": bpm1})
        m = await expect(ws, "perfSettingsChanged", lambda m: m["clockBpm"] == bpm1)
        print(f"setMasterClock {bpm0}->{bpm1} ok")
        await send({"type": "setMasterClock", "bpm": bpm0})
        await expect(ws, "perfSettingsChanged", lambda m: m["clockBpm"] == bpm0)

        # 2. Clock-Run togglen + zurück
        run0 = ps["clockRun"]
        await send({"type": "setClockRun", "run": not run0})
        await expect(ws, "perfSettingsChanged", lambda m: m["clockRun"] == (not run0))
        await send({"type": "setClockRun", "run": run0})
        await expect(ws, "perfSettingsChanged", lambda m: m["clockRun"] == run0)
        print(f"setClockRun {run0}->{not run0}->{run0} ok")

        # 3. Slot-B-Hold togglen + zurück
        hold0 = ps["slots"][1]["hold"]
        await send({"type": "setPerfSlotSetting", "slot": 1, "key": "hold",
                    "value": 0 if hold0 else 1})
        await expect(ws, "perfSettingsChanged",
                     lambda m: m["slots"][1]["hold"] == (not hold0))
        await send({"type": "setPerfSlotSetting", "slot": 1, "key": "hold",
                    "value": 1 if hold0 else 0})
        await expect(ws, "perfSettingsChanged",
                     lambda m: m["slots"][1]["hold"] == hold0)
        print(f"setPerfSlotSetting B.hold {hold0}->{not hold0}->{hold0} ok")

        # 4. Keyboard-Range aktivieren, Slot-A keyFrom setzen, alles zurück
        re0 = ps["keyboardRangeEnabled"]
        kf0 = ps["slots"][0]["keyFrom"]
        kf1 = 36 if kf0 != 36 else 48
        await send({"type": "setKeyboardRangeEnabled", "enabled": True})
        if not re0:
            await expect(ws, "perfSettingsChanged",
                         lambda m: m["keyboardRangeEnabled"] is True)
        await send({"type": "setPerfSlotSetting", "slot": 0, "key": "keyFrom",
                    "value": kf1})
        await expect(ws, "perfSettingsChanged",
                     lambda m: m["slots"][0]["keyFrom"] == kf1)
        await send({"type": "setPerfSlotSetting", "slot": 0, "key": "keyFrom",
                    "value": kf0})
        await expect(ws, "perfSettingsChanged",
                     lambda m: m["slots"][0]["keyFrom"] == kf0)
        if not re0:
            await send({"type": "setKeyboardRangeEnabled", "enabled": False})
            await expect(ws, "perfSettingsChanged",
                         lambda m: m["keyboardRangeEnabled"] is False)
        print(f"keyboardRange {re0}->True, A.keyFrom {kf0}->{kf1}->{kf0}, "
              f"rangeEnabled zurück auf {re0} ok")

        # 5. Perf umbenennen + zurück
        name0 = ps["name"]
        name1 = (name0 + "~")[:16] if len(name0) < 16 else name0[:15] + "~"
        await send({"type": "renamePerf", "name": name1})
        await expect(ws, "perfSettingsChanged", lambda m: m["name"] == name1)
        await send({"type": "renamePerf", "name": name0})
        await expect(ws, "perfSettingsChanged", lambda m: m["name"] == name0)
        print(f"renamePerf '{name0}'->'{name1}'->'{name0}' ok")

        # 6. Perf-Banks lesen
        perfbanks = fetch("/api/perfbanks")
        n = sum(len(b["patches"]) for b in perfbanks)
        print(f"/api/perfbanks: {len(perfbanks)} Banks, {n} Performances")

        # 7. Optional: Performance laden (zerstört das aktuelle Setup!)
        if LOAD_PERF and n:
            b = perfbanks[0]
            p = b["patches"][0]
            await send({"type": "loadPerf", "bank": b["bank"], "slot": p["slot"]})
            st = await expect(ws, "patchState", timeout=30)
            got = st.get("perfSettings", {}).get("name", "")
            print(f"loadPerf {b['bank']}/{p['slot']} ('{p['name']}') -> "
                  f"patchState mit Perf '{got}'")
            assert got.strip().lower() == p["name"].strip().lower(), (got, p["name"])

        print("PASS")


asyncio.run(main())
