import type {
  Area, Bank, Cable, ClientMessage, GlobalKnob, Module, ModuleDefs, MorphGroup,
  PatchState, PerfSettings, ServerMessage, UndoInfo,
} from './protocol';
import { type AreaView, MODULE_COLORS, moduleIcon, renderArea } from './graph';
import { setTables } from './textfuncs';

const $ = (id: string) => document.getElementById(id)!;
const connEl = $('conn');
const patchEl = $('patch');
const patchNameEl = $('patchname');
const perfInfoEl = $('perfinfo');
const variationsEl = $('variations');
const slotsEl = $('slots');
const undoBtn = $('undobtn') as HTMLButtonElement;
const redoBtn = $('redobtn') as HTMLButtonElement;
const bankListEl = $('banklist');
const perfListEl = $('perflist');
const perfPanelEl = $('perfpanel');
const paramsBodyEl = $('paramsbody');

const VARIATION_COUNT = 8;
let currentVariation = 0;
let currentPatch: PatchState | null = null;
let moduleDefs: ModuleDefs = {};
// Mehrfach-Auswahl: Modul-Ids EINER Area (Rechteck/Shift-Klick); das Param-Panel
// zeigt nur bei genau einem Modul Details.
let selected: { area: Area; ids: number[] } | null = null;
let selectedCable: Cable | null = null;
let zoom = 1;
const areaViews = new Map<Area, AreaView>();
let ws: WebSocket;

// ---------------------------------------------------------------- WebSocket

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => setConn(true, 'verbunden');
  ws.onclose = () => {
    setConn(false, 'getrennt — reconnect…');
    setTimeout(connect, 2000);
  };
  ws.onmessage = (ev) => handle(JSON.parse(ev.data) as ServerMessage);
}

const send = (msg: ClientMessage) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

function setConn(ok: boolean, text: string) {
  connEl.className = ok ? 'ok' : 'bad';
  connEl.textContent = text;
}

function handle(msg: ServerMessage) {
  switch (msg.type) {
    case 'patchState':
      renderPatch(msg);
      break;
    case 'paramChanged': {
      // Events tragen den Slot — Änderungen nicht-angezeigter Slots ignorieren
      if (msg.slot && currentPatch && msg.slot !== currentPatch.slot) break;
      if (msg.variation !== currentVariation) break;
      if (msg.area === 'settings') {
        // Patch-Settings/Morph-Dials: State nachziehen (Input via data-attrs unten)
        const sp = currentPatch?.settings?.find((s) => s.id === msg.module)
          ?.params.find((x) => x.id === msg.param);
        if (sp) sp.value = msg.value;
        if (msg.module === 1 && currentPatch?.morphs) { // Morphs-Pseudo-Modul
          if (msg.param < 8) currentPatch.morphs[msg.param].dial = msg.value;
          else if (msg.param < 16) {
            currentPatch.morphs[msg.param - 8].mode = msg.value;
            // Mode-Toggle (Knob/Morph) ist ein <select>, kein data-attr-Input —
            // Panel neu zeichnen, damit es dem (auch gerät-initiierten) Stand folgt.
            if (!selected) renderSettingsPanel();
          }
        }
      } else {
        // State nachziehen, damit Re-Renders (Auswahl/Zoom) aktuelle Werte zeigen
        const mod = findModule(msg.area, msg.module);
        const p = mod?.params.find((x) => x.id === msg.param);
        if (p) {
          p.value = msg.value;
          if (msg.text !== undefined) p.text = msg.text;
        }
        areaViews.get(msg.area)?.updateModule(msg.module); // Modul-Controls nachziehen
      }
      const input = document.querySelector<HTMLInputElement>(
        `input[data-area="${msg.area}"][data-module="${msg.module}"][data-param="${msg.param}"]`);
      if (input && document.activeElement !== input) {
        input.value = String(msg.value);
        input.parentElement!.querySelector('span')!.textContent = String(msg.value);
      }
      break;
    }
    case 'modeChanged': {
      if (msg.slot && currentPatch && msg.slot !== currentPatch.slot) break;
      const mod = findModule(msg.area, msg.module);
      const md = mod?.modes?.find((x) => x.id === msg.mode);
      if (md) md.value = msg.value;
      areaViews.get(msg.area)?.updateModule(msg.module);
      break;
    }
    case 'morphLabelsChanged': {
      const g = currentPatch?.morphs?.[msg.morph];
      if (g) {
        g.label = msg.label;
        if (!selected) renderSettingsPanel();
      }
      break;
    }
    case 'morphChanged': {
      if (msg.variation !== currentVariation || !currentPatch?.morphs) break;
      // Ein Param hängt an höchstens einem Morph: alte Zuweisung überall raus …
      for (const g of currentPatch.morphs) {
        g.assigns = g.assigns.filter((a) => !(a.area === msg.area
          && a.module === msg.module && a.param === msg.param));
      }
      // … neue rein (range 0 = nur löschen)
      if (msg.range !== 0) {
        currentPatch.morphs[msg.morph]?.assigns.push({
          area: msg.area, module: msg.module, param: msg.param, range: msg.range });
      }
      // Panel aktualisieren, falls es die Zuweisung anzeigt
      if (!selected) renderSettingsPanel();
      else if (selected.ids.length === 1 && selected.area === msg.area
               && selected.ids[0] === msg.module) {
        const m = findModule(selected.area, selected.ids[0]);
        if (m) renderParamPanel(m);
      }
      break;
    }
    case 'moduleMoved': {
      const mod = findModule(msg.area, msg.module);
      if (mod && currentPatch) {
        mod.col = msg.col;
        mod.row = msg.row;
        renderPatch(currentPatch); // Kabel folgen mit
      }
      break;
    }
    case 'cableAdded':
      if (currentPatch && !findCable(msg.area, msg.from, msg.to)) {
        currentPatch.cables.push({ area: msg.area, from: msg.from, to: msg.to,
          fromOutput: msg.fromOutput, color: msg.color });
        renderPatch(currentPatch);
      }
      break;
    case 'cableDeleted':
      if (currentPatch) {
        currentPatch.cables = currentPatch.cables.filter((c) =>
          !(c.area === msg.area
            && c.from.module === msg.from.module && c.from.conn === msg.from.conn
            && c.to.module === msg.to.module && c.to.conn === msg.to.conn));
        renderPatch(currentPatch);
      }
      break;
    case 'moduleAdded':
      if (currentPatch && !findModule(msg.module.area, msg.module.id)) {
        currentPatch.modules.push(msg.module);
        renderPatch(currentPatch);
      }
      break;
    case 'moduleRenamed': {
      const mod = findModule(msg.area, msg.module);
      if (mod && currentPatch) {
        mod.name = msg.name;
        renderPatch(currentPatch);
      }
      break;
    }
    case 'moduleColorChanged': {
      const mod = findModule(msg.area, msg.module);
      if (mod && currentPatch) {
        mod.color = msg.color;
        renderPatch(currentPatch);
      }
      break;
    }
    case 'moduleDeleted':
      if (currentPatch) {
        currentPatch.modules = currentPatch.modules.filter(
          (m) => !(m.area === msg.area && m.id === msg.module));
        // Server löscht hängende Kabel mit eigenen cableDeleted-Events; zur
        // Sicherheit lokal ebenfalls aufräumen (Events können vorausgehen).
        currentPatch.cables = currentPatch.cables.filter((c) => !(c.area === msg.area
          && (c.from.module === msg.module || c.to.module === msg.module)));
        if (selected && selected.area === msg.area) {
          selected.ids = selected.ids.filter((id) => id !== msg.module);
          if (!selected.ids.length) selected = null;
        }
        renderPatch(currentPatch);
      }
      break;
    case 'undoState':
      renderUndoState(msg);
      break;
    case 'selectionCopied':
      // Kommt nach den moduleAdded/cableAdded der Kopie: frische Kopien auswählen,
      // damit man sie direkt verschieben/erneut kopieren kann.
      selected = { area: msg.area, ids: [...msg.modules] };
      applySelection();
      break;
    case 'variationChanged':
      if (msg.slot && currentPatch && msg.slot !== currentPatch.slot) break;
      currentVariation = msg.variation;
      renderVariations();
      refreshPatch(); // Werte der neuen Variation holen
      break;
    case 'connection':
      setConn(msg.connected, msg.connected ? 'G2 verbunden' : 'G2 getrennt');
      break;
    case 'perfSettingsChanged':
      if (currentPatch) currentPatch.perfSettings = msg;
      perfInfoEl.textContent = `${msg.name} · Slot ${currentPatch?.slot ?? ''}`;
      renderPerfPanel(msg);
      break;
    case 'globalKnobsChanged':
      if (currentPatch) currentPatch.globalKnobs = msg.knobs;
      renderPerfPanel(currentPatch?.perfSettings); // Knob-Liste hängt am Perf-Panel
      applySelection(); // Param-Panel zeigt ggf. die Zuweisungs-Selects
      break;
    case 'banksChanged':
      // z.B. nach storePerf — Listen neu laden (Server hält den Bank-Snapshot)
      loadBanks();
      loadPerfBanks();
      break;
    case 'visuals': {
      // LED-/VU-Daten (~30 Hz): in-place anwenden, KEIN Re-Render. Werte zudem
      // in m.visuals merken, damit Control-Layer-Rebuilds den Stand behalten.
      if (msg.slot && currentPatch && msg.slot !== currentPatch.slot) break;
      for (const [kind, list] of [['led', msg.leds], ['meter', msg.meters]] as const) {
        for (const [area, module, g, value] of list) {
          const m = findModule(area, module);
          if (!m) continue;
          (m.visuals ??= {})[`${kind}:${g}`] = value;
          areaViews.get(area)?.updateVisual(module, kind, g, value);
        }
      }
      break;
    }
  }
}

