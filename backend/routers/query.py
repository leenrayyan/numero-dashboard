import asyncio
import json
import math
import re
import time
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import audience_cache

router = APIRouter()

# JSONL log of every question + generated SQL. Reviewing this is how we'll
# decide what new training pairs to add.
_LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)
_QUERY_LOG = _LOG_DIR / "vanna_queries.jsonl"
_FEEDBACK_LOG = _LOG_DIR / "vanna_feedback.jsonl"


def _append_jsonl(path: Path, payload: dict) -> None:
    try:
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, default=str) + "\n")
    except Exception:
        # Logging must never break the request path.
        pass

# Only allow read-only statements out of Vanna. Vanna usually emits SELECT, but
# the LLM is non-deterministic — a regex gate is cheap insurance.
_SELECT_RE = re.compile(r"^\s*(?:with\b[\s\S]+?\bselect\b|select\b)", re.IGNORECASE)


class QueryRequest(BaseModel):
    question: str


class QueryResponse(BaseModel):
    sql: str
    summary: str
    columns: list
    rows: list
    # Server-side audience cache: when result_kind == "users", the full id_client
    # list is stored under this opaque token. Frontend sends ?audience=<token>
    # on subsequent analytics calls, server resolves it to the IN clause.
    # Avoids shipping hundreds of thousands of ids through URL query strings.
    audience_id: Optional[str] = None
    audience_size: int = 0
    # "users"  → result is a list of users (id_client present), drives filter
    # "scalar" → 1 row × 1 col aggregate (e.g. avg, count)
    # "table"  → anything else; show as a table
    result_kind: str = "table"
    row_count: int = 0
    truncated: bool = False


def _sanitize_value(v: Any) -> Any:
    """Coerce a single cell into a JSON-serialisable primitive."""
    if v is None:
        return None
    if isinstance(v, float):
        return None if math.isnan(v) or math.isinf(v) else v
    if isinstance(v, (np.floating,)):
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, (pd.Timestamp, datetime, date)):
        return v.isoformat() if not pd.isna(v) else None
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (bytes, bytearray)):
        return v.decode("utf-8", errors="replace")
    # pandas NA / NaT
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    return v


def _classify_result(df: pd.DataFrame) -> str:
    if "id_client" in df.columns:
        return "users"
    if df.shape == (1, 1):
        return "scalar"
    return "table"


def _summary_input(df: pd.DataFrame) -> pd.DataFrame:
    """Don't ship megabytes to the LLM. For big results, send only describe+head."""
    if len(df) <= 20:
        return df
    # describe() over numeric columns is a compact statistical view; pair with
    # the first 10 rows so the LLM has both shape and feel.
    try:
        described = df.describe(include="all").reset_index().rename(columns={"index": "stat"})
    except Exception:
        described = df.head(0)
    return pd.concat([described, df.head(10)], ignore_index=True)


def _run_vanna(question: str) -> dict:
    """Sync Vanna call — kept out of the event loop via asyncio.to_thread."""
    from vanna_gemini import get_vanna
    vn = get_vanna()

    sql = vn.generate_sql(question)
    if not sql:
        return {"error": ("missing_sql", "Could not generate SQL for that question.")}

    if not _SELECT_RE.match(sql):
        return {"error": ("unsafe_sql", f"Generated SQL is not a SELECT statement: {sql[:200]}")}

    df = vn.run_sql(sql)
    if df is None or df.empty:
        return {
            "sql": sql, "df": None, "summary": "No results found.",
            "result_kind": "table", "row_count": 0,
        }

    result_kind = _classify_result(df)

    # Skip the LLM summary for tiny results — the table is its own summary.
    summary = ""
    if len(df) > 20:
        try:
            summary = vn.generate_summary(question, _summary_input(df)) or ""
        except Exception:
            summary = ""

    return {
        "sql": sql,
        "df": df,
        "summary": summary,
        "result_kind": result_kind,
        "row_count": len(df),
    }


class FeedbackRequest(BaseModel):
    question: str
    sql: str
    vote: str  # "up" | "down"
    note: Optional[str] = None


