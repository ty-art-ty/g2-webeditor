#!/usr/bin/env python3
"""Test für Phase 4b Teil 17: .pch2-Import in den aktiven Slot.

Round-Trip-Beweis, dass der Import den Dateiinhalt wirklich aufs Gerät lädt:
  1. patchState holen, ein Param des aktiven Slots merken (Wert v0).
  2. den aktuellen Patch exportieren (GET /api/patch/export) — diese Datei
     trägt v0.
  3. denselben Param auf v1 != v0 setzen (setParam) und das paramChanged
     abwarten.
  4. die in Schritt 2 exportierte .pch2 importieren (POST /api/patch/import).
  5. der danach gebroadcastete patchState muss den Param wieder auf v0 zeigen.

Das Gerät endet im Ausgangszustand (v0). Benötigt python3-websockets.
Usage: ws-import-test.py [host]
"""
import asyncio
import json
import sys
import urllib.request

HOST = sys.argv[1] if len(sys.argv) > 1 else "localhost"
BASE = f"http://{HOST}:8080"
URL = f"ws://{HOST}:8080/ws"


def http(path, data=None, method=None):
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/octet-stream")
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status, r.read()


async def expect(ws, msg_type, pred=lambda m: True, timeout=20):
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout))
        if msg.get("type") == msg_type and pred(msg):
            return msg


async def main():
    import websockets
    async with websockets.connect(URL) as ws:
        state = await expect(ws, "patchState")
        slot = state.get("slot")
        var = state.get("variation", 0)
        mod = next((m for m in state["modules"]
                    if m["area"] == "va" and m.get("params")), None)
        assert mod, "kein VA-Modul mit Params im aktiven Slot"
        param = mod["params"][0]
        v0 = param["value"]
        lo, hi = param.get("min", 0), param.get("max", 127)
        v1 = lo if v0 != lo else hi
        assert v1 != v0, f"Param ohne Spielraum (v0={v0}, min={lo}, max={hi})"
        print(f"Slot {slot}, Modul {mod['id']} '{mod.get('name')}', "
              f"Param {param['id']} '{param.get('name')}' = {v0} (Ziel-Toggle {v1})")

        # 2. aktuellen Patch (mit v0) exportieren
        st, data = http("/api/patch/export")
        assert st == 200 and len(data) > 100, (st, len(data))
        print(f"export ok ({len(data)} Byte)")

        # 3. Param auf v1 setzen
        await ws.send(json.dumps({"type": "setParam", "area": "va",
                                  "module": mod["id"], "param": param["id"],
                                  "value": v1, "variation": var}))
        await expect(ws, "paramChanged", lambda m: m["area"] == "va"
                     and m["module"] == mod["id"] and m["param"] == param["id"]
                     and m["value"] == v1)
        print(f"setParam -> {v1} ok")

        # 4. die exportierte Datei (v0) importieren
        st, _ = http("/api/patch/import", data=data, method="POST")
        assert st == 202, f"import status {st}"

        # 5. neuer patchState muss den Param wieder auf v0 zeigen
        st2 = await expect(ws, "patchState", timeout=30)
        m2 = next((m for m in st2["modules"] if m["area"] == "va"
                   and m["id"] == mod["id"]), None)
        assert m2, "Modul nach Import nicht im patchState"
        p2 = next((p for p in m2["params"] if p["id"] == param["id"]), None)
        assert p2 and p2["value"] == v0, \
            f"Param nach Import {p2 and p2['value']} != Original {v0}"
        print(f"import -> patchState Param zurück auf {v0} ok")

        # Negativtest: kaputte Datei -> 400
        try:
            http("/api/patch/import", data=b"not a pch2 file" * 8, method="POST")
            print("WARN: ungültige Datei nicht abgelehnt")
        except urllib.error.HTTPError as e:
            print(f"ungültige Datei -> {e.code} ok")

        print("PASS")


asyncio.run(main())
