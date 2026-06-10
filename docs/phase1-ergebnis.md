# Phase 1 — Ergebnis (2026-06-10)

**Status: ✅ abgeschlossen.** g2lib läuft headless auf dem Zielgerät und spricht mit dem echten G2.

## Zielgerät

- `ossareta@clockworkpi.local` — Debian 13 (trixie), aarch64, 4 Kerne, 3.7 GiB RAM (kein Raspberry Pi OS; für unsere Zwecke gleichwertig)
- SSH passwortlos vom Mac, sudo ohne Passwort
- G2 erkannt: `lsusb` → `0ffc:0002 Clavia DMI AB Nord Modular G2`

## Installation

- OpenJDK 25 headless (`apt install openjdk-25-jdk-headless`) — statt Temurin 24; trixie-Paket reicht
- Gradle 9.2.0 manuell nach `~/opt/gradle-9.2.0` (kein Wrapper im g2fx-Repo!)
- g2fx geklont nach `~/g2fx`, Commit **e75c6d0** (Pin-Kandidat)
- udev: `/etc/udev/rules.d/99-clavia-g2.rules` (aus `deploy/`), User in `plugdev`, Device-Node `root:plugdev 0660` ✓

## Build-Fixes in `~/g2fx/build.gradle` (Backup: `.bak`)

1. Toolchain `24` → `25`, `vendor = ADOPTIUM` entfernt (kein foojay-Resolver im Repo → kein Auto-Download)
2. `files('libs/libusb4java-1.3.0-darwin-aarch64.jar')` → `'org.usb4java:libusb4java:1.3.0:linux-aarch64'` (Maven Central)
3. Neuer Task `repl` (JavaExec, mainClass `org.g2fx.g2lib.Main`, `standardInput = System.in`)

`gradle compileJava`: **BUILD SUCCESSFUL** (3 min 57 s, inkl. JavaFX 26 linux-aarch64 — auch g2gui kompiliert).

## REPL-Test gegen echten G2

`gradle --no-daemon -q repl` (via `ssh -tt`):

- Prompt: `ModularG2/New Performance/A:HipHop beat box/v7/VA>` — Gerätename, Performance, Slot-Patch, Variation, Area live vom G2 gelesen
- `list` → alle 36 Module der Voice-Area korrekt (DrumSynth, SeqLev, FltNord, Scratch, …)
- `help` → Kommandos: `listEntries`, `fileLoad`, `load`, `slot`, `var`, `mod`, `pset`, `led`, `record`/`play`, `comm`, `offline`

### Beobachtung (offen)

- `var 1` / `var 2` änderte den Prompt nicht (blieb `v7`) — klären, ob Anzeige-Lag, 0-Index oder Bug; ggf. Upstream fragen. Schreibpfad (`pset`) noch nicht getestet.

## Nächste Schritte (Phase 2)

- `scripts/vendor-g2lib.sh e75c6d0` ausführen, Backend-Build auf dieselben Fixes heben
- Javalin-Bridge gegen `MockG2Service` → dann `G2LibService`-Adapter
- systemd-Unit aus `deploy/` aufs Gerät
