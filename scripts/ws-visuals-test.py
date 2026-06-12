#!/usr/bin/env python3
"""Test für Phase 4b Teil 13: LED/VU-Streaming ("visuals"-Broadcasts).

Passiv: Sammelt N Sekunden visuals-Messages und prüft Struktur + dass die
referenzierten Module/GroupIds zum patchState passen. Ob überhaupt Daten
kommen, hängt vom Patch ab (Clock/Sequencer -> LEDs blinken; Audio anspielen
für VU-Ausschlag). Aktiv (Default): legt zusätzlich einen LfoC an — dessen
Monitor-LED (Einzel-LED, GroupId 0) blinkt frei laufend, damit der Test auch
in stillen Patches grün wird (Aufräumen stellt den Ausgangszustand her).

Benötigt python3-websockets.
Usage: ws-visuals-test.py [host] [sekunden] [--passive]
"""
import asyncio
import json
import sys
import time
import urllib.request

args = [a for a in sys.argv[1:] if not a.startswith("--")]
HOST = args[0] if len(args) > 0 else "localhost"
SECS = float(args[1]) if len(args) > 1 else 8.0
PASSIVE = "--passive" in sys.argv
URL = f"ws://{HOST}:8080/ws"


def fetch_patch():
    with urllib.request.urlopen(f"http://{HOST}:8080/api/patch", timeout=10) as r:
        return json.load(r)


async def expect(ws, msg_type, pred=lambda m: True, timeout=10):
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout))
        if msg.get("type") == msg_type and pred(msg):
            return msg


async def main():
    import websockets
    async with websockets.connect(URL) as ws:
        state = json.loads(await asyncio.wait_for(ws.recv(), 10))
        assert state["type"] == "patchState", state
        mods = {(m["area"], m["id"]): m["typeName"] for m in state["modules"]}
        print(f"Patch '{state['name']}' (Slot {state['slot']}), {len(mods)} Module")

        def send(obj):
            return ws.send(json.dumps(obj))

        clk = None
        if not PASSIVE:
            # LfoC anlegen: Monitor-LED (Einzel-LED, GroupId 0) blinkt frei laufend
            row = max((m["row"] for m in state["modules"] if m["area"] == "va"),
                      default=0) + 10
            await send({"type": "addModule", "area": "va",
                        "typeName": "LfoC", "col": 0, "row": row})
            added = await expect(ws, "moduleAdded",
                                 lambda m: m["module"]["typeName"] == "LfoC")
            clk = added["module"]["id"]
            mods[("va", clk)] = "LfoC"
            print(f"LfoC angelegt: va/{clk}")

        # N Sekunden visuals sammeln und validieren
        n_msgs = n_leds = n_meters = 0
        seen = {}
        clk_led_values = set()
        deadline = time.monotonic() + SECS
        while time.monotonic() < deadline:
            try:
                msg = json.loads(await asyncio.wait_for(
                    ws.recv(), max(0.1, deadline - time.monotonic())))
            except asyncio.TimeoutError:
                break
            if msg.get("type") != "visuals":
                continue
            n_msgs += 1
            assert msg.get("slot") == state["slot"], msg
            for kind in ("leds", "meters"):
                for area, module, g, value in msg[kind]:
                    assert (area, module) in mods, f"{kind}: unbekanntes Modul {area}/{module}"
                    assert isinstance(g, int) and isinstance(value, int), msg
                    seen[(kind, area, module, g)] = value
                    if kind == "leds":
                        n_leds += 1
                        if module == clk and area == "va" and g == 0:
                            clk_led_values.add(value)
                    else:
                        n_meters += 1

        print(f"{n_msgs} visuals-Messages in {SECS:.0f}s: "
              f"{n_leds} LED- und {n_meters} Meter-Updates, "
              f"{len(seen)} verschiedene Visuals")
        for (kind, area, module, g), v in sorted(seen.items())[:12]:
            print(f"  {kind}: {area}/{module} ({mods[(area, module)]}) g={g} -> {v}")

        if clk is not None:
            # Aufräumen: LfoC wieder löschen (Patch unverändert)
            await send({"type": "deleteModule", "area": "va", "module": clk})
            await expect(ws, "moduleDeleted", lambda m: m["module"] == clk)
            print("LfoC wieder gelöscht")
            assert clk_led_values >= {0, 1}, \
                f"LfoC-Monitor-LED hat nicht geblinkt: {clk_led_values}"
            print("OK: LfoC-Monitor-LED blinkt (0 und 1 gesehen)")
        elif n_msgs == 0:
            print("WARNUNG: keine visuals-Daten — Patch ohne aktive LEDs/Meter?")

        print("PASS")


asyncio.run(main())
