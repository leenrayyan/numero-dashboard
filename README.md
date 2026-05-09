# Numero — Dormant Users Reactivation Engine

Customer reactivation dashboard for Numero eSIM. Combines per-product
behavioural clustering with a global reactivation-likelihood model to identify
which dormant users are worth a marketing campaign.

## Stack

- **Backend**: FastAPI + SQLAlchemy (async, asyncpg) + Postgres + Redis. Vanna
  + ChromaDB + Gemini for the natural-language Smart Query bar.
- **Frontend**: React + Vite + Tailwind. Recharts for most charts; the
  Cluster Map uses regl-scatterplot (WebGL) to render up to 200K dots.
- **Data**: ~278K users derived from ~830K purchase transactions. Clustering
  is per-product (Calls / Data eSIM / Virtual Number) and lives in offline
  notebooks; the dashboard ingests pre-clustered CSVs.

## First-time setup

```bash
# 1. Bring up Postgres + Redis
docker compose up -d postgres redis

# 2. Install backend deps
cd backend && pip install -r requirements.txt -r requirements-dev.txt

# 3. Install frontend deps
cd frontend && npm install

# 4. Configure env vars
cp .env.example .env   # edit GEMINI_API_KEY, paths, etc.

# 5. Seed the DB from the per-product clustered CSVs
cd backend && python scripts/seed.py

# 6. Train Vanna for Smart Query
cd backend && python scripts/train_vanna.py --reset

# 7. Ingest reactivation scores
#    The CSV produced by the team's notebook is committed at
#    backend/data/scores/dormant_customers_scored.csv — running the script
#    with no args picks it up automatically.
cd backend && python scripts/ingest_reactivation_scores.py
```

## Running locally

```bash
# Terminal 1 — backend
cd backend && uvicorn main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend && npm run dev
```

Open http://localhost:5173.

## How filtering works (important conceptual model)

We use **product membership**, not "primary product", everywhere except a few
display-only edges. "Filter by Calls" means "any user with Calls activity",
not "user whose top-spend product is Calls". This matches industry convention
(Mixpanel, Amplitude, Segment.com) and matches what the cluster scatter shows.

When **exactly one** product is filtered, KPI/aggregate columns swap to the
per-product variants (`calls_recency`, `calls_spent`, `calls_aov`, etc.) so
"Calls customers active in the last 30 days" means activity *on Calls* — not
activity in any product. When zero or 2+ products are filtered, global
columns are used.

See `backend/filter_helpers.py:build_where()` for the implementation.

## Reactivation model

The team retrains in `cluster-reactivation-pipelines-v2.ipynb` and exports
two artifacts:

- `dormant_customers_scored.csv` — per-user reactivation probabilities
- `reactivation_model.pkl` — the trained Random Forest, in case you ever
  want to re-score from new transaction data without retraining

Both live in the repo at **`backend/data/scores/`** so a fresh checkout
already has everything needed. To pick up a NEW retraining run, drop the
new CSV in that folder (or anywhere else) and run:

```bash
cd backend
python scripts/ingest_reactivation_scores.py                          # default path
python scripts/ingest_reactivation_scores.py /path/to/some/other.csv  # override
```

The script:
1. Sets every existing `users.reactivation_score` to NULL.
2. UPDATEs each scored user with their probability (0–1).
3. Prints the percentile cutoffs the dashboard will use (HIGH = top 20%,
   MEDIUM = next 30%, LOW = bottom 50%).

The dashboard's `/api/analytics/reactivation-cutoffs` endpoint computes those
cutoffs live so they always reflect the current distribution — no need to
persist them. Re-ingest with new scores → cutoffs auto-update.

### Three reactivation states (badge colours in the user table)

| State | Meaning | Badge |
|---|---|---|
| Active | recency < 90d | green pill "Active" |
| Dormant + scored, top 20% | recency ≥ 90d, score ≥ p80 | green % "HIGH" |
| Dormant + scored, next 30% | recency ≥ 90d, p50 ≤ score < p80 | amber % "MEDIUM" |
| Dormant + scored, bottom 50% | recency ≥ 90d, score < p50 | rose % "LOW" |
| Dormant + unscored | recency ≥ 90d, score = NULL | grey pill "Dormant" |

The "Dormant" grey pill is for one-time buyers the model couldn't score
(insufficient purchase history). They're factually dormant; the model
just doesn't have enough signal to rank them.

## Cluster map

Per-product PCA coordinates are pre-computed in the offline clustering
notebook and stored in the `users` table (`calls_pc1/pc2`, `esim_pc1/pc2`,
`virtual_pc1/pc2`). The `/api/clusters/pca` endpoint serves them with an
in-memory cache + gzip + browser `Cache-Control: max-age=300`. First load is
~5–7s for the largest panel (Virtual, ~205K dots); warm hits ~250ms.

Pan & zoom is OFF by default (matches the notebook's static view). Toggle
the checkbox in the panel header to enable drag-to-pan / scroll-to-zoom; axis
tick numbers update live as the camera moves.

## Smart Query (Vanna)

Natural-language → SQL → results. Ask things like:

- "How many Calls customers do we have?"
- "Top 10 reactivation candidates"
- "Calls customers active in the last 30 days"
- "Average reactivation score per segment"
- "Show users who buy all three product types"

Training corpus lives in `backend/scripts/train_vanna.py` (DDL, docs, ~52 Q/A
pairs). Re-run with `--reset` after schema changes.

## Project layout

```
backend/
  main.py               # FastAPI app (CORS, gzip middleware, lifespan)
  models.py             # SQLAlchemy User / Campaign / etc.
  filter_helpers.py     # build_where + aggregate_columns (membership semantics)
  vanna_gemini.py       # Vanna adapter (ChromaDB + Gemini)
  routers/
    users.py            # /api/users/...
    analytics.py        # /api/analytics/... (KPIs, cutoffs, breakdown)
    segmentation.py     # /api/segmentation/... (segment cards)
    clusters.py         # /api/clusters/... (cluster scatter, /pca)
    campaigns.py        # /api/campaigns/...
    query.py            # /api/query/  (Smart Query NL → SQL)
    exports.py          # /api/exports/...
  scripts/
    seed.py                          # Drop + repopulate users from CSVs
    ingest_reactivation_scores.py    # Update reactivation_score from a CSV
    train_vanna.py                   # Train/retrain Vanna
  data/clustered/       # Per-product clustered CSVs (input to seed)

frontend/
  src/
    pages/        Dashboard | DormantUsers | Reports | Campaigns | Settings
    components/   ClusterScatter | UserTable | GlobalFilterBar | etc.
    context/      QueryFilterContext  (global filter state, segment auto-sync)
    api.js        Axios endpoints
```
