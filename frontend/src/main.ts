import type {
  Area, Bank, ClientMessage, Module, PatchState, ServerMessage,
} from './protocol';

const $ = (id: string) => document.getElementById(id)!;
const connEl = $('conn');
const patchEl = $('patch');
const patchNameEl = $('patchname');
const perfInfoEl = $('perfinfo');
const variationsEl = $('variations');
const bankListEl = $('banklist');

const VARIATION_COUNT = 8;
let currentVariation = 0;
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

// ---------------------------------------------------------------- Rendering

function renderPatch(p: PatchState) {
  document.title = `G2: ${p.name}`;
  patchNameEl.textContent = p.name || '—';
  perfInfoEl.textContent = `${p.perf} · Slot ${p.slot}`;
  currentVariation = p.variation;
  renderVariations();

  patchEl.innerHTML = '';
  for (const area of ['va', 'fx'] as Area[]) {
    const mods = p.modules.filter((m) => m.area === area);
    if (!mods.length) continue;
    const title = document.createElement('div');
    title.className = 'area-title';
    title.textContent = area === 'va' ? 'Voice Area' : 'FX Area';
    patchEl.appendChild(title);
    const grid = document.createElement('div');
    grid.className = 'modules';
    mods.sort((a, b) => a.col - b.col || a.row - b.row)
        .forEach((m) => grid.appendChild(renderModule(m)));
    patchEl.appendChild(grid);
  }
}

function renderModule(m: Module): HTMLElement {
  const div = document.createElement('div');
  div.className = 'module';
  const h = document.createElement('h3');
  h.innerHTML = `<span>${esc(m.name) || '#' + m.id}</span><span class="type">${esc(m.typeName)} #${m.id}</span>`;
  div.appendChild(h);
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
      send({ type: 'setParam', area: m.area, module: m.id, param: param.id,
             value: Number(input.value), variation: currentVariation });
    };
    div.appendChild(row);
  }
  return div;
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

connect();
loadBanks();
