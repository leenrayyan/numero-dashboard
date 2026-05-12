from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from database import get_db
from filter_helpers import build_where, aggregate_columns

router = APIRouter()

FILTER_PARAMS = dict(
    segment       = Query(None),
    min_recency   = Query(None),
    max_recency   = Query(None),
    user_ids      = Query(None),
    country       = Query(None),
    product_group = Query(None),
    spend_min     = Query(None),
    spend_max     = Query(None),
)


def _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max,
       platform=None, language=None, audience=None):
    return build_where(segment, min_recency, max_recency, user_ids, country, product_group,
                       spend_min, spend_max, platform=platform, language=language, audience=audience)


@router.get("/overview")
async def get_overview(
    db: AsyncSession = Depends(get_db),
    segment: Optional[str]   = Query(None),
    min_recency: Optional[int]   = Query(None),
    max_recency: Optional[int]   = Query(None),
    user_ids: Optional[str]      = Query(None),
    country: Optional[str]       = Query(None),
    product_group: Optional[str] = Query(None),
    spend_min: Optional[float]   = Query(None),
    spend_max: Optional[float]   = Query(None),
    platform: Optional[str]      = Query(None),
    language: Optional[str]      = Query(None),
    audience: Optional[str]      = Query(None),
):
    where, params = _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max, platform, language, audience)
    # When exactly one product is filtered, swap to per-product KPI columns so
    # "Calls customer revenue" doesn't quietly include their Virtual spend.
    cols = aggregate_columns(product_group)
    row = (await db.execute(text(f"""
        SELECT
            COUNT(*)                  AS total,
            AVG({cols['spend']})      AS avg_monetary,
            SUM({cols['spend']})      AS total_monetary,
            AVG({cols['recency']})    AS avg_recency,
            AVG({cols['frequency']})  AS avg_frequency,
            AVG({cols['aov']})        AS avg_aov,
            AVG(customer_age)         AS avg_customer_age,
            AVG(reactivation_score)   AS avg_reactivation_score,
            COUNT(reactivation_score) AS scored_users
        FROM users WHERE {where}
    """), params)).fetchone()

    return {
        "total_users":          row.total or 0,
        "dormant_users":        row.total or 0,
        "avg_revenue_per_user": round(row.avg_monetary or 0, 2),
        "total_revenue":        round(row.total_monetary or 0, 2),
        "avg_recency_days":     round(row.avg_recency or 0, 0),
        "avg_frequency":        round(row.avg_frequency or 0, 1),
        "avg_aov":              round(row.avg_aov or 0, 2),
        "avg_customer_age_days": round(row.avg_customer_age or 0, 0),
        # `avg_reactivation_score` is None until the ML model populates the column.
        # Frontend uses None to show a "model not ready" placeholder on the KPI card.
        "avg_reactivation_score": (
            round(row.avg_reactivation_score, 3) if row.avg_reactivation_score is not None else None
        ),
        "scored_users":         row.scored_users or 0,
    }


@router.get("/activity-trend")
async def get_activity_trend(
    db: AsyncSession = Depends(get_db),
    segment: Optional[str]   = Query(None),
    min_recency: Optional[int]   = Query(None),
    max_recency: Optional[int]   = Query(None),
    user_ids: Optional[str]      = Query(None),
    country: Optional[str]       = Query(None),
    product_group: Optional[str] = Query(None),
    spend_min: Optional[float]   = Query(None),
    spend_max: Optional[float]   = Query(None),
    platform: Optional[str]      = Query(None),
    language: Optional[str]      = Query(None),
    audience: Optional[str]      = Query(None),
):
    where, params = _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max, platform, language, audience)
    cols = aggregate_columns(product_group)
    result = await db.execute(text(f"""
        SELECT DATE_TRUNC('month', last_purchase) AS month,
               COUNT(*) AS user_count, AVG({cols['spend']}) AS avg_spend
        FROM users WHERE last_purchase IS NOT NULL AND {where}
        GROUP BY 1 ORDER BY 1
    """), params)
    return [
        {"month": r.month.strftime("%b %Y") if r.month else None,
         "user_count": r.user_count, "avg_spend": round(r.avg_spend or 0, 2)}
        for r in result.fetchall()
    ]


