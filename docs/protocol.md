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
| `/api/patch/export` | GET | aktiver Slot als Clavia-`.pch2` (Datei-Download); ohne G2 → 503 |
| `/api/perf/export` | GET | Performance als Clavia-`.prf2` (Datei-Download); ohne G2 → 503 |
| `/api/patch/import` | POST | Roh-`.pch2` im Body → in den aktiven Slot laden; 202, neuer patchState via WS. Ungültige Datei → 400, ohne G2 → 503 |

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

// Kabel angelegt/gelöscht (Identität = area + from + to; Farbe bestimmt der Server)
{ "type": "cableAdded", "area": "va", "from": {"module":1,"conn":0},
  "to": {"module":2,"conn":0}, "fromOutput": true, "color": "red" }
{ "type": "cableDeleted", "area": "va", "from": {"module":1,"conn":0},
  "to": {"module":2,"conn":0} }

// Modul angelegt (module = vollständiges Objekt wie im patchState) / gelöscht.
// Beim Löschen kommen vorab cableDeleted-Events für alle hängenden Kabel.
{ "type": "moduleAdded", "module": { "id": 33, "area": "va", "typeName": "OscB",
  "name": "OscB1", "row": 35, "col": 0, "color": 0, "params": [ /* … */ ] } }
{ "type": "moduleDeleted", "area": "va", "module": 33 }

{ "type": "moduleRenamed", "area": "va", "module": 1, "name": "Osc1" }
{ "type": "moduleColorChanged", "area": "va", "module": 1, "color": 10 }

// G2 per USB verbunden/getrennt
{ "type": "connection", "connected": true }

// Performance-Settings geändert (von Clients oder vom Gerät, z.B. Clock).
// Gleiche Struktur steckt als "perfSettings" im patchState. keyboard darf auf
// mehreren Slots an sein (= Layer); keyFrom/keyTo greifen nur bei
// keyboardRangeEnabled (MIDI-Noten 0–127).
{ "type": "perfSettingsChanged", "name": "MyPerf",
  "clockBpm": 120, "clockRun": false, "keyboardRangeEnabled": false,
  "slots": [ { "slot": "A", "enabled": true, "keyboard": true, "hold": false,
               "keyFrom": 0, "keyTo": 127 } /* …B,C,D */ ] }

// Global-Knob-Zuweisungen geändert (gebündelt; volle Liste). Gleiche Struktur
// steckt als "globalKnobs" im patchState. slot ist der Slot-BUCHSTABE;
// moduleName/paramName löst der Server auf (Clients haben nur den aktiven
// Slot im State). knob 0–119 = Seite 1–5 × Reihe A–C × Knob 1–8 ("2B5").
{ "type": "globalKnobsChanged", "knobs": [ { "knob": 0, "slot": "A",
  "area": "va", "module": 1, "param": 0, "led": false,
  "moduleName": "Osc1", "paramName": "FreqCoarse" } ] }

// Bank-Inhalte geändert (z.B. nach storePerf): /api/banks + /api/perfbanks
// neu laden. Kommt auch einmal beim Connect (initialer Bank-Snapshot).
{ "type": "banksChanged" }

// LED-/VU-Daten (G2 streamt 0x39/0x3a; Server bündelt und flusht ~alle 33 ms,
// nur GEÄNDERTE Werte — letzter Wert pro Visual gewinnt). Einträge sind
// [area, module, g, value]; g = GroupId der Led/MiniVU-Controls in
// module-defs.json (= Visual-Index in g2lib).
//   leds   = Einzel-LEDs (value 0/1, Wire-Message 0x39)
//   meters = VU-Meter (Pegelstufe) und LED-Gruppen/Sequencer (Radio-Wert;
//            eine Gruppen-LED ist an, wenn value == ihr CodeRef) — 0x3a
{ "type": "visuals", "slot": "A",
  "leds":   [ ["va", 1, 0, 1] ],
  "meters": [ ["va", 2, 0, 7], ["va", 5, 0, 12] ] }
```

**Hinweis:** Modul-IDs sind nur *pro Area* eindeutig — `area` ("va"/"fx") gehört
daher in alle modulbezogenen Messages. Fehlt es bei `setParam`, nimmt der Server "va".

## WebSocket Client → Server

```jsonc
{ "type": "setParam", "area": "va", "module": 1, "param": 0, "value": 72, "variation": 0 }
{ "type": "selectVariation", "variation": 2 }
{ "type": "moveModule", "area": "va", "module": 1, "col": 3, "row": 7 }
{ "type": "addCable", "area": "va", "from": {"module":1,"conn":0},
  "to": {"module":2,"conn":0}, "fromOutput": true }
{ "type": "deleteCable", "area": "va", "from": {"module":1,"conn":0},
  "to": {"module":2,"conn":0}, "fromOutput": true }
{ "type": "addModule", "area": "va", "typeName": "OscB", "col": 0, "row": 35 }
{ "type": "copyModule", "area": "va", "module": 33, "col": 0, "row": 40 }
{ "type": "deleteModule", "area": "va", "module": 33 }
{ "type": "renameModule", "area": "va", "module": 1, "name": "Osc1" }
{ "type": "setModuleColor", "area": "va", "module": 1, "color": 10 }
{ "type": "undo" }
{ "type": "redo" }

