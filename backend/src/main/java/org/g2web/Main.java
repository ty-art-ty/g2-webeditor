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
        app.post("/api/patch/load", ctx -> {
            JsonNode req = JSON.readTree(ctx.body());
            g2.loadPatch(req.get("bank").asInt(), req.get("slot").asInt());
            ctx.status(202);
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
                    default -> { /* unbekannte Message ignorieren, siehe docs/protocol.md */ }
                }
            });
        });

        app.start(Integer.getInteger("g2web.port", 8080));
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
