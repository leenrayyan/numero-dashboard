"""
Seed script — populates the local Postgres `users` table from the per-customer
clustering output in backend/data/clustered/.

Inputs:
  - Client_All_Clustered.csv      (1 row per customer: totals, segment one-hots,
                                    contact info, has_calls/esim/virtual flags)
  - Client_Calls_Clustered.csv    (per-category metrics + cluster_name + cluster id)
  - Client_eSIM_Clustered.csv
  - Client_Virtual_Clustered.csv
  - the raw transaction CSV       (for register_date / first_purchase /
                                    last_purchase / email / product_types /
                                    dominant_product — none of which are in
                                    the clustered files)

Behavior:
  - primary_product_group = highest-spend category per customer
  - product_groups        = comma-joined list of every category the customer buys in
  - segment / cluster_id  = from the primary category's cluster
  - calls_cluster / esim_cluster / virtual_cluster populated independently from
    each per-category file (so a cross-category customer keeps all their labels)

Usage (from the backend/ folder):
    python scripts/seed.py
    # or with a custom raw-data path:
    python scripts/seed.py --raw "C:/path/to/raw.csv"
"""
import sys, os, argparse
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://admin:admin123@localhost:5432/dormant_users",
).replace("+asyncpg", "")

BACKEND_DIR     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLUSTERED_DIR   = os.path.join(BACKEND_DIR, "data", "clustered")
DEFAULT_RAW_CSV = r"C:\Users\leenr\Downloads\Copy of Numero eSIM_purchases (2024 - 2025).csv"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def first_nonnull(s: pd.Series):
    s = s.dropna()
    return s.iloc[0] if len(s) else None


def clean_phone(val):
    """Strip non-digit chars for E.164-friendly storage."""
    if val is None or (not isinstance(val, str) and pd.isna(val)):
        return None
    s = "".join(ch for ch in str(val) if ch.isdigit())
    return s or None


def top_product_types(s: pd.Series, limit: int = 5) -> str | None:
    """Comma-joined top-N product_types this user purchased, ordered by count."""
    s = s.dropna().astype(str)
    if not len(s):
        return None
    return ", ".join(s.value_counts().head(limit).index.tolist())


def dominant_value(s: pd.Series) -> str | None:
    s = s.dropna().astype(str)
    if not len(s):
        return None
    return s.value_counts().index[0]


# ---------------------------------------------------------------------------
# Main aggregation
# ---------------------------------------------------------------------------

