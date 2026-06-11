// Grafische Patch-Ansicht: Module + Kabel als SVG, Maße wie g2fx/Original-Editor
// (Grid 255×15 px, Connector-Positionen aus module-defs.json).

import type { Area, Cable, CableEnd, Module, ModuleDef, ModuleDefs } from './protocol';

export const GRID_X = 255;
export const GRID_Y = 15;

// g2lib ParamConstants.MODULE_COLORS (Index = color-Feld des Moduls)
export const MODULE_COLORS = [
  '#EEEEEE', '#BABACC', '#BACCBA', '#CCBAB0', '#AACBD0', '#D4A074',
  '#7A77E5', '#BDC17B', '#80B982', '#48D1E7', '#62D193', '#7DC7DE',
  '#C29A8F', '#817DBA', '#8D8DCA', '#A5D1DE', '#9CCF94', '#C7D669',
  '#C8D2A0', '#D2D2BE', '#C08C80', '#C773D6', '#BE82BE', '#D2A0CD', '#D2BED2',
];

const CABLE_COLORS: Record<string, string> = {
  red: '#d04040', blue: '#4060d0', yellow: '#d0c040', orange: '#d08030',
  green: '#40b050', purple: '#a050c0', white: '#e0e0e0',
};

// Connector-Füllfarben wie g2gui (Audio rot, Control blau, Logic gelb)
const CONN_COLORS: Record<string, string> = {
  audio: '#c04040', control: '#4060c0', logic: '#c0b040',
};

const SVG = 'http://www.w3.org/2000/svg';
const el = <K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

const iconUrl = (def?: ModuleDef) =>
  def ? `/module-icons/${String(def.ix).padStart(3, '0')}.png` : undefined;

export function moduleIcon(defs: ModuleDefs, typeName: string): string | undefined {
  return iconUrl(defs[typeName]);
}

/** Connector-Mittelpunkt in Area-Koordinaten; undefined wenn unbekannt. */
function connCenter(
  defs: ModuleDefs, modules: Map<number, Module>,
  moduleId: number, conn: number, output: boolean,
): { x: number; y: number } | undefined {
  const m = modules.get(moduleId);
  const def = m && defs[m.typeName];
  if (!m || !def) return undefined;
  const c = (output ? def.outputs : def.inputs)[conn];
  if (!c) return undefined;
  return { x: m.col * GRID_X + c.x + 6, y: m.row * GRID_Y + c.y + 6 };
}

/** Kabelpfad mit Durchhang (Quadratische Bezier), wie der Original-Editor. */
function cablePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = b.x - a.x, dy = b.y - a.y;
  const sag = Math.min(40, 10 + Math.hypot(dx, dy) * 0.12);
  return `M ${a.x} ${a.y} Q ${a.x + dx / 2} ${Math.max(a.y, b.y) + sag} ${b.x} ${b.y}`;
}

/**
 * Hit-Pfad fürs Kabel-Anklicken: gleiche Bezier, aber an beiden Enden gekürzt
 * (t 0.08–0.92), damit der breite unsichtbare Strich nicht die Ports unter den
 * Kabel-Endpunkten verdeckt (cableLayer liegt über modLayer).
 */
function cableHitPath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = b.x - a.x;
  const sag = Math.min(40, 10 + Math.hypot(dx, b.y - a.y) * 0.12);
  const cx = a.x + dx / 2, cy = Math.max(a.y, b.y) + sag;
  const pt = (t: number) => {
    const u = 1 - t;
    return `${u * u * a.x + 2 * u * t * cx + t * t * b.x} ${u * u * a.y + 2 * u * t * cy + t * t * b.y}`;
  };
  let d = `M ${pt(0.08)} L`;
  for (let t = 0.16; t <= 0.92; t += 0.08) d += ` ${pt(t)}`;
  return d;
}

/** Client-px -> Area-Koordinaten (zoomfest über viewBox/clientRect). */
function clientToArea(svg: SVGSVGElement, x: number, y: number) {
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  return { x: (x - r.left) * (vb.width / r.width), y: (y - r.top) * (vb.height / r.height) };
}

/**
 * Kabel ziehen: Pointer-Drag von einem Connector zeichnet ein Gummiband;
 * Drop auf einen Connector derselben Area meldet onAddCable. Ziel muss ein
 * Input sein — Out→In und In→In sind gültig, In→Out wird gedreht (wie die
 * Referenz-Editoren), Out→Out ist ungültig.
 */
