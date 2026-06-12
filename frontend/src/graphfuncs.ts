// Graph-Kurven der Modulflächen — Port aus g2fx g2gui (BSD-3):
//   EnvGraphs.java  -> Hüllkurven als SVG-Pfad (exp/lin/log-Segmente)
//   Graphs.java     -> GraphFunc-Dispatch + FltClassic-Frequenzgang
// Dep-Werte kommen POSITIONAL aus den yaml-Dependencies des Graph-Controls
// (controls.ts löst Param-/Mode-Indizes auf und reicht nackte Zahlen durch).

import type { ControlDef } from './protocol';

const SVG = 'http://www.w3.org/2000/svg';
const el = <K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

// ---- Hüllkurven (EnvGraphs.java) -------------------------------------------

type Curve = 'exp' | 'lin' | 'log';
// Shape-Param (0–3) -> Kurventyp je Segment
const ADSR_SHAPES: Curve[][] = [
  ['exp', 'exp', 'exp'], ['lin', 'exp', 'exp'], ['log', 'exp', 'exp'], ['lin', 'lin', 'lin'],
];
const ADDSR_SHAPES: Curve[][] = [
  ['exp', 'exp', 'exp', 'exp'], ['lin', 'exp', 'exp', 'exp'],
  ['log', 'exp', 'exp', 'exp'], ['lin', 'lin', 'lin', 'lin'],
];
const MULTI_SHAPES = ADDSR_SHAPES;
const AHD_SHAPES: Curve[][] = [
  ['exp', 'lin', 'exp'], ['lin', 'lin', 'exp'], ['log', 'lin', 'exp'], ['lin', 'lin', 'lin'],
];
const ADR_SHAPES: Curve[][] = [
  ['exp', 'exp'], ['lin', 'exp'], ['log', 'exp'], ['lin', 'lin'],
];

interface EnvProps { ys: number; xs: number; yo: number; sustime: number; tacc: number; }
interface EnvSeg { t: number; l: number; sustain: boolean; }

const UNIT = 1 / 128;
const seg = (tRaw: number, lRaw: number, sustain = false): EnvSeg =>
  ({ t: tRaw * UNIT, l: lRaw * UNIT, sustain });

/** posNeg-Bit 0 gesetzt = invertiert (Kurve nach unten gespiegelt). */
const envProps = (inv: boolean, ys: number, xs: number): EnvProps =>
  inv ? { ys: -ys, xs, yo: ys, sustime: 0, tacc: 0 }
      : { ys, xs, yo: 0, sustime: 0, tacc: 0 };

function computeSustime(en: EnvSeg[], susInit: number): number {
  let sum = 0;
  for (const s of en) if (!s.sustain) sum += s.t;
  return susInit - sum;
}

const f2 = (n: number) => n.toFixed(2);

/** Pfad-Generierung wie EnvGraphs.drawEnv/EnvSegment. */
function drawEnv(en: EnvSeg[], shapes: Curve[], ep: EnvProps): string {
  const y = (l: number) => l * ep.ys + ep.yo;
  let d = `M0,${f2(y(en[en.length - 1].l))}`;
  for (let i = 0; i < en.length; i++) {
    const s = en[i];
    switch (shapes[i]) {
      case 'lin': {
        ep.tacc += s.t;
        d += `L${f2(ep.tacc * ep.xs)},${f2(y(s.l))}`;
        break;
      }
      case 'exp': {
        const t1 = ep.tacc + s.t * 0.16;
        ep.tacc += s.t;
        d += `Q${f2(t1 * ep.xs)},${f2(y(s.l))} ${f2(ep.tacc * ep.xs)},${f2(y(s.l))}`;
        break;
      }
      case 'log': {
        const prev = en[i !== 0 ? i - 1 : en.length - 1];
        const t1 = ep.tacc + s.t * 0.8;
        ep.tacc += s.t;
        d += `Q${f2(t1 * ep.xs)},${f2(y(prev.l))} ${f2(ep.tacc * ep.xs)},${f2(y(s.l))}`;
        break;
      }
    }
    if (s.sustain) {
      ep.tacc += ep.sustime;
      d += `L${f2(ep.tacc * ep.xs)},${f2(y(s.l))}`;
    }
  }
  return d;
}

