import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { collectDueGames } from '../api/notify.js';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
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
  vm.runInContext(between(appScript, 'function migrateGame(', '\nfunction load('), context);
  const base = { id: 'stella', name: 'Stella Sora', resetHour: 4, resetMinute: 0, history: [] };
  assert.equal(context.migrateGame(base).archived, false);
  assert.equal(context.migrateGame({ ...base, archived: true }).archived, true);
  assert.equal(context.migrateGame({ ...base, archived: 'true' }).archived, false);
});

test('active and archived helpers partition games without losing data', () => {
  const context = { state: { games: [] } };
  vm.createContext(context);
  vm.runInContext(between(appScript, 'function activeGames(', '\nfunction addGame('), context);
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
  vm.runInContext(between(appScript, 'function setGameArchived(', '\nfunction setCycleDone('), context);
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