@router.post("/", response_model=QueryResponse)
async def natural_language_query(body: QueryRequest):
    """Convert natural language question to SQL, run it, return results + summary."""
    started = time.perf_counter()
    log_entry: dict = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "question": body.question,
    }
    try:
        result = await asyncio.to_thread(_run_vanna, body.question)

        if "error" in result:
            kind, msg = result["error"]
            log_entry.update({"error": kind, "latency_ms": int((time.perf_counter() - started) * 1000)})
            _append_jsonl(_QUERY_LOG, log_entry)
            status = 422 if kind == "missing_sql" else 400
            raise HTTPException(status_code=status, detail=msg)

        df: Optional[pd.DataFrame] = result["df"]
        sql: str = result["sql"]
        result_kind: str = result["result_kind"]
        row_count: int = result["row_count"]

        if df is None:
            log_entry.update({"sql": sql, "row_count": 0, "result_kind": "table",
                              "latency_ms": int((time.perf_counter() - started) * 1000)})
            _append_jsonl(_QUERY_LOG, log_entry)
            return QueryResponse(
                sql=sql, summary=result["summary"], columns=[], rows=[],
                audience_id=None, audience_size=0,
                result_kind="table", row_count=0, truncated=False,
            )

        ROW_CAP = 500
        truncated = row_count > ROW_CAP
        head = df.head(ROW_CAP)
        columns = head.columns.tolist()
        rows = [[_sanitize_value(v) for v in row] for row in head.itertuples(index=False, name=None)]

        audience_id: Optional[str] = None
        audience_size = 0
        if result_kind == "users":
            ids = [int(v) for v in df["id_client"].tolist() if pd.notna(v)]
            audience_size = len(ids)
            audience_id = audience_cache.put(ids, question=body.question, sql=sql)

        log_entry.update({"sql": sql, "row_count": row_count, "result_kind": result_kind,
                          "audience_size": audience_size,
                          "latency_ms": int((time.perf_counter() - started) * 1000)})
        _append_jsonl(_QUERY_LOG, log_entry)

        return QueryResponse(
            sql=sql,
            summary=result["summary"],
            columns=columns,
            rows=rows,
            audience_id=audience_id,
            audience_size=audience_size,
            result_kind=result_kind,
            row_count=row_count,
            truncated=truncated,
        )

    except HTTPException:
        raise
    except Exception as e:
        log_entry.update({"error": "exception", "detail": str(e),
                          "latency_ms": int((time.perf_counter() - started) * 1000)})
        _append_jsonl(_QUERY_LOG, log_entry)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/feedback")
async def query_feedback(body: FeedbackRequest):
    """Record a thumbs-up/down on a question→SQL pair. Reviewed manually to
    pick what becomes a new training example."""
    if body.vote not in ("up", "down"):
        raise HTTPException(status_code=400, detail="vote must be 'up' or 'down'")
    _append_jsonl(_FEEDBACK_LOG, {
        "ts": datetime.now(timezone.utc).isoformat(),
        "question": body.question,
        "sql": body.sql,
        "vote": body.vote,
        "note": body.note,
    })
    return {"ok": True}


def _read_jsonl_tail(path: Path, limit: int) -> list[dict]:
    if not path.exists():
        return []
    out: list[dict] = []
    # Streaming-tail: cheap enough for tens of thousands of lines.
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out[-limit:]


@router.get("/stats")
async def query_stats(limit: int = 200):
    """Rolling stats over recent queries -- success rate, p50/p95 latency,
    most-common errors, recent thumbs-down feedback. Useful for picking the
    next round of training pairs without having to grep JSONL by hand."""
    recent = _read_jsonl_tail(_QUERY_LOG, limit)
    feedback = _read_jsonl_tail(_FEEDBACK_LOG, limit)

    total = len(recent)
    errors = [r for r in recent if "error" in r]
    successes = total - len(errors)

    latencies = sorted(int(r["latency_ms"]) for r in recent if "latency_ms" in r)
    def pct(p: float) -> Optional[int]:
        if not latencies:
            return None
        idx = min(len(latencies) - 1, int(len(latencies) * p))
        return latencies[idx]

    # Top 5 error kinds.
    error_kinds: dict[str, int] = {}
    for r in errors:
        kind = r.get("error", "unknown")
        error_kinds[kind] = error_kinds.get(kind, 0) + 1
    top_errors = sorted(error_kinds.items(), key=lambda kv: kv[1], reverse=True)[:5]

    thumbs_down = [f for f in feedback if f.get("vote") == "down"]
    thumbs_up = [f for f in feedback if f.get("vote") == "up"]

    return {
        "window": {"requested": limit, "found": total},
        "success_rate":    round(successes / total, 3) if total else None,
        "successes":       successes,
        "errors":          len(errors),
        "top_errors":      [{"kind": k, "count": n} for k, n in top_errors],
        "latency_ms": {
            "p50": pct(0.50),
            "p95": pct(0.95),
            "max": latencies[-1] if latencies else None,
        },
        "feedback": {
            "up":   len(thumbs_up),
            "down": len(thumbs_down),
            "recent_down": [
                {"question": f.get("question"), "sql": f.get("sql"), "ts": f.get("ts")}
                for f in thumbs_down[-10:]
            ],
        },
        "recent_failed_questions": [
            {"question": r.get("question"), "error": r.get("error"), "detail": r.get("detail")}
            for r in errors[-10:]
        ],
    }
