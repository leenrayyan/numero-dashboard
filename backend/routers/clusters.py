import gzip
import time as _time

import orjson
from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from typing import Optional
from database import get_db
from filter_helpers import aggregate_columns, _product_membership_clause
from models import User, ClusterRun

router = APIRouter()

NUMERIC_COLS = [
    "recency", "customer_age", "total_spent", "purchase_frequency",
    "calls_spent", "esim_spent", "virtual_spent",
    "calls_frequency", "esim_frequency", "virtual_frequency",
]


@router.get("/")
async def get_clusters(
    db: AsyncSession = Depends(get_db),
    product_group: Optional[str] = Query(None),
):
    # Membership filter — anyone who buys the selected product(s), not just
    # primary. Matches the rest of the dashboard's product semantics.
    params: dict = {}
    pg_clause = _product_membership_clause(product_group, params)
    pg_filter = f"AND {pg_clause}" if pg_clause else ""
    cols = aggregate_columns(product_group)
    result = await db.execute(text(f"""
        SELECT
            cluster_id,
            segment,
            primary_product_group,
            COUNT(*)                  AS user_count,
            AVG({cols['spend']})      AS avg_monetary,
            AVG({cols['recency']})    AS avg_recency,
            AVG({cols['frequency']})  AS avg_frequency,
            AVG({cols['aov']})        AS avg_aov
        FROM users
        WHERE cluster_id IS NOT NULL {pg_filter}
        GROUP BY cluster_id, segment, primary_product_group
        ORDER BY primary_product_group, cluster_id
    """), params)
    rows = result.fetchall()

    run = await db.scalar(
        select(ClusterRun).where(ClusterRun.is_active == True).order_by(ClusterRun.run_at.desc())
    )

    return {
        "clusters": [
            {
                "cluster_id":    r.cluster_id,
                "segment":       r.segment,
                "product_group": r.primary_product_group,
                "user_count":    r.user_count,
                "avg_monetary":  round(r.avg_monetary or 0, 2),
                "avg_recency":   round(r.avg_recency or 0, 0),
                "avg_frequency": round(r.avg_frequency or 0, 1),
                "avg_aov":       round(r.avg_aov or 0, 2),
            }
            for r in rows
        ],
        "run": {
            "id":           run.id if run else None,
            "run_at":       run.run_at.isoformat() if run else None,
            "n_clusters":   run.n_clusters if run else 12,
            "algorithm":    run.algorithm if run else "KMeans (per-category, behavioral features)",
            "features_used": run.features_used if run else NUMERIC_COLS,
        } if run else None,
    }


@router.get("/by-segment/{segment_name}/users")
async def get_segment_users(
    segment_name: str,
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    page_size: int = 50,
):
    """List users in a given segment.

    Replaces the old `/{cluster_id}/users` endpoint which was unsafe — cluster
    IDs aren't unique across products (Calls / eSIM / Virtual each independently
    have clusters 0..N), so filtering by cluster_id alone returned a mix of
    users from different cluster meanings. Segment names ARE unique by design
    ("Calls - Regular Calling Offer Users" only ever refers to the Calls cluster),
    so they're the correct identifier here.
    """
    q = select(User).where(User.segment == segment_name)
    total = await db.scalar(select(func.count()).select_from(q.subquery()))
    result = await db.execute(q.offset((page - 1) * page_size).limit(page_size))
    users = result.scalars().all()
    return {
        "total": total,
        "segment": segment_name,
        "users": [
            {
                "id_client":    u.id_client,
                "segment":      u.segment,
                "user_country": u.user_country,
                "platform":     u.platform,
                "language":     u.language,
                "total_spent":  u.total_spent,
                "recency":      u.recency,
            }
            for u in users
        ],
    }


# Note: in-app re-running was removed. Clustering is performed offline in
# notebooks/clustering/gp-client-clustering.ipynb; results are loaded into the
# `users` table via backend/scripts/seed.py.


# Map product_group label -> per-product column prefix in the users table.
# These match the seed (Client_Calls_Clustered etc.) — keep in sync if labels move.
_PRODUCT_PREFIX = {
    "Calls":          "calls",
    "Data eSIM":      "esim",
    "Virtual Number": "virtual",
}


# In-process response cache for /pca, keyed by product label.
#
# The previous version stored Python dicts — which still left FastAPI to
# re-serialize 90+MB of JSON and re-gzip on every request (10-14s). This
# version caches the FINISHED bytes (raw JSON + gzip), so a cache hit ships
# the response with zero per-request encoding work.
#
# Tuple shape: (timestamp, json_bytes, gzip_bytes)
# Memory footprint: ~10MB per product (gzip) + ~90MB (raw json) = ~100MB max
# for all 3 products held simultaneously. Worth it given the speed.
_PANEL_CACHE: dict[str, tuple[float, bytes, bytes]] = {}
_PANEL_CACHE_TTL_SEC = 600  # 10 minutes


def _serialize_panel(panel: dict) -> tuple[bytes, bytes]:
    """Encode a panel dict to JSON bytes + a pre-gzipped copy.
    orjson is ~10x faster than stdlib json on dicts of this size; gzip at
    level 6 trades a little CPU for a 10-13x size reduction (90MB → 7MB)."""
    raw = orjson.dumps(panel)
    gz  = gzip.compress(raw, compresslevel=6)
    return raw, gz


