// Original-Layout der Modulflächen: rendert die Controls aus module-defs.json
// (g2fx module-uis.yaml) als SVG in die Modul-Gruppe. Interaktiv: Knobs (Drag),
// Buttons/Radio/IncDec/PartSelector (Klick) — senden setParam/setMode.
// LED/MiniVU leben von den "visuals"-Broadcasts (m.visuals + applyVisual),
// Graph-Kurven rechnet graphfuncs.ts aus den Param-Werten.

import type { ControlDef, Module, ModuleDef } from './protocol';
import { formatTextFunc } from './textfuncs';
import { renderGraph } from './graphfuncs';

export interface ControlCtx {
  /**
   * Param/Mode lokal setzen + senden; der Aufrufer (graph.ts) baut danach den
   * Control-Layer neu auf. Deshalb hängen Drag-/Release-Listener hier am
   * document — die Control-Elemente werden beim Rebuild ersetzt.
   */
  setParam(m: Module, param: number, value: number): void;
  setMode(m: Module, mode: number, value: number): void;
}

const SVG = 'http://www.w3.org/2000/svg';
const el = <K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

const text = (x: number, y: number, t: string, size = 8, fill = '#222', anchor = 'start') => {
  const e = el('text', { x, y, 'font-size': size, fill, 'text-anchor': anchor });
  e.textContent = t;
  return e;
};

const pv = (m: Module, i: number) => m.params[i]?.value ?? 0;
const ptext = (m: Module, i: number) => m.params[i]?.text ?? String(pv(m, i));
const mval = (m: Module, i: number) => m.modes?.[i]?.value ?? 0;

/** Dependency-Wert: Zahl = Param-Index, "S<n>" = Mode-Index. */
const depVal = (m: Module, d: number | string) =>
  typeof d === 'string' ? mval(m, Number(d.slice(1))) : pv(m, d);

const imgUrl = (name: string) => `/module-images/${name}`;

/** Klick-Handler, der den Modul-Drag nicht auslöst. */
function clickable(e: SVGElement, onClick: () => void) {
  e.style.cursor = 'pointer';
  e.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); ev.preventDefault(); });
  e.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); });
}

function cycle(m: Module, i: number, ctx: ControlCtx, isMode: boolean) {
  const def = isMode ? m.modes?.[i] : m.params[i];
  if (!def) return;
  const next = pvOrM() >= def.max ? def.min : pvOrM() + 1;
  if (isMode) ctx.setMode(m, i, next); else ctx.setParam(m, i, next);
  function pvOrM() { return isMode ? mval(m, i) : pv(m, i); }
}

// ---- Knob (Drag vertikal) --------------------------------------------------

const KNOB_R: Record<string, number> = {
  Small: 4.5, Medium: 5.5, Big: 7, Reset: 4.5, ResetMedium: 5.5,
};

function knob(g: SVGGElement, c: ControlDef, m: Module, ctx: ControlCtx) {
  const p = c.p!;
  const def = m.params[p];
  if (!def) return;
  const range = Math.max(1, def.max - def.min);
  if (c.kt === 'Slider' || c.kt === 'SeqSlider') {
    const w = 10, h = c.kt === 'SeqSlider' ? 44 : 26;
    const grp = el('g', { transform: `translate(${c.x},${c.y})` });
    grp.appendChild(el('rect', { x: 0, y: 0, width: w, height: h, fill: '#bbb', stroke: '#555', rx: 1 }));
    const frac = (pv(m, p) - def.min) / range;
    const hy = (1 - frac) * (h - 4);
    grp.appendChild(el('rect', { x: -1, y: hy, width: w + 2, height: 4, fill: '#333', stroke: '#111' }));
    attachKnobDrag(grp, m, p, range, h, ctx);
    g.appendChild(grp);
    return;
  }
  const r = KNOB_R[c.kt ?? 'Medium'] ?? 5.5;
  const cx = c.x + r, cy = c.y + r;
  const grp = el('g', {});
  grp.appendChild(el('circle', { cx, cy, r, fill: '#e6e6e6', stroke: '#444' }));
  const frac = (pv(m, p) - def.min) / range;
  const a = (-135 + 270 * frac) * (Math.PI / 180);
  grp.appendChild(el('line', {
    x1: cx, y1: cy, x2: cx + r * Math.sin(a), y2: cy - r * Math.cos(a),
    stroke: '#222', 'stroke-width': 1.4,
  }));
  if (c.kt === 'Reset' || c.kt === 'ResetMedium') {
    grp.appendChild(el('path', {
      d: `M ${cx - 2} ${cy - r - 3} h4 l-2 2.5 z`, fill: '#444',
    }));
  }
  attachKnobDrag(grp, m, p, range, 100, ctx);
  g.appendChild(grp);
}

