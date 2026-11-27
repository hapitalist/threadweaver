-- Thread Weaver Data Harness, part 4 (27 Nov 2026): what Command Center's Data Harness learned 17-26 Nov (1.8.0 to 1.19.0).
-- Russell, 27 Nov 2026: "update the threadweaver data harness with the newest stuff from the command center data harness on
-- joy looper." Read against Thread Weaver's own harness (parts 1-3: data_harness.sql, data_harness_board.sql,
-- data_harness_checks.sql) and brought in where it fits:
--
--  The intake (CC 1.13.0, 1.16.0, 1.17.0, 1.19.0): not every finding is a bug.
--   - "Not a problem" is remembered (hx_verdicts): the same thing again is counted under Logged, never listed again.
--   - Reports that are never a fault in Thread Weaver's own pages (a very weak connection dropping, a tab left open through an
--     update, the browser cancelling its own request, the database or server too slow to answer) are counted under Logged.
--   - A thing closed with proof in the last 7 days is not listed again from the same words; a new word is listed at once.
--   - Lines that only describe the list itself (found and untouched for 3 days, no test to prove it) are counted, not listed.
--   - Logged (hx_signals) shows every count, and anything there can be put on the list now.
--   - 3 or more slow or silent server reports in 30 minutes are ONE item, "Server slowdown", that closes by itself (1.19.0).
--  The board (CC 1.8.0, 1.11.0, 1.16.0, 1.18.0):
--   - "Came back: ..." when something fixed before shows again, with when it was fixed and how it was proven.
--   - Every open item is in a lane: To fix, or Watching (the look that reported it no longer does; it closes by itself).
--   - An item a real person hit says so.
--   - A fix proven on some devices and not others says so on the item: what passed, what has not, and that the harness holds it.
--   - A failure that arrives after the same step already walked clean on that device is old news and is not filed.
--   - The Build board (hx_builds): projects being built, kept apart from What needs doing, never counted as broken.
--   - What good looks like after a press (hx_expect): written down per page and button; it waits until a walk sees it come true
--     once, then a walk that presses the button and does not see it lists "A press that did not give its result". One written
--     down 3+ days and never proved is one item per page.
--   - Look again reaches every open finding: a closed item no longer holds its finding, so the walker's list is only open ones.
--  Checks (CC 1.9.0): email refused for failing wannabepress.com's own DMARC/SPF/DKIM; Gmail readers opening far less.

-- ------------------------------------------------------------------------------------------------------------ tables
create table if not exists public.hx_verdicts (fp text primary key, why text not null default '', decided_at timestamptz not null default now(), decided_by text not null default 'admin', cleared_at timestamptz);
create table if not exists public.hx_signals (
  fp text primary key, tier text not null check (tier in ('log','watch')), title text not null default '', sample text not null default '',
  source text not null default '', first_seen timestamptz not null default now(), last_seen timestamptz not null default now(), times int not null default 1,
  filed_at timestamptz, cleared_at timestamptz);
create index if not exists hx_signals_seen on public.hx_signals(last_seen desc);
create table if not exists public.hx_builds (
  id bigserial primary key, title text not null, detail text not null default '', next_step text not null default '',
  status text not null default 'building' check (status in ('building','done')), who text not null default 'admin',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), done_at timestamptz, done_note text not null default '', removed_at timestamptz);
create table if not exists public.hx_expect (
  id bigserial primary key, page text not null default '', press text not null, kind text not null default 'see' check (kind in ('see','not_see')),
  words text not null, within_s int not null default 10, why text not null default '', on_ boolean not null default false,
  proven_at timestamptz, proven_how text not null default '', last_at timestamptz, last_ok boolean, last_said text not null default '',
  created_at timestamptz not null default now(), created_by text not null default 'admin', removed_at timestamptz);
alter table public.hx_items add column if not exists times int not null default 1;
alter table public.hx_items add column if not exists last_seen_at timestamptz;
alter table public.hx_verdicts enable row level security;
alter table public.hx_signals enable row level security;
alter table public.hx_builds enable row level security;
alter table public.hx_expect enable row level security;
revoke all on public.hx_verdicts, public.hx_signals, public.hx_builds, public.hx_expect from anon, authenticated;
insert into hx_schedule(name, what, runs, place) values
  ('watch', 'The harness watching itself: server slowdowns, what nobody touched, what no test proves, what good looks like never proved', 'every 10 minutes', 'database (cron hx-watch)')
on conflict (name) do nothing;

-- ------------------------------------------------------------------------------------------------------------ the intake
create or replace function public._hx_signal(p_fp text, p_tier text, p_title text, p_sample text, p_source text) returns void
language sql security definer set search_path = public as $$
  insert into hx_signals(fp, tier, title, sample, source) values (p_fp, p_tier, left(coalesce(p_title,''), 300), left(coalesce(p_sample,''), 600), coalesce(p_source,'watch'))
  on conflict (fp) do update set tier = excluded.tier, title = excluded.title, sample = excluded.sample, last_seen = now(), times = hx_signals.times + 1, cleared_at = null $$;

