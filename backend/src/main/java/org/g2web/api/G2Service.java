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
     * Aktiven Slot wechseln (0–3 = A–D). Verwirft den Undo-Verlauf und broadcastet
     * danach den kompletten patchState des neuen Slots. Slot-Wechsel am Gerät
     * (Panel-Taste) lösen denselben Broadcast aus.
     */
    void selectSlot(int slot);

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

    /**
     * Modul duplizieren (Typ, Parameter aller Variationen, Farbe, Name, Labels).
     * Neuen Index vergibt der Server. Broadcastet "moduleAdded" wie addModule.
     */
    void copyModule(String area, int module, int col, int row);

    /**
     * Mehrere Module einer Area als starrer Block verschieben (ein Undo-Eintrag).
     * {@code moves} = Tripel {module, col, row}. Die Selektion behält ihre Positionen,
     * überlappende Bestands-Module rutschen darunter. Je Modul ein "moduleMoved".
     */
    void moveModules(String area, List<int[]> moves);

    /**
     * Mehrere Module löschen (ein Undo-Eintrag, Undo restauriert auch alle Kabel —
     * inkl. der internen zwischen selektierten Modulen). Broadcasts wie deleteModule.
     */
    void deleteModules(String area, List<Integer> modules);

    /**
     * Selektion duplizieren: Module (tiefe Param-Kopie wie copyModule) als starrer
     * Block um (dCol,dRow) versetzt, interne Kabel (beide Enden in der Selektion)
     * mit kopiert. Broadcastet je Kopie "moduleAdded", je Kabel "cableAdded" und
     * zum Schluss "selectionCopied" mit den neuen Indizes (ein Undo-Eintrag).
     */
    void copySelection(String area, List<Integer> modules, int dCol, int dRow);

    /**
     * Modul-Mode setzen (statische Modul-Params wie ClkDiv DivMode; eine
     * Wertemenge für alle Variationen). Broadcastet "modeChanged".
     */
    void setMode(String area, int module, int mode, int value);

    /**
     * Morph-Zuweisung eines Params setzen/ändern/löschen (range 0 = löschen,
     * -128…127, negativ = invertiert). area auch "settings". Broadcastet
     * "morphChanged" und ist im Undo-Verlauf.
     */
    void setMorph(String area, int module, int param, int morph, int range, int variation);

    /** Modul umbenennen (max 16 ASCII-Zeichen). Broadcastet "moduleRenamed". */
    void renameModule(String area, int module, String name);

    /** Modulfarbe setzen (0–24, Index in MODULE_COLORS). Broadcastet "moduleColorChanged". */
    void setModuleColor(String area, int module, int color);

    /**
     * Letzte Mutation rückgängig machen bzw. wiederholen. Die Wirkung kommt als
     * normale Broadcasts (moduleMoved/cableAdded/…) zurück; leerer Stack = no-op.
     * Der Verlauf wird bei Patch-Wechsel verworfen.
     */
    void undo();

    void redo();

    /** Events vom G2 (Param-Änderungen am Gerät, Patch-Wechsel, Connect/Disconnect). */
    void onEvent(Consumer<Map<String, Object>> listener);
}