function attachCableDrag(
  port: SVGElement, svg: SVGSVGElement, overlay: SVGGElement,
  center: { x: number; y: number }, moduleId: number, conn: number, isOut: boolean,
  onAddCable: (from: CableEnd, fromOutput: boolean, to: CableEnd) => void,
) {
  port.addEventListener('pointerdown', (down) => {
    if (down.button !== 0) return;
    down.preventDefault();
    down.stopPropagation(); // kein Modul-Drag auslösen
    port.setPointerCapture(down.pointerId);
    let band: SVGPathElement | null = null;

    const onPointerMove = (ev: PointerEvent) => {
      if (!band) {
        band = el('path', {
          fill: 'none', stroke: '#eee', 'stroke-width': 2,
          'stroke-dasharray': '5 4', 'pointer-events': 'none', opacity: 0.9,
        });
        overlay.appendChild(band);
      }
      band.setAttribute('d', cablePath(center, clientToArea(svg, ev.clientX, ev.clientY)));
    };
    const onPointerUp = (ev: PointerEvent) => {
      port.removeEventListener('pointermove', onPointerMove);
      port.removeEventListener('pointerup', onPointerUp);
      const dragged = band !== null;
      band?.remove();
      if (!dragged) return; // Klick ohne Bewegung: Ports haben kein Klickverhalten
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const t = hit instanceof Element ? hit.closest('[data-conn]') : null;
      if (!t || t === port || t.closest('svg') !== svg) return; // gleiche Area nötig
      const target: CableEnd = {
        module: Number(t.getAttribute('data-module')),
        conn: Number(t.getAttribute('data-conn')),
      };
      const targetOut = t.getAttribute('data-out') === '1';
      const source: CableEnd = { module: moduleId, conn };
      if (isOut && targetOut) return; // Out→Out gibt es nicht
      if (targetOut) onAddCable(target, true, source); // In→Out drehen
      else onAddCable(source, isOut, target);
    };
    port.addEventListener('pointermove', onPointerMove);
    port.addEventListener('pointerup', onPointerUp);
  });
}

export interface AreaView {
  svg: SVGSVGElement;
  /** Auswahl-Hervorhebung setzen (Menge der moduleIds). */
  select(moduleIds: Set<number>): void;
  /** Kabel-Auswahl-Hervorhebung aufheben. */
  clearCableSelection(): void;
}

