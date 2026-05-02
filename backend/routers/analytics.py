from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from database import get_db
from filter_helpers import build_where

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


def _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max):
    return build_where(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max)


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
):
    where, params = _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max)
    row = (await db.execute(text(f"""
        SELECT
            COUNT(*)              AS total,
            AVG(total_spent)      AS avg_monetary,
            SUM(total_spent)      AS total_monetary,
            AVG(recency)          AS avg_recency,
            AVG(purchase_frequency) AS avg_frequency,
            AVG(total_spent / NULLIF(purchase_frequency, 0)) AS avg_aov
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
):
    where, params = _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max)
    result = await db.execute(text(f"""
        SELECT DATE_TRUNC('month', last_purchase) AS month,
               COUNT(*) AS user_count, AVG(total_spent) AS avg_spend
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
):
    where, params = _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max)
    result = await db.execute(text(f"""
        SELECT CASE
            WHEN recency BETWEEN 0   AND 89  THEN '0-90d'
            WHEN recency BETWEEN 90  AND 179 THEN '90-180d'
            WHEN recency BETWEEN 180 AND 364 THEN '180-365d'
            WHEN recency >= 365              THEN '365d+'
        END AS bucket, COUNT(*) AS count
        FROM users WHERE {where}
        GROUP BY 1 ORDER BY MIN(recency)
    """), params)
    return [{"week": r.bucket, "count": r.count} for r in result.fetchall() if r.bucket]


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
):
    """Monthly user counts split by segment — feeds the stacked-area trend chart."""
    where, params = _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max)
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
):
    where, params = _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max)
    result = await db.execute(text(f"""
        SELECT cluster_id, segment, COUNT(*) AS user_count,
               AVG(total_spent) AS avg_monetary, AVG(recency) AS avg_recency,
               AVG(purchase_frequency) AS avg_frequency
        FROM users WHERE {where}
        GROUP BY cluster_id, segment ORDER BY cluster_id
    """), params)
    return [
        {"cluster_id": r.cluster_id, "segment": r.segment, "user_count": r.user_count,
         "avg_monetary": round(r.avg_monetary or 0, 2), "avg_recency": round(r.avg_recency or 0, 0),
         "avg_frequency": round(r.avg_frequency or 0, 1)}
        for r in result.fetchall()
    ]