const findModule = (area: Area, id: number): Module | undefined =>
  currentPatch?.modules.find((m) => m.area === area && m.id === id);

const findCable = (
  area: Area, from: { module: number; conn: number }, to: { module: number; conn: number },
): Cable | undefined =>
  currentPatch?.cables.find((c) => c.area === area
    && c.from.module === from.module && c.from.conn === from.conn
    && c.to.module === to.module && c.to.conn === to.conn);

// Modul-Zwischenablage für Cmd+C/Cmd+V (nur Referenzen; Quellen können weg sein)
let clipboard: { area: Area; ids: number[] } | null = null;

// Entf/Backspace löscht das ausgewählte Kabel, sonst die ausgewählten Module;
// Cmd/Ctrl+Z = Undo, +Shift = Redo; Cmd/Ctrl+C/V = Selektion kopieren/einfügen
// (nicht aus Eingabefeldern heraus)
document.addEventListener('keydown', (ev) => {
  if (document.activeElement instanceof HTMLInputElement) return;
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') {
    ev.preventDefault();
    send({ type: ev.shiftKey ? 'redo' : 'undo' });
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'c') {
    if (selected) {
      clipboard = { area: selected.area, ids: [...selected.ids] };
      ev.preventDefault();
    }
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'v') {
    const srcs = clipboard
      ? clipboard.ids.map((id) => findModule(clipboard!.area, id))
          .filter((m): m is Module => !!m)
      : [];
    if (!srcs.length) return;
    ev.preventDefault();
    const bottom = (m: Module) => m.row + (moduleDefs[m.typeName]?.height ?? 2);
    if (srcs.length === 1) {
      // Einzelmodul wie bisher: direkt unter die Quelle; wiederholtes Einfügen
      // stapelt sich dank serverseitiger Kollisionslogik von selbst nach unten.
      const src = srcs[0];
      send({ type: 'copyModule', area: src.area, module: src.id,
             col: src.col, row: bottom(src) });
    } else {
      // Selektion als Block direkt unter ihre Bounding-Box (inkl. interner Kabel);
      // die neuen Kopien kommen als moduleAdded* + cableAdded* + selectionCopied.
      const minRow = Math.min(...srcs.map((m) => m.row));
      const dRow = Math.max(...srcs.map(bottom)) - minRow;
      send({ type: 'copySelection', area: clipboard!.area,
             modules: srcs.map((m) => m.id), dCol: 0, dRow });
    }
    return;
  }
  if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
  if (selectedCable) {
    send({ type: 'deleteCable', area: selectedCable.area,
      from: selectedCable.from, to: selectedCable.to,
      fromOutput: selectedCable.fromOutput ?? true });
    selectedCable = null; // Bestätigung kommt als cableDeleted + Re-Render
  } else if (selected) {
    if (selected.ids.length === 1) {
      send({ type: 'deleteModule', area: selected.area, module: selected.ids[0] });
    } else {
      // Ein Undo-Eintrag für die ganze Selektion (Undo restauriert auch alle Kabel)
      send({ type: 'deleteModules', area: selected.area, modules: [...selected.ids] });
    }
    // Bestätigung kommt als cableDeleted* + moduleDeleted* + Re-Render
  }
});

