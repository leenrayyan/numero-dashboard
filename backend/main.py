import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from database import init_db
from routers import analytics, users, segmentation, clusters, query, campaigns, exports


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Dormant Users Reactivation Engine", lifespan=lifespan)

# CORS — local dev origins are always allowed; production Vercel/Render origins
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
