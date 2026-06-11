// TextFunc-Formatter für TextFields, portiert aus g2fx
// g2gui ModuleTextFieldBuilder/ParamTimes (BSD-3). Konstanten-Tabellen kommen
// aus /param-tables.json (Generator, null = -Infinity).
// Aufruf: formatTextFunc(tf, deps) mit den Werten der Dependencies in
// YAML-Reihenfolge; null = kein Spezial-Formatter (Aufrufer nimmt den
// serverseitigen Text des Master-Params).

import type { ParamTables } from './protocol';

let T: ParamTables = {};
export function setTables(t: ParamTables) { T = t; }

const num = (name: string, ix: number): number => {
  const v = T[name]?.[ix];
  return v === null || v === undefined ? -Infinity : (v as number);
};
const str = (name: string, ix: number): string => String(T[name]?.[ix] ?? '?');

// fmtDoubleFixed/fmtDouble wie ParamTimes: Gesamtlänge begrenzen
function fmtFixed(v: number, totalLen: number): string {
  let s = v.toFixed(totalLen - 2);
  const dot = s.indexOf('.');
  if (dot >= totalLen) return s.slice(0, dot);
  return v.toFixed(totalLen - dot - 1);
}
const fmtD = (v: number, totalLen: number) => fmtFixed(v, totalLen).replace(/\.0+$/, '');
const fmt01 = (v: number) => v.toFixed(1);
const negInf = (v: number) => (v === -Infinity ? '-∞' : fmt01(v));

function fmtPosNeg(v: number): string { return v < 0 ? String(v) : `+${v}`; }

function formatHz(hz: number): string {
  return hz >= 1000 ? `${fmtD(hz / 1000, 5)}kHz` : `${fmtD(hz, 5)}Hz`;
}

function formatMillisSecs(ms: number): string {
  return ms >= 1000 ? `${fmtD(ms / 1000, 5)}s` : `${fmtD(ms, 4)}m`;
}

// ---- Frequenz (Osc/PShift), formatFreq(mode, coarse, fine) 1:1 portiert ----
function formatFreq(mode: number, coarse: number, fine: number): string {
  switch (mode) {
    case 0: // Semi
      return `${fmtPosNeg(coarse - 64)}  ${fmtPosNeg(Math.trunc(((fine - 64) * 100) / 128))}`;
    case 1: { // Freq — (fine-64)/128 ist in Java Int-Division und damit immer 0
      const exponent = (coarse - 69) / 12;
      return formatHz(440.0 * 2 ** exponent);
    }
    case 2: { // Fac
      const exponent = (coarse - 64) / 12;
      return `x${(2 ** exponent).toFixed(3)}`;
    }
    case 3: { // Part
      let s: string;
      if (coarse <= 32) {
        const exponent = -((32 - coarse) * 4 + 77) / 12;
        s = `x${(440.0 * 2 ** exponent).toFixed(2)}Hz`;
      } else if (coarse <= 64) {
        s = `1:${64 - coarse + 1}`;
      } else {
        s = `${coarse - 64 + 1}:1`;
      }
      return `${s}  ${fmtPosNeg(Math.trunc(((fine - 64) * 100) / 128))}`;
    }
    case 4: { // Semi PShift
      const cv = coarse - 64;
      const s = cv < 0 ? (cv / 4).toFixed(2) : `+${(cv / 4).toFixed(2)}`;
      return `${s}  ${fmtPosNeg(Math.trunc(((fine - 64) * 100) / 128))}`;
    }
    default:
      return '?';
  }
}

// ---- Delays (ParamTimes) ----
function computeDelay(v: number, min: number, max: number): number {
  return min + ((max - min) * (v - 1)) / 126;
}

function formatDelayRange7(val: number, range: number): string {
  if (val === 0) return '0.01m';
  switch (range) {
    case 0: return fmtD(computeDelay(val, 0.05, 5.3), 4) + 'm';
    case 1: return fmtD(computeDelay(val, 0.21, 25.1), 4) + 'm';
    case 2: return fmtD(computeDelay(val, 0.8, 100), 4) + 'm';
    case 3: return fmtD(computeDelay(val, 3.95, 500), 4) + 'm';
    case 4: return val === 127 ? '1.000s' : fmtD(computeDelay(val, 7.89, 1000), 4) + 'm';
    case 5: {
      const d = computeDelay(val, 15.8, 2000);
      return val >= 64 ? fmtD(d / 1000, 5) + 's' : fmtD(d, 4) + 'm';
    }
    default: {
      const d = computeDelay(val, 21.3, 2700);
      return val >= 48 ? fmtD(d / 1000, 5) + 's' : fmtD(d, 5) + 'm';
    }
  }
}

