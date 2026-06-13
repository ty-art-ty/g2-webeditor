package org.g2web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import io.javalin.http.staticfiles.Location;
import io.javalin.websocket.WsContext;
import org.g2web.api.G2Service;
import org.g2web.api.MockG2Service;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * g2web Bridge: REST + WebSocket vor einem G2Service.
 * Start: ./gradlew run  (MockG2Service, Port 8080)
 * Mit Hardware: -Dg2web.service=usb (sobald G2LibService implementiert ist).
 */
public final class Main {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<WsContext> clients = ConcurrentHashMap.newKeySet();

    public static void main(String[] args) {
        G2Service g2 = createService();

        // G2 -> alle Browser-Clients
        g2.onEvent(event -> broadcast(event));

        Javalin app = Javalin.create(cfg -> {
            // Frontend-Build (frontend/dist) wird als Root serviert
            cfg.staticFiles.add("/public", Location.CLASSPATH);
        });

        // --- REST ---
        app.get("/api/status", ctx -> ctx.json(Map.of(
                "connected", g2.isConnected(),
                "service", g2.getClass().getSimpleName())));
        app.get("/api/patch", ctx -> ctx.json(g2.getPatchState()));
        app.get("/api/banks", ctx -> ctx.json(g2.getBanks()));
        app.get("/api/perfbanks", ctx -> ctx.json(g2.getPerfBanks()));
        app.post("/api/perf/load", ctx -> {
            JsonNode req = JSON.readTree(ctx.body());
            g2.loadPerf(req.get("bank").asInt(), req.get("slot").asInt());
            ctx.status(202);
        });
        app.post("/api/patch/load", ctx -> {
            JsonNode req = JSON.readTree(ctx.body());
            g2.loadPatch(req.get("bank").asInt(), req.get("slot").asInt());
            ctx.status(202);
        });
        app.post("/api/perf/store", ctx -> {
            JsonNode req = JSON.readTree(ctx.body());
            g2.storePerf(req.get("bank").asInt(), req.get("slot").asInt());
            ctx.status(202); // Bestätigung kommt als banksChanged via WS
        });
        // Export als Datei-Download (Clavia .pch2/.prf2). Dateiname vom Server
        // (Patch-/Perf-Name); ohne angeschlossenen G2 → 503.
        app.get("/api/patch/export", ctx -> serveExport(ctx, g2::exportPatch));
        app.get("/api/perf/export", ctx -> serveExport(ctx, g2::exportPerformance));
        // Import einer .pch2 in den aktiven Slot (Roh-Body). Ohne G2 → 503,
        // ungültige Datei (Header/CRC) → 400; Erfolg → 202, patchState via WS.
        app.post("/api/patch/import", ctx -> {
            try {
                g2.importPatch(ctx.bodyAsBytes());
                ctx.status(202);
            } catch (IllegalStateException | UnsupportedOperationException e) {
                ctx.status(503).result(e.getMessage() == null ? "nicht verfügbar" : e.getMessage());
            } catch (RuntimeException e) {
                Throwable c = e.getCause() != null ? e.getCause() : e;
                ctx.status(400).result("Import fehlgeschlagen: "
                        + (c.getMessage() == null ? c.toString() : c.getMessage()));
            }
        });

        // --- WebSocket: Echtzeit-Param-Sync ---
        app.ws("/ws", ws -> {
            ws.onConnect(ctx -> {
                clients.add(ctx);
                ctx.send(JSON.writeValueAsString(g2.getPatchState()));
            });
            ws.onClose(clients::remove);
            ws.onMessage(ctx -> {
                JsonNode msg = JSON.readTree(ctx.message());
                switch (msg.get("type").asText()) {
                    case "setParam" -> g2.setParam(
                            msg.has("area") ? msg.get("area").asText() : "va",
                            msg.get("module").asInt(),
                            msg.get("param").asInt(),
                            msg.get("value").asInt(),
                            msg.get("variation").asInt());
                    case "selectVariation" -> g2.selectVariation(msg.get("variation").asInt());
                    case "selectSlot" -> g2.selectSlot(msg.get("slot").asInt());
                    case "moveModule" -> g2.moveModule(
                            msg.has("area") ? msg.get("area").asText() : "va",
                            msg.get("module").asInt(),
                            msg.get("col").asInt(),
                            msg.get("row").asInt());
                    case "addCable" -> g2.addCable(
                            msg.has("area") ? msg.get("area").asText() : "va",
                            msg.get("from").get("module").asInt(),
                            msg.get("from").get("conn").asInt(),
                            !msg.has("fromOutput") || msg.get("fromOutput").asBoolean(),
                            msg.get("to").get("module").asInt(),
                            msg.get("to").get("conn").asInt());
                    case "deleteCable" -> g2.deleteCable(
                            msg.has("area") ? msg.get("area").asText() : "va",
                            msg.get("from").get("module").asInt(),
                            msg.get("from").get("conn").asInt(),
                            !msg.has("fromOutput") || msg.get("fromOutput").asBoolean(),
                            msg.get("to").get("module").asInt(),
                            msg.get("to").get("conn").asInt());
                    case "addModule" -> g2.addModule(
                            msg.has("area") ? msg.get("area").asText() : "va",
                            msg.get("typeName").asText(),
                            msg.get("col").asInt(),
                            msg.get("row").asInt());
                    case "deleteModule" -> g2.deleteModule(
                            msg.has("area") ? msg.get("area").asText() : "va",
                            msg.get("module").asInt());
                    case "copyModule" -> g2.copyModule(
                            msg.has("area") ? msg.get("area").asText() : "va",
                            msg.get("module").asInt(),
                            msg.get("col").asInt(),
                            msg.get("row").asInt());
                    case "moveModules" -> {
                        var moves = new java.util.ArrayList<int[]>();
                        for (JsonNode mv : msg.get("moves")) {
                            moves.add(new int[]{mv.get("module").asInt(),
                                    mv.get("col").asInt(), mv.get("row").asInt()});
                        }
                        g2.moveModules(msg.has("area") ? msg.get("area").asText() : "va", moves);
                    }
                    case "deleteModules" -> g2.deleteModules(
                            msg.has("area") ? msg.get("area").asText() : "va",
                            intList(msg.get("modules")));
                    case "copySelection" -> g2.copySelection(
                            msg.has("area") ? msg.get("area").asText() : "va",
                            intList(msg.get("modules")),
                            msg.get("dCol").asInt(),
                            msg.get("dRow").asInt());
                    case "setMode" -> g2.setMode(
                            msg.has("area") ? msg.get("area").asText() : "va",
                            msg.get("module").asInt(),
                            msg.get("mode").asInt(),
                            msg.get("value").asInt());
                    case "setMorph" -> g2.setMorph(
                            msg.has("area") ? msg.get("area").asText() : "va",
                            msg.get("module").asInt(),
                            msg.get("param").asInt(),
                            msg.get("morph").asInt(),
                            msg.get("range").asInt(),
                            msg.get("variation").asInt());
                    case "renameModule" -> g2.renameModule(
                            msg.has("area") ? msg.get("area").asText() : "va",
                            msg.get("module").asInt(),
                            msg.get("name").asText());
                    case "setModuleColor" -> g2.setModuleColor(
                            msg.has("area") ? msg.get("area").asText() : "va",
                            msg.get("module").asInt(),
                            msg.get("color").asInt());
                    case "undo" -> g2.undo();
                    case "redo" -> g2.redo();
                    case "loadPerf" -> g2.loadPerf(
                            msg.get("bank").asInt(), msg.get("slot").asInt());
                    case "setMasterClock" -> g2.setMasterClock(msg.get("bpm").asInt());
                    case "setClockRun" -> g2.setClockRun(msg.get("run").asBoolean());
                    case "setKeyboardRangeEnabled" -> g2.setKeyboardRangeEnabled(
                            msg.get("enabled").asBoolean());
                    case "setPerfSlotSetting" -> g2.setPerfSlotSetting(
                            msg.get("slot").asInt(),
                            msg.get("key").asText(),
                            msg.get("value").asInt());
                    case "renamePerf" -> g2.renamePerf(msg.get("name").asText());
                    case "storePerf" -> g2.storePerf(
                            msg.get("bank").asInt(), msg.get("slot").asInt());
                    case "assignGlobalKnob" -> g2.assignGlobalKnob(
                            msg.get("knob").asInt(),
                            msg.get("slot").asInt(),
                            msg.has("area") ? msg.get("area").asText() : "va",
                            msg.get("module").asInt(),
                            msg.get("param").asInt());
                    case "deassignGlobalKnob" -> g2.deassignGlobalKnob(
                            msg.get("knob").asInt());
                    default -> { /* unbekannte Message ignorieren, siehe docs/protocol.md */ }
                }
            });
        });

        app.start(Integer.getInteger("g2web.port", 8080));
    }

    private static java.util.List<Integer> intList(JsonNode arr) {
        var out = new java.util.ArrayList<Integer>();
        for (JsonNode n : arr) out.add(n.asInt());
        return out;
    }

    /** ExportFile als Datei-Download ausliefern; ohne Hardware → 503. */
    private static void serveExport(io.javalin.http.Context ctx,
            java.util.function.Supplier<G2Service.ExportFile> supplier) {
        try {
            G2Service.ExportFile f = supplier.get();
            ctx.contentType("application/octet-stream")
               .header("Content-Disposition", "attachment; filename=\"" + f.filename() + "\"")
               .result(f.data());
        } catch (UnsupportedOperationException | IllegalStateException e) {
            ctx.status(503).result(e.getMessage() == null ? "nicht verfügbar" : e.getMessage());
        }
    }

    private static G2Service createService() {
        if ("usb".equals(System.getProperty("g2web.service"))) {
            return new org.g2web.usb.G2LibService();
        }
        return new MockG2Service();
    }

    private static void broadcast(Object event) {
        try {
            String json = JSON.writeValueAsString(event);
            clients.forEach(c -> { if (c.session.isOpen()) c.send(json); });
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private Main() {}
}
