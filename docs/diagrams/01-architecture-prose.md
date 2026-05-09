# §4.1 Architectural Design — rewritten prose

> Drop-in replacement for the current §4.1 in Chapter 4. Keeps the existing
> sub-headings (4.1.1 – 4.1.6) but rewrites each so that every box on the
> diagram has a matching paragraph and every paragraph names a real
> technology choice we made.

## 4.1 Architectural Design

The system follows a **service-oriented layered architecture** organised
around four cooperating services backed by a shared data tier and connected
to three external APIs. The design separates the *online plane* — where every
component is reached over HTTP at request time — from the *offline plane*,
which contains the periodic machine-learning workflow that produces the
clustering assignments and reactivation scores. Figure 2 shows the complete
runtime topology, with deployment containers, communication protocols, and
external dependencies labelled explicitly.

The overall principle is one of **clear ownership and loose coupling**. Each
service has a single responsibility, owns the resources it needs, and
communicates with the rest of the system only through well-defined HTTP
interfaces. PostgreSQL is owned exclusively by the Dashboard Backend; the
WhatsApp Gateway and Reply AI never touch the database directly. The two
artificial-intelligence sub-systems present in the project — Vanna for
natural-language SQL inside the Dashboard Backend, and the conversational
Reply AI service for WhatsApp replies — are independent: they use different
large-language-model providers (Google Gemini and Groq respectively),
maintain separate ChromaDB vector stores with different training corpora,
and never share code or data. This isolation is deliberate and provides
both failure containment and the ability to choose the best-suited model
for each task.

> **Figure 2a.** Online runtime architecture of the Dormant User
> Reactivation System. Solid boxes are services we built; dashed boxes
> are external third-party APIs. Figure 2b on the next page shows the
> companion offline machine-learning pipeline and its closing feedback
> arrow back to the live system.

> **Figure 2b.** Offline ML pipeline. The clustering and reactivation
> notebooks are re-run manually by the data team when Numero exports a
> fresh purchase snapshot. Three idempotent ingest scripts (`seed.py`,
> `ingest_reactivation_scores.py`, `train_vanna.py`) are the only
> bridge between the offline plane and the live runtime, and the
> dashed arrow from PostgreSQL back to "Numero purchase exports"
> represents the human-in-the-loop step that closes the feedback loop.

### 4.1.1 Data Sources

The pipeline begins with two raw data exports from Numero eSIM, supplied as
Excel and Parquet files (`Numero eSIM_purchases [2024–2025]`): a transaction
table covering ~830 K purchases and a registered-but-non-buyer table of
prospective customers. Both are read-only inputs; all transformations happen
downstream in the offline notebooks.

### 4.1.2 Data Processing Pipeline (offline plane)

Two Jupyter notebooks form the offline machine-learning pipeline:

* `notebooks/clustering/` — performs per-product KMeans clustering followed
  by a 2-component PCA projection for visualisation, producing one CSV per
  product group (`Client_Calls_Clustered.csv`, `Client_eSIM_Clustered.csv`,
  `Client_Virtual_Clustered.csv`).
* The reactivation notebook (`cluster-reactivation-pipelines-v2.ipynb`)
  trains a Random Forest classifier on engineered behavioural features and
  emits `dormant_customers_scored.csv` plus the serialised model
  (`reactivation_model.pkl`).

Three idempotent ingest scripts move the artefacts into the live system:
`backend/scripts/seed.py` rebuilds the `users` table from the clustered
CSVs, `ingest_reactivation_scores.py` updates the `reactivation_score`
column from the scored CSV, and `train_vanna.py` re-indexes the Vanna
training corpus into ChromaDB. The pipeline is currently triggered manually
by the data team; automating retraining on a schedule is identified as the
primary future-work item (see Chapter 8).

### 4.1.3 Analytics and Modeling Layer

Analytical workloads are split across the online and offline planes
according to their latency requirements. The Dashboard Backend serves
descriptive analytics (KPIs, segment cards, cluster-scatter coordinates,
reactivation cutoffs) at request time directly from PostgreSQL, with Redis
caching for the heavier endpoints. Predictive modelling — both
unsupervised segmentation and supervised reactivation scoring — is
batch-only and lives entirely offline; the dashboard consumes its outputs
as pre-materialised columns on the `users` table. Decoupling predictions
from serving keeps response times in the millisecond range and allows the
ML pipeline to be re-run without affecting dashboard availability.

### 4.1.4 Data Storage Layer

Three distinct storage technologies are used, each chosen for the workload
it serves:

