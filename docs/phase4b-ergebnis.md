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
