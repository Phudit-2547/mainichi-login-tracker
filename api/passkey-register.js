// Passkey registration — follows the canonical pattern from
// https://github.com/MasterKale/SimpleWebAuthn/blob/master/example/index.ts
//
// Two stages:
//   POST { stage: 'begin' }                  → server creates a user + calls
//                                              generateRegistrationOptions,
//                                              returns the options
//   POST { stage: 'finish', credential, userId } → verify, persist credential,
//                                                  issue session token
//
// Cross-device sync works because the user_id (UUID) we generate here is
// turned into a userHandle by the library and embedded in the passkey.
// Passkeys synced via iCloud Keychain / Proton Pass / Google Password
// Manager carry the same userHandle, so the same userId is recovered on
// every device that authenticates.

import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { cors, db, ensureSchema, readJsonBody, randomToken, suggestUsername, RP_ID, RP_NAME, EXPECTED_ORIGIN } from './_lib.js';

// Convert a UUID string to the 16 raw bytes the WebAuthn user handle expects.
function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
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

  const body = await readJsonBody(req);
  if (!body) return res.status(400).json({ error: 'invalid JSON body' });

  const { stage } = body;
  if (stage === 'begin') return await beginRegistration(req, res, body);
  if (stage === 'finish') return await finishRegistration(req, res, body);
  return res.status(400).json({ error: 'invalid stage' });
}

async function beginRegistration(req, res, body) {
  const sql = db();

  // Fresh identity per registration. This UUID is the user's permanent ID
  // in our DB and is what gets baked into the passkey as the userHandle.
  const userId = crypto.randomUUID();
  const userIdBytes = uuidToBytes(userId);

  const supplied = body.username && String(body.username).trim();
  const username = (supplied && supplied.length >= 3 && supplied.length <= 30)
    ? supplied
    : suggestUsername();

  // Create the user row up front so the credential FK will resolve.
  await sql`INSERT INTO users (id, username) VALUES (${userId}, ${username})`;

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: userIdBytes,
    userName: username,
    authenticatorSelection: {
      residentKey: 'required',  // discoverable — survives cross-device sync
      userVerification: 'preferred',
    },
  });

  // Persist the library-generated challenge (already base64url-encoded).
  await sql`
    INSERT INTO challenges (challenge, user_id, type, expires_at)
    VALUES (${options.challenge}, ${userId}, 'register', NOW() + INTERVAL '5 minutes')
  `;

  return res.status(200).json({ options, userId });
}

async function finishRegistration(req, res, body) {
  const { credential, userId } = body;
  if (!credential || !userId) {
    return res.status(400).json({ error: 'credential and userId required' });
  }

  const sql = db();

  // Pull the most recent unexpired register challenge for this user.
  const challengeRows = await sql`
    SELECT challenge FROM challenges
    WHERE user_id = ${userId} AND type = 'register' AND expires_at > NOW()
    ORDER BY created_at DESC LIMIT 1
  `;
  if (challengeRows.length === 0) {
    return res.status(400).json({ error: 'challenge expired or not found' });
  }
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

  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ error: 'verification failed' });
  }

  const regCred = verification.registrationInfo.credential;
  const credentialID = regCred.id;          // base64url string
  const publicKey = regCred.publicKey;       // Uint8Array
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

  await sql`DELETE FROM challenges WHERE user_id = ${userId} AND type = 'register'`;

  const sessionToken = randomToken();
  await sql`
    INSERT INTO sessions (token, user_id, expires_at)
    VALUES (${sessionToken}, ${userId}, NOW() + INTERVAL '30 days')
  `;

  return res.status(200).json({ sessionToken, userId });
}