function fmtDelayRange4(range: number, val: number): string {
  if (val === 0) return '0.01m';
  switch (range) {
    case 0: return fmtD((500 * val) / 127, 4) + 'm';
    case 1: return val === 127 ? '1.00s' : fmtD((1000 * val) / 127, 4) + 'm';
    case 2: return val >= 64 ? fmtD((2000 * val) / 127000, 5) + 's' : fmtD((2000 * val) / 127, 4) + 'm';
    default: return val >= 48 ? fmtD((2700 * val) / 127000, 5) + 's' : fmtD((2700 * val) / 127, 4) + 'm';
  }
}

function fmtDelayRange3(range: number, val: number): string {
  if (val === 0) return '0.01m';
  switch (range) {
    case 0: return fmtD((500 * val) / 127, 4) + 'm';
    case 1: return val === 127 ? '1.00s' : fmtD((1000 * val) / 127, 4) + 'm';
    default: return val >= 95 ? fmtD((1351 * val) / 127000, 5) + 's' : fmtD((1351 * val) / 127, 4) + 'm';
  }
}

const formatClkDelay = (val: number) => str('DELAY_VALS', Math.trunc(val / 4));

// ---- BPM (ClkGen/LFO) ----
function g2BPM(rate: number): number {
  return rate <= 32 ? 24 + 2 * rate : rate <= 96 ? 88 + rate - 32 : 152 + (rate - 96) * 2;
}

/**
 * TextFunc anwenden; deps = Werte der Dependencies in YAML-Reihenfolge.
 * null = unbekannter TextFunc (Aufrufer zeigt den Master-Param-Text).
 */
export function formatTextFunc(tf: number, deps: number[]): string | null {
  const [a = 0, b = 0, c = 0] = deps;
  switch (tf) {
    case 60: // OSC_FREQ (coarse, fine, mode)
      return formatFreq(c, a, b);
    case 198: { // OPERATOR_FREQ (coarse, fine, ratio) — upstream "TODO bananas"
      if (c === 0) {
        const fact = a === 0 ? 0.5 : a;
        return `x${(fact + (fact * b) / 100).toFixed(1)}`;
      }
      return formatHz(10 ** Math.trunc(a / 4));
    }
    case 201: // PSHIFT_FREQ (coarse, fine)
      return formatFreq(4, a, b);
    case 103: // LFO_FREQ (rate, range)
      switch (b) {
        case 0: return (699 / (a + 1)).toFixed(2); // Rate Sub
        case 1: return a < 32
          ? `${(1 / (0.0159 * 2 ** (Math.trunc(a) / 12))).toFixed(2)}s`
          : `${(0.0159 * 2 ** (Math.trunc(a) / 12)).toFixed(2)}Hz`;
        case 2: return `${(0.2555 * 2 ** (Math.trunc(a) / 12)).toFixed(1)}Hz`;
        case 3: return String(g2BPM(a));
        default: return str('LFO_CLOCK_VALS', Math.trunc(a / 4));
      }
    case 110: // CLK_GEN (rate, active, internalMaster)
      return b === 0 ? '--' : c === 1 ? 'MASTER' : `${g2BPM(a)} BPM`;
    case 122: { // PULSE_TIME (time, range)
      const t = num('PULSE_DELAY_RANGE', a);
      return formatMillisSecs(b === 0 ? t / 100 : b === 1 ? t / 10 : t);
    }
    case 96: // CONST_BIP (n, type)
      return b === 0 ? String(a === 127 ? 64 : a - 64)
        : fmt01(a === 127 ? 64.0 : a / 2);
    case 147: // LEV_AMP (n, type)
      return b === 0 ? `x${((4 * a) / 127).toFixed(2)}` : negInf(num('LEV_AMP_DB', a));
    case 102: // MIX_LEV (n, type)
      return b === 2 ? negInf(num('MIX_LEV_DB', a))
        : fmt01(a === 127 ? 100 : (a * 100) / 128);
    case 141: // DELAY_TIME (val, range)
      return formatDelayRange7(a, b);
    case 143: // DELAY_TIME_CLK (val, type, range)
      return b === 0 ? fmtDelayRange4(c, a) : formatClkDelay(a);
    case 146: // DELAY_TIME_STEREO (val, type, range)
      return b === 0 ? fmtDelayRange3(c, a) : formatClkDelay(a);
    case 107: { // REVERB_TIME (n, type)
      const v = (((b + 1) * 3.0) / 127) * a;
      return v < 1 ? `${fmtFixed(v * 1000, 4)}ms` : `${fmtFixed(v, 5)}s`;
    }
    default:
      return null;
  }
}
