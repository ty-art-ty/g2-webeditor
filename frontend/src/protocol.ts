// TypeScript-Spiegel von docs/protocol.md — bei Änderungen beide Seiten pflegen.

export type Area = 'va' | 'fx';

export interface Param {
  id: number; name: string; value: number; min: number; max: number;
  /** Serverseitig formatierter Anzeigetext (enums/Formatter aus g2lib). */
  text?: string;
}
/** Modul-Mode (statischer Param, eine Wertemenge für alle Variationen). */
export interface Mode {
  id: number; name: string; value: number; min: number; max: number; enums?: string[];
}
export interface Module {
  id: number; area: Area; typeName: string; name: string;
  row: number; col: number; color: number; params: Param[]; modes?: Mode[];
  /**
   * Letzte LED-/VU-Werte (nur Client-State, kommt aus "visuals"-Broadcasts).
   * Key "led:<g>" = Einzel-LED, "meter:<g>" = VU/LED-Gruppe (g = GroupId).
   */
  visuals?: Record<string, number>;
}
export interface Cable {
  area: Area;
  from: { module: number; conn: number };
  to: { module: number; conn: number };
  /** true: from ist ein Output; false: In-zu-In-Kabel. to ist immer ein Input. */
  fromOutput: boolean;
  color: string;
}

// Statisch ausgeliefert: /module-defs.json (generiert aus g2fx, scripts/gen-module-defs.py)
export interface ConnDef { x: number; y: number; type: 'audio' | 'control' | 'logic'; name: string; }
/**
 * Control auf der Modulfläche (Original-Layout aus g2fx module-uis.yaml).
 * Felder je nach cls; p = Param-Index (bzw. Mode-Index bei mode=true,
 * MasterRef bei TextField). deps: Param-Indizes, "S<n>" = Mode-Index.
 */
export interface ControlDef {
  cls: string; x: number; y: number; p?: number;
  t?: string; ts?: string[]; len?: number; vert?: boolean; thick?: boolean;
  sym?: string; w?: number; h?: number; img?: string; imgs?: string[]; iw?: number;
  kt?: string; push?: boolean; n?: number; bw?: number; cols?: number; rows?: number;
  deps?: (number | string)[]; tf?: number; mode?: boolean; lt?: string;
  /** Led/MiniVU: GroupId = Visual-Index am Wire; grp: LED gehört zu einer Gruppe
   *  (Wert kommt über "meters", an wenn Gruppenwert == p/CodeRef). */
  g?: number; grp?: boolean;
  /** Graph: GraphFunc-Nummer (Kurventyp); Param-Refs stehen in deps. */
  gf?: number;
}
export interface ModuleDef {
  ix: number; height: number; inputs: ConnDef[]; outputs: ConnDef[];
  controls: ControlDef[];
}
export type ModuleDefs = Record<string, ModuleDef>;
/** /param-tables.json — Konstanten für die TextFunc-Formatter (null = -Inf). */
export type ParamTables = Record<string, (number | string | null)[]>;

/** Performance-Einstellungen eines Slots (Perf-Settings-Section 0x11). */
export interface PerfSlotSettings {
  slot: string; enabled: boolean; keyboard: boolean; hold: boolean;
  /** Keyboard-Range (MIDI-Note 0–127), greift nur bei keyboardRangeEnabled. */
  keyFrom: number; keyTo: number;
}
export interface PerfSettings {
  name: string; clockBpm: number; clockRun: boolean;
  keyboardRangeEnabled: boolean; slots: PerfSlotSettings[];
}
/** Broadcast nach jeder Perf-Settings-Änderung (auch Gerät-initiiert). */
export interface PerfSettingsChanged extends PerfSettings { type: 'perfSettingsChanged'; }

export interface PatchState {
  type: 'patchState'; connected: boolean;
  perf: string; slot: string; name: string; variation: number;
  /** Alle 4 Slots (A–D) mit Patch-Namen für die Slot-Leiste. */
  slots?: { slot: string; name: string }[];
  /** Performance-Settings (Name, Master-Clock, Slot-Flags/-Ranges). */
  perfSettings?: PerfSettings;
  /** Undo-Verlauf für die Buttons (Tiefen + Label der obersten Einträge). */
  undo?: UndoInfo;
  /** Patch-Settings: Pseudo-Module der Settings-Area (ohne Morphs). */
  settings?: SettingsModule[];
  /** Morph-Gruppen der aktiven Variation (Dial/Mode + Zuweisungen). */
  morphs?: MorphGroup[];
  /** Zugewiesene Global Knobs (perf-weit, zeigen auf alle 4 Slots). */
  globalKnobs?: GlobalKnob[];
  modules: Module[]; cables: Cable[];
}
/**
 * Eine Global-Knob-Zuweisung. knob 0–119 = Seite 1–5 × Reihe A–C × Knob 1–8
 * (Anzeige z.B. "2B5"). slot ist der Slot-BUCHSTABE (A–D); module/param wie
 * patchState. moduleName/paramName löst der Server auf (Module fremder Slots
 * hat der Client nicht im State).
 */
