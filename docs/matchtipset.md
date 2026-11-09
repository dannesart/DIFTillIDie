# Matchtipset

Supporters tip the **60-minute score** of DIF men's **SHL regular-season** games. Points:
- **3** for the exact score.
- Otherwise **1** for the right outcome (home win, draw or away win after 60 minutes).
- Otherwise **0**.

Overtime and shootouts don't count. There's no betting and no prizes.

> **Status:** the database foundation only (Issue #11; the design and decisions are in #6).
> - There's no UI yet.
> - The migration is **not applied** to the hosted project. It's applied by hand after review; see [Release checklist](#release-checklist).

- Migration: [`20261109160000_matchtipset_foundation.sql`](../supabase/migrations/20261109160000_matchtipset_foundation.sql).
- Tests: [`tests/matchtipset-db.test.ts`](../tests/matchtipset-db.test.ts), [`supabase/tests/matchtipset_rls.test.sql`](../supabase/tests/matchtipset_rls.test.sql) and [`tests/matchtipset-stack.test.ts`](../tests/matchtipset-stack.test.ts).

## The rules, and where they're enforced

Everything here is enforced by the database: constraints, triggers and the functions below. The app is not trusted to enforce any of it.

| Rule | How |
|---|---|
| **Durable identity** | A match is its own `uuid`. It's never the MatchCard's `Fixture.id`, which contains a date. Teams, season and competition never change. A match entered wrong is **voided and entered again**. |
| **The deadline** | `locks_at` is the verified scheduled puck drop, checked with the database clock (`clock_timestamp()`). |
| **Before the deadline** | `reschedule` moves the game and the deadline together, either way, but never into the past. |
| **After the deadline** | The deadline **never moves later**, so nothing reopens, even after a postponement (`reschedule` then moves only the game). It may move **earlier** only via `correct_deadline`, with evidence. |
| **Append-only predictions** | Each submission is a new revision. The revision is numbered under a lock on that supporter and match. The time is read *after* that lock. Rows are never updated. |
| **The pick that counts** | The **highest revision submitted before the current `locks_at`**. It's derived when it's read and never stored. If the deadline is corrected to an earlier time, the later submissions stop counting, and an earlier submission that was valid counts again. |
| **Points** | Derived from the effective pick and the current verified result. A corrected result changes every score and rank deterministically. A void match gives no points to anyone. |
| **Privacy** | All data lives in the `matchtips` schema. No API role can use it, and the API doesn't expose it. Supporters reach it only through the `public.matchtips_*` functions. Others' picks are visible only **after the deadline**, only to **signed-in** supporters, and only as **effective picks**: never revisions, never disqualified submissions. Handles come out of those functions too, and profiles RLS is unchanged. |
| **Opt-in and opt-out** | Joining is explicit and stores the consent version. Leaving is confirmed and deletes the participation and **every revision of every prediction**; the general account stays. Rejoining starts fresh. Deleting an account does the same, by cascade. |

### Supporter functions (the whole API)

All of these require a signed-in supporter. `anon` can execute none of them.

| Function | Does |
|---|---|
| `matchtips_consent_version()` | The consent text version that joining requires. |
| `matchtips_join(consent_version)` / `matchtips_leave(confirmed)` / `matchtips_me()` | Opt in, opt out (returns the number of submissions removed), and current status. |
| `matchtips_submit(match, home, away)` | A new revision. There's no author, time or revision parameter. Refuses with `55000` once locked or void. |
| `matchtips_matches(season)` | The schedule, deadline, state and result, plus `deadline_corrected` with its reason and source. |
| `matchtips_my_picks(season)` | **Your own** picks: the effective pick and points, plus your latest submission and `latest_counts`. |
| `matchtips_picks(match)` | Everyone's effective picks and points, **after the deadline only** (empty before). |
| `matchtips_leaderboard(season)` | Rank (shared on ties), handle, points, matches tipped, exact scores and right outcomes. Only locked, non-void matches count. |

When `latest_counts` is false, show the supporter (and only them) something like **"Räknas inte – matchens starttid har rättats"**, with the corrected deadline and source from `matchtips_matches`. Never word it as if they knew it was late.

## Operator runbook (SQL editor)

The owner runs every operation in the Supabase **SQL editor**, through the functions in `matchtips_ops`. No API role can call them.

### What the record proves, and what it doesn't

Every operation writes a row to `matchtips.match_log` with:
- the old and new values;
- the source URL and the reason;
- the **declared** operator name;
- `db_role` and `session_role`;
- the database time.

The limits:
- Dashboard SQL runs as the privileged `postgres` role, with no JWT, so **`auth.uid()` is null**. The database can't tell which dashboard user ran a statement ([Supabase KB](https://supabase.com/kb/troubleshooting/tracking-postgres-role-activity-to-specific-dashboard-users-8d3715)). The operator name is **declared, not authenticated**.
- Triggers block direct edits, deletes and truncation of matches and the log, and they keep a locked deadline from moving later. They protect against ordinary mistakes **while active**. The owner role can disable triggers, so this is an operational change record, **not a tamper-proof ledger**.
- Don't turn on broad production query logging to claim an audit trail.

### Rules for every operation
1. **Use the functions only.**
   - Never `update`, `insert` or `delete` Matchtipset tables directly.
   - Never disable triggers.
   - Never set `matchtips.via_ops` by hand.
2. Run each one in a transaction, check, then commit:
   ```sql
   begin;
   select matchtips_ops.<operation>(…);
   select * from matchtips.match_log order by id desc limit 3;   -- check
   commit;   -- or: rollback;
   ```
3. Always give the **official source URL** you checked, a **reason** in plain Swedish, and your operator name (`'daniel'`).
4. Times are `timestamptz`. Write them with the zone, for example `'2026-11-12 19:00 Europe/Stockholm'`.

### Enter a match (only before it starts)
First check the official page (difhockey.se or shl.se) and run the [MatchCard check](#matchcard-reconciliation).
```sql
select matchtips_ops.create_match(
  '2026/27', 'Färjestad BK', 'Djurgården',            -- official home/away orientation
  '2026-11-12 19:00 Europe/Stockholm',
  'https://www.difhockey.se/game-schedule',            -- the page you verified it on
  'manual-hockey-herr-2026-11-12-farjestad',           -- MatchCard Fixture.id, or null
  'Verifierad mot difhockey.se 9 nov', 'daniel');
```
The pilot begins with the **first future, verified** eligible match after production enablement. There are no retroactive matches; the function refuses a start in the past.

### The game moves
```sql
select matchtips_ops.reschedule('<match id>', '2026-11-13 19:00 Europe/Stockholm', '<source>', 'Flyttad enligt shl.se', 'daniel');
select matchtips_ops.postpone('<match id>', '<source>', 'Uppskjuten, nytt datum ej klart', 'daniel');
```
- **Before the deadline:** the game and the deadline move together.
- **After the deadline:** the picks stay sealed and visible, and only the game moves.
- **Postponed with no date:** the deadline stays where it was. Reschedule once a date is known.
- **Never played, or no longer the same matchup:** void it.

### The deadline was wrong: correct it, or void it
Use `correct_deadline` only when **independent, reliable evidence** shows the game started **earlier** than our deadline, for example the official schedule or match report shows 18:00 and we said 19:00. Set it to the **time the evidence establishes**, usually the official scheduled time. Never invent a puck-drop minute.
```sql
select matchtips_ops.correct_deadline('<match id>', '2026-11-12 18:00 Europe/Stockholm',
  'https://www.shl.se/…/matchrapport', 'Matchen startade 18:00 enligt shl.se, inte 19:00', 'daniel');
```
If the evidence is missing, contradictory, or can't establish a fair deadline, **void** the match instead (`'Starttid kan inte verifieras'`). The app marks a corrected match **"Deadline rättad"**, with the reason and the source.

### Void
```sql
select matchtips_ops.void_match('<match id>', '<source>', 'Avbruten i andra perioden', 'daniel');
```
Void the match when it was:
- abandoned or interrupted;
- awarded or a walkover;
- never played;
- entered with the wrong home/away orientation, or entered twice.

Void is final: it gives no points to anyone and doesn't count in "matches tipped". To replace a wrongly entered match, enter it again (only possible before it starts).

### Result, and corrections
Enter the score **after 60 minutes** (the sum of periods 1–3) and how the game was decided. **Never derive it from the final score**: overtime and shootout goals are not part of it.
```sql
select matchtips_ops.record_result('<match id>', 3, 3, 'overtime',
  'https://www.shl.se/…/matchrapport', 'Matchrapport: 3–3 efter 60, 4–3 efter förlängning', 'daniel');
```
- `decided_in` is one of `regulation` (must not be a draw after 60), `overtime` or `shootout` (both must be a draw after 60).
- The function refuses a result before the start, or for a postponed or void match.
- **To correct a result,** call it again with a reason. That creates a new revision, logs the old values, and everything recalculates.
- There's no fixed correction deadline. A correction after the season looks complete is still shown as corrected (`result_revision > 1`).

### Useful read-only queries
```sql
select id, home_team, away_team, scheduled_start, locks_at, status, result_home_60, result_away_60, decided_in, result_revision, fixture_ref
from matchtips.matches order by scheduled_start desc limit 10;

select id, match_id, action, old_values, new_values, source_url, reason, operator_declared, db_role, recorded_at
from matchtips.match_log order by id desc limit 20;
```

## MatchCard reconciliation

The **Matchtipset match is authoritative for its own deadline and settlement.** The MatchCard (`/api/fixtures`: dif.se's calendar for football, the hand-kept `MANUAL_FIXTURES` in [`server/lib/fixtures.ts`](../server/lib/fixtures.ts) for hockey) stays a separate display. Nothing syncs the two, and nothing pretends they agree. The tipping UI must always show its own deadline.

**When to check:** before entering or opening a match, on **every schedule change** you learn of, and on **match day**.
1. Check the **official source** (difhockey.se or shl.se): date, time, and home and away teams.
2. Open `https://diftillidie.netlify.app/api/fixtures` and find the fixture. Hockey ids contain the date, so a rescheduled game gets a **new id**.
3. Compare the official source, the fixture, and the match's `scheduled_start` / `locks_at`. Then record the outcome:
   ```sql
   select matchtips_ops.record_reconciliation('<match id>', '<Fixture.id or null>',
     'consistent' /* or 'fixture_missing' / 'fixture_differs' */,
     '<official source>', 'Kontroll matchdag: shl.se 19:00, MatchCard 19:00', 'daniel');
   ```
4. **Mismatch, missing or stale fixture:**
   - Never resolve it silently.
   - Re-verify against the official source.
   - Fix the side that's wrong: `reschedule` / `correct_deadline` / `void` for Matchtipset; a reviewed code change to `MANUAL_FIXTURES` for the MatchCard (a deploy).
   - Record the outcome with a reason.
   - Until it's resolved, **don't enter or open the match**. If it's already open and the deadline is in doubt, prefer voiding to guessing.

A missing fixture isn't by itself an error (`loadFixtures()` drops past games, and hockey is hand-kept), but it always needs the official-source check and a recorded outcome.

## Tests

| Suite | Runs | Covers |
|---|---|---|
| `tests/matchtipset-db.test.ts` | `npm test`, locally and in CI: the real migrations in PGlite ([harness](../tests/db/supabase-harness.ts)) | **Grants and exposure:** schemas, tables and functions per role, RLS, `search_path`. **Opt-in and opt-out.** **Append-only revisions.** **Forged author, time or points.** **Locked and void matches.** **Secrecy before the deadline.** **Effective picks only.** **The corrected-deadline scenario.** **Never-later deadlines.** **Postponements.** **Results:** consistency, corrections, scoring and leaderboard ties. **The log:** content and append-only. **Account deletion.** It also runs the pgTAP file through a shim. |
| `supabase/tests/matchtipset_rls.test.sql` | `supabase test db`, in CI on a fresh local stack. Rolled back. | The same boundaries on real Supabase: 50 assertions. |
| `tests/matchtipset-stack.test.ts` | CI only (`MATCHTIPSET_STACK=local`; refuses non-local URLs) | **Real concurrency through the API:** 20 parallel submissions, a deadline correction racing submissions, leaving mid-flight. **REST/GraphQL exposure** of the schemas. **Anonymous refusal.** **Deletion via the Auth admin API.** |

CI: [`.github/workflows/database.yml`](../.github/workflows/database.yml) starts a disposable stack from [`supabase/config.toml`](../supabase/config.toml), which is local-only, and needs no secrets.

To run the stack tests locally (needs Docker):
```sh
supabase start
supabase test db
set -a; eval "$(supabase status -o env)"; set +a
MATCHTIPSET_STACK=local npx vitest run tests/matchtipset-stack.test.ts
```

**Never** run the pgTAP or stack suites against the hosted project. They create test users, matches and predictions (the pgTAP suite rolls back, but still writes while running).

## Release checklist

To be completed and reviewed **before** this migration touches the hosted project. That needs a separate, explicit authorization, and the UI is a separate PR.

1. [ ] PR reviewed. CI green: unit/PGlite, typecheck, `supabase test db`, and the stack tests.
2. [ ] Hosted Postgres major version noted. `config.toml` uses 17; if hosted differs, re-run the suites on that version.
3. [ ] **Identity check**, read-only, in the SQL editor: `select current_user, session_user, auth.uid();`. Record the result here. Expected: `postgres`, `postgres`, `null`.
4. [ ] Apply the migration by hand (SQL editor or `supabase db push` from a reviewed checkout). There's no automatic deploy.
5. [ ] Confirm the hosted API's **exposed schemas** are still only `public` and `graphql_public` (Dashboard → API settings). `matchtips` and `matchtips_ops` must **not** be added.
6. [ ] **Read-only checks** on hosted:
   ```sql
   select has_schema_privilege(r, s, 'usage') from unnest(array['anon','authenticated','service_role']) r, unnest(array['matchtips','matchtips_ops']) s;  -- all false
   select count(*) from information_schema.role_table_grants where table_schema like 'matchtips%' and grantee in ('anon','authenticated','service_role','PUBLIC');  -- 0
   select p.oid::regprocedure, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') authed
   from pg_proc p where p.proname like 'matchtips\_%' or p.pronamespace = 'matchtips_ops'::regnamespace;  -- anon all false; authed only the nine public ones
   select relname, relrowsecurity from pg_class where relnamespace = 'matchtips'::regnamespace and relkind = 'r';  -- all true
   select (select count(*) from matchtips.matches) + (select count(*) from matchtips.participants);  -- 0: no test data
   ```
7. [ ] **No fake data in production.**
   - No test users, matches or predictions.
   - The first real match is entered only when the pilot opens.
   - Manual verification uses the existing real account.
8. [ ] PR 2 (minimal UI) gets its own review: it shows the consent text (`matchtips_consent_version()`), the deadline, "Tippa resultatet efter 60 minuter. Förlängning och straffar räknas inte.", the home/away orientation, "Deadline rättad", the late-pick explanation, and the leave confirmation. Never fetch the leaderboard or picks into publicly cached SSR.

## Known limits (deliberate for the pilot)

- **Operator attribution is declared, and the audit record isn't tamper-proof** (see above).
- **Commit time vs submission time:** the submission time is read after the serialization lock, a moment before the insert commits. A submission that starts a few microseconds before the deadline can commit just after it. The revision is the definitive order. Timestamps are only used for the deadline comparison and aren't promised to be unique.
- **A race with a correction:** a submission accepted while an earlier deadline was being committed is judged on read against the corrected deadline, so it doesn't count.
- **Account deletion and leaving shift ranks.** No rows are kept for ranking continuity.
- **Up to 50 revisions** per supporter per match.
- **Not in the pilot:** football, SDHL, playoffs, cups, automatic import (see #7), an admin UI, a verifier role, moving picks between duplicate matches, reopening, guest/public visibility, averages, monthly or per-round tables, tiebreakers and notifications.
