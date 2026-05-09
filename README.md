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

## Project layout (monorepo, four services)

```
backend/                 Dashboard Backend — FastAPI :8000
  main.py                FastAPI app (CORS, gzip middleware, lifespan)
  models.py              SQLAlchemy User / Campaign / CampaignRecipient
  filter_helpers.py      build_where + aggregate_columns (membership semantics)
  vanna_gemini.py        Vanna adapter (ChromaDB + Gemini) — Smart Query NL→SQL
  routers/
    users.py             /api/users/...
    analytics.py         /api/analytics/... (KPIs, cutoffs, breakdown)
    segmentation.py      /api/segmentation/... (segment cards)
    clusters.py          /api/clusters/... (cluster scatter, /pca)
    campaigns.py         /api/campaigns/... (called by wa-gateway too)
    query.py             /api/query/  (Smart Query)
    exports.py           /api/exports/...
  scripts/
    seed.py                          Drop + repopulate users from CSVs
    ingest_reactivation_scores.py    Update reactivation_score from a CSV
    train_vanna.py                   Train/retrain Vanna
  data/clustered/        Per-product clustered CSVs (input to seed)
  data/scores/           Reactivation score CSV + RF model pickle

frontend/                Dashboard Frontend — React/Vite :5173
  src/
    pages/        Dashboard | DormantUsers | Reports | Campaigns | Settings
    components/   ClusterScatter | UserTable | GlobalFilterBar | etc.
    context/      QueryFilterContext  (global filter state, segment auto-sync)
    api.js        Axios endpoints

wa-gateway/              WhatsApp Gateway — Node/Express :3000
  server.js              Meta Cloud API webhook receiver (delivery / reply events)
  index.js               Cron sender — polls backend every 60s for queued campaigns
  knowledge/             Markdown knowledge base (seed for reply-ai's RAG)
  data/conversations/    Local message logs (gitignored)

reply-ai/                Reply AI — Python/FastAPI :5000
  main.py                HTTP entry; called by wa-gateway when a user replies
  bot.py                 Orchestrator — calls offer selector + reply generator
  offers.py              Rule-based offer selector (NOT AI — deterministic table)
  rag.py                 Builds ChromaDB vector index over wa-gateway/knowledge/
  ingest.py              Re-index entry point
  users.py               JSON-file storage for per-user chat history
  data/offers.json       Promo code definitions
  data/segments.json     Segment metadata
  chroma_db/             Vector store (gitignored — rebuild via `python ingest.py`)

notebooks/clustering/    Offline ML — KMeans + PCA per product
                         (output: backend/data/clustered/*.csv)
```

### Service interactions

```
Browser ──HTTPS──> Frontend ──HTTP──> Backend ──SQL──> Postgres
                                        │
                                        ├─Vanna+Gemini── Smart Query NL→SQL
                                        │
                                        └──── Redis (cache)

wa-gateway ──HTTP──> Backend       (poll queued campaigns, post events)
wa-gateway ──HTTPS─> Meta WA API   (send messages, receive webhooks)
wa-gateway ──HTTP──> reply-ai      (when a user replies, get an LLM reply)
reply-ai   ──HTTPS─> Groq          (chat reply generation)
```

The two AI sub-systems (Vanna inside Backend; Reply AI as its own service) are
**fully independent** — different LLMs (Gemini vs Groq), different vector
stores, different training corpora, no shared code or data.

### What's automated vs manual

- **Live loop:** campaign send → Meta delivery/read/reply events → Backend
  updates `campaign_recipients.status` and aggregate `Campaign.*_count`.
- **Manual loop:** user converts → purchase appears in Numero prod data →
  team re-runs the clustering + reactivation notebooks → re-runs `seed.py` and
  `ingest_reactivation_scores.py` → `users.reactivation_score` updated.
  Closing this loop with a scheduled retrain is the primary future-work item.
