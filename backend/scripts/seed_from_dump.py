"""
Runs ONCE on Render after first deploy. Imports the CSVs that export_local.py
produced into the live Postgres database.

Idempotent: skips loading if `users` already has rows, so re-running on
subsequent deploys is a no-op.

Render invokes this via the `predeploy` hook in render.yaml.
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text
import csv

DATABASE_URL = os.getenv("DATABASE_URL", "")
SEED_DIR     = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_data")
TABLES       = ["users", "cluster_runs"]


def normalize_url(url: str) -> str:
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    # Strip the asyncpg driver suffix if someone passed it in.
    return url.replace("+asyncpg", "")


def seed():
    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set. Render normally provides this automatically.")
        sys.exit(1)

    engine = create_engine(normalize_url(DATABASE_URL), echo=False)

    # Ensure tables exist (init_db on app startup also does this, but predeploy
    # hooks run before the app starts).
    import models
    from database import Base
    Base.metadata.create_all(engine)

    with engine.connect() as conn:
        existing = conn.execute(text("SELECT COUNT(*) FROM users")).scalar()
        if existing and existing > 0:
            print(f"users table already has {existing:,} rows — skipping seed.")
            return

        for table in TABLES:
            csv_path = os.path.join(SEED_DIR, f"{table}.csv")
            if not os.path.exists(csv_path):
                print(f"  Skipping {table} (no dump at {csv_path})")
                continue

            print(f"Loading {table} from {csv_path}")
            with open(csv_path, "r", encoding="utf-8") as f:
                reader = csv.reader(f)
                cols = next(reader)
                rows = list(reader)

            if not rows:
                print(f"  {table}: empty dump, skipping")
                continue

            placeholders = ", ".join(f":{c}" for c in cols)
            stmt = text(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders}) ON CONFLICT DO NOTHING")

            BATCH = 1000
            total = 0
            for i in range(0, len(rows), BATCH):
                batch = [
                    {c: (None if v == "" else v) for c, v in zip(cols, r)}
                    for r in rows[i:i + BATCH]
                ]
                conn.execute(stmt, batch)
                conn.commit()
                total += len(batch)
                print(f"  {total:,}/{len(rows):,}", end="\r")
            print(f"  {total:,} rows loaded into {table}")

    print("Seed complete.")


if __name__ == "__main__":
    seed()
