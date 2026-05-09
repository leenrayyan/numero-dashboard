"""
Train Vanna on the current schema.
Run AFTER seed.py.

Usage:
  python scripts/train_vanna.py            # additive -- adds DDL + Q/A pairs to existing Chroma store
  python scripts/train_vanna.py --reset    # nukes chroma_db/ first, then trains from scratch (recommended after schema changes)

Notes on training corpus design (informed by DAIL-SQL, Vanna docs, Pinterest's
text-to-SQL writeup, and Google Cloud's "six failures" post):

  * Schema lives in DDL with inline -- comments.
  * Cross-table glossary + behavioural rules live in DOCS.
  * QA_PAIRS demonstrates the LIMIT / no-LIMIT distinction by example.
  * Question phrasing is varied (avoid templated questions).
  * Examples cover diverse SQL skeletons: aggregates, GROUP BY, JOIN, anti-join,
    NULL handling, IN-list, ILIKE on comma-joined columns.
"""
import sys, os, shutil, argparse
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vanna_gemini import get_vanna

# ----- DDL ----------------------------------------------------------------
# Keep this in sync with backend/models.py.

DDL_USERS = """
CREATE TABLE users (
    id_client             BIGINT PRIMARY KEY,
    user_country          TEXT,
    register_date         TIMESTAMP,
    first_purchase        TIMESTAMP,
    last_purchase         TIMESTAMP,

    -- Aggregated across all products
    recency               INTEGER,  -- days since most recent purchase (lower = more recent; >=90 is dormant)
    customer_age          INTEGER,  -- days since registration
    total_spent           FLOAT,    -- total spend across all product types
    purchase_frequency    INTEGER,  -- total purchases across all product types

    -- Per-product spend
    calls_spent           FLOAT,
    esim_spent            FLOAT,
    virtual_spent         FLOAT,

    -- Per-product frequency
    calls_frequency       INTEGER,
    esim_frequency        INTEGER,
    virtual_frequency     INTEGER,

    -- Per-product cluster names (KMeans on per-category features)
    calls_cluster         TEXT,
    esim_cluster          TEXT,
    virtual_cluster       TEXT,

    -- Per-product PCA coordinates (offline KMeans+PCA, one model per product).
    -- Coordinates ARE NOT comparable across products. Used by the cluster
    -- scatter UI; not generally useful for Smart Query SQL.
    calls_pc1             FLOAT,
    calls_pc2             FLOAT,
    esim_pc1              FLOAT,
    esim_pc2              FLOAT,
    virtual_pc1           FLOAT,
    virtual_pc2           FLOAT,

    -- Per-product behavioural metrics — these are the "right" columns to
    -- use when filtering or aggregating BY a single product. Example:
    -- "Calls users dormant 30+ days" should use calls_recency, not the
    -- global recency. NULL when the user doesn't buy that product.
    calls_recency         INTEGER,  -- days since last Calls purchase
    esim_recency          INTEGER,  -- days since last eSIM purchase
    virtual_recency       INTEGER,  -- days since last Virtual Number purchase
    calls_aov             FLOAT,    -- average order value WITHIN Calls
    esim_aov              FLOAT,
    virtual_aov           FLOAT,
    calls_velocity        FLOAT,    -- purchase velocity within Calls (purchases / month)
    esim_velocity         FLOAT,
    virtual_velocity      FLOAT,
    calls_gap_days        FLOAT,    -- avg gap between Calls purchases
    esim_gap_days         FLOAT,
    virtual_gap_days      FLOAT,

    -- Primary product (highest spend) and its cluster
    primary_product_group TEXT,    -- 'Calls' | 'Data eSIM' | 'Virtual Number'
    product_groups        TEXT,    -- comma-joined list of all groups the user buys in (e.g. 'Calls, Virtual Number') -- match with ILIKE '%value%'
    product_types         TEXT,    -- comma-joined product sub-types ordered by frequency (e.g. 'USA Offers, Landline, Germany') -- match with ILIKE '%value%'
    dominant_product      TEXT,    -- single most-frequent product NAME (e.g. 'Recharge', 'Phone Number', 'Data eSIM') -- 8 distinct values
    cluster_id            INTEGER,
    segment               TEXT,    -- cluster name from primary product (see SEGMENT_VALUES doc)

    -- User attributes (filter dimensions in the dashboard)
    phone_number          TEXT,    -- WhatsApp E.164 (no '+'); not exposed in UI, used by wa-bot
    platform              TEXT,    -- 'iOS' | 'Android' | 'Web' | 'Huawei'
    language              TEXT,    -- 'english' | 'french' | 'spanish' | 'arabic' (lowercase)
    email                 TEXT,    -- ~85% null

    -- Campaign + reactivation tracking
    whatsapp_opted_in     BOOLEAN, -- defaults true
    last_campaign_at      TIMESTAMP,
    campaigns_sent        INTEGER, -- count of campaigns this user has received; 0 OR NULL means never targeted
    reactivation_score    FLOAT    -- 0..1 probability (from offline ML model); higher = more likely to come back
);
"""

