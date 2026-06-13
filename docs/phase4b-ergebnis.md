# Phase 4b — Ergebnis Teil 15: Global Knobs + Perf-Store (2026-06-13)

**Status: ✅ Global Knobs (assign/deassign) + Perf-Store + loadPerf am echten
G2 verifiziert.** Deploy + `ws-perf15-test.py` liefen über den
Mac/Desktop-Commander-Pfad (Pi aus der Sandbox nicht erreichbar, s. Memory
`g2-pi-zugriff`).

## Verifiziert am echten G2 (ws-perf15-test.py, Patch im Slot, leere Perf-Bänke)

- `assignGlobalKnob 1A1 → Clock·Rate` (Modul-/Param-Name serverseitig
  aufgelöst), Broadcast `globalKnobsChanged` mit der Zuweisung; `deassignGlobalKnob`
  räumt sie wieder ab — beide Wire-Formate (0x1c/0x1d inkl. der 0x00-Bytes und
  `location<<2`) vom Gerät akzeptiert.
- `storePerf → Bank 1 Platz 1 ('New Performance')`: Store-Response aktualisiert
  den Bank-Snapshot, Eintrag taucht in `/api/perfbanks` auf (`banksChanged`).
- `loadPerf 1/1 → patchState mit Perf 'New Performance'` — damit ist der seit
  Teil 14 offene loadPerf-Punkt erledigt (vorher hatte das Gerät 0 gespeicherte
  Performances; nach storePerf jetzt testbar). **PASS.**
- Hinweis: Der Test hinterlässt einen Eintrag „New Performance" in Perf-Bank 1
  Platz 1 (kein Lösch-Kommando implementiert) — bei Bedarf am G2-Panel löschen.
- Backend-Compile gegen Java 25 auf dem Pi: `BUILD SUCCESSFUL` (compileJava grün);
  Service nach Deploy `active`, HTTP 200.

## Vorab statisch verifiziert (vor dem Deploy, ohne Hardware)

- **Wire-Format der Global-Knob-Messages gegen die maßgebliche BVerhue-Referenz
  „G2 USB Messages" (Stand 8-11-2011) geprüft — und ZWEI Fehler im zuvor
  geratenen Code gefunden und korrigiert:**
  1. Assign 0x1c: zwischen `param` und `knob` fehlte ein (vom Gerät
     ignoriertes) `00`-Byte. Korrekt: `[…, 1c, loc, module, param, 00, knob]`,
     Beispiel `00 0f 01 28 00 1c 00 01 07 00 07 1e 00 00 94`.
  2. Assign 0x1c: `loc` muss die 2-Bit-Location in Bit 2-3 tragen
     (`ordinal<<2`), nicht ungeschoben. Bestätigt über das 0x25-Beispiel der
     Referenz (locByte `0x40` = L=1 bei MSB-first-Bit-Tabelle).
  3. Deassign 0x1d: auch hier fehlte das `00`-Byte vor `knob`. Korrekt:
     `[…, 1d, 00, knob]`, Beispiel `00 0a 01 28 00 1d 00 07 3e ec`.
  Der optionale `1e <page>`-Anhang (Select Global Page, reine UI-Anzeige)
  wird bewusst weggelassen.
- Alle referenzierten g2lib-Symbole existieren: `Codes.O_STORE_ENTRY` (0x0b),
  `O_GLOBAL_KNOBS` (0x5e), `I_GLOBAL_KNOB_ASSIGMENTS` (0x5f),
  `Performance.getGlobalKnobAssignments().assignments()` (120 LibPropertys),
  `KnobAssignment`/`Location`, `GlobalKnobAssignments.update()`,
  `SettingsModules.IX_LOOKUP`. Lese-Pfad ist verdrahtet:
  `Device` Code 0x5f → `readGlobalKnobAssignments` → `update()` → Listener.
- storePerf ist ein exakter Spiegel des bereits funktionierenden `loadEntry`
  (gleiche Argfolge slot/bank/entry, nur Opcode 0x0b statt 0x0a); die
  Store-Response wird in `dispatchEntryList` (isStoreResponse → `fireRefreshAll`)
  zum `banksChanged`-Broadcast → kein geratenes Wire-Format wie bei den Knobs.
- Frontend-Typecheck `tsc --noEmit` grün (protocol.ts + main.ts).
- Backend-Compile NICHT möglich (Sandbox hat nur Java 11, JDK-25-Download
  blockiert) — Compile-Check passiert wie üblich beim Deploy auf dem Pi.

## Umsetzung

- **Backend**: `G2Service` um `storePerf`/`assignGlobalKnob`/`deassignGlobalKnob`
  erweitert (Mock = In-Memory-Liste). `G2LibService`: Global-Knob-Liste
  serverseitig mit aufgelösten Modul-/Param-Namen (`globalKnobsOf`, auch im
  patchState), nach jeder Zuweisung explizites `O_GLOBAL_KNOBS`-Re-Request;
  die 120 LibProperty-Listener bündeln das 0x5f-Echo per Scheduler (30 ms) zu
  EINEM `globalKnobsChanged`. `Entries.storeEntry` (0x0b). Bank-Snapshot-Listener
  broadcastet jetzt `banksChanged` (auch initial beim Connect).
- **Frontend**: Param-Panel-Zeile „G-Knob" (Select – / 1A1…5C8, belegte Knobs
  markiert), Perf-Panel mit Global-Knob-Liste (Lösen-Button) + „Speichern"
  (Bank/Platz, unter aktuellem Perf-Namen, Überschreib-Confirm). Neue Messages
  in `protocol.ts` gespiegelt.
- **Doku**: `docs/protocol.md` um storePerf + Global-Knob-Wire-Formate ergänzt
  (verifizierte Byte-Layouts, TODO aufgelöst).

## Stolpersteine

- Das geratene Global-Knob-Wire-Format war an zwei Stellen falsch (s.o.) — die
  Lehre aus Teil 14 (vor Deploy gegen Referenz verifizieren) hat sich direkt
  ausgezahlt; ohne die `00`-Bytes wäre `knob` fehlausgerichtet gewesen.
- Das 0x1c/0x1d-Geräte-Echo ist nur ein `ok` (kein neuer Zuweisungs-Stand) →
  ohne das explizite `O_GLOBAL_KNOBS`-Re-Request bliebe das UI stumm.

## Offen (→ Teil 16+)

