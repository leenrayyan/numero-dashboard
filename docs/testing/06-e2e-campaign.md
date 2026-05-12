# Test 06 — End-to-End Campaign Lifecycle

**Date:** 2026-05-12
**Component:** Backend FastAPI + Postgres (campaigns / campaign_recipients orchestration)
**Tester:** Leen Rayyan
**Status:** ✅ PASS (1/1 case, with a real bug surfaced & fixed)

## What is being tested

The wiring that turns a campaign send into analytics counters. Earlier
layers test individual boundaries (HMAC auth, FK constraints, NL→SQL,
LLM reply correctness), but no single test today proves the chain holds
when one campaign moves through `sent → delivered → read → replied`.

Specifically, the test exercises this sequence via the live backend API
on `localhost:8000`:

1. `POST /api/campaigns/` — create a new campaign
2. `POST /api/campaigns/{id}/recipients × 3` — register three recipients
   with distinct `wa_message_id`s
3. `PATCH /api/campaigns/recipients/event?event=delivered` for recipient 1
4. `PATCH /api/campaigns/recipients/event?event=read` for recipient 2
5. `PATCH /api/campaigns/recipients/event?event=replied` for recipient 3
6. `GET /api/campaigns/{id}` — verify campaign-level counters
7. `DELETE FROM campaigns WHERE id=...` — verify ON DELETE CASCADE wipes
   recipients (re-test of layer 2 in a new context)

## Why it matters

The dashboard's funnel chart, the per-segment campaign stats and the
"converted" rate displayed on the Reports page all read the
`campaigns.{sent,delivered,read,replied,converted}_count` columns. Those
columns are not written by the analyst — they are derived from the
recipient-level status events that `wa-gateway` calls back into the
backend whenever Meta sends a delivery / read / reply webhook. If that
re-aggregation logic is wrong, the analyst sees stale or incorrect
metrics with no visible signal that anything is broken.

This is exactly the kind of cross-component wiring that single-layer
tests miss. A unit test on `recipient_event` would have caught the bug
in isolation; an FK test catches FK behaviour. Neither would have caught
both the bug AND the orchestration in one run.

## How the test was performed

Run from `backend/`:

```bash
python scripts/test_e2e_campaign.py
```

Prereqs: Postgres up, backend up, ≥ 3 rows in `users` (the test pulls
three real `id_client` values to satisfy the `campaign_recipients.user_id`
FK).

## Expected vs observed

The status hierarchy is monotone in the backend's re-aggregation SQL
(`backend/routers/campaigns.py::recipient_event`): `replied` implies
`read` implies `delivered` implies `sent`. So setting one recipient to
`replied`, another to `read`, and a third to `delivered` should yield:

| Counter           | Expected | Observed |
|-------------------|---------:|---------:|
| `sent_count`      |        3 |        3 |
| `delivered_count` |        3 |        3 |
| `read_count`      |        2 |        2 |
| `replied_count`   |        1 |        1 |
| `converted_count` |        0 |        0 |

End-to-end elapsed: **16.66 s** (includes campaign create, 3 recipient
upserts, 3 event PATCHes, 1 GET readback, 1 DB cascade verify, cleanup).

## Bug surfaced — and fixed

On the first run the recipient `POST` returned HTTP 500. The backend log
showed:

```
asyncpg.exceptions.DataError: invalid input for query argument $6:
datetime.datetime(2026, 5, 12, 2, 59, 0, ..., tzinfo=datetime.timezone.utc)
(can't subtract offset-naive and offset-aware datetimes)
```

Root cause: `backend/routers/campaigns.py` was calling
`datetime.now(timezone.utc)` (offset-aware) and assigning it to columns
declared `Column(DateTime, ...)` (no `timezone=True`), which is
`TIMESTAMP WITHOUT TIME ZONE` in Postgres. The asyncpg driver refuses
that combination by default.

Fix: convert to a naive-UTC datetime at the insertion site
(`datetime.now(timezone.utc).replace(tzinfo=None)`) — preserves the
clock value, drops the tzinfo to match the column type. Applied to all
four callsites in `campaigns.py`.

Significance: the bug would have blocked every campaign send in
production, with no test catching it because no test exercised the
recipient-insert path through the API layer before this. Same class of
finding as Smart Query test 12 — the test suite surfaces real defects
the test wasn't directly targeting.

## Notes for the report

- Single golden-path case. Edge cases (FK violation already covered by
  layer 2; conflicting events; bulk recipients) are out of scope here.
- The test cleans up by deleting the test campaign, which exercises the
  `ON DELETE CASCADE` from layer 2 in a new context as a side effect.
- Latency is dominated by network round-trips and Postgres commits
  (~ 1.5 s per HTTP call × ~10 calls). Pure DB ops would be sub-second.

Evidence JSON written next to this file:
`docs/testing/06-e2e-campaign-results.json`