* **PostgreSQL 15** is the single source of truth for user, campaign and
  campaign-recipient data. It is run in a Docker container and accessed
  only by the Dashboard Backend through SQLAlchemy's async driver
  (`asyncpg`).
* **Redis 7**, also containerised, caches expensive analytics responses
  (chiefly the per-product PCA scatter payload).
* **ChromaDB** is used in two independent embedded instances — one inside
  the Dashboard Backend for Vanna's NL→SQL training corpus, and a separate
  one inside Reply AI for the conversational RAG corpus — confirming the
  isolation between the two AI sub-systems.

### 4.1.5 Presentation Layer

The Dashboard Frontend is a single-page React application built with Vite,
served on port 5173 in development. Recharts handles the standard KPI and
distribution charts; the cluster scatter is rendered separately with
`regl-scatterplot`, a WebGL library capable of drawing the largest panel
(~205 K dots for Virtual Number users) at interactive frame rates. Global
filter state is held in a React context (`QueryFilterContext`) which
broadcasts changes to every panel so they re-fetch in parallel.

### 4.1.6 Conversational AI Sub-systems

The system contains two distinct conversational interfaces, each
implemented as a separate AI sub-system with its own purpose, model
provider and vector store:

**Smart Query (analyst-facing).** Embedded inside the Dashboard Backend as
the `vanna_gemini` module, this sub-system uses the open-source Vanna
framework with a custom training corpus consisting of the database DDL,
fifty-two example question/SQL pairs, and concise definitions of every
segment and reactivation state. At query time, Vanna retrieves the most
relevant examples from its ChromaDB index and asks Google Gemini to
synthesise SQL for the analyst's natural-language question; the SQL is
then executed against PostgreSQL and the result returned to the dashboard.

**Reply AI (customer-facing).** A standalone Python service (`reply-ai/`,
port 5000) invoked by the WhatsApp Gateway whenever a dormant user replies
to a campaign. Its `rag.py` module indexes Numero's offer catalogue and
policy documents (`wa-gateway/knowledge/`) into its own ChromaDB instance;
`bot.py` orchestrates each turn by retrieving relevant context, prompting
the Groq LLM to generate a reply, and returning it to the gateway for
delivery. Per-user conversation history is stored as one JSON file per
user under `reply-ai/data/users/`, keeping each session self-contained
without requiring an additional database connection.

Offer selection itself happens earlier, at **campaign build time** in the
dashboard's Campaign Builder page, where the `matchOffer()` helper maps
the chosen audience (segment, product, recency) to a promo code which
the analyst can then accept or override. The chosen code is persisted on
the `Campaign` row and reused at send time and in any subsequent reply,
so the offer the user sees is decided once and remains consistent across
the campaign and the conversation.

### 4.1.7 WhatsApp Delivery Layer

The WhatsApp Gateway (`wa-gateway/`) is a Node.js / Express service on
port 3000 that bridges the dashboard to Meta's WhatsApp Cloud API. It has
two responsibilities:

* **Outbound campaign sending.** A 60-second cron loop polls
  `GET /api/campaigns?status=queued` on the Dashboard Backend, fans the
  resulting recipient list out as messages through Meta's Graph API, and
  reports each `sent` event back via `POST /api/campaigns/{id}/recipients`.
* **Inbound webhook handling.** A webhook endpoint receives delivery,
  read, reply and conversion events from Meta, forwards each to
  `PATCH /api/campaigns/recipients/event` so the dashboard can update
  per-recipient lifecycle state, and — for genuine user replies —
  delegates to Reply AI to compose a response.

In the current development configuration the gateway runs in
`WA_DEV_MODE=true`, which restricts sending to plain-text messages within
Meta's 24-hour customer-service window; production cold-outbound requires
template approval from Meta and flipping the mode flag. This is an
operational gate, not an architectural one.

### Continuity and the campaign-outcome feedback loop

The system is designed to support continuity between marketing actions
and predictive scores, but the loop is closed in two stages with
different levels of automation. The **inner loop** is automated end-to-end:
campaign messages sent through the gateway produce delivery, read, reply
and conversion events that flow back into the `campaign_recipients`
table within seconds, and the dashboard's reactivation funnel reflects
them in real time. The **outer loop** — feeding those outcomes back into
the reactivation model itself — is currently manual: when Numero exports
fresh purchase data (which already reflects any post-campaign
conversions), the data team re-runs the clustering and reactivation
notebooks and re-runs the ingest scripts to refresh
`users.reactivation_score`. The dashed feedback arrow in Figure 2
represents this human-in-the-loop step. Closing it with a scheduled
retraining job is the primary automation candidate identified in
Chapter 8.
