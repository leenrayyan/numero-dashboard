"""
Seed script — ingests the new merged transaction-level clustered CSV
(`DF_Merged_Clustered.csv`) and aggregates it into the user-level `users`
table the dashboard reads from.

The notebook produces one row per purchase. Multiple rows per id_client.
This script:
  1. Reads the merged CSV
  2. Groups by id_client
  3. Computes user-level aggregates (per-product spend/frequency/cluster, plus
     totals, plus the primary product = highest spend)
  4. Wipes and rewrites the `users` table

Usage (run from the `backend` folder):
    python scripts/seed.py
    # or with a custom CSV path:
    python scripts/seed.py --csv "C:/path/to/DF_Merged_Clustered.csv"
"""
import sys, os, argparse
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "").replace("+asyncpg", "")
DEFAULT_CSV  = "C:/Users/leenr/Downloads/Clustered Files/Clustered Files/DF_Merged_Clustered.csv"


def first_nonnull(s: pd.Series):
    s = s.dropna()
    return s.iloc[0] if len(s) else None


def clean_phone(val):
    """Strip non-digit chars (spaces, dashes, plus signs) for E.164-friendly storage."""
    if val is None or (not isinstance(val, str) and pd.isna(val)):
        return None
    s = "".join(ch for ch in str(val) if ch.isdigit())
    return s or None


def mode_or_first(s: pd.Series):
    s = s.dropna()
    if not len(s):
        return None
    m = s.mode()
    return m.iloc[0] if len(m) else s.iloc[0]


def aggregate_users(df: pd.DataFrame) -> pd.DataFrame:
    """Transaction rows → one row per id_client."""
    print(f"Aggregating {len(df):,} transaction rows into user-level rows...")

    # Per-product subsets — used for *_spent, *_frequency, *_cluster fields.
    by_user_group = df.groupby(["id_client", "product_group"])
    product_spend = by_user_group["price"].sum().unstack(fill_value=0.0)
    product_count = by_user_group.size().unstack(fill_value=0)
    product_segment = by_user_group["cluster_name"].agg(first_nonnull).unstack()
    product_cluster = by_user_group["cluster"].agg(first_nonnull).unstack()

    # Make sure every product column exists even if the CSV only has 1 group.
    for grp in ("Calls", "Data eSIM", "Virtual Number"):
        if grp not in product_spend.columns:
            product_spend[grp]   = 0.0
            product_count[grp]   = 0
            product_segment[grp] = None
            product_cluster[grp] = None

    # Per-user attributes — first non-null is fine for things that should be
    # constant per user, mode for platform (which can vary across devices).
    by_user = df.groupby("id_client")

    def top_product_types(s: pd.Series, limit: int = 5) -> str | None:
        """Comma-joined top-N product_types this user purchased, ordered by count."""
        s = s.dropna().astype(str)
        if not len(s):
            return None
        vc = s.value_counts()
        return ", ".join(vc.head(limit).index.tolist())

    base = pd.DataFrame({
        "user_country":       by_user["User Country"].agg(first_nonnull),
        "register_date":      by_user["register_date"].min(),
        "first_purchase":     by_user["purchase_date"].min(),
        "last_purchase":      by_user["purchase_date"].max(),
        "recency":            by_user["recency"].min(),
        "customer_age":       by_user["customer_age"].min(),
        "total_spent":        by_user["price"].sum(),
        "purchase_frequency": by_user.size(),
        "phone_number":       by_user["User phone number"].agg(first_nonnull),
        "platform":           by_user["platform"].agg(mode_or_first),
        "language":           by_user["language"].agg(first_nonnull),
        "email":              by_user["email"].agg(first_nonnull),
        "product_types":      by_user["product_type"].agg(top_product_types),
    })

    # Per-product spend & frequency.
    base["calls_spent"]        = product_spend.get("Calls",          0).reindex(base.index, fill_value=0).round(4)
    base["esim_spent"]         = product_spend.get("Data eSIM",      0).reindex(base.index, fill_value=0).round(4)
    base["virtual_spent"]      = product_spend.get("Virtual Number", 0).reindex(base.index, fill_value=0).round(4)
    base["calls_frequency"]    = product_count.get("Calls",          0).reindex(base.index, fill_value=0).astype(int)
    base["esim_frequency"]     = product_count.get("Data eSIM",      0).reindex(base.index, fill_value=0).astype(int)
    base["virtual_frequency"]  = product_count.get("Virtual Number", 0).reindex(base.index, fill_value=0).astype(int)

    base["calls_cluster"]      = product_segment.get("Calls",          None).reindex(base.index)
    base["esim_cluster"]       = product_segment.get("Data eSIM",      None).reindex(base.index)
    base["virtual_cluster"]    = product_segment.get("Virtual Number", None).reindex(base.index)

    # Primary product = highest spend across the three.
    spend_matrix = np.column_stack([base["calls_spent"], base["esim_spent"], base["virtual_spent"]])
    primary_idx  = np.argmax(spend_matrix, axis=1)
    products     = ["Calls", "Data eSIM", "Virtual Number"]
    seg_cols     = ["calls_cluster", "esim_cluster", "virtual_cluster"]

    base["primary_product_group"] = [products[i] for i in primary_idx]
    base["segment"] = [base.iloc[r][seg_cols[i]] for r, i in enumerate(primary_idx)]

    # cluster_id from the primary product's cluster integer
    pc_calls   = product_cluster.get("Calls",          None).reindex(base.index)
    pc_esim    = product_cluster.get("Data eSIM",      None).reindex(base.index)
    pc_virtual = product_cluster.get("Virtual Number", None).reindex(base.index)
    pc_stack   = pd.DataFrame({"Calls": pc_calls, "Data eSIM": pc_esim, "Virtual Number": pc_virtual})
    base["cluster_id"] = [pc_stack.iloc[r][products[i]] for r, i in enumerate(primary_idx)]
    base["cluster_id"] = pd.array(base["cluster_id"].values, dtype=pd.Int64Dtype())

    base = base.reset_index()
    print(f"  -> {len(base):,} unique users")
    print("\nPrimary product distribution:")
    print(base["primary_product_group"].value_counts().to_string())
    print("\nSegment distribution:")
    print(base["segment"].value_counts().to_string())
    return base


