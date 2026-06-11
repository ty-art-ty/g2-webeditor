// TypeScript-Spiegel von docs/protocol.md — bei Änderungen beide Seiten pflegen.

export type Area = 'va' | 'fx';

export interface Param { id: number; name: string; value: number; min: number; max: number; }
export interface Module {
  id: number; area: Area; typeName: string; name: string;
  row: number; col: number; color: number; params: Param[];
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
export interface ConnDef { x: number; y: number; type: 'audio' | 'control' | 'logic'; }
export interface ModuleDef { ix: number; height: number; inputs: ConnDef[]; outputs: ConnDef[]; }
export type ModuleDefs = Record<string, ModuleDef>;

export interface PatchState {
  type: 'patchState'; connected: boolean;
  perf: string; slot: string; name: string; variation: number;
  modules: Module[]; cables: Cable[];
}
export interface ParamChanged {
  type: 'paramChanged'; slot?: string; area: Area;
  module: number; param: number; value: number; variation: number;
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
export type ServerMessage =
  PatchState | ParamChanged | VariationChanged | Connection | ModuleMoved |
  CableAdded | CableDeleted | ModuleAdded | ModuleDeleted |
  ModuleRenamed | ModuleColorChanged;

export interface SetParam {
  type: 'setParam'; area: Area; module: number; param: number; value: number; variation: number;
}
export interface SelectVariation { type: 'selectVariation'; variation: number; }
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
export interface RenameModule { type: 'renameModule'; area: Area; module: number; name: string; }
export interface SetModuleColor { type: 'setModuleColor'; area: Area; module: number; color: number; }
/** Wirkung kommt als normale Broadcasts zurück; leerer Verlauf = no-op. */
export interface Undo { type: 'undo'; }
export interface Redo { type: 'redo'; }
export type ClientMessage =
  SetParam | SelectVariation | MoveModule | AddCable | DeleteCable |
  AddModule | CopyModule | DeleteModule | RenameModule | SetModuleColor |
  Undo | Redo;

// REST: /api/banks
export interface BankEntry { slot: number; name: string; category?: number; }
export interface Bank { bank: number; patches: BankEntry[]; }