// ---------------------------------------------------------------- Rendering

function renderPatch(p: PatchState) {
  // Slot-Wechsel: Auswahl/Zwischenablage gehören zum alten Slot — Modul-Indizes
  // könnten im neuen Slot zufällig existieren und das Falsche treffen.
  if (currentPatch && currentPatch.slot !== p.slot) {
    selected = null;
    clipboard = null;
  }
  currentPatch = p;
  selectedCable = null; // Re-Render verwirft die Kabel-Hervorhebung
  document.title = `G2: ${p.name}`;
  patchNameEl.textContent = p.name || '—';
  perfInfoEl.textContent = `${p.perf} · Slot ${p.slot}`;
  currentVariation = p.variation;
  if (p.perfSettings) perfInfoEl.textContent = `${p.perfSettings.name} · Slot ${p.slot}`;
  renderPerfPanel(p.perfSettings);
  renderSlots(p);
  renderVariations();
  if (p.undo) renderUndoState(p.undo);

  patchEl.innerHTML = '';
  areaViews.clear();
  for (const area of ['va', 'fx'] as Area[]) {
    const mods = p.modules.filter((m) => m.area === area);

    // Titel (mit "+ Modul") auch für leere Areas — sonst käme man dort nie rein
    const title = document.createElement('div');
    title.className = 'area-title';
    title.innerHTML = `<span>${area === 'va' ? 'Voice Area' : 'FX Area'}</span>`;
    title.appendChild(addModuleControl(area));
    title.appendChild(zoomControls());
    patchEl.appendChild(title);
    if (!mods.length) continue;

    const view = renderArea(area, mods, p.cables ?? [], moduleDefs,
      (m, additive) => selectModule(m, additive),
      (moves) => moves.length === 1
        ? send({ type: 'moveModule', area, module: moves[0].module,
                 col: moves[0].col, row: moves[0].row })
        : send({ type: 'moveModules', area, moves }),
      (from, fromOutput, to) => send({ type: 'addCable', area, from, to, fromOutput }),
      (c) => { selectedCable = c; },
      (ids, additive) => rectSelect(area, ids, additive),
      () => new Set(selected?.area === area ? selected.ids : []),
      {
        // Modul-Controls: lokal setzen, Layer neu aufbauen, dann senden —
        // das paramChanged-Echo ist idempotent
        setParam: (m, param, value) => {
          const pr = m.params[param];
          if (pr) pr.value = value;
          areaViews.get(m.area)?.updateModule(m.id);
          send({ type: 'setParam', area: m.area, module: m.id, param,
                 value, variation: currentVariation });
        },
        setMode: (m, mode, value) => {
          const md = m.modes?.[mode];
          if (md) md.value = value;
          areaViews.get(m.area)?.updateModule(m.id);
          send({ type: 'setMode', area: m.area, module: m.id, mode, value });
        },
      });
    areaViews.set(area, view);
    patchEl.appendChild(view.svg);
  }
  applyZoom();

  // Auswahl wiederherstellen (z.B. nach Variationswechsel-Refresh) bzw. Panel
  // leeren — sonst zeigt es nach Patch-Wechsel noch ein Modul des alten Patches.
  if (selected) {
    selected.ids = selected.ids.filter((id) => findModule(selected!.area, id));
    if (!selected.ids.length) selected = null;
  }
  applySelection();
}

/** Auswahl-Hervorhebung + Param-Panel an den selected-State angleichen. */
function applySelection() {
  areaViews.forEach((v, area) => {
    v.select(new Set(selected?.area === area ? selected.ids : []));
  });
  if (!selected) {
    renderSettingsPanel(); // keine Auswahl -> Patch-Settings + Morphs
  } else if (selected.ids.length === 1) {
    const m = findModule(selected.area, selected.ids[0]);
    if (m) renderParamPanel(m);
  } else {
    paramsBodyEl.className = 'hint';
    paramsBodyEl.textContent = `${selected.ids.length} Module ausgewählt — `
      + 'Drag verschiebt, ⌘C/⌘V kopiert (inkl. interner Kabel), Entf löscht';
  }
}

function selectModule(m: Module, additive = false) {
  if (additive && selected && selected.area === m.area) {
    const ix = selected.ids.indexOf(m.id);
    if (ix >= 0) selected.ids.splice(ix, 1); else selected.ids.push(m.id);
    if (!selected.ids.length) selected = null;
  } else {
    selected = { area: m.area, ids: [m.id] };
  }
  selectedCable = null;
  areaViews.forEach((v) => v.clearCableSelection());
  applySelection();
}

