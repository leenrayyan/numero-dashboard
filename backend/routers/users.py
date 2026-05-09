from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from database import get_db
from filter_helpers import build_where, aggregate_columns, single_product_prefix

router = APIRouter()


@router.get("/countries")
async def get_countries(db: AsyncSession = Depends(get_db)):
    """Return distinct countries with user counts, for the country filter dropdown."""
    result = await db.execute(text("""
        SELECT user_country AS country, COUNT(*) AS count
        FROM users
        WHERE user_country IS NOT NULL
        GROUP BY user_country
        ORDER BY count DESC
    """))
    return [{"country": r.country, "count": r.count} for r in result.fetchall()]


@router.get("/platforms")
async def get_platforms(db: AsyncSession = Depends(get_db)):
    """Distinct platforms (iOS / Android) with user counts."""
    result = await db.execute(text("""
        SELECT platform, COUNT(*) AS count
        FROM users
        WHERE platform IS NOT NULL
        GROUP BY platform
        ORDER BY count DESC
    """))
    return [{"platform": r.platform, "count": r.count} for r in result.fetchall()]


@router.get("/languages")
async def get_languages(db: AsyncSession = Depends(get_db)):
    """Distinct languages with user counts."""
    result = await db.execute(text("""
        SELECT language, COUNT(*) AS count
        FROM users
        WHERE language IS NOT NULL
        GROUP BY language
        ORDER BY count DESC
    """))
    return [{"language": r.language, "count": r.count} for r in result.fetchall()]


@router.get("/ids")
async def list_user_ids(
    db: AsyncSession = Depends(get_db),
    search:        Optional[str]  = Query(None),
    segment:       Optional[str]  = Query(None),
    min_recency:   Optional[int]  = Query(None),
    max_recency:   Optional[int]  = Query(None),
    user_ids:      Optional[str]  = Query(None),
    country:       Optional[str]  = Query(None),
    product_group: Optional[str]  = Query(None),
    spend_min:     Optional[float] = Query(None),
    spend_max:     Optional[float] = Query(None),
    min_age:       Optional[int]  = Query(None),
    max_age:       Optional[int]  = Query(None),
    platform:      Optional[str]  = Query(None),
    language:      Optional[str]  = Query(None),
    audience:      Optional[str]  = Query(None),
    limit:         int            = Query(300000, ge=1, le=500000),
):
    """Just the id_clients matching the current filters — used by the table's
    "select all matching" link so the frontend can promote a page selection
    into a full-result-set selection without paginating through everything."""
    where, params = build_where(
        segment, min_recency, max_recency, user_ids,
        country, product_group, spend_min, spend_max, min_age, max_age,
        platform, language, audience,
    )
    if search and search.strip() and search.strip().isdigit():
        where += " AND CAST(id_client AS TEXT) LIKE :search_pat"
        params["search_pat"] = f"%{search.strip()}%"

    params["limit"] = limit
    rows = await db.execute(
        text(f"SELECT id_client FROM users WHERE {where} ORDER BY id_client LIMIT :limit"),
        params,
    )
    ids = [r.id_client for r in rows.fetchall()]
    return {"ids": ids, "count": len(ids), "truncated": len(ids) >= limit}


@router.get("/")
async def list_users(
    db: AsyncSession = Depends(get_db),
    page:          int            = Query(1,    ge=1),
    page_size:     int            = Query(50,   ge=1, le=500),
    search:        Optional[str]  = Query(None),   # user ID partial match
    segment:       Optional[str]  = Query(None),
    min_recency:   Optional[int]  = Query(None),
    max_recency:   Optional[int]  = Query(None),
    user_ids:      Optional[str]  = Query(None),   # comma-separated id_clients
    country:       Optional[str]  = Query(None),
    product_group: Optional[str]  = Query(None),
    spend_min:     Optional[float] = Query(None),
    spend_max:     Optional[float] = Query(None),
    min_age:       Optional[int]  = Query(None),
    max_age:       Optional[int]  = Query(None),
    platform:      Optional[str]  = Query(None),
    language:      Optional[str]  = Query(None),
    audience:      Optional[str]  = Query(None),
):
    where, params = build_where(
        segment, min_recency, max_recency, user_ids,
        country, product_group, spend_min, spend_max, min_age, max_age,
        platform, language, audience,
    )

    # Optional user ID search
    if search and search.strip():
        s = search.strip()
        if s.isdigit():
            where += " AND CAST(id_client AS TEXT) LIKE :search_pat"
            params["search_pat"] = f"%{s}%"

    offset = (page - 1) * page_size
    params["limit"]  = page_size
    params["offset"] = offset

    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM users WHERE {where}"), params
    )
    total = count_result.scalar() or 0

    # When a single product is filtered, surface that product's per-user
    # metrics in the columns the table renders (recency / spend / frequency
    # / segment). We alias the per-product columns AS the global names so
    # the frontend doesn't need to know the difference — a Calls-filtered
    # table shows Calls recency / Calls spend / Calls frequency / Calls
    # cluster name under those headings.
    cols = aggregate_columns(product_group)
    prefix = single_product_prefix(product_group)
    segment_col = f"{prefix}_cluster" if prefix else "segment"
    order_col = cols["spend"]
    # phone_number is intentionally NOT selected — it's PII used only by the
    # WhatsApp campaign sender, never displayed in the dashboard UI.
    rows = await db.execute(text(f"""
        SELECT
            id_client,
            {segment_col} AS segment,
            primary_product_group, product_types,
            {cols['recency']}   AS recency,
            {cols['frequency']} AS purchase_frequency,
            {cols['spend']}     AS total_spent,
            user_country,
            cluster_id, calls_spent, esim_spent, virtual_spent,
            calls_frequency, esim_frequency, virtual_frequency,
            calls_cluster, esim_cluster, virtual_cluster,
            platform, language,
            whatsapp_opted_in, reactivation_score,
            register_date, first_purchase, last_purchase, customer_age
        FROM users
        WHERE {where}
        ORDER BY {order_col} DESC NULLS LAST
        LIMIT :limit OFFSET :offset
    """), params)

    cols = rows.keys()
    users = [dict(zip(cols, r)) for r in rows.fetchall()]

    # Serialize dates to strings
    for u in users:
        for col in ("register_date", "first_purchase", "last_purchase"):
            if u.get(col) is not None:
                u[col] = u[col].isoformat()

    return {"users": users, "total": total}


@router.get("/{user_id}")
async def get_user(user_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("SELECT * FROM users WHERE id_client = :uid"),
        {"uid": user_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    u = dict(zip(result.keys(), row))
    # Strip PII before returning to the dashboard UI.
    u.pop("phone_number", None)
    for col in ("register_date", "first_purchase", "last_purchase"):
        if u.get(col) is not None:
            u[col] = u[col].isoformat()
    return u
