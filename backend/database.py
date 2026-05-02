from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from dotenv import load_dotenv
import os

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://admin:admin123@localhost:5432/dormant_users")

# Render's managed Postgres ships URLs as `postgres://` — SQLAlchemy needs `postgresql://`.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# asyncpg driver scheme.
ASYNC_DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

# Render Postgres requires SSL. asyncpg uses `ssl=true` (NOT `sslmode=require` like psycopg2).
# Strip `?sslmode=...` from the URL and pass `ssl=True` via connect_args instead.
connect_args = {}
if "sslmode=" in ASYNC_DATABASE_URL:
    base, _, query = ASYNC_DATABASE_URL.partition("?")
    pairs = [p for p in query.split("&") if not p.startswith("sslmode=")]
    ASYNC_DATABASE_URL = base + (("?" + "&".join(pairs)) if pairs else "")
    connect_args["ssl"] = True
elif os.getenv("DB_SSL", "").lower() in ("1", "true", "yes"):
    connect_args["ssl"] = True

engine = create_async_engine(ASYNC_DATABASE_URL, echo=False, connect_args=connect_args)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
