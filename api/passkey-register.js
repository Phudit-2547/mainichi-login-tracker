// Passkey registration — explicit "Create account" only; sign-in never
// falls through to here.
//
//   POST { stage: 'begin', syncCode? }                    → { options, ceremonyId }
//   POST { stage: 'finish', ceremonyId, credential }      → { sessionToken, username }
//
// The user row is created at `finish`, after verification succeeds, so an
// abandoned or failed prompt leaves nothing behind (the old version created
// duplicate empty accounts at `begin`).
//
// If the device already uses a sync code, `begin` may carry it: the new
// account claims that code as its data_key, so existing data attaches
// instantly and the code keeps working as a fallback on other devices.

import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import {
  cors, db, ensureSchema, readJsonBody, rpConfig, RP_NAME,
  storeChallenge, consumeChallenge, issueSession, randomToken,
  isValidSyncCode, suggestUsername,
} from './_lib.js';

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

  try {
    if (body.stage === 'begin') return await begin(req, res, body);
    if (body.stage === 'finish') return await finish(req, res, body);
  } catch (e) {
    console.error('[passkey-register]', e);
    return res.status(500).json({ error: e.message || String(e) });
  }
  return res.status(400).json({ error: 'invalid stage' });
}

async function begin(req, res, body) {
  const sql = db();

  let syncCode = null;
  if (body.syncCode != null && body.syncCode !== '') {
    if (!isValidSyncCode(body.syncCode)) {
      return res.status(400).json({ error: 'invalid sync code' });
    }
    syncCode = body.syncCode;
    const taken = await sql`SELECT id FROM users WHERE data_key = ${syncCode} LIMIT 1`;
    if (taken.length > 0) {
      return res.status(409).json({
        error: 'That sync code already belongs to a passkey account — use "Sign in with passkey" instead.',
      });
    }
  }

  const userId = crypto.randomUUID();
  // Optional user-chosen name — it becomes the passkey's label in the
  // password manager, so it can't be changed after creation.
  const supplied = typeof body.username === 'string' ? body.username.trim() : '';
  const username = (supplied.length >= 3 && supplied.length <= 30) ? supplied : suggestUsername();
  const { rpID } = rpConfig(req);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: uuidToBytes(userId),
    userName: username,
    authenticatorSelection: {
      residentKey: 'required', // discoverable — works across the user's devices
      userVerification: 'preferred',
    },
  });

  const ceremonyId = await storeChallenge('register', options.challenge, {
    userId,
    username,
    dataKey: syncCode,
  });

  return res.status(200).json({ options, ceremonyId });
}

async function finish(req, res, body) {
  const { ceremonyId, credential } = body;
  if (!credential || !credential.id) {
    return res.status(400).json({ error: 'credential required' });
  }

  const row = await consumeChallenge('register', ceremonyId);
  if (!row) return res.status(400).json({ error: 'challenge expired — try again' });
  const meta = typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta;
  const { rpID, origin } = rpConfig(req);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: row.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (e) {
    return res.status(400).json({ error: 'verification failed: ' + (e.message || String(e)) });
  }
  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ error: 'verification failed' });
  }

  const sql = db();
  const dataKey = meta.dataKey || 'pk-' + randomToken();
  try {
    await sql`INSERT INTO users (id, username, data_key) VALUES (${meta.userId}, ${meta.username}, ${dataKey})`;
  } catch (e) {
    // unique violation: the sync code was claimed between begin and finish
    return res.status(409).json({
      error: 'That sync code already belongs to a passkey account — use "Sign in with passkey" instead.',
    });
  }

  const regCred = verification.registrationInfo.credential;
  await sql`
    INSERT INTO credentials (id, user_id, public_key, sign_count, transports, created_at, last_used_at)
    VALUES (
      ${regCred.id},
      ${meta.userId},
      ${Buffer.from(regCred.publicKey).toString('base64url')},
      ${regCred.counter},
      ${JSON.stringify(credential.response?.transports || [])},
      NOW(), NOW()
    )
  `;

  const sessionToken = await issueSession(meta.userId);
  return res.status(200).json({ sessionToken, username: meta.username, dataKey });
}