def seed(csv_path: str):
    if not DATABASE_URL:
        sys.exit("ERROR: DATABASE_URL not set. Start Postgres and check your .env.")
    if not os.path.exists(csv_path):
        sys.exit(f"ERROR: CSV not found at {csv_path}")

    print(f"Loading {csv_path} ...")
    df = pd.read_csv(csv_path, encoding="utf-8", low_memory=False)
    df["purchase_date"] = pd.to_datetime(df["purchase_date"], errors="coerce")
    df["register_date"] = pd.to_datetime(df["register_date"], errors="coerce")

    users_df = aggregate_users(df)

    # Drop & re-create tables.
    engine = create_engine(DATABASE_URL, echo=False)
    with engine.connect() as conn:
        print("\nDropping existing users + cluster_runs tables...")
        conn.execute(text("DROP TABLE IF EXISTS users CASCADE"))
        conn.execute(text("DROP TABLE IF EXISTS cluster_runs CASCADE"))
        conn.commit()

    import models
    models.Base.metadata.create_all(engine)

    # Build records in the schema the User model expects.
    records = []
    for _, row in users_df.iterrows():
        def v(col, cast=None, default=None):
            val = row.get(col)
            if val is None or (not isinstance(val, str) and pd.isna(val)):
                return default
            return cast(val) if cast else val

        records.append({
            "id_client":             int(row["id_client"]),
            "user_country":          v("user_country"),
            "register_date":         v("register_date"),
            "first_purchase":        v("first_purchase"),
            "last_purchase":         v("last_purchase"),
            "recency":               v("recency", int),
            "customer_age":          v("customer_age", int),
            "total_spent":           round(v("total_spent", float, 0), 4),
            "purchase_frequency":    v("purchase_frequency", int, 0),
            "calls_spent":           round(float(row["calls_spent"]), 4),
            "esim_spent":            round(float(row["esim_spent"]), 4),
            "virtual_spent":         round(float(row["virtual_spent"]), 4),
            "calls_frequency":       int(row["calls_frequency"]),
            "esim_frequency":        int(row["esim_frequency"]),
            "virtual_frequency":     int(row["virtual_frequency"]),
            "calls_cluster":         v("calls_cluster"),
            "esim_cluster":          v("esim_cluster"),
            "virtual_cluster":       v("virtual_cluster"),
            "primary_product_group": v("primary_product_group"),
            "cluster_id":            v("cluster_id", int),
            "segment":               v("segment"),
            "product_types":         v("product_types"),
            "phone_number":          clean_phone(v("phone_number")),
            "platform":              v("platform"),
            "language":              v("language"),
            "email":                 v("email"),
        })

    BATCH = 2000
    print(f"\nInserting {len(records):,} users in batches of {BATCH}...")
    with engine.connect() as conn:
        for i in range(0, len(records), BATCH):
            batch = records[i:i + BATCH]
            conn.execute(text("""
                INSERT INTO users (
                    id_client, user_country, register_date, first_purchase, last_purchase,
                    recency, customer_age, total_spent, purchase_frequency,
                    calls_spent, esim_spent, virtual_spent,
                    calls_frequency, esim_frequency, virtual_frequency,
                    calls_cluster, esim_cluster, virtual_cluster,
                    primary_product_group, cluster_id, segment, product_types,
                    phone_number, platform, language, email
                ) VALUES (
                    :id_client, :user_country, :register_date, :first_purchase, :last_purchase,
                    :recency, :customer_age, :total_spent, :purchase_frequency,
                    :calls_spent, :esim_spent, :virtual_spent,
                    :calls_frequency, :esim_frequency, :virtual_frequency,
                    :calls_cluster, :esim_cluster, :virtual_cluster,
                    :primary_product_group, :cluster_id, :segment, :product_types,
                    :phone_number, :platform, :language, :email
                ) ON CONFLICT (id_client) DO NOTHING
            """), batch)
            conn.commit()
            print(f"  {min(i+BATCH, len(records)):,}/{len(records):,}", end="\r")

        # Cluster runs metadata.
        conn.execute(text("""
            INSERT INTO cluster_runs (run_at, n_clusters, algorithm, features_used, centroids, cluster_stats, is_active, notes)
            VALUES (NOW(), 9, 'MiniBatchKMeans (per product)',
                '["recency","customer_age","total_spent","purchase_frequency","price","product_type"]',
                '[]', '{}', true,
                'Seeded from DF_Merged_Clustered.csv — 3 clusters per product group, 9 segments total')
        """))
        conn.commit()

    print(f"\nDone. {len(records):,} users seeded.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", default=DEFAULT_CSV, help="Path to DF_Merged_Clustered.csv")
    args = parser.parse_args()
    seed(args.csv)
