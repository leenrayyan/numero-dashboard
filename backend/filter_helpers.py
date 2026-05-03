"""
Shared filter helpers used across all routers.
Builds safe parameterised WHERE clauses from the common filter set.
"""
from typing import Optional


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

    if segment:
        conditions.append("segment = :segment")
        params["segment"] = segment
    if min_recency is not None:
        conditions.append("recency >= :min_recency")
        params["min_recency"] = min_recency
    if max_recency is not None:
        conditions.append("recency <= :max_recency")
        params["max_recency"] = max_recency
    if user_ids:
        ids = [int(x) for x in user_ids.split(",") if x.strip().isdigit()]
        if ids:
            conditions.append(f"id_client = ANY(ARRAY[{','.join(str(i) for i in ids)}])")
    if country:
        conditions.append("user_country = :country")
        params["country"] = country
    if product_group:
        conditions.append("primary_product_group = :product_group")
        params["product_group"] = product_group
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
    if platform:
        conditions.append("platform = :platform")
        params["platform"] = platform
    if language:
        conditions.append("language = :language")
        params["language"] = language

    return " AND ".join(conditions), params