function envPath(en: EnvSeg[], shapes: Curve[], ep: EnvProps, susInit: number): string {
  ep.sustime = computeSustime(en, susInit);
  return drawEnv(en, shapes, ep);
}

// Die einzelnen Kurven; Argument-Reihenfolge = yaml-Dependencies des Controls.

function adsr(d: number[]): string { // deps: A,D,S,R,shape,posNegInvBipInv
  const [a, dec, s, r, shape, pn] = d;
  const ep = envProps((pn & 1) !== 0, 28, 15);
  return envPath([seg(a, 0), seg(dec, 127 - s, true), seg(r, 127)],
    ADSR_SHAPES[shape] ?? ADSR_SHAPES[0], ep, 3.0);
}

function addsr(d: number[]): string { // deps: A,D1,L1,D2,L2,R,shape,susMode,posNegInv
  const [a, d1, l1, d2, l2, r, shape, sus, pn] = d;
  const ep = envProps((pn & 1) !== 0, 28, 15);
  const en = [seg(a, 0), seg(d1, 127 - l1), seg(d2, 127 - l2), seg(r, 127)];
  en[(sus & 2) | 1].sustain = true;
  return envPath(en, ADDSR_SHAPES[shape] ?? ADDSR_SHAPES[0], ep, 4.0);
}

function multiEnv(d: number[]): string { // deps: L1..L4,T1..T4,susMode,posNegInvBip,shape
  const [l1, l2, l3, l4, t1, t2, t3, t4, sus, pn, shape] = d;
  const ep = envProps((pn & 1) !== 0, 28, 15);
  const en = [seg(t1, 127 - l1), seg(t2, 127 - l2), seg(t3, 127 - l3), seg(t4, 127 - l4)];
  if (sus < 3) en[sus].sustain = true;
  return envPath(en, MULTI_SHAPES[shape] ?? MULTI_SHAPES[0], ep, 4.5);
}

function ahd(d: number[]): string { // deps: A,H,D,shape,posNegInv
  const [a, h, dec, shape, pn] = d;
  const ep = envProps((pn & 1) !== 0, 28, 20);
  return envPath([seg(a, 0), seg(h, 0), seg(dec, 127)],
    AHD_SHAPES[shape] ?? AHD_SHAPES[0], ep, 0);
}

function adr(d: number[]): string { // deps: A,R,shape,adAr,posNegInv
  const [a, r, shape, adAr, pn] = d;
  const ep = envProps((pn & 1) !== 0, 22, 15);
  return envPath([seg(a, 0, adAr !== 0), seg(r, 127)],
    ADR_SHAPES[shape] ?? ADR_SHAPES[0], ep, 2.0);
}

function denv(d: number[]): string { // deps: decay,posNegInv
  const [dec, pn] = d;
  const ep = envProps((pn & 1) !== 0, 22, 31);
  return envPath([seg(0, 0), seg(dec, 127)], ['lin', 'exp'], ep, 0);
}

function henv(d: number[]): string { // deps: hold,posNegInv
  const [h, pn] = d;
  const ep = envProps((pn & 1) !== 0, 22, 31);
  return envPath([seg(0, 0), seg(h, 0), seg(0, 127), seg(200, 127)],
    ['lin', 'lin', 'lin', 'lin'], ep, 0);
}

// ---- FltClassic-Frequenzgang (Graphs.java) ----------------------------------

const FREQ_MIN = 20, FREQ_MAX = 20000, DB_MIN = -24, DB_MAX = 18, EPS = 1e-10;