-- never a fault in Thread Weaver's own pages (Command Center 1.17.0 and 1.19.0, with the words Thread Weaver's pages and
-- Supabase actually use): null = it may be a fault
create or replace function public._hx_not_code(p_text text) returns text language sql immutable as $$
  select case
    when p_text ~* '(connection lost|very weak connection|slow-2g|went offline while|net::ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|the internet connection appears to be offline|NetworkError when attempting to fetch resource\. ?\(offline\))'
      then 'the person''s connection dropped'
    when p_text ~* '(old build served|running build \S+ while the site is on|update to the offline helper has been waiting|service worker .{0,40}waiting|ChunkLoadError|Loading chunk \d+ failed)'
      then 'a tab left open through an update still shows the old version until it is reloaded'
    when p_text ~* '(AbortError|signal is aborted|the user aborted a request|request was aborted|NS_BINDING_ABORTED|net::ERR_ABORTED|Load request cancelled)'
      then 'the browser cancelled the request itself because the page was left or reloaded'
    when p_text ~* '(57014|canceling statement due to statement timeout|the server did not answer in \d+ ?s|connection dropped before the server could answer|answered 50[234]\y|answered 544\y|upstream request timeout|gateway time-?out)'
      then 'the server was slow or did not answer, which is not a fault in a page'
  end $$;

-- lines that only describe the size or age of the list
create or replace function public._hx_log_only(p_fp text) returns boolean language sql immutable as $$ select coalesce(p_fp, '') ~ '^watch:(unworked|unproven)$' $$;

-- open (or keep open) the one item for a finding - or count it under Logged. Returns the item, or null when it was logged.
create or replace function public._hx_open_item(p_fp text, p_source text, p_title text, p_detail text, p_test bigint default null, p_check text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint; was hx_items; nc text; v_title text := left(coalesce(p_title,''), 300);
begin
  select id into v from hx_items where fp = p_fp and status in ('open','fix_waiting') limit 1;
  if v is not null then
    update hx_items set updated_at = now(), last_seen_at = now(), times = times + 1, detail = case when coalesce(p_detail,'') <> '' then p_detail else detail end where id = v;
    return v;
  end if;
  -- the owner said this is not a problem (1.13.0), or it only describes the list itself: counted, not listed
  if p_fp is not null and (exists (select 1 from hx_verdicts where fp = p_fp and cleared_at is null) or _hx_log_only(p_fp)) then
    perform _hx_signal(p_fp, 'log', v_title, p_detail, p_source); return null;
  end if;
  -- never a fault in the pages (1.17.0, 1.19.0): counted under Logged with the reason
  nc := _hx_not_code(coalesce(p_title,'') || E'\n' || coalesce(p_detail,''));
  if nc is not null and p_source in ('walk','visitor','check') then
    perform _hx_signal(p_fp, 'log', v_title, left(coalesce(p_detail,''), 500) || ' (not a fault in the pages: ' || nc || ')', p_source); return null;
  end if;
  -- closed with proof in the last 7 days and saying exactly the same thing (1.16.0): counted, not listed again
  select * into was from hx_items where fp = p_fp and status = 'done' order by closed_at desc limit 1;
  if found and was.closed_at > now() - interval '7 days' and coalesce(was.closed_by, '') = 'harness'
     and regexp_replace(was.title, '^Came back: ', '') = regexp_replace(v_title, '^Came back: ', '')
     and (p_source in ('walk','visitor') or coalesce(was.detail,'') = coalesce(p_detail,'')) then
    perform _hx_signal(p_fp, 'log', v_title, coalesce(p_detail,'') || ' (the same words as when it was closed with proof ' || to_char(was.closed_at at time zone 'America/Los_Angeles', 'Mon DD') || ')', p_source);
    return null;
  end if;
  insert into hx_items(title, detail, source, fp, test_id, check_name, last_seen_at)
  values (case when was.id is not null and v_title !~ '^Came back: ' then left('Came back: ' || v_title, 300) else v_title end, coalesce(p_detail,''), p_source, p_fp, p_test, p_check, now())
  returning id into v;
  -- it came back after it was fixed (1.8.0)
  if was.id is not null then
    update hx_items set notes = notes || jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Data Harness', 'note',
      'This came back. It was fixed ' || to_char(was.closed_at at time zone 'America/Los_Angeles', 'Mon DD HH12:MI am') || ' PT' ||
      case when coalesce(was.proof,'') <> '' then ' (' || regexp_replace(was.proof, '\.$', '') || ')' else '' end || ', and it shows again.')) where id = v;
  end if;
  -- it was watched before it was listed
  update hx_signals set filed_at = now() where fp = p_fp and tier = 'watch' and filed_at is null;
  return v;
end $$;