def build_users(all_df: pd.DataFrame,
                calls_df: pd.DataFrame,
                esim_df: pd.DataFrame,
                virtual_df: pd.DataFrame,
                raw_df: pd.DataFrame) -> pd.DataFrame:
    """Merge the 4 clustered files + raw enrichment into one user-level frame."""

    # --- 1. Start from the All file (1 row per customer, has totals + contact) ---
    users = all_df.copy().rename(columns={
        "User Country":       "user_country",
        "User phone number":  "phone_number",
        "total_spend":        "total_spent",
        "total_purchase_count": "purchase_frequency",
    })
    users = users.set_index("id_client")

    # --- 2. Per-category metrics from each Client_<cat>_Clustered.csv ---
    # We pull EVERYTHING the per-product CSV has on a per-user basis, so
    # membership filtering ("show me Calls users") can use Calls-specific
    # recency/spend/aov/velocity instead of mixing in the user's other-
    # product activity. PC1/PC2 are the per-product PCA coords (one
    # coordinate space per product, fit in the offline notebook).
    for prefix, df in [("calls", calls_df), ("esim", esim_df), ("virtual", virtual_df)]:
        sub = df.set_index("id_client")[
            ["total_spent", "total_purchases", "cluster", "cluster_name",
             "customer_age", "PC1", "PC2",
             "recency", "avg_order_value", "purchase_velocity", "avg_gap_days"]
        ].rename(columns={
            "total_spent":       f"{prefix}_spent",
            "total_purchases":   f"{prefix}_frequency",
            "cluster":           f"{prefix}_cluster_id",
            "cluster_name":      f"{prefix}_cluster",
            "customer_age":      f"{prefix}_customer_age",
            "PC1":               f"{prefix}_pc1",
            "PC2":               f"{prefix}_pc2",
            "recency":           f"{prefix}_recency",
            "avg_order_value":   f"{prefix}_aov",
            "purchase_velocity": f"{prefix}_velocity",
            "avg_gap_days":      f"{prefix}_gap_days",
        })
        users = users.join(sub, how="left")

    # Fill missing per-category numbers with 0 (customer didn't buy in that category)
    for prefix in ("calls", "esim", "virtual"):
        users[f"{prefix}_spent"]     = users[f"{prefix}_spent"].fillna(0).astype(float).round(4)
        users[f"{prefix}_frequency"] = users[f"{prefix}_frequency"].fillna(0).astype(int)

    # customer_age should be the same across categories for the same customer; take first
    age_cols = ["calls_customer_age", "esim_customer_age", "virtual_customer_age"]
    users["customer_age"] = users[age_cols].bfill(axis=1).iloc[:, 0]
    users = users.drop(columns=age_cols)

    # --- 3. Primary product group = highest-spend category ---
    spend_cols       = ["calls_spent", "esim_spent", "virtual_spent"]
    primary_idx      = users[spend_cols].values.argmax(axis=1)
    products         = ["Calls", "Data eSIM", "Virtual Number"]
    cluster_id_cols  = ["calls_cluster_id", "esim_cluster_id", "virtual_cluster_id"]
    cluster_name_cols = ["calls_cluster", "esim_cluster", "virtual_cluster"]

    users["primary_product_group"] = [products[i] for i in primary_idx]
    users["cluster_id"] = [
        users.iloc[r][cluster_id_cols[i]] for r, i in enumerate(primary_idx)
    ]
    users["cluster_id"] = pd.array(users["cluster_id"].values, dtype=pd.Int64Dtype())
    users["segment"] = [
        users.iloc[r][cluster_name_cols[i]] for r, i in enumerate(primary_idx)
    ]
    users = users.drop(columns=cluster_id_cols)

    # --- 4. product_groups (NEW): comma-joined list of all categories the customer is in ---
    def joined_groups(row):
        out = []
        if row.get("has_calls"):   out.append("Calls")
        if row.get("has_esim"):    out.append("Data eSIM")
        if row.get("has_virtual"): out.append("Virtual Number")
        return ", ".join(out) if out else None
    users["product_groups"] = users.apply(joined_groups, axis=1)

    # --- 5. Enrich with raw-data fields not in clustered files ---
    print(f"  enriching from raw data ({len(raw_df):,} transactions)...")
    raw_grp = raw_df.groupby("id_client")
    enrich = pd.DataFrame({
        "register_date":    raw_grp["register_date"].min(),
        "first_purchase":   raw_grp["purchase_date"].min(),
        "last_purchase":    raw_grp["purchase_date"].max(),
        "email":            raw_grp["email"].agg(first_nonnull),
        "product_types":    raw_grp["product_type"].agg(top_product_types),
        "dominant_product": raw_grp["product"].agg(dominant_value),
    })
    users = users.join(enrich, how="left")

    # --- 6. Final clean ---
    users["phone_number"]       = users["phone_number"].apply(clean_phone)
    users["total_spent"]        = users["total_spent"].astype(float).round(4)
    users["purchase_frequency"] = users["purchase_frequency"].astype(int)
    users["recency"]            = users["recency"].fillna(0).astype(int)
    users["customer_age"]       = users["customer_age"].fillna(0).astype(int)

    return users.reset_index()


# ---------------------------------------------------------------------------
# Insertion
# ---------------------------------------------------------------------------

USER_COLUMNS = [
    "id_client", "user_country", "register_date", "first_purchase", "last_purchase",
    "recency", "customer_age", "total_spent", "purchase_frequency",
    "calls_spent", "esim_spent", "virtual_spent",
    "calls_frequency", "esim_frequency", "virtual_frequency",
    "calls_cluster", "esim_cluster", "virtual_cluster",
    "calls_pc1", "calls_pc2", "esim_pc1", "esim_pc2", "virtual_pc1", "virtual_pc2",
    "calls_recency", "esim_recency", "virtual_recency",
    "calls_aov", "esim_aov", "virtual_aov",
    "calls_velocity", "esim_velocity", "virtual_velocity",
    "calls_gap_days", "esim_gap_days", "virtual_gap_days",
    "primary_product_group", "cluster_id", "segment", "product_groups",
    "product_types", "dominant_product",
    "phone_number", "platform", "language", "email",
]


# Per-product recency comes out of pandas as float64 (because of NaNs for
# users who don't buy that product). Postgres `Integer` columns reject that —
# coerce to int when the value is present, leave NULL otherwise.
_INT_COLS = {"calls_recency", "esim_recency", "virtual_recency"}


def to_record(row: pd.Series) -> dict:
    rec = {}
    for col in USER_COLUMNS:
        val = row.get(col)
        if val is None or (not isinstance(val, str) and pd.isna(val)):
            rec[col] = None
        else:
            rec[col] = int(val) if col in _INT_COLS else val
    rec["id_client"] = int(rec["id_client"])
    return rec


