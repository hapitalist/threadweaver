-- Thread Weaver Data Harness (17 Nov 2026), part 3: checks on Thread Weaver's own numbers, each with Prove it.
-- Hapitalist's health board + Command Center's checks.ts, for what Thread Weaver actually has. Each check is two functions:
--   hx_ck_<name>()     the problems it finds now (a JSON list of plain sentences; empty = fine)
--   hx_plant_<name>()  one fault of its kind, planted for Prove it
-- hx_prove(name) plants the fault inside a piece of a transaction that is always rolled back, runs the check, and the check
-- must find more than it found before. Nothing planted ever stays. hx_run_checks() runs every check (hourly), opens one
-- item per red check and closes it with proof when the check is green again. hx_prove_all() runs at 5 am PT.
-- What the database already refuses (a purchase of a bundle that does not exist, a purchase for no account) is not checked.

create or replace function public.hx_ck_auth_null_fields() returns jsonb language sql stable security definer set search_path = public, auth as $$
  -- the sign-in service cannot read a NULL in these and answers 500 to that person (Thread Weaver's August sign-in outage kind)
  select coalesce(jsonb_agg(left(email,3) || '...' || split_part(email,'@',2) || ' has an empty sign-in field the sign-in service cannot read; that person gets an error at sign-in') , '[]')
    from (select email from auth.users where confirmation_token is null or recovery_token is null or email_change_token_new is null or email_change is null limit 20) u $$;
create or replace function public.hx_plant_auth_null_fields() returns void language sql security definer set search_path = public, auth as $$
  insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hx-plant-' || md5(random()::text) || '@test.invalid', '', now(), now(), null, '', '', '') $$;

create or replace function public.hx_ck_iap_not_unlocked() returns jsonb language sql stable security definer set search_path = public as $$
  -- paid on an iPhone, and what they paid for is not unlocked for them
  select coalesce(jsonb_agg('An App Store purchase of ' || coalesce(r.bundle, r.product_id) || ' (' || to_char(r.created_at, 'Mon DD') || ') did not unlock it for that reader'), '[]')
    from (select r.* from apple_iap_receipts r
           where r.revoked_at is null and r.user_id is not null and r.bundle is not null
             and not exists (select 1 from purchases p where p.user_id = r.user_id and (p.bundle = r.bundle or p.bundle = 'unlock_all')) limit 20) r $$;
create or replace function public.hx_plant_iap_not_unlocked() returns void language sql security definer set search_path = public as $$
  insert into apple_iap_receipts(original_transaction_id, transaction_id, product_id, bundle, user_id, environment)
  select 'hx-plant-' || md5(random()::text), 'hx-plant', 'com.russellnohelty.threadweaver.all_games1', 'all_games', u.id, 'Sandbox'
    from auth.users u where not exists (select 1 from purchases p where p.user_id = u.id and p.bundle in ('all_games','unlock_all')) limit 1 $$;

create or replace function public.hx_ck_serial_no_chapters() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg('A reader follows the serial "' || serial_id || '", which has no chapters, so nothing will ever arrive'), '[]')
    from (select distinct f.serial_id from serial_follows f where not exists (select 1 from serial_chapter_index c where c.book_id = f.serial_id) limit 20) x $$;
create or replace function public.hx_plant_serial_no_chapters() returns void language sql security definer set search_path = public as $$
  insert into serial_follows(user_id, serial_id, start_index, started_on, weekday) select id, 'hx-plant-no-such-book', 0, current_date, 1 from auth.users limit 1 $$;

create or replace function public.hx_ck_chapter_buy_unknown() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg('A paid chapter of "' || serial_id || '" (' || to_char(created_at, 'Mon DD') || ') is for a serial with no chapters'), '[]')
    from (select * from serial_chapter_purchases p where p.revoked_at is null and not exists (select 1 from serial_chapter_index c where c.book_id = p.serial_id) limit 20) x $$;
create or replace function public.hx_plant_chapter_buy_unknown() returns void language sql security definer set search_path = public as $$
  insert into serial_chapter_purchases(user_id, serial_id, source, ref, amount_cents) select id, 'hx-plant-no-such-book', 'comp', 'hx-plant-' || md5(random()::text), 100 from auth.users limit 1 $$;

