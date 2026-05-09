"""
Ingest reactivation scores from a CSV produced by the team's notebook into
the dashboard's `users` table.

The team retrains the reactivation Random Forest in
`cluster-reactivation-pipelines-v2.ipynb` and exports
`dormant_customers_scored.csv` (id_client, reactivation_probability, ...).
This script reads that file and:

  1. UPDATE users SET reactivation_score = :prob WHERE id_client = :uid
     for each row in the CSV.
  2. SET reactivation_score = NULL for every other user. NULL means "still
     active in their primary product, no reactivation needed" — the dashboard
     renders that as a green "Active" badge.

Score format: stored as a probability in [0, 1] (matches the schema's
`Column(Float)` comment "0-1 probability"). The CSV's `reactivation_score`
column is the same value × 100 (a percentage); we use `reactivation_probability`.

Usage:
    cd backend
    python scripts/ingest_reactivation_scores.py
    python scripts/ingest_reactivation_scores.py path/to/dormant_customers_scored.csv

Default path is `~/Downloads/dormant_customers_scored.csv` (where the notebook
saves it). Pass an explicit path if you keep the file elsewhere.

The percentile cutoffs that drive the dashboard's HIGH/MEDIUM/LOW badge are
NOT stored here — they're computed on the fly by the analytics endpoint
(/api/analytics/reactivation-cutoffs) so they always reflect the current
score distribution. Re-running this ingest with new scores → cutoffs update
automatically.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DEFAULT_CSV = Path.home() / "Downloads" / "dormant_customers_scored.csv"
BATCH_SIZE = 5_000


def _connect():
    """Open a synchronous SQLAlchemy engine. We use sync (not async) here
    because the ingest is a one-shot script — no event loop, no concurrency,
    just a couple of bulk updates."""
    url = os.getenv("DATABASE_URL", "postgresql://admin:admin123@localhost:5432/dormant_users")
    # Force psycopg2 driver for sync usage.
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    return create_engine(url, future=True)


def ingest(csv_path: Path) -> None:
    if not csv_path.exists():
        sys.exit(f"ERROR: scored CSV not found at {csv_path}")

    print(f"Reading {csv_path} ...")
    df = pd.read_csv(csv_path, usecols=["id_client", "reactivation_probability"])
    if df.empty:
        sys.exit("ERROR: scored CSV is empty.")

    df = df.dropna(subset=["id_client", "reactivation_probability"])
    df["id_client"] = df["id_client"].astype("int64")
    df["reactivation_probability"] = df["reactivation_probability"].astype(float)
    n_rows = len(df)
    print(f"  {n_rows:,} dormant users with scores")

    engine = _connect()
    with engine.begin() as conn:
        # Bulk-clear the column so any user not in the CSV reverts to NULL
        # ("still active, no reactivation needed"). Safer than diffing the
        # set of ids — keeps the table strictly consistent with the latest
        # scoring run.
        result = conn.execute(text("UPDATE users SET reactivation_score = NULL"))
        cleared = result.rowcount or 0
        print(f"  cleared {cleared:,} existing scores")

        # Apply the new scores in chunks. ~96K rows go through in seconds.
        records = df.to_dict(orient="records")
        for i in range(0, n_rows, BATCH_SIZE):
            batch = records[i : i + BATCH_SIZE]
            conn.execute(
                text(
                    "UPDATE users SET reactivation_score = :p "
                    "WHERE id_client = :uid"
                ),
                [{"uid": r["id_client"], "p": r["reactivation_probability"]} for r in batch],
            )
            print(f"  applied {min(i + BATCH_SIZE, n_rows):,}/{n_rows:,}")

        # Sanity counts + cutoffs — query inside the txn so the values are
        # post-update, then commit by exiting the `with` block. ALL printing
        # is done AFTER the block so that a Windows-console encoding error on
        # any unicode character can't roll back the data updates.
        scored = conn.execute(
            text("SELECT count(*) FROM users WHERE reactivation_score IS NOT NULL")
        ).scalar() or 0
        active = conn.execute(
            text("SELECT count(*) FROM users WHERE reactivation_score IS NULL")
        ).scalar() or 0
        cutoffs = conn.execute(
            text(
                "SELECT "
                "  percentile_cont(0.50) WITHIN GROUP (ORDER BY reactivation_score) AS p50, "
                "  percentile_cont(0.80) WITHIN GROUP (ORDER BY reactivation_score) AS p80 "
                "FROM users WHERE reactivation_score IS NOT NULL"
            )
        ).fetchone()
    # ── transaction committed; from here on, prints can fail without harm ──
    print()
    print(f"  scored : {scored:>8,}  (dormant, model produced a probability)")
    print(f"  active : {active:>8,}  (NULL -> dashboard renders as 'Active')")
    if cutoffs and cutoffs.p80 is not None:
        print()
        print("  Bucket cutoffs (live from the data):")
        print(f"    HIGH   >= {cutoffs.p80:.3f}  (top 20%)")
        print(f"    MEDIUM >= {cutoffs.p50:.3f}  (next 30%)")
        print(f"    LOW    <  {cutoffs.p50:.3f}  (bottom 50%)")
    print()
    print("done.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("csv", nargs="?", type=Path, default=DEFAULT_CSV,
                    help=f"Path to dormant_customers_scored.csv (default: {DEFAULT_CSV})")
    args = ap.parse_args()
    ingest(args.csv)


if __name__ == "__main__":
    main()
