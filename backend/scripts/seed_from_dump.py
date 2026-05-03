"""
Imports the CSVs that export_local.py produced into the live Postgres database.

Uses Postgres `COPY FROM STDIN` for bulk loading — orders of magnitude faster
than parameterised INSERTs, which matters on Render's free tier where the
startup health check times out if seeding takes too long.

Idempotent: skips loading if `users` already has rows, so calling this every
boot is fine — it only does real work the first time.

Called automatically from `main.py`'s lifespan on app startup. Can also be run
manually:  python scripts/seed_from_dump.py
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "")
SEED_DIR     = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_data")
# `cluster_runs` is intentionally not loaded — its JSON columns can't round-trip
# through csv.writer + COPY (Postgres rejects Python repr of JSON). The table
# exists (created by Base.metadata.create_all) but stays empty; nothing in the
# dashboard depends on it.
TABLES       = ["users"]


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

    # Ensure tables exist (init_db on app startup also does this, but the seed
    # may run before that depending on call order).
    import models
    from database import Base
    Base.metadata.create_all(engine)

    with engine.connect() as conn:
        existing = conn.execute(text("SELECT COUNT(*) FROM users")).scalar()
        if existing and existing > 0:
            print(f"[seed] users table already has {existing:,} rows — skipping.")
            return

    # COPY FROM STDIN — uses raw psycopg2 cursor for the fast path.
    # We commit *per table* so a failure on one table doesn't roll back rows
    # that already loaded successfully into another.
    raw_conn = engine.raw_connection()
    try:
        for table in TABLES:
            csv_path = os.path.join(SEED_DIR, f"{table}.csv")
            if not os.path.exists(csv_path):
                print(f"[seed] skipping {table}: no dump at {csv_path}")
                continue

            print(f"[seed] loading {table} from {csv_path}")
            cur = raw_conn.cursor()
            try:
                with open(csv_path, "r", encoding="utf-8") as f:
                    header = f.readline().strip()
                    cols   = header.split(",")
                    f.seek(0)  # rewind so COPY re-reads the header line
                    cur.copy_expert(
                        f'COPY {table} ({",".join(cols)}) FROM STDIN WITH CSV HEADER',
                        f,
                    )
                count = cur.rowcount
                raw_conn.commit()
                print(f"[seed]   {count:,} rows loaded into {table}")
            except Exception as e:
                raw_conn.rollback()
                print(f"[seed]   FAILED loading {table}: {type(e).__name__}: {e}")
            finally:
                cur.close()
    finally:
        raw_conn.close()

    print("[seed] complete.")


if __name__ == "__main__":
    seed()