export function renderArea(
  area: Area, modules: Module[], cables: Cable[], defs: ModuleDefs,
  onSelect: (m: Module, additive: boolean) => void,
  onMove: (moves: { module: number; col: number; row: number }[]) => void,
  onAddCable: (from: CableEnd, fromOutput: boolean, to: CableEnd) => void,
  onSelectCable: (c: Cable | null) => void,
  onRectSelect: (ids: number[], additive: boolean) => void,
  selectedIds: () => Set<number>,
): AreaView {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const cols = Math.max(...modules.map((m) => m.col), 0) + 1;
  const rows = Math.max(...modules.map((m) => m.row + (defs[m.typeName]?.height ?? 2)), 4);
  const w = cols * GRID_X, h = rows * GRID_Y;

  const svg = el('svg', { class: 'area', viewBox: `0 0 ${w} ${h}`, width: w, height: h });
  svg.dataset.area = area;
  const modLayer = el('g', {});
  const cableLayer = el('g', {});
  const overlay = el('g', {}); // Gummiband beim Kabelziehen, immer zuoberst
  svg.append(modLayer, cableLayer, overlay);

  // Klick auf leere Fläche hebt die Kabel-Auswahl auf
  svg.addEventListener('click', (ev) => {
    if (ev.target === svg) {
      clearCableSel();
      onSelectCable(null);
    }
  });

  const groups = new Map<number, SVGGElement>();

  /**
   * Drag&Drop mit Grid-Snap; ein Klick ohne Bewegung ist Auswahl (Shift = Toggle).
   * Ist das Modul Teil einer Mehrfach-Auswahl, zieht der Drag die GANZE Selektion
   * als starren Block mit (Kabel folgen erst mit dem Re-Render — Server ist
   * Single Source of Truth).
   */
  const attachModuleDrag = (g: SVGGElement, m: Module) => {
    g.addEventListener('pointerdown', (down) => {
      if (down.button !== 0) return;
      down.preventDefault();
      g.setPointerCapture(down.pointerId);
      // Client-px -> Area-Koordinaten (berücksichtigt Zoom über width/viewBox)
      const scale = svg.viewBox.baseVal.width / svg.getBoundingClientRect().width;
      const sel = selectedIds();
      const dragMods = sel.has(m.id) && sel.size > 1
        ? [...sel].map((id) => byId.get(id)!).filter(Boolean)
        : [m];
      // Kein Modul der Selektion darf links/oben aus dem Grid rutschen
      const minCol = Math.min(...dragMods.map((d) => d.col));
      const minRow = Math.min(...dragMods.map((d) => d.row));
      let dCol = 0, dRow = 0, moved = false;

      const place = (opacity: string) => {
        for (const d of dragMods) {
          const gg = groups.get(d.id)!;
          gg.setAttribute('transform',
            `translate(${(d.col + dCol) * GRID_X},${(d.row + dRow) * GRID_Y})`);
          gg.setAttribute('opacity', opacity);
        }
      };
      const onPointerMove = (ev: PointerEvent) => {
        dCol = Math.max(Math.round((ev.clientX - down.clientX) * scale / GRID_X), -minCol);
        dRow = Math.max(Math.round((ev.clientY - down.clientY) * scale / GRID_Y), -minRow);
        if (dCol || dRow) moved = true;
        place(moved ? '0.7' : '1');
      };
      const onPointerUp = () => {
        g.removeEventListener('pointermove', onPointerMove);
        g.removeEventListener('pointerup', onPointerUp);
        if (moved && (dCol || dRow)) {
          place('1');
          // Bestätigung kommt als moduleMoved + Re-Render
          onMove(dragMods.map((d) => ({ module: d.id, col: d.col + dCol, row: d.row + dRow })));
        } else {
          dCol = 0; dRow = 0;
          place('1');
          onSelect(m, down.shiftKey);
        }
      };
      g.addEventListener('pointermove', onPointerMove);
      g.addEventListener('pointerup', onPointerUp);
    });
  };

  // Gummiband-Selektion: Drag auf leerer Fläche wählt alle berührten Module
  // (Shift = zur Auswahl hinzufügen); Klick ohne Bewegung hebt die Auswahl auf.
  svg.addEventListener('pointerdown', (down) => {
    if (down.target !== svg || down.button !== 0) return;
    down.preventDefault();
    svg.setPointerCapture(down.pointerId);
    const start = clientToArea(svg, down.clientX, down.clientY);
    let band: SVGRectElement | null = null;

    const onPointerMove = (ev: PointerEvent) => {
      if (!band) {
        band = el('rect', {
          fill: 'rgba(120,160,255,.12)', stroke: '#7aa0ff',
          'stroke-dasharray': '4 3', 'pointer-events': 'none',
        });
        overlay.appendChild(band);
      }
      const cur = clientToArea(svg, ev.clientX, ev.clientY);
      band.setAttribute('x', String(Math.min(start.x, cur.x)));
      band.setAttribute('y', String(Math.min(start.y, cur.y)));
      band.setAttribute('width', String(Math.abs(cur.x - start.x)));
      band.setAttribute('height', String(Math.abs(cur.y - start.y)));
    };
    const onPointerUp = (ev: PointerEvent) => {
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', onPointerUp);
      const dragged = band !== null;
      band?.remove();
      if (!dragged) {
        onRectSelect([], false); // Klick auf leere Fläche: Auswahl aufheben
        return;
      }
      const cur = clientToArea(svg, ev.clientX, ev.clientY);
      const x0 = Math.min(start.x, cur.x), x1 = Math.max(start.x, cur.x);
      const y0 = Math.min(start.y, cur.y), y1 = Math.max(start.y, cur.y);
      const ids = modules.filter((mm) => {
        const mx = mm.col * GRID_X, my = mm.row * GRID_Y;
        const mh = (defs[mm.typeName]?.height ?? 2) * GRID_Y;
        return mx < x1 && mx + GRID_X > x0 && my < y1 && my + mh > y0;
      }).map((mm) => mm.id);
      onRectSelect(ids, ev.shiftKey);
    };
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
  });

  for (const m of modules) {
    const def = defs[m.typeName];
    const mh = (def?.height ?? 2) * GRID_Y;
    const g = el('g', { class: 'mod', transform: `translate(${m.col * GRID_X},${m.row * GRID_Y})` });
    g.appendChild(el('rect', {
      class: 'body', width: GRID_X - 1, height: mh - 1, rx: 1,
      fill: MODULE_COLORS[m.color] ?? MODULE_COLORS[0],
    }));
    const icon = iconUrl(def);
    if (icon) {
      const img = el('image', { x: 2, y: 1, width: 13, height: 13 });
      img.setAttribute('href', icon);
      g.appendChild(img);
    }
    const label = el('text', { x: icon ? 17 : 3, y: 11, 'font-size': 10, fill: '#222' });
    label.textContent = m.name || m.typeName;
    g.appendChild(label);

    if (def) {
      for (const [list, isOut] of [[def.inputs, false], [def.outputs, true]] as const) {
        list.forEach((c, conn) => {
          const fill = CONN_COLORS[c.type] ?? '#888';
          const port = isOut
            ? el('rect', { x: c.x + 1, y: c.y + 1, width: 10, height: 10, fill, stroke: '#222' })
            : el('circle', { cx: c.x + 6, cy: c.y + 6, r: 5, fill, stroke: '#222' });
          port.setAttribute('data-module', String(m.id));
          port.setAttribute('data-conn', String(conn));
          port.setAttribute('data-out', isOut ? '1' : '0');
          port.style.cursor = 'crosshair';
          const center = { x: m.col * GRID_X + c.x + 6, y: m.row * GRID_Y + c.y + 6 };
          attachCableDrag(port, svg, overlay, center, m.id, conn, isOut, onAddCable);
          g.appendChild(port);
        });
      }
    }
    attachModuleDrag(g, m);
    groups.set(m.id, g);
    modLayer.appendChild(g);
  }

  // Kabel: sichtbarer Pfad + breiter unsichtbarer Hit-Pfad (Klick = Auswahl,
  // Hover = Hervorhebung — hilft bei sich kreuzenden Kabeln)
  const cablePaths: SVGPathElement[] = [];
  let selectedVisible: SVGPathElement | null = null;
  const emphasize = (p: SVGPathElement, on: boolean) => {
    p.setAttribute('stroke-width', on ? '5' : '3');
    p.setAttribute('opacity', on ? '1' : '0.85');
  };
  const clearCableSel = () => {
    selectedVisible = null;
    for (const p of cablePaths) emphasize(p, false);
  };
  for (const c of cables.filter((c) => c.area === area)) {
    const a = connCenter(defs, byId, c.from.module, c.from.conn, c.fromOutput ?? true);
    const b = connCenter(defs, byId, c.to.module, c.to.conn, false);
    if (!a || !b) continue;
    const stroke = CABLE_COLORS[c.color] ?? c.color;
    const d = cablePath(a, b);
    const visible = el('path', {
      d, fill: 'none', stroke, 'stroke-width': 3,
      'stroke-linecap': 'round', opacity: 0.85, 'pointer-events': 'none',
    });
    cablePaths.push(visible);
    const hit = el('path', {
      d: cableHitPath(a, b), fill: 'none', stroke: 'transparent', 'stroke-width': 9,
    });
    hit.style.cursor = 'pointer';
    hit.addEventListener('click', (ev) => {
      ev.stopPropagation();
      clearCableSel();
      selectedVisible = visible;
      emphasize(visible, true);
      onSelectCable(c);
    });
    hit.addEventListener('pointerenter', () => emphasize(visible, true));
    hit.addEventListener('pointerleave', () => {
      if (visible !== selectedVisible) emphasize(visible, false);
    });
    cableLayer.append(hit, visible);
    for (const p of [a, b]) {
      cableLayer.appendChild(el('circle', {
        cx: p.x, cy: p.y, r: 4, fill: stroke, stroke: '#111', 'pointer-events': 'none',
      }));
    }
  }

  return {
    svg,
    select(moduleIds) {
      groups.forEach((g, id) => g.classList.toggle('selected', moduleIds.has(id)));
    },
    clearCableSelection: clearCableSel,
  };
}
