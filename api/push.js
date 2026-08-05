// Push subscription management.
//   GET    /api/push                     → { publicKey }   (VAPID public key)
//   POST   /api/push { subscription, device_id? }  (or Bearer) → { ok }
//   DELETE /api/push { endpoint, device_id? }      (or Bearer) → { ok }
//
// Subscriptions are keyed to the same data_key the sync row uses, so every
// device that shares a code/account gets the reminders for its games.

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
  })().catch(err => {
    _pushSchemaReady = null;
    throw err;
  });
  return _pushSchemaReady;
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
    const publicKey = process.env.VAPID_PUBLIC_KEY || '';
    if (!publicKey) {
      return res.status(503).json({ error: 'push not configured (VAPID_PUBLIC_KEY missing)' });
    }
    return res.status(200).json({ publicKey });
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
