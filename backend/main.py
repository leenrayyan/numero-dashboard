import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from database import init_db
from routers import analytics, users, segmentation, clusters, query, campaigns, exports

log = logging.getLogger("uvicorn.error")


async def _warmup_vanna() -> None:
    """Pre-initialise Vanna so the first user query doesn't pay the import +
    Chroma open + Postgres connect cost. Runs in a thread so a slow init can't
    block the rest of startup. Failures here are logged but not fatal -- the
    /api/query route can still recover lazily on the first real request."""
    started = time.perf_counter()
    try:
        from vanna_gemini import get_vanna
        await asyncio.to_thread(get_vanna)
        ms = int((time.perf_counter() - started) * 1000)
        log.info("vanna_warmup ok in %sms", ms)
    except Exception as e:
        ms = int((time.perf_counter() - started) * 1000)
        # Most common cause: GEMINI_API_KEY missing / wrong. Surface it now,
        # not on the user's first Smart Query.
        log.warning("vanna_warmup failed in %sms: %s", ms, e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Fire-and-forget so a slow LLM/DB warmup can't delay readiness.
    asyncio.create_task(_warmup_vanna())
    yield


app = FastAPI(title="Dormant Users Reactivation Engine", lifespan=lifespan)

# CORS — local dev origins are always allowed; extra origins (if you ever deploy)
# come from the CORS_ORIGINS env var (comma-separated).
DEFAULT_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
]
extra = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=DEFAULT_ORIGINS + extra,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Gzip every response over 1KB. JSON compresses ~5-7x because of repeated
# field names and numeric strings — meaningful win on /api/clusters/pca which
# can ship 200K+ rows of cluster-scatter data. Browser handles decompression
# transparently via Accept-Encoding.
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(segmentation.router, prefix="/api/segmentation", tags=["segmentation"])
app.include_router(clusters.router, prefix="/api/clusters", tags=["clusters"])
app.include_router(query.router,     prefix="/api/query",     tags=["query"])
app.include_router(campaigns.router, prefix="/api/campaigns", tags=["campaigns"])
app.include_router(exports.router,   prefix="/api/exports",   tags=["exports"])


@app.get("/health")
async def health():
    return {"status": "ok"}
