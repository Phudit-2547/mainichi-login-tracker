// Session info — returns the current user's username and ID if a valid
// session token is provided. Used by the frontend on app load to decide
// whether to show "sign in" or the signed-in indicator.

import { cors, db, ensureSchema, bearerToken, userFromToken } from './_lib.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  await ensureSchema();

  const token = bearerToken(req);
  const userId = await userFromToken(token);
  if (!userId) return res.status(200).json({ signedIn: false });

  const sql = db();
  const rows = await sql`SELECT id, username, created_at FROM users WHERE id = ${userId}`;
  if (rows.length === 0) return res.status(200).json({ signedIn: false });

  // Count this user's credentials
  const credCount = await sql`SELECT COUNT(*)::int AS n FROM credentials WHERE user_id = ${userId}`;

  return res.status(200).json({
    signedIn: true,
    userId,
    username: rows[0].username,
    createdAt: rows[0].created_at,
    credentialCount: credCount[0].n,
  });
}