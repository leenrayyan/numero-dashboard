"""
Train Vanna on the new schema (3 product-type clusters, one row per user).
Run AFTER seed.py.
Usage: python scripts/train_vanna.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vanna_gemini import get_vanna

DDL = """
CREATE TABLE users (
    id_client             BIGINT PRIMARY KEY,
    user_country          TEXT,
    register_date         TIMESTAMP,
    first_purchase        TIMESTAMP,
    last_purchase         TIMESTAMP,

    -- Aggregated across all products
    recency               INTEGER,  -- days since most recent purchase (lower = more recent)
    customer_age          INTEGER,  -- days since registration
    total_spent           FLOAT,    -- total spend across all product types
    purchase_frequency    INTEGER,  -- total purchases across all product types

    -- Per-product spend
    calls_spent           FLOAT,    -- total spend on Calls/Recharge products
    esim_spent            FLOAT,    -- total spend on Data eSIM products
    virtual_spent         FLOAT,    -- total spend on Virtual Number products

    -- Per-product frequency
    calls_frequency       INTEGER,
    esim_frequency        INTEGER,
    virtual_frequency     INTEGER,

    -- Per-product cluster names (MiniBatchKMeans k=3 per product)
    calls_cluster         TEXT,  -- 'High Value Loyal', 'Mid Value At-Risk', 'Low Value Active'
    esim_cluster          TEXT,  -- 'High Value Customers', 'Churned / At-Risk Users', 'New / Low-Value Active Users'
    virtual_cluster       TEXT,  -- 'High Value At-Risk', 'Occasional High Spenders', 'Low Value Active'

    -- Primary product (where user spent most) and its cluster
    primary_product_group TEXT,  -- 'Calls', 'Data eSIM', or 'Virtual Number'
    cluster_id            INTEGER,
    segment               TEXT   -- cluster name from primary product
);
"""

QA_PAIRS = [
    ("How many users are there in total?",
     "SELECT COUNT(*) AS total_users FROM users;"),

    ("How many users are in each segment?",
     "SELECT segment, COUNT(*) AS user_count FROM users GROUP BY segment ORDER BY user_count DESC;"),

    ("Show me High Value Loyal users",
     "SELECT id_client, total_spent, purchase_frequency, recency, user_country FROM users WHERE segment = 'High Value Loyal' ORDER BY total_spent DESC LIMIT 50;"),

    ("Show me Churned or At-Risk users",
     "SELECT id_client, total_spent, recency, esim_spent, segment FROM users WHERE segment = 'Churned / At-Risk Users' ORDER BY recency DESC LIMIT 50;"),

    ("Who are the High Value At-Risk virtual number users?",
     "SELECT id_client, virtual_spent, virtual_frequency, recency FROM users WHERE segment = 'High Value At-Risk' ORDER BY virtual_spent DESC LIMIT 50;"),

    ("Show users by primary product group",
     "SELECT primary_product_group, COUNT(*) AS user_count, AVG(total_spent) AS avg_spend FROM users GROUP BY primary_product_group ORDER BY user_count DESC;"),

    ("Which users haven't purchased in over a year?",
     "SELECT id_client, segment, recency, total_spent, primary_product_group FROM users WHERE recency > 365 ORDER BY recency DESC LIMIT 50;"),

    ("Show me high spenders across all products",
     "SELECT id_client, total_spent, calls_spent, esim_spent, virtual_spent, segment FROM users ORDER BY total_spent DESC LIMIT 50;"),

    ("Find eSIM users with high spend",
     "SELECT id_client, esim_spent, esim_frequency, esim_cluster, recency FROM users WHERE esim_spent > 0 ORDER BY esim_spent DESC LIMIT 50;"),

    ("Show users who buy all three product types",
     "SELECT id_client, calls_spent, esim_spent, virtual_spent, total_spent, segment FROM users WHERE calls_frequency > 0 AND esim_frequency > 0 AND virtual_frequency > 0 ORDER BY total_spent DESC LIMIT 50;"),

    ("What is the average spend per segment?",
     "SELECT segment, AVG(total_spent) AS avg_spend, COUNT(*) AS user_count FROM users GROUP BY segment ORDER BY avg_spend DESC;"),

    ("Show Mid Value At-Risk calls users",
     "SELECT id_client, calls_spent, calls_frequency, recency, total_spent FROM users WHERE segment = 'Mid Value At-Risk' ORDER BY calls_spent DESC LIMIT 50;"),

    ("Find users who are most recently active",
     "SELECT id_client, recency, total_spent, segment, primary_product_group FROM users ORDER BY recency ASC LIMIT 50;"),

    ("Show Occasional High Spenders on virtual numbers",
     "SELECT id_client, virtual_spent, virtual_frequency, recency FROM users WHERE segment = 'Occasional High Spenders' ORDER BY virtual_spent DESC LIMIT 50;"),

    ("Which countries have the most dormant users?",
     "SELECT user_country, COUNT(*) AS user_count, AVG(total_spent) AS avg_spend FROM users GROUP BY user_country ORDER BY user_count DESC LIMIT 20;"),

    ("Show new or low value active eSIM users",
     "SELECT id_client, esim_spent, esim_frequency, recency, customer_age FROM users WHERE segment = 'New / Low-Value Active Users' ORDER BY recency ASC LIMIT 50;"),

    ("Find users with high virtual spend but long recency",
     "SELECT id_client, virtual_spent, recency, segment FROM users WHERE virtual_spent > 30 AND recency > 300 ORDER BY virtual_spent DESC LIMIT 50;"),
]


def main():
    print("Connecting to Vanna...")
    vn = get_vanna()

    print("Training on DDL...")
    vn.train(ddl=DDL)

    print(f"Training on {len(QA_PAIRS)} Q&A pairs...")
    for i, (q, sql) in enumerate(QA_PAIRS, 1):
        vn.train(question=q, sql=sql)
        print(f"  [{i}/{len(QA_PAIRS)}] {q[:60]}")

    print("\nVanna training complete!")


if __name__ == "__main__":
    main()
