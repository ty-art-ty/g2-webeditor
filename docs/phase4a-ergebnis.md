# Phase 4a — Ergebnis (2026-06-10)

**Status: ✅ Grafische Read-only-Patch-Ansicht fertig, am echten G2 im Browser verifiziert.**
Module mit Icons/Farben/Connectors im Original-Grid, Kabel-Rendering, Modul-Auswahl
mit Param-Panel. Mutationen (Module/Kabel anlegen, verschieben) → Phase 4b.

## Verifiziert (Mac-Chrome gegen clockworkpi.local, echter G2)

- „Dirty Old Synth" (32 Module, 37 Kabel) und „polygranusynz_tk" (sehr kabelreich)
  rendern vollständig: Grid-Layout, Modulfarben, Icons, Connector-Punkte, Kabel-Beziers
- Modul-Klick → Auswahl-Rahmen + Param-Panel rechts (Icon, Name, Slider)
- Slider-Drag FreqCoarse 64→119 → Server bestätigt 119 (REST-Check), Reset per
  Pfeiltasten zurück auf 64 (Keyboard auf Slidern funktioniert)
- Patch-Wechsel: Panel wird geleert (Bugfix s.u.), Variation folgt dem neuen Patch
- Icons/module-defs.json werden korrekt mit ausgeliefert (210 PNGs, 166 Defs)

## Umsetzung

- **`scripts/gen-module-defs.py`** (Aufruf: `python3 scripts/gen-module-defs.py /pfad/zu/g2fx`):
  generiert `frontend/public/module-defs.json` + kopiert `module-icons/` aus einem
  g2fx-Checkout (e75c6d0). Quellen: `ModuleType.java` (ix = Icon-Name `%03d.png`, height)
  + `module-uis.yaml` (Connector-XPos/YPos, CodeRef = conn-Index im Kabel).
  Generiertes ist eingecheckt — der Generator läuft nur bei g2fx-Updates.
- **Geometrie** (wie g2fx/Original-Editor): Grid 255×15 px; Modul = col·255/row·15,
  Höhe height·15; Connector-Mittelpunkt = Modul-Origin + (XPos+6, YPos+6).
  Inputs = Kreise, Outputs = Quadrate; Audio rot, Control blau, Logic gelb.
  Modulfarben: `ParamConstants.MODULE_COLORS` (Index = `color`-Feld).
- **Protokoll**: Kabel tragen jetzt `fromOutput` (true: from ist Output; false:
  In-zu-In-Kabel — `to` ist immer Input). Quelle: `PatchCable.getDirection()`,
  Semantik wie g2gui `AreaPane` (`direction ? Out : In`).
- **Frontend**: `graph.ts` (SVG-Renderer, ~150 Z.) + Umbau `main.ts`: Hauptbereich
  zeigt VA/FX als SVG (viewBox in Modul-Koordinaten, Zoom ±25 % über width/height),
  Param-Slider wandern in ein rechtes Panel fürs angeklickte Modul. `paramChanged`
  aktualisiert Panel UND den State (damit Re-Renders aktuelle Werte zeigen).
  Kabel mit Quadratik-Bezier-Durchhang, Jack-Punkte an den Enden.

## Bugfix während Verifikation

Nach Patch-Load zeigte das Param-Panel noch ein Modul des **alten** Patches
(Auswahl wurde nur bei bestehender Selektion aktualisiert, nie geleert).
Fix in `renderPatch`: Auswahl wiederherstellen ODER `clearSelection()`.

## Stolperstein Browser-Verifikation

Claude-in-Chrome hatte keine Berechtigung für `http://clockworkpi.local:8080`
(navigate meldet Erfolg, Tab bleibt aber auf chrome://newtab; Screenshot →
„Permission denied for this domain"). **Workaround: per IP** `http://192.168.188.119:8080`
— funktioniert sofort. (Zusätzlich gilt weiter: bei zwei verbundenen Browsern
zuerst den Mac-Chrome via select_browser wählen.)

## Offene Punkte (→ Phase 4b / Backlog)

1. Mutationen: `addModule`/`deleteModule`/`moveModule`/`addCable`/`deleteCable`
   (Protokoll v1 in docs/protocol.md skizziert) — Schreibweg über g2lib klären.
2. Param-Rendering im Modul selbst (Knobs/Buttons an YAML-Positionen statt
   Slider-Panel) — module-uis.yaml enthält dafür bereits alle Control-Defs.
3. Kabel-Hover/Klick (Highlight, später Löschen); Connector-Tooltips (Namen
   stehen in g2lib `ModuleType.inPorts/outPorts`, noch nicht im JSON).
4. Slider→Knob-Optik, Modul-Titelzeile mit echter G2-Typo.
5. Frontend-Build in Gradle integrieren (weiter manuell: `npm run build` +
   cp dist → backend resources/public VOR installDist).
6. Pro-Client-Variation (unverändert aus Phase 3).

## Deploy (unverändert, Referenz in phase2-ergebnis.md)

`npm run build` → `cp -r frontend/dist/. backend/src/main/resources/public/` →
rsync → `gradle installDist` → `sudo cp` nach /opt/g2web → `systemctl restart g2web`.
Nach Restart braucht der Service ein paar Sekunden bis „verbunden".
