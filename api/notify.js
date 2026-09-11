// Scheduled reminder sender — intended to be hit by a low-frequency external
// scheduler. The endpoint is safe to trigger without configuration: normal
// responses contain no account/game identifiers, sends are idempotent per
// subscription, and a short database lease prevents concurrent/repeated runs.
//
// Optional NOTIFY_SECRET hardens the trigger. When set, send it as
// Authorization: Bearer <secret> (legacy ?secret= remains accepted).

import webpush from 'web-push';
import { db } from './_lib.js';
import { ensurePushSchema, getVapid } from './push.js';
import { cycleKey, nextCycleStart, streak } from './_time.js';

const configuredLead = Number(process.env.NOTIFY_LEAD_MINUTES);
const LEAD_MINUTES = Number.isFinite(configuredLead) && configuredLead > 0 ? configuredLead : 90;
const configuredGate = Number(process.env.NOTIFY_MIN_INTERVAL_MINUTES);
const MIN_RUN_INTERVAL_MINUTES = Number.isFinite(configuredGate) && configuredGate > 0 ? configuredGate : 30;

export function collectDueGames(games, now, deviceTz, delivered = new Set(), leadMinutes = LEAD_MINUTES) {
  const due = [];
  for (const g of Array.isArray(games) ? games : []) {
    if (!g || g.archived === true || typeof g.id !== 'string' ||
        !Number.isInteger(g.resetHour) || !Number.isInteger(g.resetMinute)) continue;
    const key = cycleKey(now, g, deviceTz);
    if (Array.isArray(g.history) && g.history.includes(key)) continue;
    if (delivered.has(`${g.id}
${key}`)) continue;
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

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const secret = process.env.NOTIFY_SECRET;
  const auth = req.headers?.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const legacy = req.query?.secret || (await readBody(req))?.secret;
  const authorized = !!secret && (bearer === secret || legacy === secret);
  if (secret && !authorized) return res.status(401).json({ error: 'bad secret' });

  const dry = req.query?.dry === '1';
  // A public dry-run used to expose data_key and game details. The response is
  // aggregate-only now, but repeated dry-runs could still be used to hammer the
  // database. Keep dry inspection for authenticated operators/tests only.
  if (dry && process.env.NODE_ENV === 'production' && !authorized) {
    return res.status(403).json({ error: 'dry run requires NOTIFY_SECRET' });
  }

  try {
    await ensurePushSchema();
  } catch (e) {
    return res.status(500).json({ error: 'schema init failed: ' + (e.message || String(e)) });
  }

  const sql = db();
  let leased = false;

  // Public zero-config mode still needs abuse/concurrency resistance. The lease
  // expires automatically if an invocation crashes. last_run_at is written
  // only after a successful pass, so HTTP retries can immediately retry real
  // failures instead of being mistaken for duplicate scheduler calls.
  if (!dry) {
    try {
      const lease = await sql`
        INSERT INTO notify_state (key, last_run_at, locked_until)
        VALUES ('scheduler', NULL, NOW() + INTERVAL '3 minutes')
        ON CONFLICT (key) DO UPDATE
          SET locked_until = EXCLUDED.locked_until
        WHERE (notify_state.locked_until IS NULL OR notify_state.locked_until <= NOW())
          AND (notify_state.last_run_at IS NULL OR
               notify_state.last_run_at <= NOW() - (${MIN_RUN_INTERVAL_MINUTES} * INTERVAL '1 minute'))
        RETURNING key
      `;
      if (lease.length === 0) {
        return res.status(200).json({ ok: true, throttled: true, sent: 0, pruned: 0, failed: 0 });
      }
      leased = true;
    } catch (e) {
      return res.status(500).json({ error: 'scheduler lease failed: ' + (e.message || String(e)) });
    }
  }

  try {
    if (!dry) {
      const v = await getVapid();
      webpush.setVapidDetails(v.subject, v.publicKey, v.privateKey);
    }

    const now = new Date();
    const report = {
      ok: true,
      dry,
      subscriptions: 0,
      dueSubscriptions: 0,
      sent: 0,
      pruned: 0,
      failed: 0,
    };

    // Process each subscription independently. A follow-device game's reset is
    // evaluated in that subscription's timezone, not whichever device synced
    // the account most recently.
    const rows = await sql`
      SELECT s.endpoint, s.data_key, s.sub, s.timezone, g.payload
      FROM push_subs s
      LEFT JOIN gacha_data g ON g.device_id = s.data_key
    `;
    report.subscriptions = rows.length;

    for (const row of rows) {
      const payload = row.payload
        ? (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload)
        : null;
      const games = payload && Array.isArray(payload.games) ? payload.games : [];
      const deviceTz = row.timezone || (payload && payload.timezone);

      const deliveredRows = await sql`
        SELECT game_id, cycle_key
        FROM push_delivery
        WHERE endpoint = ${row.endpoint}
          AND data_key = ${row.data_key}
          AND sent_at >= NOW() - INTERVAL '2 days'
      `;
      const delivered = new Set(deliveredRows.map(r => `${r.game_id}\n${r.cycle_key}`));

      const due = collectDueGames(games, now, deviceTz, delivered);
      if (due.length === 0) continue;

      report.dueSubscriptions++;
      if (dry) continue;

      const message = buildMessage(due);
      try {
        await webpush.sendNotification(row.sub, JSON.stringify(message), { TTL: 3600 });
        // Record only after the push service accepted the notification. If the
        // send fails transiently, the HTTP retry / next scheduler run retries
        // this device while successful devices remain deduped.
        for (const d of due) {
          await sql`
            INSERT INTO push_delivery (endpoint, data_key, game_id, cycle_key, sent_at)
            VALUES (${row.endpoint}, ${row.data_key}, ${d.game.id}, ${d.key}, NOW())
            ON CONFLICT DO NOTHING
          `;
        }
        report.sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await sql`DELETE FROM push_subs WHERE endpoint = ${row.endpoint}`;
          await sql`DELETE FROM push_delivery WHERE endpoint = ${row.endpoint}`;
          report.pruned++;
        } else {
          report.failed++;
          console.warn('[notify] send failed:', e.statusCode || e.message);
        }
      }
    }

    if (!dry) {
      await sql`DELETE FROM push_delivery WHERE sent_at < NOW() - INTERVAL '7 days'`;
      await sql`DELETE FROM push_log WHERE sent_at < NOW() - INTERVAL '7 days'`;

      if (report.failed > 0) {
        // Let curl --retry make an immediate second attempt. Successful
        // subscriptions were recorded above, so only failed devices retry.
        await releaseLease(sql);
        leased = false;
        return res.status(503).json(report);
      }

      await sql`
        UPDATE notify_state
        SET last_run_at = NOW(), locked_until = NULL
        WHERE key = 'scheduler'
      `;
      leased = false;
    }

    // Deliberately aggregate-only: data_key is a bearer secret for /api/sync
    // and game names/history are private user data.
    return res.status(200).json(report);
  } catch (e) {
    if (leased) {
      try { await releaseLease(sql); } catch (releaseError) { /* lease expires on its own */ }
    }
    return res.status(500).json({ error: 'notify failed: ' + (e.message || String(e)) });
  }
}

async function releaseLease(sql) {
  await sql`
    UPDATE notify_state
    SET locked_until = NULL
    WHERE key = 'scheduler'
  `;
}

function buildMessage(due) {
  if (due.length === 1) {
    const d = due[0];
    const flame = d.streak > 0 ? ` — \u{1F525} ${d.streak}-day streak on the line` : '';
    return {
      title: 'Mainichi',
      body: `${d.game.name} resets in ${d.minutesLeft}m and you haven't logged in${flame}`,
      tag: 'mainichi-reset',
    };
  }
  const names = due.map(d => d.game.name).join(', ');
  const soonest = Math.min(...due.map(d => d.minutesLeft));
  return {
    title: 'Mainichi',
    body: `${due.length} games reset soon (first in ${soonest}m): ${names}`,
    tag: 'mainichi-reset',
  };
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return null;
}