/** Tiefpass N-ter Ordnung + Resonanz-Überhöhung, Magnitude in dB. */
function filtLP(freqHz: number, cutoffHz: number, resonance: number, order: number): number {
  const ratio = Math.max(freqHz, EPS) / Math.max(cutoffHz, EPS);
  let mag = 1 / Math.sqrt(1 + ratio ** (2 * order));
  mag *= 1 + resonance * Math.exp(-Math.abs(ratio - 1) * 3);
  return 20 * Math.log10(mag + EPS);
}

/** FltFreq-Param -> Hz (g2lib ModParam.computeFltFreq). */
const fltFreq = (n: number) => 440 * 2 ** ((n - 60) / 12);

function fltClassic(c: ControlDef, d: number[]): SVGGElement {
  // deps: FltFreq, Res, ClassicSlope, ActiveMonitor
  const [freq, res, slope, active] = d;
  const w = c.w ?? 52, h = c.h ?? 28;
  const order = slope + 2;
  const g = el('g', { transform: `translate(${c.x},${c.y})` });
  g.appendChild(el('rect', { x: 0, y: 0, width: w, height: h, fill: '#377e7f' }));
  // 0-dB-Linie
  const yZero = h * (1 - (0 - DB_MIN) / (DB_MAX - DB_MIN));
  g.appendChild(el('line', { x1: 0, y1: yZero, x2: w, y2: yZero, stroke: '#fff', 'stroke-width': 1 }));
  // dB/Oct-Anzeige (order*6)
  const t = el('text', { x: w - 15, y: 10, 'font-size': 8, fill: '#ff0' });
  t.textContent = String(order * 6);
  g.appendChild(t);
  if (active !== 0) {
    const cutoff = fltFreq(freq), reso = res * 4 / 127;
    let dd = `M0,${f2(h)}`;
    let curve = '';
    for (let i = 0; i < w; i++) {
      const f = FREQ_MIN * (FREQ_MAX / FREQ_MIN) ** (i / (w - 1));
      const dB = filtLP(f, cutoff, reso, order);
      const yn = Math.min(Math.max((dB - DB_MAX) / (DB_MIN - DB_MAX), 0), 1);
      dd += `L${i},${f2(yn * h)}`;
      curve += `${i === 0 ? 'M' : 'L'}${i},${f2(yn * h)}`;
    }
    dd += `L${w - 1},${f2(h)}Z`;
    g.appendChild(el('path', { d: dd, fill: '#75fb8e', stroke: 'none' }));
    g.appendChild(el('path', { d: curve, fill: 'none', stroke: '#000', 'stroke-width': 1 }));
  }
  return g;
}

// ---- Dispatch (Graphs.mkGraph) -----------------------------------------------

const ENV_FUNCS: Record<number, (d: number[]) => string> = {
  1: adr, 3: adsr, 6: denv, 7: henv, 17: multiEnv, 23: addsr,
};

/**
 * Graph-Control rendern; depVals = aufgelöste Dependency-Werte (positional).
 * Nicht portierte GraphFuncs liefern null -> Platzhalter-Box (wie g2gui).
 */
export function renderGraph(c: ControlDef, depVals: number[], typeName: string): SVGGElement | null {
  const gf = c.gf ?? 0;
  if (gf === 20) return fltClassic(c, depVals);
  // GraphFunc 28 teilen sich EnvAHD (echte Kurve) und Env_ModAHD (kein Graph in g2gui)
  const fn = gf === 28 && typeName === 'EnvAHD' ? ahd : ENV_FUNCS[gf];
  if (!fn) return null;
  const w = c.w ?? 30, h = c.h ?? 20;
  const g = el('g', {});
  g.appendChild(el('rect', { x: c.x, y: c.y, width: w, height: h, fill: '#088' }));
  g.appendChild(el('path', {
    d: fn(depVals), transform: `translate(${c.x + 0.5},${c.y})`,
    stroke: '#AFA', fill: '#00A4A4', 'stroke-width': 1,
  }));
  return g;
}
