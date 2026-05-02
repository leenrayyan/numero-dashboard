from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter()


class QueryRequest(BaseModel):
    question: str


class QueryResponse(BaseModel):
    sql: str
    summary: str
    columns: list
    rows: list
    user_ids: Optional[list] = None  # present if result contains id_client


@router.post("/", response_model=QueryResponse)
async def natural_language_query(body: QueryRequest):
    """Convert natural language question to SQL, run it, return results + summary."""
    try:
        from vanna_gemini import get_vanna
        vn = get_vanna()

        sql = vn.generate_sql(body.question)
        if not sql:
            raise HTTPException(status_code=422, detail="Could not generate SQL for that question.")

        df = vn.run_sql(sql)
        if df is None or df.empty:
            return QueryResponse(sql=sql, summary="No results found.", columns=[], rows=[], user_ids=[])

        summary = vn.generate_summary(body.question, df)

        columns = df.columns.tolist()
        rows = df.head(500).values.tolist()  # cap at 500 rows for UI

        user_ids = None
        if "id_client" in df.columns:
            user_ids = df["id_client"].tolist()

        return QueryResponse(
            sql=sql,
            summary=summary or "",
            columns=columns,
            rows=rows,
            user_ids=user_ids,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
