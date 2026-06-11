package org.g2web.api;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/** In-Memory-Fake eines G2: ein Demo-Patch mit zwei Modulen. Genug, um das Frontend zu entwickeln. */
public final class MockG2Service implements G2Service {

    private final List<Consumer<Map<String, Object>>> listeners = new ArrayList<>();
    private final Map<String, Integer> params = new ConcurrentHashMap<>();
    private volatile int variation = 0;

    @Override public boolean isConnected() { return true; }

    @Override
    public Map<String, Object> getPatchState() {
        return Map.of(
            "type", "patchState",
            "name", "MockPatch",
            "variation", variation,
            "modules", List.of(
                Map.of("id", 1, "typeName", "OscB", "row", 0, "col", 0,
                       "params", List.of(
                           Map.of("id", 0, "name", "Freq Coarse", "value", params.getOrDefault("1:0", 64), "max", 127),
                           Map.of("id", 1, "name", "Freq Fine",   "value", params.getOrDefault("1:1", 64), "max", 127))),
                Map.of("id", 2, "typeName", "FltClassic", "row", 1, "col", 0,
                       "params", List.of(
                           Map.of("id", 0, "name", "Freq", "value", params.getOrDefault("2:0", 75), "max", 127),
                           Map.of("id", 1, "name", "Res",  "value", params.getOrDefault("2:1", 20), "max", 127)))),
            "cables", List.of(
                Map.of("area", "va",
                       "from", Map.of("module", 1, "conn", 0),
                       "to",   Map.of("module", 2, "conn", 0),
                       "fromOutput", true, "color", "red")));
    }

    @Override
    public List<Map<String, Object>> getBanks() {
        return List.of(Map.of("bank", 1, "patches",
                List.of(Map.of("slot", 1, "name", "MockPatch"))));
    }

    @Override public void loadPatch(int bank, int slot) { emit(getPatchState()); }

    @Override
    public void moveModule(String area, int module, int col, int row) {
        emit(Map.of("type", "moduleMoved", "area", area,
                "module", module, "col", col, "row", row));
    }

    @Override
    public void addCable(String area, int fromModule, int fromConn, boolean fromOutput,
                         int toModule, int toConn) {
        emit(Map.of("type", "cableAdded", "area", area,
                "from", Map.of("module", fromModule, "conn", fromConn),
                "to", Map.of("module", toModule, "conn", toConn),
                "fromOutput", fromOutput, "color", "red"));
    }

    @Override
    public void deleteCable(String area, int fromModule, int fromConn, boolean fromOutput,
                            int toModule, int toConn) {
        emit(Map.of("type", "cableDeleted", "area", area,
                "from", Map.of("module", fromModule, "conn", fromConn),
                "to", Map.of("module", toModule, "conn", toConn)));
    }

    @Override
    public void addModule(String area, String typeName, int col, int row) {
        emit(Map.of("type", "moduleAdded", "module", Map.of(
                "id", 99, "area", area, "typeName", typeName, "name", typeName + "1",
                "row", row, "col", col, "color", 0, "params", List.of())));
    }

    @Override
    public void deleteModule(String area, int module) {
        emit(Map.of("type", "moduleDeleted", "area", area, "module", module));
    }

    @Override
    public void copyModule(String area, int module, int col, int row) {
        emit(Map.of("type", "moduleAdded", "module", Map.of(
                "id", 100, "area", area, "typeName", "OscB", "name", "Kopie",
                "row", row, "col", col, "color", 0, "params", List.of())));
    }

    @Override
    public void moveModules(String area, List<int[]> moves) {
        for (int[] mv : moves) moveModule(area, mv[0], mv[1], mv[2]);
    }

    @Override
    public void deleteModules(String area, List<Integer> modules) {
        for (int m : modules) deleteModule(area, m);
    }

    @Override
    public void copySelection(String area, List<Integer> modules, int dCol, int dRow) {
        List<Integer> newIds = new ArrayList<>();
        int next = 100;
        for (int m : modules) {
            int id = next++;
            newIds.add(id);
            emit(Map.of("type", "moduleAdded", "module", Map.of(
                    "id", id, "area", area, "typeName", "OscB", "name", "Kopie" + id,
                    "row", dRow, "col", dCol, "color", 0, "params", List.of())));
        }
        emit(Map.of("type", "selectionCopied", "area", area, "modules", newIds));
    }

    @Override
    public void setMode(String area, int module, int mode, int value) {
        emit(Map.of("type", "modeChanged", "area", area, "module", module,
                "mode", mode, "value", value));
    }

    @Override
    public void setMorph(String area, int module, int param, int morph, int range, int variation) {
        emit(Map.of("type", "morphChanged", "variation", variation, "area", area,
                "module", module, "param", param, "morph", morph, "range", range));
    }

    @Override
    public void renameModule(String area, int module, String name) {
        emit(Map.of("type", "moduleRenamed", "area", area, "module", module, "name", name));
    }

    @Override
    public void setModuleColor(String area, int module, int color) {
        emit(Map.of("type", "moduleColorChanged", "area", area, "module", module, "color", color));
    }

    @Override
    public void setParam(String area, int module, int param, int value, int var) {
        params.put(module + ":" + param, value);
        emit(Map.of("type", "paramChanged", "area", area, "module", module, "param", param,
                    "value", value, "variation", var));
    }

    @Override
    public void selectVariation(int v) {
        variation = v;
        emit(Map.of("type", "variationChanged", "variation", v));
    }

    @Override
    public void selectSlot(int slot) {
        emit(getPatchState());
    }

    @Override public void undo() { /* Mock: kein Verlauf */ }

    @Override public void redo() { /* Mock: kein Verlauf */ }

    @Override public void onEvent(Consumer<Map<String, Object>> l) { listeners.add(l); }

    private void emit(Map<String, Object> event) { listeners.forEach(l -> l.accept(event)); }
}
