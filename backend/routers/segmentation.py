from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from database import get_db
from filter_helpers import build_where

router = APIRouter()

# Numero-brand palette — kept in sync with frontend/src/constants/colors.js.
# Cool blue→purple→rose spectrum derived from the logo gradient.
SEGMENT_COLORS = {
    # Calls
    "Calls - High Value Loyal (At Risk)":      "#B0456E",
    "Calls - Low Value Active":                "#4A90C8",
    "Calls - Frequent Low Spenders (Cooling)": "#8A5DB5",
    # eSIM
    "eSIM - High Value Users (At Risk)":       "#C56988",
    "eSIM - Low Value Inactive":               "#7050B5",
    "eSIM - Mid Value Active":                 "#4FA88C",
    # Virtual
    "Virtual - High Value Loyal (At Risk)":    "#5B3A9E",
    "Virtual - Mid Value Inactive":            "#D8896B",
    "Virtual - Low Value Active":              "#2A7FB8",
}


def _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max,
       platform=None, language=None):
    return build_where(segment, min_recency, max_recency, user_ids, country, product_group,
                       spend_min, spend_max, platform=platform, language=language)


@router.get("/")
async def get_segmentation(
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
):
    where, params = _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max, platform, language)
    result = await db.execute(text(f"""
        SELECT cluster_id, segment, primary_product_group,
               COUNT(*)                AS user_count,
               AVG(total_spent)        AS avg_monetary,
               SUM(total_spent)        AS total_monetary,
               AVG(recency)            AS avg_recency,
               AVG(purchase_frequency) AS avg_frequency,
               AVG(total_spent / NULLIF(purchase_frequency, 0)) AS avg_aov
        FROM users WHERE segment IS NOT NULL AND {where}
        GROUP BY cluster_id, segment, primary_product_group
        ORDER BY primary_product_group, cluster_id
    """), params)
    rows = result.fetchall()
    total_users = sum(r.user_count for r in rows)

    return {
        "segments": [
            {
                "cluster_id":     r.cluster_id,
                "segment":        r.segment,
                "product_group":  r.primary_product_group,
                "user_count":     r.user_count,
                "percentage":     round((r.user_count / total_users * 100) if total_users else 0, 1),
                "avg_monetary":   round(r.avg_monetary or 0, 2),
                "total_monetary": round(r.total_monetary or 0, 2),
                "avg_recency":    round(r.avg_recency or 0, 0),
                "avg_frequency":  round(r.avg_frequency or 0, 1),
                "avg_aov":        round(r.avg_aov or 0, 2),
                "color":          SEGMENT_COLORS.get(r.segment, "#6B7280"),
                "avg_revenue":    round(r.avg_monetary or 0, 2),
                "engagement":     f"{round(r.avg_frequency or 0, 1)} purchases",
                "dormant_count":  r.user_count,
            }
            for r in rows
        ],
        "total_users": total_users,
    }


@router.get("/revenue-by-segment")
async def get_revenue_by_segment(
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
):
    where, params = _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max, platform, language)
    result = await db.execute(text(f"""
        SELECT segment, SUM(total_spent) AS total_revenue
        FROM users WHERE segment IS NOT NULL AND {where}
        GROUP BY segment ORDER BY total_revenue DESC
    """), params)
    return [{"segment": r.segment, "revenue": round(r.total_revenue or 0, 2)} for r in result.fetchall()]
