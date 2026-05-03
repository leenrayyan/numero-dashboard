"""
Shared filter helpers used across all routers.
Builds safe parameterised WHERE clauses from the common filter set.

Categorical filters (segment, country, product_group, platform, language)
accept either a single value or a comma-separated list. Single values use `=`,
lists use `IN (...)` — same UX shape as the multi-select dropdowns in the
frontend filter bar.
"""
from typing import Optional


def _multi_clause(column: str, raw: str, key_prefix: str, params: dict) -> Optional[str]:
    """Convert a comma-separated string into either `col = :x` or `col IN (...)`.
    Mutates `params` in place. Returns the SQL fragment, or None if `raw` is empty.
    """
    if not raw:
        return None
    values = [v.strip() for v in raw.split(",") if v.strip()]
    if not values:
        return None
    if len(values) == 1:
        params[key_prefix] = values[0]
        return f"{column} = :{key_prefix}"
    placeholders = []
    for i, v in enumerate(values):
        k = f"{key_prefix}_{i}"
        placeholders.append(f":{k}")
        params[k] = v
    return f"{column} IN ({', '.join(placeholders)})"


def build_where(
    segment: Optional[str] = None,
    min_recency: Optional[int] = None,
    max_recency: Optional[int] = None,
    user_ids: Optional[str] = None,
    country: Optional[str] = None,
    product_group: Optional[str] = None,
    spend_min: Optional[float] = None,
    spend_max: Optional[float] = None,
    min_age: Optional[int] = None,
    max_age: Optional[int] = None,
    platform: Optional[str] = None,
    language: Optional[str] = None,
) -> tuple[str, dict]:
    conditions = ["1=1"]
    params: dict = {}

    # Categorical multi-value filters.
    for col, raw, prefix in [
        ("segment",               segment,       "segment"),
        ("user_country",          country,       "country"),
        ("primary_product_group", product_group, "product_group"),
        ("platform",              platform,      "platform"),
        ("language",              language,      "language"),
    ]:
        clause = _multi_clause(col, raw, prefix, params)
        if clause:
            conditions.append(clause)

    # Range filters (single-value, intentionally not multi).
    if min_recency is not None:
        conditions.append("recency >= :min_recency")
        params["min_recency"] = min_recency
    if max_recency is not None:
        conditions.append("recency <= :max_recency")
        params["max_recency"] = max_recency
    if spend_min is not None:
        conditions.append("total_spent >= :spend_min")
        params["spend_min"] = spend_min
    if spend_max is not None:
        conditions.append("total_spent <= :spend_max")
        params["spend_max"] = spend_max
    if min_age is not None:
        conditions.append("customer_age >= :min_age")
        params["min_age"] = min_age
    if max_age is not None:
        conditions.append("customer_age <= :max_age")
        params["max_age"] = max_age

    # User-ID list (numeric IN clause built inline since it's always a list).
    if user_ids:
        ids = [int(x) for x in user_ids.split(",") if x.strip().isdigit()]
        if ids:
            conditions.append(f"id_client = ANY(ARRAY[{','.join(str(i) for i in ids)}])")

    return " AND ".join(conditions), params