// Performance-Mode (Teil 14). Perf-Settings-Änderungen sind NICHT im
// Undo-Verlauf (wie setParam). Antworten kommen als perfSettingsChanged,
// loadPerf antwortet mit komplettem patchState (alle 4 Slots neu!).
{ "type": "loadPerf", "bank": 1, "slot": 2 }            // 1-indexiert
{ "type": "setMasterClock", "bpm": 120 }                // 30–240
{ "type": "setClockRun", "run": true }
{ "type": "setKeyboardRangeEnabled", "enabled": true }
{ "type": "setPerfSlotSetting", "slot": 1, "key": "enabled", "value": 1 }
   // key: enabled|keyboard|hold (0/1) | keyFrom|keyTo (MIDI-Note 0–127)
{ "type": "renamePerf", "name": "MyPerf" }

// Teil 15: Perf-Store + Global Knobs. storePerf speichert die aktuelle
// Performance (unter ihrem Namen) in einen Perf-Bank-Platz — 1-indexiert,
// überschreibt belegte Plätze; Bestätigung = banksChanged. Global Knobs:
// knob 0–119 (= Seite 1–5 × Reihe A–C × Knob 1–8), slot 0–3; Zuweisung
// überschreibt belegte Knobs; Bestätigung = globalKnobsChanged.
{ "type": "storePerf", "bank": 1, "slot": 2 }
{ "type": "assignGlobalKnob", "knob": 0, "slot": 0, "area": "va",
  "module": 1, "param": 0 }
{ "type": "deassignGlobalKnob", "knob": 0 }
```

**Performance-Mode** (v1, Teil 14): Wire-Formate (BVerhue `BVE.NMG2Mess.pas`):
Master-Clock `[01,2c,ver, 3f, ff, 01, bpm]` bzw. `[…, 00, run]`; Perf-Name
`[01,2c,ver, 29, name als Clavia-String]`; Slot-Settings als komplette
Section 0x11 `[01,2c,ver, 11, len, payload]` (g2lib `Sections.writeSection`
über die gerätegelesenen FieldValues — Unknown-Felder bleiben byte-treu);
Perf-Load über `loadEntry` mit slotCode 4 (`S_PERF_04`) — Antwort ist
LOAD_PERF, der Server baut die Performance neu auf und broadcastet patchState.
REST: `GET /api/perfbanks` (Format wie /api/banks), `POST /api/perf/load`.

**storePerf / Global Knobs** (v1, Teil 15): Store als System-Request
`O_STORE_ENTRY` 0x0b `[01,2c,41, 0b, slotCode, bank, entry]` — Gegenstück zu
loadEntry (slotCode 4 = Performance); das Gerät bestätigt mit einer
Entry-List-Message (Store-Response-Flag in g2lib `dispatchEntryList`), die den
Bank-Snapshot aktualisiert → `banksChanged`. REST: `POST /api/perf/store`.
Global Knobs (verifiziert gegen BVerhue „G2 USB Messages“-Referenz, Stand
8-11-2011): Zuweisen `S_ASS_GLOBAL_KNOB` 0x1c als Slot-Request des ZIEL-Slots
`[01, 28+slot, slotVersion, 1c, loc, module, param, 00, knob]` (Beispiel
`00 0f 01 28 00 1c 00 01 07 00 07 1e 00 00 94`); `loc` trägt die 2-Bit-Location
FX=0/VA=1 in Bit 2-3 (= `ordinal<<2`), zwischen `param` und `knob` steht ein
vom Gerät ignoriertes 0x00-Byte. Lösen `S_DEASS_GLOB_KNOB` 0x1d
`[…, 1d, 00, knob]` (Beispiel `00 0a 01 28 00 1d 00 07 3e ec`) — ebenfalls mit
0x00-Byte vor `knob`. BVerhue hängt optional noch `1e <page>` (Select Global
Page, reine UI-Anzeige) an; das senden wir nicht. Nach jedem Schreiben fordert
der Server die Liste neu an (`O_GLOBAL_KNOBS` 0x5e, Antwort Section 0x5f, Code
`I_GLOBAL_KNOB_ASSIGMENTS`) — die 120 LibProperty-Listener bündeln das Echo zu
EINEM `globalKnobsChanged`. (Das 0x1c/0x1d-Geräte-Echo ist nur ein `ok`, daher
das explizite Neuanfordern.)

**Export** (v1, Teil 16): Kein neues Wire-Format — der Server serialisiert den
aktuellen Zustand über g2lib `Patch.writeFile()` (`.pch2`) bzw.
`Performance.writeFile()` (`.prf2`) und liefert ihn als Datei-Download
(`/api/patch/export`, `/api/perf/export`, Dateiname = Patch-/Perf-Name). Format:
Clavia-Textheader (`Version=Nord Modular G2 File Format 1\r\nType=Patch|Performance
\r\nVersion=23\r\nInfo=BUILD 320\r\n\0`, auf 80 bzw. 86 Byte genullt), dann
`0x17 <version>`, die File-Sektionen (Patch: `FILE_SECTIONS`; Perf: PerfSettings
+ 4 Slot-Patches je `FILE_VARIATIONS` + Global Knobs) und 2 Byte CRC16/CCITT
(Init 0x0000, big-endian) über alles ab Offset hinter dem Header.

**Import** (v1, Teil 17): `POST /api/patch/import` mit Roh-`.pch2` im Body lädt
die Datei in den AKTIVEN Slot. Server schreibt die Bytes in eine Temp-Datei und
ruft g2lib `Performance.readPatchFromFile(slot, path)` — das prüft Header+CRC
(Fehler → 400), ersetzt das Slot-Patch-Objekt und schickt es per
`Patch.sendPatch()` (Bulk) ans Gerät. Da das g2lib-loadPatch-Lifecycle dabei
NICHT feuert, hängt der Server die Patch-Listener selbst neu an, verwirft den
Undo-Verlauf und broadcastet den frischen `patchState`. Der `.prf2`-Import
(ganze Performance) ist noch offen (eigener Teil).

**undo/redo** (v1): Serverseitiger Verlauf (max 100 Einträge, ein Stack für alle
Clients) über alle Mutationen: moveModule (inkl. Kollisions-Pushes), addModule,
deleteModule (stellt Modul samt Kabeln/Farben wieder her), add/deleteCable
(Farbe bleibt erhalten), renameModule, setModuleColor. Die Wirkung kommt als
normale Broadcasts; leerer Verlauf = no-op; Patch-Wechsel verwirft den Verlauf.
Neue Aktionen leeren den Redo-Stack.

**moveModule** (v1, erster Mutations-Befehl): Wire-Format am G2 ist
`S_MOV_MODULE` 0x34 als Slot-Request `[01, 0x28+slot, version, 34, location, index, col, row]`
mit location FX=0/VA=1 (Quelle: BVerhue `BVE.NMG2Mess.pas`, G2-Edit `usbComms.c`).

**addModule/deleteModule** (v1): `typeName` = shortName aus module-defs.json.
Index (max+1 pro Area) und Name (typeName + laufende Nr.) vergibt der Server.
Add läuft über g2lib `PatchArea.createModules` (komplette Message wie die
Referenz-Editoren: `S_ADD_MODULE` 0x30 `[30, typeId, loc, index, col, row, 0,
uprate, isLed, modes…, name]` + Cable-/Param-/Label-/Name-Sektionen mit
Default-Werten für 10 Variationen). Delete löscht erst alle hängenden Kabel
(je ein cableDeleted), dann `S_DEL_MODULE` 0x32 `[32, loc, index]`.

**copyModule** (v1): dupliziert ein Modul mit Parametern aller 10 Variationen
(tiefe Kopie!), Farbe, Name und Custom-Labels; neuen Index vergibt der Server,
Antwort = `moduleAdded`, Kollisionen wie addModule, Undo = Löschen.

**Param-Texte & Modes** (v1, Teil 11): Modul-Params tragen `text`
(serverseitig formatierter Anzeigewert via g2lib ModParam enums/Formatter) in
patchState und paramChanged. Module tragen `modes:[{id,name,value,min,max,
enums?}]` (statische Modul-Params, EINE Wertemenge für alle Variationen).
`setMode {area,module,mode,value}` setzt einen Mode (Wire: S_SET_MODE 0x2b via
g2lib UserModuleData), Antwort = `modeChanged {area,module,mode,value,slot}`.
setParam akzeptiert area "settings" (Patch-Settings = Pseudo-Module der
Location 2; S_SET_PARAM 0x40 mit location=2). `setMorph {area,module,param,
morph,range,variation}` (range -128…127, 0 = Zuweisung löschen; Wire:
S_SET_MORPH_RANGE 0x43 [loc,module,param,morph,|range|,neg,variation]) ist im
Undo-Verlauf, Antwort = `morphChanged`; patchState trägt `settings` (Gain/
Glide/Bend/Vibrato/Arpeggiator/Misc) und `morphs` (8 Gruppen: dial/mode/label/
assigns) — UI dafür folgt.

**undoState** (v1): Broadcast nach jeder Verlaufs-Änderung (Mutation, undo,
redo, Slot-/Patch-Wechsel): `{undoDepth, redoDepth, undoLabel?, redoLabel?}` —
Labels sind die internen Aktionsnamen (addModule, copySelection, …). Derselbe
Datensatz steckt als `undo{}` im patchState, damit frische Clients die
Buttons korrekt zeigen.

**selectSlot** (v1): `{slot: 0–3}` wechselt den aktiven Slot A–D. Wire-Format
als Perf-Request (CMD_REQ+CMD_SYS = 0x2c, BVerhue `CreateSelectSlotMessage`):
`[01, 2c, perfVersion, 09, slot]`. Antwort = kompletter `patchState` des neuen
Slots; der Undo-Verlauf wird verworfen (gehört zum alten Slot). Slot-Wechsel am
Gerät (Panel) kommen als `I_CHANGE_SLOT` 0x09 herein und broadcasten denselben
patchState. `patchState` trägt dafür jetzt `slots: [{slot:"A", name}, …]` (alle
4 Slots mit Patch-Namen) zusätzlich zum aktiven `slot`. paramChanged/
variationChanged tragen den Slot-Namen — Clients müssen Events fremder Slots
ignorieren (die Listener hängen auf allen vier).

**moveModules/deleteModules/copySelection** (v1, Multi-Select): wirken auf eine
Selektion EINER Area und bilden je EINEN Undo-Eintrag.
`moveModules {area, moves:[{module,col,row}]}` verschiebt die Selektion als
starren Block; `deleteModules {area, modules:[…]}` löscht sie (Undo restauriert
Module UND alle Kabel, auch die internen); `copySelection {area, modules:[…],
dCol, dRow}` dupliziert sie versetzt um (dCol,dRow) mit tiefer Param-Kopie wie
copyModule und kopiert interne Kabel (beide Enden in der Selektion, Farbe
erhalten) auf die neuen Indizes mit. Antworten sind die normalen Broadcasts
(moduleMoved/moduleAdded/cableAdded/…); copySelection schließt mit
`selectionCopied {area, modules:[neue Indizes]}` ab, damit Clients die frischen
Kopien auswählen können. Kollisionsregel für Selektionen: anders als beim
Einzel-Move weicht NICHT die Selektion aus (der Block bliebe sonst nicht starr) —
überlappende Bestands-Module rutschen unter den Block und kaskadieren.

**renameModule/setModuleColor** (v1): Name max 16 ASCII-Zeichen.
Wire-Formate: `S_SET_MODULE_LABEL` 0x33 `[33, loc, index, name\0]`,
`S_SET_MODULE_COLOR` 0x31 `[31, loc, index, color]` (color 0–24).

**Kollisionen**: moveModule/addModule lösen Überlappungen serverseitig auf
(Algorithmus wie g2gui `MoveableModule.resolveCollisions`, nur Spalte des
bewegten/neuen Moduls): verdrängte Module kaskadieren nach unten, je ein
eigenes `moduleMoved`-Broadcast (+ S_MOV_MODULE ans Gerät).

**addCable/deleteCable** (v1): `to` ist immer ein Input; `fromOutput=false` = In-zu-In-Kabel.
Die Kabelfarbe bestimmt der Server aus dem Quell-Connector (g2lib ModuleType-Ports,
ohne Uprate-Logik: Red/Blue_red→rot, Blue→blau, Yellow/Yellow_orange→gelb).
addCable ist idempotent (existierendes Kabel → kein Broadcast). Wire-Formate als
Slot-Request (Quellen wie oben):
`S_ADD_CABLE` 0x50 `[…, 50, 10|loc<<3|farbe, fromMod, fromKind<<6|fromConn, toMod, toConn]`,
`S_DEL_CABLE` 0x51 `[…, 51, 02|loc, fromMod, fromKind<<6|fromConn, toMod, toKind<<6|toConn]`,
Kind Input=0/Output=1, location FX=0/VA=1.

## Geplante Erweiterungen (v1, Phase 4)

`setMorph`, `patchSettings`, Slot-Handling (A–D), Performance-Mode,
Modul-Rename/-Farbe. Konvention: Client-Mutationen
werden vom Server validiert, an den G2 geschickt und erst nach Bestätigung an alle
Clients gebroadcastet (Server = Single Source of Truth).
