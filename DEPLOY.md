# Deploy to Render (free, ~45 min total)

Goal: a public URL your team can click without you keeping your laptop on. Free
tier; cold start is the only catch (~30 s to wake after 15 min idle).

You'll end up with three Render services:
- `numero-postgres` (Postgres database)
- `numero-backend` (FastAPI on `https://numero-backend.onrender.com`)
- `numero-frontend` (React on `https://numero-frontend.onrender.com`)

---

## Step 1 — Export your local data (~2 min)

The deployed app reads the same data you've been clustering locally. Dump it
once into CSVs that get committed alongside the code.

```bash
cd backend
python scripts/export_local.py
```

You should see two new files in `backend/scripts/seed_data/`:
- `users.csv` (~30 MB)
- `cluster_runs.csv` (small)

These are ignored by git's default rules but the `.gitignore` at the root
explicitly **un**-ignores `backend/scripts/seed_data/` so they'll be tracked.

## Step 2 — Init the git repo and push to GitHub (~5 min)

```bash
cd ..
git init
git add .
git commit -m "Initial commit"
```

Create a **private** repo on GitHub (don't pick the "add README" options) and
follow the "push existing repository" instructions GitHub shows you, e.g.:

```bash
git remote add origin https://github.com/YOUR_USERNAME/numero-dashboard.git
git branch -M main
git push -u origin main
```

> **Heads up on data privacy:** the seed CSVs contain customer-level rows. Keep
> the repo private. If your team needs collaborator access, invite them in
> GitHub → Settings → Collaborators.

## Step 3 — Create the Blueprint on Render (~5 min)

1. Go to [https://render.com](https://render.com), sign up (GitHub OAuth is fine).
2. Click **New + → Blueprint**.
3. Connect your GitHub account, pick the repo you just pushed.
4. Render reads `render.yaml` and shows you the three services it'll create.
   Click **Apply**.

The first build takes ~10–15 min (pip install + npm build). The backend will
**fail its first health check** because `CORS_ORIGINS` and the frontend's
`VITE_API_URL` aren't wired up yet — that's normal, we fix it in steps 4–5.

## Step 4 — Wire the frontend to the backend (~2 min)

Once the backend service has a URL (e.g. `https://numero-backend.onrender.com`):

1. Go to **numero-frontend** → **Environment** in the Render dashboard.
2. Add `VITE_API_URL` = `https://numero-backend.onrender.com` (your real URL —
   no trailing slash).
3. Click **Save, rebuild and deploy**. Wait for the rebuild (~3 min).

## Step 5 — Wire CORS on the backend (~2 min)

Once the frontend has a URL (e.g. `https://numero-frontend.onrender.com`):

1. Go to **numero-backend** → **Environment**.
2. Add `CORS_ORIGINS` = `https://numero-frontend.onrender.com`.
3. **Save, rebuild and deploy**. Wait ~3 min.

That's it. Open the frontend URL — it should load the dashboard with your data.

## Step 6 (optional) — Lock the URL to your team (~10 min)

Render doesn't gate the URL by default. Cheapest way to make it private:

1. Sign up for a free [Cloudflare](https://www.cloudflare.com) account.
2. **Cloudflare Zero Trust → Access → Applications → Add an application**.
3. Application type: **Self-hosted**, app domain: your Render frontend URL.
4. Add a policy: include rule **Emails** → list your teammates' emails.
5. Cloudflare emails them a one-time PIN whenever they hit the URL. Free for
   up to 50 users.

---

## Maintenance

- **Pushing code changes** → automatic redeploy on every `git push` to `main`.
- **Cold start** → the free backend sleeps after 15 min idle. The first request
  takes ~30 s. Keep a tab warm if you're demoing live.
- **Re-seeding data** → drop the live `users` table in Render's Postgres
  console, then trigger a new deploy. `seed_from_dump.py` will reload from the
  committed CSVs.

## Things this deploy intentionally skips

- **Smart Query bar (NL → SQL)** is hidden in production via
  `VITE_ENABLE_SMART_QUERY=false`. It needs ChromaDB persistence which Render's
  free tier doesn't provide. Local dev still has it.
- **Redis** isn't used by the dashboard reading flow, so we don't deploy it.
- **`.xlsx` purchase data** stays local — too large to commit, regenerable via
  the original clustering pipeline.