create or replace function public.hx_ck_book_file_missing() returns jsonb language sql stable security definer set search_path = public as $$
  -- a paid book or comic in the catalog with no file in the library bucket: it will not open for the person who bought it
  select coalesce(jsonb_agg(path || ' is in the paid library but its file is not in storage; it will not open'), '[]')
    from (select f.path from lib_files f where not exists (select 1 from storage.objects o where o.bucket_id = 'library' and o.name = f.path) limit 20) x $$;
create or replace function public.hx_plant_book_file_missing() returns void language sql security definer set search_path = public as $$
  insert into lib_files(path, bundle) values ('books/hx-plant-' || md5(random()::text) || '.epub', 'unlock_all') $$;

create or replace function public.hx_ck_list_outsiders() returns jsonb language sql stable security definer set search_path = public as $$
  -- only Substack readers (and the Wannabe Press readers the Hapitalist app hands over) are on the list; never a test person
  select coalesce(jsonb_agg(left(email,3) || '...' || split_part(email,'@',2) || ' is on the list from "' || coalesce(source,'nowhere') || '"'), '[]')
    from (select * from nl_subscribers where status = 'subscribed' and (coalesce(source,'') not in ('substack','hapitalist-app') or email like '%@test.invalid') limit 20) x $$;
create or replace function public.hx_plant_list_outsiders() returns void language sql security definer set search_path = public as $$
  insert into nl_subscribers(email, status, source) values ('hx-plant-' || md5(random()::text) || '@test.invalid', 'subscribed', 'harness') $$;

create or replace function public.hx_ck_suppressed_on_list() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(left(s.email,3) || '...' || split_part(s.email,'@',2) || ' bounced or complained (' || e.reason || ') and is still marked subscribed'), '[]')
    from (select * from nl_subscribers s where s.status = 'subscribed' limit 100000) s join email_suppression e on lower(e.email) = s.email $$;
create or replace function public.hx_plant_suppressed_on_list() returns void language sql security definer set search_path = public as $$
  with a as (select email from nl_subscribers where status = 'subscribed' and email not in (select lower(email) from email_suppression) limit 1)
  insert into email_suppression(email, reason) select email, 'bounce' from a $$;

create or replace function public.hx_ck_jobs_failed() returns jsonb language sql stable security definer set search_path = public, cron as $$
  select coalesce(jsonb_agg(coalesce(j.jobname, 'job ' || d.jobid) || ' failed ' || d.n || ' time(s) in the last day: ' || left(coalesce(d.msg,''), 160)), '[]')
    from (select jobid, count(*) n, max(return_message) msg from cron.job_run_details where status = 'failed' and start_time > now() - interval '1 day' group by jobid) d
    left join cron.job j on j.jobid = d.jobid $$;
create or replace function public.hx_plant_jobs_failed() returns void language sql security definer set search_path = public, cron as $$
  insert into cron.job_run_details(jobid, runid, status, return_message, start_time, end_time)
  select jobid, (select coalesce(max(runid),0) + 1 from cron.job_run_details), 'failed', 'planted by Prove it', now(), now() from cron.job order by jobid limit 1 $$;

create or replace function public.hx_ck_jobs_silent() returns jsonb language sql stable security definer set search_path = public, cron as $$
  -- a scheduled job that has not run when it should have (every minute -> 10 minutes; hourly-ish -> 2 hours; daily -> 26 hours)
  select coalesce(jsonb_agg(j.jobname || ' has not run since ' || coalesce(to_char(l.last at time zone 'America/Los_Angeles', 'Mon DD HH12:MI am') || ' PT', 'it was made')), '[]')
    from cron.job j left join lateral (select max(start_time) last from cron.job_run_details d where d.jobid = j.jobid) l on true
   where j.active and coalesce(l.last, '-infinity') < now() - case
     when split_part(j.schedule,' ',1) in ('*','*/1') and split_part(j.schedule,' ',2) = '*' then interval '10 minutes'
     when split_part(j.schedule,' ',2) = '*' then interval '2 hours'
     else interval '26 hours' end $$;
create or replace function public.hx_plant_jobs_silent() returns void language sql security definer set search_path = public, cron as $$
  update cron.job_run_details set start_time = start_time - interval '1 day' where jobid = (select jobid from cron.job where jobname = 'tw-nl-flow-tick') and start_time > now() - interval '1 day' $$;

