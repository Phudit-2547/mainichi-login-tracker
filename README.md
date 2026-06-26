# Gacha Tracker

A single-page checklist for daily gacha game logins. Each game resets at its own custom time, not midnight. Syncs across devices via Neon Postgres.

## Stack

- **Frontend:** single static `index.html` (no build step)
- **Backend:** Vercel serverless function at `api/sync.js`
- **DB:** Neon serverless Postgres (free tier is enough)

## First-time setup

### 1. Create the Neon database

1. Sign up at https://neon.tech
2. Create a new project (free tier is fine)
3. From the dashboard, copy the connection string — it looks like:
   ```
   postgresql://username:password@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
   ```

### 2. Deploy to Vercel

From this directory:

```bash
npm install
npx vercel
```

When prompted, accept the defaults. After the first deploy:

1. Go to the Vercel dashboard → your project → **Settings** → **Environment Variables**
2. Add `DATABASE_URL` with the Neon connection string from step 1
3. Redeploy: `npx vercel --prod`

### 3. Use it on multiple devices

1. Open the deployed URL on device A
2. Look in the sidebar under **Sync** — copy the code (e.g. `a1b2c3d4-…`)
3. On device B, open the same URL, then click **"use a different code"** and paste the code
4. Both devices now share the same data

The status dot in the sidebar shows:
- 🟢 **synced** — last save made it to Neon
- 🟡 **syncing** — save in flight
- 🔴 **offline** — couldn't reach the server (data still in localStorage, will retry)

## How sync works

- Every save to `localStorage` schedules a debounced push (400ms) to Neon.
- On load and on tab focus, the app pulls from Neon and overwrites local state with whatever the server has.
- The "sync code" is a UUID generated client-side. Whoever knows it can read/write that row. Good enough for personal use — not real auth.

## Project layout

```
gacha-tracker/
├── index.html         # the app
├── api/
│   └── sync.js        # GET/POST /api/sync
├── package.json
└── .gitignore
```

## Local dev

```bash
npm install
DATABASE_URL='postgresql://...' npx vercel dev
```

Then open http://localhost:3000.
