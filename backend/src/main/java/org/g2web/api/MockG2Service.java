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

    @Override public void onEvent(Consumer<Map<String, Object>> l) { listeners.add(l); }

    private void emit(Map<String, Object> event) { listeners.forEach(l -> l.accept(event)); }
}
