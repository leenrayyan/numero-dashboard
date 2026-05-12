"""
Vanna evaluation harness.

Runs a battery of natural-language questions through Vanna, executes the
generated SQL, and checks each result against declarative assertions about
shape and content. Prints a per-test pass/fail line and a final summary.

Usage:
    python scripts/eval_vanna.py                  # run full suite
    python scripts/eval_vanna.py --verbose        # also print SQL + first 3 rows on every test
    python scripts/eval_vanna.py --only "Android" # only run tests whose question matches a substring
    python scripts/eval_vanna.py --sleep 3.0      # seconds between tests (free-tier rate-limit safety)

Why declarative assertions:
    A test like "show me Android users" has many valid SQL implementations.
    We don't want to grade on exact SQL match. Instead we grade on
    *outcome*: did the result have a `platform` column where every value
    is 'Android'? That's the actual contract the user cares about.

Design:
    Each test case is a dict with:
        question:           str   — the NL prompt to pass to Vanna
        must_run:           bool  — assert SQL executes without error
        required_columns:   list  — assert these columns appear in result
        column_value:       dict  — { col_name: value } — every result row must have this value
        column_predicate:   dict  — { col_name: lambda v: bool } — every row must satisfy
        min_rows / max_rows:int   — bounds on result row count
        single_value:       any   — assert single-cell result (used for COUNT-style queries)

    A test passes only if all configured assertions hold. Missing
    assertions are skipped (so a test that just says must_run=True is
    a smoke test).

Cluster-independence:
    None of these tests reference a specific cluster name (e.g. 'High Value
    Loyal'). They only assume schema columns. So this suite is stable
    across re-clustering.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import traceback
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@dataclass
class TestCase:
    question: str
    must_run: bool = True
    required_columns: List[str] = field(default_factory=list)
    column_value: Dict[str, Any] = field(default_factory=dict)
    column_predicate: Dict[str, Callable[[Any], bool]] = field(default_factory=dict)
    min_rows: Optional[int] = None
    max_rows: Optional[int] = None
    single_value: bool = False


# ─────────────────────────────────────────────────────────────────────────────
# Test suite. Every test exercises a different schema dimension so we get
# coverage on what Vanna does/doesn't know about the columns.
# ─────────────────────────────────────────────────────────────────────────────
TESTS: List[TestCase] = [
    # ── Counts / aggregates ───────────────────────────────────────────────
    TestCase(
        question="How many users are there in total?",
        single_value=True,
    ),
    TestCase(
        question="How many users are there per primary product group?",
        required_columns=["primary_product_group"],
        min_rows=1,
        max_rows=10,
    ),
    TestCase(
        question="How many users are on iOS vs Android?",
        required_columns=["platform"],
        min_rows=1,
        max_rows=5,
        column_predicate={"platform": lambda v: v in ("iOS", "Android", None)},
    ),
    TestCase(
        question="How many users have a reactivation score?",
        single_value=True,
    ),

    # ── Single-column filter ──────────────────────────────────────────────
    TestCase(
        question="Show me Android users",
        required_columns=["id_client"],
        column_value={"platform": "Android"},  # only checked if column is present
        min_rows=1,
    ),
    TestCase(
        question="Show me iOS users with high spend",
        required_columns=["id_client"],
        column_value={"platform": "iOS"},
        min_rows=1,
    ),
    TestCase(
        question="Find users who speak Arabic",
        required_columns=["id_client"],
        column_value={"language": "arabic"},
        min_rows=1,
    ),
    TestCase(
        question="Show users from the UK",
        required_columns=["id_client"],
        column_value={"user_country": "UK"},
        min_rows=1,
    ),

    # ── Numeric range filters ─────────────────────────────────────────────
    TestCase(
        question="Show users with reactivation score above 0.7",
        required_columns=["id_client"],
        column_predicate={"reactivation_score": lambda v: v is None or v > 0.7},
        min_rows=1,
    ),
    TestCase(
        question="Show users who haven't purchased in over a year",
        required_columns=["id_client"],
        column_predicate={"recency": lambda v: v is None or v > 365},
        min_rows=1,
    ),
    TestCase(
        question="Find users who spent more than 100",
        required_columns=["id_client"],
        column_predicate={"total_spent": lambda v: v is None or v > 100},
        min_rows=1,
    ),

    # ── Boolean / nullability ─────────────────────────────────────────────
    TestCase(
        question="Show users who opted in to WhatsApp",
        required_columns=["id_client"],
        column_predicate={"whatsapp_opted_in": lambda v: v is None or v is True or v == 1},
        min_rows=1,
    ),
    TestCase(
        question="Which users have not received any campaign yet?",
        required_columns=["id_client"],
        column_predicate={"campaigns_sent": lambda v: v in (None, 0)},
        min_rows=1,
    ),

    # ── Multi-condition ───────────────────────────────────────────────────
    TestCase(
        question="Show high-spend Android users in the UK",
        required_columns=["id_client"],
        column_value={"platform": "Android", "user_country": "UK"},
        min_rows=0,  # may legitimately be 0 if intersection is empty
    ),
    TestCase(
        question="Find good reactivation candidates: high score, WhatsApp reachable, dormant over 90 days",
        required_columns=["id_client"],
        column_predicate={
            "reactivation_score": lambda v: v is None or v >= 0.5,
            "recency":            lambda v: v is None or v > 90,
            "whatsapp_opted_in":  lambda v: v is None or v is True or v == 1,
        },
        min_rows=0,
    ),

    # ── Schema knowledge probes (do they hit the right columns?) ───────────
    TestCase(
        question="What are the most common dominant products?",
        required_columns=["dominant_product"],
        min_rows=1,
        max_rows=20,
    ),
    TestCase(
        question="Show users who buy all three product types",
        required_columns=["id_client"],
        # All three frequencies should be > 0 (or NULL — we don't fail on missing col)
        column_predicate={
            "calls_frequency":   lambda v: v is None or v > 0,
            "esim_frequency":    lambda v: v is None or v > 0,
            "virtual_frequency": lambda v: v is None or v > 0,
        },
        min_rows=0,
    ),
    TestCase(
        question="Top 10 countries by user count",
        required_columns=["user_country"],
        min_rows=1,
        max_rows=10,
    ),

    # ── Distribution / grouping ───────────────────────────────────────────
    TestCase(
        question="Average spend per segment",
        required_columns=["segment"],
        min_rows=1,
    ),
    TestCase(
        question="Language distribution of users",
        required_columns=["language"],
        min_rows=1,
        max_rows=10,
    ),

    # ── Campaign-table questions ──────────────────────────────────────────
    TestCase(
        question="Show top campaigns by reply count",
        # campaigns table may be empty in dev; just smoke-test that it runs
        max_rows=20,
    ),
    TestCase(
        question="Show aggregate campaign funnel: total sent, delivered, read, replied, converted",
        single_value=False,
        max_rows=2,  # one summary row
    ),
]


# ─────────────────────────────────────────────────────────────────────────────
# Eval engine
# ─────────────────────────────────────────────────────────────────────────────

class TestResult:
    def __init__(self, tc: TestCase):
        self.tc = tc
        self.sql: Optional[str] = None
        self.error: Optional[str] = None
        self.columns: List[str] = []
        self.row_count: int = 0
        self.first_rows: List[List[Any]] = []
        self.failures: List[str] = []
        self.latency_ms: float = 0.0

    @property
    def passed(self) -> bool:
        return not self.failures and self.error is None

    def short(self) -> str:
        if self.error:
            return f"ERROR: {self.error.splitlines()[0][:120]}"
        if self.failures:
            return "; ".join(self.failures[:3])
        return f"OK ({self.row_count} rows)"


def run_test(vn, tc: TestCase) -> TestResult:
    res = TestResult(tc)
    t0 = time.time()
    try:
        sql = vn.generate_sql(tc.question)
        res.sql = sql
        if not sql or not sql.strip():
            res.failures.append("empty SQL generated")
            return res

        df = vn.run_sql(sql)
        res.latency_ms = (time.time() - t0) * 1000

        if df is None:
            res.failures.append("run_sql returned None")
            return res

        res.columns = df.columns.tolist()
        res.row_count = len(df)
        res.first_rows = df.head(3).values.tolist()

        # ── Assertions ────────────────────────────────────────────────────
        if tc.min_rows is not None and res.row_count < tc.min_rows:
            res.failures.append(f"min_rows={tc.min_rows} but got {res.row_count}")
        if tc.max_rows is not None and res.row_count > tc.max_rows:
            res.failures.append(f"max_rows={tc.max_rows} but got {res.row_count}")

        if tc.single_value:
            if res.row_count != 1 or len(res.columns) != 1:
                res.failures.append(
                    f"single_value expects 1x1 result, got {res.row_count} rows × {len(res.columns)} cols"
                )

        for col in tc.required_columns:
            if col not in res.columns:
                res.failures.append(f"missing required column '{col}'")

        # Column-value assertions: only checked when the column is present.
        # (Missing-column is reported by required_columns; we don't double-fail.)
        for col, expected in tc.column_value.items():
            if col in res.columns:
                bad = df[df[col] != expected]
                if len(bad) > 0:
                    sample = bad[col].iloc[0]
                    res.failures.append(f"{col} expected {expected!r}, found {sample!r}")

        for col, predicate in tc.column_predicate.items():
            if col in res.columns:
                # Apply predicate row-by-row; first failure surfaced.
                for v in df[col].tolist():
                    if not predicate(v):
                        res.failures.append(f"{col} predicate failed on value {v!r}")
                        break

    except Exception as e:  # noqa: BLE001
        res.latency_ms = (time.time() - t0) * 1000
        res.error = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
    return res


def main():
    parser = argparse.ArgumentParser(description="Evaluate Vanna SQL-generation quality.")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Print SQL and first 3 rows for every test (not just failures).")
    parser.add_argument("--only", type=str, default=None,
                        help="Substring filter: only run tests whose question contains this string.")
    parser.add_argument("--sleep", type=float, default=0.0,
                        help="Seconds to sleep between tests (use ~3-5s on free tier to avoid rate limits).")
    args = parser.parse_args()

    print("Connecting to Vanna…")
    from vanna_gemini import get_vanna
    vn = get_vanna()

    tests = TESTS
    if args.only:
        needle = args.only.lower()
        tests = [tc for tc in TESTS if needle in tc.question.lower()]
        if not tests:
            print(f"No tests matched --only {args.only!r}")
            return
        print(f"Running {len(tests)} tests matching --only {args.only!r}")

    results: List[TestResult] = []
    for i, tc in enumerate(tests, 1):
        print(f"\n[{i:>2}/{len(tests)}] {tc.question}")
        res = run_test(vn, tc)
        results.append(res)
        status = "PASS" if res.passed else "FAIL"
        print(f"        {status:>4}  {res.short()}  ({res.latency_ms:.0f} ms)")
        if args.verbose or not res.passed:
            if res.sql:
                print(f"        SQL: {' '.join(res.sql.split())[:300]}")
            if res.first_rows and not res.error:
                print(f"        cols: {res.columns}")
                for row in res.first_rows:
                    print(f"        row:  {row}")
        if args.sleep > 0 and i < len(tests):
            time.sleep(args.sleep)

    # ── Summary ────────────────────────────────────────────────────────────
    passed = sum(1 for r in results if r.passed)
    total = len(results)
    avg_latency = sum(r.latency_ms for r in results) / max(total, 1)
    # ASCII-only banner so Windows cp1252 consoles don't crash mid-print.
    print("\n" + "=" * 72)
    print(f"  RESULT: {passed} / {total} passed   -   avg latency {avg_latency:.0f} ms")
    print("=" * 72)
    if passed < total:
        print("\n  Failed tests:")
        for r in results:
            if not r.passed:
                print(f"   - {r.tc.question}")
                print(f"       -> {r.short()}")

    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