create or replace function public.hx_ck_calls_failing() returns jsonb language sql stable security definer set search_path = public, net as $$
  -- the scheduled calls to Thread Weaver's own functions (serial emails, member sync, refunds, sequences, the Wannabe sync)
  select case when count(*) >= 3 then jsonb_build_array(count(*) || ' scheduled calls to Thread Weaver''s functions failed in the last 6 hours (latest: ' ||
           coalesce(max(status_code)::text, 'no answer') || ' ' || left(coalesce(max(error_msg), ''), 120) || ')') else '[]'::jsonb end
    from net._http_response where created > now() - interval '6 hours' and (status_code >= 500 or (status_code is null and (error_msg is not null or timed_out))) $$;
create or replace function public.hx_plant_calls_failing() returns void language sql security definer set search_path = public, net as $$
  insert into net._http_response(id, status_code, content, created) select -1000 - g, 503, 'planted by Prove it', now() from generate_series(1,3) g $$;

create or replace function public.hx_ck_member_sync_stale() returns jsonb language sql stable security definer set search_path = public as $$
  -- paying Hapitalist members get Unlock Everything from the hourly hapi-member-sync
  select case when coalesce(max(synced_at), '-infinity') < now() - interval '3 hours'
    then jsonb_build_array('Hapitalist members'' Unlock Everything has not refreshed since ' || coalesce(to_char(max(synced_at) at time zone 'America/Los_Angeles', 'Mon DD HH12:MI am') || ' PT', 'ever'))
    else '[]'::jsonb end from hapi_members $$;
create or replace function public.hx_plant_member_sync_stale() returns void language sql security definer set search_path = public as $$
  update hapi_members set synced_at = now() - interval '2 days' $$;

create or replace function public.hx_ck_sign_in_emails() returns jsonb language sql stable security definer set search_path = public as $$
  select case when count(*) >= 3 then jsonb_build_array(count(*) || ' sign-up / sign-in / reset emails failed to send in the last day (latest: ' || left(coalesce(max(detail),''), 140) || ')') else '[]'::jsonb end
    from auth_email_log where not ok and sent_at > now() - interval '1 day' $$;
create or replace function public.hx_plant_sign_in_emails() returns void language sql security definer set search_path = public as $$
  insert into auth_email_log(email, kind, sent_at, ok, detail) select 'hx-plant@test.invalid', 'signin', now(), false, 'planted by Prove it' from generate_series(1,3) $$;

create or replace function public.hx_ck_walks_stale() returns jsonb language sql stable security definer set search_path = public as $$
  select case when coalesce(max(started_at), '-infinity') < now() - interval '26 hours'
    then jsonb_build_array('No walk has run since ' || coalesce(to_char(max(started_at) at time zone 'America/Los_Angeles', 'Mon DD HH12:MI am') || ' PT', 'the harness was made') || '; nobody is looking at the pages')
    else '[]'::jsonb end from hx_runs $$;
create or replace function public.hx_plant_walks_stale() returns void language sql security definer set search_path = public as $$
  update hx_runs set started_at = started_at - interval '3 days' where started_at > now() - interval '3 days' $$;

create or replace function public.hx_ck_runs_unfinished() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg('The walk "' || name || '" on a ' || device || ' started ' || to_char(started_at at time zone 'America/Los_Angeles', 'Mon DD HH12:MI am') || ' PT and never finished'), '[]')
    from (select * from hx_runs where finished_at is null and started_at < now() - interval '2 hours' limit 20) r $$;
create or replace function public.hx_plant_runs_unfinished() returns void language sql security definer set search_path = public as $$
  insert into hx_runs(name, device, started_at, finished_at) values ('hx-plant', 'phone', now() - interval '3 hours', null) $$;

create or replace function public.hx_ck_selftest_stale() returns jsonb language sql stable security definer set search_path = public as $$
  -- the harness checking that it can still see: a self-test on a phone and on a laptop every day, and every planted break caught
  select coalesce(jsonb_agg(m), '[]') from (
    select 'The self-test has not run on a ' || d || ' since ' || coalesce(to_char(max(s.at) at time zone 'America/Los_Angeles', 'Mon DD') , 'ever') m
      from unnest(array['phone','laptop']) d left join hx_selftests s on s.device = d group by d having coalesce(max(s.at), '-infinity') < now() - interval '36 hours'
    union all
    select 'The last self-test on a ' || device || ' missed: ' || array_to_string(missed, ', ')
      from (select distinct on (device) * from hx_selftests order by device, at desc) l where not ok) x $$;
