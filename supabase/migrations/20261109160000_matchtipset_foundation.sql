-- Matchtipset: the database foundation (Issue #11; design and decisions in #6).
--
-- Supporters tip the 60-minute home:away score of DIF men's SHL
-- regular-season games: 3 points for the exact score, 1 for the right
-- regulation outcome (home win / draw / away win), 0 otherwise. No betting,
-- no prizes.
--
-- What makes it fair, and where each rule lives:
--
--  - Durable identity. A match is a uuid of its own, never the date-derived
--    Fixture.id shown by the MatchCard. Teams, season and competition never
--    change; a match entered wrong is voided and entered again.
--
--  - The deadline is `locks_at`, the verified scheduled puck drop, checked
--    with the database clock. Before it passes it may move either way (a
--    rescheduled game). After it passes it never moves later, so nothing
--    reopens, even when the game is postponed; it may only move EARLIER, by a
--    deadline correction backed by a source (the game really started before
--    the time we published). Without such evidence the operator voids.
--
--  - Predictions are append-only. Every submission is a new revision,
--    numbered under a per-supporter-per-match lock; nothing is ever updated.
--    The pick that counts (the "effective pick") is derived when it's read:
--    the highest revision submitted before the CURRENT deadline. So a
--    deadline corrected after the fact disqualifies only the submissions
--    made after the corrected time; an earlier one that was valid all along
--    counts again. Validity and points are never stored.
--
--  - Privacy. All Matchtipset data lives in the `matchtips` schema, which
--    the API doesn't expose and no API role may use. Supporters reach it only
--    through the public matchtips_* functions below, which decide what each
--    caller may see: their own submissions; others' effective picks only once
--    a match has locked, and only to signed-in supporters. Handles come out
--    of those functions too; profiles RLS is untouched. Taking part is an
--    explicit opt-in, and leaving deletes the participation and every
--    revision of every prediction (as account deletion does, by cascade).
--
--  - Owner operations (create, reschedule, postpone, correct the deadline,
--    void, record a result, record a reconciliation check) are functions in
--    the `matchtips_ops` schema, which only the owner (the SQL editor's
--    `postgres` role) can execute. Each requires a source URL, a reason and
--    a DECLARED operator name, and writes an append-only log row with the old
--    and new values, the database role and the database time. Triggers keep
--    direct edits out of `matches` and the log while they're active; the
--    owner role can disable triggers, so this is an operational change
--    record against mistakes, not a tamper-proof ledger, and the operator
--    name is declared, not authenticated. See docs/matchtipset.md.
--
-- Not applied to the hosted project by this PR: it's deployed deliberately,
-- after review (docs/matchtipset.md, "Release checklist").

create extension if not exists pgcrypto with schema extensions;

create schema matchtips;
create schema matchtips_ops;

comment on schema matchtips is 'Matchtipset data. Never exposed through the API; reached only via the public.matchtips_* functions.';
comment on schema matchtips_ops is 'Owner-only Matchtipset operations, run from the SQL editor. Never exposed through the API.';

revoke all on schema matchtips, matchtips_ops from public, anon, authenticated, service_role;

-- ── Matches ──────────────────────────────────────────────────────────────
create table matchtips.matches (
  id               uuid primary key default gen_random_uuid(),
  season           text not null,
  competition      text not null default 'SHL',
  stage            text not null default 'regular',
  -- Official orientation: home first. Never changes once entered.
  home_team        text not null,
  away_team        text not null,
  -- When the game is, as verified (display and settlement). A postponement moves it.
  scheduled_start  timestamptz not null,
  -- The prediction deadline (see the header): never later than scheduled_start.
  locks_at         timestamptz not null,
  status           text not null default 'scheduled',
  void_reason      text,
  -- The verified 60-minute score and how the game was decided; null until verified.
  result_home_60   smallint,
  result_away_60   smallint,
  decided_in       text,
  result_revision  int not null default 0,
  -- The official page the match was verified against.
  official_url     text not null,
  -- The MatchCard fixture (Fixture.id) it was last reconciled against, if any.
  fixture_ref      text,
  created_at       timestamptz not null default now(),

  constraint matches_season check (season ~ '^[0-9]{4}/[0-9]{2}$'),
  constraint matches_pilot_scope check (competition = 'SHL' and stage = 'regular'),
  constraint matches_teams check (
    home_team <> away_team
    and 'Djurgården' in (home_team, away_team)
    and char_length(home_team) between 2 and 60 and home_team = btrim(home_team)
    and char_length(away_team) between 2 and 60 and away_team = btrim(away_team)
  ),
  constraint matches_lock_not_after_start check (locks_at <= scheduled_start),
  constraint matches_status check (status in ('scheduled', 'postponed', 'void')),
  constraint matches_void_reason check ((status = 'void') = (void_reason is not null)),
  constraint matches_result_complete check (
    (result_home_60 is null) = (result_away_60 is null)
    and (result_home_60 is null) = (decided_in is null)
    and (result_home_60 is null) = (result_revision = 0)
  ),
  constraint matches_result_goals check (result_home_60 between 0 and 30 and result_away_60 between 0 and 30),
  -- After 60 minutes: a regulation win isn't a draw, and overtime or a shootout only follows a draw.
  constraint matches_result_consistent check (
    decided_in is null
    or (decided_in = 'regulation' and result_home_60 <> result_away_60)
    or (decided_in in ('overtime', 'shootout') and result_home_60 = result_away_60)
  ),
  constraint matches_result_not_postponed check (status <> 'postponed' or result_home_60 is null),
  constraint matches_official_url check (official_url ~ '^https://[^[:space:]]{3,}$' and char_length(official_url) <= 500),
  constraint matches_fixture_ref check (fixture_ref ~ '^[A-Za-z0-9_.:@-]{1,200}$')
);

comment on table matchtips.matches is 'Matchtipset matches: durable identity, verified schedule, the prediction deadline (locks_at) and the verified 60-minute result. Changed only through matchtips_ops.';

-- ── Operations log (append-only) ─────────────────────────────────────────
create table matchtips.match_log (
  id                bigint generated always as identity primary key,
  match_id          uuid not null references matchtips.matches (id) on delete restrict,
  action            text not null,
  old_values        jsonb,
  new_values        jsonb not null,
  source_url        text not null,
  reason            text not null,
  -- Typed by whoever ran the operation. NOT an authenticated identity.
  operator_declared text not null,
  db_role           text not null default current_user,
  session_role      text not null default session_user,
  recorded_at       timestamptz not null default now(),

  constraint match_log_action check (action in ('created', 'rescheduled', 'postponed', 'deadline_corrected', 'voided', 'result', 'reconciled')),
  constraint match_log_source_url check (source_url ~ '^https://[^[:space:]]{3,}$' and char_length(source_url) <= 500),
  constraint match_log_reason check (char_length(reason) between 3 and 1000 and reason = btrim(reason)),
  constraint match_log_operator check (operator_declared ~ '^[a-z0-9_.-]{2,40}$')
);

create index match_log_match on matchtips.match_log (match_id, id);

comment on table matchtips.match_log is 'Every Matchtipset owner operation, append-only: old/new values, source, reason, declared operator, database role and time. An operational change record, not a tamper-proof ledger.';

-- ── Participants (explicit opt-in) ───────────────────────────────────────
create table matchtips.participants (
  profile_id      uuid primary key references public.profiles (id) on delete cascade,
  consent_version text not null,
  opted_in_at     timestamptz not null default now()
);

comment on table matchtips.participants is 'Supporters who opted in to Matchtipset (their handle appears on the leaderboard to signed-in supporters). Leaving deletes the row and, by cascade, every prediction submission.';

-- ── Prediction submissions (append-only) ─────────────────────────────────
create table matchtips.prediction_submissions (
  id           bigint generated always as identity primary key,
  match_id     uuid not null references matchtips.matches (id) on delete restrict,
  profile_id   uuid not null references matchtips.participants (profile_id) on delete cascade,
  -- The definitive order of a supporter's submissions for a match.
  revision     int not null,
  home_goals   smallint not null,
  away_goals   smallint not null,
  -- Database time, taken after the submission's serialization lock.
  submitted_at timestamptz not null,

  constraint prediction_submissions_revision_unique unique (match_id, profile_id, revision),
  constraint prediction_submissions_revision check (revision >= 1),
  constraint prediction_submissions_goals check (home_goals between 0 and 30 and away_goals between 0 and 30)
);

create index prediction_submissions_profile on matchtips.prediction_submissions (profile_id);

comment on table matchtips.prediction_submissions is 'Every prediction a participant submitted, append-only. Which one counts is derived (matchtips.effective_picks), never stored.';

-- No API role may touch the tables at all; RLS on, with no policies, as a second line.
revoke all on all tables in schema matchtips from public, anon, authenticated, service_role;
alter table matchtips.matches enable row level security;
alter table matchtips.match_log enable row level security;
alter table matchtips.participants enable row level security;
alter table matchtips.prediction_submissions enable row level security;

-- ── Guards against direct edits (active triggers; the owner can disable them) ──
-- matchtips_ops functions set matchtips.via_ops for the duration of the call.
create function matchtips.guard_matches()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'matches are never deleted: void them (matchtips_ops.void_match)' using errcode = '42501';
  end if;
  if coalesce(current_setting('matchtips.via_ops', true), '') <> 'on' then
    raise exception 'matches change only through matchtips_ops functions' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.season <> old.season or new.competition <> old.competition or new.stage <> old.stage
      or new.home_team <> old.home_team or new.away_team <> old.away_team or new.created_at <> old.created_at then
      raise exception 'a match''s identity and teams never change: void it and enter it again' using errcode = '42501';
    end if;
    if old.status = 'void' then
      raise exception 'a void match is final' using errcode = '42501';
    end if;
    -- Never reopen: once the deadline has passed it may only move earlier.
    if old.locks_at <= clock_timestamp() and new.locks_at > old.locks_at then
      raise exception 'the deadline has passed and cannot move later' using errcode = '42501';
    end if;
    if (new.result_home_60, new.result_away_60, new.decided_in) is distinct from (old.result_home_60, old.result_away_60, old.decided_in)
      or new.result_revision <> old.result_revision then
      if new.result_revision <> old.result_revision + 1 or new.result_home_60 is null then
        raise exception 'a result changes only by a new revision' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end
$$;

create trigger guard_matches
  before insert or update or delete on matchtips.matches
  for each row execute function matchtips.guard_matches();

create function matchtips.guard_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and tg_table_name = 'match_log' and coalesce(current_setting('matchtips.via_ops', true), '') = 'on' then
    return new;
  end if;
  raise exception '% is append-only (% refused)', tg_table_name, tg_op using errcode = '42501';
end
$$;

create function matchtips.guard_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is never truncated', tg_table_name using errcode = '42501';
end
$$;

create trigger guard_match_log
  before insert or update or delete on matchtips.match_log
  for each row execute function matchtips.guard_append_only();

-- Submissions: never updated. Deleting is how leaving and account deletion work (cascade).
create trigger guard_prediction_submissions
  before update on matchtips.prediction_submissions
  for each row execute function matchtips.guard_append_only();

-- Even an insert that bypasses matchtips_submit can't be dated ahead of the
-- database clock, or at/after the deadline as it stands, or for a void match.
create function matchtips.guard_submission_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  m matchtips.matches;
begin
  select * into m from matchtips.matches x where x.id = new.match_id;
  if new.submitted_at > clock_timestamp() or m.status = 'void' or new.submitted_at >= m.locks_at then
    raise exception 'a prediction must be submitted before the deadline' using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger guard_submission_insert
  before insert on matchtips.prediction_submissions
  for each row execute function matchtips.guard_submission_insert();

create trigger guard_truncate_matches before truncate on matchtips.matches
  for each statement execute function matchtips.guard_truncate();
create trigger guard_truncate_match_log before truncate on matchtips.match_log
  for each statement execute function matchtips.guard_truncate();

-- ── Derived: effective picks and points ──────────────────────────────────
create function matchtips.points(pick_home int, pick_away int, result_home int, result_away int)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when result_home is null or result_away is null then null
    when pick_home = result_home and pick_away = result_away then 3
    when sign(pick_home - pick_away) = sign(result_home - result_away) then 1
    else 0
  end
$$;

comment on function matchtips.points(int, int, int, int) is '3 for the exact 60-minute score, otherwise 1 for the right outcome (home win, draw, away win), otherwise 0. Null until there is a result.';

-- The pick that counts: the highest revision submitted before the CURRENT deadline.
create view matchtips.effective_picks with (security_invoker = true) as
select distinct on (s.match_id, s.profile_id)
  s.match_id, s.profile_id, s.revision, s.home_goals, s.away_goals, s.submitted_at
from matchtips.prediction_submissions s
join matchtips.matches m on m.id = s.match_id
where s.submitted_at < m.locks_at
order by s.match_id, s.profile_id, s.revision desc;

-- Points only for a played (not void, not postponed) match with a verified result.
create view matchtips.scored_picks with (security_invoker = true) as
select e.match_id, e.profile_id, e.revision, e.home_goals, e.away_goals,
  case when m.status = 'scheduled' then matchtips.points(e.home_goals, e.away_goals, m.result_home_60, m.result_away_60) end as points
from matchtips.effective_picks e
join matchtips.matches m on m.id = e.match_id;

revoke all on all tables in schema matchtips from public, anon, authenticated, service_role;
revoke all on all functions in schema matchtips from public, anon, authenticated, service_role;

-- ── Supporter functions (the only way in) ────────────────────────────────
-- The consent text the app shows before joining; bump it when that text changes.
create function public.matchtips_consent_version()
returns text
language sql
immutable
set search_path = ''
as $$ select 'matchtipset-2026-11-09' $$;

comment on function public.matchtips_consent_version() is 'The current Matchtipset consent text version. Joining requires this exact value.';

create function public.matchtips_join(p_consent_version text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  joined timestamptz;
begin
  if uid is null or not exists (select 1 from public.profiles p where p.id = uid) then
    raise exception 'only a signed-in supporter with a profile can join Matchtipset' using errcode = '42501';
  end if;
  if p_consent_version is distinct from public.matchtips_consent_version() then
    raise exception 'consent to the current Matchtipset terms is required' using errcode = '22023';
  end if;
  insert into matchtips.participants (profile_id, consent_version)
  values (uid, p_consent_version)
  on conflict (profile_id) do nothing;
  select p.opted_in_at into joined from matchtips.participants p where p.profile_id = uid;
  return joined;
end
$$;

comment on function public.matchtips_join(text) is 'Opt in to Matchtipset as the signed-in supporter (their handle then appears on the leaderboard to signed-in supporters). Joining again after leaving starts fresh.';

create function public.matchtips_leave(p_confirmed boolean)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  removed int;
begin
  if uid is null then
    raise exception 'sign in to leave Matchtipset' using errcode = '42501';
  end if;
  if p_confirmed is not true then
    raise exception 'leaving Matchtipset must be confirmed' using errcode = '22023';
  end if;
  select count(*) into removed from matchtips.prediction_submissions s where s.profile_id = uid;
  -- Cascades to every revision of every prediction. The general account stays.
  delete from matchtips.participants p where p.profile_id = uid;
  return removed;
end
$$;

comment on function public.matchtips_leave(boolean) is 'Leave Matchtipset (confirmed): deletes the participation and every prediction submission, all revisions. Returns how many submissions were removed. The account itself stays.';

create function public.matchtips_me()
returns table (participating boolean, opted_in_at timestamptz, consent_version text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'sign in to use Matchtipset' using errcode = '42501';
  end if;
  return query
  select p.profile_id is not null, p.opted_in_at, p.consent_version
  from (select 1) one
  left join matchtips.participants p on p.profile_id = uid;
end
$$;

create function public.matchtips_submit(p_match uuid, p_home int, p_away int)
returns table (revision int, submitted_at timestamptz, locks_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  m matchtips.matches;
  t timestamptz;
  rev int;
begin
  if uid is null or not exists (select 1 from matchtips.participants p where p.profile_id = uid) then
    raise exception 'join Matchtipset before predicting' using errcode = '42501';
  end if;
  if p_home is null or p_away is null or p_home not between 0 and 30 or p_away not between 0 and 30 then
    raise exception 'goals must be whole numbers from 0 to 30' using errcode = '22023';
  end if;

  -- Serialize this supporter's submissions for this match, and wait for any
  -- deadline change in flight: the check below sees the committed deadline.
  perform pg_advisory_xact_lock(hashtextextended('matchtips:' || p_match::text || ':' || uid::text, 0));
  select * into m from matchtips.matches x where x.id = p_match for share;
  if not found then
    raise exception 'no such match' using errcode = 'P0002';
  end if;

  -- Database time, read after the locks.
  t := clock_timestamp();
  if m.status = 'void' or t >= m.locks_at then
    raise exception 'predictions for this match are locked' using errcode = '55000';
  end if;

  select coalesce(max(s.revision), 0) + 1 into rev
  from matchtips.prediction_submissions s
  where s.match_id = p_match and s.profile_id = uid;
  if rev > 50 then
    raise exception 'too many changes to this prediction' using errcode = '54000';
  end if;

  insert into matchtips.prediction_submissions (match_id, profile_id, revision, home_goals, away_goals, submitted_at)
  values (p_match, uid, rev, p_home, p_away, t);
  return query select rev, t, m.locks_at;
end
$$;

comment on function public.matchtips_submit(uuid, int, int) is 'Submit (or change) the signed-in participant''s 60-minute prediction before the deadline. Appends a revision; author, time and revision come from the database.';

create function public.matchtips_matches(p_season text)
returns table (
  id uuid, season text, home_team text, away_team text,
  scheduled_start timestamptz, locks_at timestamptz, locked boolean,
  status text, void_reason text,
  result_home_60 smallint, result_away_60 smallint, decided_in text, result_revision int,
  result_source_url text, result_note text,
  deadline_corrected boolean, deadline_correction_reason text, deadline_correction_source_url text,
  official_url text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'sign in to use Matchtipset' using errcode = '42501';
  end if;
  return query
  select m.id, m.season, m.home_team, m.away_team,
    m.scheduled_start, m.locks_at, now() >= m.locks_at,
    m.status, m.void_reason,
    m.result_home_60, m.result_away_60, m.decided_in, m.result_revision,
    r.source_url, r.reason,
    d.id is not null, d.reason, d.source_url,
    m.official_url
  from matchtips.matches m
  left join lateral (
    select l.source_url, l.reason from matchtips.match_log l
    where l.match_id = m.id and l.action = 'result' order by l.id desc limit 1
  ) r on m.result_revision > 0
  left join lateral (
    select l.id, l.source_url, l.reason from matchtips.match_log l
    where l.match_id = m.id and l.action = 'deadline_corrected' order by l.id desc limit 1
  ) d on true
  where m.season = p_season
  order by m.scheduled_start, m.id;
end
$$;

comment on function public.matchtips_matches(text) is 'A season''s Matchtipset matches for signed-in supporters: schedule, deadline, state, verified result and any deadline correction with its reason and source.';

create function public.matchtips_my_picks(p_season text)
returns table (
  match_id uuid,
  pick_home smallint, pick_away smallint, points int,
  latest_home smallint, latest_away smallint, latest_submitted_at timestamptz, latest_counts boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'sign in to use Matchtipset' using errcode = '42501';
  end if;
  -- The caller's own: the pick that counts, and (only to them) their latest
  -- submission when a corrected deadline means it doesn't count.
  return query
  select l.match_id, sp.home_goals, sp.away_goals, sp.points,
    l.home_goals, l.away_goals, l.submitted_at, l.submitted_at < m.locks_at
  from (
    select distinct on (s.match_id) s.match_id, s.home_goals, s.away_goals, s.submitted_at
    from matchtips.prediction_submissions s
    where s.profile_id = uid
    order by s.match_id, s.revision desc
  ) l
  join matchtips.matches m on m.id = l.match_id
  left join matchtips.scored_picks sp on sp.match_id = l.match_id and sp.profile_id = uid
  where m.season = p_season
  order by m.scheduled_start, m.id;
end
$$;

comment on function public.matchtips_my_picks(text) is 'The signed-in supporter''s own picks for a season: the effective pick and points, plus their latest submission and whether it counts (it doesn''t when the deadline was corrected to before it).';

create function public.matchtips_picks(p_match uuid)
returns table (handle text, pick_home smallint, pick_away smallint, points int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'sign in to use Matchtipset' using errcode = '42501';
  end if;
  -- Nothing at all before the deadline: no picks, no count.
  return query
  select pr.handle, sp.home_goals, sp.away_goals, sp.points
  from matchtips.scored_picks sp
  join matchtips.matches m on m.id = sp.match_id
  join public.profiles pr on pr.id = sp.profile_id
  where sp.match_id = p_match and now() >= m.locks_at
  order by pr.handle;
end
$$;

comment on function public.matchtips_picks(uuid) is 'Everyone''s effective picks for a match, to signed-in supporters, once it has locked; nothing before. Never revisions or disqualified submissions.';

create function public.matchtips_leaderboard(p_season text)
returns table (rank bigint, handle text, points bigint, matches_tipped bigint, exact_scores bigint, correct_outcomes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'sign in to use Matchtipset' using errcode = '42501';
  end if;
  return query
  with counted as (
    -- Locked, non-void matches of the season only: nothing about open matches leaks.
    select sp.profile_id, sp.points
    from matchtips.scored_picks sp
    join matchtips.matches m on m.id = sp.match_id
    where m.season = p_season and m.status <> 'void' and now() >= m.locks_at
  ),
  tally as (
    select p.profile_id,
      coalesce(sum(c.points), 0)::bigint as points,
      count(c.profile_id) as tipped,
      count(*) filter (where c.points = 3) as exact,
      count(*) filter (where c.points = 1) as outcomes
    from matchtips.participants p
    left join counted c on c.profile_id = p.profile_id
    group by p.profile_id
  )
  select rank() over (order by t.points desc), pr.handle, t.points, t.tipped, t.exact, t.outcomes
  from tally t
  join public.profiles pr on pr.id = t.profile_id
  order by 1, pr.handle;
end
$$;

comment on function public.matchtips_leaderboard(text) is 'The season leaderboard for signed-in supporters: participants'' handles, points, matches tipped (locked, non-void), exact scores and right outcomes; tied points share a rank. Derived on every read.';

revoke all on function public.matchtips_consent_version() from public, anon, authenticated;
revoke all on function public.matchtips_join(text) from public, anon, authenticated;
revoke all on function public.matchtips_leave(boolean) from public, anon, authenticated;
revoke all on function public.matchtips_me() from public, anon, authenticated;
revoke all on function public.matchtips_submit(uuid, int, int) from public, anon, authenticated;
revoke all on function public.matchtips_matches(text) from public, anon, authenticated;
revoke all on function public.matchtips_my_picks(text) from public, anon, authenticated;
revoke all on function public.matchtips_picks(uuid) from public, anon, authenticated;
revoke all on function public.matchtips_leaderboard(text) from public, anon, authenticated;
grant execute on function public.matchtips_consent_version() to authenticated;
grant execute on function public.matchtips_join(text) to authenticated;
grant execute on function public.matchtips_leave(boolean) to authenticated;
grant execute on function public.matchtips_me() to authenticated;
grant execute on function public.matchtips_submit(uuid, int, int) to authenticated;
grant execute on function public.matchtips_matches(text) to authenticated;
grant execute on function public.matchtips_my_picks(text) to authenticated;
grant execute on function public.matchtips_picks(uuid) to authenticated;
grant execute on function public.matchtips_leaderboard(text) to authenticated;

-- ── Owner operations (SQL editor only) ───────────────────────────────────
create function matchtips_ops.begin_op(p_source_url text, p_reason text, p_operator text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_source_url is null or p_source_url !~ '^https://[^[:space:]]{3,}$' or char_length(p_source_url) > 500 then
    raise exception 'a source URL (https://…) is required' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if p_operator is null or p_operator !~ '^[a-z0-9_.-]{2,40}$' then
    raise exception 'a declared operator name (a-z, 0-9, _ . -) is required' using errcode = '22023';
  end if;
  perform set_config('matchtips.via_ops', 'on', true);
end
$$;

create function matchtips_ops.end_op(p_match uuid, p_action text, p_old jsonb, p_new jsonb, p_source_url text, p_reason text, p_operator text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into matchtips.match_log (match_id, action, old_values, new_values, source_url, reason, operator_declared)
  values (p_match, p_action, p_old, p_new, p_source_url, btrim(p_reason), p_operator);
  perform set_config('matchtips.via_ops', 'off', true);
end
$$;

create function matchtips_ops.create_match(
  p_season text, p_home_team text, p_away_team text, p_scheduled_start timestamptz,
  p_official_url text, p_fixture_ref text, p_reason text, p_operator text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  m matchtips.matches;
begin
  perform matchtips_ops.begin_op(p_official_url, p_reason, p_operator);
  -- No retroactive matches: predictions open only for games still ahead.
  if p_scheduled_start is null or p_scheduled_start <= clock_timestamp() then
    raise exception 'a match can only be entered before it starts' using errcode = '22023';
  end if;
  insert into matchtips.matches (season, home_team, away_team, scheduled_start, locks_at, official_url, fixture_ref)
  values (p_season, p_home_team, p_away_team, p_scheduled_start, p_scheduled_start, p_official_url, p_fixture_ref)
  returning * into m;
  perform matchtips_ops.end_op(m.id, 'created', null, to_jsonb(m), p_official_url, p_reason, p_operator);
  return m.id;
end
$$;

-- Before the deadline: the game moves, and the deadline with it.
-- After it: a postponement; the game moves, the deadline never does.
create function matchtips_ops.reschedule(p_match uuid, p_new_start timestamptz, p_source_url text, p_reason text, p_operator text)
returns matchtips.matches
language plpgsql
set search_path = ''
as $$
declare
  old_m matchtips.matches;
  m matchtips.matches;
begin
  perform matchtips_ops.begin_op(p_source_url, p_reason, p_operator);
  select * into old_m from matchtips.matches x where x.id = p_match for update;
  if not found then raise exception 'no such match' using errcode = 'P0002'; end if;
  if old_m.status = 'void' then raise exception 'a void match is final' using errcode = '55000'; end if;
  if old_m.result_revision > 0 then raise exception 'the match has a result: correct the result instead' using errcode = '55000'; end if;
  if p_new_start is null then raise exception 'a new start time is required' using errcode = '22023'; end if;

  if clock_timestamp() < old_m.locks_at then
    if p_new_start <= clock_timestamp() then
      raise exception 'the new start has passed: if the game really started earlier, use correct_deadline' using errcode = '22023';
    end if;
    update matchtips.matches x set scheduled_start = p_new_start, locks_at = p_new_start, status = 'scheduled'
    where x.id = p_match returning * into m;
  else
    if p_new_start < old_m.locks_at then
      raise exception 'after the deadline a game can only move later (use correct_deadline for an earlier deadline)' using errcode = '22023';
    end if;
    update matchtips.matches x set scheduled_start = p_new_start, status = 'scheduled'
    where x.id = p_match returning * into m;
  end if;
  perform matchtips_ops.end_op(p_match, 'rescheduled',
    jsonb_build_object('scheduled_start', old_m.scheduled_start, 'locks_at', old_m.locks_at, 'status', old_m.status),
    jsonb_build_object('scheduled_start', m.scheduled_start, 'locks_at', m.locks_at, 'status', m.status),
    p_source_url, p_reason, p_operator);
  return m;
end
$$;

-- Postponed with no new date yet. The deadline stays as it is.
create function matchtips_ops.postpone(p_match uuid, p_source_url text, p_reason text, p_operator text)
returns matchtips.matches
language plpgsql
set search_path = ''
as $$
declare
  old_m matchtips.matches;
  m matchtips.matches;
begin
  perform matchtips_ops.begin_op(p_source_url, p_reason, p_operator);
  select * into old_m from matchtips.matches x where x.id = p_match for update;
  if not found then raise exception 'no such match' using errcode = 'P0002'; end if;
  if old_m.status = 'void' then raise exception 'a void match is final' using errcode = '55000'; end if;
  if old_m.result_revision > 0 then raise exception 'the match has a result' using errcode = '55000'; end if;
  update matchtips.matches x set status = 'postponed' where x.id = p_match returning * into m;
  perform matchtips_ops.end_op(p_match, 'postponed',
    jsonb_build_object('status', old_m.status), jsonb_build_object('status', m.status),
    p_source_url, p_reason, p_operator);
  return m;
end
$$;

-- The deadline was wrong: reliable evidence shows the game started earlier.
-- Moves the deadline (and a start that was the same wrong time) earlier,
-- even after the fact; submissions from then on stop counting. Only ever
-- earlier, and only to a time the evidence establishes; otherwise void.
create function matchtips_ops.correct_deadline(p_match uuid, p_evidenced_start timestamptz, p_source_url text, p_reason text, p_operator text)
returns matchtips.matches
language plpgsql
set search_path = ''
as $$
declare
  old_m matchtips.matches;
  m matchtips.matches;
begin
  perform matchtips_ops.begin_op(p_source_url, p_reason, p_operator);
  select * into old_m from matchtips.matches x where x.id = p_match for update;
  if not found then raise exception 'no such match' using errcode = 'P0002'; end if;
  if old_m.status = 'void' then raise exception 'a void match is final' using errcode = '55000'; end if;
  if p_evidenced_start is null or p_evidenced_start >= old_m.locks_at then
    raise exception 'a correction only moves the deadline earlier' using errcode = '22023';
  end if;
  update matchtips.matches x
  set locks_at = p_evidenced_start,
      scheduled_start = case when x.scheduled_start = old_m.locks_at then p_evidenced_start else x.scheduled_start end
  where x.id = p_match returning * into m;
  perform matchtips_ops.end_op(p_match, 'deadline_corrected',
    jsonb_build_object('scheduled_start', old_m.scheduled_start, 'locks_at', old_m.locks_at),
    jsonb_build_object('scheduled_start', m.scheduled_start, 'locks_at', m.locks_at),
    p_source_url, p_reason, p_operator);
  return m;
end
$$;

create function matchtips_ops.void_match(p_match uuid, p_source_url text, p_reason text, p_operator text)
returns matchtips.matches
language plpgsql
set search_path = ''
as $$
declare
  old_m matchtips.matches;
  m matchtips.matches;
begin
  perform matchtips_ops.begin_op(p_source_url, p_reason, p_operator);
  select * into old_m from matchtips.matches x where x.id = p_match for update;
  if not found then raise exception 'no such match' using errcode = 'P0002'; end if;
  if old_m.status = 'void' then raise exception 'the match is already void' using errcode = '55000'; end if;
  update matchtips.matches x set status = 'void', void_reason = btrim(p_reason) where x.id = p_match returning * into m;
  perform matchtips_ops.end_op(p_match, 'voided',
    jsonb_build_object('status', old_m.status), jsonb_build_object('status', m.status, 'void_reason', m.void_reason),
    p_source_url, p_reason, p_operator);
  return m;
end
$$;

-- The verified 60-minute score; calling it again is a correction (a new revision).
create function matchtips_ops.record_result(
  p_match uuid, p_home_60 int, p_away_60 int, p_decided_in text,
  p_source_url text, p_reason text, p_operator text
)
returns matchtips.matches
language plpgsql
set search_path = ''
as $$
declare
  old_m matchtips.matches;
  m matchtips.matches;
begin
  perform matchtips_ops.begin_op(p_source_url, p_reason, p_operator);
  select * into old_m from matchtips.matches x where x.id = p_match for update;
  if not found then raise exception 'no such match' using errcode = 'P0002'; end if;
  if old_m.status <> 'scheduled' then raise exception 'only a played (scheduled, not void or postponed) match gets a result' using errcode = '55000'; end if;
  if clock_timestamp() < old_m.scheduled_start then raise exception 'the match has not started' using errcode = '55000'; end if;
  update matchtips.matches x
  set result_home_60 = p_home_60, result_away_60 = p_away_60, decided_in = p_decided_in,
      result_revision = x.result_revision + 1
  where x.id = p_match returning * into m;
  perform matchtips_ops.end_op(p_match, 'result',
    case when old_m.result_revision > 0 then jsonb_build_object('home_60', old_m.result_home_60, 'away_60', old_m.result_away_60, 'decided_in', old_m.decided_in, 'revision', old_m.result_revision) end,
    jsonb_build_object('home_60', m.result_home_60, 'away_60', m.result_away_60, 'decided_in', m.decided_in, 'revision', m.result_revision),
    p_source_url, p_reason, p_operator);
  return m;
end
$$;

-- The MatchCard check (docs/matchtipset.md): what was compared and the outcome.
create function matchtips_ops.record_reconciliation(
  p_match uuid, p_fixture_ref text, p_outcome text,
  p_source_url text, p_reason text, p_operator text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  old_m matchtips.matches;
begin
  perform matchtips_ops.begin_op(p_source_url, p_reason, p_operator);
  if p_outcome is null or p_outcome not in ('consistent', 'fixture_missing', 'fixture_differs') then
    raise exception 'outcome must be consistent, fixture_missing or fixture_differs' using errcode = '22023';
  end if;
  select * into old_m from matchtips.matches x where x.id = p_match for update;
  if not found then raise exception 'no such match' using errcode = 'P0002'; end if;
  if p_fixture_ref is distinct from old_m.fixture_ref and old_m.status <> 'void' then
    update matchtips.matches x set fixture_ref = p_fixture_ref where x.id = p_match;
  end if;
  perform matchtips_ops.end_op(p_match, 'reconciled',
    jsonb_build_object('fixture_ref', old_m.fixture_ref),
    jsonb_build_object('fixture_ref', p_fixture_ref, 'outcome', p_outcome, 'scheduled_start', old_m.scheduled_start, 'locks_at', old_m.locks_at),
    p_source_url, p_reason, p_operator);
end
$$;

revoke all on all functions in schema matchtips_ops from public, anon, authenticated, service_role;