DDL_CAMPAIGNS = """
CREATE TABLE campaigns (
    id                 INTEGER PRIMARY KEY,
    name               TEXT NOT NULL,
    offer_code         TEXT,
    message_template   TEXT,

    -- Audience filters captured at send time
    segment_filter     TEXT,
    product_filter     TEXT,
    country_filter     TEXT,
    recency_min_filter INTEGER,
    recency_max_filter INTEGER,
    spend_min_filter   FLOAT,
    spend_max_filter   FLOAT,

    total_targeted     INTEGER,
    status             TEXT,        -- 'draft' | 'queued' | 'sending' | 'sent' | 'completed'

    created_at         TIMESTAMP,
    sent_at            TIMESTAMP,

    -- Delivery stats (updated by wa-bot webhook)
    sent_count         INTEGER,
    delivered_count    INTEGER,
    read_count         INTEGER,
    replied_count      INTEGER,
    converted_count    INTEGER
);
"""

DDL_RECIPIENTS = """
CREATE TABLE campaign_recipients (
    id            INTEGER PRIMARY KEY,
    campaign_id   INTEGER NOT NULL,    -- FK -> campaigns.id
    user_id       BIGINT  NOT NULL,    -- FK -> users.id_client
    phone_number  TEXT,
    wa_message_id TEXT,                -- Meta's wamid

    status        TEXT,                -- 'sent' | 'delivered' | 'read' | 'replied' | 'converted' | 'failed'

    sent_at       TIMESTAMP,
    delivered_at  TIMESTAMP,
    read_at       TIMESTAMP,
    replied_at    TIMESTAMP,
    converted_at  TIMESTAMP,
    created_at    TIMESTAMP
);
"""

# ----- Documentation strings (free-form context Vanna injects in the prompt) --

