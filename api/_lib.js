// Shared helpers for all API endpoints — DB connection, schema bootstrap,
// crypto helpers, and config.

import { neon } from '@neondatabase/serverless';

let _sql = null;
export function db() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

// Config — RP_ID and ORIGIN are environment-specific. On Vercel, VERCEL_URL
// is auto-set and gives us the deployment hostname. We pin to the production
// domain so passkeys created in dev work in prod and vice versa.
const PROD_HOST = process.env.PUBLIC_HOST || 'mainichi-login-tracker.vercel.app';
export const RP_ID = process.env.RP_ID || PROD_HOST;
export const RP_NAME = 'Mainichi';
export const EXPECTED_ORIGIN = process.env.EXPECTED_ORIGIN || `https://${RP_ID}`;

let _schemaReady = null;
export function ensureSchema() {
  if (_schemaReady) return _schemaReady;
  _schemaReady = (async () => {
    const sql = db();
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id          UUID PRIMARY KEY,
        username    TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS credentials (
        id            TEXT PRIMARY KEY,
        user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        public_key    BYTEA NOT NULL,
        sign_count    BIGINT NOT NULL DEFAULT 0,
        transports    TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at  TIMESTAMPTZ
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS credentials_user_idx ON credentials(user_id)
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        token       TEXT PRIMARY KEY,
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS challenges (
        challenge   TEXT PRIMARY KEY,
        user_id     UUID,
        type        TEXT NOT NULL,
        expires_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    // One-time migration: if gacha_data still has the old device_id schema
    // (text PK), rename it to gacha_data_legacy so users can claim their data
    // via /api/claim. Done as separate queries because the @neondatabase/serverless
    // HTTP driver doesn't reliably support PL/pgSQL DO blocks.
    const legacyCols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'gacha_data' AND column_name = 'device_id'
      LIMIT 1
    `;
    if (legacyCols.length > 0) {
      await sql`ALTER TABLE gacha_data RENAME TO gacha_data_legacy`;
    }
    await sql`
      CREATE TABLE IF NOT EXISTS gacha_data (
        user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        payload     JSONB NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    // Sweep expired challenges & sessions occasionally (best-effort).
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
  res.setHeader('Access-Control-Allow-Origin', EXPECTED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  // Fallback: read raw stream
  if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return null; }
  }
  return {};
}

// Extract bearer token from Authorization header.
export function bearerToken(req) {
  const h = req.headers?.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// Resolve a session token to a user_id, or null if invalid/expired.
export async function userFromToken(token) {
  if (!token) return null;
  const sql = db();
  const rows = await sql`
    SELECT user_id FROM sessions
    WHERE token = ${token} AND expires_at > NOW()
    LIMIT 1
  `;
  return rows.length ? rows[0].user_id : null;
}

// ---- Crypto helpers ----
export function randomChallenge() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

// Lightweight CUID-ish username when none provided
export function suggestUsername() {
  const adj = ['happy','swift','bright','calm','brave','noble','mellow','sunny','quick','keen'];
  const noun = ['tiger','river','phoenix','meadow','comet','otter','spark','jasmine','ember','wave'];
  return adj[Math.floor(Math.random() * adj.length)] + '-' + noun[Math.floor(Math.random() * noun.length)];
}