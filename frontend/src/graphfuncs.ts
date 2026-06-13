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

// ==== Best-Effort-Kurven (Teil 19) ===========================================
// WICHTIG: Die folgenden GraphFuncs sind in der g2gui-Referenz (Commit e75c6d0)
// und in G2-Edit NICHT implementiert — dort bleiben sie Platzhalter-Boxen. Die
// Kurven hier sind EIGENE Näherungen, aus den Param-Werten berechnet, NICHT
// geräte-getreu. Sie dienen nur dem visuellen Feedback im Editor. Eine kleine
// "~"-Marke oben links kennzeichnet sie als Näherung.

const BG = '#377e7f', CURVE_STROKE = '#0c1f1f', CURVE_FILL = '#75fb8e', WAVE = '#dffbe6';
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Box + Näherungs-Marke; gibt die <g> zurück (bei c.x/c.y positioniert). */
function approxBox(c: ControlDef): { g: SVGGElement; w: number; h: number } {
  const w = c.w ?? 34, h = c.h ?? 22;
  const g = el('g', { transform: `translate(${c.x},${c.y})` });
  g.appendChild(el('rect', { x: 0, y: 0, width: w, height: h, fill: BG }));
  const t = el('text', { x: 1.5, y: 7, 'font-size': 7, fill: '#bfe', opacity: 0.55 });
  t.textContent = '~';
  g.appendChild(t);
  return { g, w, h };
}

/** Transfer-Kurve y=f(x), x∈[-1,1] → [0,w], y∈[-1,1] → [h,0] (Waveshaper). */
function transferGraph(c: ControlDef, f: (x: number) => number): SVGGElement {
  const { g, w, h } = approxBox(c);
  const X = (x: number) => (x + 1) / 2 * w;
  const Y = (y: number) => (1 - (y + 1) / 2) * h;
  // Referenz-Diagonale (y=x) + Achsen
  g.appendChild(el('line', { x1: 0, y1: h / 2, x2: w, y2: h / 2, stroke: '#fff', opacity: 0.25 }));
  g.appendChild(el('line', { x1: w / 2, y1: 0, x2: w / 2, y2: h, stroke: '#fff', opacity: 0.25 }));
  g.appendChild(el('line', { x1: 0, y1: h, x2: w, y2: 0, stroke: '#fff', opacity: 0.15 }));
  let d = '';
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const x = -1 + 2 * i / N;
    d += `${i === 0 ? 'M' : 'L'}${f2(X(x))},${f2(Y(clamp(f(x), -1, 1)))}`;
  }
  g.appendChild(el('path', { d, fill: 'none', stroke: CURVE_STROKE, 'stroke-width': 1.3 }));
  return g;
}

/** Frequenzgang: magDb(f) über log. Frequenzachse, dB-Bereich [lo,hi]. */
function responseGraph(c: ControlDef, magDb: (f: number) => number,
                       active: boolean, lo = -24, hi = 18): SVGGElement {
  const { g, w, h } = approxBox(c);
  const yZero = h * (1 - (0 - lo) / (hi - lo));
  g.appendChild(el('line', { x1: 0, y1: yZero, x2: w, y2: yZero, stroke: '#fff', opacity: 0.5 }));
  if (!active) return g;
  const Y = (db: number) => clamp((db - hi) / (lo - hi), 0, 1) * h;
  let fill = `M0,${f2(h)}`, line = '';
  for (let i = 0; i < w; i++) {
    const f = FREQ_MIN * (FREQ_MAX / FREQ_MIN) ** (i / (w - 1));
    const y = f2(Y(magDb(f)));
    fill += `L${i},${y}`;
    line += `${i === 0 ? 'M' : 'L'}${i},${y}`;
  }
  fill += `L${w - 1},${f2(h)}Z`;
  g.appendChild(el('path', { d: fill, fill: CURVE_FILL, stroke: 'none', opacity: 0.85 }));
  g.appendChild(el('path', { d: line, fill: 'none', stroke: CURVE_STROKE, 'stroke-width': 1 }));
  return g;
}

/** Wellenform w(t), t∈[0,1) (ein Zyklus), Amplitude [-1,1]. */
function waveGraph(c: ControlDef, wf: (t: number) => number): SVGGElement {
  const { g, w, h } = approxBox(c);
  g.appendChild(el('line', { x1: 0, y1: h / 2, x2: w, y2: h / 2, stroke: '#fff', opacity: 0.25 }));
  const Y = (y: number) => (1 - (clamp(y, -1, 1) + 1) / 2) * (h - 2) + 1;
  let d = '';
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    d += `${i === 0 ? 'M' : 'L'}${f2(t * w)},${f2(Y(wf(t)))}`;
  }
  g.appendChild(el('path', { d, fill: 'none', stroke: WAVE, 'stroke-width': 1.3 }));
  return g;
}