DOCS = [
    # Glossary / value enumerations
    "Segments are KMeans cluster names from each user's primary (highest-spend) product. "
    "Segment values include: 'Calls - High-Value Power Users', 'Calls - Active Offer-Driven Customers', "
    "'Calls - At-Risk Customers', 'Calls - One-Time Customers', 'eSIM - High-Value Global Power Users', "
    "'eSIM - Local Data Users', 'eSIM - Data-Only Minimal Users', 'Virtual - High-Value Power Users', "
    "'Virtual - Loyal Infrequent Buyers', 'Virtual - Churned Low-Value Users', "
    "'Virtual - Low-Value Single-Product Users (Local Plan)', 'Virtual - EU Bundle Focused Customers'.",

    "recency is days since last purchase -- lower means more recent. "
    "Dormant typically means recency >= 90; long-dormant means recency >= 365.",

    "platform values are: 'iOS', 'Android', 'Web', 'Huawei'. language values (lowercase) are: 'english', 'french', 'spanish', 'arabic'.",

    "COUNTRY-NAME RULE -- the user_country column stores short country codes/names. "
    "When the question uses a long-form name or a known synonym, map it to the actual stored value:\n"
    "  * 'Saudi Arabia' / 'KSA' / 'Kingdom of Saudi Arabia' -> user_country = 'KSA'\n"
    "  * 'United Arab Emirates' / 'UAE' / 'Emirates'        -> user_country = 'UAE'\n"
    "  * 'United States' / 'USA' / 'America'                -> user_country = 'USA'\n"
    "  * 'United Kingdom' / 'Great Britain' / 'UK' / 'Britain' -> user_country = 'UK'\n"
    "  * Otherwise use the country name as-is (e.g. 'Egypt', 'Nigeria', 'India', 'Turkey', 'France', 'Pakistan').\n"
    "There is NO region column. Questions about 'Middle East', 'Europe', 'Asia', 'GCC', etc. cannot be answered without an explicit list of countries -- in that case respond with a comment naming the missing column rather than guessing.",

    "PRODUCT-MEMBERSHIP RULE -- when filtering 'users who buy product X' or 'X customers':\n"
    "  * 'Calls customers' / 'users who buy Calls' / 'show me Calls users' means ANY user with Calls activity, "
    "NOT just those whose primary product is Calls. Use product_groups ILIKE '%Calls%' (or '%Data eSIM%', '%Virtual Number%').\n"
    "  * primary_product_group = X means 'X is their highest-spend product specifically' -- only use when the "
    "question literally says 'primary' or 'main product'.\n"
    "  * The dashboard's product filter uses membership semantics by default; SQL should match.",

    "PER-PRODUCT METRIC RULE -- when a question filters to ONE product, the relevant metric columns are\n"
    "the per-product variants, not the globals:\n"
    "  * Calls    : calls_recency, calls_spent, calls_frequency, calls_aov, calls_velocity, calls_gap_days, calls_cluster\n"
    "  * Data eSIM: esim_recency, esim_spent, esim_frequency, esim_aov, esim_velocity, esim_gap_days, esim_cluster\n"
    "  * Virtual  : virtual_recency, virtual_spent, virtual_frequency, virtual_aov, virtual_velocity, virtual_gap_days, virtual_cluster\n"
    "Example: 'Calls customers active in last 30 days' = product_groups ILIKE '%Calls%' AND calls_recency <= 30. "
    "Using the global `recency` here would silently include users whose recent activity was on a different product.",

    "reactivation_score is a probability between 0 and 1 from an offline ML model -- higher means more likely to come back if contacted. "
    "Only DORMANT users with sufficient history get scored; the column is NULL for active users AND for one-time buyers without enough signal. "
    "Three meaningful reactivation states:\n"
    "  * Active (no reactivation needed)        : recency < 90\n"
    "  * Dormant + scored (model has a forecast): recency >= 90 AND reactivation_score IS NOT NULL\n"
    "  * Dormant + unscored (one-time buyers)   : recency >= 90 AND reactivation_score IS NULL\n"
    "Bucket cutoffs are PERCENTILE-BASED (top 20% = HIGH, next 30% = MEDIUM, bottom 50% = LOW) computed live from the scored population. "
    "When a user asks for 'high-priority reactivation targets' or 'top reactivation candidates', order by reactivation_score DESC and "
    "let the cutoff materialise via ranking, OR filter `reactivation_score >= (SELECT percentile_cont(0.80) WITHIN GROUP (ORDER BY reactivation_score) FROM users WHERE reactivation_score IS NOT NULL)`.",

    "Campaigns are WhatsApp messages sent to a filtered audience. Campaign status lifecycle: draft -> queued -> sending -> sent -> completed. "
    "Per-recipient lifecycle in campaign_recipients.status: sent -> delivered -> read -> replied -> converted (or failed).",

    "To find users never targeted by a campaign, use campaigns_sent = 0 OR campaigns_sent IS NULL. "
    "To find users contacted recently, filter on last_campaign_at.",

    "Foreign-key relationships: campaign_recipients.user_id = users.id_client; "
    "campaign_recipients.campaign_id = campaigns.id. Use explicit INNER JOIN ... ON syntax with table aliases (u, c, cr).",

    # SQL-generation rules (paste-ready)
    "INTENT RULE -- when to add LIMIT to the generated SQL:\n"
    "  * If the question contains ranking words ('top', 'best', 'first', 'highest', 'lowest', 'most') OR an explicit number "
    "('top 10', 'first 20'), include ORDER BY <metric> and LIMIT N. Default N = 50 if unspecified.\n"
    "  * If the question is an audience filter ('users who...', 'show me X users', 'list everyone who', 'find users with...'), "
    "the answer is the WHOLE matching set. Do NOT add LIMIT. Order by total_spent DESC for readability but return all rows.\n"
    "  * If the question is a count or aggregate ('how many', 'count', 'what percentage', 'average', 'total', 'sum'), "
    "use COUNT/SUM/AVG/etc. Never add LIMIT to aggregate queries -- the answer is one row already.\n"
    "  * Exception: explicit top-N requests ('top 10 countries', 'best 5 campaigns') keep LIMIT N from the question.",

    "STRING-MATCHING RULE -- when comparing user-supplied strings:\n"
    "  * For known canonical enum values (segment names, platform 'iOS'/'Android', language 'english', country 'France'), "
    "use exact equality (=).\n"
    "  * For free-text or fuzzy intent (names, free-form descriptions), use ILIKE with %wildcards%.\n"
    "  * For columns that are comma-joined lists (product_groups, product_types), use ILIKE '%value%' since the cell contains multiple values.",

    "NULL-HANDLING RULE:\n"
    "  * 'users who haven't X' or 'users without X': NULL is not equal to 0 in SQL -- use 'col = 0 OR col IS NULL' for absence-of-action columns.\n"
    "  * 'users with X' or 'users that have X': add 'col IS NOT NULL' (or '> 0') to exclude rows missing the value.",

    "DATE-HANDLING RULE -- relative dates always anchor to NOW(); never hardcode a date:\n"
    "  * 'last 30 days' -> col >= NOW() - INTERVAL '30 days'\n"
    "  * 'last month'   -> col >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' AND col < DATE_TRUNC('month', NOW())\n"
    "  * 'this month'   -> col >= DATE_TRUNC('month', NOW())\n"
    "  * 'this year'    -> col >= DATE_TRUNC('year', NOW())",

    "JOIN RULE: Always use explicit INNER JOIN / LEFT JOIN with ON clauses and short table aliases (u for users, c for campaigns, cr for campaign_recipients). "
    "When joins fan out one-to-many, use COUNT(DISTINCT u.id_client) to avoid double-counting users.",

    "DIALECT: Generate Postgres-flavoured SQL. Use ILIKE (not LIKE) for case-insensitive matches. "
    "Use NOW() / CURRENT_DATE / DATE_TRUNC / INTERVAL syntax (not MySQL's CURDATE/DATEDIFF or SQL Server's GETDATE).",

    "SCHEMA-FIDELITY RULE: Only reference columns and tables that appear in the provided DDL. "
    "If the question cannot be answered from the schema, return a SELECT with a comment explaining the missing data rather than inventing columns.",
]