create or replace function public.hx_plant_selftest_stale() returns void language sql security definer set search_path = public as $$
  update hx_selftests set at = at - interval '3 days' $$;

create or replace function public.hx_ck_checks_stale() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg('The check "' || title || '" has not run since ' || coalesce(to_char(last_run at time zone 'America/Los_Angeles', 'Mon DD HH12:MI am') || ' PT', 'it was made')), '[]')
    from hx_checks where active and name <> 'checks_stale' and coalesce(last_run, '-infinity') < now() - interval '3 hours' $$;
create or replace function public.hx_plant_checks_stale() returns void language sql security definer set search_path = public as $$
  update hx_checks set last_run = now() - interval '1 day' where name <> 'checks_stale' $$;

create or replace function public.hx_ck_visitors_unread() returns jsonb language sql stable security definer set search_path = public as $$
  -- a result nobody reads: real visitors' errors that are on the board and have sat a week with nobody on them
  select coalesce(jsonb_agg('"' || left(title, 120) || '" has been open ' || extract(day from now() - opened_at)::int || ' days with nobody on it'), '[]')
    from (select * from hx_items where status = 'open' and source = 'visitor' and opened_at < now() - interval '7 days' and (claimed_by is null or claimed_until < now()) limit 20) i $$;
create or replace function public.hx_plant_visitors_unread() returns void language sql security definer set search_path = public as $$
  insert into hx_items(title, source, fp, opened_at) values ('hx-plant', 'visitor', 'hx-plant-' || md5(random()::text), now() - interval '9 days') $$;

-- the list of checks
insert into hx_checks(name, title, why) values
  ('auth_null_fields', 'Sign-in records the sign-in service can read', 'A NULL in an account''s token fields makes sign-in answer 500 for that person (the August 2026 outage).'),
  ('iap_not_unlocked', 'iPhone purchases unlock what was bought', 'An App Store receipt with no matching unlock is a reader who paid and got nothing.'),
  ('serial_no_chapters', 'Every followed serial has chapters', 'A follow of a book with no chapter index never sends anything.'),
  ('chapter_buy_unknown', 'Every $1 chapter bought is for a real serial', 'A paid chapter for a serial with no chapters is money for nothing.'),
  ('book_file_missing', 'Every paid book and comic has its file', 'A catalog entry whose file is not in the library bucket will not open for the person who bought it.'),
  ('list_outsiders', 'Only Substack readers are on the list', 'Russell: only the Wannabe Press Substack list counts (plus the readers the Hapitalist app hands over); never a test person.'),
  ('suppressed_on_list', 'Nobody who bounced or complained is still subscribed', 'Sending to them hurts wannabepress.com''s standing with Amazon SES.'),
  ('jobs_failed', 'Scheduled jobs did not fail', 'Serial emails, member sync, refunds, sequences, the Substack and Wannabe syncs.'),
  ('jobs_silent', 'Scheduled jobs ran when they should', 'A job that stopped running fails without an error.'),
  ('calls_failing', 'Scheduled calls to Thread Weaver''s functions answer', 'The jobs call edge functions; a 500 there is a job that did nothing.'),
  ('member_sync_stale', 'Hapitalist members'' Unlock Everything is fresh', 'hapi-member-sync runs hourly; stale means a new member is locked out.'),
  ('sign_in_emails', 'Sign-up, sign-in and reset emails send', 'A reader who never gets the email cannot get in.'),
  ('walks_stale', 'The walks ran in the last day', 'Nobody had to remember to look.'),
  ('runs_unfinished', 'Every walk that started finished', 'A walk that never finished proves nothing.'),
  ('selftest_stale', 'The harness can still see', 'The self-test plants one of every break; if it missed one, a clean walk proves less than it says.'),
  ('checks_stale', 'These checks are still running', 'The hourly job that runs them stopped.'),
  ('visitors_unread', 'Real visitors'' errors are being looked at', 'A result nobody reads is the same as no result.')
on conflict (name) do update set title = excluded.title, why = excluded.why;