// ---- Shaper-Transferkurven --------------------------------------------------

const lev = (n: number) => n / 127; // Level_100-Param 0..127 → 0..1

function clipGraph(c: ControlDef, d: number[]): SVGGElement { // deps: Shape(Asym/Sym), ClipLev
  const [shape, level] = d;
  const gain = 1 + lev(level) * 7;
  return transferGraph(c, (x) => shape === 1
    ? clamp(gain * x, -1, 1)                                   // Sym
    : clamp(gain * x, gain * x < 0 ? -0.5 : -1, 1));           // Asym (untere Kappung früher)
}

function overdriveGraph(c: ControlDef, d: number[]): SVGGElement { // deps: Shape, Amount
  const [shape, amount] = d;
  const drive = 1 + lev(amount) * 8;
  const k = Math.tanh(drive);
  return transferGraph(c, (x) => shape === 0
    ? Math.tanh(drive * (x + 0.12)) / Math.tanh(drive * 1.12)  // Asym: leichte Gleichkomponente
    : Math.tanh(drive * x) / k);                              // Sym
}

function waveWrapGraph(c: ControlDef, d: number[]): SVGGElement { // deps: Amount
  const wrap = 1 + lev(d[0]) * 4;
  const fold = (v: number) => {                                // Rückfaltung an ±1
    let y = v;
    for (let i = 0; i < 8 && (y > 1 || y < -1); i++) y = y > 1 ? 2 - y : -2 - y;
    return y;
  };
  return transferGraph(c, (x) => fold(wrap * x));
}

function shpExpGraph(c: ControlDef, d: number[]): SVGGElement { // deps: Amount, Curve(x2..x5)
  const [amount, curve] = d;
  const exp = (curve ?? 0) + 2, b = lev(amount);
  return transferGraph(c, (x) =>
    (1 - b) * x + b * Math.sign(x) * Math.abs(x) ** exp);
}

function saturateGraph(c: ControlDef, d: number[]): SVGGElement { // deps: Amount, Curve(1..4)
  const [amount, curve] = d;
  const drive = (1 + lev(amount) * 6) * ((curve ?? 0) + 1);
  const k = Math.tanh(drive);
  return transferGraph(c, (x) => Math.tanh(drive * x) / k);
}

// ---- Filter-Frequenzgänge ---------------------------------------------------

/** Hochpass-Magnitude N-ter Ordnung (Spiegel zu filtLP, ohne Resonanz). */
function filtHP(freqHz: number, cutoffHz: number, order: number): number {
  const ratio = Math.max(cutoffHz, EPS) / Math.max(freqHz, EPS);
  return 20 * Math.log10(1 / Math.sqrt(1 + ratio ** (2 * order)) + EPS);
}

function fltLpHpGraph(c: ControlDef, d: number[], hp: boolean): SVGGElement {
  // deps: Freq, Active, SlopeMode (6/12/18/24/30/36 dB/Oct → Ordnung slope+1)
  const [freq, active, slope] = d;
  const cutoff = fltFreq(freq), order = (slope ?? 1) + 1;
  return responseGraph(c, (f) => hp ? filtHP(f, cutoff, order) : filtLP(f, cutoff, 0, order),
    active !== 0);
}

// ---- EQ-Frequenzgänge -------------------------------------------------------

const eqDb = (n: number) => (n === 127 ? 64 : n - 64) / 3.55555;   // EqdB-Param → dB
const log2 = (x: number) => Math.log(x) / Math.LN2;

function eqPeakGraph(c: ControlDef, d: number[]): SVGGElement { // deps: Freq, Gain, Bandwidth
  const [freq, gain, bw] = d;
  const f0 = 20 * 2 ** (freq / 13.169), gainDb = eqDb(gain);
  const sigma = Math.max(0.1, (128 - (bw ?? 64)) / 64 / 2);    // Bandbreite (Oktaven) → σ
  return responseGraph(c, (f) =>
    gainDb * Math.exp(-(log2(f / f0) ** 2) / (2 * sigma * sigma)), true, -18, 18);
}

function eq2BandGraph(c: ControlDef, d: number[]): SVGGElement { // deps: LoGain, HiGain
  const loDb = eqDb(d[0]), hiDb = eqDb(d[1]);
  const fLo = 110, fHi = 8000;
  return responseGraph(c, (f) =>
    loDb / (1 + (f / fLo) ** 2) + hiDb / (1 + (fHi / f) ** 2), true, -18, 18);
}