export interface GlobalKnob {
  knob: number; slot: string; area: ParamArea; module: number; param: number;
  led: boolean; moduleName?: string; paramName?: string;
}
/** Broadcast nach jeder Global-Knob-Änderung (gebündelt; volle Liste). */
export interface GlobalKnobsChanged { type: 'globalKnobsChanged'; knobs: GlobalKnob[]; }
/** Bank-Inhalte geändert (z.B. nach storePerf) — /api/banks + /api/perfbanks neu laden. */
export interface BanksChanged { type: 'banksChanged'; }
export interface SettingsParam extends Param { enums?: string[]; }
export interface SettingsModule { id: number; name: string; params: SettingsParam[]; }
export interface MorphAssign { area: ParamArea; module: number; param: number; range: number; }
export interface MorphGroup {
  morph: number; label: string; dial: number; mode: number; assigns: MorphAssign[];
}
export interface UndoInfo {
  undoDepth: number; redoDepth: number; undoLabel?: string; redoLabel?: string;
}
/** Broadcast nach jeder Verlaufs-Änderung (Mutation, undo/redo, Slot-/Patch-Wechsel). */
export interface UndoState extends UndoInfo { type: 'undoState'; }
export type ParamArea = Area | 'settings';
export interface ParamChanged {
  type: 'paramChanged'; slot?: string; area: ParamArea;
  module: number; param: number; value: number; variation: number; text?: string;
}
export interface ModeChanged {
  type: 'modeChanged'; slot?: string; area: Area; module: number; mode: number; value: number;
}
/** Morph-Zuweisung geändert (range 0 = gelöscht). */
export interface MorphChanged {
  type: 'morphChanged'; variation: number; area: ParamArea;
  module: number; param: number; morph: number; range: number;
}
export interface VariationChanged { type: 'variationChanged'; variation: number; slot?: string; }
export interface Connection { type: 'connection'; connected: boolean; }
export interface ModuleMoved {
  type: 'moduleMoved'; area: Area; module: number; col: number; row: number;
}
export interface CableEnd { module: number; conn: number; }
export interface CableAdded {
  type: 'cableAdded'; area: Area; from: CableEnd; to: CableEnd;
  fromOutput: boolean; color: string;
}
export interface CableDeleted {
  type: 'cableDeleted'; area: Area; from: CableEnd; to: CableEnd;
}
export interface ModuleAdded { type: 'moduleAdded'; module: Module; }
export interface ModuleDeleted { type: 'moduleDeleted'; area: Area; module: number; }
export interface ModuleRenamed { type: 'moduleRenamed'; area: Area; module: number; name: string; }
export interface ModuleColorChanged { type: 'moduleColorChanged'; area: Area; module: number; color: number; }
/** Abschluss von copySelection: die Indizes der frischen Kopien (für die Auswahl). */
export interface SelectionCopied { type: 'selectionCopied'; area: Area; modules: number[]; }
/** Ein LED-/VU-Update: [area, module, g (GroupId), value]. */
export type VisualUpdate = [Area, number, number, number];
/**
 * Gebündelte LED-/VU-Daten (Server flusht ~alle 33ms, nur geänderte Werte).
 * leds = Einzel-LEDs (0/1), meters = VU-Meter (0–~13?) und LED-Gruppen
 * (Radio-Wert; LED an wenn Wert == CodeRef der LED).
 */
export interface Visuals {
  type: 'visuals'; slot?: string; leds: VisualUpdate[]; meters: VisualUpdate[];
}
export type ServerMessage =
  PatchState | ParamChanged | VariationChanged | Connection | ModuleMoved |
  CableAdded | CableDeleted | ModuleAdded | ModuleDeleted |
  ModuleRenamed | ModuleColorChanged | SelectionCopied | UndoState | ModeChanged |
  MorphChanged | Visuals | PerfSettingsChanged | GlobalKnobsChanged | BanksChanged;

