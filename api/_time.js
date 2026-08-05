// Timezone-aware cycle math for the notifier — a server-side port of the
// functions in index.html (keep the two in sync). A game's daily cycle is
// identified by the calendar date (in the game's zone) of its start.

function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const o = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== 'literal') o[p.type] = p.value;
  return { year: +o.year, month: +o.month, day: +o.day, hour: +o.hour, minute: +o.minute, second: +o.second };
}

// The UTC instant at which the given wall-clock time occurs in tz
// (two-pass offset solve, correct across DST transitions).
export function zonedTimeToInstant(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const offsetAt = (g) => {
    const p = zonedParts(new Date(g), tz);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - g;
  };
  const o1 = offsetAt(guess);
  let inst = guess - o1;
  const o2 = offsetAt(inst);
  if (o2 !== o1) inst = guess - o2;
  return inst;
}

const pad2 = (n) => String(n).padStart(2, '0');

function shiftDayKey(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12)); // noon anchor: DST-immune
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}
export const prevDayKey = (key) => shiftDayKey(key, -1);
export const nextDayKey = (key) => shiftDayKey(key, 1);

// Resolve the zone a game's reset is anchored to. '' / missing means
// "follow the device" — the client stores its zone in payload.timezone.
export function gameZone(game, payloadTz) {
  return (game && typeof game.timezone === 'string' && game.timezone) ? game.timezone
    : (typeof payloadTz === 'string' && payloadTz) ? payloadTz
    : 'UTC';
}

export function cycleKey(now, game, payloadTz) {
  const p = zonedParts(now, gameZone(game, payloadTz));
  const key = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
  const beforeReset = p.hour < game.resetHour || (p.hour === game.resetHour && p.minute < game.resetMinute);
  return beforeReset ? prevDayKey(key) : key;
}

// Absolute instant (ms) of the game's next reset.
export function nextCycleStart(now, game, payloadTz) {
  const [y, m, d] = nextDayKey(cycleKey(now, game, payloadTz)).split('-').map(Number);
  return zonedTimeToInstant(y, m, d, game.resetHour, game.resetMinute, gameZone(game, payloadTz));
}

// Current streak (consecutive checked cycles ending today, with grace for
// "today not checked yet"). Mirrors getStreak in index.html.
export function streak(game, now, payloadTz) {
  const hist = new Set(Array.isArray(game.history) ? game.history : []);
  let key = cycleKey(now, game, payloadTz);
  if (!hist.has(key)) {
    key = prevDayKey(key);
    if (!hist.has(key)) return 0;
  }
  let count = 0;
  while (hist.has(key) && count < 3650) {
    count++;
    key = prevDayKey(key);
  }
  return count;
}
