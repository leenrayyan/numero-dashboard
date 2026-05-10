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

    # Foreign-key constraints on campaign_recipients. Postgres has no
    # 'ADD CONSTRAINT IF NOT EXISTS', so wrap each in a DO block that
    # silently skips when the constraint is already present (makes the
    # migration safe to re-run).
    """
    DO $$
    BEGIN
        BEGIN
            ALTER TABLE campaign_recipients
            ADD CONSTRAINT campaign_recipients_campaign_id_fkey
            FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END $$;
    """,
    """
    DO $$
    BEGIN
        BEGIN
            ALTER TABLE campaign_recipients
            ADD CONSTRAINT campaign_recipients_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id_client);
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END $$;
    """,
]

def run():
    engine = create_engine(DATABASE_URL, echo=False)
    with engine.connect() as conn:
        for sql in MIGRATIONS:
            print(f"  -> {sql[:80].strip()}...")
            conn.execute(text(sql))
        conn.commit()

    # Create new tables (campaigns, campaign_recipients) if they don't exist yet
    import models
    models.Base.metadata.create_all(engine)
    print("\nDone. All columns and tables are up to date.")

if __name__ == "__main__":
    run()