# ----- Q/A pairs ----------------------------------------------------------
# Pairs are categorised by intent so the LIMIT/no-LIMIT distinction is learned by example.

QA_PAIRS = [
    # ===== AGGREGATE / COUNT (never LIMIT) =====================================
    ("How many users are there in total?",
     "SELECT COUNT(*) AS total_users FROM users;"),

    ("How many users are in each segment?",
     "SELECT segment, COUNT(*) AS user_count FROM users GROUP BY segment ORDER BY user_count DESC;"),

    ("How many users are dormant for 90+ days?",
     "SELECT COUNT(*) AS dormant_users FROM users WHERE recency >= 90;"),

    ("How many users on iOS vs Android?",
     "SELECT platform, COUNT(*) AS user_count FROM users WHERE platform IS NOT NULL GROUP BY platform ORDER BY user_count DESC;"),

    ("Breakdown of users by language",
     "SELECT language, COUNT(*) AS user_count, AVG(total_spent) AS avg_spend FROM users "
     "WHERE language IS NOT NULL GROUP BY language ORDER BY user_count DESC;"),

    ("How many users have a high reactivation score above 0.7?",
     "SELECT COUNT(*) AS high_reactivation_users FROM users WHERE reactivation_score >= 0.7;"),

    ("How many users per dominant product?",
     "SELECT dominant_product, COUNT(*) AS user_count FROM users "
     "WHERE dominant_product IS NOT NULL GROUP BY dominant_product ORDER BY user_count DESC;"),

    ("How many users have never been sent a campaign?",
     "SELECT COUNT(*) AS untouched_users FROM users WHERE campaigns_sent = 0 OR campaigns_sent IS NULL;"),

    ("How many campaigns went out last month?",
     "SELECT COUNT(*) AS campaign_count FROM campaigns "
     "WHERE sent_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' "
     "AND sent_at <  DATE_TRUNC('month', NOW());"),

    ("Total messages sent across all campaigns",
     "SELECT SUM(sent_count) AS total_sent, SUM(delivered_count) AS total_delivered, "
     "SUM(converted_count) AS total_converted FROM campaigns;"),

    ("What is the average spend per segment?",
     "SELECT segment, AVG(total_spent) AS avg_spend, COUNT(*) AS user_count FROM users GROUP BY segment ORDER BY avg_spend DESC;"),

    ("Show users by primary product group",
     "SELECT primary_product_group, COUNT(*) AS user_count, AVG(total_spent) AS avg_spend FROM users "
     "GROUP BY primary_product_group ORDER BY user_count DESC;"),

    # ===== AUDIENCE FILTERS (no LIMIT -- return whole matching set) ============
    ("Show me High-Value Power Users",
     "SELECT id_client, total_spent, purchase_frequency, recency, user_country, segment FROM users "
     "WHERE segment IN ('Calls - High-Value Power Users', 'eSIM - High-Value Global Power Users', 'Virtual - High-Value Power Users') "
     "ORDER BY total_spent DESC;"),

    ("Show me Churned or At-Risk users",
     "SELECT id_client, total_spent, recency, segment FROM users "
     "WHERE segment IN ('Virtual - Churned Low-Value Users', 'Calls - At-Risk Customers') "
     "ORDER BY recency DESC;"),

    ("Who are the High-Value Power virtual number users?",
     "SELECT id_client, virtual_spent, virtual_frequency, recency FROM users "
     "WHERE segment = 'Virtual - High-Value Power Users' ORDER BY virtual_spent DESC;"),

    ("Which users haven't purchased in over a year?",
     "SELECT id_client, segment, recency, total_spent, primary_product_group FROM users "
     "WHERE recency > 365 ORDER BY recency DESC;"),

    ("Show users who buy all three product types",
     "SELECT id_client, calls_spent, esim_spent, virtual_spent, total_spent, segment FROM users "
     "WHERE calls_frequency > 0 AND esim_frequency > 0 AND virtual_frequency > 0 ORDER BY total_spent DESC;"),

    ("Show iOS users in France",
     "SELECT id_client, total_spent, recency, segment FROM users "
     "WHERE platform = 'iOS' AND user_country = 'France' ORDER BY total_spent DESC;"),

    ("Show users whose dominant product is Recharge",
     "SELECT id_client, total_spent, recency, segment FROM users "
     "WHERE dominant_product = 'Recharge' ORDER BY total_spent DESC;"),

    ("Show users who haven't received a campaign yet",
     "SELECT id_client, segment, recency, total_spent FROM users "
     "WHERE campaigns_sent = 0 OR campaigns_sent IS NULL ORDER BY total_spent DESC;"),

    ("Users who got a campaign in the last 30 days",
     "SELECT id_client, last_campaign_at, segment, total_spent FROM users "
     "WHERE last_campaign_at >= NOW() - INTERVAL '30 days' ORDER BY last_campaign_at DESC;"),

    ("WhatsApp opted-in dormant users",
     "SELECT id_client, recency, segment, user_country, total_spent FROM users "
     "WHERE whatsapp_opted_in = true AND recency >= 90 ORDER BY recency DESC;"),

    ("Show At-Risk calls users",
     "SELECT id_client, calls_spent, calls_frequency, recency, total_spent FROM users "
     "WHERE segment = 'Calls - At-Risk Customers' ORDER BY calls_spent DESC;"),

    ("Show EU Bundle focused virtual users",
     "SELECT id_client, virtual_spent, virtual_frequency, recency FROM users "
     "WHERE segment = 'Virtual - EU Bundle Focused Customers' ORDER BY virtual_spent DESC;"),

    ("Find users with high virtual spend but long recency",
     "SELECT id_client, virtual_spent, recency, segment FROM users "
     "WHERE virtual_spent > 30 AND recency > 300 ORDER BY virtual_spent DESC;"),

    ("Show local data eSIM users",
     "SELECT id_client, esim_spent, esim_frequency, recency, customer_age FROM users "
     "WHERE segment = 'eSIM - Local Data Users' ORDER BY recency ASC;"),

    ("Find users who bought USA Offers",
     "SELECT id_client, product_types, total_spent, segment FROM users "
     "WHERE product_types ILIKE '%USA Offers%' ORDER BY total_spent DESC;"),

    ("Show dormant users likely to reactivate",
     "SELECT id_client, reactivation_score, recency, total_spent, segment, user_country FROM users "
     "WHERE recency >= 90 AND reactivation_score IS NOT NULL ORDER BY reactivation_score DESC;"),

    ("Find Arabic-speaking users with high spend",
     "SELECT id_client, total_spent, user_country, segment FROM users "
     "WHERE language = 'arabic' AND total_spent > 50 ORDER BY total_spent DESC;"),

    # ===== TOP-N / RANKING (LIMIT N stays) =====================================
    ("Top 10 countries by total revenue",
     "SELECT user_country, SUM(total_spent) AS revenue, COUNT(*) AS user_count FROM users "
     "GROUP BY user_country ORDER BY revenue DESC LIMIT 10;"),

    ("Top 50 high spenders across all products",
     "SELECT id_client, total_spent, calls_spent, esim_spent, virtual_spent, segment FROM users "
     "ORDER BY total_spent DESC LIMIT 50;"),

    ("Top 20 users by reactivation score",
     "SELECT id_client, reactivation_score, recency, total_spent, segment FROM users "
     "WHERE reactivation_score IS NOT NULL ORDER BY reactivation_score DESC LIMIT 20;"),

    ("Top 10 countries with the most dormant users",
     "SELECT user_country, COUNT(*) AS user_count, AVG(total_spent) AS avg_spend FROM users "
     "WHERE recency >= 90 GROUP BY user_country ORDER BY user_count DESC LIMIT 10;"),

    ("Top 10 most recently active users",
     "SELECT id_client, recency, total_spent, segment, primary_product_group FROM users "
     "ORDER BY recency ASC LIMIT 10;"),

    ("Best 10 campaigns by conversion rate",
     "SELECT name, offer_code, total_targeted, converted_count, "
     "ROUND(100.0 * converted_count / NULLIF(sent_count, 0), 2) AS conversion_pct "
     "FROM campaigns WHERE sent_count > 0 ORDER BY conversion_pct DESC LIMIT 10;"),

    ("Top 20 most recent campaigns and their delivery stats",
     "SELECT id, name, offer_code, status, total_targeted, sent_count, delivered_count, read_count, replied_count, converted_count, sent_at "
     "FROM campaigns ORDER BY sent_at DESC NULLS LAST LIMIT 20;"),

    # ===== JOINS / CAMPAIGN ANALYSIS ===========================================
    ("How did campaign 5 perform?",
     "SELECT status, COUNT(*) AS recipient_count FROM campaign_recipients "
     "WHERE campaign_id = 5 GROUP BY status ORDER BY recipient_count DESC;"),

    ("Which users converted from campaign 3?",
     "SELECT cr.user_id AS id_client, u.segment, u.total_spent, cr.converted_at "
     "FROM campaign_recipients cr "
     "INNER JOIN users u ON u.id_client = cr.user_id "
     "WHERE cr.campaign_id = 3 AND cr.status = 'converted' "
     "ORDER BY cr.converted_at DESC;"),

    ("How many distinct users have converted across all campaigns?",
     "SELECT COUNT(DISTINCT cr.user_id) AS converted_users FROM campaign_recipients cr "
     "WHERE cr.status = 'converted';"),

    # ===== MEMBERSHIP FILTERING (matches dashboard semantics) ==================
    ("How many Calls customers do we have?",
     "SELECT COUNT(*) AS calls_customers FROM users WHERE product_groups ILIKE '%Calls%';"),

    ("Show me Data eSIM customers",
     "SELECT id_client, esim_spent, esim_recency, segment, user_country FROM users "
     "WHERE product_groups ILIKE '%Data eSIM%' ORDER BY esim_spent DESC;"),

    ("How many Virtual Number users haven't bought in over 90 days?",
     "SELECT COUNT(*) AS dormant_virtual_users FROM users "
     "WHERE product_groups ILIKE '%Virtual Number%' AND virtual_recency >= 90;"),

    ("Calls customers active in the last 30 days",
     "SELECT id_client, calls_spent, calls_recency, segment FROM users "
     "WHERE product_groups ILIKE '%Calls%' AND calls_recency IS NOT NULL AND calls_recency <= 30 "
     "ORDER BY calls_recency ASC;"),

    ("eSIM users with high Calls spend who bought eSIM at least once",
     "SELECT id_client, calls_spent, esim_spent, total_spent, segment FROM users "
     "WHERE product_groups ILIKE '%Data eSIM%' AND calls_spent > 50 ORDER BY calls_spent DESC;"),

    ("How much have Virtual Number customers spent on Virtual Number specifically?",
     "SELECT SUM(virtual_spent) AS total_virtual_revenue, COUNT(*) AS virtual_customers, "
     "AVG(virtual_spent) AS avg_virtual_spend FROM users "
     "WHERE product_groups ILIKE '%Virtual Number%';"),

    ("Top 10 Calls customers by Calls spend",
     "SELECT id_client, calls_spent, calls_frequency, calls_recency, segment FROM users "
     "WHERE product_groups ILIKE '%Calls%' ORDER BY calls_spent DESC LIMIT 10;"),

    # ===== REACTIVATION (3 states, percentile cutoffs) =========================
    ("Top reactivation candidates",
     "SELECT id_client, reactivation_score, recency, total_spent, segment, user_country FROM users "
     "WHERE recency >= 90 AND reactivation_score IS NOT NULL "
     "ORDER BY reactivation_score DESC LIMIT 50;"),

    ("Show high-priority reactivation users (top 20%)",
     "WITH cutoff AS ( "
     "  SELECT percentile_cont(0.80) WITHIN GROUP (ORDER BY reactivation_score) AS p80 "
     "  FROM users WHERE reactivation_score IS NOT NULL "
     ") "
     "SELECT u.id_client, u.reactivation_score, u.recency, u.total_spent, u.segment "
     "FROM users u CROSS JOIN cutoff "
     "WHERE u.recency >= 90 AND u.reactivation_score >= cutoff.p80 "
     "ORDER BY u.reactivation_score DESC;"),

    ("How many dormant users does the model not have a score for?",
     "SELECT COUNT(*) AS dormant_unscored FROM users "
     "WHERE recency >= 90 AND reactivation_score IS NULL;"),

    ("Dormant users without a reactivation score",
     "SELECT id_client, recency, total_spent, purchase_frequency, segment, user_country FROM users "
     "WHERE recency >= 90 AND reactivation_score IS NULL "
     "ORDER BY total_spent DESC;"),

    ("Average reactivation score per segment",
     "SELECT segment, COUNT(*) AS scored_users, AVG(reactivation_score) AS avg_score "
     "FROM users WHERE reactivation_score IS NOT NULL "
     "GROUP BY segment ORDER BY avg_score DESC;"),

    ("Breakdown of customers by reactivation status",
     "SELECT "
     "  COUNT(*) FILTER (WHERE recency < 90)                                       AS active, "
     "  COUNT(*) FILTER (WHERE recency >= 90 AND reactivation_score IS NOT NULL)   AS dormant_scored, "
     "  COUNT(*) FILTER (WHERE recency >= 90 AND reactivation_score IS NULL)       AS dormant_unscored "
     "FROM users;"),

    # ===== COUNTRY-NAME ALIASES ================================================
    ("Power users in Saudi Arabia",
     "SELECT id_client, total_spent, recency, segment FROM users "
     "WHERE segment IN ('Calls - High-Value Power Users', 'eSIM - High-Value Global Power Users', 'Virtual - High-Value Power Users') "
     "AND user_country = 'KSA' ORDER BY total_spent DESC;"),

    ("How many users in Saudi Arabia?",
     "SELECT COUNT(*) AS users_in_ksa FROM users WHERE user_country = 'KSA';"),

    ("Top 10 high-value customers in the United States",
     "SELECT id_client, total_spent, segment, recency FROM users "
     "WHERE user_country = 'USA' ORDER BY total_spent DESC LIMIT 10;"),

    ("Users in the UAE who buy Calls",
     "SELECT id_client, calls_spent, calls_recency, segment FROM users "
     "WHERE user_country = 'UAE' AND product_groups ILIKE '%Calls%' "
     "ORDER BY calls_spent DESC;"),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true",
                        help="Wipe ./chroma_db before training (recommended after schema changes)")
    args = parser.parse_args()

    if args.reset:
        chroma_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "chroma_db")
        if os.path.isdir(chroma_path):
            print(f"Removing existing Chroma store at {chroma_path}...")
            shutil.rmtree(chroma_path)

    print("Connecting to Vanna...")
    vn = get_vanna()

    print("Training on DDL (users)...")
    vn.train(ddl=DDL_USERS)
    print("Training on DDL (campaigns)...")
    vn.train(ddl=DDL_CAMPAIGNS)
    print("Training on DDL (campaign_recipients)...")
    vn.train(ddl=DDL_RECIPIENTS)

    print(f"Training on {len(DOCS)} documentation strings...")
    for i, doc in enumerate(DOCS, 1):
        vn.train(documentation=doc)
        print(f"  [{i}/{len(DOCS)}] {doc[:70]}...")

    print(f"Training on {len(QA_PAIRS)} Q&A pairs...")
    for i, (q, sql) in enumerate(QA_PAIRS, 1):
        vn.train(question=q, sql=sql)
        print(f"  [{i}/{len(QA_PAIRS)}] {q[:60]}")

    print("\nVanna training complete!")


if __name__ == "__main__":
    main()