export interface SetParam {
  type: 'setParam'; area: ParamArea; module: number; param: number; value: number; variation: number;
}
/** Modul-Mode setzen; Antwort = modeChanged. */
export interface SetMode {
  type: 'setMode'; area: Area; module: number; mode: number; value: number;
}
/** Morph-Zuweisung setzen/ändern/löschen (range 0 = löschen, -128…127). */
export interface SetMorph {
  type: 'setMorph'; area: ParamArea; module: number; param: number;
  morph: number; range: number; variation: number;
}
export interface SelectVariation { type: 'selectVariation'; variation: number; }
/** Aktiven Slot wechseln (0–3 = A–D); Antwort = patchState des neuen Slots. */
export interface SelectSlot { type: 'selectSlot'; slot: number; }
export interface MoveModule {
  type: 'moveModule'; area: Area; module: number; col: number; row: number;
}
export interface AddCable {
  type: 'addCable'; area: Area; from: CableEnd; to: CableEnd; fromOutput: boolean;
}
export interface DeleteCable {
  type: 'deleteCable'; area: Area; from: CableEnd; to: CableEnd; fromOutput: boolean;
}
export interface AddModule { type: 'addModule'; area: Area; typeName: string; col: number; row: number; }
/** Dupliziert ein Modul (Params/Farbe/Name); Antwort kommt als moduleAdded. */
export interface CopyModule { type: 'copyModule'; area: Area; module: number; col: number; row: number; }
export interface DeleteModule { type: 'deleteModule'; area: Area; module: number; }
export interface ModuleMove { module: number; col: number; row: number; }
/** Selektion als starrer Block verschieben (ein Undo-Eintrag). */
export interface MoveModules { type: 'moveModules'; area: Area; moves: ModuleMove[]; }
/** Selektion löschen (ein Undo-Eintrag, Undo restauriert auch alle Kabel). */
export interface DeleteModules { type: 'deleteModules'; area: Area; modules: number[]; }
/**
 * Selektion duplizieren, um (dCol,dRow) versetzt, interne Kabel inklusive.
 * Antwort: moduleAdded*, cableAdded*, selectionCopied (ein Undo-Eintrag).
 */
export interface CopySelection {
  type: 'copySelection'; area: Area; modules: number[]; dCol: number; dRow: number;
}
export interface RenameModule { type: 'renameModule'; area: Area; module: number; name: string; }
export interface SetModuleColor { type: 'setModuleColor'; area: Area; module: number; color: number; }
/** Wirkung kommt als normale Broadcasts zurück; leerer Verlauf = no-op. */
export interface Undo { type: 'undo'; }
export interface Redo { type: 'redo'; }
/** Ganze Performance aus Perf-Bank laden (1-indexiert); Antwort = patchState. */
export interface LoadPerf { type: 'loadPerf'; bank: number; slot: number; }
export interface SetMasterClock { type: 'setMasterClock'; bpm: number; }
export interface SetClockRun { type: 'setClockRun'; run: boolean; }
export interface SetKeyboardRangeEnabled { type: 'setKeyboardRangeEnabled'; enabled: boolean; }
/** key: enabled|keyboard|hold (0/1) oder keyFrom|keyTo (0–127); slot 0–3. */
export interface SetPerfSlotSetting {
  type: 'setPerfSlotSetting'; slot: number; key: string; value: number;
}
export interface RenamePerf { type: 'renamePerf'; name: string; }
/**
 * Aktuelle Performance in Perf-Bank speichern (1-indexiert, unter aktuellem
 * Namen; überschreibt belegte Plätze). Bestätigung = banksChanged.
 */
export interface StorePerf { type: 'storePerf'; bank: number; slot: number; }
/** Param einem Global Knob zuweisen (knob 0–119, slot 0–3 = A–D). */
export interface AssignGlobalKnob {
  type: 'assignGlobalKnob'; knob: number; slot: number;
  area: ParamArea; module: number; param: number;
}
export interface DeassignGlobalKnob { type: 'deassignGlobalKnob'; knob: number; }
export type ClientMessage =
  SetParam | SetMode | SetMorph | SelectVariation | SelectSlot | MoveModule | AddCable | DeleteCable |
  AddModule | CopyModule | DeleteModule | RenameModule | SetModuleColor |
  MoveModules | DeleteModules | CopySelection |
  Undo | Redo |
  LoadPerf | SetMasterClock | SetClockRun | SetKeyboardRangeEnabled |
  SetPerfSlotSetting | RenamePerf | StorePerf | AssignGlobalKnob | DeassignGlobalKnob;

// REST: /api/banks
export interface BankEntry { slot: number; name: string; category?: number; }
export interface Bank { bank: number; patches: BankEntry[]; }
