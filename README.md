# Mainichi — gacha login tracker

A single-page checklist for daily gacha game logins. Each game resets at its own custom time, not midnight. **Sync across your devices by picking any sync code you want** — type it once, copy it to your other devices, all devices with the same code share data.

## Stack

- **Frontend:** single static `index.html`, no build step, no external scripts
- **Backend:** one Vercel serverless function in `api/sync.js`
- **DB:** Neon serverless Postgres (free tier is enough)

## How sync works

1. Type any word or phrase in the sidebar — e.g. `86eki`, `phudit-laptop`, `happy-tiger`
2. Hit "use this code"
3. Click the code (or "copy") to copy it
4. Open the site on another device, paste the same code, done — both devices share data

The code IS the auth. Anyone with the code can read/write that row. Don't use a guessable code if your Neon DB is public.

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

## Project layout

```
gacha-tracker/
├── index.html         # the app (Things 3-inspired UI, drag-to-reorder, etc.)
├── api/
│   └── sync.js          # GET/POST /api/sync
├── package.json
└── README.md
```

## Local dev

```bash
npm install
DATABASE_URL='postgresql://...' npx vercel dev
```

Then open http://localhost:3000.