/** Gummiband-Ergebnis übernehmen (additive = Shift gedrückt). */
function rectSelect(area: Area, ids: number[], additive: boolean) {
  if (additive && selected && selected.area === area) {
    for (const id of ids) {
      if (!selected.ids.includes(id)) selected.ids.push(id);
    }
  } else {
    selected = ids.length ? { area, ids } : null;
  }
  selectedCable = null;
  areaViews.forEach((v) => v.clearCableSelection());
  applySelection();
}

function renderParamPanel(m: Module) {
  paramsBodyEl.className = '';
  paramsBodyEl.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'module';
  const icon = moduleIcon(moduleDefs, m.typeName);
  const h = document.createElement('h3');
  h.innerHTML = `${icon ? `<img src="${icon}" width="22" height="22" alt="">` : ''}
    <span class="type">${esc(m.typeName)} #${m.id}</span>`;
  // Name editierbar (Enter/Blur sendet renameModule, max 16 Zeichen wie der G2)
  const nameInput = document.createElement('input');
  nameInput.className = 'modname';
  nameInput.maxLength = 16;
  nameInput.value = m.name || '';
  nameInput.placeholder = '#' + m.id;
  const rename = () => {
    const name = nameInput.value.trim();
    if (name && name !== m.name) {
      send({ type: 'renameModule', area: m.area, module: m.id, name });
    } else {
      nameInput.value = m.name || '';
    }
  };
  nameInput.onkeydown = (ev) => {
    if (ev.key === 'Enter') nameInput.blur();
    ev.stopPropagation(); // Entf im Input darf nicht das Modul löschen
  };
  nameInput.onblur = rename;
  h.insertBefore(nameInput, h.querySelector('.type'));
  div.appendChild(h);
  // Farbwähler (25 G2-Modulfarben)
  const colors = document.createElement('div');
  colors.className = 'modcolors';
  MODULE_COLORS.forEach((hex, ix) => {
    const b = document.createElement('button');
    b.style.background = hex;
    b.title = String(ix);
    b.className = ix === m.color ? 'active' : '';
    b.onclick = () => send({ type: 'setModuleColor', area: m.area, module: m.id, color: ix });
    colors.appendChild(b);
  });
  div.appendChild(colors);
  if (!m.params.length) {
    const p = document.createElement('div');
    p.className = 'hint';
    p.textContent = 'keine Parameter';
    div.appendChild(p);
  }
  for (const param of m.params) {
    const row = document.createElement('div');
    row.className = 'param';
    row.innerHTML = `<label title="${esc(param.name)}">${esc(param.name)}</label>
      <input type="range" min="${param.min}" max="${param.max}" value="${param.value}"
             data-area="${m.area}" data-module="${m.id}" data-param="${param.id}">
      <span>${param.value}</span>`;
    const input = row.querySelector('input')!;
    input.oninput = () => {
      row.querySelector('span')!.textContent = input.value;
      param.value = Number(input.value);
      send({ type: 'setParam', area: m.area, module: m.id, param: param.id,
             value: Number(input.value), variation: currentVariation });
    };
    div.appendChild(row);
    div.appendChild(morphRow(m, param.id));
    div.appendChild(globalKnobRow(m, param.id));
  }
  paramsBodyEl.appendChild(div);
}

// Global Knobs: 120 Stück = Seite 1–5 × Reihe A–C × Knob 1–8, Anzeige "2B5"
const knobName = (k: number) =>
  `${Math.floor(k / 24) + 1}${'ABC'[Math.floor((k % 24) / 8)]}${(k % 8) + 1}`;

/**
 * Global-Knob-Zuweisung eines Params (Select – / 1A1…5C8). Zuweisungen sind
 * perf-weit; hier wird immer der AKTIVE Slot zugewiesen. Belegte Knobs sind
 * markiert und werden beim Zuweisen überschrieben.
 */
function globalKnobRow(m: Module, paramId: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'morphrow';
  const knobs = currentPatch?.globalKnobs ?? [];
  const slot = currentPatch?.slot ?? 'A';
  const cur = knobs.find((k) => k.slot === slot && k.area === m.area
    && k.module === m.id && k.param === paramId);
  const sel = document.createElement('select');
  let html = '<option value="-1">–</option>';
  for (let page = 0; page < 5; page++) {
    for (let rowIx = 0; rowIx < 3; rowIx++) {
      html += `<optgroup label="Seite ${page + 1}${'ABC'[rowIx]}">`;
      for (let k = 0; k < 8; k++) {
        const ix = page * 24 + rowIx * 8 + k;
        const used = knobs.find((g) => g.knob === ix);
        const label = knobName(ix) + (used && used !== cur
          ? ` · ${used.moduleName ?? used.module}` : '');
        html += `<option value="${ix}">${esc(label)}</option>`;
      }
      html += '</optgroup>';
    }
  }
  sel.innerHTML = html;
  sel.value = String(cur?.knob ?? -1);
  sel.title = 'Global Knob (perf-weit; belegte Knobs werden überschrieben)';
  sel.onchange = () => {
    const knob = Number(sel.value);
    if (knob < 0) {
      if (cur) send({ type: 'deassignGlobalKnob', knob: cur.knob });
      return;
    }
    // Umzug auf anderen Knob: alte Zuweisung dieses Params zuerst lösen
    if (cur && cur.knob !== knob) send({ type: 'deassignGlobalKnob', knob: cur.knob });
    send({ type: 'assignGlobalKnob', knob, slot: 'ABCD'.indexOf(slot),
           area: m.area, module: m.id, param: paramId });
    // Bestätigung kommt als globalKnobsChanged (nach Geräte-Echo)
  };
  const lbl = document.createElement('span');
  lbl.textContent = 'G-Knob';
  row.append(lbl, sel);
  return row;
}

/**
 * Morph-Zuweisung eines Params: Select (– / M1–M8) + Range (-128…127).
 * Ein Param hängt an höchstens einem Morph; "–" bzw. Range 0 löscht.
 */
