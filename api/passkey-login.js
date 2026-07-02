// Passkey sign-in — discoverable credentials, and NOTHING else: an unknown
// passkey gets a clear error, never a silent registration (that fallback is
// what created duplicate accounts in the old version).
//
//   POST { stage: 'begin' }                          → { options, ceremonyId }
//   POST { stage: 'finish', ceremonyId, credential } → { sessionToken, username }

import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import {
  cors, db, ensureSchema, readJsonBody, rpConfig,
  storeChallenge, consumeChallenge, issueSession, randomToken,
} from './_lib.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  try {
    await ensureSchema();
  } catch (e) {
    return res.status(500).json({ error: 'schema init failed: ' + (e.message || String(e)) });
  }

  const body = await readJsonBody(req);
  if (!body) return res.status(400).json({ error: 'invalid JSON body' });

  try {
    if (body.stage === 'begin') return await begin(req, res);
    if (body.stage === 'finish') return await finish(req, res, body);
  } catch (e) {
    console.error('[passkey-login]', e);
    return res.status(500).json({ error: e.message || String(e) });
  }
  return res.status(400).json({ error: 'invalid stage' });
}

async function begin(req, res) {
  const { rpID } = rpConfig(req);
  // No allowCredentials → the browser offers whatever passkeys the user
  // has for this RP across their devices.
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
  });
  const ceremonyId = await storeChallenge('login', options.challenge, null);
  return res.status(200).json({ options, ceremonyId });
}

async function finish(req, res, body) {
  const { ceremonyId, credential } = body;
  if (!credential || !credential.id) {
    return res.status(400).json({ error: 'credential required' });
  }

  const row = await consumeChallenge('login', ceremonyId);
  if (!row) return res.status(400).json({ error: 'challenge expired — try again' });

  const sql = db();
  const credRows = await sql`
    SELECT c.*, u.username, u.data_key FROM credentials c
    JOIN users u ON u.id = c.user_id
    WHERE c.id = ${credential.id}
    LIMIT 1
  `;
  if (credRows.length === 0) {
    return res.status(404).json({
      error: 'No account found for this passkey. Use "Create account" if you don\'t have one yet.',
    });
  }
  const stored = credRows[0];
  const { rpID, origin } = rpConfig(req);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: row.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: stored.id,
        publicKey: Buffer.from(stored.public_key, 'base64url'),
        counter: Number(stored.sign_count),
      },
      requireUserVerification: false,
    });
  } catch (e) {
    return res.status(400).json({ error: 'verification failed: ' + (e.message || String(e)) });
  }
  if (!verification.verified) {
    return res.status(400).json({ error: 'verification failed' });
  }

  await sql`
    UPDATE credentials
    SET sign_count = ${verification.authenticationInfo.newCounter}, last_used_at = NOW()
    WHERE id = ${stored.id}
  `;

  const sessionToken = await issueSession(stored.user_id);
  return res.status(200).json({ sessionToken, username: stored.username, dataKey: stored.data_key });
}
