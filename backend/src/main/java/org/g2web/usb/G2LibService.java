package org.g2web.usb;

import org.g2fx.g2lib.device.Device;
import org.g2fx.g2lib.device.DeviceListener;
import org.g2fx.g2lib.device.Devices;
import org.g2fx.g2lib.model.ModParam;
import org.g2fx.g2lib.model.NamedParam;
import org.g2fx.g2lib.state.AreaId;
import org.g2fx.g2lib.state.Entries;
import org.g2fx.g2lib.state.LifecycleListener;
import org.g2fx.g2lib.state.Patch;
import org.g2fx.g2lib.state.PatchArea;
import org.g2fx.g2lib.state.PatchCable;
import org.g2fx.g2lib.state.PatchModule;
import org.g2fx.g2lib.state.Performance;
import org.g2fx.g2lib.usb.UsbService;
import org.g2fx.g2lib.util.Util;
import org.g2web.api.G2Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Adapter G2Service -> org.g2fx.g2lib (vendored aus sirlensalot/g2fx @ e75c6d0, BSD-3).
 *
 * Threading: Alle g2lib-Zugriffe laufen über den Single-Thread-Executor von {@link Devices}
 * (invokeWithCurrentPerf/runWithCurrentPerf). ACHTUNG: g2lib-Lifecycle-Callbacks laufen teils
 * bereits AUF diesem Executor-Thread — dort niemals devices.invoke* aufrufen (Deadlock),
 * sondern direkt mit dem übergebenen Objekt arbeiten.
 */
public final class G2LibService implements G2Service {

    private static final Logger log = Logger.getLogger(G2LibService.class.getName());

    /** G2-Kabelfarben, Index = Farbcode im Protokoll. */
    private static final String[] CABLE_COLORS =
            {"red", "blue", "yellow", "orange", "green", "purple", "white"};

    /** S_MOV_MODULE der Referenz-Editoren — fehlt in g2lib {@code Codes}. */
    private static final int S_MOV_MODULE = 0x34;
    /** S_ADD_CABLE/S_DEL_CABLE der Referenz-Editoren — fehlen in g2lib {@code Codes}. */
    private static final int S_ADD_CABLE = 0x50;
    private static final int S_DEL_CABLE = 0x51;
    /** S_DEL_MODULE — fehlt ebenfalls; das Add übernimmt g2lib PatchArea.createModules. */
    private static final int S_DEL_MODULE = 0x32;

    private final Devices devices;
    private final List<Consumer<Map<String, Object>>> listeners = new CopyOnWriteArrayList<>();

    private volatile boolean connected;
    private volatile int variation = 0;
    /** Letzter Bank-Snapshot vom Gerät: type -> bank -> entry -> Entry. */
    private volatile Map<Entries.EntryType, Map<Integer, Map<Integer, Entries.Entry>>> banks = Map.of();