async def _panel_bytes_for_product(db: AsyncSession, product: str) -> tuple[bytes, bytes]:
    """Return (raw_json, gzipped_json) bytes for the panel of users buying
    in `product`. Coords come straight from the offline notebook's per-product
    PCA fit (stored as `<prefix>_pc1`/`<prefix>_pc2`), so this is a plain
    SELECT — no on-the-fly fitting, no sample cap.

    Multi-category users appear in every panel for which they have a coord —
    matching the user's intent that someone whose primary is Calls but who
    *also* buys eSIM should still show up in the eSIM panel.

    Cache hit: pure dict lookup → microseconds.
    Cache miss: ~5-10s for Virtual (200K rows × DB query + orjson encode +
                gzip compress); subsequent requests hit the cache.
    """
    cached = _PANEL_CACHE.get(product)
    if cached and (_time.time() - cached[0]) < _PANEL_CACHE_TTL_SEC:
        return cached[1], cached[2]

    prefix = _PRODUCT_PREFIX[product]
    pc1, pc2 = f"{prefix}_pc1", f"{prefix}_pc2"
    cluster_col = f"{prefix}_cluster"
    spend_col   = f"{prefix}_spent"
    freq_col    = f"{prefix}_frequency"

    sql = f"""
        SELECT
            id_client,
            {cluster_col} AS segment,
            {pc1}         AS pc1,
            {pc2}         AS pc2,
            {spend_col}   AS product_spent,
            {freq_col}    AS product_frequency,
            total_spent, recency, purchase_frequency,
            customer_age, user_country, platform, language,
            primary_product_group, product_groups,
            product_types, dominant_product
        FROM users
        WHERE {pc1} IS NOT NULL AND {pc2} IS NOT NULL
    """
    result = await db.execute(text(sql))
    rows = result.mappings().all()
    payload = {
        "product": product,
        "points":  [dict(r) for r in rows],
    }
    raw, gz = _serialize_panel(payload)
    _PANEL_CACHE[product] = (_time.time(), raw, gz)
    return raw, gz


# Cache for the FULL /pca response envelope, keyed by the resolved product
# list. Tuple shape: (timestamp, raw_json, gzip_bytes). Cache hits skip
# both the orjson encode AND the gzip compress, so a Virtual cluster-map
# load drops from ~13s to milliseconds.
_RESPONSE_CACHE: dict[tuple[str, ...], tuple[float, bytes, bytes]] = {}


@router.get("/pca")
async def get_pca(
    request: Request,
    db: AsyncSession = Depends(get_db),
    product_group: Optional[str] = Query(None),
):
    """Return one or more cluster-scatter panels.

    - No filter, or multiple products selected → 3 panels, one per product
      (small multiples). Each panel uses its own per-product PCA space; coords
      across panels are NOT comparable.
    - Single product selected → 1 panel for that product, including any user
      whose `product_groups` contains it (not just `primary_product_group`).

    Returns a pre-encoded `Response` rather than a Python dict so cache hits
    skip FastAPI's per-request JSON serialization (which on the 90+MB Virtual
    payload was eating 10-14s every call). When the client accepts gzip,
    we ship the cached gzipped bytes directly with `Content-Encoding`,
    bypassing GZipMiddleware too — pure in-memory dict lookup → bytes out.
    """
    selected: list[str] = []
    if product_group:
        selected = [g.strip() for g in product_group.split(",")
                    if g.strip() in _PRODUCT_PREFIX]

    if len(selected) == 1:
        products = selected
        mode = "single"
    else:
        products = list(_PRODUCT_PREFIX.keys())
        mode = "multi"

    cache_key = tuple([mode, *sorted(products)])
    cached = _RESPONSE_CACHE.get(cache_key)
    accepts_gzip = "gzip" in request.headers.get("accept-encoding", "").lower()

    if cached and (_time.time() - cached[0]) < _PANEL_CACHE_TTL_SEC:
        # Pure cache hit — ~microseconds.
        _, raw_envelope, gz_envelope = cached
    else:
        # Cold path: build per-panel bytes (themselves cached) and stitch
        # them into the {mode, panels: [...]} envelope without ever
        # materialising the full Python structure.
        panels_raw_bytes: list[bytes] = []
        for p in products:
            raw, _gz = await _panel_bytes_for_product(db, p)
            panels_raw_bytes.append(raw)
        prefix = orjson.dumps({"mode": mode, "panels": []})[:-2]   # strip "]}"
        raw_envelope = prefix + b",".join(panels_raw_bytes) + b"]}"
        gz_envelope = gzip.compress(raw_envelope, compresslevel=6)
        _RESPONSE_CACHE[cache_key] = (_time.time(), raw_envelope, gz_envelope)

    # Tell the browser it can re-use this response across page navigations.
    # The data only changes on a re-seed (offline event); 5 minutes is a safe
    # ceiling for browser-side caching while still picking up fresh data
    # within an analyst session. Combined with the backend cache, navigating
    # Explore → Campaigns (which both mount their own ClusterScatter) skips
    # the 7-MB download entirely on the second page.
    base_headers = {
        "cache-control": "private, max-age=300",
        "vary": "accept-encoding",
    }
    if accepts_gzip:
        return Response(
            content=gz_envelope,
            media_type="application/json",
            headers={**base_headers, "content-encoding": "gzip"},
        )
    return Response(content=raw_envelope, media_type="application/json", headers=base_headers)
