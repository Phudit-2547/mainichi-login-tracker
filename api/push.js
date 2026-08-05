// Push subscription management.
//   GET    /api/push                     → { publicKey }   (VAPID public key)
//   POST   /api/push { subscription, device_id? }  (or Bearer) → { ok }
//   DELETE /api/push { endpoint, device_id? }      (or Bearer) → { ok }
//
// Subscriptions are keyed to the same data_key the sync row uses, so every
// device that shares a code/account gets the reminders for its games.

import webpush from 'web-push';
import {
  cors, db, readJsonBody, bearerToken, sessionUser, isValidSyncCode,
  ensureSchema as ensureAuthSchema,
} from './_lib.js';

let _pushSchemaReady = null;
export function ensurePushSchema() {
  if (_pushSchemaReady) return _pushSchemaReady;
  _pushSchemaReady = (async () => {
    const sql = db();
    await sql`
      CREATE TABLE IF NOT EXISTS push_subs (
        endpoint    TEXT PRIMARY KEY,
        data_key    TEXT NOT NULL,
        sub         JSONB NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS push_subs_key_idx ON push_subs(data_key)`;
    // One reminder per game per cycle.
    await sql`
      CREATE TABLE IF NOT EXISTS push_log (
        data_key   TEXT NOT NULL,
        game_id    TEXT NOT NULL,
        cycle_key  TEXT NOT NULL,
        sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (data_key, game_id, cycle_key)
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS push_config (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL
      )
    `;
  })().catch(err => {
    _pushSchemaReady = null;
    throw err;
  });
  return _pushSchemaReady;
}

// VAPID keys: env vars win if set; otherwise the server generates a pair on
// first use and keeps it in the database — zero setup for the operator.
// (The private key lives beside the data it protects; anyone with
// DATABASE_URL already has full access, so this adds no new exposure.)
let _vapid = null;
export async function getVapid() {
  if (_vapid) return _vapid;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    _vapid = {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
      subject: process.env.VAPID_SUBJECT || 'mailto:mainichi@example.com',
    };
    return _vapid;
  }
  await ensurePushSchema();
  const sql = db();
  const rows = await sql`SELECT key, value FROM push_config WHERE key IN ('vapid_public', 'vapid_private')`;
  const found = Object.fromEntries(rows.map(r => [r.key, r.value]));
  if (found.vapid_public && found.vapid_private) {
    _vapid = { publicKey: found.vapid_public, privateKey: found.vapid_private, subject: 'mailto:mainichi@example.com' };
    return _vapid;
  }
  const k = webpush.generateVAPIDKeys();
  // ON CONFLICT DO NOTHING + re-read: two cold instances racing still agree.
  await sql`INSERT INTO push_config (key, value) VALUES ('vapid_public', ${k.publicKey}) ON CONFLICT (key) DO NOTHING`;
  await sql`INSERT INTO push_config (key, value) VALUES ('vapid_private', ${k.privateKey}) ON CONFLICT (key) DO NOTHING`;
  const again = await sql`SELECT key, value FROM push_config WHERE key IN ('vapid_public', 'vapid_private')`;
  const final = Object.fromEntries(again.map(r => [r.key, r.value]));
  _vapid = { publicKey: final.vapid_public, privateKey: final.vapid_private, subject: 'mailto:mainichi@example.com' };
  return _vapid;
}

// Resolve the caller to a data_key: bearer session first, else device_id.
async function resolveDataKey(req, body) {
  const token = bearerToken(req);
  if (token) {
    await ensureAuthSchema();
    const user = await sessionUser(token);
    return user ? user.dataKey : null;
  }
  const code = body && body.device_id;
  return isValidSyncCode(code) ? code : null;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const { publicKey } = await getVapid();
      return res.status(200).json({ publicKey });
    } catch (e) {
      return res.status(500).json({ error: 'vapid init failed: ' + (e.message || String(e)) });
    }
  }

  try {
    await ensurePushSchema();
  } catch (e) {
    return res.status(500).json({ error: 'schema init failed: ' + (e.message || String(e)) });
  }

  const body = await readJsonBody(req);
  if (!body) return res.status(400).json({ error: 'invalid JSON body' });

  let dataKey;
  try {
    dataKey = await resolveDataKey(req, body);
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
  if (!dataKey) return res.status(401).json({ error: 'sign in or provide a sync code first' });

  const sql = db();

  if (req.method === 'POST') {
    const sub = body.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://')) {
      return res.status(400).json({ error: 'subscription with endpoint required' });
    }
    await sql`
      INSERT INTO push_subs (endpoint, data_key, sub, created_at)
      VALUES (${sub.endpoint}, ${dataKey}, ${JSON.stringify(sub)}::jsonb, NOW())
      ON CONFLICT (endpoint) DO UPDATE SET data_key = EXCLUDED.data_key, sub = EXCLUDED.sub
    `;
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    if (typeof body.endpoint !== 'string') return res.status(400).json({ error: 'endpoint required' });
    await sql`DELETE FROM push_subs WHERE endpoint = ${body.endpoint} AND data_key = ${dataKey}`;
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
