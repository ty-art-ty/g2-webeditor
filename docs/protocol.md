# g2web JSON-Protokoll (v0)

Transport: WebSocket `/ws` (Echtzeit) + REST `/api/*` (Anfrage/Antwort).
TypeScript-Spiegel: `frontend/src/protocol.ts` — beide synchron halten.

## REST

| Endpoint | Methode | Beschreibung |
|---|---|---|
| `/api/status` | GET | `{connected: bool, service: string}` |
| `/api/patch` | GET | aktueller Patch-State (siehe unten) |
| `/api/banks` | GET | `[{bank, patches: [{slot, name}]}]` |
| `/api/patch/load` | POST | Body `{bank, slot}` → 202; neuer State kommt via WS |

## WebSocket Server → Client

```jsonc
// Vollständiger Patch-State (bei Connect und nach Patch-Wechsel)
{ "type": "patchState", "connected": true, "perf": "New Performance", "slot": "A",
  "name": "...", "variation": 0,
  "modules": [ { "id": 1, "area": "va", "typeName": "OscB", "name": "Osc1",
                 "row": 0, "col": 0, "color": 0,
                 "params": [ { "id": 0, "name": "Freq Coarse", "value": 64, "min": 0, "max": 127 } ] } ],
  "cables":  [ { "area": "va", "from": {"module":1,"conn":0},
                 "to": {"module":2,"conn":0}, "fromOutput": true, "color": "red" } ] }
// fromOutput=true: from-conn ist ein Output; false: In-zu-In-Kabel.
// to ist immer ein Input. conn indiziert die outputs- bzw. inputs-Liste
// des Modultyps (frontend/public/module-defs.json, generiert via
// scripts/gen-module-defs.py aus g2fx).

// Einzelne Param-Änderung (auch von anderen Clients oder vom G2-Panel selbst)
{ "type": "paramChanged", "slot": "A", "area": "va", "module": 1, "param": 0,
  "value": 72, "variation": 0 }

{ "type": "variationChanged", "variation": 2, "slot": "A" }

// Modul wurde verschoben (von irgendeinem Client; Server hat ans Gerät gesendet)
{ "type": "moduleMoved", "area": "va", "module": 1, "col": 3, "row": 7 }

// G2 per USB verbunden/getrennt
{ "type": "connection", "connected": true }
```

**Hinweis:** Modul-IDs sind nur *pro Area* eindeutig — `area` ("va"/"fx") gehört
daher in alle modulbezogenen Messages. Fehlt es bei `setParam`, nimmt der Server "va".

## WebSocket Client → Server

```jsonc
{ "type": "setParam", "area": "va", "module": 1, "param": 0, "value": 72, "variation": 0 }
{ "type": "selectVariation", "variation": 2 }
{ "type": "moveModule", "area": "va", "module": 1, "col": 3, "row": 7 }
```

**moveModule** (v1, erster Mutations-Befehl): Wire-Format am G2 ist
`S_MOV_MODULE` 0x34 als Slot-Request `[01, 0x28+slot, version, 34, location, index, col, row]`
mit location FX=0/VA=1 (Quelle: BVerhue `BVE.NMG2Mess.pas`, G2-Edit `usbComms.c`).

## Geplante Erweiterungen (v1, Phase 4)

`addModule`, `deleteModule`, `addCable`, `deleteCable`, `setMorph`,
`patchSettings`, Slot-Handling (A–D), Performance-Mode. Konvention: Client-Mutationen
werden vom Server validiert, an den G2 geschickt und erst nach Bestätigung an alle
Clients gebroadcastet (Server = Single Source of Truth).
