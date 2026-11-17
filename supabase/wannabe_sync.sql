-- Wannabe Press readers from the Hapitalist app (16 Nov 2026, jk44 for Hapitalist item 81201).
-- Russell, 16 Nov 2026 3:41 pm PT: "All the wannabe readers should be on thread weaver, just like the Hapitalist ones, and if
-- they are on both they should be on both."
-- This project's nl_subscribers is the Wannabe Press list. The Hapitalist app still takes Wannabe Press signups (its
-- /wannabe-press page, fiction-only Kit signups, Zapier leads) and holds the Kit fiction readers it brought over from Kit on
-- 16 Nov. The edge function wannabe-sync (every 10 minutes, job below) asks the app's tw-wannabe-sync for that list, hands it
-- to wannabe_from_app() here, and gives the app back what this list now holds for each address (so a leave made here is
-- honoured on the app too). Run this file once in the Thread Weaver project, then deploy supabase/functions/wannabe-sync.
-- Nothing here sends email: there are no triggers on nl_subscribers and joining does not start anything unless a live
-- sequence has a "joined" way in - and joined_at is each reader's ORIGINAL signup date, so a sequence started later never
-- picks up these readers as new.

create or replace function public.wannabe_from_app(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $fn$
-- Rules, in order:
--  1. ADD a reader the app has subscribed who is not here yet - never one the app marks blocked (suppressed / not allowed
--     mail there), never a test address, never one this project will not mail (tw_may_email: dead mailbox, suppressed).
--     Source 'hapitalist-app'. Nobody already here is re-added; nl_sync_from_substack only ever touches source 'substack'.
--  2. TAKE OFF a reader subscribed here when the app has them unsubscribed and EITHER they chose it there (leave link / leave
--     page) after their last change here, OR they came here from the app and the app let them go (Kit stopped having them).
--     Kit letting someone go never takes a Substack reader off.
--  3. PUT BACK a reader who was taken off here only because they left on the app, when they came back on the app afterwards.
--     Never someone who bounced, complained or left here themselves.
--  Returns, for every address given, what this list holds now (or why it was not added), for the app's wannabe_tw_apply.
declare n_given int; n_add int; n_off int; n_back int; v_rows jsonb;
begin
  select count(*) into n_given from jsonb_array_elements(coalesce(p->'rows', '[]'::jsonb));

  with w as (
    select distinct on (lower(btrim(x->>'email'))) lower(btrim(x->>'email')) email, nullif(btrim(x->>'first_name'), '') first_name,
           x->>'status' status, (x->>'joined_at')::timestamptz joined_at, left(coalesce(x->>'source', ''), 60) source,
           coalesce((x->>'blocked')::boolean, false) blocked
      from jsonb_array_elements(coalesce(p->'rows', '[]'::jsonb)) x
     where lower(btrim(coalesce(x->>'email', ''))) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  insert into public.nl_subscribers(email, name, status, source, joined_at, status_at, status_why)
  select w.email, w.first_name, 'subscribed', 'hapitalist-app', coalesce(w.joined_at, now()), now(),
         left('Wannabe Press reader from the Hapitalist app (' || w.source || ')', 200)
    from w
   where w.status = 'subscribed' and not w.blocked and not public.is_qa_address(w.email)
     and coalesce((public.tw_may_email(w.email)->>'allow')::boolean, false)
  on conflict (email) do nothing;
  get diagnostics n_add = row_count;

  with w as (
    select distinct on (lower(btrim(x->>'email'))) lower(btrim(x->>'email')) email, x->>'status' status,
           (x->>'status_at')::timestamptz status_at, x->>'status_why' status_why, coalesce((x->>'chose')::boolean, false) chose
      from jsonb_array_elements(coalesce(p->'rows', '[]'::jsonb)) x where coalesce(x->>'email', '') like '%_@_%')
  update public.nl_subscribers s
     set status = 'unsubscribed', status_at = now(), updated_at = now(),
         status_why = left('left Wannabe Press on the Hapitalist app (' || coalesce(w.status_why, 'unsubscribed there') || ')', 300)
    from w
   where s.email = w.email and s.status = 'subscribed' and w.status <> 'subscribed'
     and ((w.chose and w.status_at > s.status_at) or (not w.chose and s.source = 'hapitalist-app'));
  get diagnostics n_off = row_count;

  with w as (
    select distinct on (lower(btrim(x->>'email'))) lower(btrim(x->>'email')) email, x->>'status' status,
           (x->>'status_at')::timestamptz status_at, coalesce((x->>'blocked')::boolean, false) blocked
      from jsonb_array_elements(coalesce(p->'rows', '[]'::jsonb)) x where coalesce(x->>'email', '') like '%_@_%')
  update public.nl_subscribers s
     set status = 'subscribed', status_at = now(), updated_at = now(), status_why = 'came back on the Hapitalist app'
    from w
   where s.email = w.email and s.status = 'unsubscribed' and s.status_why like 'left Wannabe Press on the Hapitalist app%'
     and w.status = 'subscribed' and not w.blocked and w.status_at > s.status_at;
  get diagnostics n_back = row_count;

  with w as (
    select distinct on (lower(btrim(x->>'email'))) lower(btrim(x->>'email')) email, x->>'status' status,
           coalesce((x->>'blocked')::boolean, false) blocked
      from jsonb_array_elements(coalesce(p->'rows', '[]'::jsonb)) x where coalesce(x->>'email', '') like '%_@_%')
  select coalesce(jsonb_agg(jsonb_build_object('email', w.email, 'status', s.status, 'status_at', s.status_at, 'source', s.source,
           'status_why', case when s.email is not null then s.status_why
                              else 'not added here: ' || case when w.status <> 'subscribed' then 'not subscribed on the app'
                                                              when w.blocked then 'blocked on the app'
                                                              when public.is_qa_address(w.email) then 'a test address'
                                                              else coalesce(public.tw_may_email(w.email)->>'reason', 'refused') end end)), '[]'::jsonb)
    into v_rows
    from w left join public.nl_subscribers s on s.email = w.email;

  return jsonb_build_object('ok', true, 'given', n_given, 'added', n_add, 'taken_off', n_off, 'put_back', n_back,
    'subscribed', (select count(*) from public.nl_subscribers where status = 'subscribed'), 'rows', v_rows);
end $fn$;

revoke all on function public.wannabe_from_app(jsonb) from public, anon, authenticated;
grant execute on function public.wannabe_from_app(jsonb) to service_role;

-- every 10 minutes, the same way hapitalist-member-sync calls hapi-member-sync (this project's admin-secret, read at run time)
select cron.schedule('tw-wannabe-sync', '4-59/10 * * * *', $c$
  select net.http_post(
    url := 'https://nzkgurdmvgkizvzisqxt.supabase.co/functions/v1/wannabe-sync',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-admin-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'admin-secret' limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000)
$c$);
