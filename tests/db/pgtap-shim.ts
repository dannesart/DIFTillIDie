/*
 * Just enough of pgTAP to execute supabase/tests/*.test.sql in the local
 * PGlite harness (real Supabase has the pgtap extension). Each assertion
 * returns 'ok - …' or 'not ok - …' like pgTAP; the runner collects them.
 */
export const PGTAP_SHIM = `
create function public.plan(n int) returns text language sql as $$ select '1..' || n $$;
create function public.finish() returns setof text language sql as $$ select 'finished'::text $$;

create function public.ok(cond boolean, descr text) returns text language sql as $$
  select case when cond then 'ok - ' else 'not ok - ' end || descr $$;

create function public.is(have anyelement, want anyelement, descr text) returns text language sql as $$
  select case when have is not distinct from want then 'ok - ' || descr
              else 'not ok - ' || descr || ' (have ' || coalesce(have::text, 'NULL') || ', want ' || coalesce(want::text, 'NULL') || ')' end $$;

create function public.throws_ok(q text, code text, msg text, descr text) returns text language plpgsql as $$
begin
  execute q;
  return 'not ok - ' || descr || ' (no error)';
exception when others then
  return case when sqlstate = code then 'ok - ' || descr else 'not ok - ' || descr || ' (got ' || sqlstate || ': ' || sqlerrm || ')' end;
end $$;

create function public.lives_ok(q text, descr text) returns text language plpgsql as $$
begin
  execute q;
  return 'ok - ' || descr;
exception when others then
  return 'not ok - ' || descr || ' (' || sqlstate || ': ' || sqlerrm || ')';
end $$;

create function public.results_eq(q text, want text[], descr text) returns text language plpgsql as $$
declare have text[];
begin
  execute format('with t(x) as (%s) select array_agg(x::text) from t', q) into have;
  return case when coalesce(have, '{}') = want then 'ok - ' || descr
              else 'not ok - ' || descr || ' (have ' || coalesce(have::text, '{}') || ')' end;
end $$;

create function public.is_empty(q text, descr text) returns text language plpgsql as $$
declare n int;
begin
  execute format('with t as (%s) select count(*) from t', q) into n;
  return case when n = 0 then 'ok - ' || descr else 'not ok - ' || descr || ' (' || n || ' rows)' end;
end $$;
`

/** Run one supabase/tests/*.test.sql file through the shim; returns its 'ok'/'not ok' lines and its plan. */
export async function runPgTapFile(db: { exec: (sql: string) => Promise<{ rows: Record<string, unknown>[] }[]> }, file: string) {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  await db.exec(PGTAP_SHIM)
  const sql = readFileSync(fileURLToPath(new URL(`../../supabase/tests/${file}`, import.meta.url)), 'utf8')
    .replace(/create extension if not exists pgtap[^;]*;/, '')
  const results = await db.exec(sql)
  const lines = results.flatMap(r => r.rows.flatMap(row => Object.values(row))).filter((v): v is string => typeof v === 'string' && /^(not )?ok - /.test(v))
  return { lines, planned: Number(sql.match(/select plan\((\d+)\)/)![1]) }
}
