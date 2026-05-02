"""
Seed script: aggregates 3 product-type CSVs into one user-level table.
Primary product = highest total_spent. Cluster assigned from that product.

Usage:
    python scripts/seed.py
    # or with custom paths:
    python scripts/seed.py --calls PATH --esim PATH --virtual PATH
"""
import sys, os, argparse
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "").replace("+asyncpg", "")


def load_and_dedup(path: str, product_label: str) -> pd.DataFrame:
    """Load CSV, deduplicate to one row per user."""
    df = pd.read_csv(path, encoding="latin1")
    df["purchase_date"] = pd.to_datetime(df["purchase_date"], errors="coerce")
    df["register_date"] = pd.to_datetime(df["register_date"], errors="coerce")

    agg = df.groupby("id_client").agg(
        user_country       = ("User Country", "first"),
        register_date      = ("register_date", "min"),
        first_purchase     = ("purchase_date", "min"),
        last_purchase      = ("purchase_date", "max"),
        recency            = ("recency", "min"),
        customer_age       = ("customer_age", "min"),
        total_spent        = ("total_spent", "first"),
        purchase_frequency = ("purchase_frequency", "first"),
        cluster_id_raw     = ("cluster", "first"),
        cluster_name       = ("cluster_name", "first"),
    ).reset_index()

    agg = agg.rename(columns={
        "total_spent":        f"{product_label}_spent",
        "purchase_frequency": f"{product_label}_frequency",
        "cluster_name":       f"{product_label}_cluster",
        "cluster_id_raw":     f"{product_label}_cluster_id",
    })
    return agg


def seed(calls_path, esim_path, virtual_path):
    print("Loading CSVs...")
    calls   = load_and_dedup(calls_path,   "calls")
    esim    = load_and_dedup(esim_path,    "esim")
    virtual = load_and_dedup(virtual_path, "virtual")

    print(f"  Calls users:   {len(calls):,}")
    print(f"  eSIM users:    {len(esim):,}")
    print(f"  Virtual users: {len(virtual):,}")

    # Outer join on id_client
    df = calls.merge(esim,    on="id_client", how="outer", suffixes=("", "_e"))
    df = df.merge(virtual,    on="id_client", how="outer", suffixes=("", "_v"))

    # Consolidate duplicated shared columns from merges
    for base in ["user_country", "register_date", "first_purchase", "last_purchase", "recency", "customer_age"]:
        variants = [c for c in df.columns if c == base or c.startswith(base + "_")]
        if len(variants) > 1:
            combined = df[variants[0]]
            for v in variants[1:]:
                combined = combined.combine_first(df[v])
            df[base] = combined
            df = df.drop(columns=variants[1:])

    # Fill missing product columns
    for p in ["calls", "esim", "virtual"]:
        df[f"{p}_spent"]      = df.get(f"{p}_spent",      pd.Series(0.0, index=df.index)).fillna(0.0)
        df[f"{p}_frequency"]  = df.get(f"{p}_frequency",  pd.Series(0,   index=df.index)).fillna(0).astype(int)
        df[f"{p}_cluster"]    = df.get(f"{p}_cluster",    pd.Series(dtype=str))

    # Total aggregates
    df["total_spent"]        = df["calls_spent"] + df["esim_spent"] + df["virtual_spent"]
    df["purchase_frequency"] = df["calls_frequency"] + df["esim_frequency"] + df["virtual_frequency"]

    # Primary product = highest spend
    spend_matrix = np.column_stack([df["calls_spent"], df["esim_spent"], df["virtual_spent"]])
    primary_idx  = np.argmax(spend_matrix, axis=1)
    products     = ["Calls", "Data eSIM", "Virtual Number"]
    seg_cols     = ["calls_cluster", "esim_cluster", "virtual_cluster"]
    cid_cols     = ["calls_cluster_id", "esim_cluster_id", "virtual_cluster_id"]

    df["primary_product_group"] = [products[i] for i in primary_idx]
    df["segment"]   = [df.iloc[r][seg_cols[i]]  for r, i in enumerate(primary_idx)]
    df["cluster_id"] = pd.array(
        [df.iloc[r].get(cid_cols[i]) for r, i in enumerate(primary_idx)],
        dtype=pd.Int64Dtype()
    )

    print(f"\nTotal unique users: {len(df):,}")
    print("Primary product distribution:")
    print(df["primary_product_group"].value_counts().to_string())
    print("\nSegment distribution:")
    print(df["segment"].value_counts().to_string())

    # Recreate tables
    engine = create_engine(DATABASE_URL, echo=False)
    with engine.connect() as conn:
        conn.execute(text("DROP TABLE IF EXISTS users CASCADE"))
        conn.execute(text("DROP TABLE IF EXISTS cluster_runs CASCADE"))
        conn.commit()

    import models
    models.Base.metadata.create_all(engine)

    # Insert in batches
    BATCH = 2000
    records = []
    for _, row in df.iterrows():
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
        })

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
                    primary_product_group, cluster_id, segment
                ) VALUES (
                    :id_client, :user_country, :register_date, :first_purchase, :last_purchase,
                    :recency, :customer_age, :total_spent, :purchase_frequency,
                    :calls_spent, :esim_spent, :virtual_spent,
                    :calls_frequency, :esim_frequency, :virtual_frequency,
                    :calls_cluster, :esim_cluster, :virtual_cluster,
                    :primary_product_group, :cluster_id, :segment
                ) ON CONFLICT (id_client) DO NOTHING
            """), batch)
            conn.commit()
            print(f"  {min(i+BATCH, len(records)):,}/{len(records):,}", end="\r")

    with engine.connect() as conn:
        conn.execute(text("""
            INSERT INTO cluster_runs (run_at, n_clusters, algorithm, features_used, centroids, cluster_stats, is_active, notes)
            VALUES (NOW(), 3, 'MiniBatchKMeans',
                '["recency","customer_age","total_spent","purchase_frequency"]',
                '[]', '{}', true,
                'Seeded from DF_Calls, DF_eSIM, DF_Virtual clustered CSVs')
        """))
        conn.commit()

    print(f"\nDone! {len(records):,} users seeded.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--calls",   default="C:/Users/leenr/Downloads/DF_Calls_Clustered.csv")
    parser.add_argument("--esim",    default="C:/Users/leenr/Downloads/DF_eSIM_Clustered.csv")
    parser.add_argument("--virtual", default="C:/Users/leenr/Downloads/DF_Virtual_Clustered.csv")
    args = parser.parse_args()
    seed(args.calls, args.esim, args.virtual)
