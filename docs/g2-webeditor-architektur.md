# G2 Web-Editor auf Headless Raspberry Pi — Architektur-Konzept

**Stand:** 2026-06-10 · **Autor:** Alex Leber (mit Claude) · **Status:** Entwurf

## 1. Ziel

Der Nord Modular G2 hängt per USB an einem headless Raspberry Pi. Der Patch-Editor ist als Web-App von jedem Gerät im LAN erreichbar (PC, Mac, Tablet/iPad). Kein Display, kein GUI-Toolkit auf dem Pi.

## 2. Ausgangslage / Repo-Bewertung

| Repo | Stack | Aktivität | Eignung |
|---|---|---|---|
| [sirlensalot/g2fx](https://github.com/sirlensalot/g2fx) | Java 24, JavaFX 26, usb4java, Gradle | sehr aktiv (06/2026) | **Basis** — `g2lib` ist GUI-frei |
| [chrispurusha/G2-Edit](https://github.com/chrispurusha/G2-Edit) | C/C++, GLFW/FreeType/libusb, Xcode | sehr aktiv (06/2026) | Referenz; Protokoll mit GUI verwoben, GPL-3 |
| [BVerhue/nord_g2_editor](https://github.com/BVerhue/nord_g2_editor) | Delphi/FMX | inaktiv (2021) | nur Protokoll-Referenz (bereits in g2fx portiert) |

Kernbefund: g2fx ist sauber getrennt in `g2lib` (76 Klassen: `usb`, `protocol`, `device`, `model`, `state`, `repl` — **null JavaFX-Imports**) und `g2gui` (JavaFX, 52 Klassen). `g2lib` läuft unverändert headless. Lizenz BSD-3-Clause — unkritisch für eigene Erweiterungen.

## 3. Systemarchitektur

```
┌─────────────┐  USB   ┌──────────────────────────────────┐   LAN    ┌──────────────┐
│  Nord G2     │◄──────►│ Raspberry Pi (headless, ARM64)    │◄────────►│ Browser       │
│              │        │                                    │          │ (PC/Tablet)   │
└─────────────┘        │  ┌──────────┐   ┌──────────────┐  │          │               │
                        │  │ g2lib     │◄─►│ Bridge        │  │  WS/HTTP │  SPA-Editor   │
                        │  │ (Java,    │   │ (Javalin:     │◄─┼─────────►│  (TS + SVG/   │
                        │  │ USB+Proto │   │ REST + WebSkt)│  │          │   Canvas)     │
                        │  │ +State)   │   │ + Static Files│  │          │               │
                        │  └──────────┘   └──────────────┘  │          └──────────────┘
                        │  systemd-Service · udev-Regel      │
                        └──────────────────────────────────┘
```

### 3.1 Backend (Pi)

- **g2lib** (unverändert übernehmen): USB-Kommunikation via usb4java/libusb, G2-Protokoll (Patch-Parsing, Messages, Performance/Patch-State).
- **Bridge** (Neuentwicklung, klein): Embedded-Webserver (Javalin oder Jetty) im selben JVM-Prozess.
  - `REST`: Patch laden/speichern, Bank-Browsing, Modul-Metadaten (aus den YAML-Definitionen von g2fx).
  - `WebSocket`: bidirektionaler Echtzeit-Kanal — Param-Änderungen Browser→G2, Knob-/Display-Updates G2→Browser. Nachrichtenformat JSON, später optional binär (CBOR) falls nötig.
  - Serviert das Frontend als statische Dateien → ein Prozess, ein Port.
- **State-Autorität liegt im Backend**: g2lib hält den Patch-State, Browser sind nur Views. Mehrere gleichzeitige Clients sind damit trivial (Broadcast über WebSocket).

### 3.2 Frontend (Browser)

- SPA in TypeScript; SVG für Module/Kabel (Hit-Testing, Zoom gratis), Canvas nur falls Performance es erfordert.
- Wiederverwendbar aus g2fx: Modul-Icons (`resources/module-icons`), Modul-/Param-Definitionen (YAML) — werden vom Backend als JSON ausgeliefert, Frontend bleibt datengetrieben.
- Framework: SolidJS oder React; keine harte Festlegung nötig, da die Logik im Backend liegt.

### 3.3 Pi-Systemintegration

- Pi 4 oder 5, 64-bit Raspberry Pi OS Lite, Temurin JDK (ARM64).
- udev-Regel für USB-Zugriff ohne root (Vendor-ID Clavia `0x0ffc`).
- systemd-Service mit Restart-Policy; G2-Hotplug über libusb-Hotplug-Events.
- usb4java: `linux-aarch64`-Natives via Maven Central (das im Repo gebundelte Darwin-JAR durch plattformabhängige Dependency ersetzen).

## 4. Roadmap

| Phase | Inhalt | Aufwand (grob) |
|---|---|---|
| 1 | g2lib headless auf Pi: Build-Fix (usb4java-Natives), REPL-Test gegen echten G2 | Tage |
| 2 | Bridge: Javalin + WebSocket, Patch-State als JSON, systemd/udev | 1–2 Wochen |
| 3 | Frontend MVP: Patch-/Bank-Browser, Param-Editing (Slider/Knobs), Variations | Wochen |
| 4 | Grafischer Patch-Editor: Module platzieren, Kabel-Routing, Copy/Paste | Monate |
| 5 | Komfort: Multi-Client, Undo/Redo, Patch-Bibliothek auf Pi, mDNS (`g2.local`) | inkrementell |

Phase 4 ist ~80 % des Gesamtaufwands; Phasen 1–3 liefern bereits ein nutzbares Produkt (Patch-Verwaltung + Sound-Tweaking vom Tablet).

## 5. Risiken & offene Punkte

- **g2fx ist WIP**: API von `g2lib` kann sich noch bewegen → Fork pinnen, Upstream-Kontakt zum Autor suchen (er hat Lib/GUI bewusst getrennt).
- **USB-Timing**: G2-Protokoll ist interrupt-lastig; auf Pi 4/5 unkritisch. Test-G2 ist vorhanden → ab Phase 1 direkt gegen echte Hardware testen.
- **CI ohne Hardware**: automatisierte Protokoll-Regressionen per Mitschnitt-Replay (g2fx hat Testdaten im Repo); manuelle Verifikation am vorhandenen G2.
- **iPad-Nutzung**: läuft über Browser — kein USB-Problem (löst BVerhues offenes iOS-Thema architektonisch).

## 6. Entscheidungen (vorgeschlagen)

1. Basis: Fork von g2fx, nur `g2lib` + Ressourcen nutzen; `g2gui` bleibt außen vor.
2. Bridge: Javalin (leichtgewichtig, WebSocket eingebaut) im selben Prozess.
3. Frontend: TypeScript + SVG, datengetrieben aus den g2fx-YAML-Moduldefinitionen.
4. Lizenz des eigenen Codes: BSD-3 oder MIT (kompatibel zu g2fx).
