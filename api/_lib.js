// Shared helpers for the passkey endpoints — DB connection, schema
// bootstrap, session helpers, and WebAuthn RP config.
//
// Account model: a passkey account is just a secure holder of a data_key —
// the same kind of TEXT key a sync code is. gacha_data rows are keyed by
// that key, so passkey devices and sync-code devices share data with no
// changes to the sync data model.

import { neon } from '@neondatabase/serverless';

let _sql = null;
export function db() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

export const RP_NAME = 'Mainichi';

// WebAuthn scopes credentials to the RP ID (a registrable domain). We pin
// production to one host; localhost is special-cased so `vercel dev` works.
// Passkeys created on preview deployments cannot work on prod — that's a
// WebAuthn property, not a bug here.
export function rpConfig(req) {
  const hostHeader = req.headers?.host || '';
  const host = hostHeader.split(':')[0];
  if (host === 'localhost' || host === '127.0.0.1') {
    return { rpID: host, origin: `http://${hostHeader}` };
  }
  const prod = process.env.RP_ID || process.env.PUBLIC_HOST || 'mainichi-login-tracker.vercel.app';
  return { rpID: prod, origin: process.env.EXPECTED_ORIGIN || `https://${prod}` };
}

let _schemaReady = null;
export function ensureSchema() {
  if (_schemaReady) return _schemaReady;
  _schemaReady = (async () => {
    const sql = db();
    const hasDataKey = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'data_key'
      LIMIT 1
    `;
    // Fast path: schema already provisioned. This runs on every function
    // cold start, ahead of latency-sensitive calls like passkey `begin`,
    // so it must stay one round trip — the full bootstrap below only ever
    // runs once per database. Expired-row sweeps ride along occasionally.
    if (hasDataKey.length > 0) {
      if (Math.random() < 0.05) {
        await sql`DELETE FROM challenges WHERE expires_at < NOW() - INTERVAL '1 hour'`;
        await sql`DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL '1 day'`;
      }
      return;
    }
    // The 2026-06 passkey experiment left auth tables in an older shape
    // (users without data_key, challenges keyed by challenge string) holding
    // only abandoned duplicate accounts. Park them and start clean.
    const hasUsers = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_name = 'users' AND table_schema = 'public'
      LIMIT 1
    `;
    if (hasUsers.length > 0 && hasDataKey.length === 0) {
      await sql`ALTER TABLE IF EXISTS challenges RENAME TO challenges_passkey_legacy`;
      await sql`ALTER TABLE IF EXISTS sessions RENAME TO sessions_passkey_legacy`;
      await sql`ALTER TABLE IF EXISTS credentials RENAME TO credentials_passkey_legacy`;
      await sql`ALTER TABLE IF EXISTS users RENAME TO users_passkey_legacy`;
    }
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id          UUID PRIMARY KEY,
        username    TEXT,
        data_key    TEXT UNIQUE NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS credentials (
        id            TEXT PRIMARY KEY,
        user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        public_key    TEXT NOT NULL,
        sign_count    BIGINT NOT NULL DEFAULT 0,
        transports    TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at  TIMESTAMPTZ
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS credentials_user_idx ON credentials(user_id)`;
    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        token       TEXT PRIMARY KEY,
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)`;
    // Challenges are bound to a ceremony id issued at `begin` and consumed
    // exactly once at `finish` — never matched by "most recent".
    await sql`
      CREATE TABLE IF NOT EXISTS challenges (
        id          TEXT PRIMARY KEY,
        challenge   TEXT NOT NULL,
        type        TEXT NOT NULL,
        meta        JSONB,
        expires_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`DELETE FROM challenges WHERE expires_at < NOW() - INTERVAL '1 hour'`;
    await sql`DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL '1 day'`;
  })().catch(err => {
    _schemaReady = null; // retry next call
    console.error('[mainichi] schema bootstrap failed:', err);
    throw err;
  });
  return _schemaReady;
}

// ---- HTTP helpers ----
export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return null; }
  }
  return {};
}

export function bearerToken(req) {
  const h = req.headers?.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// Resolve a session token to { userId, username, dataKey }, or null.
export async function sessionUser(token) {
  if (!token) return null;
  const sql = db();
  const rows = await sql`
    SELECT u.id, u.username, u.data_key FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > NOW()
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return { userId: rows[0].id, username: rows[0].username, dataKey: rows[0].data_key };
}

export async function issueSession(userId) {
  const token = randomToken();
  await db()`
    INSERT INTO sessions (token, user_id, expires_at)
    VALUES (${token}, ${userId}, NOW() + INTERVAL '90 days')
  `;
  return token;
}

// Store the challenge for one ceremony; returns the ceremony id.
export async function storeChallenge(type, challenge, meta) {
  const id = randomToken();
  await db()`
    INSERT INTO challenges (id, challenge, type, meta, expires_at)
    VALUES (${id}, ${challenge}, ${type}, ${meta ? JSON.stringify(meta) : null}::jsonb, NOW() + INTERVAL '5 minutes')
  `;
  return id;
}

// Single-use: deletes the row whether or not verification later succeeds.
export async function consumeChallenge(type, ceremonyId) {
  if (typeof ceremonyId !== 'string' || !ceremonyId) return null;
  const rows = await db()`
    DELETE FROM challenges
    WHERE id = ${ceremonyId} AND type = ${type} AND expires_at > NOW()
    RETURNING challenge, meta
  `;
  return rows.length ? rows[0] : null;
}

// ---- Crypto helpers ----
export function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

export function isValidSyncCode(s) {
  return typeof s === 'string' && s.length >= 3 && s.length <= 50 && /^[a-zA-Z0-9_\- ]+$/.test(s);
}

export function suggestUsername() {
  const adj = ['happy', 'swift', 'bright', 'calm', 'brave', 'noble', 'mellow', 'sunny', 'quick', 'keen'];
  const noun = ['tiger', 'river', 'phoenix', 'meadow', 'comet', 'otter', 'spark', 'jasmine', 'ember', 'wave'];
  return adj[Math.floor(Math.random() * adj.length)] + '-' + noun[Math.floor(Math.random() * noun.length)];
}