@router.get("/dormant-weekly")
async def get_dormant_by_recency(
    db: AsyncSession = Depends(get_db),
    segment: Optional[str]   = Query(None),
    min_recency: Optional[int]   = Query(None),
    max_recency: Optional[int]   = Query(None),
    user_ids: Optional[str]      = Query(None),
    country: Optional[str]       = Query(None),
    product_group: Optional[str] = Query(None),
    spend_min: Optional[float]   = Query(None),
    spend_max: Optional[float]   = Query(None),
    platform: Optional[str]      = Query(None),
    language: Optional[str]      = Query(None),
    audience: Optional[str]      = Query(None),
):
    where, params = _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max, platform, language, audience)
    # Bucket by per-product recency when filtered to one product so the
    # "How dormant" view reflects activity in THAT product (not the user's
    # most recent purchase across any product).
    cols = aggregate_columns(product_group)
    rcol = cols["recency"]
    result = await db.execute(text(f"""
        SELECT CASE
            WHEN {rcol} BETWEEN 0   AND 89  THEN '0-90d'
            WHEN {rcol} BETWEEN 90  AND 179 THEN '90-180d'
            WHEN {rcol} BETWEEN 180 AND 364 THEN '180-365d'
            WHEN {rcol} >= 365              THEN '365d+'
        END AS bucket, COUNT(*) AS count
        FROM users WHERE {where}
        GROUP BY 1 ORDER BY MIN({rcol})
    """), params)
    return [{"week": r.bucket, "count": r.count} for r in result.fetchall() if r.bucket]


@router.get("/reactivation-distribution")
async def get_reactivation_distribution(
    db: AsyncSession = Depends(get_db),
    segment: Optional[str]       = Query(None),
    min_recency: Optional[int]   = Query(None),
    max_recency: Optional[int]   = Query(None),
    user_ids: Optional[str]      = Query(None),
    country: Optional[str]       = Query(None),
    product_group: Optional[str] = Query(None),
    spend_min: Optional[float]   = Query(None),
    spend_max: Optional[float]   = Query(None),
    platform: Optional[str]      = Query(None),
    language: Optional[str]      = Query(None),
    audience: Optional[str]      = Query(None),
):
    """Histogram of reactivation_score in 10 deciles (0-10%, 10-20%, ..., 90-100%).
    Returns one bucket per decile plus the count of un-scored users (still active
    in their primary product group)."""
    where, params = _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max, platform, language, audience)

    # 10 deciles. We want all 10 buckets returned even when empty so the chart
    # axis is stable, so we generate the bucket labels in Python and LEFT JOIN.
    bucket_rows = (await db.execute(text(f"""
        WITH deciles AS (
            SELECT
                LEAST(FLOOR(reactivation_score * 10)::int, 9) AS bucket,
                COUNT(*) AS users
            FROM users
            WHERE reactivation_score IS NOT NULL AND {where}
            GROUP BY 1
        )
        SELECT bucket, users FROM deciles ORDER BY bucket
    """), params)).fetchall()

    counts = {r.bucket: r.users for r in bucket_rows}
    buckets = [
        {
            "bucket": i,
            "label":  f"{i*10}–{(i+1)*10}%",
            "min":    i / 10,
            "max":    (i + 1) / 10,
            "users":  counts.get(i, 0),
        }
        for i in range(10)
    ]

    null_count = (await db.execute(text(f"""
        SELECT COUNT(*) FROM users
        WHERE reactivation_score IS NULL AND {where}
    """), params)).scalar() or 0

    return {
        "buckets": buckets,
        "null_count": null_count,
        "scored": sum(b["users"] for b in buckets),
    }


