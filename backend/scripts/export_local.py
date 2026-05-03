"""
Run this on YOUR machine, ONCE, before deploying.

Exports the `users` and `cluster_runs` tables from your local Postgres into
backend/scripts/seed_data/*.csv. The Render deploy will read those CSVs and
import them into the cloud Postgres on first boot — no need to re-run the
clustering pipeline in the cloud.

Usage:
    cd backend
    python scripts/export_local.py
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import csv

load_dotenv()

LOCAL_DB = os.getenv("DATABASE_URL", "postgresql://admin:admin123@localhost:5432/dormant_users").replace("+asyncpg", "")
OUT_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_data")

TABLES = ["users", "cluster_runs"]


def export():
    os.makedirs(OUT_DIR, exist_ok=True)
    engine = create_engine(LOCAL_DB, echo=False)

    with engine.connect() as conn:
        for table in TABLES:
            out_path = os.path.join(OUT_DIR, f"{table}.csv")
            print(f"Exporting {table} -> {out_path}")
            result = conn.execute(text(f"SELECT * FROM {table}"))
            cols = result.keys()
            rows = result.fetchall()

            with open(out_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(cols)
                for row in rows:
                    writer.writerow(row)

            print(f"  {len(rows):,} rows")

    print(f"\nDone. Now commit the seed_data folder:")
    print(f"  git add backend/scripts/seed_data")
    print(f"  git commit -m 'Add seed data dump for deploy'")


if __name__ == "__main__":
    export()