function morphRow(m: Module, paramId: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'morphrow';
  const cur = currentPatch?.morphs?.find((g) => g.assigns.some(
    (a) => a.area === m.area && a.module === m.id && a.param === paramId));
  const curAssign = cur?.assigns.find(
    (a) => a.area === m.area && a.module === m.id && a.param === paramId);
  const sel = document.createElement('select');
  sel.innerHTML = '<option value="-1">–</option>'
    + (currentPatch?.morphs ?? []).map((g) =>
      `<option value="${g.morph}">M${g.morph + 1} ${esc(g.label)}</option>`).join('');
  sel.value = String(cur?.morph ?? -1);
  const rng = document.createElement('input');
  rng.type = 'number';
  rng.min = '-128';
  rng.max = '127';
  rng.value = String(curAssign?.range ?? 0);
  rng.onkeydown = (ev) => ev.stopPropagation(); // Entf im Input löscht kein Modul
  const apply = () => {
    const morph = Number(sel.value);
    if (morph < 0) {
      if (cur) { // Zuweisung entfernen; Bestätigung kommt als morphChanged
        send({ type: 'setMorph', area: m.area, module: m.id, param: paramId,
               morph: cur.morph, range: 0, variation: currentVariation });
      }
      return;
    }
    let range = Number(rng.value) || 0;
    if (range === 0) { range = 64; rng.value = '64'; } // sinnvoller Startwert
    send({ type: 'setMorph', area: m.area, module: m.id, param: paramId,
           morph, range, variation: currentVariation });
  };
  sel.onchange = apply;
  rng.onchange = apply;
  const lbl = document.createElement('span');
  lbl.textContent = 'Morph';
  row.append(lbl, sel, rng);
  return row;
}

/** "+ Modul": Typ aus module-defs wählen (datalist) und unten in der Area anlegen. */
function addModuleControl(area: Area): HTMLElement {
  const div = document.createElement('div');
  div.className = 'addmod';
  const input = document.createElement('input');
  input.setAttribute('list', 'modtypes');
  input.placeholder = '+ Modul…';
  input.title = 'Modultyp eintippen/wählen, Enter oder + drückt an';
  const add = () => {
    const typeName = input.value.trim();
    if (!moduleDefs[typeName] || !currentPatch) return;
    // Platzierung: unterhalb des untersten Moduls der Area, Spalte 0
    const row = currentPatch.modules
      .filter((m) => m.area === area)
      .reduce((r, m) => Math.max(r, m.row + (moduleDefs[m.typeName]?.height ?? 2)), 0);
    send({ type: 'addModule', area, typeName, col: 0, row });
    input.value = ''; // Modul kommt als moduleAdded + Re-Render zurück
  };
  input.onkeydown = (ev) => { if (ev.key === 'Enter') add(); };
  const btn = document.createElement('button');
  btn.textContent = '＋';
  btn.onclick = add;
  div.append(input, btn);
  return div;
}

function zoomControls(): HTMLElement {
  const div = document.createElement('div');
  div.className = 'zoom';
  for (const [txt, d] of [['−', -0.25], ['+', 0.25]] as const) {
    const b = document.createElement('button');
    b.textContent = txt;
    b.onclick = () => {
      zoom = Math.min(2, Math.max(0.5, zoom + d));
      applyZoom();
    };
    div.appendChild(b);
  }
  return div;
}

function applyZoom() {
  areaViews.forEach((v) => {
    const [, , w, h] = v.svg.getAttribute('viewBox')!.split(' ').map(Number);
    v.svg.setAttribute('width', String(w * zoom));
    v.svg.setAttribute('height', String(h * zoom));
  });
}

// Sprechende Labels für die Undo-Tooltips (Server schickt die Methodennamen)
const UNDO_LABELS: Record<string, string> = {
  moveModule: 'Modul verschieben', moveModules: 'Selektion verschieben',
  addModule: 'Modul anlegen', deleteModule: 'Modul löschen',
  deleteModules: 'Selektion löschen', copyModule: 'Modul kopieren',
  copySelection: 'Selektion kopieren', addCable: 'Kabel anlegen',
  deleteCable: 'Kabel löschen', renameModule: 'Modul umbenennen',
  setModuleColor: 'Modulfarbe ändern', setMorph: 'Morph-Zuweisung',
};

function renderUndoState(u: UndoInfo) {
  const label = (l?: string) => (l && UNDO_LABELS[l]) || l || '';
  undoBtn.disabled = !u.undoDepth;
  redoBtn.disabled = !u.redoDepth;
  undoBtn.title = u.undoDepth
    ? `Rückgängig: ${label(u.undoLabel)} (${u.undoDepth}) — ⌘Z`
    : 'Rückgängig (⌘Z)';
  redoBtn.title = u.redoDepth
    ? `Wiederholen: ${label(u.redoLabel)} (${u.redoDepth}) — ⇧⌘Z`
    : 'Wiederholen (⇧⌘Z)';
}

/** Slider-Zeile (Label + range-Input + Wert) für Settings-Params. */
function settingsParamRow(moduleId: number, param: { id: number; name: string;
    value: number; min: number; max: number; enums?: string[] }): HTMLElement {
  const row = document.createElement('div');
  row.className = 'param';
  if (param.enums) {
    const sel = document.createElement('select');
    param.enums.forEach((e, ix) => {
      const o = document.createElement('option');
      o.value = String(param.min + ix);
      o.textContent = e;
      sel.appendChild(o);
    });
    sel.value = String(param.value);
    sel.onchange = () => {
      param.value = Number(sel.value);
      send({ type: 'setParam', area: 'settings', module: moduleId, param: param.id,
             value: Number(sel.value), variation: currentVariation });
    };
    const label = document.createElement('label');
    label.title = param.name;
    label.textContent = param.name;
    row.append(label, sel, document.createElement('span'));
    return row;
  }
  row.innerHTML = `<label title="${esc(param.name)}">${esc(param.name)}</label>
    <input type="range" min="${param.min}" max="${param.max}" value="${param.value}"
           data-area="settings" data-module="${moduleId}" data-param="${param.id}">
    <span>${param.value}</span>`;
  const input = row.querySelector('input')!;
  input.oninput = () => {
    row.querySelector('span')!.textContent = input.value;
    param.value = Number(input.value);
    send({ type: 'setParam', area: 'settings', module: moduleId, param: param.id,
           value: Number(input.value), variation: currentVariation });
  };
  return row;
}

