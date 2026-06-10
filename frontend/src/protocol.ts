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
export type ServerMessage = PatchState | ParamChanged | VariationChanged | Connection;

export interface SetParam {
  type: 'setParam'; area: Area; module: number; param: number; value: number; variation: number;
}
export interface SelectVariation { type: 'selectVariation'; variation: number; }
export type ClientMessage = SetParam | SelectVariation;

// REST: /api/banks
export interface BankEntry { slot: number; name: string; category?: number; }
export interface Bank { bank: number; patches: BankEntry[]; }
