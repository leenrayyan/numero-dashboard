"""
CSV export endpoints — no pagination, returns all matching rows as downloadable files.
Called directly by the browser (opens a download) or by the Reports page.
"""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
import csv
import io
from datetime import datetime, timezone
from database import get_db
from filter_helpers import build_where, aggregate_columns

router = APIRouter()


def _csv_response(rows: list[dict], filename: str) -> StreamingResponse:
    if not rows:
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["no_data"])
        writer.writerow(["No records matched your filters"])
        output.seek(0)
    else:
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
        output.seek(0)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}_{stamp}.csv"'},
    )


@router.get("/users")
async def export_users(
    db: AsyncSession = Depends(get_db),
    segment:       Optional[str]   = Query(None),
    min_recency:   Optional[int]   = Query(None),
    max_recency:   Optional[int]   = Query(None),
    user_ids:      Optional[str]   = Query(None),
    country:       Optional[str]   = Query(None),
    product_group: Optional[str]   = Query(None),
    spend_min:     Optional[float] = Query(None),
    spend_max:     Optional[float] = Query(None),
    min_age:       Optional[int]   = Query(None),
    max_age:       Optional[int]   = Query(None),
    platform:      Optional[str]   = Query(None),
    language:      Optional[str]   = Query(None),
    audience:      Optional[str]   = Query(None),
):
    where, params = build_where(
        segment, min_recency, max_recency, user_ids,
        country, product_group, spend_min, spend_max, min_age, max_age,
        platform, language, audience,
    )
    # When a single product is filtered, surface that product's per-user
    # metrics in the global-named columns so the export reflects the filter.
    cols = aggregate_columns(product_group)
    # phone_number is intentionally included in the export — this is the data
    # path the WhatsApp campaign sender consumes. UI views never expose it.
    result = await db.execute(text(f"""
        SELECT
            id_client, segment, primary_product_group, user_country,
            platform, language,
            {cols['recency']}   AS recency,
            customer_age,
            {cols['spend']}     AS total_spent,
            {cols['frequency']} AS purchase_frequency,
            calls_spent, esim_spent, virtual_spent,
            calls_frequency, esim_frequency, virtual_frequency,
            phone_number, whatsapp_opted_in, last_campaign_at,
            reactivation_score, register_date, first_purchase, last_purchase
        FROM users WHERE {where}
        ORDER BY {cols['spend']} DESC NULLS LAST
        LIMIT 50000
    """), params)
    cols = result.keys()
    rows = [dict(zip(cols, r)) for r in result.fetchall()]
    return _csv_response(rows, "users_export")


@router.get("/segments")
async def export_segments(
    db: AsyncSession = Depends(get_db),
    segment:       Optional[str]   = Query(None),
    product_group: Optional[str]   = Query(None),
    country:       Optional[str]   = Query(None),
):
    where, params = build_where(
        segment=segment, product_group=product_group, country=country
    )
    cols = aggregate_columns(product_group)
    result = await db.execute(text(f"""
        SELECT
            segment,
            primary_product_group AS product_group,
            COUNT(*)                                            AS user_count,
            ROUND(AVG({cols['spend']})::numeric, 2)             AS avg_spend,
            ROUND(SUM({cols['spend']})::numeric, 2)             AS total_revenue,
            ROUND(AVG({cols['recency']})::numeric, 0)           AS avg_recency_days,
            ROUND(AVG({cols['frequency']})::numeric, 1)         AS avg_frequency,
            ROUND(AVG({cols['aov']})::numeric, 2)               AS avg_aov,
            COUNT(*) FILTER (WHERE whatsapp_opted_in IS TRUE)   AS wa_reachable
        FROM users WHERE segment IS NOT NULL AND {where}
        GROUP BY segment, primary_product_group
        ORDER BY total_revenue DESC
    """), params)
    cols = result.keys()
    rows = [dict(zip(cols, r)) for r in result.fetchall()]
    return _csv_response(rows, "segments_export")


@router.get("/campaigns")
async def export_campaigns(db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("""
        SELECT
            id, name, status, offer_code,
            segment_filter, product_filter, country_filter,
            recency_min_filter, recency_max_filter,
            total_targeted, sent_count, delivered_count,
            read_count, replied_count, converted_count,
            CASE WHEN sent_count > 0
                 THEN ROUND((delivered_count::float / sent_count * 100)::numeric, 1)
                 ELSE 0 END AS delivery_rate_pct,
            CASE WHEN sent_count > 0
                 THEN ROUND((read_count::float / sent_count * 100)::numeric, 1)
                 ELSE 0 END AS read_rate_pct,
            CASE WHEN sent_count > 0
                 THEN ROUND((converted_count::float / sent_count * 100)::numeric, 1)
                 ELSE 0 END AS conversion_rate_pct,
            created_at, sent_at
        FROM campaigns
        ORDER BY created_at DESC
    """))
    cols = result.keys()
    rows = [dict(zip(cols, r)) for r in result.fetchall()]
    return _csv_response(rows, "campaigns_export")
