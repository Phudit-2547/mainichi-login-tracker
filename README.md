# Mainichi — gacha login tracker

A single-page checklist for daily gacha game logins. Each game resets at its own custom time, not midnight. Sign in with a **passkey** (Face ID / Touch ID / Windows Hello) to sync across devices, or fall back to a **sync code** — any word you pick, copied across devices.

## Stack

- **Frontend:** single static `index.html`, no build step, no external scripts
- **Backend:** Vercel serverless functions in `api/`
- **DB:** Neon serverless Postgres (free tier is enough)

## Streaks & check-in history

Each game stores a `history` array of `YYYY-MM-DD` day keys — the **local calendar date of the daily cycle's start** for every cycle you checked in. The streak counts consecutive days backward from today's cycle (or yesterday's, if you just haven't checked in yet today; miss a full day and it resets to 0). A small "+ yesterday" button on each row (and a toggle in the edit modal) lets you repair a streak if you logged in but forgot to tick the box.

All cycle math runs in the **device's local time zone**. `lastLogin` is still written as a mirror so older cached clients keep working; note that a stale tab running the old code can push a payload without `history` — the sync merge (union of history on pull) limits the damage, and any reload picks up the new code.

## How sync works

Both auth methods address the same server row (`gacha_data`, keyed by a text key):

- **Sync code:** type any word or phrase in the sidebar, copy it to other devices. The code IS the auth — anyone with the code can read/write that row.
- **Passkey:** "Create account" mints an account whose `data_key` is a random key — or, if the device already has a sync code, **the account claims that code**, so your existing data attaches instantly and the code keeps working as a fallback on other devices. "Sign in with passkey" never creates an account; an unknown passkey gets a clear error (this is deliberate — the old auto-register fallback minted duplicate empty accounts). An optional **account name** at creation becomes the passkey's label in your password manager (blank → auto-generated like `calm-river`); it can't be changed after creation because it's baked into the passkey.

The signed-in card always shows which key the account syncs through (`syncing via 86eki`, or `private data key` for a random one). **link sync code** rebinds a signed-in account to any code via `POST /api/claim`: games from the code's row and the account's row are merged (union by id, check-in histories unioned — nothing lost), the old private row is cleaned up, and the code keeps working directly on other devices. Linking a code that belongs to another passkey account is rejected.

Passkey ceremonies are bound to a server-issued `ceremonyId` (single-use challenge). Sessions are 90-day bearer tokens; `/api/sync` accepts either `?device_id=<code>` or `Authorization: Bearer <token>`.

### WebAuthn scoping

Passkeys are scoped to the RP ID (`RP_ID` env var, default `mainichi-login-tracker.vercel.app`). `localhost` is special-cased so `vercel dev` works. Passkeys created on a Vercel *preview* URL cannot work on production — that's a WebAuthn property, use sync codes on previews.

## First-time setup

### 1. Create the Neon database

1. Sign up at https://neon.tech
2. Create a new project (free tier)
3. Copy the connection string (starts with `postgresql://...`)

### 2. Deploy to Vercel

```bash
npm install
npx vercel
```

Then in Vercel dashboard → Settings → Environment Variables, add:

| Key | Value |
|---|---|
| `DATABASE_URL` | your Neon connection string |
| `RP_ID` | *(optional)* your production hostname, if not the default |
| `EXPECTED_ORIGIN` | *(optional)* full https origin, if not `https://$RP_ID` |

Then redeploy:

```bash
npx vercel --prod
```

Schema (including parking any tables left by earlier versions as `*_legacy`) bootstraps automatically on first request.

## Project layout

```
gacha-tracker/
├── index.html               # the app (Things 3 UI, streaks, drag-to-reorder)
├── api/
│   ├── sync.js              # GET/POST /api/sync (sync code or bearer session)
│   ├── passkey-register.js  # begin/finish create-account
│   ├── passkey-login.js     # begin/finish sign-in (never registers)
│   ├── claim.js             # link a sync code to a signed-in account (merge)
│   ├── me.js                # GET session check + linked key, DELETE sign-out
│   └── _lib.js              # DB, schema bootstrap, sessions, challenges
├── package.json
└── README.md
```

## Local dev

```bash
npm install
DATABASE_URL='postgresql://...' npx vercel dev
```

Then open http://localhost:3000. Passkeys work on localhost (browsers treat it as a secure context).