-- run one check now; open / keep / close its item
create or replace function public.hx_run_check(p_name text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; c hx_checks; v_item bigint; r record;
begin
  select * into c from hx_checks where name = p_name;
  if not found then return jsonb_build_object('ok', false, 'reason', 'No such check'); end if;
  begin
    execute format('select public.hx_ck_%s()', p_name) into v;
  exception when others then
    v := jsonb_build_array('The check itself failed: ' || sqlerrm);
  end;
  update hx_checks set last_run = now(), last_ok = jsonb_array_length(v) = 0, last_problems = v where name = p_name;
  if jsonb_array_length(v) > 0 then
    v_item := _hx_open_item('check:' || p_name, 'check', 'Check red: ' || c.title,
      (select string_agg('- ' || x, E'\n') from (select jsonb_array_elements_text(v) x limit 20) q) || E'\n\nWhy it matters: ' || c.why, null, p_name);
  else
    for r in select id from hx_items where fp = 'check:' || p_name and status in ('open','fix_waiting') loop
      perform _hx_close_item(r.id, 'harness', 'The check "' || c.title || '" ran at ' || to_char(now() at time zone 'America/Los_Angeles', 'Mon DD HH12:MI am') || ' PT and found nothing.');
    end loop;
  end if;
  return jsonb_build_object('ok', jsonb_array_length(v) = 0, 'problems', v);
end $$;

create or replace function public.hx_run_checks() returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; red int := 0; v jsonb;
begin
  for r in select name from hx_checks where active order by name loop
    v := hx_run_check(r.name); n := n + 1; if not (v->>'ok')::boolean then red := red + 1; end if;
  end loop;
  update hx_schedule set last_at = now(), last_ok = true where name = 'checks';
  return jsonb_build_object('ran', n, 'red', red);
end $$;

-- Prove it: plant one fault of the check's kind in a part of a transaction that is always rolled back
create or replace function public.hx_prove(p_name text) returns jsonb language plpgsql security definer set search_path = public as $$
declare before_n int; after_n int; v jsonb; note text := null; ok boolean;
begin
  if not exists (select 1 from hx_checks where name = p_name) then return jsonb_build_object('ok', false, 'reason', 'No such check'); end if;
  begin
    execute format('select public.hx_ck_%s()', p_name) into v; before_n := jsonb_array_length(v);
    execute format('select public.hx_plant_%s()', p_name);
    execute format('select public.hx_ck_%s()', p_name) into v; after_n := jsonb_array_length(v);
    raise exception 'hx_rollback';
  exception when others then
    if sqlerrm <> 'hx_rollback' then note := 'The fault could not be planted: ' || sqlerrm; end if;
  end;
  ok := note is null and after_n > before_n;
  if note is null and not ok then note := 'A fault was planted and the check did not see it.'; end if;
  if ok then note := 'A fault was planted in a copy that was thrown away; the check saw it (' || coalesce(v->>0, '') || ').'; end if;
  update hx_checks set proved_at = now(), prove_ok = ok, prove_note = left(note, 600) where name = p_name;
  if not ok then
    perform _hx_open_item('prove:' || p_name, 'check', 'A check cannot prove itself: ' || (select title from hx_checks where name = p_name), note, null, p_name);
  else
    perform _hx_close_item(id, 'harness', note) from hx_items where fp = 'prove:' || p_name and status in ('open','fix_waiting');
  end if;
  return jsonb_build_object('ok', ok, 'note', note);
end $$;

create or replace function public.hx_prove_all() returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; bad int := 0; v jsonb;
begin
  for r in select name from hx_checks where active order by name loop v := hx_prove(r.name); n := n + 1; if not (v->>'ok')::boolean then bad := bad + 1; end if; end loop;
  update hx_schedule set last_at = now(), last_ok = bad = 0 where name = 'prove';
  return jsonb_build_object('proved', n, 'failed', bad);
end $$;

-- the admin page's calls for checks
create or replace function public.hx_admin_checks() returns jsonb language plpgsql security definer set search_path = public as $$
begin perform _hx_admin(); return coalesce((select jsonb_agg(row_to_json(c) order by c.last_ok nulls first, c.title) from hx_checks c where active), '[]'); end $$;
create or replace function public.hx_admin_check_run(p_name text) returns jsonb language plpgsql security definer set search_path = public as $$
begin perform _hx_admin(); return hx_run_check(p_name); end $$;
create or replace function public.hx_admin_check_prove(p_name text) returns jsonb language plpgsql security definer set search_path = public as $$
begin perform _hx_admin(); return hx_prove(p_name); end $$;

-- house-keeping: clearing raw reports older than 30 days is NOT set up. It needs a delete that the Supabase connector asks
-- the owner to confirm, and that question does not reach Russell. Until it is run from the Supabase SQL editor, raw reports
-- stay (the flood guard in hx_report keeps at most 600 a minute and 30 an hour of any one finding).

do $$ declare r record; begin
  for r in select p.oid::regprocedure sig from pg_proc p where p.pronamespace = 'public'::regnamespace
            and (p.proname like 'hx\_ck\_%' or p.proname like 'hx\_plant\_%' or p.proname in ('hx_run_check','hx_run_checks','hx_prove','hx_prove_all')) loop
    execute 'revoke all on function ' || r.sig || ' from public, anon, authenticated';
  end loop;
end $$;
revoke all on function public.hx_admin_checks() from public, anon; grant execute on function public.hx_admin_checks() to authenticated;
revoke all on function public.hx_admin_check_run(text) from public, anon; grant execute on function public.hx_admin_check_run(text) to authenticated;
revoke all on function public.hx_admin_check_prove(text) from public, anon; grant execute on function public.hx_admin_check_prove(text) to authenticated;

-- Runs by itself
insert into hx_schedule(name, what, runs, place) values
  ('checks', 'Every check on Thread Weaver''s numbers; a red one goes on What needs doing, a green one closes its item', 'Every hour, at :41', 'database (cron hx-checks)'),
  ('prove', 'Prove it for every check: a fault planted in a copy that is thrown away, the check must see it', '5:13 am PT every day', 'database (cron hx-prove)'),
  ('walks', 'Every page signed out and signed in, every button, every game, every free book and comic, the serial page, the admin pages kept locked, and the self-test - on a phone and a laptop', '2:17 am PT every day, after every change pushed to the site, and when a run is asked for', 'GitHub (workflow data-harness.yml)'),
  ('look_again', 'Every open item a walk found is walked again at its exact step, on the devices it was seen on', 'With the nightly walk', 'GitHub (workflow data-harness.yml)')
on conflict (name) do update set what = excluded.what, runs = excluded.runs, place = excluded.place;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('hx-checks','hx-prove');
  perform cron.schedule('hx-checks', '41 * * * *', 'select public.hx_run_checks();');
  perform cron.schedule('hx-prove', '13 13 * * *', 'select public.hx_prove_all();');
end $$;

-- ------------------------------------------------------------------------------------------- after the first run (17 Nov)
-- The first run of every check found "dragon-strife" followed and a $1 chapter of it bought, with "no chapters": wrong -
-- a serial is a book (indexed as v3:<book id>) or one of the five series (serials.js SERIES_IDS). The two checks now know that.
-- jobs_silent said hx-checks and hx-prove "have not run since they were made" an hour after they were made: a job is now
-- timed from when the harness first saw it (hx_job_seen). Prove it on a check that is already red cannot show a second
-- fault in a one-line check; it is proved again once it is green, and no item is opened for that.
create table if not exists public.hx_job_seen (jobname text primary key, first_seen timestamptz not null default now());
alter table public.hx_job_seen enable row level security;
revoke all on public.hx_job_seen from anon, authenticated;

create or replace function public._hx_serial_ok(p_id text) returns boolean language sql stable security definer set search_path = public as $$
  select p_id in ('godsverse','obsidian-spindle','dragon-strife','quest-girls','wonderland')
      or exists (select 1 from serial_chapter_index c where c.book_id = 'v3:' || p_id or c.book_id = p_id) $$;
create or replace function public.hx_ck_serial_no_chapters() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg('A reader follows the serial "' || serial_id || '", which is not a book or series with chapters, so nothing will ever arrive'), '[]')
    from (select distinct f.serial_id from serial_follows f where not _hx_serial_ok(f.serial_id) limit 20) x $$;