-- a closed item no longer holds its finding, so the walker's "Look again" list (hx-ingest open_findings: findings that hold an
-- item) is only what is open, however long the history grows (1.14.0: every open one is reached)
create or replace function public._hx_close_item(p_id bigint, p_by text, p_proof text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update hx_items set status = 'done', closed_at = now(), closed_by = p_by, proof = p_proof, claimed_by = null, claimed_until = null, updated_at = now()
   where id = p_id and status in ('open','fix_waiting');
  update hx_findings set item_id = null where item_id = p_id;
end $$;
update hx_findings f set item_id = null where item_id is not null and not exists (select 1 from hx_items i where i.id = f.item_id and i.status in ('open','fix_waiting'));

-- one standing item: open while bad, closed by itself when it stops being true (Command Center's standing())
create or replace function public._hx_standing(p_fp text, p_title text, p_detail text, p_bad boolean, p_ok text) returns bigint
language plpgsql security definer set search_path = public as $$
declare r record; v bigint;
begin
  if p_bad then
    for r in select id from hx_items where fp = p_fp and status in ('open','fix_waiting') and _hx_log_only(p_fp) loop
      perform _hx_close_item(r.id, 'harness', 'Moved to Logged: it only describes the size or age of the list, so it is counted there and no longer listed.');
    end loop;
    v := _hx_open_item(p_fp, 'watch', p_title, p_detail);
    return v;
  end if;
  update hx_signals set cleared_at = now() where fp = p_fp and tier = 'watch' and filed_at is null and cleared_at is null;
  for r in select id from hx_items where fp = p_fp and status in ('open','fix_waiting') loop perform _hx_close_item(r.id, 'harness', p_ok); end loop;
  return null;
end $$;

-- ------------------------------------------------------------------------------------------------------------ the walker's results
-- _hx_ingest as before (part 1), and: a failure that arrives after that step already walked clean on that device is not filed
-- (1.11.0); a fix proven on some devices says so on its item (1.11.0); what good looks like after a press is recorded (1.8.0).
create or replace function public._hx_ingest(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_test hx_tests; v_run bigint; v_dev text := coalesce(nullif(p->>'device',''), 'laptop');
  v_s jsonb; v_n int := 0; v_fp text; v_f hx_findings; v_item bigint; v_found int := 0; v_closed int := 0; v_old int := 0;
  v_name text := left(coalesce(p#>>'{test,name}', 'Walk'), 160); r record; v_fin timestamptz := coalesce((p->>'finished_at')::timestamptz, now());
  v_hold text; v_want text[];
begin
  select * into v_test from hx_tests where name = v_name;
  if not found then
    insert into hx_tests(name, kind, persona, steps, source, created_by)
    values (v_name, coalesce(p#>>'{test,kind}','route'), coalesce(p#>>'{test,persona}','stranger'), coalesce(p#>'{test,steps}','[]'), 'harness', 'walker')
    returning * into v_test;
  end if;
  insert into hx_runs(test_id, name, kind, device, persona, trigger, started_at, finished_at, passed, summary, build, gh_run, ended_how)
  values (v_test.id, v_name, v_test.kind, v_dev, coalesce(p#>>'{test,persona}', v_test.persona), coalesce(p->>'trigger','schedule'),
          coalesce((p->>'started_at')::timestamptz, now()), v_fin,
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

  for v_s in select * from jsonb_array_elements(coalesce(p->'findings','[]')) loop
    v_fp := _hx_fp(v_s->>'page', v_s->>'step', v_s->>'kind', v_s->>'message');
    -- old news: this step has walked clean on this device since this run finished (a result that reached the database late)
    if exists (select 1 from hx_findings where fp = v_fp and v_dev = any(clean_devices) and clean_at > v_fin) then v_old := v_old + 1; continue; end if;
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
      if v_item is not null then update hx_findings set item_id = v_item where fp = v_fp; end if;
    end if;
  end loop;

  for v_s in select * from jsonb_array_elements(coalesce(p->'clean','[]')) loop
    for r in select f.* from hx_findings f
              where lower(f.page) = lower(coalesce(v_s->>'page','')) and lower(f.step) = lower(coalesce(v_s->>'step',''))
                and v_dev = any(f.seen_devices || array['phone','laptop']) and f.last_seen < coalesce((p->>'started_at')::timestamptz, now())
                and not exists (select 1 from jsonb_array_elements(coalesce(p->'findings','[]')) x
                                 where _hx_fp(x->>'page', x->>'step', x->>'kind', x->>'message') = f.fp) loop
      update hx_findings set clean_devices = case when v_dev = any(clean_devices) then clean_devices else clean_devices || v_dev end, clean_at = now()
       where fp = r.fp returning * into v_f;
      if v_f.item_id is null then continue; end if;
      v_want := case when 'visitor' = any(v_f.sources) then array['phone','laptop'] || v_f.seen_devices else v_f.seen_devices end;
      if v_want <@ v_f.clean_devices then
        if exists (select 1 from hx_items where id = v_f.item_id and status in ('open','fix_waiting') and opened_at < coalesce((p->>'started_at')::timestamptz, now())) then
          perform _hx_close_item(v_f.item_id, 'harness', 'The walk "' || v_name || '" (run ' || v_run || ') went through ' || v_f.page ||
            case when v_f.step <> '' then ' - ' || v_f.step else '' end || ' on ' || array_to_string(v_f.clean_devices, ' and ') ||
            ' after the item was opened, and it did not show.');
          v_closed := v_closed + 1;
        end if;
      else
        -- proven on this device, not yet on the others: the item says so once, so a proven fix never sits open with nothing said
        v_hold := 'Walked clean on a ' || array_to_string(v_f.clean_devices, ' and a ') || ' (the walk "' || v_name || '", run ' || v_run || '). Still to pass on a ' ||
          array_to_string(array(select d from unnest(v_want) d where not d = any(v_f.clean_devices)), ' and a ') ||
          '; the harness holds it open until the walk passes there too, then it closes by itself.';
        update hx_items set notes = notes || jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Data Harness', 'note', v_hold)), updated_at = now()
         where id = v_f.item_id and status in ('open','fix_waiting')
           and not exists (select 1 from jsonb_array_elements(notes) n where n->>'by' = 'Data Harness' and n->>'note' like 'Walked clean on a ' || array_to_string(v_f.clean_devices, ' and a ') || ' %');
      end if;
    end loop;
  end loop;

  -- what good looks like after a press (1.8.0): the walk says, for each rule it could try, whether it came true
  for v_s in select * from jsonb_array_elements(coalesce(p->'expect','[]')) loop
    update hx_expect set last_at = now(), last_ok = coalesce((v_s->>'ok')::boolean, false), last_said = left(coalesce(v_s->>'said',''), 400),
      on_ = on_ or coalesce((v_s->>'ok')::boolean, false),
      proven_at = case when proven_at is null and coalesce((v_s->>'ok')::boolean, false) then now() else proven_at end,
      proven_how = case when proven_at is null and coalesce((v_s->>'ok')::boolean, false) then 'Seen to come true by the walk "' || v_name || '" on a ' || v_dev || ' (run ' || v_run || ')' else proven_how end
     where id = (v_s->>'id')::bigint and removed_at is null;
  end loop;

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

  if not coalesce((p->>'passed')::boolean, false) and v_found = 0 and v_old = 0 and not (p ? 'selftest') then
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
  return jsonb_build_object('ok', true, 'run', v_run, 'findings', v_found, 'closed', v_closed, 'old_news', v_old);
end $$;
revoke all on function public._hx_ingest(jsonb) from public, anon, authenticated;

-- the rules the walker tries: page part, button words, what must (or must not) show, within how many seconds. Nothing secret.
create or replace function public.hx_expect_rules() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'page', page, 'press', press, 'kind', kind, 'words', words, 'within_s', within_s, 'on', on_) order by id), '[]')
    from hx_expect where removed_at is null $$;
grant execute on function public.hx_expect_rules() to anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------ watching itself (every 10 minutes)
create or replace function public.hx_watch() returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; f timestamptz; l timestamptz; r record; v_unworked int; v_unproven int; v_pages int := 0;
begin
  -- 1.19.0: a server that was slow or did not answer, 3 or more times in 30 minutes (real visitors, not the harness), is one slowdown
  select count(*), min(at), max(at) into n, f, l from hx_reports
   where at > now() - interval '30 minutes' and not harness and not planted
     and _hx_not_code(kind || ' ' || message) = 'the server was slow or did not answer, which is not a fault in a page';
  perform _hx_standing('watch:server_slowdown', 'Server slowdown: ' || n || ' reports of a slow or silent server in 30 minutes',
    n || ' reports of a slow or silent server between ' || coalesce(to_char(f at time zone 'America/Los_Angeles', 'HH12:MI am'), '?') || ' and ' ||
    coalesce(to_char(l at time zone 'America/Los_Angeles', 'HH12:MI am'), '?') || ' PT. Find what loaded the database or the functions in that window (a big query, a job, walks running together) and fix it at its cause.',
    n >= 3, 'No slow or silent server for 30 minutes.');
  -- 1.8.0 + 1.13.0: what nobody touched for 3 days, and what no test proves - counted under Logged (they describe the list itself)
  select count(*) into v_unworked from hx_items i where status = 'open' and source <> 'watch'
     and greatest(i.opened_at, coalesce(i.claimed_until - interval '2 hours', '-infinity'), coalesce((select max((nt->>'at')::timestamptz) from jsonb_array_elements(i.notes) nt where nt->>'by' <> 'Data Harness'), '-infinity')) < now() - interval '3 days';
  if v_unworked > 0 then perform _hx_open_item('watch:unworked', 'watch', 'Found, and nobody has touched it for three days', v_unworked || ' open'); end if;
  select count(*) into v_unproven from hx_items where status = 'open' and source = 'admin' and test_id is null and opened_at < now() - interval '1 hour';
  if v_unproven > 0 then perform _hx_open_item('watch:unproven', 'watch', 'Things on What needs doing with no test to prove them fixed', v_unproven || ' with no test'); end if;
  -- 1.8.0 + 1.11.0: what good looks like, written down 3+ days ago and never seen to come true - one item per page
  for r in select coalesce(nullif(page,''), 'any page') pg, count(*) c,
                  string_agg('pressing "' || press || '" should ' || case when kind = 'see' then 'show' else 'not show' end || ' "' || words || '"' ||
                    case when last_said <> '' then ' - last time: ' || last_said else ' - no walk has pressed it yet' end, '; ' order by id) what
             from hx_expect where removed_at is null and not on_ and proven_at is null and created_at < now() - interval '3 days' group by 1 loop
    v_pages := v_pages + 1;
    perform _hx_standing('watch:expect_waiting:' || lower(r.pg), 'What good looks like after a press: never proved by a walk on ' || r.pg,
      r.c || ' written down 3+ days ago and never seen to come true on ' || r.pg || ': ' || r.what || '. Until a walk sees it come true once, nothing checks it.', true, '');
  end loop;
  for r in select fp from hx_items where status in ('open','fix_waiting') and fp like 'watch:expect\_waiting:%' loop
    if not exists (select 1 from hx_expect where removed_at is null and not on_ and proven_at is null and created_at < now() - interval '3 days'
                    and 'watch:expect_waiting:' || lower(coalesce(nullif(page,''), 'any page')) = r.fp) then
      perform _hx_standing(r.fp, '', '', false, 'Every one on that page has been proved by a walk (or taken out).');
    end if;
  end loop;
  update hx_schedule set last_at = now(), last_ok = true where name = 'watch';
  return jsonb_build_object('slowdown_reports', n, 'unworked', v_unworked, 'unproven', v_unproven, 'expect_pages', v_pages);
end $$;
revoke all on function public.hx_watch() from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------ the board
-- the lane (1.16.0): To fix, or Watching - the look that reported it no longer does, so it is not handed to a helper and closes by itself
create or replace function public._hx_lane(i hx_items) returns text language plpgsql stable security definer set search_path = public as $$
declare f hx_findings; c hx_checks;
begin
  if i.status <> 'open' or i.source in ('visitor','admin') then return 'fix'; end if;
  if i.source = 'walk' then
    select * into f from hx_findings where fp = i.fp;
    if found and f.clean_at > i.opened_at and f.seen_devices <@ f.clean_devices then return 'watch'; end if;
    if i.fp like 'test:%' and exists (select 1 from hx_runs where test_id = i.test_id and passed and started_at > i.opened_at
                                       and device = split_part(i.fp, ':', 3)) then return 'watch'; end if;
  elsif i.source = 'check' then
    select * into c from hx_checks where name = i.check_name;
    if found and c.last_ok and c.last_run > i.opened_at then return 'watch'; end if;
  end if;
  return 'fix';
end $$;
revoke all on function public._hx_lane(hx_items) from public, anon, authenticated;

create or replace function public.hx_admin_items(p_status text default 'open') returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  return coalesce((select jsonb_agg(row_to_json(i) order by (i.lane = 'fix') desc, (i.status = 'fix_waiting') desc, i.opened_at desc) from (
    select it.*, t.name test_name, f.page, f.step, f.kind, f.times seen_times, f.seen_devices, f.clean_devices, f.shot, f.trail, f.sources,
           (it.claimed_by is not null and it.claimed_until > now()) as held,
           _hx_lane(it) as lane,
           -- an item a real person hit says so (1.16.0)
           (it.source = 'visitor' or coalesce(f.people, 0) > 0 or 'visitor' = any(coalesce(f.sources, '{}'))) as real_person,
           coalesce(f.people, 0) as people
      from hx_items it left join hx_tests t on t.id = it.test_id left join hx_findings f on f.fp = it.fp
     where case p_status when 'open' then it.status in ('open','fix_waiting') when 'fix' then it.status in ('open','fix_waiting') and _hx_lane(it) = 'fix'
                         when 'watch' then it.status in ('open','fix_waiting') and _hx_lane(it) = 'watch'
                         when 'done' then it.status = 'done' and it.closed_at > now() - interval '30 days'
                         when 'removed' then it.status = 'removed' else true end
     order by it.opened_at desc limit 400) i), '[]');
end $$;

-- the counts say what they count (1.11.0): To fix, Watching, Logged and the Build board each by name
create or replace function public.hx_admin_summary() returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform _hx_admin();
  select jsonb_build_object(
    'open', (select count(*) from hx_items where status = 'open'),
    'fix', (select count(*) from hx_items i where status in ('open','fix_waiting') and _hx_lane(i) = 'fix'),
    'watch', (select count(*) from hx_items i where status in ('open','fix_waiting') and _hx_lane(i) = 'watch'),
    'logged', (select count(*) from hx_signals where (tier = 'log' or (tier = 'watch' and filed_at is null and cleared_at is null)) and last_seen > now() - interval '30 days'),
    'real_person', (select count(*) from hx_items it left join hx_findings f on f.fp = it.fp where it.status in ('open','fix_waiting') and (it.source = 'visitor' or coalesce(f.people,0) > 0)),
    'building', (select count(*) from hx_builds where removed_at is null and status = 'building'),
    'expect', (select count(*) from hx_expect where removed_at is null),
    'fix_waiting', (select count(*) from hx_items where status = 'fix_waiting'),
    'done_week', (select count(*) from hx_items where status = 'done' and closed_at > now() - interval '7 days'),
    'tests', (select count(*) from hx_tests where active and removed_at is null),
    'runs_day', (select count(*) from hx_runs where started_at > now() - interval '1 day'),
    'runs_failed_day', (select count(*) from hx_runs where started_at > now() - interval '1 day' and passed = false),
    'last_walk', (select max(started_at) from hx_runs),
    'checks', (select count(*) from hx_checks where active),
    'checks_red', (select count(*) from hx_checks where active and last_ok = false),
    'checks_unproved', (select count(*) from hx_checks where active and coalesce(prove_ok, false) = false),
    'visitor_findings', (select count(*) from hx_findings where 'visitor' = any(sources) and not planted and last_seen > now() - interval '7 days'),
    'reports_day', (select count(*) from hx_reports where at > now() - interval '1 day' and not harness and not planted),
    'selftest', (select jsonb_build_object('at', at, 'ok', ok, 'missed', missed, 'device', device) from hx_selftests order by at desc limit 1),
    'selftest_devices', (select jsonb_agg(jsonb_build_object('device', device, 'at', at, 'ok', ok, 'missed', missed))
                           from (select distinct on (device) * from hx_selftests order by device, at desc) s)
  ) into v;
  return v;
end $$;

-- "Not a problem" (1.13.0): the item goes under Removed, and the same thing again is counted under Logged, never listed again
create or replace function public.hx_admin_item_not_problem(p_id bigint, p_why text) returns jsonb language plpgsql security definer set search_path = public as $$
declare i hx_items;
begin
  perform _hx_admin();
  select * into i from hx_items where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'That item is gone.'); end if;
  if coalesce(trim(p_why),'') = '' then return jsonb_build_object('ok', false, 'reason', 'Say why it is not a problem, so the next person knows.'); end if;
  if i.fp is null or i.fp like 'admin:%' then return jsonb_build_object('ok', false, 'reason', 'Only something the harness found can be remembered as not a problem. Use Remove for this one.'); end if;
  insert into hx_verdicts(fp, why, decided_by) values (i.fp, left(trim(p_why), 600), _hx_who())
    on conflict (fp) do update set why = excluded.why, decided_at = now(), decided_by = excluded.decided_by, cleared_at = null;
  update hx_items set removed_from = status, status = 'removed', removed_at = now(), claimed_by = null, claimed_until = null, updated_at = now(),
         notes = notes || jsonb_build_array(jsonb_build_object('at', now(), 'by', _hx_who(), 'note', 'Not a problem: ' || left(trim(p_why), 600)))
   where id = p_id and status <> 'removed';
  perform _hx_signal(i.fp, 'log', i.title, 'Not a problem: ' || left(trim(p_why), 500), i.source);
  return jsonb_build_object('ok', true);
end $$;

-- Logged: every count, newest first (30 days), with what the owner said is not a problem
create or replace function public.hx_admin_logged() returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  return jsonb_build_object(
    'rows', coalesce((select jsonb_agg(row_to_json(s) order by s.last_seen desc) from (
       select g.*, v.why verdict, v.decided_by, v.decided_at, v.cleared_at verdict_cleared_at,
              case when v.fp is not null then 'You said it is not a problem'
                   when g.tier = 'watch' and g.filed_at is null and g.cleared_at is null then 'Watched before it is listed'
                   when g.tier = 'watch' and g.cleared_at is not null then 'Watched, and it cleared'
                   when g.sample like '%(not a fault in the pages:%' then 'Not a fault in the pages'
                   when g.sample like '%(the same words as when it was closed with proof%' then 'Closed with proof; the same words again'
                   when _hx_log_only(g.fp) then 'Describes the list itself'
                   else 'Counted' end why_logged
         from hx_signals g left join hx_verdicts v on v.fp = g.fp and v.cleared_at is null
        where g.last_seen > now() - interval '30 days' order by g.last_seen desc limit 300) s), '[]'),
    'verdicts', (select count(*) from hx_verdicts where cleared_at is null));
end $$;

-- put anything under Logged on What needs doing now (and forget "not a problem" for it)
create or replace function public.hx_admin_logged_list(p_fp text) returns jsonb language plpgsql security definer set search_path = public as $$
declare g hx_signals; v bigint;
begin
  perform _hx_admin();
  select * into g from hx_signals where fp = p_fp;
  if not found then return jsonb_build_object('ok', false, 'reason', 'That is no longer under Logged.'); end if;
  insert into hx_items(title, detail, source, fp, opened_by, last_seen_at)
  select left(g.title, 300), g.sample || E'\n\nPut on the list from Logged by ' || _hx_who() || '. Seen ' || g.times || ' times since ' ||
         to_char(g.first_seen at time zone 'America/Los_Angeles', 'Mon DD') || '.', case when g.source in ('walk','check','visitor','watch','admin','selftest') then g.source else 'watch' end,
         g.fp, _hx_who(), now()
   where not exists (select 1 from hx_items where fp = g.fp and status in ('open','fix_waiting'))
  returning id into v;
  -- "not a problem" no longer holds for it: the same thing is listed again (kept, with when it was cleared)
  update hx_verdicts set cleared_at = now() where fp = p_fp and cleared_at is null;
  update hx_signals set filed_at = now() where fp = p_fp;
  return jsonb_build_object('ok', true, 'id', v);
end $$;

-- ------------------------------------------------------------------------------------------------------------ the Build board (1.18.0)
-- Russell (on Command Center): "Every fix goes into the bug board. You need to add a section where you can log current projects aside
-- from the fix, like build board." Nothing here is a fault: never handed to a helper to fix, never in the To fix / Watching / Logged numbers.
create or replace function public.hx_admin_builds(p_which text default 'building') returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  return jsonb_build_object(
    'rows', coalesce((select jsonb_agg(row_to_json(b) order by b.updated_at desc) from hx_builds b
       where case p_which when 'done' then b.removed_at is null and b.status = 'done' when 'removed' then b.removed_at is not null else b.removed_at is null and b.status = 'building' end), '[]'),
    'counts', jsonb_build_object('building', (select count(*) from hx_builds where removed_at is null and status = 'building'),
      'done', (select count(*) from hx_builds where removed_at is null and status = 'done'), 'removed', (select count(*) from hx_builds where removed_at is not null)));
end $$;
create or replace function public.hx_admin_build_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v bigint; t text := left(trim(coalesce(p->>'title','')), 200);
begin
  perform _hx_admin();
  if t = '' then return jsonb_build_object('ok', false, 'reason', 'Say what is being built.'); end if;
  if (p->>'id') is not null then
    update hx_builds set title = t, detail = left(coalesce(p->>'detail', detail), 2000), next_step = left(coalesce(p->>'next_step', next_step), 500), updated_at = now()
     where id = (p->>'id')::bigint returning id into v;
    return jsonb_build_object('ok', v is not null, 'id', v);
  end if;
  -- the same project named again is updated, not doubled
  select id into v from hx_builds where status = 'building' and removed_at is null and lower(title) = lower(t) limit 1;
  if v is not null then
    update hx_builds set detail = left(coalesce(p->>'detail', detail), 2000), next_step = left(coalesce(p->>'next_step', next_step), 500), updated_at = now() where id = v;
    return jsonb_build_object('ok', true, 'id', v, 'same', true);
  end if;
  insert into hx_builds(title, detail, next_step, who) values (t, left(coalesce(p->>'detail',''), 2000), left(coalesce(p->>'next_step',''), 500), _hx_who()) returning id into v;
  return jsonb_build_object('ok', true, 'id', v);
end $$;
create or replace function public.hx_admin_build_done(p_id bigint, p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  update hx_builds set status = 'done', done_at = now(), done_note = left(coalesce(p_note,''), 1000), updated_at = now() where id = p_id and status = 'building' and removed_at is null;
  return jsonb_build_object('ok', found);
end $$;
create or replace function public.hx_admin_build_remove(p_id bigint, p_back boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  update hx_builds set removed_at = case when p_back then null else now() end, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', found);
end $$;

-- ------------------------------------------------------------------------------------------------------------ what good looks like after a press (1.8.0)
create or replace function public.hx_admin_expects() returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  return coalesce((select jsonb_agg(row_to_json(e) order by e.removed_at is not null, e.on_ desc, e.created_at desc) from (
    select x.*, case when x.removed_at is not null then 'removed' when x.on_ then 'on' else 'waiting' end state from hx_expect x) e), '[]');
end $$;
create or replace function public.hx_admin_expect_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v bigint; v_press text := regexp_replace(trim(coalesce(p->>'press','')), '\s+', ' ', 'g'); v_words text := regexp_replace(trim(coalesce(p->>'words','')), '\s+', ' ', 'g');
begin
  perform _hx_admin();
  if v_press = '' then return jsonb_build_object('ok', false, 'reason', 'Say which button: the words on it.'); end if;
  if v_words = '' then return jsonb_build_object('ok', false, 'reason', 'Say what should show after pressing it.'); end if;
  if v_press ~* '\m(buy|pay|purchase|checkout|subscribe|unsubscribe|sign ?out|log ?out|delete|remove|send|cancel|restore purchases|reset password)\M' then
    return jsonb_build_object('ok', false, 'reason', 'The harness never presses a button like "' || v_press || '" by itself (it could pay, send or delete).');
  end if;
  insert into hx_expect(page, press, kind, words, within_s, why, created_by)
  values (left(regexp_replace(regexp_replace(trim(coalesce(p->>'page','')), '^https?://', '', 'i'), '^[^/]*thread\.wannabepress\.com', ''), 300), left(v_press, 120),
          case when p->>'kind' = 'not_see' then 'not_see' else 'see' end, left(v_words, 300), least(60, greatest(1, coalesce((p->>'within_s')::int, 10))), left(coalesce(p->>'why',''), 300), _hx_who())
  returning id into v;
  return jsonb_build_object('ok', true, 'id', v);
end $$;
create or replace function public.hx_admin_expect_remove(p_id bigint, p_back boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  update hx_expect set removed_at = case when p_back then null else now() end where id = p_id;
  return jsonb_build_object('ok', found);
end $$;

-- ------------------------------------------------------------------------------------------------------------ two checks on the email (CC 1.9.0)
create or replace function public.hx_ck_email_auth_refused() returns jsonb language sql stable security definer set search_path = public as $$
  -- mail refused for failing wannabepress.com's own DMARC, SPF or DKIM never reached anyone, and SES may then mark good readers bounced
  select coalesce(jsonb_agg(m), '[]') from (
    select count(*) || ' email' || case when count(*) = 1 then ' was' else 's were' end || ' refused this week for failing wannabepress.com''s own checks (DMARC, SPF or DKIM): fix the sending domain''s settings in Amazon SES, then send again (' ||
           string_agg(distinct left(split_part(email, '@', 2) || ': ' || error, 140), '; ') || ')' m
      from (select email, error from nl_sequence_sends where coalesce(sent_at, claimed_at) > now() - interval '7 days'
             and error ~* '(dmarc|unauthenticated|spf|dkim|5\.7\.2[0-9])' limit 50) s having count(*) > 0
    union all
    select count(*) || ' reader' || case when count(*) = 1 then ' was' else 's were' end || ' put on the bounced or suppressed list this week because the email failed wannabepress.com''s checks - their address is fine; put them back once sending passes'
      from (select email from email_suppression where created_at > now() - interval '7 days' and reason ~* '(dmarc|unauthenticated|spf|dkim|authentication)'
            union select email from nl_subscribers where status_at > now() - interval '7 days' and status in ('bounced','suppressed') and status_why ~* '(dmarc|unauthenticated|spf|dkim|authentication)') u having count(*) > 0
  ) x $$;
create or replace function public.hx_plant_email_auth_refused() returns void language sql security definer set search_path = public as $$
  insert into email_suppression(email, reason, created_at) values ('hx-plant-' || md5(random()::text) || '@example.com', '550-5.7.26 Unauthenticated email is not accepted due to domain''s DMARC policy (planted)', now()) $$;

create or replace function public.hx_ck_email_gmail_gap() returns jsonb language sql stable security definer set search_path = public as $$
  -- readers who open everywhere else and far less on Gmail: Gmail is filing the email away (Promotions or spam)
  with r as (
    select (lower(email) like '%@gmail.com' or lower(email) like '%@googlemail.com') gm, count(*) n, count(*) filter (where opens_recent > 0) o
      from nl_subscribers where status = 'subscribed' and last_sent_at > now() - interval '30 days' group by 1)
  select coalesce((select case when g.n >= 50 and e.n >= 50 and e.o::numeric / e.n >= 0.10 and (g.o::numeric / g.n) < 0.5 * (e.o::numeric / e.n)
    then jsonb_build_array('Gmail readers open ' || round(100.0 * g.o / g.n) || '% of the time and everyone else ' || round(100.0 * e.o / e.n) ||
      '% (' || g.n || ' and ' || e.n || ' readers sent to in 30 days): Gmail is likely filing the email in Promotions or spam')
    else '[]'::jsonb end
    from (select * from r where gm) g, (select * from r where not gm) e), '[]'::jsonb) $$;
create or replace function public.hx_plant_email_gmail_gap() returns void language sql security definer set search_path = public as $$
  insert into nl_subscribers(email, status, source, last_sent_at, opens_recent)
  select 'hx-plant-' || i || '-' || md5(random()::text) || case when i <= 60 then '@gmail.com' else '@example.com' end, 'subscribed', 'hx-plant', now(),
         case when i <= 60 then (i <= 2)::int else (i % 2)::int end
    from generate_series(1, 180) i $$;

insert into hx_checks(name, title, why) values
  ('email_auth_refused', 'Every email passes wannabepress.com''s own checks', 'Mail refused for failing the domain''s DMARC, SPF or DKIM never reached anyone, and SES may then mark good readers as bounced.'),
  ('email_gmail_gap', 'Gmail shows the email to readers like everyone else does', 'When readers who open the email elsewhere open it far less on Gmail, Gmail is filing it away; the people still want it.')
on conflict (name) do update set title = excluded.title, why = excluded.why;

-- ------------------------------------------------------------------------------------------------------------ grants
do $$ declare f text; begin
  foreach f in array array['hx_admin_items(text)','hx_admin_summary()','hx_admin_item_not_problem(bigint,text)','hx_admin_logged()','hx_admin_logged_list(text)',
    'hx_admin_builds(text)','hx_admin_build_save(jsonb)','hx_admin_build_done(bigint,text)','hx_admin_build_remove(bigint,boolean)',
    'hx_admin_expects()','hx_admin_expect_save(jsonb)','hx_admin_expect_remove(bigint,boolean)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
  foreach f in array array['_hx_signal(text,text,text,text,text)','_hx_open_item(text,text,text,text,bigint,text)','_hx_close_item(bigint,text,text)',
    '_hx_standing(text,text,text,boolean,text)','hx_ck_email_auth_refused()','hx_plant_email_auth_refused()','hx_ck_email_gmail_gap()','hx_plant_email_gmail_gap()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
end $$;

-- every 10 minutes
select cron.schedule('hx-watch', '*/10 * * * *', $c$select public.hx_watch()$c$);
