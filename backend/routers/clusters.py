from fastapi import APIRouter, Depends, BackgroundTasks, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text, update
from typing import Optional
from database import get_db
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
    pg_filter = "AND primary_product_group = :pg" if product_group else ""
    params    = {"pg": product_group} if product_group else {}
    result = await db.execute(text(f"""
        SELECT
            cluster_id,
            segment,
            primary_product_group,
            COUNT(*)                AS user_count,
            AVG(total_spent)        AS avg_monetary,
            AVG(recency)            AS avg_recency,
            AVG(purchase_frequency) AS avg_frequency,
            AVG(total_spent / NULLIF(purchase_frequency,0)) AS avg_aov
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
            "n_clusters":   run.n_clusters if run else 3,
            "algorithm":    run.algorithm if run else "MiniBatchKMeans",
            "features_used": run.features_used if run else NUMERIC_COLS,
        } if run else None,
    }


@router.get("/{cluster_id}/users")
async def get_cluster_users(
    cluster_id: int,
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    page_size: int = 50,
):
    q = select(User).where(User.cluster_id == cluster_id)
    total = await db.scalar(select(func.count()).select_from(q.subquery()))
    result = await db.execute(q.offset((page - 1) * page_size).limit(page_size))
    users = result.scalars().all()
    from routers.users import _serialize
    return {"total": total, "cluster_id": cluster_id, "users": [_serialize(u) for u in users]}


@router.post("/rerun")
async def rerun_clustering(background_tasks: BackgroundTasks, n_clusters: int = 3):
    background_tasks.add_task(_run_kmeans, n_clusters)
    return {"status": "started", "n_clusters": n_clusters}


async def _run_kmeans(n_clusters: int):
    from database import AsyncSessionLocal
    from sklearn.cluster import MiniBatchKMeans
    from sklearn.preprocessing import StandardScaler
    import pandas as pd

    async with AsyncSessionLocal() as db:
        cols = ["id_client"] + NUMERIC_COLS
        result = await db.execute(text(f"SELECT {', '.join(cols)} FROM users"))
        rows = result.fetchall()
        if not rows:
            return

        df = pd.DataFrame(rows, columns=cols)
        X = df[NUMERIC_COLS].fillna(0).values
        X_scaled = StandardScaler().fit_transform(X)

        model = MiniBatchKMeans(n_clusters=n_clusters, random_state=42)
        labels = model.fit_predict(X_scaled)

        await db.execute(update(ClusterRun).values(is_active=False))
        run = ClusterRun(
            n_clusters=n_clusters, algorithm="MiniBatchKMeans",
            features_used=NUMERIC_COLS, centroids=model.cluster_centers_.tolist(),
            cluster_stats={}, is_active=True, notes="Re-run from UI",
        )
        db.add(run)
        await db.flush()

        for i, row in enumerate(rows):
            await db.execute(
                update(User).where(User.id_client == row.id_client)
                .values(cluster_id=int(labels[i]), segment=f"Cluster {labels[i]}")
            )
        await db.commit()


@router.get("/pca")
async def get_pca(
    db: AsyncSession = Depends(get_db),
    sample_size: int = Query(3000, ge=200, le=10000),
    product_group: Optional[str] = Query(None),
):
    from sklearn.decomposition import PCA
    from sklearn.preprocessing import StandardScaler
    import pandas as pd

    pg_filter = "AND primary_product_group = :pg" if product_group else ""
    params    = {"n": sample_size, **({"pg": product_group} if product_group else {})}

    # Extra display/colour-by columns — included so the frontend can render rich
    # hover content and let the user re-colour the scatter by any dimension
    # without a second round-trip.
    extra_cols = [
        "user_country", "customer_age", "platform", "language",
        "primary_product_group", "product_types",
    ]
    cols = ["id_client", "cluster_id", "segment"] + NUMERIC_COLS + extra_cols
    result = await db.execute(
        text(f"SELECT {', '.join(cols)} FROM users WHERE cluster_id IS NOT NULL {pg_filter} ORDER BY RANDOM() LIMIT :n"),
        params,
    )
    rows = result.fetchall()
    if not rows:
        return {"points": [], "variance_explained": []}

    df = pd.DataFrame(rows, columns=cols)
    X = df[NUMERIC_COLS].fillna(0).values
    X_scaled = StandardScaler().fit_transform(X)

    pca = PCA(n_components=2, random_state=42)
    coords = pca.fit_transform(X_scaled)
    df["pc1"] = coords[:, 0].round(4)
    df["pc2"] = coords[:, 1].round(4)

    out_cols = [
        "id_client", "cluster_id", "segment", "pc1", "pc2",
        "total_spent", "recency", "purchase_frequency",
        "user_country", "customer_age", "platform", "language",
        "primary_product_group", "product_types",
    ]
    return {
        "points": df[out_cols].to_dict(orient="records"),
        "variance_explained": [round(v, 3) for v in pca.explained_variance_ratio_.tolist()],
    }
