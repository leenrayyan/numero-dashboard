"""
Offline scoring — runs the trained LightGBM models against the full purchase
history and writes a per-user `reactivation_score` into the `users` table.

Each user is scored using their primary product group's model:
  - Calls users           -> lgb_calls_T1_2025-06-01.txt
  - Data eSIM users       -> lgb_esim_multicutoff_v2.txt
  - Virtual Number users  -> lgb_virtual_multicutoff_v2.txt

The score is the model's predicted probability that an inactive customer will
reactivate within their group's M-day window. Customers who are *still active*
in their primary group (last purchase < N days before the cutoff) get NULL —
they don't need reactivation.

Usage (run from the `backend` folder, with Postgres up + .env set):
    python scripts/score_reactivation.py
    python scripts/score_reactivation.py --xlsx "C:/.../purchases.xlsx"
"""
import argparse
import os
import sys
from pathlib import Path

# Make sibling packages importable when run as `python scripts/score_reactivation.py`.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pandas as pd
import lightgbm as lgb
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

from reactivation.src.data_loading import load_purchases
from reactivation.src.features import build_full_feature_set, CATEGORICAL_COLUMNS

load_dotenv()


REACT_ROOT  = Path(__file__).resolve().parent.parent / "reactivation"
MODEL_PATHS = {
    "Calls":          REACT_ROOT / "models" / "lgb_calls_T1_2025-06-01.txt",
    "Data eSIM":      REACT_ROOT / "models" / "lgb_esim_multicutoff_v2.txt",
    "Virtual Number": REACT_ROOT / "models" / "lgb_virtual_multicutoff_v2.txt",
}
# Group-specific inactivity thresholds — match the notebooks. Customers whose
# last purchase is < N days before the cutoff are still active and get NULL.
INACTIVITY_DAYS = {"Calls": 90, "Virtual Number": 45, "Data eSIM": 120}
# eSIM model was trained with the BG/NBD `p_alive` feature.
USE_BGNBD = {"Calls": False, "Data eSIM": True, "Virtual Number": False}

DEFAULT_XLSX = Path(r"C:/Users/leenr/Desktop/GP/Numero eSIM_purchases [2024 - 2025].xlsx")


def normalize_db_url(url: str) -> str:
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return url.replace("+asyncpg", "")


def prep_lgb_features(feats: pd.DataFrame, model: lgb.Booster) -> pd.DataFrame:
    """Reshape a feature frame to match the trained model's expected columns,
    casting categoricals so LightGBM uses its native categorical handling."""
    expected = list(model.feature_name())
    f = feats.copy()
    # Add `cutoff_month` if the model was trained with it (multi-cutoff models).
    if "cutoff_month" in expected and "cutoff_month" not in f.columns:
        f["cutoff_month"] = pd.Timestamp(CUTOFF_GLOBAL).month
    # Drop unexpected columns and reindex; missing-but-expected columns become NaN.
    f = f.reindex(columns=expected)
    for col in CATEGORICAL_COLUMNS:
        if col in f.columns:
            f[col] = f[col].astype("category")
    return f


CUTOFF_GLOBAL: pd.Timestamp = None  # filled in score_group()


def score_group(df_purchases: pd.DataFrame, group: str, cutoff: pd.Timestamp) -> pd.DataFrame:
    """Score every customer whose primary product group is `group` AND who is
    inactive at `cutoff`. Returns a DataFrame with id_client + score columns."""
    global CUTOFF_GLOBAL
    CUTOFF_GLOBAL = cutoff

    n_days = INACTIVITY_DAYS[group]
    print(f"\n[{group}] cutoff={cutoff.date()}  inactivity threshold N={n_days}d")

    feats = build_full_feature_set(
        df_purchases, cutoff, group=group,
        include_bgnbd=USE_BGNBD[group],
    )
    if feats.empty:
        print(f"  no pre-cutoff customers for {group} — skipping")
        return pd.DataFrame(columns=["id_client", "reactivation_score"])
    print(f"  feature matrix: {feats.shape}")

    inactive = feats["days_since_last"] >= n_days
    feats = feats[inactive]
    print(f"  inactive subset:    {feats.shape[0]:,} customers")
    if feats.empty:
        return pd.DataFrame(columns=["id_client", "reactivation_score"])

    model = lgb.Booster(model_file=str(MODEL_PATHS[group]))
    X = prep_lgb_features(feats, model)
    scores = model.predict(X)

    out = pd.DataFrame({
        "id_client": feats.index,
        "reactivation_score": scores.astype(float),
    })
    print(f"  scored:             {len(out):,}  | mean={scores.mean():.3f}  p90={np.quantile(scores, 0.9):.3f}")
    return out


def upsert_scores(engine, scores: pd.DataFrame):
    """Write reactivation_score for every (id_client, score) pair via UPDATE."""
    if scores.empty:
        return 0
    rows = scores.to_dict("records")
    with engine.connect() as conn:
        # Reset everyone first so customers no longer in the inactive set get
        # their stale score cleared (e.g. they reactivated since last run).
        conn.execute(text("UPDATE users SET reactivation_score = NULL"))
        # Batch UPDATEs.
        BATCH = 2000
        for i in range(0, len(rows), BATCH):
            conn.execute(text("""
                UPDATE users
                   SET reactivation_score = :reactivation_score
                 WHERE id_client = :id_client
            """), rows[i:i + BATCH])
            print(f"  upserted {min(i + BATCH, len(rows)):,}/{len(rows):,}", end="\r")
        conn.commit()
    return len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", default=str(DEFAULT_XLSX),
                    help="Path to the purchases xlsx.")
    args = ap.parse_args()

    db_url = normalize_db_url(os.getenv("DATABASE_URL", ""))
    if not db_url:
        sys.exit("ERROR: DATABASE_URL not set.")
    engine = create_engine(db_url, echo=False)

    print(f"Loading purchases: {args.xlsx}")
    df = load_purchases(args.xlsx)
    print(f"  rows={len(df):,}  range={df['purchase_date'].min().date()} -> {df['purchase_date'].max().date()}")

    # Use one day after the last observed purchase as the scoring "cutoff".
    cutoff = df["purchase_date"].max() + pd.Timedelta(days=1)

    # Score each group, then keep only the score from each user's *primary*
    # product group so every user gets at most one row.
    print("\nFetching primary_product_group from Postgres…")
    primary = pd.read_sql(text("SELECT id_client, primary_product_group FROM users"), engine)
    print(f"  {len(primary):,} users in DB")

    pieces = []
    for group, model_path in MODEL_PATHS.items():
        if not model_path.exists():
            print(f"\n[{group}] missing model at {model_path} — skipping")
            continue
        scored = score_group(df, group, cutoff)
        scored = scored.merge(primary, on="id_client", how="inner")
        scored = scored[scored["primary_product_group"] == group]
        pieces.append(scored[["id_client", "reactivation_score"]])

    final = pd.concat(pieces, ignore_index=True) if pieces else pd.DataFrame()
    final = final.dropna(subset=["reactivation_score"])
    print(f"\nTotal scores to write: {len(final):,}")
    if final.empty:
        print("Nothing to upsert.")
        return

    written = upsert_scores(engine, final)
    print(f"\nDone. {written:,} reactivation_score values written.")


if __name__ == "__main__":
    main()
