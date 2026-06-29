// Passkey registration — two stages:
//   POST { stage: 'begin' }    → server generates challenge + user_id, returns WebAuthn options
//   POST { stage: 'finish', credential, user_id } → server verifies, stores credential, creates session
//
// The first request creates a row in `users` with a random UUID user_id.
// The second request stores the credential and creates an active session,
// returning { sessionToken, userId }.

import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { cors, db, ensureSchema, readJsonBody, bearerToken, randomChallenge, randomToken, suggestUsername, RP_ID, RP_NAME, EXPECTED_ORIGIN } from './_lib.js';

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

  if (stage === 'begin') {
    return await beginRegistration(req, res, body);
  }
  if (stage === 'finish') {
    return await finishRegistration(req, res, body);
  }
  return res.status(400).json({ error: 'invalid stage' });
}

async function beginRegistration(req, res, body) {
  const sql = db();

  // If a session is already attached, we're adding a new device to an existing
  // user. Otherwise create a fresh user.
  let userId = body.userId || null;
  const existingToken = bearerToken(req);
  if (!userId && existingToken) {
    // Try to use the session's user — but for new-passkey registration we
    // still need a fresh user row. Allow only if user explicitly sends userId.
  }

  if (!userId) {
    // Create a new user with a UUID and the supplied username (or auto-gen).
    userId = crypto.randomUUID();
    const supplied = body.username && String(body.username).trim();
    const username = (supplied && supplied.length >= 3 && supplied.length <= 30)
      ? supplied
      : suggestUsername();
    await sql`INSERT INTO users (id, username) VALUES (${userId}, ${username})`;
  } else {
    // Verify the user exists
    const rows = await sql`SELECT 1 FROM users WHERE id = ${userId}`;
    if (rows.length === 0) return res.status(400).json({ error: 'user not found' });
  }

  const challenge = randomChallenge();
  await sql`
    INSERT INTO challenges (challenge, user_id, type, expires_at)
    VALUES (${challenge}, ${userId}, 'register', NOW() + INTERVAL '5 minutes')
  `;

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: new TextEncoder().encode(userId),  // v13 requires Uint8Array, not string
    userName: body.username || suggestUsername(),
    challenge,
    authenticatorSelection: {
      residentKey: 'required',         // discoverable — survives cross-device
      userVerification: 'preferred',
    },
    // Don't restrict to platform authenticators — iCloud Keychain, Google
    // Password Manager, 1Password, etc. all qualify.
  });

  return res.status(200).json({ options, userId });
}

async function finishRegistration(req, res, body) {
  const { credential, userId } = body;
  if (!credential || !userId) return res.status(400).json({ error: 'credential and userId required' });

  const sql = db();

  // Pull the most recent unexpired challenge for this user
  const challengeRows = await sql`
    SELECT challenge FROM challenges
    WHERE user_id = ${userId} AND type = 'register' AND expires_at > NOW()
    ORDER BY created_at DESC LIMIT 1
  `;
  if (challengeRows.length === 0) return res.status(400).json({ error: 'challenge expired or not found' });
  const expectedChallenge = challengeRows[0].challenge;

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: EXPECTED_ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });
  } catch (e) {
    return res.status(400).json({ error: 'verification failed: ' + (e.message || String(e)) });
  }
  if (!verification.verified) return res.status(400).json({ error: 'verification failed' });

  const regCred = verification.registrationInfo.credential;
  const credentialID = regCred.id;
  const publicKey = regCred.publicKey;
  const counter = regCred.counter;
  const transports = JSON.stringify(credential.response?.transports || []);

  await sql`
    INSERT INTO credentials (id, user_id, public_key, sign_count, transports, created_at, last_used_at)
    VALUES (${credentialID}, ${userId}, ${publicKey}, ${counter}, ${transports}, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          public_key = EXCLUDED.public_key,
          sign_count = EXCLUDED.sign_count,
          transports = EXCLUDED.transports,
          last_used_at = NOW()
  `;

  // Clean up challenges for this user
  await sql`DELETE FROM challenges WHERE user_id = ${userId} AND type = 'register'`;

  // Issue session
  const sessionToken = randomToken();
  await sql`
    INSERT INTO sessions (token, user_id, expires_at)
    VALUES (${sessionToken}, ${userId}, NOW() + INTERVAL '30 days')
  `;

  return res.status(200).json({ sessionToken, userId });
}