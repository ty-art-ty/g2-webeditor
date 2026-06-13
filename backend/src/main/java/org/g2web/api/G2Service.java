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

    /**
     * Aktiven Slot mit einem leeren Init-Patch überschreiben (Module/Kabel weg,
     * Settings/Morphs/Global-Knobs auf Default). Sendet den frischen Patch ans
     * Gerät, verwirft den Undo-Verlauf und broadcastet danach den neuen
     * {@code patchState}.
     *
     * @throws IllegalStateException ohne angeschlossenen G2
     */
    void initPatch();

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

    /**
     * Morph-Gruppen-Label setzen (morph 0–7, max 7 ASCII-Zeichen). Schreibt die
     * komplette Morph-Label-Sektion (0x5b) ans Gerät und broadcastet
     * "morphLabelsChanged". Nicht im Undo-Verlauf (wie Patch-Settings).
     */
    void renameMorph(int morph, String label);

    /** Modulfarbe setzen (0–24, Index in MODULE_COLORS). Broadcastet "moduleColorChanged". */
    void setModuleColor(String area, int module, int color);

    /**
     * Letzte Mutation rückgängig machen bzw. wiederholen. Die Wirkung kommt als
     * normale Broadcasts (moduleMoved/cableAdded/…) zurück; leerer Stack = no-op.
     * Der Verlauf wird bei Patch-Wechsel verworfen.
     */
    void undo();

    void redo();

    // ---------------- Performance-Mode ----------------

    /** Perf-Bank-Liste vom Gerät (analog getBanks, EntryType Performance). */
    List<Map<String, Object>> getPerfBanks();

    /**
     * Ganze Performance aus einer Perf-Bank laden (1-indexiert). Das Gerät baut
     * danach alle 4 Slots neu auf; der Server broadcastet den frischen patchState.
     */
    void loadPerf(int bank, int entry);

    /** Master-Clock-BPM setzen (30–240). Broadcastet "perfSettingsChanged". */
    void setMasterClock(int bpm);

    /** Master-Clock starten/stoppen. Broadcastet "perfSettingsChanged". */
    void setClockRun(boolean run);

    /** Keyboard-Split global an/aus. Broadcastet "perfSettingsChanged". */
    void setKeyboardRangeEnabled(boolean enabled);

    /**
     * Slot-Einstellung setzen (slot 0–3). key: enabled|keyboard|hold (0/1)
     * oder keyFrom|keyTo (MIDI-Note 0–127). Broadcastet "perfSettingsChanged".
     */
    void setPerfSlotSetting(int slot, String key, int value);

    /** Performance umbenennen (max 16 ASCII-Zeichen). Broadcastet "perfSettingsChanged". */
    void renamePerf(String name);

    /**
     * Aktuelle Performance in einen Perf-Bank-Platz speichern (1-indexiert wie
     * loadPerf; gespeichert wird unter dem aktuellen Perf-Namen). Das Gerät
     * bestätigt mit einer aktualisierten Bank-Liste → Broadcast "banksChanged",
     * Clients laden /api/perfbanks neu.
     */
    void storePerf(int bank, int entry);

    /**
     * Param einem Global Knob zuweisen (knob 0–119 = Seite 1–5 × Reihe A–C × 8;
     * slot 0–3, area "va"|"fx"|"settings"). Ein belegter Knob wird überschrieben.
     * Broadcastet "globalKnobsChanged" (nach Geräte-Echo der Zuweisungsliste).
     */
    void assignGlobalKnob(int knob, int slot, String area, int module, int param);

    /** Global-Knob-Zuweisung lösen (knob 0–119). Broadcastet "globalKnobsChanged". */
    void deassignGlobalKnob(int knob);

    /** Eine serialisierte Clavia-Datei mit Vorschlags-Dateinamen (inkl. Endung). */
    record ExportFile(String filename, byte[] data) {}

    /**
     * Aktiven Slot als Clavia-Patch-Datei (.pch2) serialisieren (g2lib
     * {@code Patch.writeFile}: Header + Version + File-Sektionen + CRC16).
     */
    ExportFile exportPatch();

    /**
     * Gesamte Performance als Clavia-Performance-Datei (.prf2) serialisieren
     * (g2lib {@code Performance.writeFile}: Header + Version + PerfSettings +
     * 4 Slot-Patches + Global Knobs + CRC16).
     */
    ExportFile exportPerformance();

    /**
     * Eine Clavia-`.pch2`-Datei in den aktiven Slot importieren und auf das Gerät
     * schicken (g2lib {@code Performance.readPatchFromFile} → {@code sendPatch}).
     * Validiert Header + CRC; danach wird der neue `patchState` gebroadcastet und
     * der Undo-Verlauf verworfen (der gehört zum alten Patch).
     *
     * Der Patch-Name wird (Clavia-Konvention) aus {@code filename} abgeleitet.
     *
     * @throws IllegalStateException ohne angeschlossenen G2
     * @throws RuntimeException bei ungültiger Datei (falscher Header / CRC-Fehler)
     */
    void importPatch(byte[] data, String filename);

    /**
     * Eine Clavia-`.prf2`-Datei als GESAMTE Performance importieren (ersetzt alle
     * 4 Slots + Perf-Settings + Global Knobs) und auf das Gerät schicken (g2lib
     * {@code Devices.loadFile} → {@code Performance.sendPerf}). Validiert die Datei
     * vorab per Voll-Parse; danach wird die Live-Performance getauscht, alle
     * Listener neu gebunden und `patchState` gebroadcastet.
     *
     * Der Perf-Name wird (Clavia-Konvention) aus {@code filename} abgeleitet.
     *
     * @throws IllegalStateException ohne angeschlossenen G2
     * @throws RuntimeException bei ungültiger Datei (falscher Header / Parse-Fehler)
     */
    void importPerformance(byte[] data, String filename);

    /** Events vom G2 (Param-Änderungen am Gerät, Patch-Wechsel, Connect/Disconnect). */
    void onEvent(Consumer<Map<String, Object>> listener);
}