@router.get("/segment-trend")
async def get_segment_trend(
    db: AsyncSession = Depends(get_db),
    segment: Optional[str]       = Query(None),
    min_recency: Optional[int]   = Query(None),
    max_recency: Optional[int]   = Query(None),
    user_ids: Optional[str]      = Query(None),
    country: Optional[str]       = Query(None),
    product_group: Optional[str] = Query(None),
    spend_min: Optional[float]   = Query(None),
    spend_max: Optional[float]   = Query(None),
    platform: Optional[str]      = Query(None),
    language: Optional[str]      = Query(None),
    audience: Optional[str]      = Query(None),
):
    """Monthly user counts split by segment — feeds the stacked-area trend chart."""
    where, params = _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max, platform, language, audience)
    result = await db.execute(text(f"""
        SELECT DATE_TRUNC('month', last_purchase) AS month,
               segment, COUNT(*) AS user_count
        FROM users
        WHERE last_purchase IS NOT NULL AND segment IS NOT NULL AND {where}
        GROUP BY 1, 2 ORDER BY 1
    """), params)

    by_month: dict[str, dict] = {}
    segments_seen: set[str] = set()
    for r in result.fetchall():
        if not r.month:
            continue
        key = r.month.strftime("%b %Y")
        bucket = by_month.setdefault(key, {"month": key})
        bucket[r.segment] = r.user_count
        segments_seen.add(r.segment)

    return {
        "segments": sorted(segments_seen),
        "data":     list(by_month.values()),
    }


@router.get("/segment-summary")
async def get_segment_summary(
    db: AsyncSession = Depends(get_db),
    segment: Optional[str]   = Query(None),
    min_recency: Optional[int]   = Query(None),
    max_recency: Optional[int]   = Query(None),
    user_ids: Optional[str]      = Query(None),
    country: Optional[str]       = Query(None),
    product_group: Optional[str] = Query(None),
    spend_min: Optional[float]   = Query(None),
    spend_max: Optional[float]   = Query(None),
    platform: Optional[str]      = Query(None),
    language: Optional[str]      = Query(None),
    audience: Optional[str]      = Query(None),
):
    where, params = _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max, platform, language, audience)
    cols = aggregate_columns(product_group)
    result = await db.execute(text(f"""
        SELECT cluster_id, segment, COUNT(*) AS user_count,
               AVG({cols['spend']}) AS avg_monetary, AVG({cols['recency']}) AS avg_recency,
               AVG({cols['frequency']}) AS avg_frequency
        FROM users WHERE {where}
        GROUP BY cluster_id, segment ORDER BY cluster_id
    """), params)
    return [
        {"cluster_id": r.cluster_id, "segment": r.segment, "user_count": r.user_count,
         "avg_monetary": round(r.avg_monetary or 0, 2), "avg_recency": round(r.avg_recency or 0, 0),
         "avg_frequency": round(r.avg_frequency or 0, 1)}
        for r in result.fetchall()
    ]