def seed(raw_csv: str):
    if not DATABASE_URL:
        sys.exit("ERROR: DATABASE_URL not set. Start Postgres and check your .env.")
    if not os.path.exists(raw_csv):
        sys.exit(f"ERROR: raw CSV not found at {raw_csv}")

    # Load clustered CSVs ----------------------------------------------------
    print("Loading clustered CSVs...")
    all_df     = pd.read_csv(os.path.join(CLUSTERED_DIR, "Client_All_Clustered.csv"))
    calls_df   = pd.read_csv(os.path.join(CLUSTERED_DIR, "Client_Calls_Clustered.csv"))
    esim_df    = pd.read_csv(os.path.join(CLUSTERED_DIR, "Client_eSIM_Clustered.csv"))
    virtual_df = pd.read_csv(os.path.join(CLUSTERED_DIR, "Client_Virtual_Clustered.csv"))
    print(f"  All:     {len(all_df):,}    Calls: {len(calls_df):,}    "
          f"eSIM: {len(esim_df):,}    Virtual: {len(virtual_df):,}")

    # Load raw for enrichment fields ----------------------------------------
    print(f"Loading raw transactions from {raw_csv}...")
    raw_df = pd.read_csv(raw_csv, low_memory=False)
    raw_df = raw_df.rename(columns={"prodcut": "product"})
    # MM/DD/YYYY US format. format='mixed' handles both M/D and MM/DD.
    raw_df["purchase_date"] = pd.to_datetime(raw_df["purchase_date"], format="mixed", errors="coerce")
    raw_df["register_date"] = pd.to_datetime(raw_df["register_date"], format="mixed", errors="coerce")
    raw_df = raw_df.dropna(subset=["purchase_date"])

    # Build the user-level frame --------------------------------------------
    print("Building user-level frame...")
    users_df = build_users(all_df, calls_df, esim_df, virtual_df, raw_df)
    print(f"  -> {len(users_df):,} users")
    print("\nPrimary product distribution:")
    print(users_df["primary_product_group"].value_counts().to_string())
    print("\nSegment distribution:")
    print(users_df["segment"].value_counts().to_string())
    print(f"\nCross-category buyers (product_groups contains a comma): "
          f"{users_df['product_groups'].fillna('').str.contains(',').sum():,}")

    # Wipe & rewrite tables --------------------------------------------------
    engine = create_engine(DATABASE_URL, echo=False)
    with engine.connect() as conn:
        print("\nDropping existing users + cluster_runs tables...")
        conn.execute(text("DROP TABLE IF EXISTS users CASCADE"))
        conn.execute(text("DROP TABLE IF EXISTS cluster_runs CASCADE"))
        conn.commit()

    import models  # noqa: F401  (registers tables on Base)
    models.Base.metadata.create_all(engine)

    # Build records and insert in batches -----------------------------------
    print(f"\nInserting {len(users_df):,} users...")
    BATCH = 2000
    cols_csv = ", ".join(USER_COLUMNS)
    placeholders = ", ".join(f":{c}" for c in USER_COLUMNS)
    insert_sql = text(f"""
        INSERT INTO users ({cols_csv}) VALUES ({placeholders})
        ON CONFLICT (id_client) DO NOTHING
    """)

    with engine.connect() as conn:
        for i in range(0, len(users_df), BATCH):
            batch = [to_record(r) for _, r in users_df.iloc[i:i + BATCH].iterrows()]
            conn.execute(insert_sql, batch)
            conn.commit()
            print(f"  {min(i + BATCH, len(users_df)):,}/{len(users_df):,}", end="\r")

        # Cluster-run metadata row
        conn.execute(text("""
            INSERT INTO cluster_runs (run_at, n_clusters, algorithm, features_used,
                                      centroids, cluster_stats, is_active, notes)
            VALUES (NOW(), 12, 'KMeans (per-category, behavioral features)',
                    '["recency","customer_age","total_purchases","total_spent",
                      "avg_order_value","unique_products","purchase_velocity",
                      "avg_gap_days","spend_<product>","share_<product>"]',
                    '[]', '{}', true,
                    'Seeded from backend/data/clustered/ — 12 segments across Calls / eSIM / Virtual')
        """))
        conn.commit()

    print(f"\nDone. {len(users_df):,} users seeded.")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--raw", default=DEFAULT_RAW_CSV,
                   help="Path to the raw transaction CSV (for date / email / product_type enrichment)")
    args = p.parse_args()
    seed(args.raw)
