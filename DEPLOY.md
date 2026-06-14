# 🌸 Dit Shop — Deploy Online

This app is now **deploy-ready**. It runs as a single Node.js service that serves
both the API and the website, using a SQLite database file (no separate database
server needed).

Files added for deployment:
- `.gitignore` / `.dockerignore` — keep secrets, the database, and uploads out of git/images
- `backend/.env.example` — the real settings the app uses (PORT, DB_PATH, JWT_SECRET…)
- `Dockerfile` — run anywhere that supports containers
- `render.yaml` — one-click deploy on Render with a persistent database disk
- `package.json` (root) — lets generic Node hosts build & start from the repo root

---

## Before you deploy — 2 important security steps

1. **Set a strong `JWT_SECRET`.** This signs login tokens. Generate one with:
   ```
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
   (Render's blueprint generates this for you automatically.)

2. **Change the default admin login.** The app seeds an admin account on first run:
   - Username: `Bandit`  ·  Email: `nicklpb1123@gmail.com`  ·  Password: `khamphet`

   Log in once after deploy and change the password (or edit the seed in
   `backend/config/db.js` before first launch). Anyone who knows these can manage your store.

---

## Option A — Render (easiest, recommended)

1. Push this project to a **GitHub** repository.
2. Go to https://render.com → sign up → **New → Blueprint**.
3. Connect your repo. Render reads `render.yaml`, creates the web service, a
   persistent 1 GB disk for the database, and a random `JWT_SECRET`.
4. Click **Apply**. In a few minutes you get a public URL like
   `https://dit-shop.onrender.com`. That's your live site.

> The free plan works but has **no persistent disk** — your database resets on
> each redeploy. The `starter` plan (in `render.yaml`) keeps data on `/data`.

## Option B — Railway

1. Push to GitHub.
2. https://railway.app → **New Project → Deploy from GitHub repo**.
3. Railway auto-detects the `Dockerfile` and builds it.
4. Add a **Volume** mounted at `/data` (keeps the database).
5. Set variables: `JWT_SECRET` (long random string), `DB_PATH=/data/ditshop.sqlite`.
6. Deploy → Railway gives you a public URL.

## Option C — Docker (any server / VPS)

```bash
# build
docker build -t dit-shop .

# run, keeping the database in a named volume so it survives restarts
docker run -d --name dit-shop -p 80:3000 \
  -e JWT_SECRET="paste-a-long-random-string-here" \
  -v ditshop-data:/data \
  dit-shop
```
Your site is then at `http://YOUR_SERVER_IP/`. Put it behind a reverse proxy
(Caddy/Nginx) for HTTPS + a domain name.

## Option D — Generic Node host (Heroku-style)

- Build command: `cd backend && npm install`
- Start command: `cd backend && node server.js`  (or just `npm start` from root)
- Set env var `JWT_SECRET`, and `DB_PATH` to a writable/persistent path.

---

## Data persistence — read this

The app stores two kinds of data **on disk**:

| What | Where | Make it persistent by… |
|------|-------|------------------------|
| Database | `DB_PATH` (default `database/ditshop.sqlite`) | pointing `DB_PATH` at a mounted disk/volume (`/data/ditshop.sqlite`) |
| Uploaded images (cards, payment proofs, message images) | `frontend/img/uploads/…` | a disk mounted at that path, **or** moving to cloud storage (S3, etc.) |

The blueprint/Docker setups above persist the **database**. Uploaded images live
inside the app folder, so on hosts with an ephemeral filesystem they are cleared
on redeploy. For a store handling real payment proofs, mount a disk over
`frontend/img/uploads` or switch uploads to object storage.

## Payment QR

The payment QR shown to buyers is `backend/Qr/qr.jpeg`. Replace it with your own
before going live.

---

## Test locally first

```bash
cd backend
cp .env.example .env        # then edit JWT_SECRET
npm install
npm start                   # → http://localhost:3000
```
The database, tables, admin account, and sample cards are created automatically
on first run — no manual SQL needed.
