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
}
export interface ModuleDef {
  ix: number; height: number; inputs: ConnDef[]; outputs: ConnDef[];
  controls: ControlDef[];
}
export type ModuleDefs = Record<string, ModuleDef>;
/** /param-tables.json — Konstanten für die TextFunc-Formatter (null = -Inf). */
export type ParamTables = Record<string, (number | string | null)[]>;

export interface PatchState {
  type: 'patchState'; connected: boolean;
  perf: string; slot: string; name: string; variation: number;
  /** Alle 4 Slots (A–D) mit Patch-Namen für die Slot-Leiste. */
  slots?: { slot: string; name: string }[];
  /** Undo-Verlauf für die Buttons (Tiefen + Label der obersten Einträge). */
  undo?: UndoInfo;
  modules: Module[]; cables: Cable[];
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
export type ServerMessage =
  PatchState | ParamChanged | VariationChanged | Connection | ModuleMoved |
  CableAdded | CableDeleted | ModuleAdded | ModuleDeleted |
  ModuleRenamed | ModuleColorChanged | SelectionCopied | UndoState | ModeChanged;

export interface SetParam {
  type: 'setParam'; area: ParamArea; module: number; param: number; value: number; variation: number;
}
/** Modul-Mode setzen; Antwort = modeChanged. */
export interface SetMode {
  type: 'setMode'; area: Area; module: number; mode: number; value: number;
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
export type ClientMessage =
  SetParam | SetMode | SelectVariation | SelectSlot | MoveModule | AddCable | DeleteCable |
  AddModule | CopyModule | DeleteModule | RenameModule | SetModuleColor |
  MoveModules | DeleteModules | CopySelection |
  Undo | Redo;

// REST: /api/banks
export interface BankEntry { slot: number; name: string; category?: number; }
export interface Bank { bank: number; patches: BankEntry[]; }
