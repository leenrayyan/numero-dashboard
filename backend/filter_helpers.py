"""
Shared filter helpers used across all routers.
Builds safe parameterised WHERE clauses from the common filter set.

Categorical filters (segment, country, product_group, platform, language)
accept either a single value or a comma-separated list. Single values use `=`,
lists use `IN (...)` — same UX shape as the multi-select dropdowns in the
frontend filter bar.

PRODUCT FILTERING USES MEMBERSHIP, NOT PRIMARY:
"Filter by Calls" means "any user who has Calls activity", not "any user whose
top-spend product is Calls". This matches industry convention (Mixpanel /
Amplitude / Segment.com cohort filters work the same way) and matches what
`/api/clusters/pca` returns. About 19% of users buy in 2+ products, so
primary-only filtering silently hid ~35K Calls customers, ~6K eSIM customers,
and ~16K Virtual customers from the product they actively buy.

When EXACTLY ONE product is selected, range filters (recency, spend) and
aggregate columns elsewhere switch to that product's per-product columns
(`calls_recency`, `calls_spent`, etc.) so a Calls-filtered "active in last
30 days" doesn't accidentally include users whose recent activity was on
Virtual. Helpers below also expose the chosen prefix for routers that need
to swap aggregate columns.
"""
from typing import Optional

import audience_cache


# Map UI label -> the per-product column prefix used in `users`.
# Keep in sync with seed.py and routers/clusters.py _PRODUCT_PREFIX.
_PRODUCT_PREFIX = {
    "Calls":          "calls",
    "Data eSIM":      "esim",
    "Virtual Number": "virtual",
}


def _split_products(raw: Optional[str]) -> list[str]:
    """Parse the `product_group=` query string into a list of product labels."""
    if not raw:
        return []
    return [v.strip() for v in raw.split(",") if v.strip() in _PRODUCT_PREFIX]


def single_product_prefix(product_group: Optional[str]) -> Optional[str]:
    """If exactly one product is selected, return its column-prefix
    (e.g. 'calls'). Otherwise None — callers should use global columns."""
    products = _split_products(product_group)
    if len(products) != 1:
        return None
    return _PRODUCT_PREFIX[products[0]]


def aggregate_columns(product_group: Optional[str]) -> dict[str, str]:
    """Return the SQL column expressions to use for KPI aggregates.

    When exactly one product is filtered, swap to per-product columns so
    aggregates reflect activity in THAT product only — e.g. AVG(calls_spent)
    instead of AVG(total_spent), which would otherwise include the user's
    Virtual / eSIM spend.

    Usage:
        cols = aggregate_columns(product_group)
        sql = f"SELECT AVG({cols['spend']}), AVG({cols['recency']}) FROM users"

    `aov` is the average order value — derived from spend/frequency at the
    global level, but already pre-computed per product (e.g. calls_aov).
    """
    prefix = single_product_prefix(product_group)
    if prefix:
        return {
            "spend":     f"{prefix}_spent",
            "frequency": f"{prefix}_frequency",
            "recency":   f"{prefix}_recency",
            "aov":       f"{prefix}_aov",
        }
    return {
        "spend":     "total_spent",
        "frequency": "purchase_frequency",
        "recency":   "recency",
        # Global AOV: synthesised from spend/frequency. Pre-computed AOV
        # exists per product but not as a global column.
        "aov":       "total_spent / NULLIF(purchase_frequency, 0)",
    }


def _product_membership_clause(raw: Optional[str], params: dict) -> Optional[str]:
    """Build a WHERE fragment matching users who BUY any of the selected
    products. Uses `string_to_array(product_groups, ', ')` since
    `product_groups` is stored as a comma-joined text column.
    Single product: `'Calls' = ANY(...)`.
    Multi-product: `('Calls' = ANY(...) OR 'Data eSIM' = ANY(...))` — union.
    """
    products = _split_products(raw)
    if not products:
        return None
    parts = []
    for i, p in enumerate(products):
        k = f"prodgroup_{i}"
        params[k] = p
        parts.append(f":{k} = ANY(string_to_array(product_groups, ', '))")
    return parts[0] if len(parts) == 1 else "(" + " OR ".join(parts) + ")"


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
    audience: Optional[str] = None,
) -> tuple[str, dict]:
    conditions = ["1=1"]
    params: dict = {}

    # Categorical multi-value filters (segment / country / platform / language).
    # productType is handled separately below — it's membership, not equality.
    for col, raw, prefix in [
        ("segment",      segment,  "segment"),
        ("user_country", country,  "country"),
        ("platform",     platform, "platform"),
        ("language",     language, "language"),
    ]:
        clause = _multi_clause(col, raw, prefix, params)
        if clause:
            conditions.append(clause)

    # Product = membership (anyone who buys this product), not primary.
    pg_clause = _product_membership_clause(product_group, params)
    if pg_clause:
        conditions.append(pg_clause)

    # Range filters. When EXACTLY ONE product is selected, swap to the
    # per-product column so e.g. "Calls + recency<=30" means "users whose
    # last CALLS purchase was within 30 days", not "users with Calls activity
    # AND any-product activity in 30 days" (the latter silently includes
    # users whose recent activity was Virtual). customer_age stays global —
    # it's days since registration and doesn't depend on product.
    prefix = single_product_prefix(product_group)
    recency_col = f"{prefix}_recency" if prefix else "recency"
    spend_col   = f"{prefix}_spent"   if prefix else "total_spent"

    if min_recency is not None:
        conditions.append(f"{recency_col} >= :min_recency")
        params["min_recency"] = min_recency
    if max_recency is not None:
        conditions.append(f"{recency_col} <= :max_recency")
        params["max_recency"] = max_recency
    if spend_min is not None:
        conditions.append(f"{spend_col} >= :spend_min")
        params["spend_min"] = spend_min
    if spend_max is not None:
        conditions.append(f"{spend_col} <= :spend_max")
        params["spend_max"] = spend_max
    if min_age is not None:
        conditions.append("customer_age >= :min_age")
        params["min_age"] = min_age
    if max_age is not None:
        conditions.append("customer_age <= :max_age")
        params["max_age"] = max_age

    # Resolve user_ids and audience token into a single set of id_clients.
    # If both are provided we INTERSECT them (e.g. lasso-on-top-of-NL-filter),
    # matching the same semantics the frontend uses for nl + lasso.
    explicit_ids: Optional[set[int]] = None
    if user_ids:
        ids = {int(x) for x in user_ids.split(",") if x.strip().isdigit()}
        if ids:
            explicit_ids = ids

    audience_ids: Optional[set[int]] = None
    if audience:
        cached = audience_cache.get(audience)
        if cached is not None:
            audience_ids = set(cached)
        else:
            # Token is unknown / expired -- fail closed by matching no rows.
            # Avoids silently returning unfiltered results.
            audience_ids = set()

    if explicit_ids is not None and audience_ids is not None:
        final_ids: Optional[set[int]] = explicit_ids & audience_ids
    elif explicit_ids is not None:
        final_ids = explicit_ids
    elif audience_ids is not None:
        final_ids = audience_ids
    else:
        final_ids = None

    if final_ids is not None:
        if not final_ids:
            # Empty intersection / unknown audience -- no rows match.
            conditions.append("FALSE")
        else:
            conditions.append(
                f"id_client = ANY(ARRAY[{','.join(str(i) for i in final_ids)}])"
            )

    return " AND ".join(conditions), params
