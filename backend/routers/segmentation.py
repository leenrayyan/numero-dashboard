from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from database import get_db
from filter_helpers import build_where, aggregate_columns

router = APIRouter()

# Numero-brand palette — kept in sync with frontend/src/constants/colors.js.
# 12 segments across Calls / eSIM / Virtual. Picked to maximise pairwise hue
# distinctness so adjacent legend pills read as separate colours.
SEGMENT_COLORS = {
    # Calls (4)
    "Calls - High-Value Power Users":                          "#B0456E",  # brand rose
    "Calls - Active Offer-Driven Customers":                   "#D8896B",  # coral
    "Calls - At-Risk Customers":                               "#E8B945",  # mustard amber (warning-tier)
    "Calls - One-Time Customers":                              "#A0A0A0",  # neutral grey
    # eSIM (3)
    "eSIM - High-Value Global Power Users":                    "#2A7FB8",  # brand blue
    "eSIM - Local Data Users":                                 "#3D9DB0",  # turquoise
    "eSIM - Data-Only Minimal Users":                          "#6B7CC8",  # periwinkle
    # Virtual (5)
    "Virtual - High-Value Power Users":                        "#5B3A9E",  # brand deep purple
    "Virtual - Loyal Infrequent Buyers":                       "#4FA88C",  # brand sage green
    "Virtual - Churned Low-Value Users":                       "#9B5DB8",  # plum
    "Virtual - Low-Value Single-Product Users (Local Plan)":   "#C8825A",  # burnt orange
    "Virtual - EU Bundle Focused Customers":                   "#DA5C8E",  # bright magenta
}


def _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max,
       platform=None, language=None, audience=None):
    return build_where(segment, min_recency, max_recency, user_ids, country, product_group,
                       spend_min, spend_max, platform=platform, language=language, audience=audience)


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
    audience: Optional[str]      = Query(None),
):
    where, params = _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max, platform, language, audience)
    cols = aggregate_columns(product_group)
    result = await db.execute(text(f"""
        SELECT cluster_id, segment, primary_product_group,
               COUNT(*)                AS user_count,
               AVG({cols['spend']})    AS avg_monetary,
               SUM({cols['spend']})    AS total_monetary,
               AVG({cols['recency']})  AS avg_recency,
               AVG({cols['frequency']}) AS avg_frequency,
               AVG({cols['aov']})      AS avg_aov
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
    audience: Optional[str]      = Query(None),
):
    where, params = _w(segment, min_recency, max_recency, user_ids, country, product_group, spend_min, spend_max, platform, language, audience)
    cols = aggregate_columns(product_group)
    result = await db.execute(text(f"""
        SELECT segment, SUM({cols['spend']}) AS total_revenue
        FROM users WHERE segment IS NOT NULL AND {where}
        GROUP BY segment ORDER BY total_revenue DESC
    """), params)
    return [{"segment": r.segment, "revenue": round(r.total_revenue or 0, 2)} for r in result.fetchall()]
