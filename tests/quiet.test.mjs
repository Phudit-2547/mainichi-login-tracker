import assert from 'node:assert/strict';
import test from 'node:test';
import { collectDueGames, quietInfo, formatLeft } from '../api/notify.js';

// The real schedule this was designed from: every game follows a device in
// Bangkok. Nothing checked in, so only timing decides what is due.
const g = (id, h) => ({ id, name: id, resetHour: h, resetMinute: 0, timezone: '', history: [] });
const games = [g('hachiroku', 0), g('endfield', 3), g('muvluv', 3), g('fgo', 11), g('arknights', 18), g('aether', 19)];
const TZ = 'Asia/Bangkok';
const at = (bkkHHMM) => new Date(`2026-10-20T${bkkHHMM}:00+07:00`);
const ids = (due) => due.map(d => d.game.id).sort();
const QUIET = { start: 0, end: 7 };

test('quiet hours: 02:17 (asleep) sends nothing', () => {
  assert.deepEqual(collectDueGames(games, at('02:17'), TZ, new Set(), 90, QUIET), []);
});

test('quiet hours: 03:00 resets are pulled forward to the last awake run (23:17)', () => {
  assert.deepEqual(ids(collectDueGames(games, at('23:17'), TZ, new Set(), 90, QUIET)),
    ['endfield', 'hachiroku', 'muvluv']);
});

test('quiet hours: 22:17 is not yet the last awake run', () => {
  assert.deepEqual(collectDueGames(games, at('22:17'), TZ, new Set(), 90, QUIET), []);
});

test('daytime reminders are unchanged', () => {
  assert.deepEqual(ids(collectDueGames(games, at('10:17'), TZ, new Set(), 90, QUIET)), ['fgo']);
  assert.deepEqual(ids(collectDueGames(games, at('17:17'), TZ, new Set(), 90, QUIET)), ['arknights']);
  assert.deepEqual(ids(collectDueGames(games, at('18:17'), TZ, new Set(), 90, QUIET)), ['aether']);
});

test('quiet hours off keeps the old 02:17 behaviour', () => {
  assert.deepEqual(ids(collectDueGames(games, at('02:17'), TZ, new Set(), 90, null)), ['endfield', 'muvluv']);
});

test('pulled-forward reminder is not repeated once delivered', () => {
  const due = collectDueGames(games, at('23:17'), TZ, new Set(), 90, QUIET);
  const delivered = new Set(due.map(d => `${d.game.id}\n${d.key}`));
  assert.deepEqual(collectDueGames(games, at('23:47'), TZ, delivered, 90, QUIET), []);
});

test('quietInfo handles wrap-around and off', () => {
  assert.equal(quietInfo(at('23:30'), TZ, { start: 23, end: 6 }).inside, true);
  assert.equal(quietInfo(at('05:59'), TZ, { start: 23, end: 6 }).inside, true);
  assert.equal(quietInfo(at('06:00'), TZ, { start: 23, end: 6 }).inside, false);
  assert.equal(quietInfo(at('03:00'), TZ, { start: 5, end: 5 }), null);
  assert.equal(quietInfo(at('03:00'), TZ, null), null);
});

test('formatLeft', () => {
  assert.equal(formatLeft(43), '43m');
  assert.equal(formatLeft(223), '3h 43m');
  assert.equal(formatLeft(120), '2h');
});
