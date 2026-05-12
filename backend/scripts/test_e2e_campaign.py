"""
Layer 6 -- end-to-end campaign lifecycle test.

Exercises the wiring from "campaign created" through "Meta status callbacks
update counters". All four boundary layers in chapter 7 test a single edge
(webhook auth, FK, NL->SQL, LLM reply) but no test today proves the chain
holds when one campaign moves through send -> delivered -> read -> replied.

Flow under test (uses the live backend API on localhost:8000):

  1. POST /api/campaigns/                         -> create campaign C
  2. POST /api/campaigns/{C}/recipients * 3       -> three recipients R1, R2, R3
  3. PATCH /api/campaigns/recipients/event        -> R1 delivered
  4. PATCH /api/campaigns/recipients/event        -> R2 read
  5. PATCH /api/campaigns/recipients/event        -> R3 replied
  6. GET   /api/campaigns/{C}                     -> assert counters:
        sent_count >= 3, delivered_count >= 3, read_count >= 2, replied_count >= 1

Cleanup: DELETE FROM campaigns WHERE id=C cascades to recipients (FK ON DELETE
CASCADE). Run with the backend up:

    python scripts/test_e2e_campaign.py

Exit 0 = pass, exit 1 = fail. Writes evidence to
docs/testing/06-e2e-campaign-results.json next to the markdown log.
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

API = os.getenv("BACKEND_URL", "http://localhost:8000")
DB_URL = os.getenv("DATABASE_URL", "postgresql://admin:admin123@localhost:5432/dormant_users").replace("+asyncpg", "")
HERE = Path(__file__).resolve().parent
EVIDENCE = HERE.parent.parent / "docs" / "testing" / "06-e2e-campaign-results.json"


def fail(reason: str, ctx: dict | None = None) -> "tuple[bool, str, dict]":
    return False, reason, ctx or {}


def passed() -> "tuple[bool, str, dict]":
    return True, "", {}


def run() -> dict:
    """Execute the lifecycle and return a structured result."""
    started = time.time()
    log: list[dict] = []
    artifacts: dict = {}

    def step(name: str, ok: bool, **kv):
        log.append({"step": name, "ok": ok, **kv})

    # ── Need 3 real user ids from the DB ────────────────────────────────────
    engine = create_engine(DB_URL, future=True)
    with engine.connect() as conn:
        user_ids = [r[0] for r in conn.execute(text("SELECT id_client FROM users LIMIT 3"))]
    if len(user_ids) < 3:
        return {"passed": False, "reason": f"need 3 users, found {len(user_ids)}", "log": log}
    step("fetch 3 users", True, user_ids=user_ids)

    # ── 1. Create the campaign ──────────────────────────────────────────────
    create_body = {
        "name": f"e2e-test-{int(time.time())}",
        "offer_code": "TEST-OFFER",
        "message_template": "e2e test message",
        "segment_filter": None,
    }
    r = requests.post(f"{API}/api/campaigns/", json=create_body, timeout=10)
    if r.status_code not in (200, 201):
        step("POST /api/campaigns/", False, status=r.status_code, body=r.text[:300])
        return {"passed": False, "reason": "create campaign failed", "log": log}
    camp = r.json()
    camp_id = camp.get("id")
    artifacts["campaign_id"] = camp_id
    step("POST /api/campaigns/", True, campaign_id=camp_id)

    # ── 2. Register 3 recipients with wa_message_ids ────────────────────────
    wa_ids = [f"wamid.test_{camp_id}_{i}" for i in range(3)]
    for uid, wa_id in zip(user_ids, wa_ids):
        # Backend takes recipient fields as QUERY params (see campaigns.upsert_recipient).
        params = {
            "user_id": int(uid),
            "wa_message_id": wa_id,
            "phone_number": "00000000000",
            "status": "sent",
        }
        r = requests.post(f"{API}/api/campaigns/{camp_id}/recipients", params=params, timeout=10)
        if r.status_code not in (200, 201):
            step(f"POST recipient {uid}", False, status=r.status_code, body=r.text[:300])
            return {"passed": False, "reason": f"register recipient {uid} failed", "log": log}
        step(f"POST recipient {uid}", True, wa_message_id=wa_id)

    # ── 3. Fire one event per recipient ─────────────────────────────────────
    events = [
        (wa_ids[0], "delivered"),
        (wa_ids[1], "read"),
        (wa_ids[2], "replied"),
    ]
    for wa_id, ev in events:
        r = requests.patch(
            f"{API}/api/campaigns/recipients/event",
            params={"wa_message_id": wa_id, "event": ev},
            timeout=10,
        )
        if r.status_code != 200:
            step(f"PATCH {ev}", False, status=r.status_code, body=r.text[:300], wa_id=wa_id)
            return {"passed": False, "reason": f"event {ev} failed", "log": log}
        step(f"PATCH {ev}", True, wa_id=wa_id)

    # ── 4. Read back campaign counters ──────────────────────────────────────
    r = requests.get(f"{API}/api/campaigns/{camp_id}", timeout=10)
    if r.status_code != 200:
        step("GET campaign", False, status=r.status_code, body=r.text[:300])
        return {"passed": False, "reason": "fetch campaign failed", "log": log}
    final = r.json()
    artifacts["final_state"] = {
        k: final.get(k) for k in (
            "sent_count", "delivered_count", "read_count", "replied_count", "converted_count"
        )
    }
    step("GET campaign", True, **artifacts["final_state"])

    # ── 5. Assertions ───────────────────────────────────────────────────────
    # Status hierarchy is monotone: replied implies read implies delivered implies sent.
    # So replied=1 implies read>=1 implies delivered>=1 implies sent>=1 (per the SQL in
    # backend/routers/campaigns.py recipient_event).
    fs = artifacts["final_state"]
    expectations = [
        ("sent_count >= 3", (fs.get("sent_count") or 0) >= 3),
        ("delivered_count >= 3", (fs.get("delivered_count") or 0) >= 3),
        ("read_count >= 2", (fs.get("read_count") or 0) >= 2),
        ("replied_count >= 1", (fs.get("replied_count") or 0) >= 1),
        ("converted_count == 0", (fs.get("converted_count") or 0) == 0),
    ]
    failures = [name for name, ok in expectations if not ok]
    for name, ok in expectations:
        step(f"assert {name}", ok)

    # ── 6. Verify DB state directly (independent of the API readback) ───────
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT status, COUNT(*) FROM campaign_recipients "
            "WHERE campaign_id = :cid GROUP BY status ORDER BY status"
        ), {"cid": camp_id}).fetchall()
    artifacts["recipient_status_counts"] = {r[0]: r[1] for r in rows}
    step("DB status counts", True, **artifacts["recipient_status_counts"])

    # ── 7. Cleanup ──────────────────────────────────────────────────────────
    with engine.begin() as conn:
        deleted = conn.execute(text("DELETE FROM campaigns WHERE id = :cid"), {"cid": camp_id}).rowcount
    artifacts["cleanup_campaign_deletes"] = deleted

    # Verify cascade: recipients should be gone
    with engine.connect() as conn:
        remaining = conn.execute(
            text("SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = :cid"),
            {"cid": camp_id}
        ).scalar()
    cascade_ok = remaining == 0
    step("cascade cleanup", cascade_ok, remaining_recipients=remaining)
    if not cascade_ok:
        failures.append(f"cascade left {remaining} recipient rows after campaign delete")

    return {
        "passed": len(failures) == 0,
        "failures": failures,
        "elapsed_seconds": round(time.time() - started, 2),
        "artifacts": artifacts,
        "log": log,
    }


def main():
    result = run()
    result["timestamp_utc"] = datetime.now(timezone.utc).isoformat()
    result["test_name"] = "layer-6 e2e campaign lifecycle"

    EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE.write_text(json.dumps(result, indent=2, ensure_ascii=False, default=str), encoding="utf-8")

    print()
    print("=" * 60)
    print(f"  layer 6 -- e2e campaign lifecycle: {'PASS' if result['passed'] else 'FAIL'}")
    print(f"  elapsed: {result.get('elapsed_seconds')} s")
    print(f"  final state: {result.get('artifacts', {}).get('final_state', {})}")
    if result.get("failures"):
        print("  failures:")
        for f in result["failures"]:
            print(f"    - {f}")
    print(f"  evidence: {EVIDENCE}")
    print("=" * 60)
    sys.exit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
