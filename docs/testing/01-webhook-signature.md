# Test 01 — Meta Webhook Signature Verification

**Date:** 2026-05-10
**Component:** `wa-gateway` (Node + Express, port 3000)
**Tester:** Leen Rayyan
**Status:** ✅ PASS (4/4 cases)

## What is being tested

The HMAC-SHA256 signature-verification middleware on
`POST /webhook` (`wa-gateway/server.js → verifyMetaSignature`).
The middleware must:

* reject requests that arrive without an `x-hub-signature-256` header,
* reject requests whose signature does not match
  `HMAC-SHA256(rawBody, WHATSAPP_APP_SECRET)`,
* accept requests whose signature does match,
* fail closed when `WHATSAPP_APP_SECRET` itself is not configured.

## Why it matters

The webhook URL is publicly reachable on the internet (it has to be — Meta
calls it from outside our network). Without signature verification, any
third party could forge `delivered`, `read`, `replied` or `converted`
events, polluting `campaign_recipients`, distorting reactivation analytics,
and potentially DoS-ing the downstream Reply AI service with fake traffic.

This was the second-half of *Critique 5 — "no auth boundary shown"* raised
during the architecture review. It also satisfies the "external interface
authentication" non-functional requirement.

## How the test was performed

Two terminals.

**Terminal 1** — start the gateway:
```cmd
cd C:\Users\leenr\Desktop\GP\wa-gateway
node server.js
```
Expected boot line: `🚀 Numero eSIM Bot running on port 3000`.

**Terminal 2** — run each case below.

Prereqs: `wa-gateway/.env` contains a real `WHATSAPP_APP_SECRET` taken
from Meta Developer App → Settings → Basic.

## Test cases

### Case A — request with no signature header (negative)

**Command**
```cmd
curl -X POST http://localhost:3000/webhook ^
  -H "Content-Type: application/json" ^
  -d "{\"object\":\"whatsapp_business_account\",\"entry\":[]}"
```

**Expected:** HTTP 401, body `missing or malformed signature header`.
**Actual:** HTTP 401, body `missing or malformed signature header`. ✅

### Case B — request with a forged signature (negative)

**Command**
```cmd
curl -X POST http://localhost:3000/webhook ^
  -H "Content-Type: application/json" ^
  -H "x-hub-signature-256: sha256=0000000000000000000000000000000000000000000000000000000000000000" ^
  -d "{\"object\":\"whatsapp_business_account\",\"entry\":[]}"
```

**Expected:** HTTP 401, body `invalid signature`.
**Actual:** HTTP 401, body `invalid signature`, plus warning logged to
gateway stdout (`🚫 Webhook signature mismatch — rejecting request`). ✅

### Case C — request with a valid signature (positive)

This case can't be reproduced by hand-typing curl (the signature depends
on the exact bytes of the body). A small Node helper is committed at
`wa-gateway/test-webhook-signature.js` that:

1. loads `WHATSAPP_APP_SECRET` from `.env`,
2. builds a synthetic delivery-event payload,
3. computes the HMAC-SHA256 signature of that payload,
4. POSTs to `localhost:3000/webhook` with the signature header set.

**Command**
```cmd
cd C:\Users\leenr\Desktop\GP\wa-gateway
node test-webhook-signature.js
```

**Expected:**
```
→ POST /webhook with valid signature
  signature: sha256=...
← 200 OK

✅ Signature verification PASSED — middleware accepted the valid request.
```

**Actual:** as expected — 200 OK, "Signature verification PASSED" line
printed. ✅

### Case D — fail-closed when secret is unconfigured (additional)

If `WHATSAPP_APP_SECRET` is removed from `.env` and the gateway is
restarted, the boot log prints
`❌ WHATSAPP_APP_SECRET missing — webhook signature verification disabled.`
and *every* `POST /webhook` returns HTTP 401
`signature verification not configured`. This was verified by temporarily
commenting the env var, restarting, and re-running Case C, which then
returned 401 instead of 200. ✅

## Implementation reference

* Middleware: `wa-gateway/server.js`
  (`verifyMetaSignature`, lines 27–60 at commit `9dfa86d`)
* Helper / positive-case test: `wa-gateway/test-webhook-signature.js`
* Env documentation: `wa-gateway/.env.example` (`WHATSAPP_APP_SECRET` block)

## Notes for the report

This is the implemented half of webhook-side authentication. Analyst-side
authentication on the dashboard backend (login, sessions, RBAC) remains
out of scope for the current submission and is documented under §X
*Limitations and Future Work*.
