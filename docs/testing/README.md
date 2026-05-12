# Test Evidence Log

Manual and automated test runs that demonstrate the system behaves as
designed. Each entry maps to either a functional requirement, a
non-functional requirement, or a specific reviewer critique we acted on.

This log feeds Chapter 7 (Testing) of the report — each numbered file
here can be summarised in one row of the testing matrix and cited as
evidence.

## Index

| #  | Date         | Component        | What we tested                                    | Result | File |
|----|--------------|------------------|---------------------------------------------------|--------|------|
| 01 | 2026-05-10   | wa-gateway       | Meta webhook HMAC-SHA256 signature verification    | ✅ PASS (4/4) | [01-webhook-signature.md](./01-webhook-signature.md) |
| 02 | 2026-05-10   | PostgreSQL       | FK constraints on `campaign_recipients` (rejection + cascade delete) | ✅ PASS (3/3) | [02-fk-constraints.md](./02-fk-constraints.md) |
| 03 | 2026-05-10   | backend / Vanna  | Smart Query NL→SQL evaluation (22 declarative cases) | ✅ PASS (20/22) | [03-smart-query.md](./03-smart-query.md) |
| 04 | 2026-05-10   | reply-ai         | LLM adversarial robustness (3 batches, 19 cases)   | ✅ PASS (19/19 after prompt + predicate fixes) | [04-llm-robustness.md](./04-llm-robustness.md) |

<!-- New entries: append a row above and add a corresponding markdown file. -->

## Conventions for new entries

Each test file should answer five questions:

1. **What** is being tested (one sentence)
2. **Why** it matters (which requirement, which critique, what risk it mitigates)
3. **How** the test was performed (exact commands, env state, prereqs)
4. **Expected** vs **actual** outcome per case
5. **Status** — PASS / FAIL / PARTIAL — with date and tester

Keep one feature per file. When a test changes, update in place and bump
the date; don't delete history.