    public G2LibService() {
        Util.configureLogging();
        UsbService usbService = new UsbService();
        devices = new Devices(usbService);

        CountDownLatch initialized = new CountDownLatch(1);

        devices.addListener(new DeviceListener() {
            @Override
            public void onDeviceInitialized(Device d) {
                connected = d.online();
                // Bank-Snapshot abholen (Entries wurden in Device.initialize() gelesen)
                d.getEntries().getEventProp().addListener((o, n) -> {
                    if (n.entries() != null) banks = n.entries();
                });
                d.getEntries().fireRefreshAll();
                initialized.countDown();
                emit(Map.of("type", "connection", "connected", true));
            }

            @Override
            public void onDeviceDisposal(Device d) {
                connected = false;
                emit(Map.of("type", "connection", "connected", false));
            }
        });

        devices.addPerfListener(new LifecycleListener<>() {
            @Override
            public void onLifecycleInit(Performance p) {
                attachListeners(p);
                emit(patchStateOf(p)); // läuft ggf. auf Executor-Thread: kein invoke!
            }

            @Override
            public void onLifecycleDispose(Performance p) { /* noop */ }
        });

        // Patch in einen Slot nachgeladen (z.B. via loadPatch): Listener + Broadcast
        devices.addPatchListener(new LifecycleListener<>() {
            @Override
            public void onLifecycleInit(Patch p) {
                attachPatchListeners(p);
                Performance perf = devices.getCurrentPerf();
                if (perf != null) emit(patchStateOf(perf));
            }

            @Override
            public void onLifecycleDispose(Patch p) { /* noop */ }
        });

        usbService.start();

        // Ohne sauberes Release bleibt der G2 in einem Zustand, in dem der nächste
        // Prozess nicht mehr connecten kann (dann hilft nur usbreset).
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            try {
                devices.shutdown();
                usbService.shutdown();
            } catch (Exception e) {
                log.log(Level.WARNING, "USB-Shutdown fehlgeschlagen", e);
            }
        }, "g2-usb-shutdown"));

        try {
            if (!initialized.await(3, TimeUnit.SECONDS)) {
                log.warning("Kein G2 innerhalb von 3s initialisiert — warte auf Hotplug.");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    // ------------------------------------------------------------------ G2Service

    @Override
    public boolean isConnected() {
        return connected;
    }

    @Override
    public Map<String, Object> getPatchState() {
        if (!connected) {
            return Map.of("type", "patchState", "connected", false);
        }
        return devices.invokeWithCurrentPerf(this::patchStateOf);
    }

    @Override
    public List<Map<String, Object>> getBanks() {
        List<Map<String, Object>> out = new ArrayList<>();
        Map<Integer, Map<Integer, Entries.Entry>> patchBanks =
                banks.getOrDefault(Entries.EntryType.Patch, Map.of());
        patchBanks.forEach((bank, entries) -> {
            List<Map<String, Object>> patches = new ArrayList<>();
            entries.forEach((ix, e) -> patches.add(Map.of(
                    "slot", ix + 1, "name", e.name(), "category", e.category())));
            out.add(Map.of("bank", bank + 1, "patches", patches));
        });
        return out;
    }

    @Override
    public void loadPatch(int bank, int entry) {
        // Lädt in den aktuell gewählten Slot; 1-indexiert wie docs/protocol.md
        devices.runWithCurrent(d -> {
            int slotCode = devices.getCurrentPerf().getSelectedSlot().ordinal();
            d.getEntries().loadEntry(slotCode, bank - 1, entry - 1);
        });
    }

    @Override
    public void setParam(String area, int module, int param, int value, int variation) {
        devices.runWithCurrentPerf(p -> {
            AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
            PatchModule m = p.getSelectedPatch().getArea(areaId).getModule(module);
            if (m == null) throw new IllegalArgumentException(
                    "Unbekanntes Modul: " + area + "/" + module);
            m.getParamValueProperty(variation, param).set(value);
        });
    }

    @Override
    public void selectVariation(int v) {
        variation = v;
        devices.runWithCurrentPerf(p -> {
            Patch patch = p.getSelectedPatch();
            // Lokalen State setzen — sendet NICHT (intFieldProperty(..., false)) …
            patch.getPatchSettings().variation().set(v);
            // … daher explizit ans Gerät als Slot-Request (0x28+slot) — das Format der
            // Referenz-Editoren (BVerhue/G2-Edit). Empirie am echten G2:
            //   0x38-Kommando → ignoriert; "Panel-Format" ohne Rahmen → Error 0x7e.
            //   0x28-Request → OK (0x7f); Engine schaltet um (Panel-LED folgt ggf. nicht).
            patch.getSlotSender().sendSlotRequest("select-variation",
                    org.g2fx.g2lib.protocol.Codes.I_CHANGE_VARIATION, v);
        });
        // Kein explizites emit: der Listener auf patchSettings.variation()
        // (attachPatchListeners) broadcastet die Änderung bereits.
    }

    @Override
    public void moveModule(String area, int module, int col, int row) {
        devices.runWithCurrentPerf(p -> {
            AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
            Patch patch = p.getSelectedPatch();
            PatchModule m = patch.getArea(areaId).getModule(module);
            if (m == null) throw new IllegalArgumentException(
                    "Unbekanntes Modul: " + area + "/" + module);
            // Lokalen State setzen — column()/row() sind intFieldProperty und senden
            // NICHT (gleiche Falle wie variation, siehe docs/phase3-ergebnis.md) …
            m.getUserModuleData().column().set(col);
            m.getUserModuleData().row().set(row);
            // … daher explizit als Slot-Request ans Gerät. Wire-Format wie die
            // Referenz-Editoren (BVerhue S_MOV_MODULE=0x34, G2-Edit usbComms.c):
            //   [01, 0x28+slot, version, 0x34, location(FX=0/VA=1), index, col, row]
            // AreaId-Ordinals (Fx=0, Voice=1) entsprechen der Protokoll-Location.
            patch.getSlotSender().sendSlotRequest("move-module",
                    S_MOV_MODULE, areaId.ordinal(), module, col, row);
        });
        // Kein g2lib-Listener auf coords -> selbst broadcasten. Optimistisch:
        // G2-Antwort (0x7f OK / 0x7e Error) läuft async über den Dispatcher und
        // landet nur im Log — bei Verdacht journalctl prüfen (vgl. Variation-Lehrstück).
        emit(Map.of("type", "moduleMoved", "area", area,
                "module", module, "col", col, "row", row));
    }

    @Override
    public void addCable(String area, int fromModule, int fromConn, boolean fromOutput,
                         int toModule, int toConn) {
        devices.runWithCurrentPerf(p -> {
            AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
            PatchArea pa = p.getSelectedPatch().getArea(areaId);
            PatchModule from = pa.getModule(fromModule); // wirft bei unbekanntem Index
            pa.getModule(toModule);
            if (findCable(pa, fromModule, fromConn, toModule, toConn) != null) {
                return; // existiert schon — idempotent, kein Senden/Broadcast
            }
            int color = cableColorOf(from, fromConn, fromOutput);
            // Lokalen State pflegen (g2lib hat keine Mutations-API mit Senden) …
            pa.addCable(org.g2fx.g2lib.protocol.Protocol.Cable.FIELDS.values(
                    org.g2fx.g2lib.protocol.Protocol.Cable.Color.value(color),
                    org.g2fx.g2lib.protocol.Protocol.Cable.SrcModule.value(fromModule),
                    org.g2fx.g2lib.protocol.Protocol.Cable.SrcConn.value(fromConn),
                    org.g2fx.g2lib.protocol.Protocol.Cable.Direction.value(fromOutput),
                    org.g2fx.g2lib.protocol.Protocol.Cable.DestModule.value(toModule),
                    org.g2fx.g2lib.protocol.Protocol.Cable.DestConn.value(toConn)));
            // … und explizit ans Gerät. Wire-Format (BVerhue AddConnectionMessage,
            // G2-Edit eMsgCmdWriteCable — byte-identisch):
            //   [0x50, 0x10|loc<<3|farbe, fromMod, fromKind<<6|fromConn, toMod, toConn]
            // Kind: Input=0/Output=1; to ist immer Input (Kind 0). Location FX=0/VA=1.
            p.getSelectedPatch().getSlotSender().sendSlotRequest("add-cable",
                    S_ADD_CABLE,
                    0x10 | (areaId.ordinal() << 3) | color,
                    fromModule, ((fromOutput ? 1 : 0) << 6) | fromConn,
                    toModule, toConn);
            emit(Map.of("type", "cableAdded", "area", area,
                    "from", Map.of("module", fromModule, "conn", fromConn),
                    "to", Map.of("module", toModule, "conn", toConn),
                    "fromOutput", fromOutput, "color", cableColor(color)));
        });
    }

    @Override
    public void deleteCable(String area, int fromModule, int fromConn, boolean fromOutput,
                            int toModule, int toConn) {
        devices.runWithCurrentPerf(p -> {
            AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
            PatchArea pa = p.getSelectedPatch().getArea(areaId);
            PatchCable cable = findCable(pa, fromModule, fromConn, toModule, toConn);
            if (cable == null) throw new IllegalArgumentException(
                    "Unbekanntes Kabel: " + area + " " + fromModule + ":" + fromConn
                            + " -> " + toModule + ":" + toConn);
            pa.getCables().remove(cable);
            // Wire-Format (BVerhue AddDeleteConnectionMessage, G2-Edit eMsgCmdDeleteCable):
            //   [0x51, 0x02|loc, fromMod, fromKind<<6|fromConn, toMod, toKind<<6|toConn]
            p.getSelectedPatch().getSlotSender().sendSlotRequest("delete-cable",
                    S_DEL_CABLE,
                    0x02 | areaId.ordinal(),
                    fromModule, ((fromOutput ? 1 : 0) << 6) | fromConn,
                    toModule, toConn);
            emit(Map.of("type", "cableDeleted", "area", area,
                    "from", Map.of("module", fromModule, "conn", fromConn),
                    "to", Map.of("module", toModule, "conn", toConn)));
        });
    }

    @Override
    public void addModule(String area, String typeName, int col, int row) {
        devices.runWithCurrentPerf(p -> {
            AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
            Patch patch = p.getSelectedPatch();
            PatchArea pa = patch.getArea(areaId);
            org.g2fx.g2lib.model.ModuleType type = moduleTypeByShortName(typeName);
            if (type == null) throw new IllegalArgumentException(
                    "Unbekannter Modultyp: " + typeName);
            // Index: max+1 pro Area (wie BVerhue GetMaxModuleIndex+1);
            // Name: shortName + laufende Nr. (wie GetUniqueModuleNameSeqNr)
            int index = pa.getModules().stream()
                    .mapToInt(PatchModule::getIndex).max().orElse(0) + 1;
            long sameType = pa.getModules().stream()
                    .filter(m -> m.getUserModuleData().getType() == type).count();
            String name = type.shortName + (sameType + 1);
            // g2lib createModules baut die komplette Add-Message (0x30 + Cable-/
            // Param-/Label-/Name-Sektionen wie die Referenz-Editoren), sendet sie
            // als Slot-Request und pflegt den lokalen State.
            List<PatchModule> created = pa.createModules(
                    org.g2fx.g2gui.module.ModuleDelta.addNewModule(
                            areaId, type, index, name, 0,
                            new org.g2fx.g2lib.state.Coords(col, row)));
            PatchModule m = created.get(0);
            attachModuleParamListeners(patch.getSlot().name(), area, m);
            emit(Map.of("type", "moduleAdded", "module", moduleOf(m, area)));
        });
    }

    @Override
    public void deleteModule(String area, int module) {
        devices.runWithCurrentPerf(p -> {
            AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
            Patch patch = p.getSelectedPatch();
            PatchArea pa = patch.getArea(areaId);
            PatchModule m = pa.getModule(module); // wirft bei unbekanntem Index
            // Erst hängende Kabel löschen (wie G2-Edit action_delete_module),
            // dann das Modul selbst.
            List<PatchCable> attached = pa.getCables().stream()
                    .filter(c -> c.getSrcModule() == module || c.getDestModule() == module)
                    .toList();
            for (PatchCable c : attached) {
                pa.getCables().remove(c);
                patch.getSlotSender().sendSlotRequest("delete-cable", S_DEL_CABLE,
                        0x02 | areaId.ordinal(),
                        c.getSrcModule(), ((c.getDirection() ? 1 : 0) << 6) | c.getSrcConn(),
                        c.getDestModule(), c.getDestConn());
                emit(Map.of("type", "cableDeleted", "area", area,
                        "from", Map.of("module", c.getSrcModule(), "conn", c.getSrcConn()),
                        "to", Map.of("module", c.getDestModule(), "conn", c.getDestConn())));
            }
            pa.getModules().remove(m); // Collection-View der TreeMap → entfernt aus Map
            patch.getSlotSender().sendSlotRequest("delete-module", S_DEL_MODULE,
                    areaId.ordinal(), module);
            emit(Map.of("type", "moduleDeleted", "area", area, "module", module));
        });
    }

    private static org.g2fx.g2lib.model.ModuleType moduleTypeByShortName(String shortName) {
        for (org.g2fx.g2lib.model.ModuleType t : org.g2fx.g2lib.model.ModuleType.values()) {
            if (t.shortName.equals(shortName)) return t;
        }
        return null;
    }

    /** Kabel anhand seiner Endpunkte suchen (Identität wie im patchState). */
    private static PatchCable findCable(PatchArea pa, int fromModule, int fromConn,
                                        int toModule, int toConn) {
        for (PatchCable c : pa.getCables()) {
            if (c.getSrcModule() == fromModule && c.getSrcConn() == fromConn
                    && c.getDestModule() == toModule && c.getDestConn() == toConn) {
                return c;
            }
        }
        return null;
    }

    /**
     * Kabelfarbe aus dem Quell-Connector (g2lib ModuleType-Ports). Vereinfachung
     * gegenüber den Referenz-Editoren: keine Uprate-Logik — Blue_red (dynamische
     * Audio-Outs) wird rot, Yellow_orange gelb. Farbe ist rein kosmetisch.
     */
    private static int cableColorOf(PatchModule from, int conn, boolean output) {
        List<org.g2fx.g2lib.model.Connector> ports = output
                ? from.getUserModuleData().getType().outPorts
                : from.getUserModuleData().getType().inPorts;
        if (conn < 0 || conn >= ports.size()) return 1; // unbekannt -> blau
        return switch (ports.get(conn).color()) {
            case Red, Blue_red -> 0;          // rot
            case Blue -> 1;                   // blau
            case Yellow, Yellow_orange -> 2;  // gelb
        };
    }

    @Override
    public void onEvent(Consumer<Map<String, Object>> listener) {
        listeners.add(listener);
    }

    // ------------------------------------------------------------------ State -> JSON

    /** Patch-State des gewählten Slots. Nur auf dem g2lib-Thread bzw. via invoke aufrufen. */
    private Map<String, Object> patchStateOf(Performance perf) {
        Patch patch = perf.getSelectedPatch();
        // Aktive Variation steht in der Patch-Description (kommt beim Laden vom Gerät) —
        // nicht unseren lokalen Stand nehmen, sonst zeigt das Web nach Patch-Load falsch an.
        variation = currentVariationOf(patch);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("type", "patchState");
        out.put("connected", connected);
        out.put("perf", perf.getName());
        out.put("slot", patch.getSlot().name());
        out.put("name", patch.name().get());
        out.put("variation", variation);

        List<Map<String, Object>> modules = new ArrayList<>();
        List<Map<String, Object>> cables = new ArrayList<>();
        for (AreaId areaId : AreaId.USER_AREAS) {
            PatchArea area = patch.getArea(areaId);
            String areaName = areaId == AreaId.Voice ? "va" : "fx";
            for (PatchModule m : area.getModules()) {
                modules.add(moduleOf(m, areaName));
            }
            for (PatchCable c : area.getCables()) {
                cables.add(Map.of(
                        "area", areaName,
                        "from", Map.of("module", c.getSrcModule(), "conn", c.getSrcConn()),
                        "to", Map.of("module", c.getDestModule(), "conn", c.getDestConn()),
                        // direction=true: from ist ein Output; false: In-zu-In-Kabel
                        // (to ist immer ein Input). Wie g2gui AreaPane: getDirection() ? Out : In.
                        "fromOutput", c.getDirection(),
                        "color", cableColor(c.getColor())));
            }
        }
        out.put("modules", modules);
        out.put("cables", cables);
        return out;
    }

    private Map<String, Object> moduleOf(PatchModule m, String areaName) {
        var umd = m.getUserModuleData();
        List<NamedParam> defs = umd.getType().getParams();
        // Module ohne Params (z.B. reine Anzeige-/Settings-Module) haben keine ParamValues
        List<Integer> values = m.getValues() == null ? List.of() : m.getVarValues(variation);

        List<Map<String, Object>> params = new ArrayList<>();
        for (int i = 0; i < defs.size(); i++) {
            NamedParam np = defs.get(i);
            ModParam mp = np.param();
            params.add(Map.of(
                    "id", i,
                    "name", np.name(),
                    "value", i < values.size() ? values.get(i) : 0,
                    "min", mp.min,
                    "max", mp.max));
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", m.getIndex());
        out.put("area", areaName);
        out.put("typeName", umd.getType().shortName);
        out.put("name", m.name().get());
        out.put("row", umd.row().get());
        out.put("col", umd.column().get());
        out.put("color", umd.color().get());
        out.put("params", params);
        return out;
    }

    private int currentVariationOf(Patch patch) {
        try {
            Integer v = patch.getPatchSettings().variation().get();
            return v == null ? variation : v;
        } catch (RuntimeException e) {
            return variation;
        }
    }

    private static String cableColor(int code) {
        return code >= 0 && code < CABLE_COLORS.length ? CABLE_COLORS[code] : String.valueOf(code);
    }

    // ------------------------------------------------------------------ Events G2 -> Clients

    /** Param-/Variation-Listener auf alle Slots einer frisch initialisierten Performance. */
    private void attachListeners(Performance perf) {
        for (Patch p : perf.slots()) {
            attachPatchListeners(p);
        }
    }

    private void attachPatchListeners(Patch patch) {
        try {
            String slot = patch.getSlot().name();
            patch.getPatchSettings().variation().addListener((o, n) -> {
                variation = n;
                emit(Map.of("type", "variationChanged", "variation", n, "slot", slot));
            });
            for (AreaId areaId : AreaId.USER_AREAS) {
                String areaName = areaId == AreaId.Voice ? "va" : "fx";
                for (PatchModule m : patch.getArea(areaId).getModules()) {
                    attachModuleParamListeners(slot, areaName, m);
                }
            }
        } catch (Exception e) {
            log.log(Level.WARNING, "attachPatchListeners fehlgeschlagen", e);
        }
    }

    /** paramChanged-Broadcasts für ein Modul (auch für frisch angelegte Module). */
    private void attachModuleParamListeners(String slot, String areaName, PatchModule m) {
        if (m.getValues() == null) return;
        int moduleId = m.getIndex();
        int nParams = m.getUserModuleData().getType().getParams().size();
        for (int v = 0; v < PatchModule.MAX_VARIATIONS; v++) {
            for (int i = 0; i < nParams; i++) {
                final int var = v, param = i;
                m.getParamValueProperty(v, i).addListener((o, n) ->
                        emit(Map.of("type", "paramChanged",
                                "slot", slot, "area", areaName,
                                "module", moduleId, "param", param,
                                "value", n, "variation", var)));
            }
        }
    }

    private void emit(Map<String, Object> event) {
        listeners.forEach(l -> {
            try {
                l.accept(event);
            } catch (Exception e) {
                log.log(Level.WARNING, "Event-Listener-Fehler", e);
            }
        });
    }

    private PatchModule findModule(Patch patch, int index) {
        // Voice zuerst (Modul-Indizes sind nur PRO AREA eindeutig — bekannte v0-Protokoll-Lücke,
        // siehe docs/protocol.md). getModule wirft bei unbekanntem Index.
        for (AreaId areaId : new AreaId[]{AreaId.Voice, AreaId.Fx}) {
            try {
                PatchModule m = patch.getArea(areaId).getModule(index);
                if (m != null) return m;
            } catch (RuntimeException ignored) {
                // Index in dieser Area unbekannt — nächste Area probieren
            }
        }
        return null;
    }
}
