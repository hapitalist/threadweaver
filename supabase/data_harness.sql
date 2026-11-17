-- Thread Weaver: the Data Harness (17 Nov 2026).
-- Russell, 17 Nov 2026: "take everything relevant from the data harness we developed for Joy Looper and the command
-- center data harness and add it to Thread Weaver. Then run it through every page to check for bugs."
--
-- Ported from Hapitalist's own harness (bugs / client_error_groups / work_items + work_claims / route_tests, route_runs,
-- route_run_steps / health checks / the self-test) and Command Center's Data Harness 1.6.0 (toolkits/harness: What needs
-- doing, Tests, Test runs, Runs by itself, checks with "Prove it", the eyes, walks that close what they found, the
-- harness's own browser left out of visitors' errors, no second helper on a fix waiting for the OK).
--
-- Everything is in this database (project nzkgurdmvgkizvzisqxt). Nothing goes to Hapitalist.
--   hx_reports      what a person's browser saw (www/tw-eyes.js on every page), raw, kept 30 days
--   hx_findings     the same thing seen again is one finding: page + step + kind
--   hx_items        What needs doing (the board). Done only with proof: a walk of that step passed after it was opened,
--                   the check passed, or (when there is no test) the owner's own words
--   hx_tests        the walks; hx_runs + hx_run_steps every step of every run, for the replay
--   hx_checks       checks on Thread Weaver's own numbers, each with Prove it (a fault planted in a rolled-back copy)
--   hx_selftests    the self-test: one of every break planted on /admin/selftest.html, caught or not
--   hx_schedule     Runs by itself
-- Admin screens: /admin/harness.html (is_tw_admin). The walker: harness/walk.mjs (GitHub workflow data-harness.yml,
-- through the hx-ingest edge function with GitHub's own OIDC token, or a one-day local key from hx_make_local_key()).

-- ------------------------------------------------------------------------------------------------------------ tables
create table if not exists public.hx_reports (
  id bigserial primary key, at timestamptz not null default now(),
  kind text not null, page text not null default '', step text not null default '', message text not null default '',
  device text, browser text, ua text, build text, uid uuid,
  harness boolean not null default false, planted boolean not null default false,
  trail jsonb, extra jsonb, fp text not null);
create index if not exists hx_reports_at on public.hx_reports(at desc);
create index if not exists hx_reports_fp on public.hx_reports(fp, at desc);

create table if not exists public.hx_findings (
  fp text primary key, page text not null, step text not null default '', kind text not null, message text not null default '',
  sources text[] not null default '{}', times int not null default 0, people int not null default 0, people_ids uuid[] not null default '{}',
  first_seen timestamptz not null default now(), last_seen timestamptz not null default now(),
  seen_devices text[] not null default '{}', clean_devices text[] not null default '{}', clean_at timestamptz,
  tests text[] not null default '{}', by_device jsonb not null default '{}', trail jsonb, shot text, planted boolean not null default false,
  item_id bigint, harness_only boolean not null default true);

create table if not exists public.hx_items (
  id bigserial primary key, title text not null, detail text not null default '',
  source text not null check (source in ('walk','check','visitor','watch','admin','selftest')),
  fp text, check_name text, test_id bigint,
  status text not null default 'open' check (status in ('open','fix_waiting','done','removed')),
  claimed_by text, claimed_until timestamptz, fix_note text, fix_at timestamptz,
  opened_at timestamptz not null default now(), opened_by text not null default 'harness', who_told text,
  notes jsonb not null default '[]', updated_at timestamptz not null default now(),
  closed_at timestamptz, closed_by text, proof text, removed_at timestamptz, removed_from text);
create index if not exists hx_items_status on public.hx_items(status, opened_at desc);
create unique index if not exists hx_items_open_fp on public.hx_items(fp) where status in ('open','fix_waiting') and fp is not null;

create table if not exists public.hx_tests (
  id bigserial primary key, name text not null unique, kind text not null default 'route',
  persona text not null default 'stranger', devices text[] not null default '{phone,laptop}',
  steps jsonb not null default '[]', note text, active boolean not null default true,
  source text not null default 'harness', created_at timestamptz not null default now(), created_by text not null default 'harness',
  removed_at timestamptz, last_run_id bigint, last_run_at timestamptz, last_passed boolean);

create table if not exists public.hx_runs (
  id bigserial primary key, test_id bigint references public.hx_tests(id) on delete set null, name text not null, kind text,
  device text not null, persona text, trigger text not null default 'schedule',
  started_at timestamptz not null default now(), finished_at timestamptz, passed boolean, summary text,
  build text, gh_run text, findings int not null default 0, ended_how text);
create index if not exists hx_runs_started on public.hx_runs(started_at desc);

create table if not exists public.hx_run_steps (
  run_id bigint not null references public.hx_runs(id) on delete cascade, n int not null,
  action text not null, target text, url text, page_said text, passed boolean not null default true,
  kind text, note text, shot text, fp text, ms int, primary key (run_id, n));

create table if not exists public.hx_run_requests (
  id bigserial primary key, test_id bigint, item_id bigint, devices text[], requested_by text, requested_at timestamptz not null default now(),
  claimed_at timestamptz, done_at timestamptz, status text not null default 'queued');

create table if not exists public.hx_checks (
  name text primary key, title text not null, why text not null default '', active boolean not null default true,
  last_run timestamptz, last_ok boolean, last_problems jsonb, proved_at timestamptz, prove_ok boolean, prove_note text);

create table if not exists public.hx_selftests (
  id bigserial primary key, at timestamptz not null default now(), device text not null, run_id bigint,
  expected text[] not null, caught text[] not null, missed text[] not null, ok boolean not null);

create table if not exists public.hx_schedule (
  name text primary key, what text not null, runs text not null, place text not null, last_at timestamptz, last_ok boolean, note text);

create table if not exists public.hx_keys (key_hash text primary key, made_for text not null, made_at timestamptz not null default now(), expires_at timestamptz not null);

alter table public.hx_reports enable row level security;
alter table public.hx_findings enable row level security;
alter table public.hx_items enable row level security;
alter table public.hx_tests enable row level security;
alter table public.hx_runs enable row level security;
alter table public.hx_run_steps enable row level security;
alter table public.hx_run_requests enable row level security;
alter table public.hx_checks enable row level security;
alter table public.hx_selftests enable row level security;
alter table public.hx_schedule enable row level security;
alter table public.hx_keys enable row level security;
-- no policies: only the functions below (security definer) read or write these
revoke all on public.hx_reports, public.hx_findings, public.hx_items, public.hx_tests, public.hx_runs, public.hx_run_steps,
  public.hx_run_requests, public.hx_checks, public.hx_selftests, public.hx_schedule, public.hx_keys from anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------ helpers
create or replace function public._hx_fp(p_page text, p_step text, p_kind text, p_msg text) returns text
language sql immutable as $$
  -- one finding = page + step + kind. For script errors and failed calls the words are part of it (two different
  -- crashes on one page are two bugs), with numbers taken out so "line 812" and "line 813" stay one.
  select md5(lower(coalesce(p_page,'')) || '|' || lower(coalesce(p_step,'')) || '|' || lower(coalesce(p_kind,'')) || '|' ||
    case when p_kind in ('script error','failed call','visitor error') then regexp_replace(lower(left(coalesce(p_msg,''),160)), '[0-9]+', '#', 'g') else '' end)
$$;

create or replace function public._hx_title(p_kind text, p_page text, p_step text, p_msg text) returns text
language sql immutable as $$
  select left(initcap(p_kind) || ' on ' || coalesce(nullif(p_page,''),'a page') ||
    case when coalesce(p_step,'') <> '' then ' - ' || p_step else '' end ||
    case when coalesce(p_msg,'') <> '' then ': ' || p_msg else '' end, 300)
$$;

-- open (or keep open) the one item for a finding; never a second one while one is open
create or replace function public._hx_open_item(p_fp text, p_source text, p_title text, p_detail text, p_test bigint default null, p_check text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  select id into v from hx_items where fp = p_fp and status in ('open','fix_waiting') limit 1;
  if v is not null then
    update hx_items set updated_at = now(), detail = case when p_detail <> '' then p_detail else detail end where id = v;
    return v;
  end if;
  insert into hx_items(title, detail, source, fp, test_id, check_name) values (p_title, coalesce(p_detail,''), p_source, p_fp, p_test, p_check)
  returning id into v;
  return v;
end $$;

create or replace function public._hx_close_item(p_id bigint, p_by text, p_proof text) returns void
language sql security definer set search_path = public as $$
  update hx_items set status = 'done', closed_at = now(), closed_by = p_by, proof = p_proof, claimed_by = null, claimed_until = null, updated_at = now()
   where id = p_id and status in ('open','fix_waiting');
$$;

-- ------------------------------------------------------------------------------------------------------------ the eyes
-- Every page's tw-eyes.js sends what a person saw here. Nothing typed is ever sent: labels of what was pressed, the page,
-- what happened. The harness's own browser says TWDataHarness/1 in its user agent: kept, but never a visitor's error
-- (Command Center 1.6.0: "Its own walks are not visitors"). Pages under /admin/selftest are the planted breaks.
create or replace function public.hx_report(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := left(coalesce(p->>'kind',''), 60);
  v_page text := left(coalesce(p->>'page',''), 200);
  v_step text := left(coalesce(p->>'step',''), 160);
  v_msg  text := left(coalesce(p->>'message',''), 600);
  v_ua   text := left(coalesce(p->>'ua',''), 300);
  v_dev  text := case when p->>'device' in ('phone','tablet','laptop') then p->>'device' else 'laptop' end;
  v_h    boolean := v_ua ilike '%TWDataHarness/%';
  v_pl   boolean := v_page like '/admin/selftest%';
  v_fp   text; v_uid uuid := auth.uid(); v_n int; v_f hx_findings; v_item bigint;
begin
  if v_kind = '' or v_kind !~ '^[a-z ,-]+$' then return jsonb_build_object('ok', false); end if;
  -- a flood guard: at most 600 reports a minute overall and 30 an hour of any one finding are kept
  select count(*) into v_n from hx_reports where at > now() - interval '1 minute';
  if v_n > 600 then return jsonb_build_object('ok', false, 'busy', true); end if;
  v_fp := _hx_fp(v_page, v_step, v_kind, v_msg);
  select count(*) into v_n from hx_reports where fp = v_fp and at > now() - interval '1 hour';
  if v_n < 30 then
    insert into hx_reports(kind, page, step, message, device, browser, ua, build, uid, harness, planted, trail, extra, fp)
    values (v_kind, v_page, v_step, v_msg, v_dev, left(p->>'browser',60), v_ua, left(p->>'build',40), v_uid, v_h, v_pl,
            case when jsonb_typeof(p->'trail') = 'array' then (select jsonb_agg(left(x::text, 200)) from jsonb_array_elements(p->'trail') with ordinality t(x, i) where i <= 20) end,
            case when jsonb_typeof(p->'extra') = 'object' then p->'extra' end, v_fp);
  end if;
  if v_h then return jsonb_build_object('ok', true, 'harness', true); end if;   -- the walk files its own findings
  insert into hx_findings(fp, page, step, kind, message, sources, times, people, people_ids, seen_devices, by_device, trail, planted, harness_only)
  values (v_fp, v_page, v_step, v_kind, v_msg, array['visitor'], 1, case when v_uid is null then 0 else 1 end,
          case when v_uid is null then '{}'::uuid[] else array[v_uid] end, array[v_dev], jsonb_build_object(v_dev, 1), p->'trail', v_pl, false)
  on conflict (fp) do update set
    times = hx_findings.times + 1, last_seen = now(), message = excluded.message, harness_only = false,
    sources = case when 'visitor' = any(hx_findings.sources) then hx_findings.sources else hx_findings.sources || 'visitor'::text end,
    people_ids = case when v_uid is null or v_uid = any(hx_findings.people_ids) then hx_findings.people_ids else hx_findings.people_ids || v_uid end,
    people = cardinality(case when v_uid is null or v_uid = any(hx_findings.people_ids) then hx_findings.people_ids else hx_findings.people_ids || v_uid end),
    seen_devices = case when v_dev = any(hx_findings.seen_devices) then hx_findings.seen_devices else hx_findings.seen_devices || v_dev end,
    clean_devices = array_remove(hx_findings.clean_devices, v_dev),
    by_device = hx_findings.by_device || jsonb_build_object(v_dev, coalesce((hx_findings.by_device->>v_dev)::int, 0) + 1),
    trail = coalesce(excluded.trail, hx_findings.trail)
  returning * into v_f;
  -- a visitor's error goes on What needs doing the third time, or the first time two different people hit it
  if not v_f.planted and (v_f.times >= 3 or v_f.people >= 2) then
    v_item := _hx_open_item(v_fp, 'visitor', 'Visitors keep hitting: ' || _hx_title(v_kind, v_page, v_step, v_msg),
      'Seen ' || v_f.times || ' times by real visitors (' || array_to_string(v_f.seen_devices, ', ') || '). Closes when a walk opens ' ||
      v_page || ' on a phone and a laptop and the same thing does not show.');
    update hx_findings set item_id = v_item where fp = v_fp;
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.hx_report(jsonb) to anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------ the walker
-- One run of one walk on one device. p:
--  {test:{name, kind, persona, steps?}, device, trigger, started_at, finished_at, passed, summary, build, gh_run, ended_how,
--   steps:[{action, target, url, page_said, passed, kind, note, shot, page, step, message, ms}],
--   findings:[{page, step, kind, message, trail, shot}],      what the walk saw (each its own finding, page + step + kind)
--   clean:[{page, step}],                                     steps the walk did and saw nothing wrong at
--   selftest:{expected:[...], caught:[...]}}
create or replace function public._hx_ingest(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_test hx_tests; v_run bigint; v_dev text := coalesce(nullif(p->>'device',''), 'laptop');
  v_s jsonb; v_n int := 0; v_fp text; v_f hx_findings; v_item bigint; v_found int := 0; v_closed int := 0;
  v_name text := left(coalesce(p#>>'{test,name}', 'Walk'), 160); r record;
begin
  select * into v_test from hx_tests where name = v_name;
  if not found then
    insert into hx_tests(name, kind, persona, steps, source, created_by)
    values (v_name, coalesce(p#>>'{test,kind}','route'), coalesce(p#>>'{test,persona}','stranger'), coalesce(p#>'{test,steps}','[]'), 'harness', 'walker')
    returning * into v_test;
  end if;
  insert into hx_runs(test_id, name, kind, device, persona, trigger, started_at, finished_at, passed, summary, build, gh_run, ended_how)
  values (v_test.id, v_name, v_test.kind, v_dev, coalesce(p#>>'{test,persona}', v_test.persona), coalesce(p->>'trigger','schedule'),
          coalesce((p->>'started_at')::timestamptz, now()), coalesce((p->>'finished_at')::timestamptz, now()),
          coalesce((p->>'passed')::boolean, false), left(p->>'summary', 2000), left(p->>'build',40), left(p->>'gh_run',80), left(p->>'ended_how',200))
  returning id into v_run;

  for v_s in select * from jsonb_array_elements(coalesce(p->'steps','[]')) loop
    v_n := v_n + 1; exit when v_n > 600;
    insert into hx_run_steps(run_id, n, action, target, url, page_said, passed, kind, note, shot, fp, ms)
    values (v_run, v_n, left(coalesce(v_s->>'action','look'),40), left(v_s->>'target',300), left(v_s->>'url',400), left(v_s->>'page_said',1200),
            coalesce((v_s->>'passed')::boolean, true), left(v_s->>'kind',60), left(v_s->>'note',1200), left(v_s->>'shot',300),
            case when v_s ? 'kind' and coalesce((v_s->>'passed')::boolean, true) = false then _hx_fp(v_s->>'page', v_s->>'step', v_s->>'kind', v_s->>'message') end,
            (v_s->>'ms')::int);
  end loop;

  -- what the walk saw: one finding each, one item each (planted ones from the self-test page never go on the board)
  for v_s in select * from jsonb_array_elements(coalesce(p->'findings','[]')) loop
    v_fp := _hx_fp(v_s->>'page', v_s->>'step', v_s->>'kind', v_s->>'message');
    insert into hx_findings(fp, page, step, kind, message, sources, times, seen_devices, tests, by_device, trail, shot, planted, harness_only)
    values (v_fp, left(coalesce(v_s->>'page',''),200), left(coalesce(v_s->>'step',''),160), left(v_s->>'kind',60), left(coalesce(v_s->>'message',''),600),
            array['walk'], 1, array[v_dev], array[v_name], jsonb_build_object(v_dev,1), v_s->'trail', left(v_s->>'shot',300),
            coalesce(v_s->>'page','') like '/admin/selftest%', true)
    on conflict (fp) do update set times = hx_findings.times + 1, last_seen = now(), message = excluded.message,
      sources = case when 'walk' = any(hx_findings.sources) then hx_findings.sources else hx_findings.sources || 'walk'::text end,
      seen_devices = case when v_dev = any(hx_findings.seen_devices) then hx_findings.seen_devices else hx_findings.seen_devices || v_dev end,
      clean_devices = array_remove(hx_findings.clean_devices, v_dev),
      tests = case when v_name = any(hx_findings.tests) then hx_findings.tests else hx_findings.tests || v_name end,
      by_device = hx_findings.by_device || jsonb_build_object(v_dev, coalesce((hx_findings.by_device->>v_dev)::int, 0) + 1),
      trail = coalesce(excluded.trail, hx_findings.trail), shot = coalesce(excluded.shot, hx_findings.shot)
    returning * into v_f;
    v_found := v_found + 1;
    if not v_f.planted then
      v_item := _hx_open_item(v_fp, 'walk', _hx_title(v_f.kind, v_f.page, v_f.step, v_f.message),
        'Found by the walk "' || v_name || '" on a ' || v_dev || ' (run ' || v_run || '). Closes by itself when a walk of this exact step passes on every device it was seen on: ' ||
        array_to_string(v_f.seen_devices, ', ') || '.', v_test.id);
      update hx_findings set item_id = v_item where fp = v_fp;
    end if;
  end loop;

  -- steps walked clean: a finding at that page + step is clean on this device; clean on every device it was seen on closes it
  for v_s in select * from jsonb_array_elements(coalesce(p->'clean','[]')) loop
    for r in select f.* from hx_findings f
              where lower(f.page) = lower(coalesce(v_s->>'page','')) and lower(f.step) = lower(coalesce(v_s->>'step',''))
                and v_dev = any(f.seen_devices || array['phone','laptop']) and f.last_seen < coalesce((p->>'started_at')::timestamptz, now())
                and not exists (select 1 from jsonb_array_elements(coalesce(p->'findings','[]')) x
                                 where _hx_fp(x->>'page', x->>'step', x->>'kind', x->>'message') = f.fp) loop
      update hx_findings set clean_devices = case when v_dev = any(clean_devices) then clean_devices else clean_devices || v_dev end, clean_at = now()
       where fp = r.fp returning * into v_f;
      if v_f.item_id is not null and (case when 'visitor' = any(v_f.sources) then array['phone','laptop'] || v_f.seen_devices else v_f.seen_devices end) <@ v_f.clean_devices then
        if exists (select 1 from hx_items where id = v_f.item_id and status in ('open','fix_waiting') and opened_at < coalesce((p->>'started_at')::timestamptz, now())) then
          perform _hx_close_item(v_f.item_id, 'harness', 'The walk "' || v_name || '" (run ' || v_run || ') went through ' || v_f.page ||
            case when v_f.step <> '' then ' - ' || v_f.step else '' end || ' on ' || array_to_string(v_f.clean_devices, ' and ') ||
            ' after the item was opened, and it did not show.');
          v_closed := v_closed + 1;
        end if;
      end if;
    end loop;
  end loop;

  -- the self-test: every planted break must have been caught
  if p ? 'selftest' then
    insert into hx_selftests(device, run_id, expected, caught, missed, ok)
    select v_dev, v_run, e, c, m, cardinality(m) = 0 from (
      select array(select jsonb_array_elements_text(p#>'{selftest,expected}')) e, array(select jsonb_array_elements_text(p#>'{selftest,caught}')) c,
             array(select x from jsonb_array_elements_text(p#>'{selftest,expected}') x where x not in (select jsonb_array_elements_text(p#>'{selftest,caught}'))) m) q;
    if exists (select 1 from hx_selftests where run_id = v_run and not ok) then
      perform _hx_open_item('selftest:' || v_dev, 'selftest', 'The harness went blind on a ' || v_dev || ': the self-test missed ' ||
        (select array_to_string(missed, ', ') from hx_selftests where run_id = v_run), 'The self-test page /admin/selftest.html has one of every break. On run ' || v_run ||
        ' the harness did not catch: ' || (select array_to_string(missed, ', ') from hx_selftests where run_id = v_run) || '. Until this is fixed, a clean walk proves less than it says.');
    else
      for r in select id from hx_items where fp = 'selftest:' || v_dev and status in ('open','fix_waiting') loop
        perform _hx_close_item(r.id, 'harness', 'The self-test on a ' || v_dev || ' (run ' || v_run || ') caught every planted break.');
      end loop;
    end if;
  end if;

  -- a test that failed as a whole with nothing listed is its own item; a pass closes it
  if not coalesce((p->>'passed')::boolean, false) and v_found = 0 and not (p ? 'selftest') then
    perform _hx_open_item('test:' || v_test.id || ':' || v_dev, 'walk', 'The walk "' || v_name || '" failed on a ' || v_dev,
      coalesce(p->>'summary','') || ' (run ' || v_run || ')', v_test.id);
  elsif coalesce((p->>'passed')::boolean, false) then
    for r in select id from hx_items where fp = 'test:' || v_test.id || ':' || v_dev and status in ('open','fix_waiting') loop
      perform _hx_close_item(r.id, 'harness', 'The walk "' || v_name || '" passed on a ' || v_dev || ' (run ' || v_run || ').');
    end loop;
  end if;

  update hx_runs set findings = v_found where id = v_run;
  update hx_tests set last_run_id = v_run, last_run_at = now(), last_passed = coalesce((p->>'passed')::boolean, false) where id = v_test.id;
  update hx_schedule set last_at = now(), last_ok = coalesce((p->>'passed')::boolean, false) where name = 'walks';
  return jsonb_build_object('ok', true, 'run', v_run, 'findings', v_found, 'closed', v_closed);
end $$;
revoke all on function public._hx_ingest(jsonb) from public, anon, authenticated;

-- a one-day key for a walk run by hand from a computer (the GitHub workflow proves itself with OIDC instead)
create or replace function public.hx_make_local_key(p_for text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare k text := encode(gen_random_bytes(24), 'hex');
begin
  if not is_tw_admin() then raise exception 'admins only'; end if;
  insert into hx_keys(key_hash, made_for, expires_at) values (encode(digest(k, 'sha256'), 'hex'), left(p_for, 120), now() + interval '1 day');
  return k;
end $$;
revoke all on function public.hx_make_local_key(text) from public, anon;
grant execute on function public.hx_make_local_key(text) to authenticated;

create or replace function public.hx_ingest_with_key(p_key text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from hx_keys where key_hash = encode(digest(coalesce(p_key,''), 'sha256'), 'hex') and expires_at > now()) then
    return jsonb_build_object('ok', false, 'reason', 'That key is not one of the harness keys, or it ran out.');
  end if;
  return _hx_ingest(p);
end $$;
grant execute on function public.hx_ingest_with_key(text, jsonb) to anon, authenticated;

-- the queue the walker asks for (a run asked for from the admin page)
create or replace function public.hx_next_requests(p_max int default 5) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with c as (
    update hx_run_requests set claimed_at = now(), status = 'claimed'
     where id in (select id from hx_run_requests where status = 'queued' order by requested_at limit greatest(1, least(p_max, 10)) for update skip locked)
    returning *)
  select coalesce(jsonb_agg(jsonb_build_object('request_id', c.id, 'test_id', c.test_id, 'item_id', c.item_id, 'devices', c.devices,
         'name', t.name, 'kind', t.kind, 'persona', t.persona, 'steps', t.steps)), '[]') into v
    from c left join hx_tests t on t.id = c.test_id;
  return v;
end $$;
revoke all on function public.hx_next_requests(int) from public, anon, authenticated;
create or replace function public.hx_next_requests_with_key(p_key text, p_max int default 5) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from hx_keys where key_hash = encode(digest(coalesce(p_key,''), 'sha256'), 'hex') and expires_at > now()) then return '[]'; end if;
  return hx_next_requests(p_max);
end $$;
grant execute on function public.hx_next_requests_with_key(text, int) to anon, authenticated;
create or replace function public.hx_request_done(p_id bigint) returns void language sql security definer set search_path = public as $$
  update hx_run_requests set status = 'done', done_at = now() where id = p_id; $$;
revoke all on function public.hx_request_done(bigint) from public, anon, authenticated;

create or replace function public.hx_request_done_with_key(p_key text, p_id bigint) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from hx_keys where key_hash = encode(digest(coalesce(p_key,''), 'sha256'), 'hex') and expires_at > now()) then perform hx_request_done(p_id); end if;
end $$;
grant execute on function public.hx_request_done_with_key(text, bigint) to anon, authenticated;

-- the key check the hx-ingest function uses for a walk run by hand (17 Nov)
create or replace function public.hx_key_ok(p_key text) returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from hx_keys where key_hash = encode(digest(coalesce(p_key,''), 'sha256'), 'hex') and expires_at > now()) $$;
revoke all on function public.hx_key_ok(text) from public, anon, authenticated;

-- the walker's test people (addresses end in @test.invalid: never on the list, never sent anything)
create or replace function public.hx_persona_ok(p_email text) returns boolean language sql immutable as $$
  select lower(coalesce(p_email,'')) like '%@test.invalid' $$;
