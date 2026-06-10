# Phase 3 — Ergebnis (2026-06-10)

**Status: ✅ MVP fertig und funktional gegen echten G2 verifiziert.**
Frontend unter `http://clockworkpi.local:8080` — Patch-Browser, Param-Slider, Variations.

## Verifiziert (API-Ebene, echter G2)

- `GET /api/banks` → 3 Banks, 118 Patches (echte Gerätedaten via `Entries`)
- `POST /api/patch/load` → Patch „3-Shape synth" in Slot A geladen, `patchState`-Broadcast
  mit 32 Modulen kam über WS; Original („HipHop beat box") danach zurückgeladen
- `selectVariation` über WS → `variationChanged`-Broadcast
- `setParam` mit neuem `area`-Feld → USB-Write + Broadcast (`scripts/ws-smoke.py`)

## Browser-Verifikation (Nachtrag, gleicher Tag)

Der frühere „Chrome kommt nicht ins LAN"-Befund war ein Red Herring: Es waren **zwei**
Chrome-Instanzen mit Claude verbunden (Mac + Windows-Rechner), die Befehle gingen an den
Windows-Chrome außerhalb des LANs. Mit dem Mac-Chrome:

- UI rendert vollständig (Header, Bank-Browser, Module nach Area, Slider, Variations)
- Variation-Buttons: Wechsel 1→2 ändert Werte sichtbar (FreqCoarse 40→52, Mix 85→99 …)
- Slider-Drag per Maus: FreqCoarse 40→75 → Server bestätigt 75 → Reset auf 40 bestätigt
  — kompletter Pfad UI → WS → g2lib → USB → G2 aus dem Browser verifiziert

## Bugfix: Variationen (nach User-Report — Lehrstück in Debugging-Irrwegen)

`patchSettings.variation()` ist als `intFieldProperty(Variation, false)` registriert —
set() sendet NICHT zum Gerät. Es braucht ein explizites 0x6a-Kommando.

**Korrektes Wire-Format** (final verifiziert: Panel-LED folgt, Klang wechselt, beide
Richtungen sync): Slot-Request wie bei den Referenz-Editoren (BVerhue, G2-Edit):
`[01, 0x28+slot, version, 0x6a, var]` via `UsbSlotSender.sendSlotRequest`, G2 antwortet
`0x7f` (OK). Implementiert in `G2LibService.selectVariation` (Vendor-Patch
`Patch.getSlotSender()`).

Sackgassen, dokumentiert damit niemand sie nochmal läuft:

- `0x38`-No-Response-Kommando: wird ignoriert.
- „Panel-Notification-Format" `[01, slot, version, 6a, var]` ohne Request-Rahmen:
  G2 antwortet mit **Error `0x7e 01`** — Notifications sind keine Kommandos.
- Zwischenzeitliche „es geht / geht nicht"-Verwirrung entstand durch parallele manuelle
  Tests am Panel + mehrfache Service-Restarts (False Positives beim Ablesen).

Debugging-Werkzeug: `logging.properties` → `org.g2fx.g2lib.usb.Usb.level=INFO` gibt
komplette USB-Hexdumps (Achtung: ~18k Journal-Zeilen/min durch Meter-Streaming;
nur temporär aktivieren).

## Umsetzung

- **Protokoll v0.1**: `setParam` trägt jetzt `area` ("va"/"fx") — Modul-IDs sind nur pro
  Area eindeutig. `G2Service`-Interface, Mock, `G2LibService`, `Main`, `protocol.ts`,
  Smoke-Tests entsprechend angepasst.
- **Frontend** (vanilla TS + Vite, keine Framework-Dependency, 4.2 kB JS):
  - Header: Patch-/Perf-Name, Slot, Verbindungsstatus, Variation-Buttons 1–8
  - Sidebar: Bank-Browser (`/api/banks`), Klick lädt Patch in den aktiven Slot
  - Hauptbereich: Module nach Area (VA/FX) gruppiert, sortiert nach col/row,
    Params als Slider mit min/max; `paramChanged` anderer Clients/vom G2-Panel
    aktualisiert Slider live (außer er wird gerade bedient)
  - WS-Auto-Reconnect (2 s)
- Build: `frontend/dist` → `backend/src/main/resources/public` → ein Deployable.

## Offene Punkte (→ Phase 4 / Backlog)

1. Visueller UI-Check + iPad-Test durch Alex.
2. Variation-Werte: Server liefert `patchState` mit Server-globaler `variation`;
   pro-Client-Variation wäre sauberer (derzeit: Client refetcht `/api/patch` nach Wechsel).
3. `variationChanged` vom G2-Panel aus noch nicht beobachtet (Schreibweg via
   `patchSettings.variation()` gesendet, Wirkung am Gerät unbestätigt — am G2-Display prüfen).
4. Slider → Knobs, Modul-Icons (g2fx `resources/module-icons`), Kabel-Rendering: Phase 4.
5. Frontend-Build in Gradle integrieren (derzeit manuell `npm run build` + cp).

## Test-Skripte

- `scripts/ws-smoke.py` — setParam-Roundtrip
- `scripts/ws-load-test.py` — loadPatch + Variation + Restore
