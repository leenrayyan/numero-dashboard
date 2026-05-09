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
| 01 | 2026-05-10   | wa-gateway       | Meta webhook HMAC-SHA256 signature verification    | ✅ PASS | [01-webhook-signature.md](./01-webhook-signature.md) |

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
