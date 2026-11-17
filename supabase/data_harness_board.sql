-- Thread Weaver Data Harness (17 Nov 2026), part 2: the admin page's calls (/admin/harness.html). Every one checks
-- is_tw_admin() itself; the page's own gate is for clarity, not the lock.
--
-- The board's rules, from Hapitalist's work board and Command Center 1.6.0:
--  - a helper who takes an item holds it for two hours; another helper is refused while it is held
--  - nobody takes an item whose fix is waiting for the owner's OK, or one that is closed (16 Nov: two helpers redid one fix)
--  - Done needs proof: an item from a walk or a check closes by itself when the walk of that step / the check passes after it
--    was opened (Done by hand is refused until then); an item with no test takes the owner's own words as the proof
--  - nothing is really deleted: Remove puts it under Removed, with Put it back

create or replace function public._hx_admin() returns void language plpgsql stable security definer set search_path = public as $$
begin if not is_tw_admin() then raise exception 'Only the Thread Weaver admin accounts can do that.'; end if; end $$;

create or replace function public._hx_who() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select email from auth.users where id = auth.uid()), 'admin') $$;

-- the top line and the counts on each tab
create or replace function public.hx_admin_summary() returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform _hx_admin();
  select jsonb_build_object(
    'open', (select count(*) from hx_items where status = 'open'),
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

create or replace function public.hx_admin_items(p_status text default 'open') returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  return coalesce((select jsonb_agg(row_to_json(i) order by (i.status = 'fix_waiting') desc, i.opened_at desc) from (
    select it.*, t.name test_name, f.page, f.step, f.kind, f.times, f.seen_devices, f.clean_devices, f.shot, f.trail, f.sources,
           (it.claimed_by is not null and it.claimed_until > now()) as held
      from hx_items it left join hx_tests t on t.id = it.test_id left join hx_findings f on f.fp = it.fp
     where case p_status when 'open' then it.status in ('open','fix_waiting') when 'done' then it.status = 'done' and it.closed_at > now() - interval '30 days'
                         when 'removed' then it.status = 'removed' else true end
     order by it.opened_at desc limit 400) i), '[]');
end $$;

create or replace function public.hx_admin_item_add(p_title text, p_detail text, p_who_told text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  perform _hx_admin();
  if coalesce(trim(p_title),'') = '' then return jsonb_build_object('ok', false, 'reason', 'Say what is wrong in a few words.'); end if;
  insert into hx_items(title, detail, source, opened_by, who_told, fp) values (left(trim(p_title),300), coalesce(p_detail,''), 'admin', _hx_who(), nullif(trim(coalesce(p_who_told,'')),''), 'admin:' || md5(random()::text))
  returning id into v;
  return jsonb_build_object('ok', true, 'id', v);
end $$;

create or replace function public.hx_admin_item_change(p_id bigint, p_title text, p_detail text, p_who_told text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  update hx_items set title = coalesce(nullif(trim(p_title),''), title), detail = coalesce(p_detail, detail), who_told = nullif(trim(coalesce(p_who_told, who_told, '')),''), updated_at = now()
   where id = p_id;
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.hx_admin_item_note(p_id bigint, p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  if coalesce(trim(p_note),'') = '' then return jsonb_build_object('ok', false, 'reason', 'Write the note first.'); end if;
  update hx_items set notes = notes || jsonb_build_array(jsonb_build_object('at', now(), 'by', _hx_who(), 'note', left(p_note, 2000))), updated_at = now() where id = p_id;
  return jsonb_build_object('ok', found);
end $$;

-- a helper (a person or an AI session) takes an item: held two hours; refused when someone else holds it, when its fix is
-- waiting for the OK, or when it is closed
create or replace function public.hx_admin_item_claim(p_id bigint, p_who text) returns jsonb language plpgsql security definer set search_path = public as $$
declare i hx_items; w text := coalesce(nullif(trim(p_who),''), _hx_who());
begin
  perform _hx_admin();
  select * into i from hx_items where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'There is no such item.'); end if;
  if i.status = 'fix_waiting' then return jsonb_build_object('ok', false, 'reason', 'Its fix is already waiting for the OK. Nobody else takes it.'); end if;
  if i.status in ('done','removed') then return jsonb_build_object('ok', false, 'reason', 'It is closed.'); end if;
  if i.claimed_by is not null and i.claimed_until > now() and i.claimed_by <> w then
    return jsonb_build_object('ok', false, 'reason', i.claimed_by || ' is on it until ' || to_char(i.claimed_until at time zone 'America/Los_Angeles', 'HH12:MI am') || ' PT.');
  end if;
  update hx_items set claimed_by = w, claimed_until = now() + interval '2 hours', updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'until', now() + interval '2 hours');
end $$;

create or replace function public.hx_admin_item_release(p_id bigint) returns jsonb language plpgsql security definer set search_path = public as $$
begin perform _hx_admin(); update hx_items set claimed_by = null, claimed_until = null, updated_at = now() where id = p_id; return jsonb_build_object('ok', found); end $$;

-- the fix is in and waits for the owner's OK (and the walk that proves it)
create or replace function public.hx_admin_item_fix(p_id bigint, p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  if coalesce(trim(p_note),'') = '' then return jsonb_build_object('ok', false, 'reason', 'Say what the fix was.'); end if;
  update hx_items set status = 'fix_waiting', fix_note = left(p_note, 2000), fix_at = now(), claimed_by = null, claimed_until = null, updated_at = now()
   where id = p_id and status = 'open';
  if not found then return jsonb_build_object('ok', false, 'reason', 'Only an open item can have a fix waiting.'); end if;
  -- ask the walker to look at it again
  insert into hx_run_requests(test_id, item_id, requested_by) select test_id, id, _hx_who() from hx_items where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Done by hand. An item a walk or a check found is closed by that walk or check passing - so Done is refused until then.
-- An item with no test takes the owner's own proof.
create or replace function public.hx_admin_item_done(p_id bigint, p_proof text) returns jsonb language plpgsql security definer set search_path = public as $$
declare i hx_items; f hx_findings; c hx_checks;
begin
  perform _hx_admin();
  select * into i from hx_items where id = p_id;
  if not found or i.status not in ('open','fix_waiting') then return jsonb_build_object('ok', false, 'reason', 'Only an open item can be closed.'); end if;
  if i.source in ('walk','visitor','selftest') then
    select * into f from hx_findings where fp = i.fp;
    if found and not ((case when 'visitor' = any(f.sources) then array['phone','laptop'] || f.seen_devices else f.seen_devices end) <@ f.clean_devices and f.clean_at > i.opened_at) then
      return jsonb_build_object('ok', false, 'reason', 'A walk has not passed this step since it was opened (seen on ' || array_to_string(f.seen_devices, ', ') ||
        case when cardinality(f.clean_devices) > 0 then '; clean so far on ' || array_to_string(f.clean_devices, ', ') else '' end ||
        '). Press "Check it again now", or wait for tonight''s walk. It closes by itself when it passes.');
    end if;
    if not found and i.test_id is not null and not exists (select 1 from hx_runs where test_id = i.test_id and passed and started_at > i.opened_at) then
      return jsonb_build_object('ok', false, 'reason', 'Its walk has not passed since it was opened.');
    end if;
  elsif i.source = 'check' then
    select * into c from hx_checks where name = i.check_name;
    if found and not (c.last_ok and c.last_run > i.opened_at) then
      return jsonb_build_object('ok', false, 'reason', 'The check "' || c.title || '" still finds it. Press "Run the check now" after the fix.');
    end if;
  elsif coalesce(trim(p_proof),'') = '' then
    return jsonb_build_object('ok', false, 'reason', 'This one has no test, so say what you saw that shows it is fixed.');
  end if;
  perform _hx_close_item(p_id, _hx_who(), coalesce(nullif(trim(p_proof),''), 'Closed by ' || _hx_who() || ' after its test passed.'));
  return jsonb_build_object('ok', true, 'who_told', i.who_told);
end $$;

create or replace function public.hx_admin_item_remove(p_id bigint) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  update hx_items set removed_from = status, status = 'removed', removed_at = now(), claimed_by = null, claimed_until = null, updated_at = now() where id = p_id and status <> 'removed';
  return jsonb_build_object('ok', found);
end $$;
create or replace function public.hx_admin_item_putback(p_id bigint) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  if exists (select 1 from hx_items a join hx_items b on a.fp = b.fp where a.id = p_id and b.id <> p_id and b.status in ('open','fix_waiting')) then
    return jsonb_build_object('ok', false, 'reason', 'The same thing is already open on What needs doing.');
  end if;
  update hx_items set status = coalesce(removed_from, 'open'), removed_at = null, updated_at = now() where id = p_id and status = 'removed';
  return jsonb_build_object('ok', found);
end $$;

-- ask the walker to look again now (the GitHub workflow picks it up on its next pass; a walk run by hand does too)
create or replace function public.hx_admin_request(p_test bigint, p_item bigint) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  if exists (select 1 from hx_run_requests where status in ('queued','claimed') and coalesce(test_id,0) = coalesce(p_test,0) and coalesce(item_id,0) = coalesce(p_item,0)) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  insert into hx_run_requests(test_id, item_id, requested_by) values (p_test, p_item, _hx_who());
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.hx_admin_tests(p_removed boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  return coalesce((select jsonb_agg(row_to_json(t) order by t.kind, t.name) from (
    select t.*, (select count(*) from hx_runs r where r.test_id = t.id) runs,
           (select count(*) from hx_items i where i.test_id = t.id and i.status in ('open','fix_waiting')) open_items
      from hx_tests t where (t.removed_at is not null) = p_removed) t), '[]');
end $$;

create or replace function public.hx_admin_test_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v bigint; s jsonb := coalesce(p->'steps','[]'); x jsonb;
begin
  perform _hx_admin();
  if coalesce(trim(p->>'name'),'') = '' then return jsonb_build_object('ok', false, 'reason', 'Give the test a name.'); end if;
  if jsonb_typeof(s) <> 'array' or jsonb_array_length(s) = 0 then return jsonb_build_object('ok', false, 'reason', 'A test needs at least one step.'); end if;
  for x in select * from jsonb_array_elements(s) loop
    if coalesce(x->>'do','') not in ('goto','tap','type','see','not_see','url','wait','sweep','buttons','play','read') then
      return jsonb_build_object('ok', false, 'reason', 'Unknown step: ' || coalesce(x->>'do','(none)'));
    end if;
  end loop;
  if (p->>'id') is not null then
    update hx_tests set name = trim(p->>'name'), persona = coalesce(p->>'persona', persona), devices = coalesce(array(select jsonb_array_elements_text(p->'devices')), devices),
           steps = s, note = p->>'note', active = coalesce((p->>'active')::boolean, active) where id = (p->>'id')::bigint returning id into v;
  else
    insert into hx_tests(name, kind, persona, devices, steps, note, source, created_by)
    values (trim(p->>'name'), 'route', coalesce(p->>'persona','stranger'), coalesce(array(select jsonb_array_elements_text(p->'devices')), '{phone,laptop}'), s, p->>'note', 'admin', _hx_who())
    returning id into v;
  end if;
  return jsonb_build_object('ok', v is not null, 'id', v);
exception when unique_violation then return jsonb_build_object('ok', false, 'reason', 'There is already a test with that name.');
end $$;

create or replace function public.hx_admin_test_remove(p_id bigint, p_back boolean) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  update hx_tests set removed_at = case when p_back then null else now() end, active = p_back where id = p_id;
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.hx_admin_runs(p_test bigint default null, p_limit int default 100) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  return coalesce((select jsonb_agg(row_to_json(r) order by r.started_at desc) from (
    select id, test_id, name, kind, device, persona, trigger, started_at, finished_at, passed, summary, findings, gh_run, ended_how
      from hx_runs where p_test is null or test_id = p_test order by started_at desc limit least(greatest(p_limit,1), 500)) r), '[]');
end $$;

create or replace function public.hx_admin_run(p_id bigint) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  return jsonb_build_object('run', (select row_to_json(r) from hx_runs r where id = p_id),
    'steps', coalesce((select jsonb_agg(row_to_json(s) order by s.n) from hx_run_steps s where run_id = p_id), '[]'));
end $$;

-- the bug report: what visitors and walks saw, grouped
create or replace function public.hx_admin_findings(p_source text default 'visitor', p_days int default 30) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  return coalesce((select jsonb_agg(row_to_json(f) order by f.last_seen desc) from (
    select f.*, i.status item_status from hx_findings f left join hx_items i on i.id = f.item_id
     where (p_source = 'all' or p_source = any(f.sources)) and not f.planted and f.last_seen > now() - make_interval(days => greatest(p_days,1))
     order by f.last_seen desc limit 400) f), '[]');
end $$;

create or replace function public.hx_admin_reports(p_fp text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  return coalesce((select jsonb_agg(row_to_json(r) order by r.at desc) from (
    select at, kind, page, step, message, device, browser, build, harness, trail, extra from hx_reports where fp = p_fp order by at desc limit 50) r), '[]');
end $$;

create or replace function public.hx_admin_schedule() returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _hx_admin();
  return jsonb_build_object('jobs', coalesce((select jsonb_agg(row_to_json(s) order by s.name) from hx_schedule s), '[]'),
    'requests', coalesce((select jsonb_agg(row_to_json(q) order by q.requested_at desc) from (
       select r.*, t.name test_name, i.title item_title from hx_run_requests r left join hx_tests t on t.id = r.test_id left join hx_items i on i.id = r.item_id
        order by r.requested_at desc limit 30) q), '[]'),
    'selftests', coalesce((select jsonb_agg(row_to_json(s) order by s.at desc) from (select * from hx_selftests order by at desc limit 20) s), '[]'));
end $$;

do $$ declare f text; begin
  foreach f in array array['hx_admin_summary()','hx_admin_items(text)','hx_admin_item_add(text,text,text)','hx_admin_item_change(bigint,text,text,text)',
    'hx_admin_item_note(bigint,text)','hx_admin_item_claim(bigint,text)','hx_admin_item_release(bigint)','hx_admin_item_fix(bigint,text)','hx_admin_item_done(bigint,text)',
    'hx_admin_item_remove(bigint)','hx_admin_item_putback(bigint)','hx_admin_request(bigint,bigint)','hx_admin_tests(boolean)','hx_admin_test_save(jsonb)',
    'hx_admin_test_remove(bigint,boolean)','hx_admin_runs(bigint,int)','hx_admin_run(bigint)','hx_admin_findings(text,int)','hx_admin_reports(text)','hx_admin_schedule()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
  foreach f in array array['_hx_admin()','_hx_who()','_hx_open_item(text,text,text,text,bigint,text)','_hx_close_item(bigint,text,text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
end $$;