// Morph-Mode-Enum (g2lib ModParam.MorphMode): 0=Knob, 1=Morph.
const MORPH_MODES = ['Knob', 'Morph'];

/**
 * Eine Morph-Gruppe: editierbares Label + Mode-Toggle (Knob/Morph) + Dial-Slider
 * + Zuweisungs-Chips. Label = renameMorph (max 7 Zeichen), Mode/Dial = setParam
 * auf dem Morphs-Pseudo-Modul (id 1, settings): Dial=Param morph, Mode=8+morph.
 */
function morphGroupBlock(g: MorphGroup): HTMLElement {
  const block = document.createElement('div');
  block.className = 'morphgroup';

  const head = document.createElement('div');
  head.className = 'morphhead';
  const tag = document.createElement('span');
  tag.className = 'mtag';
  tag.textContent = `M${g.morph + 1}`;
  // Editierbares Label (Enter/Blur sendet renameMorph; G2 kappt auf 7 Zeichen)
  const lbl = document.createElement('input');
  lbl.className = 'mlabel';
  lbl.value = g.label;
  lbl.maxLength = 7;
  lbl.title = 'Morph-Label (Enter speichert, max 7 Zeichen)';
  const sendLbl = () => {
    const v = lbl.value.trim();
    if (v && v !== g.label) send({ type: 'renameMorph', morph: g.morph, label: v });
    else lbl.value = g.label;
  };
  lbl.onkeydown = (ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); };
  lbl.onblur = sendLbl;
  // Mode-Toggle Knob/Morph
  const mode = document.createElement('select');
  mode.className = 'mmode';
  mode.title = 'Morph-Mode (Knob = manuell, Morph = via Morph-Quelle)';
  MORPH_MODES.forEach((m, ix) => {
    const o = document.createElement('option');
    o.value = String(ix); o.textContent = m;
    mode.appendChild(o);
  });
  mode.value = String(g.mode);
  mode.onchange = () => {
    g.mode = Number(mode.value);
    send({ type: 'setParam', area: 'settings', module: 1, param: 8 + g.morph,
           value: g.mode, variation: currentVariation });
  };
  head.append(tag, lbl, mode);
  block.appendChild(head);

  // Dial-Slider (Param g.morph)
  block.appendChild(settingsParamRow(1, {
    id: g.morph, name: 'Dial', value: g.dial, min: 0, max: 127 }));

  if (g.assigns.length) {
    const chips = document.createElement('div');
    chips.className = 'morphassigns';
    chips.textContent = g.assigns.map((a) => {
      const m = a.area !== 'settings' ? findModule(a.area, a.module) : undefined;
      const name = m ? (m.name || m.typeName) : `${a.area}/${a.module}`;
      const pname = m?.params.find((x) => x.id === a.param)?.name ?? `#${a.param}`;
      return `${name} · ${pname} (${a.range > 0 ? '+' : ''}${a.range})`;
    }).join('  |  ');
    block.appendChild(chips);
  }
  return block;
}

/** Patch-Settings + Morph-Gruppen (rechtes Panel, wenn nichts ausgewählt ist). */
function renderSettingsPanel() {
  if (!currentPatch?.settings) {
    paramsBodyEl.className = 'hint';
    paramsBodyEl.textContent = 'Modul anklicken';
    return;
  }
  paramsBodyEl.className = '';
  paramsBodyEl.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'module';
  div.innerHTML = '<h3><span class="type">Patch-Settings</span></h3>';
  if (currentPatch.morphs) {
    const h = document.createElement('h4');
    h.textContent = `Morphs (Variation ${currentVariation + 1})`;
    div.appendChild(h);
    for (const g of currentPatch.morphs) div.appendChild(morphGroupBlock(g));
  }
  for (const sm of currentPatch.settings) {
    const h = document.createElement('h4');
    h.textContent = sm.name;
    div.appendChild(h);
    for (const param of sm.params) div.appendChild(settingsParamRow(sm.id, param));
  }
  paramsBodyEl.appendChild(div);
}

/** Slot-Leiste A–D: aktiver Slot hervorgehoben, Klick wechselt serverseitig. */
function renderSlots(p: PatchState) {
  slotsEl.innerHTML = '';
  const slots = p.slots ?? [{ slot: p.slot, name: p.name }];
  slots.forEach((s, ix) => {
    const b = document.createElement('button');
    b.innerHTML = `${esc(s.slot)}<span class="pname">${esc(s.name || '—')}</span>`;
    b.title = `Slot ${s.slot}: ${s.name || '—'}`;
    b.className = s.slot === p.slot ? 'active' : '';
    b.onclick = () => {
      if (s.slot === p.slot) return;
      send({ type: 'selectSlot', slot: ix });
      // Bestätigung kommt als patchState des neuen Slots
    };
    slotsEl.appendChild(b);
  });
}

// ---------------------------------------------------------------- Performance

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

