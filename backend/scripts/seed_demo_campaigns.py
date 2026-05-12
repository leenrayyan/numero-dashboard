"""
Seed demo campaigns + recipients for dashboard screenshots.

Inserts 8 campaigns (one per segment) with realistic delivery / read /
reply / conversion counts. Idempotent: re-running deletes any prior
demo rows first.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_batch
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
URL = os.getenv("DATABASE_URL").replace("+asyncpg", "")

CAMPAIGNS = [
    # (name, offer_code, segment, n_recipients, days_ago)
    ("Casual Caller Trial",      "CALL20",   "Calls - Infrequent Casual Users",        600,  9),
    ("Loyal Caller Boost",       "CALL5",    "Calls - Regular Calling Offer Users",    250,  4),
    ("Travel Data Welcome Back", "SAVEBIG",  "eSIM - Dormant Local Data Users",        800, 11),
    ("VIP Bundle Renewal",       "TRAVEL5",  "eSIM - High-Value Bundle Subscribers",   200,  2),
    ("Frequent Buyer Upsell",    "ONLINE5",  "eSIM - High-Velocity Light Spenders",    180,  7),
    ("Phone Plan Recovery",      "NUMBER20", "Virtual - Light Occasional Users",      1500, 14),
    ("Mid-Tier EU Bundle Push",  "NUMBER10", "Virtual - Mid-Tier Phone Plan Holders",  400,  6),
    ("Power User VIP Re-engagement", "NUMBER5", "Virtual - High-Spend Power Users",    250,  3),
]


def funnel(n: int) -> tuple[int, int, int, int]:
    """Returns (delivered, read, replied, converted) given total sent."""
    delivered = int(n * 0.96)
    read      = int(delivered * 0.75)
    replied   = int(read * 0.30)
    converted = int(replied * 0.35)
    return delivered, read, replied, converted


def main():
    conn = psycopg2.connect(URL)
    cur = conn.cursor()

    # Wipe any prior demo rows first (cascades to recipients via FK)
    cur.execute("DELETE FROM campaigns WHERE name = ANY(%s)", ([c[0] for c in CAMPAIGNS],))
    conn.commit()
    print(f"cleared {cur.rowcount} prior demo campaigns")

    for name, offer_code, segment, n, days_ago in CAMPAIGNS:
        delivered, read_, replied, converted = funnel(n)
        sent_at = datetime.utcnow() - timedelta(days=days_ago)

        cur.execute("""
            INSERT INTO campaigns (name, offer_code, message_template, segment_filter, status,
                                   sent_at, total_targeted, sent_count, delivered_count,
                                   read_count, replied_count, converted_count, created_at)
            VALUES (%s, %s, %s, %s, 'sent', %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            name, offer_code,
            "Hi {{name}}! We've got a special offer to welcome you back to Numero. Reply YES to claim.",
            segment, sent_at, n, n, delivered, read_, replied, converted,
            sent_at - timedelta(hours=2),
        ))
        camp_id = cur.fetchone()[0]

        cur.execute("SELECT id_client FROM users WHERE segment = %s LIMIT %s", (segment, n))
        user_ids = [r[0] for r in cur.fetchall()]

        rows = []
        for i, uid in enumerate(user_ids):
            if i < converted:
                status = "converted"
                d_at, r_at, rp_at, c_at = (
                    sent_at + timedelta(minutes=5),
                    sent_at + timedelta(hours=1),
                    sent_at + timedelta(hours=2),
                    sent_at + timedelta(hours=20),
                )
            elif i < replied:
                status = "replied"
                d_at, r_at, rp_at, c_at = (
                    sent_at + timedelta(minutes=5),
                    sent_at + timedelta(hours=1),
                    sent_at + timedelta(hours=2),
                    None,
                )
            elif i < read_:
                status = "read"
                d_at, r_at, rp_at, c_at = (
                    sent_at + timedelta(minutes=5),
                    sent_at + timedelta(hours=1),
                    None, None,
                )
            elif i < delivered:
                status = "delivered"
                d_at, r_at, rp_at, c_at = (
                    sent_at + timedelta(minutes=5),
                    None, None, None,
                )
            else:
                status = "sent"
                d_at = r_at = rp_at = c_at = None

            rows.append((
                camp_id, uid, f"wamid.demo_c{camp_id}_{i:06d}",
                "0000000000", status,
                sent_at, d_at, r_at, rp_at, c_at,
            ))

        execute_batch(cur, """
            INSERT INTO campaign_recipients (campaign_id, user_id, wa_message_id, phone_number,
                                              status, sent_at, delivered_at, read_at, replied_at,
                                              converted_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, rows, page_size=1000)
        conn.commit()

        print(f"  {name:<35} {n:>5} recipients  -> {delivered}/{read_}/{replied}/{converted} d/r/rp/c")

    conn.close()
    print("done.")


if __name__ == "__main__":
    main()
