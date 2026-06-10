# Phase 2 — Ergebnis (2026-06-10)

**Status: ✅ abgeschlossen.** Die Javalin-Bridge läuft als systemd-Service auf clockworkpi.local und spricht über g2lib mit dem echten G2. REST + WebSocket liefern echten Patch-State; Param-Änderungen gehen bidirektional.

## Verifiziert (gegen echten G2)

- `GET /api/status` → `{"connected":true,"service":"G2LibService"}`
- `GET /api/patch` → „HipHop beat box", 36 Module, 56 Kabel, echte Parameterwerte
- WS-Roundtrip (`scripts/ws-smoke.py`): `setParam` → USB-Write (`S_SET_PARAM`) → `paramChanged`-Broadcast an alle Clients ✓
- `systemctl restart` × 2 → verbindet jedes Mal sauber neu

## Umsetzung

- **g2lib vendored** (e75c6d0) nach `backend/src/main/java/org/g2fx/` inkl. dreier JavaFX-freier `g2gui`-Klassen, die g2lib importiert (`VoiceMode`, `IndexParam`, `ModuleDelta`). REPL-Klassen (`Eval*`, `Repl`, g2lib-`Main`) geleert — hängen an g2gui/jline; `repl/Path` bleibt (von `Devices` gebraucht). `logging.properties` nach `resources/org/g2fx/g2gui/` (sonst NPE in `Util.configureLogging`).
- **`G2LibService`**: Adapter auf `Devices`/`Performance`/`Patch`. Schreibweg über `PatchModule.getParamValueProperty(var,ix).set(v)` (sendet selbst USB). Events: eigene `LibProperty`-Listener auf allen Params aller Slots + `variation()`-Property → WS-Broadcast. Banks aus `Entries` (Snapshot via `getEventProp`).
- **Threading-Falle**: `devices.invoke*` niemals aus g2lib-Lifecycle-Callbacks aufrufen (Single-Thread-Executor → Deadlock). Callbacks arbeiten direkt mit dem übergebenen Objekt.
- **USB-Robustheit**: Ohne sauberes Release verweigert der G2 dem Folgeprozess die Verbindung. Daher (a) Shutdown-Hook (`devices.shutdown()` + `usbService.shutdown()`), (b) `ExecStartPre=+usbreset 0ffc:0002` in der Unit als Fallback.
- **systemd**: JVM-Props via `Environment=JAVA_OPTS=…` (Gradle-Startskript reicht Programm-Args nicht als `-D` durch).

## Bekannte Lücken (→ Phase 3)

1. **Modul-Indizes sind nur pro Area eindeutig** — `setParam` ohne Area-Angabe probiert Voice, dann Fx. Protokoll v0 um `area` erweitern (Events liefern es bereits).
2. `getVarValues`-NPE bei Modulen ohne Params → mit `getValues()==null`-Guard gelöst; upstream melden?
3. `loadPatch` (Bank-Load) ungetestet; `variation()`-Schreibweg zum Gerät ungetestet (vgl. Phase-1-Beobachtung zu `var`).
4. Frontend ist Platzhalter — Phase 3 (Patch-Browser, Param-UI).
5. Param-Listener werden bei Patch-Reload neu angehängt, alte Patches werden GC'd — Listener-Leak nur theoretisch, beobachten.

## Build/Deploy-Ablauf (Referenz)

```bash
rsync -az --delete --exclude build --exclude .gradle --exclude node_modules --exclude dist \
  ./ ossareta@clockworkpi.local:~/g2-webeditor/
ssh ossareta@clockworkpi.local 'cd ~/g2-webeditor/backend \
  && ~/opt/gradle-9.2.0/bin/gradle --no-daemon installDist \
  && sudo cp -r build/install/g2web-backend/. /opt/g2web/ \
  && sudo systemctl restart g2web'
# Smoke-Test:
ssh ossareta@clockworkpi.local 'python3 ~/g2-webeditor/scripts/ws-smoke.py'
```
