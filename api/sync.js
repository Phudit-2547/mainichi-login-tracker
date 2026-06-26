// Vercel serverless function: sync gacha tracker state with Neon Postgres.
//
// Auth model: anyone with the device_id can read/write that row.
// device_id is a UUID generated client-side and stored in localStorage.
// That's "good enough" for personal multi-device sync — not real auth.
//
// Endpoints:
//   GET  /api/sync?device_id=xxx          → { payload, updated_at } | { payload: null }
//   POST /api/sync  { device_id, payload } → { ok: true }
//
// Table is created on first call (idempotent).

import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  // Permissive CORS — Vercel serves same-origin in production, but harmless if called cross-origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ error: 'DATABASE_URL env var not set' });
  }

  const sql = neon(process.env.DATABASE_URL);

  // Bootstrap schema on first run.
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS gacha_data (
        device_id  TEXT        PRIMARY KEY,
        payload    JSONB       NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
  } catch (e) {
    return res.status(500).json({ error: 'schema init failed: ' + e.message });
  }

  // Extract device_id from query (GET) or body (POST).
  let deviceId;
  if (req.method === 'GET') {
    deviceId = req.query?.device_id;
  } else {
    // Vercel Node runtime auto-parses JSON bodies when Content-Type is application/json,
    // but be defensive in case it comes through as a string.
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid JSON body' }); }
    }
    deviceId = body?.device_id;
  }

  if (!deviceId || typeof deviceId !== 'string' || deviceId.length > 100) {
    return res.status(400).json({ error: 'device_id required (string, ≤100 chars)' });
  }

  if (req.method === 'GET') {
    try {
      const rows = await sql`
        SELECT payload, updated_at FROM gacha_data WHERE device_id = ${deviceId}
      `;
      if (rows.length === 0) {
        return res.status(200).json({ payload: null, updated_at: null });
      }
      return res.status(200).json({
        payload: rows[0].payload,
        updated_at: rows[0].updated_at,
      });
    } catch (e) {
      return res.status(500).json({ error: 'query failed: ' + e.message });
    }
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid JSON body' }); }
    }
    const payload = body?.payload;
    if (payload === undefined) {
      return res.status(400).json({ error: 'payload required' });
    }
    try {
      await sql`
        INSERT INTO gacha_data (device_id, payload, updated_at)
        VALUES (${deviceId}, ${JSON.stringify(payload)}::jsonb, NOW())
        ON CONFLICT (device_id) DO UPDATE
        SET payload = EXCLUDED.payload, updated_at = NOW()
      `;
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'upsert failed: ' + e.message });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}
