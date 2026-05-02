"""
DB migration: adds columns introduced after the initial seed.
Safe to run multiple times — uses ALTER TABLE ... IF NOT EXISTS.

Usage:
    python scripts/migrate.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "").replace("+asyncpg", "")

MIGRATIONS = [
    # Users — campaign & reactivation tracking columns
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_opted_in BOOLEAN DEFAULT TRUE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_campaign_at TIMESTAMP",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS campaigns_sent INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS reactivation_score FLOAT",
]

def run():
    engine = create_engine(DATABASE_URL, echo=False)
    with engine.connect() as conn:
        for sql in MIGRATIONS:
            print(f"  → {sql[:80]}...")
            conn.execute(text(sql))
        conn.commit()

    # Create new tables (campaigns, campaign_recipients) if they don't exist yet
    import models
    models.Base.metadata.create_all(engine)
    print("\nDone. All columns and tables are up to date.")

if __name__ == "__main__":
    run()
