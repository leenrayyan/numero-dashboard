# Test Evidence Log

Manual and automated test runs that demonstrate the system behaves as
designed. Each entry maps to either a functional requirement, a
non-functional requirement, or a specific reviewer critique we acted on.

This log feeds Chapter 7 (Testing) of the report. Each numbered file
here is summarised in one row of the §7.1.5 testing-approach table and
the §7.2.6 testing-results table.

## Index

| #  | Date         | Layer | Component        | What was tested                                                                            | Result | File |
|----|--------------|------:|------------------|--------------------------------------------------------------------------------------------|--------|------|
| 01 | 2026-05-10   | 1     | wa-gateway       | Meta webhook HMAC-SHA256 signature verification                                            | ✅ 4 / 4   | [01-webhook-signature.md](./01-webhook-signature.md) |
| 02 | 2026-05-10   | 2     | PostgreSQL       | FK constraints on `campaign_recipients` (rejection + cascade delete)                       | ✅ 3 / 3   | [02-fk-constraints.md](./02-fk-constraints.md) |
| 03 | 2026-05-12   | 3     | backend / Vanna  | Smart Query NL → SQL evaluation across eight thematic tiers (22 cases)                     | ✅ 22 / 22 effective | [03-smart-query.md](./03-smart-query.md) |
| 04 | 2026-05-12   | 4     | reply-ai         | Substring stress: four batches (product knowledge / adversarial / sensitive / multi-turn)  | ✅ 39 / 39 | [04-llm-robustness.md](./04-llm-robustness.md) |
| 05 | 2026-05-12   | 5     | reply-ai         | LLM-as-a-judge graded scoring on a 1–5 rubric across four dimensions (39 cases)            | ✅ per-dim means ≥ 4.6 | [05-llm-judge.md](./05-llm-judge.md) |
| 06 | 2026-05-12   | 6     | backend          | End-to-end campaign lifecycle (create → recipients → events → counters → cascade cleanup)  | ✅ 1 / 1   | [06-e2e-campaign.md](./06-e2e-campaign.md) |

Layers 7 (manual dashboard user-acceptance testing) and 8 (WhatsApp
outbound sandbox verification) were performed manually rather than
through script-driven evidence files and are described in Chapter 7
directly.

## Conventions for new entries

Each test file should answer five questions:

1. **What** is being tested (one sentence)
2. **Why** it matters (which requirement, which critique, what risk it mitigates)
3. **How** the test was performed (exact commands, env state, prereqs)
4. **Expected** vs **actual** outcome per case
5. **Status** — PASS / FAIL / PARTIAL — with date and tester

Keep one feature per file. When a test changes, update in place and bump
the date; don't delete history.
