# §4.3.2 Database Design — rewritten prose

> Drop-in replacement for the current §4.3.2 *Database Design* in
> Chapter 4. The previous version described a conceptual OLAP star
> schema; the implementation is a normalised relational schema, so
> this section now matches the code.

## 4.3.2 Database Design

The persistence layer is a single **PostgreSQL 15** database owned
exclusively by the Dashboard Backend. The schema is *normalised
relational* rather than star-schema OLAP — a deliberate change from
the design proposed in GP2. We made the change because the analytical
workloads we actually built (membership-based filtering, per-product
KPIs, campaign funnel rollups) are served well by indexed queries
against a wide `users` table, while the cost of maintaining a separate
fact/dimension layer would not be repaid at the scale of a single-tenant
dashboard. The full physical schema is shown in **Figure X**, generated
directly from `backend/models.py`.

### Tables

The schema contains four tables grouped into two functional areas:

**Customer state (1 table)**

* `users` — one row per Numero customer. Carries the raw demographic
  and behavioural columns ingested from the clustered CSVs, plus
  pre-computed analytical columns (per-product spend / frequency /
  recency / AOV / velocity / gap), per-product KMeans cluster
  assignments and 2-D PCA coordinates for the cluster scatter, the
  primary-product summary used by the segment cards, and the
  reactivation score and WhatsApp delivery metadata. The wide,
  partially-denormalised shape is intentional: it lets the dashboard
  serve any single-user query with one indexed lookup and any
  aggregate query with at most one `GROUP BY` over a single table.
  See `backend/models.py:User` for the canonical column list.

**Campaign delivery (3 tables)**

* `campaigns` — one row per built campaign. Stores the offer code,
  message template, the audience-filter snapshot captured at send
  time (segment, product, country, recency range, spend range, etc.),
  and the lifecycle status (`draft → queued → sending → sent →
  completed`). The five `*_count` columns at the bottom are
  denormalised funnel rollups maintained by the recipient-event
  handler.
* `campaign_recipients` — one row per `(campaign × user)` pair. Holds
  the per-user lifecycle (`sent → delivered → read → replied →
  converted | failed`) and one timestamp per state transition. This is
  the table the WhatsApp Gateway writes to via the backend's
  `POST /api/campaigns/{id}/recipients` endpoint, and the
  `PATCH /api/campaigns/recipients/event` endpoint re-aggregates the
  parent campaign's funnel counts every time a row here changes.
* `cluster_runs` — append-only audit log of clustering runs.
  Captures the algorithm used, feature list, centroids, and
  per-cluster summary statistics in JSONB columns. Has no foreign
  keys — a pure historical record so we can inspect or roll back to
  any prior clustering when retraining.

### Relationships and indexes

Two foreign-key relationships connect the campaign tables, **enforced
at the database level** by Postgres `FOREIGN KEY` constraints:

* `campaign_recipients.campaign_id → campaigns.id`  (N : 1, `ON DELETE CASCADE`)
* `campaign_recipients.user_id     → users.id_client`  (N : 1, default `RESTRICT`)

The cascade on `campaign_id` lets us delete a test or aborted campaign
without leaving orphaned recipient rows. The default `RESTRICT` on
`user_id` is intentional: customers are never deleted, so the
constraint also serves as a guard against accidentally dropping a
`users` row that still has campaign history attached to it.

Postgres does **not** automatically create an index on the referencing
column when a foreign key is declared, so both `campaign_id` and
`user_id` carry an explicit `index=True` in the SQLAlchemy model
(shown as `FK·IDX` in Figure X). Within `users`, five columns also
carry indexes because they are the hot filter dimensions for the
dashboard: `primary_product_group`, `cluster_id`, `segment`,
`platform`, and `language`. `wa_message_id` on `campaign_recipients`
is indexed because Meta webhooks identify recipients by message id,
not user id.

### Schema-vs-code gap (honest)

Two columns on `users` — `last_campaign_at` and `campaigns_sent` —
are defined and migrated but not currently written by application code
(see Figure X, marked with ⚠). The information is fully recoverable
from `campaign_recipients`, so the columns are intended as
denormalised query accelerators rather than the source of truth; the
write path will be added when the Reports page introduces a "users
contacted in the last N days" filter that warrants the de-normalisation.
This is documented in §X *Future Work*.

### Why not the OLAP star originally proposed

The original GP2 design (Figure 8) showed a conceptual star schema
with a central fact table and product / time / segment dimension
tables. We departed from this for three reasons. First, the analytical
workloads we identified during implementation are dominated by
**single-row lookups** (the user table) and **flat aggregations**
(GROUP BY on indexed columns) — neither benefits meaningfully from a
star layout. Second, per-product cluster information is naturally
**per-customer** (a user can buy in 1, 2 or 3 product groups with a
distinct cluster in each), so projecting it through a product
dimension would either lose information or require multiple fact rows
per user. Third, the operational simplicity of a single normalised
schema — one place for migrations, one set of indexes, no ETL between
operational and analytical layers — is appropriate for the data volume
(~278 K users, ~830 K source transactions) and single-tenant
deployment we are designing for.
