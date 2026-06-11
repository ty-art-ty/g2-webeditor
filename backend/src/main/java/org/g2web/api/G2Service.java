package org.g2web.api;

import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Abstraktion über den G2. Implementierungen:
 * - MockG2Service: Entwicklung/Frontend-Arbeit ohne Hardware
 * - G2LibService:  Adapter auf org.g2fx.g2lib (USB), siehe org.g2web.usb
 *
 * Nachrichtenformate: docs/protocol.md
 */
public interface G2Service {

    boolean isConnected();

    /** Aktueller Patch-State des gewählten Slots als JSON-serialisierbare Struktur. */
    Map<String, Object> getPatchState();

    /** Bank-/Patch-Liste vom Gerät. */
    List<Map<String, Object>> getBanks();

    void loadPatch(int bank, int slot);

    /** @param area "va" oder "fx" — Modul-Indizes sind nur pro Area eindeutig. */
    void setParam(String area, int module, int param, int value, int variation);

    void selectVariation(int variation);

    /**
     * Modul auf neue Grid-Position verschieben (col = Spalte à 255 px, row à 15 px).
     * Implementierung sendet ans Gerät und broadcastet danach "moduleMoved".
     */
    void moveModule(String area, int module, int col, int row);

    /**
     * Kabel hinzufügen. {@code to} ist immer ein Input; {@code fromOutput}=false
     * bedeutet In-zu-In-Kabel. Kabelfarbe bestimmt der Server aus dem Quell-Connector.
     * Implementierung sendet ans Gerät und broadcastet danach "cableAdded".
     */
    void addCable(String area, int fromModule, int fromConn, boolean fromOutput,
                  int toModule, int toConn);

    /** Kabel löschen (Identität wie in patchState). Broadcastet danach "cableDeleted". */
    void deleteCable(String area, int fromModule, int fromConn, boolean fromOutput,
                     int toModule, int toConn);

    /**
     * Neues Modul anlegen. typeName = shortName wie in module-defs.json/patchState.
     * Index und Name (typeName + laufende Nr.) vergibt der Server.
     * Broadcastet danach "moduleAdded" mit dem vollständigen Modul-Objekt.
     */
    void addModule(String area, String typeName, int col, int row);

    /**
     * Modul löschen. Hängende Kabel werden zuerst entfernt (je ein "cableDeleted"),
     * danach kommt "moduleDeleted".
     */
    void deleteModule(String area, int module);

    /** Modul umbenennen (max 16 ASCII-Zeichen). Broadcastet "moduleRenamed". */
    void renameModule(String area, int module, String name);

    /** Modulfarbe setzen (0–24, Index in MODULE_COLORS). Broadcastet "moduleColorChanged". */
    void setModuleColor(String area, int module, int color);

    /** Events vom G2 (Param-Änderungen am Gerät, Patch-Wechsel, Connect/Disconnect). */
    void onEvent(Consumer<Map<String, Object>> listener);
}