create or replace function public.hx_ck_chapter_buy_unknown() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg('A paid chapter of "' || serial_id || '" (' || to_char(created_at, 'Mon DD') || ') is for a serial with no chapters'), '[]')
    from (select * from serial_chapter_purchases p where p.revoked_at is null and not _hx_serial_ok(p.serial_id) limit 20) x $$;

create or replace function public.hx_ck_jobs_silent() returns jsonb language plpgsql security definer set search_path = public, cron as $$
declare v jsonb;
begin
  insert into hx_job_seen(jobname) select jobname from cron.job where jobname is not null on conflict do nothing;
  select coalesce(jsonb_agg(j.jobname || ' has not run since ' || coalesce(to_char(l.last at time zone 'America/Los_Angeles', 'Mon DD HH12:MI am') || ' PT', 'it was made')), '[]') into v
    from cron.job j join hx_job_seen s on s.jobname = j.jobname
    left join lateral (select max(start_time) last from cron.job_run_details d where d.jobid = j.jobid) l on true
   where j.active and greatest(coalesce(l.last, '-infinity'), s.first_seen) < now() - case
     when split_part(j.schedule,' ',1) in ('*','*/1') and split_part(j.schedule,' ',2) = '*' then interval '10 minutes'
     when split_part(j.schedule,' ',2) = '*' then interval '2 hours'
     else interval '26 hours' end;
  return v;
