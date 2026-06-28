// Data sync — requires an authenticated session.
//   GET  /api/sync                  → { payload, updated_at } | { payload: null }
//   POST /api/sync  { payload }     → { ok: true }

import { cors, db, ensureSchema, readJsonBody, bearerToken, userFromToken } from './_lib.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  await ensureSchema();

  const userId = await userFromToken(bearerToken(req));
  if (!userId) return res.status(401).json({ error: 'authentication required' });

  const sql = db();

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT payload, updated_at FROM gacha_data WHERE user_id = ${userId}
    `;
    if (rows.length === 0) return res.status(200).json({ payload: null, updated_at: null });
    return res.status(200).json({ payload: rows[0].payload, updated_at: rows[0].updated_at });
  }

  // POST
  const body = await readJsonBody(req);
  if (!body) return res.status(400).json({ error: 'invalid JSON body' });
  const { payload } = body;
  if (payload === undefined) return res.status(400).json({ error: 'payload required' });

  await sql`
    INSERT INTO gacha_data (user_id, payload, updated_at)
    VALUES (${userId}, ${JSON.stringify(payload)}::jsonb, NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET payload = EXCLUDED.payload,
          updated_at = NOW()
  `;
  return res.status(200).json({ ok: true });
}