@router.get("/audience-breakdown")
async def get_audience_breakdown(
    db: AsyncSession = Depends(get_db),
    segment: Optional[str]       = Query(None),
    min_recency: Optional[int]   = Query(None),
    max_recency: Optional[int]   = Query(None),
    user_ids: Optional[str]      = Query(None),
    country: Optional[str]       = Query(None),
    product_group: Optional[str] = Query(None),
    spend_min: Optional[float]   = Query(None),
    spend_max: Optional[float]   = Query(None),
    platform: Optional[str]      = Query(None),
    language: Optional[str]      = Query(None),
    audience: Optional[str]      = Query(None),
    top_countries: int           = Query(8, ge=1, le=30),
):
    """Top countries / platform split / language split for the *currently
    filtered* audience. Powers the right-side panel on Dormant Users."""
    where, params = _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max, platform, language, audience)

    # Total in current filter (denominator for percentages)
    total_row = await db.execute(text(f"SELECT COUNT(*) AS n FROM users WHERE {where}"), params)
    total = total_row.scalar() or 0

    countries_q = await db.execute(text(f"""
        SELECT user_country AS k, COUNT(*) AS n
        FROM users WHERE {where} AND user_country IS NOT NULL
        GROUP BY user_country ORDER BY n DESC LIMIT :top
    """), {**params, "top": top_countries})

    platforms_q = await db.execute(text(f"""
        SELECT platform AS k, COUNT(*) AS n
        FROM users WHERE {where} AND platform IS NOT NULL
        GROUP BY platform ORDER BY n DESC
    """), params)

    languages_q = await db.execute(text(f"""
        SELECT language AS k, COUNT(*) AS n
        FROM users WHERE {where} AND language IS NOT NULL
        GROUP BY language ORDER BY n DESC LIMIT 6
    """), params)

    # Recency / spend buckets — match the GlobalFilterBar bucket boundaries
    # so the marketer's mental model is consistent across the dashboard.
    recency_buckets = [("0-90d", 0, 90), ("90-180d", 90, 180),
                       ("180-365d", 180, 365), ("1-2y", 365, 730),
                       ("2y+", 730, 99999)]
    spend_buckets   = [("<$10", 0, 10), ("$10-50", 10, 50),
                       ("$50-100", 50, 100), ("$100-250", 100, 250),
                       ("$250+", 250, 9999999)]

    async def bucket_counts(col, buckets):
        out = []
        for label, lo, hi in buckets:
            n = await db.scalar(text(
                f"SELECT COUNT(*) FROM users WHERE {where} AND {col} >= :lo AND {col} < :hi"
            ), {**params, "lo": lo, "hi": hi})
            out.append({"label": label, "count": n or 0})
        return out

    # Campaign-readiness signals — phone + opted-in is required for WhatsApp
    # delivery, so the marketer needs to know how big the reachable subset is
    # before approving a send. with_email is the fallback contact channel.
    reach = await db.execute(text(f"""
        SELECT
          SUM(CASE WHEN phone_number IS NOT NULL THEN 1 ELSE 0 END) AS has_phone,
          SUM(CASE WHEN phone_number IS NOT NULL AND COALESCE(whatsapp_opted_in, true) THEN 1 ELSE 0 END) AS reachable,
          SUM(CASE WHEN email IS NOT NULL THEN 1 ELSE 0 END) AS with_email
        FROM users WHERE {where}
    """), params)
    rrow = reach.fetchone()

    return {
        "total":      total,
        "countries":  [{"name": r.k, "count": r.n} for r in countries_q.fetchall()],
        "platforms":  [{"name": r.k, "count": r.n} for r in platforms_q.fetchall()],
        "languages":  [{"name": r.k, "count": r.n} for r in languages_q.fetchall()],
        # Bucket the audience by per-product recency/spend when filtered to
        # one product, otherwise by global. Keeps the Audience Breakdown
        # panel coherent with what the KPIs are showing.
        "recency":    await bucket_counts(aggregate_columns(product_group)["recency"], recency_buckets),
        "spend":      await bucket_counts(aggregate_columns(product_group)["spend"],   spend_buckets),
        "reachable":   int(rrow.reachable or 0),
        "has_phone":   int(rrow.has_phone or 0),
        "with_email":  int(rrow.with_email or 0),
    }


@router.get("/reactivation-cutoffs")
async def get_reactivation_cutoffs(db: AsyncSession = Depends(get_db)):
    """Percentile cutoffs that drive the HIGH / MEDIUM / LOW reactivation
    badge in the user table.

    Computed live from the scored population so they always match the
    current distribution — no need to persist them when ingesting new
    scores. Industry standard for propensity scoring is decile / quintile
    bucketing rather than fixed thresholds, because the absolute probability
    range of a model isn't comparable across retraining cycles. We split
    top 20% / next 30% / bottom 50% (a quintile-style HIGH / MEDIUM / LOW).

    Returns NULL cutoffs when no users are scored yet — frontend renders
    every user as "Active" in that case.
    """
    row = (await db.execute(text(
        "SELECT "
        "  percentile_cont(0.50) WITHIN GROUP (ORDER BY reactivation_score) AS p50, "
        "  percentile_cont(0.80) WITHIN GROUP (ORDER BY reactivation_score) AS p80, "
        "  COUNT(*)                                                          AS n "
        "FROM users WHERE reactivation_score IS NOT NULL"
    ))).fetchone()
    return {
        "high_cutoff":   float(row.p80) if row and row.p80 is not None else None,
        "medium_cutoff": float(row.p50) if row and row.p50 is not None else None,
        "scored_count":  int(row.n or 0) if row else 0,
    }
