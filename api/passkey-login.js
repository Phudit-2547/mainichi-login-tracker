// Passkey authentication — discoverable credentials (no username required).
// Follows https://github.com/MasterKale/SimpleWebAuthn/blob/master/example/index.ts
//
// Two stages:
//   POST { stage: 'begin' }             → challenge + WebAuthn options
//   POST { stage: 'finish', credential } → verify, issue session
//
// Browser surfaces whatever passkeys the user has stored for this RP
// (typically synced via iCloud Keychain / Google Password Manager /
// Proton Pass). User picks + biometric, browser signs the challenge,
// we verify and look up the user via credential.id.

import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { cors, db, ensureSchema, readJsonBody, randomToken, RP_ID, EXPECTED_ORIGIN } from './_lib.js';

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

  const { stage } = body;
  if (stage === 'begin') return await beginLogin(res);
  if (stage === 'finish') return await finishLogin(req, res, body);
  return res.status(400).json({ error: 'invalid stage' });
}

async function beginLogin(res) {
  const sql = db();

  // No allowCredentials → discoverable credentials. The browser shows
  // whatever passkeys the user has for this RP across all their devices.
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'preferred',
  });

  await sql`
    INSERT INTO challenges (challenge, type, expires_at)
    VALUES (${options.challenge}, 'login', NOW() + INTERVAL '5 minutes')
  `;

  return res.status(200).json({ options });
}

async function finishLogin(req, res, body) {
  const { credential } = body;
  if (!credential || !credential.id) {
    return res.status(400).json({ error: 'credential required' });
  }

  const sql = db();

  // Look up the stored credential by its base64url ID.
  const credRows = await sql`SELECT * FROM credentials WHERE id = ${credential.id}`;
  if (credRows.length === 0) {
    return res.status(400).json({ error: 'credential not found' });
  }
  const stored = credRows[0];

  // Pull the most recent unexpired login challenge.
  const challengeRows = await sql`
    SELECT challenge FROM challenges
    WHERE type = 'login' AND expires_at > NOW()
    ORDER BY created_at DESC LIMIT 1
  `;
  if (challengeRows.length === 0) {
    return res.status(400).json({ error: 'challenge expired' });
  }
  const expectedChallenge = challengeRows[0].challenge;

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: EXPECTED_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: stored.id,
        publicKey: stored.public_key,
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

  // Update the counter to detect cloned authenticators.
  await sql`
    UPDATE credentials
    SET sign_count = ${verification.authenticationInfo.newCounter},
        last_used_at = NOW()
    WHERE id = ${stored.id}
  `;

  // Consume the challenge so it can't be replayed.
  await sql`DELETE FROM challenges WHERE challenge = ${expectedChallenge}`;

  // Issue a session token.
  const sessionToken = randomToken();
  await sql`
    INSERT INTO sessions (token, user_id, expires_at)
    VALUES (${sessionToken}, ${stored.user_id}, NOW() + INTERVAL '30 days')
  `;

  return res.status(200).json({ sessionToken, userId: stored.user_id });
}