/** Vertikaler Drag: travel px für den vollen Bereich. */
function attachKnobDrag(grp: SVGGElement, m: Module, p: number,
                        range: number, travel: number, ctx: ControlCtx) {
  grp.style.cursor = 'ns-resize';
  grp.addEventListener('pointerdown', (down) => {
    down.stopPropagation();
    down.preventDefault();
    const def = m.params[p];
    const start = pv(m, p);
    let last = start;
    // Listener am document: grp wird beim setParam-Rebuild ersetzt
    const onMove = (ev: PointerEvent) => {
      const v = Math.round(start + (down.clientY - ev.clientY) * (range / travel));
      const nv = Math.min(def.max, Math.max(def.min, v));
      if (nv !== last) { last = nv; ctx.setParam(m, p, nv); }
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

// ---- Buttons ----------------------------------------------------------------

function buttonRect(g: SVGGElement, x: number, y: number, w: number, h: number,
                    active: boolean): SVGRectElement {
  const r = el('rect', {
    x, y, width: w, height: h, rx: 1.5,
    fill: active ? '#e8d96f' : '#d6d6d6', stroke: '#555',
  });
  g.appendChild(r);
  return r;
}

function buttonImg(g: SVGGElement, x: number, y: number, img: string,
                   w: number, h: number) {
  const im = el('image', { x: x + 1, y: y + 1, width: w - 2, height: h - 2 });
  im.setAttribute('href', imgUrl(img));
  im.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  im.style.pointerEvents = 'none';
  g.appendChild(im);
}

function buttonText(g: SVGGElement, c: ControlDef, m: Module, ctx: ControlCtx) {
  const p = c.p!, w = c.w ?? 13, h = 11;
  const grp = el('g', {});
  const on = pv(m, p) > 0;
  buttonRect(grp, c.x, c.y, w, h, on);
  if (c.imgs?.length) {
    buttonImg(grp, c.x, c.y, c.imgs[Math.min(on ? 1 : 0, c.imgs.length - 1)], w, h);
  } else {
    grp.appendChild(text(c.x + w / 2, c.y + h - 3, c.t ?? '', 8, '#222', 'middle'));
  }
  if (c.push) {
    grp.style.cursor = 'pointer';
    grp.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      ctx.setParam(m, p, 1);
      // up-Listener am document: grp wird beim Rebuild ersetzt
      const up = () => { ctx.setParam(m, p, 0); document.removeEventListener('pointerup', up); };
      document.addEventListener('pointerup', up);
    });
  } else {
    clickable(grp, () => ctx.setParam(m, p, on ? 0 : 1));
  }
  g.appendChild(grp);
}

function buttonFlat(g: SVGGElement, c: ControlDef, m: Module, ctx: ControlCtx) {
  const p = c.p!, w = c.w ?? 20, h = 11;
  const grp = el('g', {});
  buttonRect(grp, c.x, c.y, w, h, false);
  const v = pv(m, p);
  if (c.imgs?.length) buttonImg(grp, c.x, c.y, c.imgs[Math.min(v, c.imgs.length - 1)], w, h);
  else grp.appendChild(text(c.x + w / 2, c.y + h - 3, c.ts?.[v] ?? String(v), 8, '#222', 'middle'));
  clickable(grp, () => cycle(m, p, ctx, false));
  g.appendChild(grp);
}

function buttonRadio(g: SVGGElement, c: ControlDef, m: Module, ctx: ControlCtx) {
  const p = c.p!, n = c.n ?? 2, bw = c.bw ?? 14, h = 11;
  const grp = el('g', {});
  const v = pv(m, p);
  for (let i = 0; i < n; i++) {
    const bx = c.x + (c.vert ? 0 : i * bw);
    const by = c.y + (c.vert ? i * h : 0);
    const seg = el('g', {});
    buttonRect(seg, bx, by, bw, h, i === v);
    if (c.imgs?.length) buttonImg(seg, bx, by, c.imgs[Math.min(i, c.imgs.length - 1)], bw, h);
    else seg.appendChild(text(bx + bw / 2, by + h - 3, c.ts?.[i] ?? String(i), 8, '#222', 'middle'));
    clickable(seg, () => ctx.setParam(m, p, i));
    grp.appendChild(seg);
  }
  g.appendChild(grp);
}

function buttonRadioEdit(g: SVGGElement, c: ControlDef, m: Module, ctx: ControlCtx) {
  const p = c.p!, cols = c.cols ?? 1, rows = c.rows ?? 1, bw = 22, h = 11;
  const grp = el('g', {});
  const v = pv(m, p);
  for (let i = 0; i < cols * rows; i++) {
    const bx = c.x + (i % cols) * bw, by = c.y + Math.floor(i / cols) * h;
    const seg = el('g', {});
    buttonRect(seg, bx, by, bw, h, i === v);
    seg.appendChild(text(bx + bw / 2, by + h - 3, c.ts?.[i] ?? String(i), 7, '#222', 'middle'));
    clickable(seg, () => ctx.setParam(m, p, i));
    grp.appendChild(seg);
  }
  g.appendChild(grp);
}

function buttonIncDec(g: SVGGElement, c: ControlDef, m: Module, ctx: ControlCtx) {
  const p = c.p!;
  const def = m.params[p];
  if (!def) return;
  const bw = 9, bh = 7;
  const mk = (dx: number, dy: number, delta: number, label: string) => {
    const seg = el('g', {});
    buttonRect(seg, c.x + dx, c.y + dy, bw, bh, false);
    seg.appendChild(text(c.x + dx + bw / 2, c.y + dy + bh - 1.5, label, 6, '#222', 'middle'));
    clickable(seg, () => {
      const nv = Math.min(def.max, Math.max(def.min, pv(m, p) + delta));
      if (nv !== pv(m, p)) ctx.setParam(m, p, nv);
    });
    g.appendChild(seg);
  };
  if (c.vert) { mk(0, 0, 1, '▲'); mk(0, bh, -1, '▼'); }
  else { mk(0, 0, -1, '◂'); mk(bw, 0, 1, '▸'); }
}

function partSelector(g: SVGGElement, c: ControlDef, m: Module, ctx: ControlCtx) {
  const mi = c.p!, w = c.w ?? 24, h = c.h ?? 12;
  const grp = el('g', {});
  const v = mval(m, mi);
  buttonRect(grp, c.x, c.y, w, h, false);
  if (c.imgs?.length) buttonImg(grp, c.x, c.y, c.imgs[Math.min(v, c.imgs.length - 1)], w, h);
  else {
    const enums = m.modes?.[mi]?.enums;
    grp.appendChild(text(c.x + w / 2, c.y + h - 3, enums?.[v] ?? String(v), 7, '#222', 'middle'));
  }
  clickable(grp, () => cycle(m, mi, ctx, true));
  g.appendChild(grp);
}

function levelShift(g: SVGGElement, c: ControlDef, m: Module, ctx: ControlCtx) {
  const p = c.p!, w = 17, h = 11;
  const grp = el('g', {});
  buttonRect(grp, c.x, c.y, w, h, false);
  grp.appendChild(text(c.x + w / 2, c.y + h - 3, ptext(m, p), 6, '#222', 'middle'));
  clickable(grp, () => cycle(m, p, ctx, false));
  g.appendChild(grp);
}

// ---- Statisches -------------------------------------------------------------

function symbol(g: SVGGElement, c: ControlDef) {
  const w = c.w ?? 4, h = c.h ?? 10;
  switch (c.sym) {
    case 'Trig1': // Puls-Symbol steigende Flanke
    case 'Trig2': {
      const y0 = c.y + h, y1 = c.y;
      const d = c.sym === 'Trig1'
        ? `M ${c.x} ${y0} h${w} V ${y1} h${w}`
        : `M ${c.x} ${y0} h${w} V ${y1} h${w} V ${y0} h${w}`;
      g.appendChild(el('path', { d, fill: 'none', stroke: '#222', 'stroke-width': 1 }));
      break;
    }
    case 'Box':
      g.appendChild(el('rect', {
        x: c.x, y: c.y, width: w, height: h, fill: 'none', stroke: '#222',
      }));
      break;
    case 'Amplifier':
      g.appendChild(el('path', {
        d: `M ${c.x} ${c.y} l${w} ${h / 2} l-${w} ${h / 2} z`,
        fill: 'none', stroke: '#222',
      }));
      break;
  }
}

// ---- LED / MiniVU (live über "visuals"-Broadcasts) ---------------------------

const LED_OFF = '#1d4d1d', LED_ON = '#35e835';
const VU_COLORS = [
  { off: '#005500', on: '#00ff00' }, // grün  (Level 1–7)
  { off: '#555500', on: '#ffff00' }, // gelb  (8–9)
  { off: '#550000', on: '#ff0000' }, // rot   (10)
];
const vuBand = (lv: number) => (lv <= 7 ? 0 : lv <= 9 ? 1 : 2);

/** Aktueller Visual-Wert aus dem Client-State (kommt aus "visuals"). */
const visVal = (m: Module, kind: 'led' | 'meter', g: number) =>
  m.visuals?.[`${kind}:${g}`] ?? 0;

function led(g: SVGGElement, c: ControlDef, m: Module) {
  // Einzel-LED hört auf "led:<g>", Gruppen-LED auf "meter:<g>" (an wenn == CodeRef)
  const kind = c.grp ? 'meter' : 'led';
  const v = visVal(m, kind, c.g ?? 0);
  const lit = c.grp ? v === (c.p ?? 0) : v > 0;
  const e = c.lt === 'Sequencer'
    ? el('rect', { x: c.x, y: c.y, width: 8, height: 4, fill: lit ? LED_ON : LED_OFF, stroke: '#143314' })
    : el('circle', { cx: c.x + 2.5, cy: c.y + 2.5, r: 2.5, fill: lit ? LED_ON : LED_OFF, stroke: '#143314' });
  e.setAttribute('data-vis', kind === 'led' ? 'led' : 'gled');
  e.setAttribute('data-g', String(c.g ?? 0));
  e.setAttribute('data-ref', String(c.p ?? 0));
  g.appendChild(e);
}

/** 10 Segmente wie g2gui VuMeter: 7 grün (1 Einheit), 2 gelb + 1 rot (je 2). */
function miniVU(g: SVGGElement, c: ControlDef, m: Module) {
  const vert = c.vert !== false;
  const W = vert ? 5 : 13, H = vert ? 13 : 5;
  const grp = el('g', { 'data-vis': 'vu', 'data-g': c.g ?? 0 });
  grp.appendChild(el('rect', {
    x: c.x - 0.5, y: c.y - 0.5, width: W + 1, height: H + 1, fill: '#111', stroke: '#444',
  }));
  const level = visVal(m, 'meter', c.g ?? 0);
  const unit = (vert ? H : W) / 13;
  let pos = vert ? c.y + H : c.x; // vertikal: von unten nach oben; horizontal: links->rechts
  for (let i = 1; i <= 10; i++) {
    const band = vuBand(i);
    const len = band === 0 ? unit : unit * 2;
    if (vert) pos -= len;
    const colors = VU_COLORS[band];
    const r = vert
      ? el('rect', { x: c.x, y: pos, width: W, height: len })
      : el('rect', { x: pos, y: c.y, width: len, height: H });
    r.setAttribute('data-lv', String(i));
    r.setAttribute('fill', i <= level ? colors.on : colors.off);
    if (!vert) pos += len;
    grp.appendChild(r);
  }
  g.appendChild(grp);
}

// Peak-Hold pro VU-Element (1 s wie g2gui), lebt am DOM-Knoten
const vuPeaks = new WeakMap<Element, { peak: number; level: number; timer: number }>();

/**
 * Visual-Update in-place anwenden (ohne Control-Layer-Rebuild — der läuft bei
 * jedem paramChanged und liest die Werte dann aus m.visuals).
 * kind "led" = Einzel-LEDs (0x39), "meter" = VUs + LED-Gruppen (0x3a).
 */
export function applyVisual(host: SVGGElement, kind: 'led' | 'meter', g: number, value: number): void {
  if (kind === 'led') {
    host.querySelectorAll(`[data-vis="led"][data-g="${g}"]`).forEach((e) =>
      e.setAttribute('fill', value > 0 ? LED_ON : LED_OFF));
    return;
  }
  host.querySelectorAll(`[data-vis="gled"][data-g="${g}"]`).forEach((e) =>
    e.setAttribute('fill', value === Number(e.getAttribute('data-ref')) ? LED_ON : LED_OFF));
  host.querySelectorAll(`[data-vis="vu"][data-g="${g}"]`).forEach((vu) => {
    let st = vuPeaks.get(vu);
    if (!st) { st = { peak: 0, level: 0, timer: 0 }; vuPeaks.set(vu, st); }
    const s = st;
    s.level = value;
    const paint = () => {
      vu.querySelectorAll('[data-lv]').forEach((r) => {
        const lv = Number(r.getAttribute('data-lv'));
        const colors = VU_COLORS[vuBand(lv)];
        const lit = lv <= s.level || (lv === s.peak && s.peak > 7);
        r.setAttribute('fill', lit ? colors.on : colors.off);
      });
    };
    clearTimeout(s.timer);
    if (value >= s.peak) {
      s.peak = value;
    } else {
      s.timer = window.setTimeout(() => { s.peak = 0; paint(); }, 1000);
    }
    paint();
  });
}

// ---- TextField --------------------------------------------------------------

function textField(g: SVGGElement, c: ControlDef, m: Module) {
  const w = c.w ?? 30, h = 10;
  g.appendChild(el('rect', {
    x: c.x, y: c.y, width: w, height: h, rx: 1,
    fill: '#2e3328', stroke: '#555',
  }));
  const deps = (c.deps ?? []).map((d) => depVal(m, d));
  const t = (c.tf !== undefined ? formatTextFunc(c.tf, deps) : null) ?? ptext(m, c.p ?? 0);
  g.appendChild(text(c.x + w / 2, c.y + h - 2.5, t, 7, '#cfe3b8', 'middle'));
}

// ---- Haupteinstieg ----------------------------------------------------------

/**
 * Control-Layer eines Moduls (neu) aufbauen. Liest die aktuellen Werte aus
 * m.params/m.modes — für Updates einfach erneut aufrufen (ersetzt den Layer).
 */
export function renderControls(host: SVGGElement, m: Module, def: ModuleDef,
                               ctx: ControlCtx): void {
  host.querySelector(':scope > g.ctls')?.remove();
  const g = el('g', { class: 'ctls' });
  for (const c of def.controls ?? []) {
    switch (c.cls) {
      case 'Text': g.appendChild(text(c.x, c.y + 8, c.t ?? '', 8.5)); break;
      case 'Line': {
        const x2 = c.x + (c.vert ? 0 : c.len ?? 0);
        const y2 = c.y + (c.vert ? c.len ?? 0 : 0);
        g.appendChild(el('line', {
          x1: c.x, y1: c.y, x2, y2, stroke: '#666',
          'stroke-width': c.thick ? 2 : 1,
        }));
        break;
      }
      case 'Symbol': symbol(g, c); break;
      case 'Bitmap':
        if (c.img) {
          const im = el('image', { x: c.x, y: c.y, width: c.w ?? 16, height: c.h ?? 16 });
          im.setAttribute('href', imgUrl(c.img));
          im.style.pointerEvents = 'none';
          g.appendChild(im);
        } else {
          g.appendChild(text(c.x, c.y + 8, c.t ?? '', 7.5));
        }
        break;
      case 'Knob': knob(g, c, m, ctx); break;
      case 'ButtonText': case 'TextEdit': buttonText(g, c, m, ctx); break;
      case 'ButtonFlat': buttonFlat(g, c, m, ctx); break;
      case 'ButtonRadio': buttonRadio(g, c, m, ctx); break;
      case 'ButtonRadioEdit': buttonRadioEdit(g, c, m, ctx); break;
      case 'ButtonIncDec': buttonIncDec(g, c, m, ctx); break;
      case 'PartSelector': partSelector(g, c, m, ctx); break;
      case 'LevelShift': levelShift(g, c, m, ctx); break;
      case 'TextField': textField(g, c, m); break;
      case 'Led': led(g, c, m); break;
      case 'MiniVU': miniVU(g, c, m); break;
      case 'Graph': {
        const depVals = (c.deps ?? []).map((d) => depVal(m, d));
        const gg = renderGraph(c, depVals, m.typeName);
        g.appendChild(gg ?? el('rect', {
          x: c.x, y: c.y, width: c.w ?? 30, height: c.h ?? 20, rx: 1,
          fill: '#20241d', stroke: '#555',
        }));
        break;
      }
    }
  }
  // Vor den Ports einfügen (data-conn), damit die Ports klickbar obenauf bleiben
  host.insertBefore(g, host.querySelector(':scope > [data-conn]'));
}
