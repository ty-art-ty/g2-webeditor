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
    private static final int S_SET_MODULE_COLOR = 0x31;
    private static final int S_SET_MODULE_LABEL = 0x33;

    private final Devices devices;
    private final List<Consumer<Map<String, Object>>> listeners = new CopyOnWriteArrayList<>();

    // ---------------- Undo/Redo ----------------
    // Die PerfAction-Closures laufen IMMER auf dem g2lib-Executor-Thread; die
    // Stacks selbst sind per undoLock synchronisiert, weil clearUndo auch vom
    // Slot-Wechsel-Listener kommen kann (Gerät-initiiert -> Dispatcher-Thread).

    /** Aktion auf dem Executor-Thread; Closures kapseln Vorher-/Nachher-Zustand. */
    private interface PerfAction { void run(Performance p) throws Exception; }

    private record UndoEntry(String label, PerfAction undo, PerfAction redo) {}

    private static final int UNDO_LIMIT = 100;
    private final Object undoLock = new Object();
    private final java.util.ArrayDeque<UndoEntry> undoStack = new java.util.ArrayDeque<>();
    private final java.util.ArrayDeque<UndoEntry> redoStack = new java.util.ArrayDeque<>();

    /** Neue Nutzeraktion: Undo-Eintrag stapeln, Redo-Verlauf verwerfen. */
    private void pushUndo(String label, PerfAction undo, PerfAction redo) {
        synchronized (undoLock) {
            undoStack.push(new UndoEntry(label, undo, redo));
            while (undoStack.size() > UNDO_LIMIT) undoStack.pollLast();
            redoStack.clear();
        }
    }

    private void clearUndo() {
        synchronized (undoLock) {
            undoStack.clear();
            redoStack.clear();
        }
    }

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
                clearUndo(); // frischer Slot-Inhalt → alter Undo-Verlauf ungültig
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
            clearUndo(); // Undo-Verlauf gehört zum alten Patch
            int slotCode = devices.getCurrentPerf().getSelectedSlot().ordinal();
            d.getEntries().loadEntry(slotCode, bank - 1, entry - 1);
        });
    }

    @Override
    public void undo() {
        devices.runWithCurrentPerf(p -> {
            UndoEntry e;
            synchronized (undoLock) { e = undoStack.poll(); }
            if (e == null) return;
            try {
                e.undo().run(p);
                synchronized (undoLock) { redoStack.push(e); }
            } catch (Exception ex) {
                // z.B. Ziel existiert nicht mehr — Eintrag verwerfen statt Stack vergiften
                log.log(Level.WARNING, "undo fehlgeschlagen: " + e.label(), ex);
            }
        });
    }

    @Override
    public void redo() {
        devices.runWithCurrentPerf(p -> {
            UndoEntry e;
            synchronized (undoLock) { e = redoStack.poll(); }
            if (e == null) return;
            try {
                e.redo().run(p);
                synchronized (undoLock) { undoStack.push(e); }
            } catch (Exception ex) {
                log.log(Level.WARNING, "redo fehlgeschlagen: " + e.label(), ex);
            }
        });
    }

    @Override
    public void selectSlot(int slot) {
        devices.runWithCurrentPerf(p -> {
            if (slot < 0 || slot > 3) throw new IllegalArgumentException("Slot 0–3: " + slot);
            if (p.getPerfSettings().selectedSlot().get() == slot) return;
            // Lokal setzen — LibProperty sendet nicht; der Listener auf selectedSlot
            // (attachListeners) übernimmt clearUndo + patchState-Broadcast …
            p.getPerfSettings().selectedSlot().set(slot);
            // … und explizit ans Gerät als Perf-Request (CMD_REQ+CMD_SYS = 0x2c, wie
            // BVerhue CreateSelectSlotMessage): [01, 2c, perfVersion, 09, slot]
            p.getSelectedPatch().getSlotSender().getSender().sendPerfRequest(
                    p.getVersion(), "select-slot",
                    org.g2fx.g2lib.protocol.Codes.O_SELECT_SLOT, slot);
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
            // Vorher-Koordinaten für Undo sichern
            Map<Integer, int[]> before = snapshotCoords(patch.getArea(areaId));
            // Lokalen State setzen — column()/row() sind intFieldProperty und senden
            // NICHT (gleiche Falle wie variation, siehe docs/phase3-ergebnis.md) …
            m.getUserModuleData().column().set(col);
            m.getUserModuleData().row().set(row);
            // Kollisionen auflösen (kann auch das bewegte Modul selbst verschieben,
            // wenn es mitten in einem anderen landet) …
            List<PatchModule> pushed = resolveCollisions(patch.getArea(areaId), module);
            // … dann explizit als Slot-Request ans Gerät. Wire-Format wie die
            // Referenz-Editoren (BVerhue S_MOV_MODULE=0x34, G2-Edit usbComms.c):
            //   [01, 0x28+slot, version, 0x34, location(FX=0/VA=1), index, col, row]
            // AreaId-Ordinals (Fx=0, Voice=1) entsprechen der Protokoll-Location.
            // Kein g2lib-Listener auf coords -> selbst broadcasten. Optimistisch:
            // G2-Antwort (0x7f OK / 0x7e Error) läuft async über den Dispatcher und
            // landet nur im Log — bei Verdacht journalctl prüfen.
            sendMoveAndEmit(patch, areaId, area, m);
            for (PatchModule c : pushed) {
                if (c.getIndex() != module) sendMoveAndEmit(patch, areaId, area, c);
            }
            // Undo: alle effektiv verschobenen Module auf die alten Koords zurück
            List<int[]> oldMoves = new ArrayList<>(), newMoves = new ArrayList<>();
            coordDiff(patch.getArea(areaId), before, oldMoves, newMoves);
            if (!newMoves.isEmpty()) {
                pushUndo("moveModule",
                        p2 -> applyMoves(p2, area, oldMoves),
                        p2 -> applyMoves(p2, area, newMoves));
            }
        });
    }

    /** Koordinaten aller Module einer Area: index -> {col,row}. */
    private static Map<Integer, int[]> snapshotCoords(PatchArea pa) {
        Map<Integer, int[]> out = new LinkedHashMap<>();
        for (PatchModule m : pa.getModules()) {
            out.put(m.getIndex(), new int[]{
                    m.getUserModuleData().column().get(), m.getUserModuleData().row().get()});
        }
        return out;
    }

    /** Diff gegen Snapshot: alte und neue {index,col,row} der geänderten Module. */
    private static void coordDiff(PatchArea pa, Map<Integer, int[]> before,
                                  List<int[]> oldMoves, List<int[]> newMoves) {
        for (PatchModule m : pa.getModules()) {
            int[] old = before.get(m.getIndex());
            int col = m.getUserModuleData().column().get();
            int row = m.getUserModuleData().row().get();
            if (old != null && (old[0] != col || old[1] != row)) {
                oldMoves.add(new int[]{m.getIndex(), old[0], old[1]});
                newMoves.add(new int[]{m.getIndex(), col, row});
            }
        }
    }

    /** Moves {index,col,row} anwenden: lokal setzen + senden + emitten (ohne Kollisionslogik). */
    private void applyMoves(Performance p, String area, List<int[]> moves) throws Exception {
        AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
        Patch patch = p.getSelectedPatch();
        for (int[] mv : moves) {
            PatchModule m = patch.getArea(areaId).getModule(mv[0]);
            m.getUserModuleData().column().set(mv[1]);
            m.getUserModuleData().row().set(mv[2]);
            sendMoveAndEmit(patch, areaId, area, m);
        }
    }

    /** S_MOV_MODULE für die aktuellen (lokalen) Koordinaten senden + moduleMoved emitten. */
    private void sendMoveAndEmit(Patch patch, AreaId areaId, String area, PatchModule m)
            throws Exception {
        int col = m.getUserModuleData().column().get();
        int row = m.getUserModuleData().row().get();
        patch.getSlotSender().sendSlotRequest("move-module",
                S_MOV_MODULE, areaId.ordinal(), m.getIndex(), col, row);
        emit(Map.of("type", "moduleMoved", "area", area,
                "module", m.getIndex(), "col", col, "row", row));
    }

    /**
     * Überlappungen in der Spalte des selektierten (bewegten/neuen) Moduls auflösen —
     * Algorithmus wie g2gui {@code MoveableModule.resolveCollisions}: liegt der obere
     * Rand des selektierten Moduls mitten in einem anderen, rutscht es unter dieses;
     * alle weiteren nicht-selektierten darunter kaskadieren nach unten. Wendet die
     * Änderungen nur lokal an und liefert die geänderten Module (Senden macht der Aufrufer).
     */
    private static List<PatchModule> resolveCollisions(PatchArea pa, int selectedIndex) {
        List<PatchModule> changed = new ArrayList<>();
        Map<Integer, List<PatchModule>> byCol = new java.util.TreeMap<>();
        for (PatchModule m : pa.getModules()) {
            byCol.computeIfAbsent(m.getUserModuleData().column().get(),
                    k -> new ArrayList<>()).add(m);
        }
        for (List<PatchModule> colMods : byCol.values()) {
            colMods.sort(java.util.Comparator.comparingInt(G2LibService::rowOf));
            PatchModule sel = colMods.stream()
                    .filter(m -> m.getIndex() == selectedIndex).findFirst().orElse(null);
            if (sel == null) continue; // andere Spalten nicht anfassen (wie g2gui)
            List<PatchModule> unselecteds = new ArrayList<>(colMods);
            unselecteds.remove(sel);
            unselecteds.removeIf(m -> rowOf(m) + heightOf(m) <= rowOf(sel)); // oberhalb
            if (unselecteds.isEmpty()) continue;
            PatchModule topUnsel = unselecteds.get(0);
            if (rowOf(topUnsel) < rowOf(sel)) {
                // Selektiertes liegt im Bauch des oberen Moduls -> direkt darunter
                unselecteds.remove(0);
                sel.getUserModuleData().row().set(rowOf(topUnsel) + heightOf(topUnsel));
                changed.add(sel);
            }
            PatchModule top = sel;
            for (PatchModule m : unselecteds) {
                if (rowOf(top) + heightOf(top) <= rowOf(m)) break;
                m.getUserModuleData().row().set(rowOf(top) + heightOf(top));
                changed.add(m);
                top = m;
            }
        }
        return changed;
    }

    private static int rowOf(PatchModule m) { return m.getUserModuleData().row().get(); }

    private static int heightOf(PatchModule m) { return m.getUserModuleData().getType().height; }

    @Override
    public void addCable(String area, int fromModule, int fromConn, boolean fromOutput,
                         int toModule, int toConn) {
        devices.runWithCurrentPerf(p -> {
            if (findCable(p.getSelectedPatch().getArea(
                            "fx".equals(area) ? AreaId.Fx : AreaId.Voice),
                    fromModule, fromConn, toModule, toConn) != null) {
                return; // existiert schon — idempotent, kein Senden/Broadcast/Undo
            }
            addCableInternal(p, area, fromModule, fromConn, fromOutput, toModule, toConn, null);
            pushUndo("addCable",
                    p2 -> deleteCableInternal(p2, area, fromModule, fromConn,
                            fromOutput, toModule, toConn),
                    p2 -> addCableInternal(p2, area, fromModule, fromConn,
                            fromOutput, toModule, toConn, null));
        });
    }

    /**
     * Kabel anlegen ohne Undo-Buchhaltung; {@code colorOverride} erzwingt eine
     * Farbe (für Undo/Restore), sonst bestimmt sie der Quell-Connector.
     */
    private void addCableInternal(Performance p, String area, int fromModule, int fromConn,
                                  boolean fromOutput, int toModule, int toConn,
                                  Integer colorOverride) throws Exception {
        {
            AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
            PatchArea pa = p.getSelectedPatch().getArea(areaId);
            PatchModule from = pa.getModule(fromModule); // wirft bei unbekanntem Index
            pa.getModule(toModule);
            if (findCable(pa, fromModule, fromConn, toModule, toConn) != null) {
                return; // idempotent
            }
            int color = colorOverride != null ? colorOverride
                    : cableColorOf(from, fromConn, fromOutput);
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
        }
    }

    @Override
    public void deleteCable(String area, int fromModule, int fromConn, boolean fromOutput,
                            int toModule, int toConn) {
        devices.runWithCurrentPerf(p -> {
            AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
            PatchCable cable = findCable(p.getSelectedPatch().getArea(areaId),
                    fromModule, fromConn, toModule, toConn);
            if (cable == null) throw new IllegalArgumentException(
                    "Unbekanntes Kabel: " + area + " " + fromModule + ":" + fromConn
                            + " -> " + toModule + ":" + toConn);
            int color = cable.getColor(); // fürs Undo erhalten (Add würde neu berechnen)
            deleteCableInternal(p, area, fromModule, fromConn, fromOutput, toModule, toConn);
            pushUndo("deleteCable",
                    p2 -> addCableInternal(p2, area, fromModule, fromConn,
                            fromOutput, toModule, toConn, color),
                    p2 -> deleteCableInternal(p2, area, fromModule, fromConn,
                            fromOutput, toModule, toConn));
        });
    }

    /** Kabel löschen ohne Undo-Buchhaltung; wirft, wenn es nicht existiert. */
    private void deleteCableInternal(Performance p, String area, int fromModule, int fromConn,
                                     boolean fromOutput, int toModule, int toConn)
            throws Exception {
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
            // Vorher-Koordinaten (ohne das neue Modul) für Undo der Verdrängungen
            Map<Integer, int[]> before = snapshotCoords(pa);
            before.remove(index);
            // Kollisionen auflösen; das neue Modul kann dabei selbst verrutschen —
            // dann Korrektur als Move nachsenden (das Add ging mit Wunsch-Koords raus).
            // moduleAdded kommt zuletzt und trägt bereits die finalen Koordinaten.
            List<PatchModule> pushed = resolveCollisions(pa, index);
            for (PatchModule c : pushed) {
                if (c.getIndex() == index) {
                    patch.getSlotSender().sendSlotRequest("move-module", S_MOV_MODULE,
                            areaId.ordinal(), index,
                            c.getUserModuleData().column().get(),
                            c.getUserModuleData().row().get());
                } else {
                    sendMoveAndEmit(patch, areaId, area, c);
                }
            }
            emit(Map.of("type", "moduleAdded", "module", moduleOf(m, area)));
            // Undo: Modul wieder weg + Verdrängte zurück; Redo: exakt restaurieren.
            // Record erst NACH den Kollisionen bauen (finale Koordinaten).
            var rec = new org.g2fx.g2gui.module.ModuleDelta.UserModuleRecord(m);
            List<int[]> oldMoves = new ArrayList<>(), newMoves = new ArrayList<>();
            coordDiff(pa, before, oldMoves, newMoves);
            pushUndo("addModule",
                    p2 -> {
                        deleteModuleInternal(p2, area, index);
                        applyMoves(p2, area, oldMoves);
                    },
                    p2 -> {
                        restoreModule(p2, area, rec, List.of());
                        applyMoves(p2, area, newMoves);
                    });
        });
    }

    @Override
    public void copyModule(String area, int module, int col, int row) {
        devices.runWithCurrentPerf(p -> {
            AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
            Patch patch = p.getSelectedPatch();
            PatchArea pa = patch.getArea(areaId);
            PatchModule src = pa.getModule(module); // wirft bei unbekanntem Index
            int index = pa.getModules().stream()
                    .mapToInt(PatchModule::getIndex).max().orElse(0) + 1;
            var rec = deepCopyRecord(src, areaId, index, col, row);
            List<PatchModule> created = pa.createModules(
                    new org.g2fx.g2gui.module.ModuleDelta(List.of(rec), List.of(), true));
            PatchModule m = created.get(0);
            attachModuleParamListeners(patch.getSlot().name(), area, m);
            // Ab hier identisch zu addModule: Kollisionen, Emits, Undo
            Map<Integer, int[]> before = snapshotCoords(pa);
            before.remove(index);
            List<PatchModule> pushed = resolveCollisions(pa, index);
            for (PatchModule c : pushed) {
                if (c.getIndex() == index) {
                    patch.getSlotSender().sendSlotRequest("move-module", S_MOV_MODULE,
                            areaId.ordinal(), index,
                            c.getUserModuleData().column().get(),
                            c.getUserModuleData().row().get());
                } else {
                    sendMoveAndEmit(patch, areaId, area, c);
                }
            }
            emit(Map.of("type", "moduleAdded", "module", moduleOf(m, area)));
            var recFinal = new org.g2fx.g2gui.module.ModuleDelta.UserModuleRecord(m);
            List<int[]> oldMoves = new ArrayList<>(), newMoves = new ArrayList<>();
            coordDiff(pa, before, oldMoves, newMoves);
            pushUndo("copyModule",
                    p2 -> {
                        deleteModuleInternal(p2, area, index);
                        applyMoves(p2, area, oldMoves);
                    },
                    p2 -> {
                        restoreModule(p2, area, recFinal, List.of());
                        applyMoves(p2, area, newMoves);
                    });
        });
    }

    /**
     * UserModuleRecord als TIEFE Kopie eines Moduls an neuer Position mit neuem
     * Index — wie ModuleDelta.UserModuleRecord.duplicate(), aber mit frischen
     * Parameterwerten: FieldValues.copy() ist flach, und setParamValues übernimmt
     * Referenzen — sonst teilte das Duplikat seine VarParams mit der Quelle
     * (Ändern am einen änderte beide). mkDefaultParams baut frische FieldValues
     * je Variation. (Modes/Labels bleiben geteilt — im Web-UI nicht editierbar,
     * im Add-Wire nur gelesen.)
     */
    private static org.g2fx.g2gui.module.ModuleDelta.UserModuleRecord deepCopyRecord(
            PatchModule src, AreaId areaId, int index, int col, int row) {
        List<org.g2fx.g2lib.protocol.FieldValues> paramCopies = null;
        if (src.getValues() != null) {
            paramCopies = new ArrayList<>();
            for (int v = 0; v < PatchModule.MAX_VARIATIONS; v++) {
                paramCopies.add(org.g2fx.g2lib.state.ParamValues.mkDefaultParams(
                        src.getVarValues(v), v));
            }
        }
        return new org.g2fx.g2gui.module.ModuleDelta.UserModuleRecord(
                src.name().get(),
                src.getUserModuleData().getValues().copy()
                        .update(org.g2fx.g2lib.protocol.Protocol.UserModule.Index.value(index))
                        .update(org.g2fx.g2lib.protocol.Protocol.UserModule.Column.value(col))
                        .update(org.g2fx.g2lib.protocol.Protocol.UserModule.Row.value(row)),
                areaId, paramCopies, src.getModuleLabelsValues());
    }

    @Override
    public void copySelection(String area, List<Integer> moduleIds, int dCol, int dRow) {
        devices.runWithCurrentPerf(p -> {
            AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
            Patch patch = p.getSelectedPatch();
            PatchArea pa = patch.getArea(areaId);
            // Quellen in stabiler Index-Reihenfolge; getModule wirft bei unbekanntem Index
            List<PatchModule> srcs = new ArrayList<>();
            for (int id : new java.util.TreeSet<>(moduleIds)) srcs.add(pa.getModule(id));
            // Interne Kabel (BEIDE Enden in der Selektion) vor dem Anlegen sichern
            java.util.Set<Integer> sel = new java.util.HashSet<>(moduleIds);
            List<CableSnap> internal = pa.getCables().stream()
                    .filter(c -> sel.contains(c.getSrcModule()) && sel.contains(c.getDestModule()))
                    .map(c -> new CableSnap(c.getSrcModule(), c.getSrcConn(), c.getDirection(),
                            c.getDestModule(), c.getDestConn(), c.getColor()))
                    .toList();
            Map<Integer, int[]> before = snapshotCoords(pa); // ohne die Kopien
            // Kopien als starrer Block am Offset anlegen; Index-Mapping alt -> neu
            Map<Integer, Integer> newIx = new LinkedHashMap<>();
            int next = pa.getModules().stream()
                    .mapToInt(PatchModule::getIndex).max().orElse(0) + 1;
            List<PatchModule> copies = new ArrayList<>();
            for (PatchModule src : srcs) {
                int index = next++;
                newIx.put(src.getIndex(), index);
                var rec = deepCopyRecord(src, areaId, index,
                        src.getUserModuleData().column().get() + dCol,
                        src.getUserModuleData().row().get() + dRow);
                PatchModule m = pa.createModules(new org.g2fx.g2gui.module.ModuleDelta(
                        List.of(rec), List.of(), true)).get(0);
                attachModuleParamListeners(patch.getSlot().name(), area, m);
                copies.add(m);
            }
            // Kollisionen: Anders als beim Einzel-Move weicht hier NICHT die Selektion
            // aus (der Block bliebe sonst nicht starr) — überlappende Bestands-Module
            // rutschen unter den Block und kaskadieren.
            for (PatchModule c : resolveCollisionsMulti(pa, new java.util.HashSet<>(newIx.values()))) {
                sendMoveAndEmit(patch, areaId, area, c);
            }
            for (PatchModule m : copies) {
                emit(Map.of("type", "moduleAdded", "module", moduleOf(m, area)));
            }
            // Interne Kabel auf die neuen Indizes umgeschrieben nachziehen (Farbe erhalten)
            List<CableSnap> newCables = new ArrayList<>();
            for (CableSnap c : internal) {
                newCables.add(new CableSnap(newIx.get(c.fromModule()), c.fromConn(),
                        c.fromOutput(), newIx.get(c.toModule()), c.toConn(), c.color()));
            }
            for (CableSnap c : newCables) {
                addCableInternal(p, area, c.fromModule(), c.fromConn(), c.fromOutput(),
                        c.toModule(), c.toConn(), c.color());
            }
            List<Integer> newIds = List.copyOf(newIx.values());
            // Kommt zuletzt: Client kann damit die frischen Kopien selektieren
            emit(Map.of("type", "selectionCopied", "area", area, "modules", newIds));
            // Undo: Kopien löschen (Kabel kaskadieren) + Verdrängte zurück;
            // Redo: aus finalen Records restaurieren + Kabel + Verdrängungen.
            List<org.g2fx.g2gui.module.ModuleDelta.UserModuleRecord> recs = copies.stream()
                    .map(org.g2fx.g2gui.module.ModuleDelta.UserModuleRecord::new).toList();
            List<int[]> oldMoves = new ArrayList<>(), newMoves = new ArrayList<>();
            coordDiff(pa, before, oldMoves, newMoves); // Kopien fehlen in before -> ignoriert
            pushUndo("copySelection",
                    p2 -> {
                        for (int id : newIds) deleteModuleInternal(p2, area, id);
                        applyMoves(p2, area, oldMoves);
                    },
                    p2 -> {
                        for (var rec : recs) restoreModule(p2, area, rec, List.of());
                        for (CableSnap c : newCables) {
                            addCableInternal(p2, area, c.fromModule(), c.fromConn(),
                                    c.fromOutput(), c.toModule(), c.toConn(), c.color());
                        }
                        applyMoves(p2, area, newMoves);
                        emit(Map.of("type", "selectionCopied", "area", area, "modules", newIds));
                    });
        });
    }

    @Override
    public void moveModules(String area, List<int[]> moves) {
        devices.runWithCurrentPerf(p -> {
            AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
            Patch patch = p.getSelectedPatch();
            PatchArea pa = patch.getArea(areaId);
            Map<Integer, int[]> before = snapshotCoords(pa);
            // Selektion starr auf die Zielpositionen setzen (nur lokal) …
            java.util.Set<Integer> sel = new java.util.HashSet<>();
            java.util.Set<PatchModule> changed = new java.util.LinkedHashSet<>();
            for (int[] mv : moves) {
                PatchModule m = pa.getModule(mv[0]); // wirft bei unbekanntem Index
                m.getUserModuleData().column().set(mv[1]);
                m.getUserModuleData().row().set(mv[2]);
                sel.add(mv[0]);
                changed.add(m);
            }
            // … Kollisionen wie bei copySelection (Block gewinnt), dann senden/emitten
            changed.addAll(resolveCollisionsMulti(pa, sel));
            for (PatchModule m : changed) sendMoveAndEmit(patch, areaId, area, m);
            List<int[]> oldMoves = new ArrayList<>(), newMoves = new ArrayList<>();
            coordDiff(pa, before, oldMoves, newMoves);
            if (!newMoves.isEmpty()) {
                pushUndo("moveModules",
                        p2 -> applyMoves(p2, area, oldMoves),
                        p2 -> applyMoves(p2, area, newMoves));
            }
        });
    }

    @Override
    public void deleteModules(String area, List<Integer> moduleIds) {
        devices.runWithCurrentPerf(p -> {
            AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
            PatchArea pa = p.getSelectedPatch().getArea(areaId);
            java.util.Set<Integer> sel = new java.util.HashSet<>(moduleIds);
            List<Integer> ids = new ArrayList<>(new java.util.TreeSet<>(moduleIds));
            List<org.g2fx.g2gui.module.ModuleDelta.UserModuleRecord> recs = new ArrayList<>();
            for (int id : ids) {
                recs.add(new org.g2fx.g2gui.module.ModuleDelta.UserModuleRecord(pa.getModule(id)));
            }
            // ALLE betroffenen Kabel EINMAL sichern — über Einzel-Snapshots je Modul
            // gäbe es Duplikate für Kabel zwischen zwei selektierten Modulen
            List<CableSnap> cables = pa.getCables().stream()
                    .filter(c -> sel.contains(c.getSrcModule()) || sel.contains(c.getDestModule()))
                    .map(c -> new CableSnap(c.getSrcModule(), c.getSrcConn(), c.getDirection(),
                            c.getDestModule(), c.getDestConn(), c.getColor()))
                    .toList();
            for (int id : ids) deleteModuleInternal(p, area, id);
            pushUndo("deleteModules",
                    p2 -> {
                        // erst ALLE Module restaurieren, dann die Kabel (interne brauchen beide Enden)
                        for (var rec : recs) restoreModule(p2, area, rec, List.of());
                        for (CableSnap c : cables) {
                            addCableInternal(p2, area, c.fromModule(), c.fromConn(),
                                    c.fromOutput(), c.toModule(), c.toConn(), c.color());
                        }
                    },
                    p2 -> {
                        for (int id : ids) deleteModuleInternal(p2, area, id);
                    });
        });
    }

    /**
     * Kollisionsauflösung für eine SELEKTION: anders als {@link #resolveCollisions}
     * (Einzelmodul weicht nach unten aus) behalten die selektierten Module ihre
     * Positionen — der Block bleibt starr. Nicht-selektierte Module, die in einer
     * Spalte mit Selektion überlappen, rutschen unter das unterste überlappende
     * Modul und kaskadieren. Nur lokal; Senden/Emitten macht der Aufrufer.
     */
    private static List<PatchModule> resolveCollisionsMulti(PatchArea pa, java.util.Set<Integer> selected) {
        List<PatchModule> changed = new ArrayList<>();
        Map<Integer, List<PatchModule>> byCol = new java.util.TreeMap<>();
        for (PatchModule m : pa.getModules()) {
            byCol.computeIfAbsent(m.getUserModuleData().column().get(),
                    k -> new ArrayList<>()).add(m);
        }
        for (List<PatchModule> colMods : byCol.values()) {
            if (colMods.stream().noneMatch(m -> selected.contains(m.getIndex()))) continue;
            colMods.sort(java.util.Comparator.comparingInt(G2LibService::rowOf));
            List<PatchModule> placed = new ArrayList<>(); // Selektion = fix
            for (PatchModule m : colMods) {
                if (selected.contains(m.getIndex())) placed.add(m);
            }
            for (PatchModule m : colMods) {
                if (selected.contains(m.getIndex())) continue;
                int row = rowOf(m);
                boolean moved = true;
                while (moved) { // unter alle Überlapper rutschen (Kaskade über placed)
                    moved = false;
                    for (PatchModule f : placed) {
                        if (rowOf(f) < row + heightOf(m) && rowOf(f) + heightOf(f) > row) {
                            row = rowOf(f) + heightOf(f);
                            moved = true;
                        }
                    }
                }
                if (row != rowOf(m)) {
                    m.getUserModuleData().row().set(row);
                    changed.add(m);
                }
                placed.add(m);
            }
        }
        return changed;
    }

    /** Schnappschuss eines Kabels fürs Wiederherstellen. */
    private record CableSnap(int fromModule, int fromConn, boolean fromOutput,
                             int toModule, int toConn, int color) {}

    /**
     * Modul aus einem UserModuleRecord wiederherstellen (für Undo von delete bzw.
     * Redo von add): volle Add-Message via createModules, Listener, moduleAdded,
     * danach die gesicherten Kabel.
     */
    private void restoreModule(Performance p, String area,
                               org.g2fx.g2gui.module.ModuleDelta.UserModuleRecord rec,
                               List<CableSnap> cables) throws Exception {
        AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
        Patch patch = p.getSelectedPatch();
        PatchArea pa = patch.getArea(areaId);
        List<PatchModule> created = pa.createModules(new org.g2fx.g2gui.module.ModuleDelta(
                List.of(rec), List.of(), true));
        PatchModule m = created.get(0);
        attachModuleParamListeners(patch.getSlot().name(), area, m);
        emit(Map.of("type", "moduleAdded", "module", moduleOf(m, area)));
        for (CableSnap c : cables) {
            addCableInternal(p, area, c.fromModule(), c.fromConn(), c.fromOutput(),
                    c.toModule(), c.toConn(), c.color());
        }
    }

    @Override
    public void renameModule(String area, int module, String name) {
        String n = name.length() > 16 ? name.substring(0, 16) : name;
        devices.runWithCurrentPerf(p -> {
            AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
            String old = p.getSelectedPatch().getArea(areaId).getModule(module).name().get();
            renameInternal(p, area, module, n);
            pushUndo("renameModule",
                    p2 -> renameInternal(p2, area, module, old),
                    p2 -> renameInternal(p2, area, module, n));
        });
    }

    private void renameInternal(Performance p, String area, int module, String n)
            throws Exception {
        AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
        Patch patch = p.getSelectedPatch();
        PatchModule m = patch.getArea(areaId).getModule(module);
        m.name().set(n); // lokal — stringFieldProperty sendet nicht
        // Wire-Format (BVerhue AddSetModuleLabelMessage):
        //   [0x33, location, index, name als Clavia-String (\0-terminiert wenn <16)]
        byte[] nb = n.getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        byte[] msg = new byte[3 + nb.length + (nb.length < 16 ? 1 : 0)];
        msg[0] = (byte) S_SET_MODULE_LABEL;
        msg[1] = (byte) areaId.ordinal();
        msg[2] = (byte) module;
        System.arraycopy(nb, 0, msg, 3, nb.length);
        patch.getSlotSender().sendSlotRequest("rename-module", msg);
        emit(Map.of("type", "moduleRenamed", "area", area, "module", module, "name", n));
    }

    @Override
    public void setModuleColor(String area, int module, int color) {
        devices.runWithCurrentPerf(p -> {
            AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
            int old = p.getSelectedPatch().getArea(areaId).getModule(module)
                    .getUserModuleData().color().get();
            setColorInternal(p, area, module, color);
            pushUndo("setModuleColor",
                    p2 -> setColorInternal(p2, area, module, old),
                    p2 -> setColorInternal(p2, area, module, color));
        });
    }

    private void setColorInternal(Performance p, String area, int module, int color)
            throws Exception {
        AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
        Patch patch = p.getSelectedPatch();
        PatchModule m = patch.getArea(areaId).getModule(module);
        m.getUserModuleData().color().set(color); // lokal
        // Wire-Format (BVerhue AddSetModuleColorMessage): [0x31, location, index, color]
        patch.getSlotSender().sendSlotRequest("set-module-color",
                S_SET_MODULE_COLOR, areaId.ordinal(), module, color);
        emit(Map.of("type", "moduleColorChanged",
                "area", area, "module", module, "color", color));
    }

    @Override
    public void deleteModule(String area, int module) {
        devices.runWithCurrentPerf(p -> {
            AreaId areaId = "fx".equals(area) ? AreaId.Fx : AreaId.Voice;
            PatchArea pa = p.getSelectedPatch().getArea(areaId);
            PatchModule m = pa.getModule(module); // wirft bei unbekanntem Index
            // Vollständigen Zustand fürs Undo sichern: Modul-Record + hängende Kabel
            var rec = new org.g2fx.g2gui.module.ModuleDelta.UserModuleRecord(m);
            List<CableSnap> cables = pa.getCables().stream()
                    .filter(c -> c.getSrcModule() == module || c.getDestModule() == module)
                    .map(c -> new CableSnap(c.getSrcModule(), c.getSrcConn(),
                            c.getDirection(), c.getDestModule(), c.getDestConn(),
                            c.getColor()))
                    .toList();
            deleteModuleInternal(p, area, module);
            pushUndo("deleteModule",
                    p2 -> restoreModule(p2, area, rec, cables),
                    p2 -> deleteModuleInternal(p2, area, module));
        });
    }

    /** Modul (samt hängender Kabel) löschen ohne Undo-Buchhaltung. */
    private void deleteModuleInternal(Performance p, String area, int module) throws Exception {
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
        // Alle 4 Slots (A–D) mit Patch-Namen für die Slot-Leiste im UI
        List<Map<String, Object>> slots = new ArrayList<>();
        for (Patch sp : perf.slots()) {
            String n = sp.name().get();
            slots.add(Map.of("slot", sp.getSlot().name(), "name", n == null ? "" : n));
        }
        out.put("slots", slots);

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
        // Slot-Wechsel (von uns lokal gesetzt ODER vom Gerät via readSlotChange,
        // z.B. Panel-Taste): Undo-Verlauf gehört zum alten Slot, dann kompletten
        // patchState des neuen Slots broadcasten. Läuft ggf. auf Dispatcher-/
        // Executor-Thread: kein invoke, undoLock macht clearUndo threadsicher.
        perf.getPerfSettings().selectedSlot().addListener((o, n) -> {
            clearUndo();
            emit(patchStateOf(perf));
        });
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