function eq3BandGraph(c: ControlDef, d: number[]): SVGGElement { // deps: LoGain, MidGain, MidFreq, HiGain
  const [lo, mid, midFreq, hi] = d;
  const loDb = eqDb(lo), midDb = eqDb(mid), hiDb = eqDb(hi);
  const fMid = 100 * 2 ** ((midFreq ?? 93) / 20.089), fLo = 110, fHi = 8000, sigma = 0.9;
  return responseGraph(c, (f) =>
    loDb / (1 + (f / fLo) ** 2)
    + midDb * Math.exp(-(log2(f / fMid) ** 2) / (2 * sigma * sigma))
    + hiDb / (1 + (fHi / f) ** 2), true, -18, 18);
}

// ---- Oszillator-/LFO-Wellenformen -------------------------------------------

const TAU = Math.PI * 2;
const tri = (t: number) => 1 - 4 * Math.abs(Math.round(t - 0.25) - (t - 0.25));
const saw = (t: number) => 2 * (t - Math.floor(t + 0.5));
const square = (t: number) => (t % 1 < 0.5 ? 1 : -1);

function oscShpAGraph(c: ControlDef, d: number[]): SVGGElement { // deps: Shape(PW), Waveform
  const [shape, wave] = d;
  const pw = lev(shape);                                       // 0..1
  return waveGraph(c, (t) => {
    if (wave <= 3) return Math.sin(TAU * t);                   // Sine1–4 (Näherung: Sinus)
    if (wave === 4) {                                          // TriSaw: Symmetrie über Shape
      const peak = clamp(0.05 + 0.9 * pw, 0.05, 0.95);
      return t < peak ? -1 + 2 * t / peak : 1 - 2 * (t - peak) / (1 - peak);
    }
    return t % 1 < (0.05 + 0.9 * pw) ? 1 : -1;                 // SymPulse: Duty über Shape
  });
}

function lfoBGraph(c: ControlDef, d: number[]): SVGGElement { // deps: Waveform, Phase, OutType
  const [wave, phase] = d;
  const ph = lev(phase);
  const fn = [Math.sin, tri, saw, square];
  return waveGraph(c, (t) => {
    const u = t + ph;
    return wave === 0 ? Math.sin(TAU * u) : (fn[wave] ?? tri)(u);
  });
}

function lfoShpAGraph(c: ControlDef, d: number[]): SVGGElement { // deps: Waveform, Shape, Phase, OutType
  const [wave, shape, phase] = d;
  const ph = lev(phase), s = lev(shape);
  return waveGraph(c, (t) => {
    const u = (t + ph) % 1;
    switch (wave) {
      case 1: return -Math.cos(TAU * u);                       // CosBell
      case 2: return tri(u);                                   // TriBell (Näherung: Dreieck)
      case 3: return (1 - s) * saw(u) + s * tri(u);            // Saw2Tri (Morph über Shape)
      case 4: return (1 - s) * square(u) + s * tri(u);         // Sqr2Tri
      case 5: return square(u);                                // Sqr
      default: return Math.sin(TAU * u);                       // Sine
    }
  });
}

// ---- Dispatch (Graphs.mkGraph) -----------------------------------------------

const ENV_FUNCS: Record<number, (d: number[]) => string> = {
  1: adr, 3: adsr, 6: denv, 7: henv, 17: multiEnv, 23: addsr,
};

/** Best-Effort-GraphFuncs (Näherungen, s. Block oben) → fertige <g>. */
const APPROX_FUNCS: Record<number, (c: ControlDef, d: number[]) => SVGGElement> = {
  10: eqPeakGraph, 14: clipGraph, 15: overdriveGraph, 16: waveWrapGraph,
  30: (c, d) => fltLpHpGraph(c, d, false), 31: (c, d) => fltLpHpGraph(c, d, true),
  32: oscShpAGraph, 33: lfoBGraph, 34: lfoShpAGraph,
  36: eq2BandGraph, 37: eq3BandGraph, 38: shpExpGraph, 39: saturateGraph,
};

/**
 * Graph-Control rendern; depVals = aufgelöste Dependency-Werte (positional).
 * Nicht portierte GraphFuncs liefern null -> Platzhalter-Box (wie g2gui).
 */
export function renderGraph(c: ControlDef, depVals: number[], typeName: string): SVGGElement | null {
  const gf = c.gf ?? 0;
  if (gf === 20) return fltClassic(c, depVals);
  // Best-Effort-Näherungen (Teil 19): nicht in g2gui/G2-Edit, nur visuell.
  const approx = APPROX_FUNCS[gf];
  if (approx) return approx(c, depVals);
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
