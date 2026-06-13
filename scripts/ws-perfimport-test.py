#!/usr/bin/env python3
"""Test für Phase 4b Teil 18: .prf2-Import (ganze Performance).

Round-Trip-Beweis, dass der Import die komplette Performance aufs Gerät lädt:
  1. patchState holen, Perf-Name (n0) und einen Param des aktiven Slots (v0)
     merken.
  2. die aktuelle Performance exportieren (GET /api/perf/export) — trägt n0+v0.
  3. Perf umbenennen (renamePerf) und den Param auf v1 != v0 setzen.
  4. die in Schritt 2 exportierte .prf2 importieren (POST /api/perf/import).
  5. der danach gebroadcastete patchState muss Perf-Name = n0 UND Param = v0
     zeigen.

Das Gerät endet im Ausgangszustand. Benötigt python3-websockets.
Usage: ws-perfimport-test.py [host]
"""
import asyncio
import json
import sys
import urllib.request
import urllib.error

HOST = sys.argv[1] if len(sys.argv) > 1 else "localhost"
BASE = f"http://{HOST}:8080"
URL = f"ws://{HOST}:8080/ws"


def http(path, data=None, method=None, headers=None):
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/octet-stream")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status, r.read()


async def expect(ws, msg_type, pred=lambda m: True, timeout=30):
    while True:
        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout))
        if msg.get("type") == msg_type and pred(msg):
            return msg


async def main():
    import websockets
    async with websockets.connect(URL) as ws:
        state = await expect(ws, "patchState")
        n0 = state.get("perf")
        var = state.get("variation", 0)
        mod = next((m for m in state["modules"]
                    if m["area"] == "va" and m.get("params")), None)
        assert mod, "kein VA-Modul mit Params im aktiven Slot"
        param = mod["params"][0]
        v0 = param["value"]
        lo, hi = param.get("min", 0), param.get("max", 127)
        v1 = lo if v0 != lo else hi
        assert v1 != v0, f"Param ohne Spielraum (v0={v0})"
        n1 = ("Imp_" + (n0 or "X"))[:16]
        assert n1 != n0
        print(f"Perf '{n0}', Modul {mod['id']} '{mod.get('name')}' "
              f"Param '{param.get('name')}' = {v0} (Toggle {v1}, Rename '{n1}')")

        # 2. Performance exportieren (trägt n0 + v0)
        st, data = http("/api/perf/export")
        assert st == 200 and len(data) > 1000, (st, len(data))
        print(f"export ok ({len(data)} Byte)")

        # 3. Perf umbenennen + Param ändern
        await ws.send(json.dumps({"type": "renamePerf", "name": n1}))
        await expect(ws, "perfSettingsChanged", lambda m: m.get("name") == n1)
        await ws.send(json.dumps({"type": "setParam", "area": "va",
                                  "module": mod["id"], "param": param["id"],
                                  "value": v1, "variation": var}))
        await expect(ws, "paramChanged", lambda m: m["module"] == mod["id"]
                     and m["param"] == param["id"] and m["value"] == v1)
        print(f"renamePerf '{n1}' + setParam {v1} ok")

        # 4. exportierte .prf2 (n0 + v0) importieren; Dateiname (= Perf-Name)
        #    mitschicken, sonst leitet g2lib den Namen aus der Temp-Datei ab
        st, _ = http("/api/perf/import", data=data, method="POST",
                     headers={"X-Filename": (n0 or "Performance") + ".prf2"})
        assert st == 202, f"import status {st}"

        # 5. neuer patchState: Perf-Name zurück auf n0, Param zurück auf v0
        st2 = await expect(ws, "patchState", lambda m: m.get("perf") == n0, timeout=40)
        m2 = next((m for m in st2["modules"] if m["area"] == "va"
                   and m["id"] == mod["id"]), None)
        assert m2, "Modul nach Import nicht im patchState"
        p2 = next((p for p in m2["params"] if p["id"] == param["id"]), None)
        assert p2 and p2["value"] == v0, \
            f"Param nach Import {p2 and p2['value']} != Original {v0}"
        print(f"import -> Perf '{st2.get('perf')}', Param zurück auf {v0} ok")

        # Negativtest: kaputte Datei -> 400
        try:
            http("/api/perf/import", data=b"not a prf2 file" * 8, method="POST")
            print("WARN: ungültige Datei nicht abgelehnt")
        except urllib.error.HTTPError as e:
            print(f"ungültige Datei -> {e.code} ok")

        print("PASS")


asyncio.run(main())
