# Mainichi — gacha login tracker

A single-page checklist for daily gacha game logins. Each game resets at its own custom time, not midnight. Syncs across devices via **passkey** (no codes to copy).

## Stack

- **Frontend:** single static `index.html` + `@simplewebauthn/browser` from CDN
- **Backend:** Vercel serverless functions in `api/`
- **DB:** Neon serverless Postgres (free tier is enough)
- **Auth:** WebAuthn passkey (discoverable credentials — syncs via iCloud Keychain / Google Password Manager)

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

Then redeploy:

```bash
npx vercel --prod
```

### 3. Sign in on each device

Open the deployed URL. Click **Sign in** in the sidebar. Your browser will prompt for biometric (Face ID / Touch ID / Windows Hello). First device registers a new passkey; subsequent devices sign in with the same passkey — it syncs automatically via iCloud Keychain (Apple) or Google Password Manager (Android/Chrome).

## How sync works

- Your data is keyed by `user_id`, not device. Server stores one row per user.
- Sessions are JWT-less random tokens stored in `localStorage` and sent as `Authorization: Bearer ...` on every request.
- On any change → debounced push (400ms). On load and tab focus → pull.
- Sign out → token cleared, local data stays.

## Migrating from the old sync-code flow

If you had data on the old memorable code or UUID model, that data lives in a `gacha_data_legacy` table after this update. When you sign in with passkey for the first time, you'll see a "claim data" prompt in the sidebar with your old code — one click to copy that data to your new account. The legacy row is deleted afterward.

## Project layout

```
gacha-tracker/
├── index.html         # the app (passkey UI, drag-to-reorder, etc.)
├── api/
│   ├── _lib.js          # shared DB + crypto helpers
│   ├── passkey-register.js   # POST begin/finish registration
│   ├── passkey-login.js      # POST begin/finish authentication
│   ├── me.js                  # GET current session info
│   ├── sync.js                # GET/POST data sync (session-auth)
│   └── claim.js               # POST legacy data claim
├── package.json
└── README.md
```

## Local dev

```bash
npm install
DATABASE_URL='postgresql://...' npx vercel dev
```

Then open http://localhost:3000. WebAuthn works on `localhost` without HTTPS.