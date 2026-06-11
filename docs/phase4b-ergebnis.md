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
