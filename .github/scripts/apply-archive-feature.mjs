import fs from 'node:fs';

function fail(message) {
  throw new Error(message);
}

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first === -1) fail(`Missing ${label}`);
  if (source.indexOf(search, first + search.length) !== -1) fail(`Ambiguous ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceUntil(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) fail(`Missing start of ${label}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) fail(`Missing end of ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

let html = fs.readFileSync('index.html', 'utf8');

html = replaceOnce(
  html,
  `  .nav-item .nav-icon.star { color: var(--today-accent); }\n  .nav-item .nav-icon.stack { color: var(--text-muted); }`,
  `  .nav-item .nav-icon.star { color: var(--today-accent); }\n  .nav-item .nav-icon.stack,\n  .nav-item .nav-icon.archive { color: var(--text-muted); }`,
  'sidebar icon colors',
);

html = replaceOnce(
  html,
  `  .view-title .title-icon.star { color: var(--today-accent); }\n  .view-title .title-icon.stack { color: var(--text-muted); }`,
  `  .view-title .title-icon.star { color: var(--today-accent); }\n  .view-title .title-icon.stack,\n  .view-title .title-icon.archive { color: var(--text-muted); }`,
  'title icon colors',
);

html = replaceOnce(
  html,
  `  .game-card.done .game-name {\n    color: var(--text-muted);\n    text-decoration: line-through;\n    text-decoration-thickness: 1.5px;\n  }`,
  `  .game-card.done .game-name {\n    color: var(--text-muted);\n    text-decoration: line-through;\n    text-decoration-thickness: 1.5px;\n  }\n  .game-card.archived {\n    cursor: pointer;\n    opacity: 0.78;\n  }\n  .game-card.archived .game-name {\n    color: var(--text-secondary);\n    text-decoration: none;\n  }\n  .archive-mark {\n    width: 20px;\n    height: 20px;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    color: var(--text-muted);\n    flex-shrink: 0;\n  }\n  .archive-mark svg { width: 20px; height: 20px; }\n  .archive-label {\n    font-size: 11px;\n    color: var(--text-muted);\n    line-height: 1.3;\n  }\n  .restore-btn {\n    margin-top: 4px;\n    padding: 2px 6px;\n    margin-right: -6px;\n    border-radius: 4px;\n    color: var(--accent);\n    font-size: 11px;\n    transition: background 120ms ease;\n  }\n  .restore-btn:hover { background: var(--accent-soft); }`,
  'archived card styles',
);

html = replaceOnce(
  html,
  `  .modal-actions {\n    display: flex;\n    justify-content: flex-end;\n    gap: 6px;`,
  `  .modal-actions {\n    display: flex;\n    flex-wrap: wrap;\n    justify-content: flex-end;\n    gap: 6px;`,
  'wrapping modal actions',
);

html = replaceOnce(
  html,
  `          <button class="nav-item" data-view="all">\n            <svg class="nav-icon stack" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">\n              <rect x="2.5" y="2.5" width="11" height="4.5" rx="1.5"/>\n              <rect x="2.5" y="9" width="11" height="4.5" rx="1.5"/>\n            </svg>\n            <span>All Games</span>\n            <span class="count" data-count="all">0</span>\n          </button>`,
  `          <button class="nav-item" data-view="all">\n            <svg class="nav-icon stack" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">\n              <rect x="2.5" y="2.5" width="11" height="4.5" rx="1.5"/>\n              <rect x="2.5" y="9" width="11" height="4.5" rx="1.5"/>\n            </svg>\n            <span>All Games</span>\n            <span class="count" data-count="all">0</span>\n          </button>\n          <button class="nav-item" data-view="archived">\n            <svg class="nav-icon archive" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">\n              <path d="M2.5 5.5h11v7.5h-11z"/>\n              <path d="M1.5 2.5h13v3h-13z"/>\n              <path d="M6 8h4" stroke-linecap="round"/>\n            </svg>\n            <span>Archived</span>\n            <span class="count" data-count="archived">0</span>\n          </button>`,
  'Archived navigation item',
);

html = replaceOnce(
  html,
  `          <button type="button" class="btn btn-danger" id="btn-delete" hidden>Delete</button>\n          <button type="button" class="btn btn-secondary" data-close>Cancel</button>`,
  `          <button type="button" class="btn btn-danger" id="btn-delete" hidden>Delete</button>\n          <button type="button" class="btn btn-secondary" id="btn-archive" hidden>Archive</button>\n          <button type="button" class="btn btn-secondary" data-close>Cancel</button>`,
  'Archive modal button',
);

html = replaceOnce(
  html,
  `    note: typeof g.note === 'string' ? g.note : '',\n    history,`,
  `    note: typeof g.note === 'string' ? g.note : '',\n    archived: g.archived === true,\n    history,`,
  'archive migration field',
);

html = replaceOnce(
  html,
  `    note: (data.note || '').trim(),\n    history: [],`,
  `    note: (data.note || '').trim(),\n    archived: false,\n    history: [],`,
  'new-game archive default',
);

html = replaceOnce(
  html,
  `function addGame(data) {`,
  `function activeGames(games = state.games) {\n  return games.filter(g => g.archived !== true);\n}\n\nfunction archivedGames(games = state.games) {\n  return games.filter(g => g.archived === true);\n}\n\nfunction addGame(data) {`,
  'active/archive game helpers',
);

html = replaceOnce(
  html,
  `function deleteGame(id) {\n  state.games = state.games.filter(g => g.id !== id);\n  save();\n  render();\n}\nfunction setCycleDone(id, key) {`,
  `function deleteGame(id) {\n  state.games = state.games.filter(g => g.id !== id);\n  save();\n  render();\n}\nfunction setGameArchived(id, archived) {\n  const g = state.games.find(x => x.id === id);\n  if (!g) return;\n  g.archived = archived === true;\n  pendingMove.delete(id);\n  save();\n  render();\n}\nfunction setCycleDone(id, key) {`,
  'archive game operation',
);

html = replaceOnce(
  html,
  `function setCycleDone(id, key) {\n  const g = state.games.find(x => x.id === id);\n  if (!g) return;`,
  `function setCycleDone(id, key) {\n  const g = state.games.find(x => x.id === id);\n  if (!g || g.archived) return;`,
  'archived setCycleDone guard',
);

html = replaceOnce(
  html,
  `function toggleLogin(id) {\n  if (!syncReady) return; // wait for the first sync so we don't act on stale data\n  const g = state.games.find(x => x.id === id);\n  if (!g) return;`,
  `function toggleLogin(id) {\n  if (!syncReady) return; // wait for the first sync so we don't act on stale data\n  const g = state.games.find(x => x.id === id);\n  if (!g || g.archived) return;`,
  'archived toggle guard',
);

html = replaceOnce(
  html,
  `function checkInYesterday(id) {\n  if (!syncReady) return;\n  const g = state.games.find(x => x.id === id);\n  if (!g) return;`,
  `function checkInYesterday(id) {\n  if (!syncReady) return;\n  const g = state.games.find(x => x.id === id);\n  if (!g || g.archived) return;`,
  'archived yesterday guard',
);

html = replaceOnce(
  html,
  `  stack: ['0 0 16 16', '<rect x="2.5" y="2.5" width="11" height="4.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="2.5" y="9" width="11" height="4.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>'],\n  flame:`,
  `  stack: ['0 0 16 16', '<rect x="2.5" y="2.5" width="11" height="4.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="2.5" y="9" width="11" height="4.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>'],\n  archive: ['0 0 16 16', '<path d="M2.5 5.5h11v7.5h-11z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M1.5 2.5h13v3h-13z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 8h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'],\n  flame:`,
  'archive SVG icon',
);

const renderSidebar = `function renderSidebar() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === state.view);
  });
  const now = new Date();
  const active = activeGames();
  const archived = archivedGames();
  const remaining = active.filter(g => getStatus(g, now) === 'available').length;
  document.querySelector('[data-count="today"]').textContent = remaining;
  document.querySelector('[data-count="all"]').textContent = active.length;
  document.querySelector('[data-count="archived"]').textContent = archived.length;

  // Game list as "projects" in sidebar. Archived games live in their own view.
  const section = document.getElementById('games-section');
  const list = document.getElementById('games-list');
  list.innerHTML = '';
  if (active.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  // Render in user-defined order (matches main list; drag-to-reorder stays in sync)
  active.forEach(g => {
    const status = getStatus(g, now);
    const streak = getStreak(g, now);
    const btn = el('button', { class: `game-nav ${status}`, type: 'button', dataset: { id: g.id } });
    btn.appendChild(el('span', { class: 'dot', style: `background:${g.color}` }));
    btn.appendChild(el('span', { class: 'name' }, g.name));
    if (streak > 0) {
      const meta = el('span', { class: 'meta' });
      meta.appendChild(streakBadge(streak, 'flame'));
      btn.appendChild(meta);
    }
    btn.addEventListener('click', () => {
      openModal(g.id);
      if (isMobile()) closeSidebar();
    });
    attachDragHandlers(btn);
    list.appendChild(btn);
  });
}

`;
html = replaceUntil(html, 'function renderSidebar() {', 'function renderMain() {', renderSidebar, 'renderSidebar');

const renderMain = `function renderMain() {
  const sectionsEl = document.getElementById('sections');
  const titleEl = document.getElementById('view-title');
  const subtitleEl = document.getElementById('view-subtitle');

  const isAll = state.view === 'all';
  const isArchived = state.view === 'archived';
  const games = isArchived ? archivedGames() : activeGames();
  setViewTitle(titleEl, state.view);
  if (games.length === 0) {
    subtitleEl.textContent = '';
    sectionsEl.innerHTML = '';
    sectionsEl.appendChild(renderEmpty(state.view));
    return;
  }

  const now = new Date();
  sectionsEl.innerHTML = '';

  if (isArchived) {
    const n = games.length;
    subtitleEl.textContent = `${n} archived game${n === 1 ? '' : 's'}`;
    const list = el('div', { class: 'game-list' });
    games.forEach(g => list.appendChild(renderGameCard(g)));
    sectionsEl.appendChild(el('div', { class: 'section' }, list));
    return;
  }

  if (isAll) {
    // Flat list in user-defined order — the canonical drag-reorder surface.
    const n = games.length;
    subtitleEl.textContent = `${n} game${n === 1 ? '' : 's'}`;
    const list = el('div', { class: 'game-list' });
    games.forEach(g => list.appendChild(renderGameCard(g)));
    sectionsEl.appendChild(el('div', { class: 'section' }, list));
    return;
  }

  subtitleEl.textContent = formatDate(now);

  const buckets = { available: [], done: [] };
  games.forEach(g => {
    const status = getStatus(g, now);
    // Freshly checked rows linger in place until the check animation lands
    buckets[status === 'done' && pendingMove.has(g.id) ? 'available' : status].push(g);
  });
  // Render in user-defined order within each section (preserves drag-to-reorder)

  if (buckets.available.length) {
    sectionsEl.appendChild(renderSection('Available now', buckets.available.length, buckets.available));
  }
  if (buckets.done.length) {
    sectionsEl.appendChild(renderSection('Logged in today', buckets.done.length, buckets.done));
  }
}

`;
html = replaceUntil(html, 'function renderMain() {', 'function formatDate(d) {', renderMain, 'renderMain');

const setViewTitle = `function setViewTitle(titleEl, view) {
  const views = {
    today: { icon: 'star', cls: 'star', label: 'Today' },
    all: { icon: 'stack', cls: 'stack', label: 'All Games' },
    archived: { icon: 'archive', cls: 'archive', label: 'Archived' },
  };
  const meta = views[view] || views.today;
  titleEl.textContent = '';
  titleEl.appendChild(svgIcon(meta.icon, `title-icon ${meta.cls}`));
  titleEl.appendChild(document.createTextNode(meta.label));
}

`;
html = replaceUntil(html, 'function setViewTitle(', 'function renderSection(', setViewTitle, 'setViewTitle');

const renderGameCard = `function renderGameCard(g) {
  const archived = g.archived === true;
  const now = new Date();
  const status = archived ? 'archived' : getStatus(g, now);
  const countdown = archived ? null : formatResetCountdown(now, g);
  const streak = archived ? 0 : getStreak(g, now);
  const resetLabel = formatResetTime(g);

  const card = el('div', {
    class: `game-card ${status === 'done' ? 'done' : ''} ${archived ? 'archived' : ''}`.trim(),
    dataset: { id: g.id },
    role: 'button',
    tabindex: '0',
  });
  if (!archived) attachDragHandlers(card);

  if (archived) {
    const marker = el('div', { class: 'archive-mark', 'aria-hidden': 'true' });
    marker.appendChild(svgIcon('archive', 'archive-icon'));
    card.appendChild(marker);
  } else {
    const checkbox = el('div', {
      class: `checkbox ${status === 'done' ? 'done' : ''}`,
      role: 'checkbox',
      tabindex: '0',
      'aria-checked': status === 'done' ? 'true' : 'false',
      'aria-label': status === 'done' ? 'Mark not done' : 'Mark logged in today',
    });
    const hit = el('div', { class: 'checkbox-hit' }, checkbox);
    hit.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLogin(g.id);
    });
    checkbox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        toggleLogin(g.id);
      }
    });
    card.appendChild(hit);
  }

  const info = el('div', { class: 'game-info' });
  info.appendChild(el('div', { class: 'game-name' }, g.name));
  const meta = el('div', { class: 'game-meta' }, [archived ? 'Login history preserved' : resetLabel]);
  if (g.note) {
    meta.appendChild(el('span', { class: 'meta-sep' }));
    meta.appendChild(el('span', { class: 'meta-note' }, g.note));
  }
  info.appendChild(meta);
  card.appendChild(info);

  const right = el('div', { class: 'game-right' });
  if (archived) {
    right.appendChild(el('div', { class: 'archive-label' }, 'Archived'));
    const restore = el('button', {
      class: 'restore-btn',
      type: 'button',
      title: 'Restore game',
    }, 'Restore');
    restore.addEventListener('click', (e) => {
      e.stopPropagation();
      setGameArchived(g.id, false);
    });
    right.appendChild(restore);
  } else {
    if (streak > 0) {
      const s = el('div', { class: 'streak' });
      s.appendChild(streakBadge(streak, 'flame'));
      right.appendChild(s);
    } else {
      right.appendChild(el('div', { class: 'streak zero' }, '—'));
    }
    right.appendChild(el('div', { class: `reset-in ${countdown.cls}` }, countdown.text));
    const yKey = prevDayKey(cycleKey(now, g));
    if (!g.history.includes(yKey)) {
      const retro = el('button', {
        class: 'retro-btn',
        type: 'button',
        title: 'Mark yesterday as logged in',
      }, '+ yesterday');
      retro.addEventListener('click', (e) => {
        e.stopPropagation();
        checkInYesterday(g.id);
      });
      right.appendChild(retro);
    }
  }
  card.appendChild(right);

  const open = () => openModal(g.id);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });

  return card;
}

`;
html = replaceUntil(html, 'function renderGameCard(g) {', 'function renderEmpty() {', renderGameCard, 'renderGameCard');

const renderEmpty = `function renderEmpty(view = state.view) {
  const isArchived = view === 'archived';
  const hasAnyGames = state.games.length > 0;
  const title = isArchived ? 'No archived games' : hasAnyGames ? 'No active games' : 'No games yet';
  const message = isArchived
    ? 'Games you archive will stay here with their login history intact.'
    : hasAnyGames
      ? 'Restore a game from Archived, or add a new game.'
      : 'Add the gacha games you play. Each one resets daily at the time you set — no more midnight drift.';
  const children = [
    // Things-style empty glyph: a single empty checkbox
    (() => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'glyph');
      svg.setAttribute('viewBox', '0 0 56 56');
      svg.setAttribute('fill', 'none');
      svg.innerHTML = `
        <rect x="14" y="14" width="28" height="28" rx="8" stroke="currentColor" stroke-width="2" fill="none"/>
        <line x1="20" y1="28" x2="36" y2="28" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.4"/>
      `;
      return svg;
    })(),
    el('h3', null, title),
    el('p', null, message),
  ];
  if (!isArchived) {
    children.push(el('button', { onclick: () => openModal() }, hasAnyGames ? '+ Add Game' : '+ Add your first game'));
  }
  return el('div', { class: 'empty-state' }, children);
}

`;
html = replaceUntil(html, 'function renderEmpty() {', '/* ============================================================\n   Modal', renderEmpty, 'renderEmpty');

html = replaceOnce(
  html,
  `  document.getElementById('modal-title').textContent = game ? 'Edit Game' : 'Add Game';\n  document.getElementById('btn-delete').hidden = !game;`,
  `  document.getElementById('modal-title').textContent = game ? 'Edit Game' : 'Add Game';\n  document.getElementById('btn-delete').hidden = !game;\n  const archiveBtn = document.getElementById('btn-archive');\n  archiveBtn.hidden = !game;\n  archiveBtn.textContent = game?.archived ? 'Restore' : 'Archive';`,
  'modal archive state',
);

html = replaceOnce(
  html,
  `  document.getElementById('yesterday-group').hidden = !game;`,
  `  document.getElementById('yesterday-group').hidden = !game || game.archived;`,
  'archived yesterday visibility',
);

html = replaceOnce(
  html,
  `document.getElementById('btn-delete').addEventListener('click', () => {`,
  `document.getElementById('btn-archive').addEventListener('click', () => {\n  if (!editingId) return;\n  const game = state.games.find(g => g.id === editingId);\n  if (!game) return;\n  setGameArchived(editingId, !game.archived);\n  closeModal();\n});\n\ndocument.getElementById('btn-delete').addEventListener('click', () => {`,
  'Archive button handler',
);

fs.writeFileSync('index.html', html);

let notify = fs.readFileSync('api/notify.js', 'utf8');
const collectDueGames = `export function collectDueGames(games, now, deviceTz, delivered = new Set(), leadMinutes = LEAD_MINUTES) {
  const due = [];
  for (const g of Array.isArray(games) ? games : []) {
    if (!g || g.archived === true || typeof g.id !== 'string' ||
        !Number.isInteger(g.resetHour) || !Number.isInteger(g.resetMinute)) continue;
    const key = cycleKey(now, g, deviceTz);
    if (Array.isArray(g.history) && g.history.includes(key)) continue;
    if (delivered.has(`${g.id}\n${key}`)) continue;
    const msLeft = nextCycleStart(now, g, deviceTz) - now.getTime();
    if (msLeft <= 0 || msLeft > leadMinutes * 60 * 1000) continue;
    due.push({
      game: g,
      key,
      minutesLeft: Math.max(1, Math.round(msLeft / 60000)),
      streak: streak(g, now, deviceTz),
    });
  }
  return due;
}

`;
notify = replaceOnce(
  notify,
  `export default async function handler(req, res) {`,
  collectDueGames + `export default async function handler(req, res) {`,
  'collectDueGames helper',
);

const dueStart = `      const due = [];\n      for (const g of games) {`;
const dueEnd = `      if (due.length === 0) continue;`;
const dueStartIndex = notify.indexOf(dueStart);
if (dueStartIndex === -1) fail('Missing notifier due loop');
const dueEndIndex = notify.indexOf(dueEnd, dueStartIndex);
if (dueEndIndex === -1) fail('Missing notifier due-loop end');
notify = notify.slice(0, dueStartIndex)
  + `      const due = collectDueGames(games, now, deviceTz, delivered);\n`
  + notify.slice(dueEndIndex);
fs.writeFileSync('api/notify.js', notify);

let readme = fs.readFileSync('README.md', 'utf8');
readme = replaceOnce(
  readme,
  `## How sync works`,
  `## Archiving games\n\nOpen a game's edit dialog and choose **Archive** when you stop playing it. Archived games disappear from Today, All Games, and the active game sidebar; they are also excluded from reset reminders. Their settings and complete check-in history remain synced. Use the **Archived** view to inspect, restore, or permanently delete them.\n\n## How sync works`,
  'README archive section',
);
fs.writeFileSync('README.md', readme);

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.scripts = { ...(pkg.scripts || {}), test: 'node --test' };
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

fs.mkdirSync('tests', { recursive: true });
fs.writeFileSync('tests/archive.test.mjs', `import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { collectDueGames } from '../api/notify.js';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const inlineScripts = [...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)];
assert.ok(inlineScripts.length > 0, 'index.html must contain an inline script');
const appScript = inlineScripts.at(-1)[1];

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

test('browser script remains syntactically valid', () => {
  assert.doesNotThrow(() => new Function(appScript));
});

test('game migration preserves only an explicit archived flag', () => {
  const context = { COLORS: ['#000000'], uid: () => 'generated', cycleKey: () => '2026-09-10' };
  vm.createContext(context);
  vm.runInContext(between(appScript, 'function migrateGame(', '\\nfunction load('), context);
  const base = { id: 'stella', name: 'Stella Sora', resetHour: 4, resetMinute: 0, history: [] };
  assert.equal(context.migrateGame(base).archived, false);
  assert.equal(context.migrateGame({ ...base, archived: true }).archived, true);
  assert.equal(context.migrateGame({ ...base, archived: 'true' }).archived, false);
});

test('active and archived helpers partition games without losing data', () => {
  const context = { state: { games: [] } };
  vm.createContext(context);
  vm.runInContext(between(appScript, 'function activeGames(', '\\nfunction addGame('), context);
  const games = [
    { id: 'active', history: ['2026-09-10'] },
    { id: 'archived', archived: true, history: ['2026-09-09'] },
  ];
  assert.deepEqual([...context.activeGames(games)].map(g => g.id), ['active']);
  assert.deepEqual([...context.archivedGames(games)].map(g => g.id), ['archived']);
  assert.deepEqual(games[1].history, ['2026-09-09']);
});

test('archiving is reversible and preserves check-in history', () => {
  let saves = 0;
  let renders = 0;
  const game = { id: 'stella', archived: false, history: ['2026-09-09', '2026-09-10'] };
  const context = {
    state: { games: [game] },
    pendingMove: new Set(['stella']),
    save: () => { saves += 1; },
    render: () => { renders += 1; },
  };
  vm.createContext(context);
  vm.runInContext(between(appScript, 'function setGameArchived(', '\\nfunction setCycleDone('), context);
  context.setGameArchived('stella', true);
  assert.equal(game.archived, true);
  assert.deepEqual(game.history, ['2026-09-09', '2026-09-10']);
  assert.equal(context.pendingMove.has('stella'), false);
  context.setGameArchived('stella', false);
  assert.equal(game.archived, false);
  assert.equal(saves, 2);
  assert.equal(renders, 2);
});

test('archived games are excluded from reset reminders', () => {
  const now = new Date('2026-09-11T03:00:00.000Z');
  const active = {
    id: 'active', name: 'Active', resetHour: 4, resetMinute: 0,
    timezone: 'UTC', history: [],
  };
  const archived = { ...active, id: 'stella', name: 'Stella Sora', archived: true };
  const due = collectDueGames([active, archived], now, 'UTC', new Set(), 90);
  assert.deepEqual(due.map(item => item.game.id), ['active']);
});
`);

console.log('Archive feature applied.');
