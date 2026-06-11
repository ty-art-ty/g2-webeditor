import type {
  Area, Bank, Cable, ClientMessage, Module, ModuleDefs, PatchState, ServerMessage,
} from './protocol';
import { type AreaView, MODULE_COLORS, moduleIcon, renderArea } from './graph';

const $ = (id: string) => document.getElementById(id)!;
const connEl = $('conn');
const patchEl = $('patch');
const patchNameEl = $('patchname');
const perfInfoEl = $('perfinfo');
const variationsEl = $('variations');
const bankListEl = $('banklist');
const paramsBodyEl = $('paramsbody');

const VARIATION_COUNT = 8;
let currentVariation = 0;
let currentPatch: PatchState | null = null;
let moduleDefs: ModuleDefs = {};
let selected: { area: Area; id: number } | null = null;
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
      if (msg.variation !== currentVariation) break;
      // State nachziehen, damit Re-Renders (Auswahl/Zoom) aktuelle Werte zeigen
      const mod = findModule(msg.area, msg.module);
      const p = mod?.params.find((x) => x.id === msg.param);
      if (p) p.value = msg.value;
      const input = document.querySelector<HTMLInputElement>(
        `input[data-area="${msg.area}"][data-module="${msg.module}"][data-param="${msg.param}"]`);
      if (input && document.activeElement !== input) {
        input.value = String(msg.value);
        input.parentElement!.querySelector('span')!.textContent = String(msg.value);
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
        if (selected && selected.area === msg.area && selected.id === msg.module) {
          selected = null;
        }
        renderPatch(currentPatch);
      }
      break;
    case 'variationChanged':
      currentVariation = msg.variation;
      renderVariations();
      refreshPatch(); // Werte der neuen Variation holen
      break;
    case 'connection':
      setConn(msg.connected, msg.connected ? 'G2 verbunden' : 'G2 getrennt');
      break;
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

// Modul-Zwischenablage für Cmd+C/Cmd+V (nur Referenz; Quelle kann weg sein)
let clipboard: { area: Area; id: number } | null = null;

// Entf/Backspace löscht das ausgewählte Kabel, sonst das ausgewählte Modul;
// Cmd/Ctrl+Z = Undo, +Shift = Redo; Cmd/Ctrl+C/V = Modul kopieren/einfügen
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
      clipboard = { ...selected };
      ev.preventDefault();
    }
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'v') {
    const src = clipboard && findModule(clipboard.area, clipboard.id);
    if (src) {
      ev.preventDefault();
      // Direkt unter die Quelle; wiederholtes Einfügen stapelt sich dank
      // serverseitiger Kollisionslogik von selbst nach unten.
      const h = moduleDefs[src.typeName]?.height ?? 2;
      send({ type: 'copyModule', area: src.area, module: src.id,
             col: src.col, row: src.row + h });
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
    send({ type: 'deleteModule', area: selected.area, module: selected.id });
    // Bestätigung kommt als cableDeleted* + moduleDeleted + Re-Render
  }
});

// ---------------------------------------------------------------- Rendering

function renderPatch(p: PatchState) {
  currentPatch = p;
  selectedCable = null; // Re-Render verwirft die Kabel-Hervorhebung
  document.title = `G2: ${p.name}`;
  patchNameEl.textContent = p.name || '—';
  perfInfoEl.textContent = `${p.perf} · Slot ${p.slot}`;
  currentVariation = p.variation;
  renderVariations();

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
      (m) => selectModule(m),
      (m, col, row) => send({ type: 'moveModule', area: m.area, module: m.id, col, row }),
      (from, fromOutput, to) => send({ type: 'addCable', area, from, to, fromOutput }),
      (c) => { selectedCable = c; });
    areaViews.set(area, view);
    patchEl.appendChild(view.svg);
  }
  applyZoom();

  // Auswahl wiederherstellen (z.B. nach Variationswechsel-Refresh) bzw. Panel
  // leeren — sonst zeigt es nach Patch-Wechsel noch ein Modul des alten Patches.
  const m = selected && findModule(selected.area, selected.id);
  if (m) selectModule(m); else clearSelection();
}

function selectModule(m: Module) {
  selected = { area: m.area, id: m.id };
  selectedCable = null;
  areaViews.forEach((v, area) => {
    v.select(area === m.area ? m.id : null);
    v.clearCableSelection();
  });
  renderParamPanel(m);
}

function clearSelection() {
  selected = null;
  areaViews.forEach((v) => v.select(null));
  paramsBodyEl.className = 'hint';
  paramsBodyEl.textContent = 'Modul anklicken';
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
  }
  paramsBodyEl.appendChild(div);
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

async function init() {
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
}

init();
