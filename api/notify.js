// Scheduled reminder sender — hit this every ~15 minutes (GitHub Actions
// cron, cron-job.org, …):  GET /api/notify?secret=$NOTIFY_SECRET
//
// For every account with a push subscription: any game still unchecked for
// its current cycle whose reset is within NOTIFY_LEAD_MINUTES gets one
// reminder per cycle (deduped via push_log), grouped into a single
// notification per account. Expired subscriptions (404/410) are pruned.
//
// ?dry=1 computes and reports what would be sent without sending/logging —
// used by tests and for safe manual inspection.

import webpush from 'web-push';
import { db } from './_lib.js';
import { ensurePushSchema } from './push.js';
import { cycleKey, nextCycleStart, streak } from './_time.js';

const LEAD_MINUTES = Number(process.env.NOTIFY_LEAD_MINUTES) || 60;

export default async function handler(req, res) {
  const secret = process.env.NOTIFY_SECRET;
  if (!secret) return res.status(503).json({ error: 'notify not configured (NOTIFY_SECRET missing)' });
  const given = req.query?.secret || (await readBody(req))?.secret;
  if (given !== secret) return res.status(401).json({ error: 'bad secret' });
  const dry = req.query?.dry === '1';

  if (!dry) {
    const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
    if (!pub || !priv) return res.status(503).json({ error: 'VAPID keys missing' });
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:mainichi@example.com', pub, priv);
  }

  try {
    await ensurePushSchema();
  } catch (e) {
    return res.status(500).json({ error: 'schema init failed: ' + (e.message || String(e)) });
  }

  const sql = db();
  const now = new Date();
  const report = { accounts: 0, notified: [], sent: 0, pruned: 0, dry };

  // Every account that has at least one subscription, with its data row.
  const rows = await sql`
    SELECT s.data_key, jsonb_agg(s.sub) AS subs, MAX(g.payload::text) AS payload
    FROM push_subs s
    LEFT JOIN gacha_data g ON g.device_id = s.data_key
    GROUP BY s.data_key
  `;

  for (const row of rows) {
    report.accounts++;
    const payload = row.payload ? JSON.parse(row.payload) : null;
    const games = payload && Array.isArray(payload.games) ? payload.games : [];
    const payloadTz = payload && payload.timezone;

    const due = [];
    for (const g of games) {
      if (!g || typeof g.id !== 'string' || !Number.isInteger(g.resetHour)) continue;
      const key = cycleKey(now, g, payloadTz);
      if (Array.isArray(g.history) && g.history.includes(key)) continue; // already checked in
      const msLeft = nextCycleStart(now, g, payloadTz) - now.getTime();
      if (msLeft <= 0 || msLeft > LEAD_MINUTES * 60 * 1000) continue;
      const logged = await sql`
        SELECT 1 FROM push_log
        WHERE data_key = ${row.data_key} AND game_id = ${g.id} AND cycle_key = ${key}
        LIMIT 1
      `;
      if (logged.length > 0) continue;
      due.push({ game: g, key, minutesLeft: Math.max(1, Math.round(msLeft / 60000)), streak: streak(g, now, payloadTz) });
    }
    if (due.length === 0) continue;

    const message = buildMessage(due);
    report.notified.push({ dataKey: row.data_key, games: due.map(d => ({ id: d.game.id, name: d.game.name, minutesLeft: d.minutesLeft, streak: d.streak })) });
    if (dry) continue;

    for (const d of due) {
      await sql`
        INSERT INTO push_log (data_key, game_id, cycle_key)
        VALUES (${row.data_key}, ${d.game.id}, ${d.key})
        ON CONFLICT DO NOTHING
      `;
    }
    for (const sub of row.subs) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(message), { TTL: 3600 });
        report.sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await sql`DELETE FROM push_subs WHERE endpoint = ${sub.endpoint}`;
          report.pruned++;
        } else {
          console.warn('[notify] send failed:', e.statusCode || e.message);
        }
      }
    }
  }

  if (!dry) {
    await sql`DELETE FROM push_log WHERE sent_at < NOW() - INTERVAL '7 days'`;
  }
  return res.status(200).json(report);
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
