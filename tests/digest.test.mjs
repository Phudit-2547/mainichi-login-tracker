import assert from 'node:assert/strict';
import test from 'node:test';
import { collectDigest, digestDayKey, buildDigestMessage } from '../api/notify.js';

const tokyo = (id, name, history = [], extra = {}) =>
  ({ id, name, resetHour: 4, resetMinute: 0, timezone: 'Asia/Tokyo', history, ...extra });

test('digest splits active games into checked and left for the current cycle', () => {
  const now = new Date('2026-07-22T12:00:00Z'); // 21:00 JST, cycle 2026-07-22
  const games = [
    tokyo('a', 'Genshin', ['2026-07-22']),
    tokyo('b', 'HSR', ['2026-07-21']),              // checked yesterday only
    tokyo('c', 'ZZZ', ['2026-07-22'], { archived: true }),
  ];
  assert.deepEqual(collectDigest(games, now, 'Asia/Bangkok'), { done: ['Genshin'], left: ['HSR'] });
});

test('digest is due from the chosen device-local hour, keyed by local date', () => {
  // 13:30Z = 20:30 Bangkok
  const now = new Date('2026-07-22T13:30:00Z');
  assert.equal(digestDayKey(now, 'Asia/Bangkok', 21), null, 'before the hour');
  assert.equal(digestDayKey(now, 'Asia/Bangkok', 20), '2026-07-22', 'at/after the hour');
  assert.equal(digestDayKey(now, 'America/New_York', 9), '2026-07-22', '09:30 EDT');
  assert.equal(digestDayKey(now, 'Asia/Bangkok', null), null, 'off');
  assert.equal(digestDayKey(now, 'Asia/Bangkok', 24), null, 'invalid hour');
});

test('digest message lists checked and unchecked games', () => {
  const partial = buildDigestMessage({ done: ['Genshin', 'HSR'], left: ['ZZZ'] });
  assert.equal(partial.title, 'Mainichi — 2/3 checked today');
  assert.equal(partial.body, '✓ Genshin, HSR\n✗ ZZZ');
  assert.equal(partial.tag, 'mainichi-digest');
  const all = buildDigestMessage({ done: ['Genshin'], left: [] });
  assert.equal(all.title, 'Mainichi — all 1 checked today');
  assert.equal(all.body, '✓ Genshin');
});
