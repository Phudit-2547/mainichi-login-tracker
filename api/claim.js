// Link a sync code to a signed-in passkey account.
//   POST /api/claim { syncCode }  (Bearer token) → { ok, dataKey } | 409
//
// Rebinds the account's data_key to the code and MERGES the account's
// current data into the code's row: games union by id (the code row's
// entry wins and keeps its order, account-only games are appended) with
// per-game check-in histories unioned — nothing is lost on either side.
// The account's old row is deleted only when it was a private pk- key;
// a real sync code may still be in use by other devices.

import {
  cors, db, ensureSchema, readJsonBody, bearerToken, sessionUser, isValidSyncCode,
} from './_lib.js';

function mergeGames(targetGames, accountGames) {
  const merged = targetGames.map(g => ({ ...g }));
  const byId = new Map(merged.map(g => [g.id, g]));
  for (const g of accountGames) {
    const existing = byId.get(g.id);
    if (existing) {
      const a = Array.isArray(existing.history) ? existing.history : [];
      const b = Array.isArray(g.history) ? g.history : [];
      existing.history = [...new Set([...a, ...b])].sort();
    } else {
      merged.push({ ...g });
    }
  }
  return merged;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  try {
    await ensureSchema();
  } catch (e) {
    return res.status(500).json({ error: 'schema init failed: ' + (e.message || String(e)) });
  }

  const user = await sessionUser(bearerToken(req));
  if (!user) return res.status(401).json({ error: 'not signed in' });

  const body = await readJsonBody(req);
  const syncCode = body && body.syncCode;
  if (!isValidSyncCode(syncCode)) {
    return res.status(400).json({ error: 'sync code must be 3-50 chars: letters, numbers, spaces, hyphens, underscores' });
  }

  if (syncCode === user.dataKey) {
    return res.status(200).json({ ok: true, dataKey: syncCode, note: 'already linked' });
  }

  const sql = db();
  const owner = await sql`SELECT id FROM users WHERE data_key = ${syncCode} LIMIT 1`;
  if (owner.length > 0) {
    return res.status(409).json({
      error: 'That sync code already belongs to another passkey account.',
    });
  }

  const targetRows = await sql`SELECT payload FROM gacha_data WHERE device_id = ${syncCode}`;
  const accountRows = await sql`SELECT payload FROM gacha_data WHERE device_id = ${user.dataKey}`;
  const targetGames = targetRows.length && Array.isArray(targetRows[0].payload?.games) ? targetRows[0].payload.games : [];
  const accountGames = accountRows.length && Array.isArray(accountRows[0].payload?.games) ? accountRows[0].payload.games : [];

  if (targetRows.length || accountRows.length) {
    const base = targetRows.length ? targetRows[0].payload : accountRows[0].payload;
    const payload = { ...base, games: mergeGames(targetGames, accountGames) };
    await sql`
      INSERT INTO gacha_data (device_id, payload, updated_at)
      VALUES (${syncCode}, ${JSON.stringify(payload)}::jsonb, NOW())
      ON CONFLICT (device_id) DO UPDATE
        SET payload = EXCLUDED.payload, updated_at = NOW()
    `;
  }

  await sql`UPDATE users SET data_key = ${syncCode} WHERE id = ${user.userId}`;
  if (user.dataKey && user.dataKey.startsWith('pk-')) {
    await sql`DELETE FROM gacha_data WHERE device_id = ${user.dataKey}`;
  }

  return res.status(200).json({ ok: true, dataKey: syncCode });
}