/** Perf-Panel in der Sidebar: Name, Master-Clock, Slot-Flags/-Ranges. */
function renderPerfPanel(ps: PerfSettings | undefined) {
  if (!ps) { perfPanelEl.hidden = true; return; }
  perfPanelEl.hidden = false;
  perfPanelEl.innerHTML = '';

  // Name (editierbar wie Modul-Rename: Enter/Blur sendet)
  const name = document.createElement('input');
  name.className = 'pname';
  name.value = ps.name;
  name.maxLength = 16;
  name.title = 'Performance-Name (Enter speichert)';
  const sendName = () => {
    if (name.value !== ps.name && name.value.trim()) {
      send({ type: 'renamePerf', name: name.value.trim() });
    }
  };
  name.onkeydown = (ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); };
  name.onblur = sendName;
  perfPanelEl.appendChild(name);

  // Master-Clock: BPM + Run + Keyboard-Split global
  const clock = document.createElement('div');
  clock.className = 'row';
  const bpm = document.createElement('input');
  bpm.type = 'number'; bpm.min = '30'; bpm.max = '240'; bpm.value = String(ps.clockBpm);
  bpm.onchange = () => send({ type: 'setMasterClock', bpm: Number(bpm.value) });
  const run = document.createElement('input');
  run.type = 'checkbox'; run.checked = ps.clockRun; run.id = 'clockrun';
  run.onchange = () => send({ type: 'setClockRun', run: run.checked });
  const runLabel = document.createElement('label');
  runLabel.htmlFor = 'clockrun'; runLabel.textContent = 'Run';
  clock.append('Clock', bpm, 'BPM', run, runLabel);
  perfPanelEl.appendChild(clock);

  const split = document.createElement('div');
  split.className = 'row';
  const splitCb = document.createElement('input');
  splitCb.type = 'checkbox'; splitCb.checked = ps.keyboardRangeEnabled; splitCb.id = 'kbsplit';
  splitCb.onchange = () =>
    send({ type: 'setKeyboardRangeEnabled', enabled: splitCb.checked });
  const splitLabel = document.createElement('label');
  splitLabel.htmlFor = 'kbsplit'; splitLabel.textContent = 'Keyboard-Split (Ranges)';
  split.append(splitCb, splitLabel);
  perfPanelEl.appendChild(split);

  // Slot-Tabelle: Enable / Keyboard / Hold / Range from–to
  const table = document.createElement('table');
  table.innerHTML = '<tr><th></th><th title="Slot aktiv">On</th>'
    + '<th title="Keyboard an diesen Slot (mehrere = Layer)">Kbd</th>'
    + '<th title="Hold">Hold</th><th>von</th><th>bis</th></tr>';
  ps.slots.forEach((s, ix) => {
    const tr = document.createElement('tr');
    const sl = document.createElement('td');
    sl.className = 'sl'; sl.textContent = s.slot;
    if (currentPatch?.slot === s.slot) sl.style.color = 'var(--accent)';
    sl.style.cursor = 'pointer';
    sl.title = `Slot ${s.slot} anzeigen`;
    sl.onclick = () => send({ type: 'selectSlot', slot: ix });
    tr.appendChild(sl);
    for (const key of ['enabled', 'keyboard', 'hold'] as const) {
      const td = document.createElement('td');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = s[key];
      cb.onchange = () =>
        send({ type: 'setPerfSlotSetting', slot: ix, key, value: cb.checked ? 1 : 0 });
      td.appendChild(cb);
      tr.appendChild(td);
    }
    for (const key of ['keyFrom', 'keyTo'] as const) {
      const td = document.createElement('td');
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = '0'; inp.max = '127';
      inp.className = 'range'; inp.value = String(s[key]);
      inp.disabled = !ps.keyboardRangeEnabled;
      inp.title = noteName(s[key]);
      inp.onchange = () =>
        send({ type: 'setPerfSlotSetting', slot: ix, key, value: Number(inp.value) });
      const note = document.createElement('span');
      note.className = 'note'; note.textContent = noteName(s[key]);
      inp.oninput = () => { note.textContent = noteName(Number(inp.value) || 0); };
      td.append(inp, note);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  });
  perfPanelEl.appendChild(table);

  // Global Knobs (perf-weit): zugewiesene Knobs mit Lösen-Button
  const knobs = currentPatch?.globalKnobs ?? [];
  const gk = document.createElement('details');
  gk.className = 'gknobs';
  const gks = document.createElement('summary');
  gks.textContent = `Global Knobs (${knobs.length})`;
  gk.appendChild(gks);
  if (!knobs.length) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'keine Zuweisungen — im Param-Panel unter „G-Knob" zuweisen';
    gk.appendChild(hint);
  } else {
    const ul = document.createElement('ul');
    [...knobs].sort((a, b) => a.knob - b.knob).forEach((k) => {
      const li = document.createElement('li');
      const name = `${k.moduleName ?? `#${k.module}`} · ${k.paramName ?? `P${k.param}`}`;
      li.textContent = `${knobName(k.knob)}  ${k.slot}/${k.area} ${name}`;
      const del = document.createElement('button');
      del.textContent = '✕';
      del.title = `Global Knob ${knobName(k.knob)} lösen`;
      del.onclick = () => send({ type: 'deassignGlobalKnob', knob: k.knob });
      li.appendChild(del);
      ul.appendChild(li);
    });
    gk.appendChild(ul);
  }
  perfPanelEl.appendChild(gk);

  // Performance in Perf-Bank speichern (unter aktuellem Namen)
  const store = document.createElement('div');
  store.className = 'row';
  const sBank = document.createElement('input');
  sBank.type = 'number'; sBank.min = '1'; sBank.max = '8'; sBank.value = '1';
  sBank.title = 'Perf-Bank (1–8)';
  const sSlot = document.createElement('input');
  sSlot.type = 'number'; sSlot.min = '1'; sSlot.max = '32'; sSlot.value = '1';
  sSlot.title = 'Platz in der Bank (1–32)';
  const sBtn = document.createElement('button');
  sBtn.textContent = 'Speichern';
  sBtn.title = 'Performance in den Bank-Platz speichern (unter aktuellem Namen)';
  sBtn.onclick = () => {
    const bank = Number(sBank.value), slot = Number(sSlot.value);
    if (!bank || !slot) return;
    if (!confirm(`Performance „${ps.name}" in Bank ${bank}, Platz ${slot} speichern?`
        + ' Ein vorhandener Eintrag wird überschrieben.')) return;
    send({ type: 'storePerf', bank, slot });
    // Bestätigung kommt als banksChanged → Perf-Liste lädt neu
  };
  store.append('Bank', sBank, 'Platz', sSlot, sBtn);
  perfPanelEl.appendChild(store);
}

