// Session introspection + sign-out.
//   GET    /api/me   (Bearer token) → { username } | 401
//   DELETE /api/me   (Bearer token) → { ok: true }   (revokes the session)

import { cors, db, ensureSchema, bearerToken, sessionUser } from './_lib.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await ensureSchema();
  } catch (e) {
    return res.status(500).json({ error: 'schema init failed: ' + (e.message || String(e)) });
  }

  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'not signed in' });

  if (req.method === 'GET') {
    const user = await sessionUser(token);
    if (!user) return res.status(401).json({ error: 'session expired' });
    return res.status(200).json({ username: user.username });
  }

  if (req.method === 'DELETE') {
    await db()`DELETE FROM sessions WHERE token = ${token}`;
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
