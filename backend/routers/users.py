from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from database import get_db
from filter_helpers import build_where

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
):
    where, params = build_where(
        segment, min_recency, max_recency, user_ids,
        country, product_group, spend_min, spend_max, min_age, max_age,
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

    rows = await db.execute(text(f"""
        SELECT
            id_client, segment, primary_product_group,
            recency, purchase_frequency, total_spent, user_country,
            cluster_id, calls_spent, esim_spent, virtual_spent,
            calls_frequency, esim_frequency, virtual_frequency,
            calls_cluster, esim_cluster, virtual_cluster,
            phone_number, whatsapp_opted_in, reactivation_score,
            register_date, first_purchase, last_purchase, customer_age
        FROM users
        WHERE {where}
        ORDER BY total_spent DESC
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
    for col in ("register_date", "first_purchase", "last_purchase"):
        if u.get(col) is not None:
            u[col] = u[col].isoformat()
    return u
