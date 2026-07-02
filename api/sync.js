// Sync — two ways to address your data row:
//   1. Sync code:       GET /api/sync?device_id=<code> / POST { device_id, payload }
//      Anyone who knows the code can read/write that row — the code IS the
//      shared secret.
//   2. Passkey session: same endpoints with Authorization: Bearer <token>;
//      the session resolves to the account's data_key (the sync code it
//      claimed at registration), so both paths hit the same row.

import { neon } from '@neondatabase/serverless';
import { ensureSchema as ensureAuthSchema, bearerToken, sessionUser } from './_lib.js';

const sql = neon(process.env.DATABASE_URL);

let _schemaReady = null;
async function ensureSchema() {
  if (_schemaReady) return _schemaReady;
  _schemaReady = (async () => {
    // If a previous deploy left gacha_data in the passkey shape (user_id
    // UUID), park it as a legacy table so the column shape can change.
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'gacha_data' AND column_name = 'user_id'
      LIMIT 1
    `;
    if (cols.length > 0) {
      await sql`ALTER TABLE gacha_data RENAME TO gacha_data_passkey_legacy`;
    }
    await sql`
      CREATE TABLE IF NOT EXISTS gacha_data (
        device_id  TEXT PRIMARY KEY,
        payload    JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
  })().catch(err => {
    _schemaReady = null;
    throw err;
  });
  return _schemaReady;
}

function isValidCode(s) {
  return typeof s === 'string' && s.length >= 3 && s.length <= 50 && /^[a-zA-Z0-9_\- ]+$/.test(s);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return {};
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await ensureSchema();
  } catch (e) {
    return res.status(500).json({ error: 'schema init failed: ' + e.message });
  }

  // A passkey session resolves to the account's data_key; otherwise the
  // caller addresses a row directly by sync code.
  let deviceId;
  const token = bearerToken(req);
  if (token) {
    try {
      await ensureAuthSchema();
    } catch (e) {
      return res.status(500).json({ error: 'schema init failed: ' + e.message });
    }
    const user = await sessionUser(token);
    if (!user) return res.status(401).json({ error: 'session expired' });
    deviceId = user.dataKey;
  } else {
    if (req.method === 'GET') {
      deviceId = req.query?.device_id;
    } else {
      const body = await readJsonBody(req);
      deviceId = body?.device_id;
    }
    if (!isValidCode(deviceId)) {
      return res.status(400).json({
        error: 'device_id required (3-50 chars: letters, numbers, spaces, hyphens, underscores)',
      });
    }
  }

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT payload, updated_at FROM gacha_data WHERE device_id = ${deviceId}
    `;
    if (rows.length === 0) return res.status(200).json({ payload: null, updated_at: null });
    return res.status(200).json({ payload: rows[0].payload, updated_at: rows[0].updated_at });
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const { payload } = body;
    if (payload === undefined) return res.status(400).json({ error: 'payload required' });
    await sql`
      INSERT INTO gacha_data (device_id, payload, updated_at)
      VALUES (${deviceId}, ${JSON.stringify(payload)}::jsonb, NOW())
      ON CONFLICT (device_id) DO UPDATE
        SET payload = EXCLUDED.payload, updated_at = NOW()
    `;
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}