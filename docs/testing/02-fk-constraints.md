# Test 02 — Foreign-Key Constraints on `campaign_recipients`

**Date:** 2026-05-10
**Component:** PostgreSQL 15 (Dashboard Backend's database)
**Tester:** Leen Rayyan
**Status:** ✅ PASS (3/3 cases)

## What is being tested

The two foreign-key constraints added to `campaign_recipients`:

* `campaign_recipients_campaign_id_fkey`
  `FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE`
* `campaign_recipients_user_id_fkey`
  `FOREIGN KEY (user_id) REFERENCES users(id_client)` (default `ON DELETE NO ACTION`)

Each must:

* reject inserts whose `campaign_id` does not exist in `campaigns`,
* reject inserts whose `user_id` does not exist in `users.id_client`,
* cascade-delete recipient rows when their parent campaign is deleted,
* leave recipient rows alone when no parent change occurred.

## Why it matters

Reviewer of the Physical ERD (see `docs/diagrams/03-erd-prose.md`)
flagged that the diagram drew crow's-foot FK lines for these two
relationships, but the SQLAlchemy model declared them as plain integer
columns — *no* `ForeignKey(...)` declaration, *no* DB-level constraint.
This made the ERD untruthful and left the database vulnerable to
silent data corruption (a recipient row pointing at a deleted campaign
or non-existent user).

We picked option (a) from the reviewer's two suggestions: add the real
constraints to the schema (rather than annotate the diagram as
"logical FKs only"). This test verifies the constraints behave
correctly end-to-end.

## How the test was performed

1. `docker compose up -d postgres redis`
2. `cd backend && python scripts/migrate.py`
   (added the two `FOREIGN KEY` constraints idempotently to the existing
   dev database; ran cleanly with no orphan-row errors, confirming no
   pre-existing inconsistencies)
3. Constraint presence verified directly in Postgres:
   ```sql
   SELECT conname, pg_get_constraintdef(oid)
   FROM pg_constraint
   WHERE conrelid = 'campaign_recipients'::regclass AND contype = 'f';
   ```
   Returned both expected constraints with the expected definitions.

## Test cases

### Case A — orphan `campaign_id` rejected

**SQL**
```sql
INSERT INTO campaign_recipients (campaign_id, user_id)
VALUES (999999, (SELECT id_client FROM users LIMIT 1));
```

**Expected:** error referencing `campaign_recipients_campaign_id_fkey`.
**Actual:**
```
ERROR:  insert or update on table "campaign_recipients" violates foreign key constraint
        "campaign_recipients_campaign_id_fkey"
DETAIL: Key (campaign_id)=(999999) is not present in table "campaigns".
```
✅

### Case B — orphan `user_id` rejected

**SQL**
```sql
INSERT INTO campaigns (name) VALUES ('FK test campaign') RETURNING id;
INSERT INTO campaign_recipients (campaign_id, user_id)
VALUES ((SELECT MAX(id) FROM campaigns), 999999999);
```

**Expected:** error referencing `campaign_recipients_user_id_fkey`.
**Actual:**
```
ERROR:  insert or update on table "campaign_recipients" violates foreign key constraint
        "campaign_recipients_user_id_fkey"
DETAIL: Key (user_id)=(999999999) is not present in table "users".
```
✅

### Case C — `ON DELETE CASCADE` cleans up recipients

**SQL**
```sql
INSERT INTO campaigns (name, status) VALUES ('cascade-test', 'draft');
INSERT INTO campaign_recipients (campaign_id, user_id)
  SELECT c.id, u.id_client
  FROM campaigns c, users u
  WHERE c.name = 'cascade-test'
  LIMIT 1;
SELECT COUNT(*) FROM campaign_recipients
  WHERE campaign_id = (SELECT id FROM campaigns WHERE name='cascade-test');
DELETE FROM campaigns WHERE name='cascade-test';
SELECT COUNT(*) FROM campaign_recipients cr
  WHERE NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.id = cr.campaign_id);
```

**Expected:**
* `recipients_before = 1`
* deleting the parent campaign succeeds
* no orphan recipients remain afterwards (count = 0)

**Actual:**
```
recipients_before        | 1
DELETE 1
recipients_after_cascade | 0
```
✅

## Implementation reference

* Model: `backend/models.py` lines 137–141 (commit `64b5f35`)
* Migration: `backend/scripts/migrate.py` lines 32–60
* Constraint definitions in DB:
  ```
  campaign_recipients_campaign_id_fkey  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  campaign_recipients_user_id_fkey      FOREIGN KEY (user_id) REFERENCES users(id_client)
  ```

## Notes for the report

The `ON DELETE CASCADE` on `campaign_id` was chosen so that deleting a
test or aborted campaign does not leave orphan recipient rows. The
`user_id` constraint deliberately uses the default (`NO ACTION`)
because customers are never deleted in the current data model, and
the constraint should serve as a guard against accidentally dropping
a user that still has campaign history attached.