async function loadPerfBanks() {
  try {
    const banks: Bank[] = await (await fetch('/api/perfbanks')).json();
    perfListEl.innerHTML = '';
    if (!banks.length) { perfListEl.textContent = 'keine Perf-Banks'; return; }
    banks.sort((a, b) => a.bank - b.bank).forEach((bank) => {
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = `Bank ${bank.bank} (${bank.patches.length})`;
      det.appendChild(sum);
      const ul = document.createElement('ul');
      bank.patches.sort((a, b) => a.slot - b.slot).forEach((p) => {
        const li = document.createElement('li');
        li.textContent = `${p.slot} ${p.name}`;
        li.title = `Performance „${p.name}" laden (ersetzt alle 4 Slots!)`;
        li.onclick = () => {
          selected = null;
          clipboard = null;
          send({ type: 'loadPerf', bank: bank.bank, slot: p.slot });
          // neuer patchState kommt via WS-Broadcast
        };
        ul.appendChild(li);
      });
      det.appendChild(ul);
      perfListEl.appendChild(det);
    });
  } catch {
    perfListEl.textContent = 'Perf-Banks nicht ladbar';
  }
}

function renderVariations() {
  variationsEl.innerHTML = '';
  for (let v = 0; v < VARIATION_COUNT; v++) {
    const b = document.createElement('button');
    b.textContent = String(v + 1);
    b.className = v === currentVariation ? 'active' : '';
    b.onclick = () => {
      currentVariation = v;
      renderVariations();
      send({ type: 'selectVariation', variation: v });
      refreshPatch();
    };
    variationsEl.appendChild(b);
  }
}

async function refreshPatch() {
  // Variationswerte stecken im Patch-State des Servers (der rendert die aktive Variation
  // serverseitig noch nicht pro Client) — daher Param-Werte neu laden.
  try {
    const p: PatchState = await (await fetch('/api/patch')).json();
    if (p.type === 'patchState') renderPatch({ ...p, variation: currentVariation });
  } catch { /* offline */ }
}

// ---------------------------------------------------------------- Banks

async function loadBanks() {
  try {
    const banks: Bank[] = await (await fetch('/api/banks')).json();
    bankListEl.innerHTML = '';
    if (!banks.length) { bankListEl.textContent = 'keine Banks'; return; }
    banks.sort((a, b) => a.bank - b.bank).forEach((bank) => {
      const det = document.createElement('details');
      if (bank.bank === 1) det.open = true;
      const sum = document.createElement('summary');
      sum.textContent = `Bank ${bank.bank} (${bank.patches.length})`;
      det.appendChild(sum);
      const ul = document.createElement('ul');
      bank.patches.sort((a, b) => a.slot - b.slot).forEach((p) => {
        const li = document.createElement('li');
        li.textContent = `${p.slot} ${p.name}`;
        li.title = p.name;
        li.onclick = () => loadPatch(bank.bank, p.slot);
        ul.appendChild(li);
      });
      det.appendChild(ul);
      bankListEl.appendChild(det);
    });
  } catch {
    bankListEl.textContent = 'Banks nicht ladbar';
  }
}

async function loadPatch(bank: number, slot: number) {
  selected = null; // neues Patch, alte Auswahl ungültig
  await fetch('/api/patch/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bank, slot }),
  });
  // neuer patchState kommt via WS-Broadcast
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

/**
 * Import-Buttons: Datei wählen, roh per POST schicken. Erfolg liefert 202, der
 * neue patchState kommt via WS; Fehler (Header/CRC/Parse → 400, kein G2 → 503)
 * werden angezeigt. .pch2 → aktiver Slot, .prf2 → ganze Performance.
 */
function wireImport() {
  const wire = (btnId: string, inputId: string, url: string, warn: string) => {
    const btn = $(btnId) as HTMLButtonElement;
    const file = $(inputId) as HTMLInputElement;
    btn.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files?.[0];
      file.value = ''; // erlaubt erneutes Wählen derselben Datei
      if (!f) return;
      if (!confirm(`„${f.name}" laden? ${warn}`)) return;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            // Clavia leitet den Patch-/Perf-Namen aus dem Dateinamen ab; Header
            // muss ASCII sein → URL-encodiert, Server dekodiert.
            'X-Filename': encodeURIComponent(f.name),
          },
          body: await f.arrayBuffer(),
        });
        if (!res.ok) alert(`Import fehlgeschlagen (${res.status}): ${await res.text()}`);
        // Erfolg: neuer patchState kommt via WS
      } catch (e) {
        alert(`Import fehlgeschlagen: ${e}`);
      }
    };
  };
  wire('importbtn', 'importfile', '/api/patch/import',
    'Der aktuelle Slot-Inhalt wird überschrieben.');
  wire('importperfbtn', 'importperffile', '/api/perf/import',
    'Die GESAMTE Performance (alle 4 Slots) wird überschrieben.');
}

async function init() {
  undoBtn.onclick = () => send({ type: 'undo' });
  redoBtn.onclick = () => send({ type: 'redo' });
  wireImport();
  try {
    setTables(await (await fetch('/param-tables.json')).json());
  } catch {
    console.warn('param-tables.json nicht ladbar — TextFunc-Anzeigen zeigen Rohwerte');
  }
  try {
    moduleDefs = await (await fetch('/module-defs.json')).json();
    // Datalist für die "+ Modul"-Controls (ein globales Element reicht)
    const dl = document.createElement('datalist');
    dl.id = 'modtypes';
    for (const name of Object.keys(moduleDefs).sort()) {
      const opt = document.createElement('option');
      opt.value = name;
      dl.appendChild(opt);
    }
    document.body.appendChild(dl);
  } catch {
    console.warn('module-defs.json nicht ladbar — Module ohne Geometrie');
  }
  connect();
  loadBanks();
  loadPerfBanks();
}

init();
