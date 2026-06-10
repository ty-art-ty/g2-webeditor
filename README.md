# g2-webeditor

Web-basierter Patch-Editor für den Clavia Nord Modular G2. Das Backend läuft auf einem
headless Linux-ARM-Board (Raspberry Pi, ClockworkPi o.ä.), an dem der G2 per USB hängt;
bedient wird vom Browser aus (PC, Mac, iPad).

```
G2 ──USB──> ARM-Board: g2lib (Java) + Javalin-Bridge ──WS/HTTP──> Browser-SPA
```

**Status:** Phasen 1–3 fertig und gegen echte Hardware verifiziert — Patch-/Bank-Browser,
Param-Editing (bidirektional, hörbar), Variations, Multi-Client via WebSocket-Broadcast.
Phase 4 (grafischer Patch-Editor mit Modulen/Kabeln) steht aus. Details: `docs/phase*-ergebnis.md`.

## Struktur

- `backend/` — Java 25, Gradle. Javalin: REST + WebSocket + statisches Frontend.
  `G2Service`-Interface mit `MockG2Service` (Entwicklung ohne Hardware) und
  `G2LibService` (USB-Adapter auf g2lib).
- `backend/src/main/java/org/g2fx/` — vendored `g2lib` aus
  [sirlensalot/g2fx](https://github.com/sirlensalot/g2fx) @ `e75c6d0` (BSD-3),
  mit kleinen lokalen Patches (siehe `docs/phase2-ergebnis.md`, `docs/phase3-ergebnis.md`).
- `frontend/` — TypeScript + Vite, kein Framework. Build wird nach
  `backend/src/main/resources/public/` kopiert → ein Deployable.
- `deploy/` — udev-Regel, systemd-Unit, Installationsskript.
- `docs/` — Architektur, JSON-Protokoll (`protocol.md`), Phasen-Ergebnisse inkl.
  hart erarbeiteter G2-USB-Protokoll-Erkenntnisse.
- `scripts/` — Vendor-Skript, WS-Smoke-Tests (`ws-smoke.py`, `ws-load-test.py`).

## Quickstart (Entwicklung, ohne Hardware)

```bash
cd backend && ./gradlew run        # MockG2Service auf :8080
cd frontend && npm install && npm run dev
```

## Deployment (Kurzfassung)

```bash
# auf dem Zielgerät: OpenJDK 25 headless (z.B. apt install openjdk-25-jdk-headless)
cd frontend && npm install && npm run build && cp -r dist/. ../backend/src/main/resources/public/
cd backend && ./gradlew installDist
sudo deploy/install.sh             # udev + systemd-Service "g2web", Port 8080
```

Hinweise: Der G2 braucht ein sauberes USB-Release beim Beenden, sonst verweigert er die
Wiederverbindung — die systemd-Unit macht deshalb `usbreset` als `ExecStartPre`.
Variation-Select erfordert ein explizites Slot-Request-Kommando (`0x6a`), siehe
`docs/phase3-ergebnis.md`.

## Lizenz

BSD-3-Clause (siehe `LICENSE`). Enthält vendorten Code aus
[sirlensalot/g2fx](https://github.com/sirlensalot/g2fx) (BSD-3-Clause,
`backend/src/main/java/org/g2fx/LICENSE-g2fx`). Dank an sirlensalot für die saubere
Trennung von g2lib/g2gui sowie an BVerhue (nord_g2_editor) und chrispurusha (G2-Edit)
für die Protokoll-Referenzen.
