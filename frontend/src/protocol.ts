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
  color: string;
}

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
