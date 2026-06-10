import type {
  Area, Bank, ClientMessage, Module, ModuleDefs, PatchState, ServerMessage,
} from './protocol';
import { type AreaView, moduleIcon, renderArea } from './graph';

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

// ---------------------------------------------------------------- Rendering

function renderPatch(p: PatchState) {
  currentPatch = p;
  document.title = `G2: ${p.name}`;
  patchNameEl.textContent = p.name || '—';
  perfInfoEl.textContent = `${p.perf} · Slot ${p.slot}`;
  currentVariation = p.variation;
  renderVariations();

  patchEl.innerHTML = '';
  areaViews.clear();
  for (const area of ['va', 'fx'] as Area[]) {
    const mods = p.modules.filter((m) => m.area === area);
    if (!mods.length) continue;

    const title = document.createElement('div');
    title.className = 'area-title';
    title.innerHTML = `<span>${area === 'va' ? 'Voice Area' : 'FX Area'}</span>`;
    title.appendChild(zoomControls());
    patchEl.appendChild(title);

    const view = renderArea(area, mods, p.cables ?? [], moduleDefs, (m) => selectModule(m));
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
  areaViews.forEach((v, area) => v.select(area === m.area ? m.id : null));
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
    <span>${esc(m.name) || '#' + m.id}</span>
    <span class="type">${esc(m.typeName)} #${m.id}</span>`;
  div.appendChild(h);
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
  } catch {
    console.warn('module-defs.json nicht ladbar — Module ohne Geometrie');
  }
  connect();
  loadBanks();
}

init();
