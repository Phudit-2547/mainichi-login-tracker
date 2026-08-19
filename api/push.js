// Push subscription management.
//   GET    /api/push                     → { publicKey }
//   POST   /api/push { subscription, device_id?, timezone? }  (or Bearer) → { ok }
//   DELETE /api/push { endpoint, device_id? }                 (or Bearer) → { ok }
//
// Subscriptions are keyed to the same data_key the sync row uses. Timezone
// is stored per subscription so "Follow this device" reminders stay correct
// when the same account is used on devices in different countries.

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
        timezone    TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    // Safe migration for databases created before per-device timezones.
    await sql`ALTER TABLE push_subs ADD COLUMN IF NOT EXISTS timezone TEXT`;
    await sql`CREATE INDEX IF NOT EXISTS push_subs_key_idx ON push_subs(data_key)`;

    // Legacy account-level delivery log. Kept for migration/compatibility;
    // new sends use push_delivery so one failing device can retry without
    // duplicating notifications on devices that already succeeded.
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
      CREATE TABLE IF NOT EXISTS push_delivery (
        endpoint   TEXT NOT NULL,
        data_key   TEXT NOT NULL,
        game_id    TEXT NOT NULL,
        cycle_key  TEXT NOT NULL,
        sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (endpoint, data_key, game_id, cycle_key)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS push_delivery_key_idx ON push_delivery(data_key)`;

    // Preserve already-recorded legacy cycles so a deploy does not duplicate
    // a reminder that the previous version marked as delivered.
    await sql`
      INSERT INTO push_delivery (endpoint, data_key, game_id, cycle_key, sent_at)
      SELECT s.endpoint, l.data_key, l.game_id, l.cycle_key, l.sent_at
      FROM push_log l
      JOIN push_subs s ON s.data_key = l.data_key
      ON CONFLICT DO NOTHING
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS push_config (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS notify_state (
        key           TEXT PRIMARY KEY,
        last_run_at   TIMESTAMPTZ,
        locked_until  TIMESTAMPTZ
      )
    `;
    await sql`ALTER TABLE notify_state ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ`;
  })().catch(err => {
    _pushSchemaReady = null;
    throw err;
  });
  return _pushSchemaReady;
}

// VAPID keys: env vars win if set; otherwise keep one atomic JSON pair in
// push_config. A single-row insert avoids mixing the public key from one
// racing cold start with the private key from another.
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
  const pairRows = await sql`SELECT value FROM push_config WHERE key = 'vapid_pair' LIMIT 1`;
  if (pairRows.length) {
    const parsed = parsePair(pairRows[0].value);
    if (parsed) {
      _vapid = parsed;
      return _vapid;
    }
  }

  // Migrate a complete legacy pair atomically into the new single-row form.
  const legacyRows = await sql`SELECT key, value FROM push_config WHERE key IN ('vapid_public', 'vapid_private')`;
  const legacy = Object.fromEntries(legacyRows.map(r => [r.key, r.value]));
  const candidate = legacy.vapid_public && legacy.vapid_private
    ? { publicKey: legacy.vapid_public, privateKey: legacy.vapid_private }
    : webpush.generateVAPIDKeys();
  const stored = JSON.stringify(candidate);
  await sql`
    INSERT INTO push_config (key, value)
    VALUES ('vapid_pair', ${stored})
    ON CONFLICT (key) DO NOTHING
  `;

  const finalRows = await sql`SELECT value FROM push_config WHERE key = 'vapid_pair' LIMIT 1`;
  const finalPair = finalRows.length ? parsePair(finalRows[0].value) : null;
  if (!finalPair) throw new Error('could not initialize VAPID key pair');
  _vapid = finalPair;
  return _vapid;
}

function parsePair(value) {
  try {
    const p = JSON.parse(value);
    if (!p || typeof p.publicKey !== 'string' || typeof p.privateKey !== 'string') return null;
    return { publicKey: p.publicKey, privateKey: p.privateKey, subject: 'mailto:mainichi@example.com' };
  } catch {
    return null;
  }
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

function validTimezone(value) {
  if (typeof value !== 'string' || !value || value.length > 100) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return value;
  } catch {
    return null;
  }
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
    const timezone = validTimezone(body.timezone);
    await sql`
      INSERT INTO push_subs (endpoint, data_key, sub, timezone, created_at)
      VALUES (${sub.endpoint}, ${dataKey}, ${JSON.stringify(sub)}::jsonb, ${timezone}, NOW())
      ON CONFLICT (endpoint) DO UPDATE
        SET data_key = EXCLUDED.data_key,
            sub = EXCLUDED.sub,
            timezone = COALESCE(EXCLUDED.timezone, push_subs.timezone)
    `;
    // If this browser moved to another identity, old delivery markers are no
    // longer relevant to the endpoint and would otherwise linger for a week.
    await sql`DELETE FROM push_delivery WHERE endpoint = ${sub.endpoint} AND data_key <> ${dataKey}`;
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    if (typeof body.endpoint !== 'string') return res.status(400).json({ error: 'endpoint required' });
    await sql`DELETE FROM push_subs WHERE endpoint = ${body.endpoint} AND data_key = ${dataKey}`;
    await sql`DELETE FROM push_delivery WHERE endpoint = ${body.endpoint} AND data_key = ${dataKey}`;
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