end $$;
create or replace function public.hx_plant_jobs_silent() returns void language sql security definer set search_path = public, cron as $$
  update hx_job_seen set first_seen = now() - interval '3 days' where jobname = 'tw-nl-flow-tick';
  update cron.job_run_details set start_time = start_time - interval '1 day' where jobid = (select jobid from cron.job where jobname = 'tw-nl-flow-tick') and start_time > now() - interval '1 day' $$;

create or replace function public.hx_prove(p_name text) returns jsonb language plpgsql security definer set search_path = public as $$
declare before_n int; after_n int; v jsonb; v0 jsonb; note text := null; ok boolean;
begin
  if not exists (select 1 from hx_checks where name = p_name) then return jsonb_build_object('ok', false, 'reason', 'No such check'); end if;
  begin
    execute format('select public.hx_ck_%s()', p_name) into v0; before_n := jsonb_array_length(v0);
    execute format('select public.hx_plant_%s()', p_name);
    execute format('select public.hx_ck_%s()', p_name) into v; after_n := jsonb_array_length(v);
    raise exception 'hx_rollback';
  exception when others then
    if sqlerrm <> 'hx_rollback' then note := 'The fault could not be planted: ' || sqlerrm; end if;
  end;
  if note is null and after_n <= before_n and before_n > 0 and v is distinct from v0 then
    ok := true; note := 'Already red; with a fault planted it said something new (' || coalesce(v->>0,'') || ').';
  elsif note is null and after_n <= before_n and before_n > 0 then
    update hx_checks set proved_at = now(), prove_ok = null, prove_note = 'It is red right now, so a planted fault cannot be told apart from what it already sees. It is proved again once it is green.' where name = p_name;
    return jsonb_build_object('ok', null, 'note', 'already red');
  else
    ok := note is null and after_n > before_n;
    if note is null and not ok then note := 'A fault was planted and the check did not see it.'; end if;
    if ok then note := 'A fault was planted in a copy that was thrown away; the check saw it (' || coalesce(v->>0, '') || ').'; end if;
  end if;
  update hx_checks set proved_at = now(), prove_ok = ok, prove_note = left(note, 600) where name = p_name;
  if not ok then
    perform _hx_open_item('prove:' || p_name, 'check', 'A check cannot prove itself: ' || (select title from hx_checks where name = p_name), note, null, p_name);
  else
    perform _hx_close_item(id, 'harness', note) from hx_items where fp = 'prove:' || p_name and status in ('open','fix_waiting');
  end if;
  return jsonb_build_object('ok', ok, 'note', note);
end $$;
create or replace function public.hx_prove_all() returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; bad int := 0; v jsonb;
begin
  for r in select name from hx_checks where active order by name loop v := hx_prove(r.name); n := n + 1; if (v->>'ok')::boolean is false then bad := bad + 1; end if; end loop;
  update hx_schedule set last_at = now(), last_ok = bad = 0 where name = 'prove';
  return jsonb_build_object('proved', n, 'failed', bad);
end $$;
revoke all on function public.hx_ck_jobs_silent() from public, anon, authenticated;
revoke all on function public.hx_plant_jobs_silent() from public, anon, authenticated;
revoke all on function public._hx_serial_ok(text) from public, anon, authenticated;
revoke all on function public.hx_prove(text) from public, anon, authenticated;
revoke all on function public.hx_prove_all() from public, anon, authenticated;
