// Username update — POST { username } while authenticated.
// Validates length (3-30) and character set, then updates the row.

import { cors, db, ensureSchema, readJsonBody, bearerToken, userFromToken } from './_lib.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  try {
    await ensureSchema();
  } catch (e) {
    return res.status(500).json({ error: 'schema init failed: ' + (e.message || String(e)) });
  }

  const userId = await userFromToken(bearerToken(req));
  if (!userId) return res.status(401).json({ error: 'authentication required' });

  const sql = db();
  const body = await readJsonBody(req);
  const raw = (body?.username || '').toString().trim();
  if (raw.length < 3 || raw.length > 30) {
    return res.status(400).json({ error: 'username must be 3-30 characters' });
  }
  if (!/^[\p{L}\p{N} _.\-]+$/u.test(raw)) {
    return res.status(400).json({ error: 'username can only contain letters, numbers, spaces, hyphens, underscores, and periods' });
  }

  await sql`UPDATE users SET username = ${raw} WHERE id = ${userId}`;
  return res.status(200).json({ username: raw });
}