1. Browser-Check von Param-Panel („G-Knob"-Select) und Perf-Panel
   (Global-Knob-Liste + „Speichern") gegen die Hardware — Backend ist verifiziert,
   die UI-Verdrahtung noch per Hand durchzuklicken.
2. Patch-Persistenz (.pch2/.prf2-Export), restliche GraphFuncs,
   Morph-Mode-Toggle/-Labels.

---

# Phase 4b — Ergebnis Teil 14: Performance-Mode (2026-06-12)

**Status: ✅ Perf-Settings (Master-Clock, Slot-Enable/Keyboard/Hold,
Key-Ranges, Perf-Name) lesen/setzen + Perf-Bank-Browser, am echten G2
verifiziert.** loadPerf implementiert, aber ungetestet (Gerät hat 0
gespeicherte Performances); Browser-Check des neuen Panels steht aus
(Pi ging während der Verifikation offline).

## Verifiziert (Skript auf dem Pi gegen echten G2)

- `scripts/ws-perf-test.py`: patchState trägt `perfSettings` (Name, Clock,
  4 Slots mit enabled/keyboard/hold/keyFrom/keyTo); setMasterClock 120→126→120,
  setClockRun, Slot-B-Hold-Toggle, keyboardRangeEnabled + A.keyFrom 0→36→0,
  renamePerf — jede Änderung broadcastet `perfSettingsChanged`, alle Werte
  am Ende exakt im Ausgangszustand, PASS
- Nebenbefund: `visuals`-Broadcast mit echtem VU-Pegel (va/27 → 9) —
  der offene Punkt „VU-Ausschlag mit echtem Audio“ aus Teil 13 ist damit ✓
- `/api/perfbanks` liefert 0 Banks (Patch-Banks: 3) — das GERÄT hat keine
  gespeicherten Performances; Abruf-Mechanik ist dieselbe wie bei Patches
  (g2lib `readEntries` liest beide EntryTypes). loadPerf daher ungetestet.

## Umsetzung

- **Wire-Formate** (BVerhue `BVE.NMG2Mess.pas`): Master-Clock
  `[01,2c,ver, 3f, ff, 01, bpm]` (Run: `…, 00, run`); Perf-Name
  `[01,2c,ver, 29, Clavia-String]`; Slot-Settings als KOMPLETTE Section 0x11
  über g2lib `Sections.writeSection` mit den gerätegelesenen FieldValues —
  die Unknown-Felder bleiben dadurch byte-treu (Referenz-Editoren schreiben
  ebenfalls immer den ganzen Block). Perf-Load = `loadEntry` mit slotCode 4
  (`S_PERF_04`, BVerhue-Retrieve-Semantik); die Antwort LOAD_PERF baut die
  Performance in g2lib neu auf → Perf-Lifecycle-Listener broadcastet patchState.
- **Backend**: G2Service um getPerfBanks/loadPerf/setMasterClock/setClockRun/
  setKeyboardRangeEnabled/setPerfSlotSetting/renamePerf erweitert (Mock
  mit In-Memory-Settings). Properties werden LOKAL gesetzt (LibProperty sendet
  nicht — bekannte Falle), dann explizit gesendet; die Broadcasts kommen von
  Listenern auf den PerformanceSettings-/SlotSettings-Propertys
  (attachListeners) — damit werden auch GERÄT-initiierte Änderungen
  (eingehende 0x3f-Clock-Messages, g2lib `setMasterClock`) broadcastet.
  LibProperty feuert nur bei Wert-ÄNDERUNG → keine Doppel-Broadcasts.
  Perf-Settings sind NICHT im Undo-Verlauf (wie setParam). patchState trägt
  `perfSettings`.
- **Frontend**: Perf-Panel in der Sidebar (Name editierbar, BPM 30–240 +
  Run, Keyboard-Split-Toggle, Slot-Tabelle On/Kbd/Hold + Range-Inputs mit
  MIDI-Notennamen, disabled solange Split aus); Perf-Bank-Liste unter den
  Patch-Banks (Klick lädt mit Warnhinweis im Tooltip — ersetzt alle 4 Slots).
  `perfSettingsChanged` aktualisiert Panel + Header.

## Stolpersteine

- Test-Skripte dürfen NICHT annehmen, dass die erste WS-Message der
  patchState ist — seit Teil 13 kann sich ein `visuals`-Broadcast
  dazwischenschieben (clients.add passiert vor dem initialen Send).
  ws-perf-test wartet jetzt explizit auf patchState; ältere Skripte bei
  Gelegenheit nachziehen.
- **Regression nach Erstverifikation (vom Nutzer gefunden): Slot-Klick
  wechselte die Ansicht nicht mehr.** Ursache: g2lib
  `Performance.readPerformanceSettings` ERSETZT das PerformanceSettings-
  Objekt bei jedem vom Gerät gesendeten Settings-Block (Echo nach
  Settings-Write/Rename, Perf-Re-Reads) — damit sterben ALLE Property-
  Listener, auch der selectedSlot-Listener mit dem patchState-Broadcast.
  Slot-Wechsel kamen am Gerät an, das UI erfuhr nichts mehr. Fix (vendored
  Patch): `copyFrom` auf PerformanceSettings/SlotSettings — Werte ins
  bestehende Objekt übernehmen, Listener bleiben, Änderungen feuern normal.
  Verifiziert: ws-perf-test → Slot-Wechsel → ws-slot-test, alles grün.
  Lehre: dieselbe Objekt-Ersetzungs-Falle wie FieldValues-Referenzen —
  bei g2lib-Reads immer prüfen, ob Objekte ersetzt statt aktualisiert werden.
- Bonus-UX: Slot-Buchstaben im Perf-Panel sind jetzt klickbar (selectSlot),
  aktiver Slot akzentuiert.

## Offen (→ Teil 15+)

1. loadPerf am Gerät verifizieren (vorher eine Performance am G2 speichern
   oder per Editor anlegen) + Browser-Check des Perf-Panels.
2. Perf speichern (Store) — Entries.saveEntry ist in g2lib noch leer.
3. Global Knobs (g2lib liest sie bereits).
4. Patch-Persistenz (.pch2/.prf2-Export), restliche GraphFuncs,
   Morph-Mode-Toggle/-Labels.

---

# Phase 4b — Ergebnis Teil 13: LED/VU live + Graph-Kurven (2026-06-12)

**Status: ✅ LED-/VU-Streaming (G2 → Browser, neue `visuals`-Message) und
Env-/Filter-Graph-Kurven statt Platzhalter, am echten G2 verifiziert.**

## Verifiziert (Skript + headless Chrome/CDP gegen echten G2, Patch „rrr")

- `scripts/ws-visuals-test.py` (auf dem Pi): visuals-Messages strukturell
  valide (Slot/Area/Modul/GroupId passen zum patchState); frisch angelegter
  LfoC blinkt — Monitor-LED liefert 0 UND 1 über den vollen Pfad
  G2 → 0x39 → g2lib → Listener → Flush → WebSocket; Aufräumen ok, PASS
- Browser-DOM (headless Chrome via CDP, Extension war offline): LfoC-LED
  wechselt sichtbar die Farbe (#1d4d1d/#35e835), 9 VUs à 10 Segmente,
  10 Gruppen-LEDs, 2 Env-Kurven gerendert (EnvADSR exp, EnvMulti); nach
  deleteModule wieder exakt 19 Module — Journal ohne 0x7e/SEVERE
- Nicht explizit gesehen: VU-AUSSCHLAG mit echtem Audio (Patch war still;
  Wert-0-Updates und Wire-Mapping identisch zum LED-Pfad) — beim nächsten
  Spielen am Gerät gegenchecken

## Umsetzung

- **g2lib parst 0x39/0x3a längst** (`PatchVisuals.readLedData/readVolumeData`
  → `PatchVisual`-LibPropertys; Listener feuern nur bei Wert-ÄNDERUNG).
  Vendored-Patches: `PatchVisual` trägt jetzt den Modul-Index (für Broadcasts);
  die ~50ms-Logs auf FINE (Journal-Spam).
- **Backend**: `attachModuleParamListeners` hängt zusätzlich Listener an
  `getLeds()`/`getMetersAndGroups()`; Änderungen landen in einer Map
  (letzter Wert pro Visual gewinnt) und ein Daemon-Ticker flusht alle 33 ms
  EINE `visuals`-Message je Slot: `{leds:[[area,mod,g,value]…],
  meters:[[…]]}` — leds = Einzel-LEDs (0x39), meters = VUs + LED-Gruppen
  (Radio-Wert, 0x3a). **WICHTIG**: Die Wire-Reihenfolge der Visuals folgt dem
  Modulbestand — `updateVisualIndex()` wird jetzt nach JEDEM addModule/
  copyModule/copySelection/restoreModule/deleteModuleInternal aufgerufen
  (g2lib tat das nur beim Patch-Load; sonst verschöbe sich das Mapping —
  dieselbe Falle wie Morph-Gruppen in Teil 12).
- **Generator**: Led exportiert `g` (GroupId = Visual-Index) + `grp`
  (LedGroup/Sequencer), MiniVU `g`, Graph `gf` (GraphFunc) + `deps`
  (positional wie TextField). module-defs.json regeneriert.
- **Frontend**: `visuals`-Handler aktualisiert LEDs/VUs IN-PLACE über
  data-Attribute (`applyVisual`, kein Control-Layer-Rebuild bei 30 Hz);
  Werte liegen zusätzlich in `m.visuals`, damit Rebuilds (paramChanged)
  den Stand behalten. Gruppen-LED an wenn Gruppenwert == CodeRef. VU =
  10 Segmente (7 grün/2 gelb/1 rot, Einheiten 1/1/2/2 wie g2gui VuMeter)
  mit 1 s Peak-Hold. `graphfuncs.ts` portiert g2gui EnvGraphs/Graphs:
  GraphFunc 1 (ADR), 3 (ADSR), 6 (D), 7 (H), 17 (Multi), 23 (ADDSR),
  28 (AHD, nur EnvAHD — Env_ModAHD bleibt wie in g2gui leer) als SVG-Pfade
  (exp/lin/log-Segmente, Shape-Tabellen) + 20 (FltClassic-Frequenzgang,
  cutoff = 440·2^((n−60)/12)); übrige GraphFuncs behalten die
  Platzhalter-Box (wie g2gui).

## Stolpersteine

- **Cowork-Sandbox erreicht weder LAN noch JDK-Mirrors** — Deploy/Tests
  liefen via Desktop-Commander-MCP auf dem Mac. Frontend-`node_modules` aus
  der Sandbox (linux-arm64) sind auf dem Mac unbrauchbar →
  `rm -rf node_modules`, und wegen `NODE_ENV=production` + npm-config
  `omit=dev` explizit `NODE_ENV=development npm install --include=dev`.
- **Headless Chrome (`--headless=new`)**: Seite über `/json/new?url=…`
  blieb leer — erst explizites `Page.navigate` über CDP lädt sie; mDNS
  (.local) im headless-Modus unzuverlässig → IP verwenden.
- Claude-in-Chrome-Extension war nicht verbunden — ein kleines CDP-Skript
  (headless Chrome + Runtime.evaluate) ist ein brauchbarer Ersatz für DOM-Checks.

## Offen (→ Teil 14+)

1. Performance-Mode.
2. VU-Ausschlag mit echtem Audio am Gerät gegenchecken.
3. Restliche GraphFuncs (Wellenformen, Kurven-Shaper, …) nach Bedarf.
4. Patch-Persistenz (.pch2-Export), Morph-Mode-Toggle/-Labels (Backlog Teil 12).

---

# Phase 4b — Ergebnis Teil 12: Morph-/Settings-Panel (2026-06-11)

**Status: ✅ Patch-Settings-Panel (Gain/Glide/Bend/Vibrato/Arpeggiator/Misc +
8 Morph-Gruppen) und Morph-Zuweisung pro Param, am echten G2 verifiziert.**
(Backend dafür entstand in Teil 10.)

## Verifiziert (Skript + Browser gegen echten G2, Patch „HipHop beat box")

- `scripts/ws-morph-test.py`: patchState trägt settings (6 Module) + morphs
  (8 Gruppen mit Labels); setParam(area=settings) GlideSpeed hin/zurück;
  setMorph: zuweisen (M1 +100), Range negativ (-56, Vorzeichen-Kodierung
  value/negative am Wire), auf M3 verschieben, Undo (zurück auf M1/-56) /
  Redo, löschen (range 0) — Ausgangszustand wiederhergestellt
- Browser: leeres Panel zeigt Patch-Settings — Morph-Dials mit
  Zuweisungs-Chips („MetNoise1 · Color (+127) | …"), Settings-Gruppen mit
  Slidern und Enum-Dropdowns (On/Off, 1/16T, Up, …); im Modul-Panel pro Param
  eine Morph-Zeile (Select – / M1–M8 + Range): Zuweisung auf M2 (+90) und
  Entfernen („–") greifen am Gerät, Panel folgt via morphChanged

## Umsetzung

- **Frontend**: `renderSettingsPanel()` ersetzt den „Modul anklicken"-Hinweis
  bei leerer Auswahl; Settings-Params mit enums werden Dropdowns, sonst Slider
  (gleicher data-attr-Pfad wie Modul-Params -> paramChanged aktualisiert live);
  Morph-Dials = Params 0–7 des Morphs-Pseudo-Moduls (id 1, area settings).
  Modul-Panel: `morphRow()` pro Param; „–" oder Range 0 löscht, neuer Select
  setzt Default-Range 64. morphChanged pflegt currentPatch.morphs (Param hängt
  an höchstens einem Morph) und rendert das betroffene Panel neu.
- **Hinweis**: morphChanged trägt keinen Slot — Morph-Edits anderer Clients
  auf anderen Slots könnten die Anzeige verfälschen (selten; Backlog mit dem
  Slot-Feld nachrüsten).

## Stolperstein (nachträglich gefunden + gefixt)

- **Das GERÄT führt Morph-Zuweisungen je Gruppe separat**: Beim „Verschieben"
  eines Params auf einen anderen Morph entfernte der Server die alte Zuweisung
  nur im lokalen Modell — am G2 blieb sie bestehen. Lokal sah alles korrekt aus
  (der Test prüfte gegen den Server-State); aufgeflogen erst nach
  Service-Restart, der den WAHREN Gerätezustand neu einliest (Altlast
  „Clock · Rate (-56)" im Settings-Panel). Fix: setMorphInternal löscht eine
  bestehende Zuweisung auf einer ANDEREN Gruppe erst explizit (range 0) am
  Gerät. Verifiziert via Zuweisen→Verschieben→Löschen→`systemctl restart`→
  Gerätezustand sauber. Lehre: Mutations-Tests, die nur den Server-State
  vergleichen, übersehen Divergenzen — kritische Pfade nach Restart gegenprüfen.

## Offen (→ Teil 13+)

1. Performance-Mode.
2. Graph-Kurven (GraphFunc), LED/VU-Live-Feedback.
3. Morph-Mode-Toggle (Knob/Morph) im Settings-Panel; Morph-Labels editierbar.

---

# Phase 4b — Ergebnis Teil 11: Original-Modul-Layout (2026-06-11)

**Status: ✅ Modulflächen wie im Clavia-Original — Port-Namen, Texte/Linien/
Symbole/Bitmaps, interaktive Knobs/Buttons, TextFields mit Wert-Formatierung,
am echten G2 verifiziert.** (Teil 10 Morph-UI + Performance-Mode folgen.)

## Verifiziert (Browser gegen echten G2, Patch „HipHop beat box")

- Visuell: Module rendern das Original-Layout (Sequencer-Reihen, Knobs,
  Radio-/Flat-Buttons, TextFields „102 BPM"/„51.9Hz"/„415.3Hz"/„x1.41", Delay
  „12.5m", dB/Oct-Buttons …)
- Knob-Drag: ClkGen Rate 46→65→46 — Wert am G2, BPM-TextField live
  121→102 BPM (TextFunc CLK_GEN inkl. Dependency-Reihenfolge korrekt)
- ButtonText: ClkGen „Active" 1→0→1 (Klick toggelt, Server-State folgt)
- Port-Tooltips: `<title>` z.B. „Rst (In, logic)"
- Journal ohne 0x7e

## Umsetzung

- **Generator** (`gen-module-defs.py`): exportiert jetzt ALLE Control-Klassen
  der g2fx `module-uis.yaml` (Text/Line/Symbol/Bitmap/Knob/ButtonText/
  ButtonFlat/ButtonRadio(±Edit)/ButtonIncDec/TextEdit/TextField/PartSelector/
  Led/MiniVU/LevelShift/Graph) kompakt nach module-defs.json; Port-Namen
  (`Control`-Feld) an inputs/outputs; `param-tables.json` (LFO_CLOCK_VALS,
  DELAY_VALS, PULSE_DELAY_RANGE, MIX_LEV_DB, LEV_AMP_DB — aus
  ParamConstants.java geparst, -Inf→null); 138 Control-PNGs aus g2fx `img/`
  nach module-images/. TextField-`Dependencies` können „S<n>" enthalten =
  Mode-Index; PartSelector-CodeRef ist ein MODE-Index (type.modes), kein Param.
- **Backend**: Params tragen `text` (Anzeigewert über g2lib ModParam
  enums/Formatter — JavaFX-frei nutzbar) in patchState UND paramChanged;
  Module tragen `modes` (Werte + enums); neu `setMode {area,module,mode,value}`
  (UserModuleData.mode().set() sendet S_SET_MODE 0x2b selbst) mit
  modeChanged-Broadcast; Mode-Listener je Modul.
- **Frontend**: `controls.ts` rendert den Control-Layer je Modul (unter den
  Ports); Knobs mit Vertikal-Drag (Drag-Listener am document — der Layer wird
  bei jedem Wert-Update neu aufgebaut, sonst riss der Drag ab), Buttons/Radio/
  IncDec/PartSelector/LevelShift klickbar, Push-Buttons momentan (down=1/up=0);
  `textfuncs.ts` portiert die 14 TextFunc-Formatter aus g2gui
  ModuleTextFieldBuilder/ParamTimes (Vorsicht Java-Int-Division: (fine-64)/128
  ist immer 0); Fallback = serverseitiger Master-Param-Text. param-/modeChanged
  bauen nur den Control-Layer des betroffenen Moduls neu (updateModule).
- **Statisch (Absicht)**: LED/MiniVU dunkel, Graph als Platzhalter-Box — echte
  Anzeigen bräuchten DSP-/Volume-Feedback vom Gerät bzw. GraphFunc-Portierung.

## Stolpersteine

- Browser-Cache überlebte sogar `location.reload(true)` — index.html kam aus
  dem Disk-Cache mit altem Bundle-Verweis. Beim Testen Cache-Buster-Query
  (`/?v=…`) verwenden.
- Die Modul-Namen/Icons (unsere Zeile oben links) überlappen bei dichten
  Layouts Original-Controls — kosmetisch, Backlog.

## Offen (→ Teil 12+)

1. Morph-UI (Backend setMorph/morphsOf fertig), Patch-Settings-Panel.
2. Performance-Mode.
3. Graph-Kurven (GraphFunc), LED/VU-Live-Feedback, Knob-Doppelklick=Default.

---

# Phase 4b — Ergebnis Teil 9: Undo-Feedback im UI (2026-06-11)

**Status: ✅ Undo/Redo-Buttons mit Label+Tiefe, am echten G2 verifiziert.**

## Verifiziert

- `scripts/ws-undostate-test.py`: patchState trägt `undo{}`, jede Verlaufs-
  Änderung broadcastet `undoState` (Tiefen + Label der obersten Einträge),
  undo/redo drehen die Tiefen korrekt, Slot-Wechsel leert auf 0/0
- Browser: Buttons ↶/↷ im Header starten disabled; Umfärben aktiviert ↶ mit
  Tooltip „Rückgängig: Modulfarbe ändern (1) — ⌘Z"; Button-Klick stellt die
  Farbe wieder her und aktiviert ↷

## Umsetzung

- **Backend**: `undoState`-Broadcast nach pushUndo/clearUndo/undo/redo
  (`{undoDepth, redoDepth, undoLabel?, redoLabel?}`), zusätzlich als `undo{}`
  im patchState (frische Clients). Labels = interne Aktionsnamen.
- **Frontend**: Buttons im Header (disabled bei leerem Stack), Label-Mapping
  auf Deutsch im Client (UNDO_LABELS), Klick sendet undo/redo.

## Offen (→ Teil 10+)

1. Morph-/Patch-Settings, Performance-Mode (in Arbeit).

---

# Phase 4b — Ergebnis Teil 8: Slot-Handling A–D (2026-06-11)

**Status: ✅ Slot-Wechsel A–D (Web → G2), Slot-Leiste im UI, am echten G2 verifiziert.**

## Verifiziert (Skript + Browser gegen echten G2)

- `scripts/ws-slot-test.py`: Slot A→B wechseln (patchState des neuen Slots,
  Name passt zur slots-Liste), Undo-Verlauf wird beim Wechsel verworfen
  (undo = no-op), Mutation (addModule) landet im NEUEN Slot, Rundreise zurück
  nach A — Journal sauber
- Browser: Slot-Leiste zeigt A–D mit Patch-Namen („Basslines FM4", 3× „s. ciani"),
  Klick auf B rendert dessen Patch (30 Module statt 36), Auswahl wird beim
  Wechsel verworfen, zurück zu A stellt die alte Ansicht her

## Umsetzung

- **Wire-Format** (BVerhue `CreateSelectSlotMessage`, g2_mess.pas ~2782):
  Perf-Request `[01, CMD_REQ+CMD_SYS=2c, perfVersion, S_SEL_SLOT=09, slot]` —
  in g2lib exakt `usb.sendPerfRequest(version, O_SELECT_SLOT, slot)`;
  Zugriff über `patch.getSlotSender().getSender()`.
- **Backend `selectSlot`**: `perfSettings.selectedSlot().set()` ist wieder nur
  lokal (LibProperty-Falle) → explizit senden. Ein Listener auf `selectedSlot`
  (attachListeners) macht clearUndo + patchState-Broadcast — derselbe Pfad
  greift bei Gerät-initiierten Wechseln (g2lib `readSlotChange`, I_CHANGE_SLOT
  0x09 von der Panel-Taste; implementiert, mangels Hand am Gerät nicht getestet).
- **Undo-Stacks jetzt synchronisiert** (undoLock): clearUndo kann vom
  Dispatcher-Thread kommen (Panel-Wechsel), die PerfActions laufen weiterhin
  nur auf dem Executor.
- **patchState** trägt `slots: [{slot:"A", name}, …]`; alle 4 Slots sind seit
  jeher in g2lib geladen (Performance-Init liest alle), Mutationen wirken via
  getSelectedPatch automatisch auf den aktiven Slot.
- **Frontend**: Slot-Leiste im Header (aktiver Slot akzentuiert, Patch-Name im
  Button), Klick sendet `selectSlot {slot:0–3}`; bei Slot-Wechsel im patchState
  werden Auswahl UND Zwischenablage verworfen (Modul-Indizes könnten im neuen
  Slot zufällig existieren). paramChanged/variationChanged fremder Slots werden
  ignoriert (Listener hängen auf allen vier — war schon immer so, fiel ohne
  Slot-UI nur nie auf).

## Offen (→ Teil 9+)

1. Morph-/Patch-Settings (Glide, Arp, …).
2. Performance-Mode (Performances laden/verwalten).
3. Undo-Feedback im UI; Panel-Slot-Wechsel am Gerät gegentesten.

---

# Phase 4b — Ergebnis Teil 7: Multi-Select (2026-06-11)

**Status: ✅ Rechteck-/Shift-Klick-Auswahl, Block-Drag, Selektion kopieren
(inkl. interner Kabel) und löschen — je EIN Undo-Eintrag, am echten G2 verifiziert.**

## Verifiziert (Skript + Browser gegen echten G2, Patch „Basslines FM4")

- `scripts/ws-multiselect-test.py`: zwei Module + internes Kabel angelegt,
  `copySelection` (Kopien übernehmen Params tief + internes Kabel samt Farbe,
  `selectionCopied` liefert die neuen Indizes), Unabhängigkeits-Check,
  `moveModules` als Block, Undo-Kette (EIN Undo je Block-Op; copySelection-Undo
  entfernt Kopien+Kabel, Redo bringt alles inkl. Param-Stand zurück),
  `deleteModules`-Undo restauriert Module UND internes Kabel — Endzustand =
  Ausgangszustand, Journal sauber
- Browser (Mac-Chrome per IP, synthetische Events): Gummiband wählt 2 Module,
  Shift-Klick toggelt ein drittes, Drag verschiebt den Block (28:0→2, 1:1→3),
  Cmd+Z stellt BEIDE wieder her (Auswahl überlebt das Re-Render), ⌘C/⌘V erzeugt
  Kopien und selektiert sie (selectionCopied), Entf löscht die Selektion —
  Patch exakt im Ausgangszustand (36 Module / 49 Kabel)

## Umsetzung

- **Protokoll v1**: `moveModules {area, moves:[{module,col,row}]}`,
  `deleteModules {area, modules}`, `copySelection {area, modules, dCol, dRow}`;
  Server antwortet mit den normalen Broadcasts, copySelection schließt mit
  `selectionCopied {area, modules:[neue Indizes]}` ab (Client wählt die Kopien aus).
- **Kollisionsregel für Selektionen** (`resolveCollisionsMulti`): anders als beim
  Einzel-Move weicht NICHT die Selektion aus (der Block bliebe sonst nicht starr) —
  überlappende Bestands-Module rutschen unter den Block und kaskadieren.
  Einzel-Operationen behalten das alte Verhalten (Modul taucht unter, Mehrfach-
  Paste stapelt sich weiter von selbst).
- **copySelection**: tiefe Param-Kopie je Modul über `deepCopyRecord` (aus
  copyModule extrahiert — gleiche FieldValues-Falle), interne Kabel (beide Enden
  in der Selektion) werden auf die neuen Indizes umgeschrieben und mit
  `colorOverride` farberhaltend nachgezogen. Undo löscht die Kopien (Kabel
  kaskadieren); Redo restauriert aus den finalen Records + Kabel-Snaps.
- **deleteModules**: Kabel-Snapshots EINMAL über die ganze Selektion (sonst
  Duplikate für interne Kabel); Undo restauriert erst alle Module, dann alle
  Kabel (interne brauchen beide Enden).
- **Frontend**: Auswahl ist jetzt `{area, ids[]}` EINER Area; Gummiband auf
  leerer Fläche (Shift = additiv), Shift-Klick toggelt, Klick ohne Bewegung auf
  leerer Fläche hebt auf. Drag eines selektierten Moduls zieht die ganze
  Selektion als Block mit (min-Offsets klemmen am Grid-Rand); 1 Modul → alte
  Einzel-Messages (moveModule/copyModule/deleteModule), sonst Block-Messages.
  Param-Panel zeigt bei Mehrfach-Auswahl einen Hinweis statt Params.

## Stolpersteine

- **Alter Bundle-Cache (wieder)**: Tab zeigte nach Deploy das alte JS-Bundle —
  Gummiband „funktionierte nicht". Erst `location.reload(true)` lud das neue
  Bundle; vor Browser-Tests IMMER `script.src` gegen das servierte index.html
  prüfen.
- Synthetische PointerEvents brauchen `pointerId: 1` (Maus-Pointer);
  `setPointerCapture` schluckt das klaglos.

## Offen (→ Teil 8+)

1. Morph-/Patch-Settings, Slot-Handling A–D, Performance-Mode.
2. Undo-Feedback im UI (Stack-Tiefe/Label anzeigen).
3. Kopieren über Areas hinweg (va↔fx) / zwischen Slots.

---

# Phase 4b — Ergebnis Teil 6: copyModule / Cmd+C+V (2026-06-11)

**Status: ✅ Modul kopieren (inkl. Params/Farbe/Name/Labels) mit Undo, am echten G2 verifiziert.**

## Verifiziert (Skript + Browser gegen echten G2)

- `scripts/ws-copy-test.py`: Quelle präpariert (param0=99, Farbe 7, Name
  „Quelle"), Kopie übernimmt alles; **Unabhängigkeits-Check**: Param der Kopie
  auf 11 → Quelle bleibt 99 (Deep-Copy-Falle, s.u.); Undo/Redo; Ausgangszustand
  wiederhergestellt — Journal sauber
- Browser: Modul auswählen, Cmd+C/Cmd+V (synthetisch) → Kopie direkt unter der
  Quelle, Cmd+Z entfernt sie wieder

## Umsetzung

- **Backend `copyModule(area, module, col, row)`**: wie
  `ModuleDelta.UserModuleRecord.duplicate()`, aber mit **tiefer Kopie der
  Parameterwerte**: `FieldValues.copy()` ist flach und `setParamValues`
  übernimmt Referenzen — das Duplikat hätte sonst dieselben VarParams-Objekte
  wie die Quelle (Param ändern hätte beide geändert). Fix:
  `ParamValues.mkDefaultParams(src.getVarValues(v), v)` je Variation baut
  frische FieldValues. Modes/Labels bleiben geteilt (im Web-UI nicht
  editierbar, im Add-Wire nur gelesen). Rest identisch zu addModule:
  createModules → Kollisionen → moduleAdded → Undo-Eintrag (delete/restore).
- **Frontend**: Cmd/Ctrl+C merkt sich das ausgewählte Modul, Cmd/Ctrl+V fügt
  unter der Quelle ein (row + height). Mehrfach-Paste stapelt sich dank
  serverseitiger Kollisionslogik von selbst nach unten — kein Paste-Offset-
  Zähler nötig.

## Offen (→ Teil 7+)

1. Multi-Select (Rechteck/Shift-Klick), Selektion kopieren inkl. interner Kabel.
2. Morph-/Patch-Settings, Slot-Handling A–D, Performance-Mode.
3. Undo-Feedback im UI.

---

# Phase 4b — Ergebnis Teil 5: Undo/Redo + Kabel-Hover (2026-06-11)

**Status: ✅ Serverseitiges Undo/Redo über alle Mutationen, am echten G2 verifiziert.**

## Verifiziert (Skript + Browser gegen echten G2, Patch „Basslines FM4")

- `scripts/ws-undo-test.py`: addModule (undo→weg, redo→identisch zurück),
  moveModule mit Kollisions-Push (undo stellt BEIDE Positionen wieder her),
  addCable (undo/redo), deleteCable (undo erhält die Farbe),
  deleteModule mit Kabel (undo restauriert Modul UND Kabel) — alles grün,
  Endzustand = Ausgangszustand, Journal sauber
- Browser: Umfärben + Cmd+Z setzt die Farbe zurück (Handler synthetisch
  getriggert, s. Stolpersteine)

## Umsetzung

- **Architektur**: Jede Mutation refactored in öffentliche Methode (Undo-Buchhaltung)
  + internes Primitiv ohne Buchhaltung (`addCableInternal`, `deleteCableInternal`,
  `deleteModuleInternal`, `restoreModule`, `renameInternal`, `setColorInternal`,
  `applyMoves`). Undo-Eintrag = Paar aus undo-/redo-Closure (`PerfAction`), die
  auf dem g2lib-Executor-Thread laufen — Stacks (`ArrayDeque`, Limit 100) werden
  NUR dort angefasst, kein Locking nötig. Fehlgeschlagenes Undo (Ziel weg) wird
  geloggt und verworfen statt den Stack zu vergiften.
- **Inverse**: move → Koordinaten-Diff gegen Snapshot (erfasst auch Kollisions-
  Pushes, Undo/Redo via applyMoves ohne erneute Kollisionslogik); addModule →
  delete + Pushes zurück / Redo restauriert aus `ModuleDelta.UserModuleRecord`
  (nach den Kollisionen gebaut → finale Koords); deleteModule → restore aus
  Record + `CableSnap`-Liste (Farbe/Richtung erhalten); deleteCable → addCable
  mit `colorOverride` (sonst würde die Farbe neu berechnet); rename/color → alter Wert.
- **Verlauf-Invalidierung**: `clearUndo()` bei loadPatch und Patch-Lifecycle-Init
  (Slot-Inhalt von außen ersetzt). Neue Aktion leert den Redo-Stack.
- **Frontend**: Cmd/Ctrl+Z = undo, +Shift = redo (nicht aus Inputs); Kabel-Hover
  hebt den sichtbaren Pfad hervor (pointerenter/leave am Hit-Pfad, Auswahl bleibt).

## Stolpersteine

- Claude-in-Chrome: synthetisches `cmd+z` erreicht die Seite NICHT (Browser-Menü
  schluckt es; `cmd+a` u.a. kommen durch). Handler-Test via
  `document.dispatchEvent(new KeyboardEvent(...))`. Echte Tastatur ist ok.
- Während der Session meldete sich der G2 vom USB ab (Gerät war aus) — Server
  lief weiter (`connected:false`), nach Wiedereinschalten Hotplug ohne Neustart.
  Außerdem mDNS-Aussetzer am Mac: clockworkpi.local hing, per IP 192.168.188.119
  ging alles — Deploy-Skripte besser direkt auf die IP.

## Offen (→ Teil 6+)

1. Multi-Select-Drag, Copy/Paste (Undo-Gerüst steht dafür bereit).
2. Morph-/Patch-Settings, Slot-Handling A–D, Performance-Mode.
3. Undo-Feedback im UI (Stack-Tiefe/Label anzeigen).

---

# Phase 4b — Ergebnis Teil 4: Kollisionen, renameModule, setModuleColor (2026-06-11)

**Status: ✅ Kollisions-Push-Down bei Move/Add, Modul-Rename und -Farbe fertig,
am echten G2 verifiziert.**

## Verifiziert (Skript + Mac-Chrome per IP gegen echten G2)

- `scripts/ws-edit-test.py`: zwei OscB anlegen, B exakt auf A schieben →
  `moduleMoved` für B (Zielposition) und A (base+5 = unter B gepusht),
  Rename auf „KollideB" + Farbe 5 greifen im Server-State, Aufräumen stellt
  den Ausgangszustand her — Journal ohne 0x7e/Exceptions
- Browser: Param-Panel zeigt Name-Input + 25 Farb-Swatches; Rename per Tippen
  + Enter aktualisiert SVG-Label live, Swatch-Klick färbt um (beides am
  Modul va/1 getestet und auf Original zurückgesetzt)

## Umsetzung

- **Kollisionen** (`G2LibService.resolveCollisions`, Algorithmus 1:1 wie g2gui
  `MoveableModule.resolveCollisions`, Tests in g2fx `ModuleMoveTest`): nur die
  Spalte des bewegten/neuen Moduls; liegt dessen oberer Rand im Bauch eines
  anderen Moduls, rutscht es unter dieses (selInc), alle weiteren kaskadieren
  nach unten. Lokal anwenden → pro geändertem Modul S_MOV_MODULE senden +
  `moduleMoved` emitten (`sendMoveAndEmit`). Bei addModule geht das Add mit den
  Wunsch-Koordinaten raus; verrutscht das neue Modul selbst, folgt ein
  Korrektur-Move, und `moduleAdded` (kommt zuletzt) trägt die finalen Koords.
- **Rename**: `S_SET_MODULE_LABEL 0x33` `[33, loc, index, name\0]` (Clavia-String,
  \0 nur wenn <16 Zeichen); `m.name().set()` ist wieder nur lokal
  (stringFieldProperty-Falle). Server kappt auf 16 ASCII-Zeichen.
- **Farbe**: `S_SET_MODULE_COLOR 0x31` `[31, loc, index, color]`, color 0–24
  (MODULE_COLORS-Index), `umd.color().set()` lokal.
- **Frontend**: Im Param-Panel Name als Input (Enter/Blur sendet, Entf im Input
  löscht dank activeElement-Guard nichts), Farbreihe mit 25 Swatches;
  `moduleRenamed`/`moduleColorChanged` aktualisieren State + Re-Render.

## Stolpersteine

- Koordinaten-Klicks auf die kleinen Swatches (16 px) gehen nach Panel-Re-Render
  leicht daneben — fürs Testen Button direkt klicken; für Nutzer irrelevant.

## Offen (→ Teil 5+)

1. Multi-Select-Drag, Copy/Paste, Undo.
2. Kabel-Hover-Feedback (Hit-Pfade kreuzender Kabel überlappen).
3. Morph-/Patch-Settings, Slot-Handling A–D, Performance-Mode.

---

# Phase 4b — Ergebnis Teil 3: addModule/deleteModule (2026-06-11)

**Status: ✅ Modul anlegen („+ Modul" pro Area) und löschen (Auswahl + Entf,
inkl. Kabel-Kaskade) fertig, am echten G2 verifiziert.**

## Verifiziert (Skript + Mac-Chrome per IP gegen echten G2, Patch „Basslines FM4")

- `scripts/ws-module-test.py`: OscB anlegen → `moduleAdded` (id=33, Name „OscB1",
  11 Params mit Defaults), löschen → `moduleDeleted`, Endzustand = Ausgangszustand
- Browser: „+ Modul"-Feld (Datalist, 166 Typen) legt OscB1 an; Kabel von dessen
  Output auf einen fremden Input gezogen; Modul ausgewählt + Entf → Kabel-Kaskade
  (`cableDeleted` + `moduleDeleted`), Patch danach exakt im Ausgangszustand
  (36 Module / 49 Kabel) — Journal ohne 0x7e/Exceptions

## Umsetzung

- **Add über g2lib**: `PatchArea.createModules(ModuleDelta)` existiert upstream
  (g2gui-Anteil) und baut die komplette Add-Message wie BVerhue
  `AddNewModuleMessage`: `S_ADD_MODULE 0x30` `[30, typeId, loc, index, col, row,
  0, uprate, isLed, modes…, name]` + Cable-/Param-/Label-/Name-Sektionen mit
  Defaults für 10 Variationen — sendet als Slot-Request und pflegt den lokalen
  State. (G2-Edit sendet nur die nackte 0x30-Message; wir nehmen die volle Form.)
  `ModuleDelta.addNewModule(area, type, index, name, color, coords)` liefert den
  Datensatz; Index = max+1 pro Area, Name = shortName + laufende Nr. (BVerhue-
  Konventionen). Für neue Module Param-Listener nachziehen
  (`attachModuleParamListeners`, aus attachPatchListeners extrahiert).
- **Delete selbst gebaut** (fehlt in g2lib): erst hängende Kabel löschen wie
  G2-Edit `action_delete_module` (je `S_DEL_CABLE` + cableDeleted-Broadcast),
  dann `S_DEL_MODULE 0x32` `[32, loc, index]`; lokal `getModules().remove(m)`
  (Collection-View der TreeMap) und `moduleDeleted` emitten.
- **Frontend**: „+ Modul"-Eingabe (datalist aus module-defs.json) pro Area-Titel,
  auch für leere Areas (sonst käme man in eine leere FX-Area nie rein);
  Platzierung unten (max row + height), col 0. Entf löscht jetzt auch das
  ausgewählte Modul (Kabel-Auswahl hat Vorrang). `moduleAdded` liefert das
  komplette Modul-Objekt, `moduleDeleted` räumt lokal Modul + Kabel auf.

## Stolpersteine

- Claude-in-Chrome erzeugt auch bei `left_click` keine Pointer-Events —
  Modul-Auswahl (pointerdown/up) damit nicht testbar, `click`-Handler (Kabel)
  schon. Synthetische PointerEvents wie in Teil 2.
- Der Test lief gegen einen anderen Patch („Basslines FM4" statt FM-clang-v) —
  Slot-Inhalt hatte sich zwischenzeitlich geändert; für die Tests egal, da
  Vorher/Nachher-Vergleich gegen den Live-State läuft.

## Offen (→ Teil 4+)

1. Kollisionserkennung beim Drop/Add (g2gui `resolveCollisions`).
2. Modul-Rename/-Farbe, Multi-Select-Drag, Copy/Paste, Undo.
3. Kabel-Hover-Feedback (Hit-Pfade kreuzender Kabel überlappen).

---

# Phase 4b — Ergebnis Teil 2: addCable/deleteCable (2026-06-11)

**Status: ✅ Kabel anlegen (Port-Drag) und löschen (Klick + Entf) fertig, am echten G2 verifiziert.**

## Verifiziert (Mac-Chrome per IP + Skript gegen echten G2)

- `scripts/ws-cable-test.py` (läuft auf dem Gerät): bestehendes Kabel löschen →
  `cableDeleted`, wieder anlegen → `cableAdded` (Farbe red), doppeltes addCable
  idempotent — alles grün, Journal ohne 0x7e/Exceptions
- Browser: Drag von Out va/2:0 nach In va/3:0 legt Kabel an (Server-State + Render),
  Klick aufs Kabel wählt aus (Strichstärke 5), Entf löscht; Patch danach exakt
  im Originalzustand (Diff gegen Bank-Reload leer)

## Umsetzung

- **Wire-Formate** (BVerhue `BVE.NMG2Mess.pas` ~4310/4380, G2-Edit `usbComms.c`
  ~1609/1704 — byte-identisch), beide als Slot-Request wie moveModule:
  - `S_ADD_CABLE 0x50`: `[50, 10|loc<<3|farbe, fromMod, fromKind<<6|fromConn, toMod, toConn]`
  - `S_DEL_CABLE 0x51`: `[51, 02|loc, fromMod, fromKind<<6|fromConn, toMod, toKind<<6|toConn]`
  - Kind Input=0/Output=1; `to` immer Input; In-zu-In-Kabel = fromKind 0
- **Farbe**: Server bestimmt sie aus dem Quell-Connector (g2lib ModuleType
  in/outPorts). Vereinfachung ohne Uprate-Logik: Red/Blue_red→0 rot, Blue→1 blau,
  Yellow/Yellow_orange→2 gelb. (Referenz-Editoren färben Blue_red je nach Uprate.)
- **Backend**: `G2LibService.addCable/deleteCable` — lokalen State über
  `PatchArea.addCable(FieldValues)` bzw. `getCables().remove()` pflegen (g2lib
  hat keine sendende Mutations-API), dann explizit `sendSlotRequest`, dann selbst
  `cableAdded`/`cableDeleted` emitten. addCable idempotent (Duplikat → no-op).
- **Frontend** (`graph.ts`): Ports tragen `data-module/conn/out` + Cable-Drag
  (Gummiband im Overlay-Layer, `stopPropagation` gegen Modul-Drag); Drop-Ziel via
  `elementFromPoint().closest('[data-conn]')`, In→Out wird gedreht, Out→Out verworfen.
  Kabel: sichtbarer Pfad + 9px-Hit-Pfad; Klick wählt aus, Entf/Backspace löscht
  (main.ts, nicht aus Inputs heraus). Re-Render via `cableAdded`/`cableDeleted`.

## Stolpersteine

- **Hit-Pfad verdeckte Ports**: cableLayer liegt über modLayer; der breite
  unsichtbare Kabel-Hit-Pfad fing pointerdown an Kabel-Endpunkten ab → Ports an
  belegten Connectors waren nicht greifbar. Fix: `cableHitPath()` kürzt die
  Bezier an beiden Enden (t 0.08–0.92, als Polyline gesampelt).
- **Hit-Pfade überlappen sich**: Klick auf einen Kabel-Scheitel kann ein anderes,
  kreuzendes Kabel treffen — beim Testen so ein falsches Kabel gelöscht (per
  Bank-Reload restauriert). Für Nutzer ok (Auswahl-Highlight vor Entf sichtbar);
  Backlog: Hover-Feedback/engere Hit-Breite.
- **Claude-in-Chrome** (Test-Werkzeug): `left_click_drag` liefert nur
  `pointermove`, kein `pointerdown/up` → Port-Drags damit nicht testbar; Klicks
  und Tasten gehen. Workaround: synthetische `PointerEvent`s per JS dispatchen —
  dabei Element-Referenzen NACH dem letzten Re-Render holen (stale Nodes:
  `closest('svg') !== svg`-Guard verwirft den Drop still).
- Kabelfarbe kann sich beim Wiederanlegen ändern (s. Farb-Vereinfachung) —
  kosmetisch, der G2 übernimmt die gesendete Farbe.

## Offen (→ Teil 3+)

1. addModule/deleteModule (g2gui `AreaPane.doAddModule`; Namens-String im
   Add-Kommando, vgl. G2-Edit eMsgCmdWriteModule).
2. Kollisionserkennung beim Drop (g2gui `resolveCollisions`).
3. Multi-Select-Drag, Copy/Paste; Kabel-Hover-Feedback.

---

# Phase 4b — Ergebnis Teil 1: moveModule (2026-06-11)

**Status: ✅ Erste Mutation (Modul verschieben) fertig, am echten G2 verifiziert.**
Drag&Drop im Browser → Server → G2; Broadcast hält alle Clients synchron.

## Verifiziert (Mac-Chrome per IP gegen echten G2)

- FM-OscA1 („FM-clang-v") per Drag von col 0/row 6 nach col 1/row 25:
  UI folgt mit Grid-Snap, Kabel folgen nach Re-Render, Server-State bestätigt 1/25
- Zweiter Browser-Client erhält `moduleMoved` und zeigt die neue Position live
- Kein G2-Fehler im Journal (0x7e wäre geloggt); Patch-Reload aus Bank stellt
  Originalposition wieder her (Slot-State, nichts persistiert — wie erwartet)
- Klick ohne Bewegung = Auswahl (Param-Panel) funktioniert weiter

Noch offen: Sichtprüfung am G2-LCD, dass das Gerät den Move auch anzeigt.

## Umsetzung

- **Wire-Format** (Quellen: BVerhue `BVE.NMG2Types/Mess.pas`, G2-Edit `usbComms.c`):
  `S_MOV_MODULE = 0x34` als Slot-Request
  `[01, 0x28+slot, version, 0x34, location, index, col, row]`, location FX=0/VA=1
  — deckungsgleich mit g2lib `AreaId`-Ordinals (Fx=0, Voice=1). G2 antwortet 0x7f.
- **g2lib-Falle (wieder)**: `UserModuleData.column()/row()` sind `intFieldProperty`
  → set() ändert nur lokalen State, sendet NICHT (wie Variation, Phase 3).
  `G2LibService.moveModule`: erst column/row lokal setzen, dann explizit
  `sendSlotRequest("move-module", 0x34, …)`; danach selbst `moduleMoved` emitten
  (g2lib hat keine coords-Listener). 0x34 lokal definiert — fehlt in g2lib `Codes`.
- **Protokoll v1 begonnen**: Client→Server `moveModule {area, module, col, row}`,
  Server→Clients `moduleMoved` (gleiche Felder). docs/protocol.md + protocol.ts.
- **Frontend** (`graph.ts attachDrag`): Pointer-Events mit `setPointerCapture`,
  Grid-Snap über Maus-Delta (Skalierung aus viewBox/clientWidth → zoomfest),
  <1 Zelle Bewegung = Klick/Auswahl, sonst Drop → `moveModule` senden.
  Optimistisches Ghost (opacity .7) während des Drags; verbindliche Position
  kommt als `moduleMoved` zurück → `renderPatch` (Kabel ziehen nach).

## Stolpersteine

- **Alte Clients nach Deploy**: Tabs mit altem JS-Bundle kennen `moduleMoved`
  nicht und zeigen still veraltete Positionen. Nach Deploy Browser-Tabs hart
  neu laden. (Backlog: Protokoll-/Build-Version im patchState, Client warnt.)
- **Claude-in-Chrome-Eigenheit** (nur Test-Werkzeug): Screenshot- und
  Seiten-Koordinaten liegen ~27/16 px auseinander — Klicks/Drags daneben treffen
  das falsche Modul. Vor Drag-Tests Zielkoordinaten per JS aus
  `getBoundingClientRect()` holen.
- Nach `systemctl restart` braucht der Service 10–20 s bis zum ersten
  patchState (G2-Init); Seite ggf. neu laden.

## Offene Punkte (→ Phase 4b Teil 2+)

1. addCable/deleteCable (Formate liegen in BVerhue `S_ADD_CABLE`/`S_DEL_CABLE` vor,
   inkl. ConnectorKind-Bits — siehe BVE.NMG2Mess.pas um Zeile 4280/6560).
2. addModule/deleteModule (g2gui `AreaPane.doAddModule`/`createModules` als Vorlage;
   Namens-String im Add-Kommando, vgl. G2-Edit eMsgCmdWriteModule).
3. Kollisionserkennung beim Drop (g2gui `resolveCollisions` als Referenz) —
   aktuell darf der G2/Server Überlappungen einfach zulassen.
4. Multi-Select-Drag, Copy/Paste.

## Deploy

Unverändert (phase2/4a): Frontend-Build → cp nach resources/public → rsync →
installDist → cp /opt/g2web → systemctl restart g2web.
