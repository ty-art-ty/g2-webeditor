# dx2g2 — DX7 → G2 Patch-Konverter (Clean-Room)

Konvertiert einen Yamaha-DX7-Voice (Sysex) in eine Clavia-G2-`.pch2`-Datei.

## Lizenz / Clean-Room

Eigenständige Implementierung aus dem **öffentlichen DX7-Sysex-Format** und den
G2-Moduldefinitionen in `g2lib` (`M_Operator`, `M_DXRouter`). Es wurde **kein**
Code des GPL-Tools g2ools eingesehen oder portiert. Der Konverter ist eigener
Projektcode (BSD-3) und nutzt `g2lib` nur als Bibliothek. Damit bleibt das
Projekt durchgehend permissiv lizenziert.

## Dateien

- `backend/.../org/g2web/convert/Dx7Voice.java` — VCED-Single-Voice-Parser
  (155-Byte-Format, optional mit Sysex-Hülle). Keine g2lib-Abhängigkeit.
- `backend/.../org/g2web/convert/Dx2G2.java` — Mapping + Offline-Patch-Builder.
- `backend/.../org/g2web/convert/Dx2G2Cli.java` — CLI: `Dx2G2Cli voice.syx [out.pch2]`.
- `backend/src/test/.../Dx2G2Test.java` — Parser- und Round-Trip-Test.
- **Vendor-Patch** in `g2lib`: `Patch.snapshotSections(int)` — schreibt das
  Live-Modell in die Section-Map, damit `writeFile()` einen offline gebauten
  Patch serialisieren kann. *Nach Re-Vendoring von g2lib erneut anwenden.*

## Warum es gut passt

Clavias `M_Operator` ist dem DX7-Operator nachempfunden: 4-stufige Rate/Level-
Hüllkurve (R1–R4/L1–L4), Keyboard-Level-Scaling (BreakPoint, Curve, Depth),
Rate-Scaling, Detune (0–14, Mitte 7), Coarse/Fine, OutLevel — alle Ranges
decken sich mit DX7 (meist 0–99). Der `M_DXRouter` bildet die 32 Algorithmen
und das Feedback als Parameter ab und routet die Operatoren intern. Das Mapping
ist daher nahezu 1:1.

## Topologie (algorithmus-unabhängig)

```
Operator k .Out  ->  DXRouter.In(k)     (k = 0..5, Operator 1..6)
DXRouter.Out(k)  ->  Operator k .FM
DXRouter.Main    ->  2-Out .InL / .InR  (mono auf beide Kanäle)
```

Die Verkabelung ist fix; der DXRouter wählt die eigentliche Operator-Matrix
intern über den `Algorithm`-Parameter.

## Parameter-Mapping (pro Operator)

| DX7 | G2 `M_Operator` Param-Index |
|-----|------|
| Osc Mode | 2 RatioFixed |
| Freq Coarse / Fine | 3 / 4 |
| Detune | 5 |
| Key Velocity Sens | 6 Vel |
| Rate Scaling | 7 |
| EG Rate 1–4 | 8/10/12/14 (R1–R4) |
| EG Level 1–4 | 9/11/13/15 (L1–L4) |
| Amp Mod Sens | 16 AMod |
| Break Point | 17 |
| L/R Curve | 18 / 20 (DepthMode) |
| L/R Depth | 19 / 21 |
| Output Level | 22 OutLevel |

DXRouter: `Algorithm` (0–31) ← DX7-Algorithmus−1, `Feedback` (0–7).

## Noch offen (erster Wurf: Einzel-Voice)

- **LFO** (Speed/Delay/Wave/Pitch- & Amp-Mod-Tiefe, Pitch-Mod-Sens) — nicht
  verkabelt; braucht LFO-Modul + Mod-Routing.
- **Pitch-EG** und **Transpose** — noch nicht abgebildet.
- **Gate/Keyboard**: Operatoren self-gaten über `EnvKB` (Default an); ein
  expliziter Keyboard-Gate ist (noch) nicht verdrahtet — auf Hardware prüfen.
- **Bank-Sysex** (32 Voices, gepacktes 128-Byte-Format) — geplant; aktuell nur
  Single-Voice-VCED.
- **Version-Byte** (23) gegen einen bekannten guten `.pch2` gegenprüfen.

## Test

```bash
cd backend && ./gradlew test --tests org.g2web.convert.Dx2G2Test
```

Der Round-Trip-Test baut einen synthetischen Voice, konvertiert ihn, liest die
`.pch2` mit `g2lib` zurück (Header + CRC) und prüft Modul-/Kabel-Struktur und
gemappte Parameterwerte. Der Parser ist zusätzlich isoliert verifiziert.

## Web-Editor / REST

- `POST /api/patch/import-dx7` — Body: rohe `.syx`-Bytes (DX7-Single-Voice).
  Wird konvertiert und in den **aktiven Slot** geladen (wie `.pch2`-Import).
  Erfolg → `202` (neuer `patchState` via WS). Ungültiges Sysex → `400`,
  kein G2 verbunden → `503`.
- `POST /api/dx7/convert` — Body: `.syx`-Bytes; Antwort: die konvertierte
  `.pch2` als Datei-Download. **Hardware-unabhängig** — gut zum Testen der
  Konvertierung ohne angeschlossenen G2.

Frontend: Button **⬆ .syx** in der Kopfzeile (neben `⬆ .pch2`/`⬆ .prf2`),
verdrahtet in `frontend/src/main.ts` (`wireImport`). Lädt eine `.syx`-Datei,
postet sie an `/api/patch/import-dx7` und zeigt Fehler an.

Geänderte Dateien: `backend/.../org/g2web/Main.java` (Routen + Handler),
`frontend/index.html` (Button/Input), `frontend/src/main.ts` (Verdrahtung).
