// Legacy data claim — for users who had data tied to the old device_id model
// (memorable code or UUID). After signing in with passkey, paste the old
// code here and we'll copy that row's payload to the current user, then
// delete the legacy row.
//
//   POST { code }   → { ok, claimedFrom: '<code>' }

import { cors, db, ensureSchema, readJsonBody, bearerToken, userFromToken } from './_lib.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  await ensureSchema();

  const userId = await userFromToken(bearerToken(req));
  if (!userId) return res.status(401).json({ error: 'authentication required' });

  const body = await readJsonBody(req);
  const code = (body?.code || '').trim();
  if (!code || !/^[a-zA-Z0-9_-]{3,80}$/.test(code)) {
    return res.status(400).json({ error: 'invalid code' });
  }

  const sql = db();
  const legacy = await sql`SELECT payload FROM gacha_data_legacy WHERE device_id = ${code}`;
  if (legacy.length === 0) {
    return res.status(404).json({ error: 'no legacy data found for that code' });
  }

  // Move the payload to the current user (merge via overwrite — last-writer-wins)
  await sql`
    INSERT INTO gacha_data (user_id, payload, updated_at)
    VALUES (${userId}, ${legacy[0].payload}, NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET payload = EXCLUDED.payload,
          updated_at = NOW()
  `;
  await sql`DELETE FROM gacha_data_legacy WHERE device_id = ${code}`;

  return res.status(200).json({ ok: true, claimedFrom: code });
}