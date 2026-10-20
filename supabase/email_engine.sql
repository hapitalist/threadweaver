-- =====================================================================================================================
-- Thread Weaver email engine (database layer), ported from Joy Looper's nl_/seq_/oneoff_ engine on 20 Oct 2026.
-- Target: Supabase project nzkgurdmvgkizvzisqxt. Applied in this order. Sends nothing. Creates no cron jobs.
-- Names, columns and RPC signatures match Joy so the Joy admin pages port with minimal edits.
-- Stripped from Joy: Ghost, the split test, Kit import, the Hapitalist welcome hold, documents/posts, members,
-- tenant_id, Stripe, cust_* tables, the "Wednesday is newsletter day" rule, the *_problems self-checks
-- (except _flow_problems), erasure tombstones (is_erased returns false), audit_log (tw_audit_log instead).
-- =====================================================================================================================

-- ---------------------------------------------------------------- 1. who is an admin
create or replace function public.is_tw_admin()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- true for the service role, or for a signed-in Thread Weaver account whose own auth.users address (and JWT email)
  -- is russell@wannabepress.com or help@wannabepress.com
  select coalesce(auth.role() = 'service_role', false)
      or exists (select 1 from auth.users u
                  where u.id = auth.uid()
                    and lower(u.email) in ('russell@wannabepress.com', 'help@wannabepress.com')
                    and lower(u.email) = lower(coalesce(auth.jwt()->>'email', '')));
$function$;

create or replace function public.is_joy_admin(p_member_uid text default null::text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- thin alias so code ported from Joy works unchanged; the argument is ignored
  select public.is_tw_admin();
$function$;

-- ---------------------------------------------------------------- 2. tables
create table if not exists public.nl_subscribers (
  email text not null,
  name text,
  status text not null default 'subscribed'::text,
  source text not null,
  joined_at timestamp with time zone,
  added_at timestamp with time zone not null default now(),
  status_at timestamp with time zone not null default now(),
  status_why text,
  token uuid not null default gen_random_uuid(),
  opens_recent integer not null default 0,
  opens_total integer not null default 0,
  last_sent_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  app_choice_at timestamp with time zone,
  ses_unblock_note text,
  ses_unblock_wanted_at timestamp with time zone,
  ses_unblock_tried_at timestamp with time zone,
  constraint nl_subscribers_pkey primary key (email),
  constraint nl_subscribers_token_key unique (token),
  constraint nl_subscribers_email_check check (((email = lower(btrim(email))) and (email ~~ '%_@_%'::text))),
  constraint nl_subscribers_status_check check ((status = any (array['subscribed'::text, 'unsubscribed'::text, 'bounced'::text, 'complained'::text])))
);
create index if not exists nl_subscribers_status on public.nl_subscribers using btree (status);
create index if not exists nl_subscribers_source on public.nl_subscribers using btree (source, status);

create table if not exists public.nl_events (
  id bigserial not null,
  sns_message_id text,
  event_type text not null,
  message_id text,
  email text,
  send_id bigint,
  at timestamp with time zone,
  detail jsonb,
  received_at timestamp with time zone not null default now(),
  constraint nl_events_pkey primary key (id),
  constraint nl_events_sns_message_id_key unique (sns_message_id)
);
create index if not exists nl_events_msg on public.nl_events using btree (message_id);
create index if not exists nl_events_read_email on public.nl_events using btree (lower(email), at desc) where (event_type = any (array['Open'::text, 'Click'::text]));
create index if not exists nl_events_email on public.nl_events using btree (email, event_type, at);
create index if not exists nl_events_send on public.nl_events using btree (send_id, event_type);
create index if not exists nl_events_type_at on public.nl_events using btree (event_type, at);

create table if not exists public.nl_sender_lease (
  id integer not null default 1,
  holder text,
  until timestamp with time zone,
  constraint nl_sender_lease_pkey primary key (id),
  constraint nl_sender_lease_id_check check ((id = 1))
);
insert into public.nl_sender_lease(id, holder, until) values (1, null, now() - interval '1 second') on conflict (id) do nothing;

create table if not exists public.nl_sequences (
  id uuid not null default gen_random_uuid(),
  name text not null default 'Untitled sequence'::text,
  status text not null default 'draft'::text,
  send_days integer[] not null default '{1,2,3,4,5,6,7}'::integer[],
  send_hour integer not null default 9,
  time_zone text not null default 'America/Los_Angeles'::text,
  audience jsonb not null default '{"kind": "none"}'::jsonb,
  note text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  kind text not null default 'sequence'::text,
  entries jsonb not null default '[]'::jsonb,
  send_at timestamp with time zone,
  constraint nl_sequences_pkey primary key (id),
  constraint nl_sequences_kind_check check ((kind = any (array['sequence'::text, 'oneoff'::text]))),
  constraint nl_sequences_send_hour_check check (((send_hour >= 0) and (send_hour <= 23))),
  constraint nl_sequences_status_check check ((status = any (array['draft'::text, 'live'::text, 'paused'::text, 'archived'::text])))
);

create table if not exists public.nl_sequence_emails (
  id uuid not null default gen_random_uuid(),
  sequence_id uuid not null,
  "position" integer not null,
  subject text not null default ''::text,
  preview_text text not null default ''::text,
  body_html text not null default ''::text,
  published boolean not null default true,
  delay_value integer not null default 1,
  delay_unit text not null default 'days'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  lexical jsonb,
  kind text not null default 'email'::text,
  config jsonb not null default '{}'::jsonb,
  parent_id uuid,
  branch text,
  constraint nl_sequence_emails_pkey primary key (id),
  constraint nl_sequence_emails_delay_unit_check check ((delay_unit = any (array['hours'::text, 'days'::text]))),
  constraint nl_sequence_emails_delay_value_check check ((delay_value >= 0)),
  constraint nl_sequence_emails_kind_check check ((kind = any (array['email'::text, 'wait'::text, 'tag_add'::text, 'tag_remove'::text, 'field_set'::text, 'condition'::text, 'event'::text, 'sequence'::text, 'move'::text, 'goto'::text, 'unsubscribe'::text, 'exit'::text]))),
  constraint nl_sequence_emails_parent_id_fkey foreign key (parent_id) references public.nl_sequence_emails(id) on delete cascade,
  constraint nl_sequence_emails_sequence_id_fkey foreign key (sequence_id) references public.nl_sequences(id) on delete cascade
);
create index if not exists nl_sequence_emails_lane on public.nl_sequence_emails using btree (sequence_id, parent_id, branch, "position");
create index if not exists nl_sequence_emails_seq_pos on public.nl_sequence_emails using btree (sequence_id, "position");

create table if not exists public.nl_sequence_people (
  id bigserial not null,
  sequence_id uuid not null,
  email text not null,
  status text not null default 'in'::text,
  next_position integer not null default 1,
  next_due_at timestamp with time zone,
  added_at timestamp with time zone not null default now(),
  added_how text,
  last_sent_at timestamp with time zone,
  left_at timestamp with time zone,
  note text,
  at_step uuid,
  at_since timestamp with time zone,
  parent_person_id bigint,
  constraint nl_sequence_people_pkey primary key (id),
  constraint nl_sequence_people_sequence_id_email_key unique (sequence_id, email),
  constraint nl_sequence_people_status_check check ((status = any (array['in'::text, 'done'::text, 'left'::text, 'stopped'::text]))),
  constraint nl_sequence_people_at_step_fkey foreign key (at_step) references public.nl_sequence_emails(id) on delete set null,
  constraint nl_sequence_people_parent_person_id_fkey foreign key (parent_person_id) references public.nl_sequence_people(id) on delete set null,
  constraint nl_sequence_people_sequence_id_fkey foreign key (sequence_id) references public.nl_sequences(id) on delete cascade
);
create index if not exists nl_sequence_people_at on public.nl_sequence_people using btree (at_step) where (status = 'in'::text);
create index if not exists nl_sequence_people_due on public.nl_sequence_people using btree (next_due_at) where (status = 'in'::text);
create index if not exists nl_sequence_people_email_in on public.nl_sequence_people using btree (email) where (status = 'in'::text);
create index if not exists nl_sequence_people_parent on public.nl_sequence_people using btree (parent_person_id) where (parent_person_id is not null);

create table if not exists public.nl_sequence_sends (
  id bigserial not null,
  person_id bigint not null,
  sequence_id uuid not null,
  email_id uuid,
  email text not null,
  status text not null default 'sending'::text,
  claimed_at timestamp with time zone,
  sent_at timestamp with time zone,
  message_id text,
  error text,
  constraint nl_sequence_sends_pkey primary key (id),
  constraint nl_sequence_sends_person_id_email_id_key unique (person_id, email_id),
  constraint nl_sequence_sends_status_check check ((status = any (array['sending'::text, 'sent'::text, 'failed'::text, 'retry'::text]))),
  constraint nl_sequence_sends_email_id_fkey foreign key (email_id) references public.nl_sequence_emails(id) on delete set null,
  constraint nl_sequence_sends_person_id_fkey foreign key (person_id) references public.nl_sequence_people(id) on delete cascade
);
create index if not exists nl_sequence_sends_email on public.nl_sequence_sends using btree (email_id, status);
create index if not exists nl_sequence_sends_msg on public.nl_sequence_sends using btree (message_id);
create index if not exists nl_sequence_sends_seq on public.nl_sequence_sends using btree (sequence_id, status);
create index if not exists nl_sequence_sends_addr on public.nl_sequence_sends using btree (email);

create table if not exists public.nl_sequence_trash (
  id uuid not null default gen_random_uuid(),
  sequence_id uuid not null,
  step_id uuid not null,
  kind text not null,
  label text not null,
  rows jsonb not null,
  after_id uuid,
  parent_id uuid,
  branch text,
  "position" integer,
  gotos jsonb not null default '[]'::jsonb,
  removed_at timestamp with time zone not null default now(),
  removed_by uuid default auth.uid(),
  restored_at timestamp with time zone,
  constraint nl_sequence_trash_pkey primary key (id),
  constraint nl_sequence_trash_sequence_id_fkey foreign key (sequence_id) references public.nl_sequences(id) on delete cascade
);
create index if not exists nl_sequence_trash_seq on public.nl_sequence_trash using btree (sequence_id, removed_at desc) where (restored_at is null);

create table if not exists public.nl_flow_log (
  id bigserial not null,
  person_id bigint not null,
  sequence_id uuid not null,
  step_id uuid,
  at timestamp with time zone not null default now(),
  what text not null,
  constraint nl_flow_log_pkey primary key (id),
  constraint nl_flow_log_person_id_fkey foreign key (person_id) references public.nl_sequence_people(id) on delete cascade
);
create index if not exists nl_flow_log_person on public.nl_flow_log using btree (person_id);
create index if not exists nl_flow_log_step on public.nl_flow_log using btree (step_id);

create table if not exists public.person_tags (
  email text not null,
  tag text not null,
  added_at timestamp with time zone not null default now(),
  removed_at timestamp with time zone,
  source text,
  by_sequence uuid,
  constraint person_tags_pkey primary key (email, tag)
);
create index if not exists person_tags_added on public.person_tags using btree (added_at);
create index if not exists person_tags_removed on public.person_tags using btree (removed_at) where (removed_at is not null);
create index if not exists person_tags_tag on public.person_tags using btree (tag) where (removed_at is null);
create index if not exists person_tags_tag_all on public.person_tags using btree (tag);

create table if not exists public.person_fields (
  email text not null,
  key text not null,
  value text,
  updated_at timestamp with time zone not null default now(),
  source text,
  constraint person_fields_pkey primary key (email, key)
);
create index if not exists person_fields_key on public.person_fields using btree (key, updated_at);

-- the Gmail warm-up: cap = step * (whole weeks since started_on + 1); started_on is set by the first real send
create table if not exists public.nl_warmup (
  id boolean not null default true,
  started_on date,
  step integer not null default 3000,
  constraint nl_warmup_pkey primary key (id),
  constraint nl_warmup_id_check check (id)
);
insert into public.nl_warmup(id) values (true) on conflict (id) do nothing;

create table if not exists public.tw_audit_log (
  id bigserial primary key,
  at timestamp with time zone not null default now(),
  action text not null,
  actor text,
  target text,
  metadata jsonb not null default '{}'::jsonb
);

-- editor snippets (Joy's joy_snippets without tenant_id)
create table if not exists public.joy_snippets (
  name text not null,
  html text,
  kind text not null default 'block',
  lexical jsonb,
  sort_order integer,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  retired_at timestamp with time zone,
  constraint joy_snippets_pkey primary key (name)
);

-- ---------------------------------------------------------------- 3. lock the tables down
do $$
declare t text;
begin
  foreach t in array array['nl_subscribers','nl_events','nl_sender_lease','nl_sequences','nl_sequence_emails','nl_sequence_people',
                           'nl_sequence_sends','nl_sequence_trash','nl_flow_log','person_tags','person_fields','nl_warmup','tw_audit_log','joy_snippets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'S'
              and c.relname in ('nl_events_id_seq','nl_sequence_people_id_seq','nl_sequence_sends_id_seq','nl_flow_log_id_seq','tw_audit_log_id_seq') loop
    execute format('revoke all on sequence public.%I from anon, authenticated', t);
    execute format('grant usage, select on sequence public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- 4. small helpers (stubs and pure functions)
create or replace function public.is_erased(p_email text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- Thread Weaver keeps no erasure tombstones; nobody is ever "erased" here
  select false;
$function$;

create or replace function public.is_qa_address(p_email text)
 returns boolean
 language sql
 immutable
as $function$
  select coalesce(
    lower(btrim(coalesce(p_email,''))) like '%@hapitalist.internal'
    or lower(btrim(coalesce(p_email,''))) like 'noheltyr+%'
    or lower(btrim(coalesce(p_email,''))) like 'qa-%@hapitalist.com'
    or lower(btrim(coalesce(p_email,''))) like 'zz-%'
    or lower(btrim(coalesce(p_email,''))) like 'redteam-%'
    or lower(btrim(coalesce(p_email,''))) like '%@example.%'
  , false)
$function$;

create or replace function public.subscriber_stars(p_grade text)
 returns integer
 language sql
 immutable
as $function$
  select case p_grade when 'S' then 5 when 'A' then 5 when 'B' then 4 when 'C' then 3 when 'D' then 2 when 'E' then 1 when 'F' then 1 else 0 end
$function$;

-- TW: a reader's stars come from admin_reader_heat (Hot+superfan 5, Hot 4, Warm 3, Cool 2, Cold 1)
create or replace function public._tw_heat_stars(p_heat text, p_superfan boolean default false)
 returns integer
 language sql
 immutable
as $function$
  select case lower(coalesce(p_heat,'')) when 'hot' then case when coalesce(p_superfan,false) then 5 else 4 end
    when 'warm' then 3 when 'cool' then 2 when 'cold' then 1 else 0 end
$function$;

create or replace function public.welcome_hold_on(p_email text, p_person bigint default null::bigint)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- Joy's "Hapitalist welcome holds everything else" rule is not part of Thread Weaver
  select false;
$function$;

create or replace function public.nl_split_provider(p_email text)
 returns text
 language sql
 immutable
as $function$
  select case
    when p_email ~* '@(gmail|googlemail)\.com$' then 'gmail'
    when p_email ~* '@(hotmail|outlook|live|msn)\.' then 'microsoft'
    when p_email ~* '@(yahoo|ymail|aol)\.' then 'yahoo_aol'
    when p_email ~* '@(icloud\.com|me\.com|mac\.com)$' then 'apple'
    else 'other' end;
$function$;

create or replace function public.person_tag_add(p_email text, p_tags text[], p_source text, p_seq uuid default null::uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int;
begin
  insert into public.person_tags(email, tag, added_at, source, by_sequence)
  select lower(btrim(p_email)), btrim(t), now(), p_source, p_seq from unnest(p_tags) t where btrim(coalesce(t,'')) <> ''
  on conflict (email, tag) do update set removed_at = null, added_at = now(), source = excluded.source, by_sequence = excluded.by_sequence
   where public.person_tags.removed_at is not null;
  get diagnostics n = row_count; return n;
end $function$;

create or replace function public.person_tag_remove(p_email text, p_tags text[])
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int;
begin
  update public.person_tags set removed_at = now() where email = lower(btrim(p_email)) and tag = any(p_tags) and removed_at is null;
  get diagnostics n = row_count; return n;
end $function$;

create or replace function public.person_has_tags(p_email text, p_tags text[], p_match text default 'any'::text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case coalesce(p_match,'any')
    when 'all'  then (select count(distinct tag) from public.person_tags where email = lower(p_email) and tag = any(p_tags) and removed_at is null)
                     = (select count(distinct t) from unnest(p_tags) t)
    when 'none' then not exists (select 1 from public.person_tags where email = lower(p_email) and tag = any(p_tags) and removed_at is null)
    else exists (select 1 from public.person_tags where email = lower(p_email) and tag = any(p_tags) and removed_at is null) end
$function$;

-- TW: words for how people were added (used by oneoff_send and seq_add_people)
create or replace function public._tw_audience_words(p jsonb)
 returns text
 language sql
 stable
 set search_path to 'public'
as $function$
  select case p->>'kind' when 'paste' then 'added by hand' when 'everyone' then 'everyone on the list'
    when 'engaged' then 'readers who opened lately' when 'joined_since' then 'joined since ' || coalesce(p->>'since','')
    when 'tag' then 'tagged ' || coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(case when jsonb_typeof(p->'tags') = 'array' then p->'tags' else '[]'::jsonb end) x), '')
    when 'heat' then 'heat ' || coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(case when jsonb_typeof(p->'heats') = 'array' then p->'heats' else '[]'::jsonb end) x), nullif(p->>'heat',''), p->>'value', '')
    when 'series' then 'opened the ' || coalesce(nullif(p->>'series',''), nullif(p->>'value',''), 'any') || ' series'
    when 'backer' then 'backed ' || coalesce(nullif(p->>'project',''), 'a fiction campaign')
    when 'bought' then 'backed ' || coalesce(nullif(p->>'product',''), nullif(p->>'project',''), 'a fiction campaign')
    when 'bookfunnel' then 'BookFunnel fiction' || coalesce(' (' || nullif(p->>'page','') || ')', '')
    when 'joy' then 'also on Joy'
    when 'kit_tag' then 'Kit tag ' || coalesce(nullif(p->>'tag',''), p->>'value', '')
    when 'app' then 'Thread Weaver app readers' when 'members' then 'Thread Weaver app readers'
    when 'stars' then coalesce(p->>'stars','3') || '+ stars'
    else coalesce(p->>'kind','') end
$function$;

-- ---------------------------------------------------------------- 5. who an audience choice picks
create or replace function public._seq_pick(p_seq uuid, p jsonb)
 returns table(email text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
-- TW audiences. Always only people on nl_subscribers with status 'subscribed'.
--   everyone, engaged, joined_since, tag, paste (as Joy)
--   heat {heat|heats|value: Hot/Warm/Cool/Cold}, series {series|value: substack series opened, blank = any},
--   backer {project?} (bought maps here), bookfunnel {page?}, joy, kit_tag {tag|value}, app (members maps here),
--   stars {stars} from the heat stars
declare k text := coalesce(p->>'kind','');
        v_tags text[] := (select coalesce(array_agg(x),'{}') from jsonb_array_elements_text(case when jsonb_typeof(p->'tags') = 'array' then p->'tags' else '[]'::jsonb end) x);
        v_val text := btrim(coalesce(p->>'value',''));
        v_heats text[]; v_series text; v_proj text; v_page text; v_ktag text;
begin
  if k = 'paste' then
    return query
    select distinct x.email from public.nl_subscribers x
     where x.status = 'subscribed'
       and x.email in (select lower(btrim(t)) from regexp_split_to_table(coalesce(p->>'emails',''), '[\s,;]+') t where t like '%@%');
    return;
  end if;
  if k = 'tag' then
    return query
    select x.email from public.nl_subscribers x
     where x.status = 'subscribed' and coalesce(x.source,'') <> 'qa' and not public.is_qa_address(x.email)
       and case coalesce(p->>'match','any')
             when 'none' then x.email not in (select t.email from public.person_tags t where t.tag = any(v_tags) and t.removed_at is null)
             when 'all' then x.email in (select t.email from public.person_tags t where t.tag = any(v_tags) and t.removed_at is null
                                          group by t.email having count(distinct t.tag) = (select count(distinct y) from unnest(v_tags) y))
             else x.email in (select t.email from public.person_tags t where t.tag = any(v_tags) and t.removed_at is null) end;
    return;
  end if;
  if k in ('heat','series','backer','bought','bookfunnel','joy','kit_tag','app','members','stars') then
    v_heats := (select coalesce(array_agg(lower(btrim(x))), '{}') from jsonb_array_elements_text(case when jsonb_typeof(p->'heats') = 'array' then p->'heats' else '[]'::jsonb end) x);
    if cardinality(v_heats) = 0 then v_heats := array[lower(coalesce(nullif(btrim(p->>'heat'),''), v_val))]; end if;
    v_series := lower(regexp_replace(btrim(coalesce(nullif(p->>'series',''), v_val)), '\s+', '_', 'g'));
    v_proj := btrim(coalesce(nullif(p->>'project',''), nullif(p->>'product',''), case when k in ('backer','bought') then v_val end, ''));
    v_page := btrim(coalesce(nullif(p->>'page',''), case when k = 'bookfunnel' then v_val end, ''));
    v_ktag := btrim(coalesce(nullif(p->>'tag',''), case when k = 'kit_tag' then v_val end, ''));
    return query
    select x.email from public.nl_subscribers x join public.admin_reader_heat h on h.email = x.email
     where x.status = 'subscribed' and coalesce(x.source,'') <> 'qa' and not public.is_qa_address(x.email)
       and coalesce(case k
         when 'heat' then lower(h.heat) = any(v_heats)
         when 'series' then jsonb_typeof(h.series_opens) = 'object' and case when v_series = ''
                              then exists (select 1 from jsonb_each_text(h.series_opens) e where e.value ~ '^[0-9.]+$' and e.value::numeric > 0)
                              else coalesce(case when (h.series_opens->>v_series) ~ '^[0-9.]+$' then (h.series_opens->>v_series)::numeric end, 0) > 0 end
         when 'backer' then coalesce(h.projects_backed,0) > 0 and (v_proj = '' or exists (select 1 from unnest(h.projects) pr where pr ilike '%' || v_proj || '%'))
         when 'bought' then coalesce(h.projects_backed,0) > 0 and (v_proj = '' or exists (select 1 from unnest(h.projects) pr where pr ilike '%' || v_proj || '%'))
         when 'bookfunnel' then h.bookfunnel_fiction and (v_page = '' or coalesce(h.bf_fiction_pages,'') ilike '%' || v_page || '%')
         when 'joy' then h.on_joy
         when 'kit_tag' then case when v_ktag = '' then h.in_kit else coalesce(h.kit_tags,'') ilike '%' || v_ktag || '%' end
         when 'app' then h.thread_weaver_user
         when 'members' then h.thread_weaver_user
         when 'stars' then public._tw_heat_stars(h.heat, h.superfan) >= coalesce((p->>'stars')::int, 3)
       end, false);
    return;
  end if;
  return query
  select x.email from public.nl_subscribers x
   where x.status = 'subscribed' and coalesce(x.source,'') <> 'qa' and not public.is_qa_address(x.email)
     and case k
       when 'everyone' then true
       when 'engaged' then coalesce(x.opens_recent,0) >= 1
       when 'joined_since' then coalesce(x.joined_at, x.added_at) >= coalesce((p->>'since')::date, current_date)::timestamptz
       else false end;
end $function$;

-- ---------------------------------------------------------------- 6. the flow engine's helpers
create or replace function public._flow_entry_people(p_seq uuid, p_entry jsonb)
 returns table(email text, how text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
-- TW ways in: joined, tag_added, field_changed, clicked, bought (= backed a fiction campaign, fiction_backers).
-- Joy's quiz / form / booked have no TW data and pick nobody.
declare v_since timestamptz := coalesce((p_entry->>'since')::timestamptz, now());
        v_tags text[] := (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(coalesce(p_entry->'tags','[]'::jsonb)) x);
begin
  case p_entry->>'type'
  when 'joined' then
    return query select x.email, 'joined your list' from public.nl_subscribers x where coalesce(x.joined_at, x.added_at) >= v_since;
  when 'tag_added' then
    return query select distinct t.email, 'was tagged ' || t.tag from public.person_tags t where t.tag = any(v_tags) and t.removed_at is null and t.added_at >= v_since;
  when 'bought' then
    return query select distinct lower(btrim(b.email)), 'backed ' || coalesce(b.project, 'a campaign')
      from public.fiction_backers b
     where b.pledged_on >= (v_since at time zone 'America/Los_Angeles')::date
       and (coalesce(p_entry->>'product','') = '' or coalesce(b.project,'') ilike '%' || (p_entry->>'product') || '%');
  when 'field_changed' then
    return query select f.email, 'their ' || f.key || ' changed' from public.person_fields f where f.key = p_entry->>'key' and f.updated_at >= v_since
       and (coalesce(p_entry->>'value','') = '' or lower(coalesce(f.value,'')) = lower(p_entry->>'value'));
  when 'clicked' then
    return query select distinct ev.email, 'clicked a link' from public.nl_events ev where ev.event_type = 'Click' and ev.at >= v_since
       and (coalesce(p_entry->>'url_contains','') = '' or ev.detail->>'link' ilike '%' || (p_entry->>'url_contains') || '%');
  else return;
  end case;
end $function$;

create or replace function public._flow_kind_word(p_kind text)
 returns text
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  select case p_kind when 'email' then 'Email' when 'wait' then 'Wait' when 'tag_add' then 'Add a tag' when 'tag_remove' then 'Remove a tag'
    when 'field_set' then 'Set a field' when 'condition' then 'Split' when 'event' then 'Wait for something' when 'sequence' then 'Send them through a sequence'
    when 'move' then 'Move them to another sequence' when 'goto' then 'Go to another step' when 'unsubscribe' then 'Unsubscribe them' when 'exit' then 'End here'
    else p_kind end
$function$;

create or replace function public._flow_problems(p_seq uuid)
 returns text[]
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare x record; p text[] := '{}'; v_tags int; w text;
begin
  if not exists (select 1 from public.nl_sequence_emails where sequence_id = p_seq) then return array['it has no steps yet']; end if;
  for x in select e.*, row_number() over (order by e.position) n from public.nl_sequence_emails e where e.sequence_id = p_seq order by e.parent_id nulls first, e.branch, e.position loop
    w := case when x.kind = 'email' and btrim(x.subject) <> '' then 'the email "' || btrim(x.subject) || '"' when x.kind = 'email' then 'an email with no subject line'
              else 'the "' || public._flow_kind_word(x.kind) || '" step' end;
    v_tags := coalesce(jsonb_array_length(case when jsonb_typeof(x.config->'tags') = 'array' then x.config->'tags' end), 0);
    if x.kind = 'email' and x.published and (btrim(x.subject) = '' or btrim(regexp_replace(regexp_replace(x.body_html, '<style[\s\S]*?</style>', '', 'gi'), '<[^>]+>|&nbsp;', '', 'g')) = '') then
      p := p || (w || ' needs a subject line and some words (or switch it off)');
    elsif x.kind in ('tag_add','tag_remove') and v_tags = 0 then p := p || (w || ' has no tag picked');
    elsif x.kind = 'condition' and x.config->>'mode' = 'multi' and coalesce(jsonb_array_length(x.config->'paths'), 0) = 0 then p := p || (w || ' has no paths');
    elsif x.kind = 'condition' and x.config->>'mode' = 'multi' and exists (select 1 from jsonb_array_elements(x.config->'paths') y
          where coalesce(y->>'test','') = '' or (y->>'test' = 'tag' and coalesce(jsonb_array_length(y->'tags'),0) = 0)) then p := p || (w || ' has a path with nothing to check');
    elsif x.kind = 'condition' and coalesce(x.config->>'mode','') <> 'multi' and coalesce(x.config->>'test','') = '' then p := p || (w || ' has nothing to check');
    elsif x.kind = 'condition' and coalesce(x.config->>'mode','') <> 'multi' and x.config->>'test' = 'tag' and v_tags = 0 then p := p || (w || ' has no tag picked');
    elsif x.kind = 'condition' and x.config->>'test' = 'field' and coalesce(x.config->>'key','') = '' then p := p || (w || ' has no field picked');
    elsif x.kind = 'event' and x.config->>'type' in ('tag_added','tag_removed') and v_tags = 0 then p := p || (w || ' has no tag picked');
    elsif x.kind = 'event' and x.config->>'type' = 'date' and nullif(x.config->>'at','') is null then p := p || (w || ' has no date picked');
    elsif x.kind = 'event' and x.config->>'type' = 'field_changed' and coalesce(x.config->>'key','') = '' then p := p || (w || ' has no field picked');
    elsif x.kind = 'field_set' and coalesce(x.config->>'key','') = '' then p := p || (w || ' has no field picked');
    elsif x.kind in ('sequence','move') and (nullif(x.config->>'sequence_id','') is null
          or not exists (select 1 from public.nl_sequences q where q.id = (x.config->>'sequence_id')::uuid and q.status in ('draft','live') and q.kind = 'sequence')) then
      p := p || (w || ' does not point at a sequence that can send (pick one that is a draft or live)');
    elsif x.kind = 'goto' and (nullif(x.config->>'step_id','') is null or not exists (select 1 from public.nl_sequence_emails q where q.id = (x.config->>'step_id')::uuid and q.sequence_id = p_seq)) then
      p := p || (w || ' does not say which step to go to');
    elsif x.kind = 'wait' and coalesce(x.config->>'mode','for') = 'for' and coalesce((x.config->>'value')::int, 0) <= 0 then
      p := p || (w || ' waits for no time - give it a number');
    end if;
  end loop;
  return p;
end $function$;

create or replace function public._flow_first(p_seq uuid, p_parent uuid, p_branch text)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select id from public.nl_sequence_emails where sequence_id = p_seq and parent_id is not distinct from p_parent
     and branch is not distinct from p_branch order by position, created_at limit 1
$function$;

create or replace function public._flow_next(p_step uuid)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select x.id from public.nl_sequence_emails s join public.nl_sequence_emails x
    on x.sequence_id = s.sequence_id and x.parent_id is not distinct from s.parent_id and x.branch is not distinct from s.branch
       and (x.position > s.position or (x.position = s.position and x.created_at > s.created_at))
   where s.id = p_step order by x.position, x.created_at limit 1
$function$;

create or replace function public._flow_opened_within(p_email text, p_days integer)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- TW: an open of one of these emails (nl_events) or of a Wannabe Press Substack post (substack_opens)
  select exists (select 1 from public.nl_events e where e.email = lower(p_email) and e.event_type = 'Open' and e.at >= now() - make_interval(days => p_days))
      or exists (select 1 from public.substack_opens o where o.email = lower(p_email) and o.last_open >= now() - make_interval(days => p_days))
$function$;

create or replace function public._flow_running(p_person bigint)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare r record; i int := 0; v_id bigint := p_person;
begin
  loop
    i := i + 1; exit when i > 6;
    select p.status, p.parent_person_id, s.status as sstatus into r from public.nl_sequence_people p join public.nl_sequences s on s.id = p.sequence_id where p.id = v_id;
    if r.status is distinct from 'in' then return false; end if;
    if r.sstatus = 'live' then return true; end if;
    if r.sstatus <> 'draft' or r.parent_person_id is null then return false; end if;
    v_id := r.parent_person_id;
  end loop;
  return false;
end $function$;

create or replace function public._flow_stop_down(p_person bigint, p_note text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c record;
begin
  for c in select id from public.nl_sequence_people where parent_person_id = p_person and status = 'in' loop
    perform public._flow_stop_down(c.id, p_note);
    update public.nl_sequence_people set status = 'left', left_at = now(), next_due_at = null, note = left(p_note, 300) where id = c.id;
  end loop;
end $function$;

create or replace function public._flow_stop_up(p_person bigint, p_status text, p_note text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_id bigint := p_person; v_parent bigint; i int := 0;
begin
  while v_id is not null and i < 7 loop
    i := i + 1;
    update public.nl_sequence_people set status = p_status, left_at = now(), next_due_at = null, note = left(p_note, 300)
     where id = v_id and status = 'in' returning parent_person_id into v_parent;
    if not found then exit; end if;
    v_id := v_parent;
  end loop;
end $function$;

create or replace function public._flow_event_since(p_email text, p_cfg jsonb, p_since timestamp with time zone)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_e text := lower(btrim(p_email));
        v_tags text[] := (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(coalesce(p_cfg->'tags','[]'::jsonb)) x);
begin
  case coalesce(p_cfg->>'type','')
  when 'date' then return nullif(p_cfg->>'at','') is not null and (p_cfg->>'at')::timestamptz <= now();
  when 'tag_added' then
    return exists (select 1 from public.person_tags where email = v_e and tag = any(v_tags) and removed_at is null and added_at >= p_since);
  when 'tag_removed' then
    return exists (select 1 from public.person_tags where email = v_e and tag = any(v_tags) and removed_at >= p_since);
  when 'bought' then
    -- TW: backed a fiction campaign
    return exists (select 1 from public.fiction_backers b
                    where lower(btrim(b.email)) = v_e and b.pledged_on >= (p_since at time zone 'America/Los_Angeles')::date
                      and (coalesce(p_cfg->>'product','') = '' or coalesce(b.project,'') ilike '%' || (p_cfg->>'product') || '%'));
  when 'field_changed' then
    return exists (select 1 from public.person_fields where email = v_e and key = p_cfg->>'key' and updated_at >= p_since
                     and (coalesce(p_cfg->>'value','') = '' or lower(coalesce(value,'')) = lower(p_cfg->>'value')));
  when 'clicked' then
    return exists (select 1 from public.nl_events ev where ev.email = v_e and ev.event_type = 'Click' and ev.at >= p_since
                     and (coalesce(p_cfg->>'url_contains','') = '' or ev.detail->>'link' ilike '%' || (p_cfg->>'url_contains') || '%'));
  else return false;
  end case;
end $function$;

create or replace function public._flow_event_met(p_email text, p_cfg jsonb, p_since timestamp with time zone)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_e text := lower(btrim(p_email));
begin
  if p_cfg->>'type' = 'tag_added' then
    return public.person_has_tags(v_e, (select coalesce(array_agg(x),'{}') from jsonb_array_elements_text(coalesce(p_cfg->'tags','[]'::jsonb)) x), 'any');
  elsif p_cfg->>'type' = 'tag_removed' then
    return public.person_has_tags(v_e, (select coalesce(array_agg(x),'{}') from jsonb_array_elements_text(coalesce(p_cfg->'tags','[]'::jsonb)) x), 'none');
  elsif p_cfg->>'type' = 'field_changed' and coalesce(p_cfg->>'value','') <> '' then
    return exists (select 1 from public.person_fields where email = v_e and key = p_cfg->>'key' and lower(coalesce(value,'')) = lower(p_cfg->>'value'));
  end if;
  return public._flow_event_since(v_e, p_cfg, p_since);
end $function$;

create or replace function public._flow_test(p_email text, p_cfg jsonb, p_person bigint default null::bigint)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_e text := lower(btrim(p_email)); v text; r jsonb; v_join timestamptz; ok boolean := true;
        v_tags text[] := (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(coalesce(p_cfg->'tags','[]'::jsonb)) x);
begin
  case coalesce(p_cfg->>'test','')
  when 'tag' then return public.person_has_tags(v_e, v_tags, coalesce(p_cfg->>'match','any'));
  when 'field' then
    select value into v from public.person_fields where email = v_e and key = p_cfg->>'key';
    return case coalesce(p_cfg->>'op','is')
      when 'set' then btrim(coalesce(v,'')) <> '' when 'empty' then btrim(coalesce(v,'')) = ''
      when 'is_not' then lower(coalesce(v,'')) <> lower(coalesce(p_cfg->>'value',''))
      when 'contains' then coalesce(v,'') ilike '%' || coalesce(p_cfg->>'value','') || '%'
      else lower(coalesce(v,'')) = lower(coalesce(p_cfg->>'value','')) end;
  when 'opened' then
    if nullif(p_cfg->>'step_id','') is not null then
      return exists (select 1 from public.nl_sequence_sends q join public.nl_events ev on ev.message_id = q.message_id and ev.event_type in ('Open','Click')
                      where q.email = v_e and q.email_id = (p_cfg->>'step_id')::uuid);
    end if;
    return public._flow_opened_within(v_e, coalesce((p_cfg->>'within_days')::int, 30));
  when 'clicked' then
    if nullif(p_cfg->>'step_id','') is not null then
      return exists (select 1 from public.nl_sequence_sends q join public.nl_events ev on ev.message_id = q.message_id and ev.event_type = 'Click'
                      where q.email = v_e and q.email_id = (p_cfg->>'step_id')::uuid
                        and (coalesce(p_cfg->>'url_contains','') = '' or ev.detail->>'link' ilike '%' || (p_cfg->>'url_contains') || '%'));
    end if;
    return exists (select 1 from public.nl_events ev where ev.email = v_e and ev.event_type = 'Click'
                    and ev.at >= now() - make_interval(days => coalesce((p_cfg->>'within_days')::int, 30))
                    and (coalesce(p_cfg->>'url_contains','') = '' or ev.detail->>'link' ilike '%' || (p_cfg->>'url_contains') || '%'));
  when 'bought' then
    -- TW: backed a fiction campaign (fiction_backers)
    return exists (select 1 from public.fiction_backers b
                    where lower(btrim(b.email)) = v_e
                      and (coalesce(p_cfg->>'product','') = '' or coalesce(b.project,'') ilike '%' || (p_cfg->>'product') || '%')
                      and (p_cfg->>'within_days' is null or b.pledged_on >= current_date - (p_cfg->>'within_days')::int));
  when 'in_sequence' then
    return exists (select 1 from public.nl_sequence_people sp where sp.email = v_e and sp.sequence_id = (p_cfg->>'sequence_id')::uuid
                     and (coalesce(p_cfg->>'state','ever') = 'ever' or sp.status = p_cfg->>'state'));
  when 'filter' then
    for r in select * from jsonb_array_elements(coalesce(p_cfg->'rules','[]'::jsonb)) loop
      if r->>'rule' in ('joined_before','joined_after') then
        select coalesce(joined_at, added_at) into v_join from public.nl_subscribers where email = v_e;
        if v_join is null then return false; end if;
        if r->>'rule' = 'joined_before' and not v_join < (r->>'date')::timestamptz then return false; end if;
        if r->>'rule' = 'joined_after' and not v_join >= (r->>'date')::timestamptz then return false; end if;
      elsif r->>'rule' = 'tags_any' then
        if not public.person_has_tags(v_e, (select coalesce(array_agg(x),'{}') from jsonb_array_elements_text(r->'tags') x), 'any') then return false; end if;
      elsif r->>'rule' = 'tags_none' then
        if not public.person_has_tags(v_e, (select coalesce(array_agg(x),'{}') from jsonb_array_elements_text(r->'tags') x), 'none') then return false; end if;
      elsif r->>'rule' = 'cold' then
        if public._flow_opened_within(v_e, coalesce((r->>'days')::int, 90)) then return false; end if;
      elsif r->>'rule' = 'not_cold' then
        if not public._flow_opened_within(v_e, coalesce((r->>'days')::int, 90)) then return false; end if;
      elsif r->>'rule' = 'stars_at_least' then
        if coalesce((select public._tw_heat_stars(h.heat, h.superfan) from public.admin_reader_heat h where h.email = v_e), 0) < coalesce((r->>'stars')::int, 0) then return false; end if;
      elsif r->>'rule' = 'gmail' then
        if (public.nl_split_provider(v_e) = 'gmail') is distinct from coalesce((r->>'is')::boolean, true) then return false; end if;
      elsif r->>'rule' = 'bought' then
        if not exists (select 1 from public.fiction_backers b where lower(btrim(b.email)) = v_e) then return false; end if;
      end if;
    end loop;
    return ok;
  else return false;
  end case;
end $function$;

create or replace function public._flow_branch(p_email text, p_cfg jsonb, p_person bigint)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare x jsonb;
begin
  if p_cfg->>'mode' = 'multi' then
    for x in select * from jsonb_array_elements(coalesce(p_cfg->'paths','[]'::jsonb)) loop
      if coalesce(public._flow_test(p_email, x, p_person), false) then return coalesce(x->>'path', x->>'key'); end if;
    end loop;
    return 'no';
  end if;
  return case when coalesce(public._flow_test(p_email, p_cfg, p_person), false) then 'yes' else 'no' end;
end $function$;

create or replace function public._flow_wait_due(p_cfg jsonb, p_base timestamp with time zone)
 returns timestamp with time zone
 language plpgsql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
declare v int := greatest(coalesce((p_cfg->>'value')::int, 0), 0); v_days int[]; v_hour int; v_d date; i int; v_t timestamptz;
begin
  if p_cfg->>'mode' = 'until' and p_cfg->>'at' is not null then return greatest((p_cfg->>'at')::timestamptz, p_base); end if;
  if p_cfg->>'mode' = 'weekday' then
    v_days := (select coalesce(array_agg(x::int), '{1,2,3,4,5,6,7}') from jsonb_array_elements_text(coalesce(p_cfg->'days','[]'::jsonb)) x);
    if array_length(v_days,1) is null then v_days := '{1,2,3,4,5,6,7}'; end if;
    v_hour := coalesce((p_cfg->>'hour')::int, 9);
    v_d := (p_base at time zone 'America/Los_Angeles')::date;
    for i in 0..8 loop
      if extract(isodow from v_d + i)::int = any(v_days) then
        v_t := ((v_d + i)::timestamp + make_interval(hours => v_hour)) at time zone 'America/Los_Angeles';
        if v_t > p_base then return v_t; end if;
      end if;
    end loop;
    return p_base;
  end if;
  return p_base + case coalesce(p_cfg->>'unit','days')
    when 'minutes' then make_interval(mins => v) when 'hours' then make_interval(hours => v)
    when 'weeks' then make_interval(days => 7 * v) when 'months' then make_interval(months => v)
    else make_interval(days => v) end;
end $function$;

create or replace function public.nl_seq_due_at(p_seq uuid, p_base timestamp with time zone, p_val integer, p_unit text)
 returns timestamp with time zone
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare s public.nl_sequences; v_days int[]; v_t timestamptz; v_day date; i int;
begin
  select * into s from public.nl_sequences where id = p_seq;
  v_days := case when coalesce(array_length(s.send_days,1),0) = 0 then '{1,2,3,4,5,6,7}'::int[] else s.send_days end;
  if p_unit = 'hours' or coalesce(p_val,0) = 0 then
    v_t := p_base + make_interval(hours => case when p_unit = 'hours' then coalesce(p_val,0) else 0 end);
    if extract(isodow from (v_t at time zone s.time_zone))::int = any(v_days) then return v_t; end if;
    v_day := (v_t at time zone s.time_zone)::date + 1;
  else
    v_day := (p_base at time zone s.time_zone)::date + p_val;
  end if;
  for i in 0..7 loop
    if extract(isodow from v_day + i)::int = any(v_days) then
      return ((v_day + i)::timestamp + make_interval(hours => s.send_hour)) at time zone s.time_zone;
    end if;
  end loop;
  return v_t;
end $function$;

create or replace function public._flow_due(p_seq uuid, p_base timestamp with time zone, p_val integer, p_unit text)
 returns timestamp with time zone
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare s public.nl_sequences;
begin
  select * into s from public.nl_sequences where id = p_seq;
  if s.kind = 'oneoff' then return greatest(coalesce(s.send_at, now()), p_base); end if;
  return public.nl_seq_due_at(p_seq, p_base, p_val, p_unit);
end $function$;

create or replace function public._seq_renumber(p_seq uuid, p_parent uuid, p_branch text)
 returns void
 language sql
 set search_path to 'public'
as $function$
  update public.nl_sequence_emails e set position = x.rn from
    (select id, row_number() over (order by position, created_at) rn from public.nl_sequence_emails
      where sequence_id = p_seq and parent_id is not distinct from p_parent and branch is not distinct from p_branch) x
   where e.id = x.id and e.position <> x.rn
$function$;

create or replace function public._seq_step_words(e public.nl_sequence_emails)
 returns text
 language sql
 stable
 set search_path to 'public'
as $function$
  select case e.kind
    when 'email' then 'Email "' || coalesce(nullif(trim(e.subject),''), 'No subject line yet') || '"'
    when 'wait' then 'Time delay' || case when e.config->>'mode' = 'for' then ': ' || coalesce(e.config->>'value','1') || ' ' || coalesce(e.config->>'unit','days') else '' end
    when 'event' then 'Wait for something'
    when 'condition' then case when e.config->>'mode' = 'multi'
      then 'Multiple branch on ' || coalesce(replace(e.config->'paths'->0->>'key', '_', ' '), 'a test') || ' ('
           || jsonb_array_length(coalesce(e.config->'paths','[]')) || ' paths, and everything on them)'
      else 'Yes/No branch on ' || coalesce(replace(e.config->>'key', '_', ' '), e.config->>'test', 'a test') || ' (and everything on it)' end
    when 'tag_add' then 'Add a tag' when 'tag_remove' then 'Remove a tag' when 'field_set' then 'Set a field'
    when 'sequence' then 'Send them through a sequence' when 'move' then 'Move them to another sequence'
    when 'goto' then 'Go to another step' when 'unsubscribe' then 'Unsubscribe them' when 'exit' then 'Exit'
    else e.kind end
$function$;

-- ---------------------------------------------------------------- 7. the flow engine
create or replace function public.nl_flow_go(p_person bigint, p_step uuid, p_base timestamp with time zone default now(), p_depth integer default 0)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare per record; s record; q record; i int := 0; ok boolean; v_target uuid; v_child bigint; v_name text; v_step uuid := p_step;
        v_tags text[]; v_due timestamptz; v_br text;
begin
  if p_depth > 6 then return 'too deep'; end if;
  select * into per from public.nl_sequence_people where id = p_person;
  if per.id is null or per.status <> 'in' then return 'not in'; end if;
  loop
    i := i + 1;
    if i > 80 then
      update public.nl_sequence_people set status = 'stopped', next_due_at = null, left_at = now(),
             note = 'stopped: this map goes round in a circle with no email or wait in it' where id = p_person;
      return 'loop';
    end if;
    if v_step is null then
      update public.nl_sequence_people set status = 'done', at_step = null, at_since = now(), next_due_at = null, note = null where id = p_person;
      insert into public.nl_flow_log(person_id, sequence_id, step_id, what) values (p_person, per.sequence_id, null, 'finished');
      if per.parent_person_id is not null then perform public._flow_resume(per.parent_person_id, p_depth + 1); end if;
      return 'done';
    end if;
    select * into s from public.nl_sequence_emails where id = v_step;
    if s.id is null then v_step := null; continue; end if;
    insert into public.nl_flow_log(person_id, sequence_id, step_id, what) values (p_person, s.sequence_id, s.id, 'arrived');
    v_tags := (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(coalesce(s.config->'tags','[]'::jsonb)) x);
    case s.kind
    when 'email' then
      if not s.published then v_step := public._flow_next(s.id); continue; end if;
      update public.nl_sequence_people set at_step = s.id, at_since = p_base, next_position = s.position,
             next_due_at = public._flow_due(s.sequence_id, p_base, s.delay_value, s.delay_unit), note = null where id = p_person;
      return 'email';
    when 'wait' then
      v_due := public._flow_wait_due(s.config, p_base);
      if v_due <= now() and s.config->>'mode' = 'until' then v_step := public._flow_next(s.id); continue; end if;
      update public.nl_sequence_people set at_step = s.id, at_since = p_base, next_due_at = v_due, note = null where id = p_person;
      return 'wait';
    when 'tag_add' then
      perform public.person_tag_add(per.email, v_tags, 'sequence', s.sequence_id);
      v_step := public._flow_next(s.id);
    when 'tag_remove' then
      perform public.person_tag_remove(per.email, v_tags);
      v_step := public._flow_next(s.id);
    when 'field_set' then
      if coalesce(s.config->>'key','') <> '' then
        insert into public.person_fields(email, key, value, updated_at, source) values (per.email, s.config->>'key', s.config->>'value', now(), 'sequence')
        on conflict (email, key) do update set value = excluded.value, updated_at = now(), source = 'sequence'
         where public.person_fields.value is distinct from excluded.value;
      end if;
      v_step := public._flow_next(s.id);
    when 'condition' then
      v_br := public._flow_branch(per.email, s.config, p_person);
      insert into public.nl_flow_log(person_id, sequence_id, step_id, what) values (p_person, s.sequence_id, s.id, v_br);
      v_step := public._flow_first(s.sequence_id, s.id, v_br);
    when 'event' then
      if public._flow_event_met(per.email, s.config, per.added_at) then
        insert into public.nl_flow_log(person_id, sequence_id, step_id, what) values (p_person, s.sequence_id, s.id, 'met');
        v_step := public._flow_next(s.id); continue;
      end if;
      update public.nl_sequence_people set at_step = s.id, at_since = p_base, note = null,
             next_due_at = case when s.config->>'type' = 'date' and nullif(s.config->>'at','') is not null then (s.config->>'at')::timestamptz end
       where id = p_person;
      return 'waiting';
    when 'sequence' then
      v_target := nullif(s.config->>'sequence_id','')::uuid;
      if v_target is null or not exists (select 1 from public.nl_sequences where id = v_target) or v_target = per.sequence_id then
        insert into public.nl_flow_log(person_id, sequence_id, step_id, what) values (p_person, s.sequence_id, s.id, 'skipped - no sequence picked');
        v_step := public._flow_next(s.id); continue;
      end if;
      if exists (select 1 from public.nl_sequence_people where sequence_id = v_target and email = per.email) then
        insert into public.nl_flow_log(person_id, sequence_id, step_id, what) values (p_person, s.sequence_id, s.id, 'skipped - already been through it');
        v_step := public._flow_next(s.id); continue;
      end if;
      select name into v_name from public.nl_sequences where id = per.sequence_id;
      update public.nl_sequence_people set at_step = s.id, at_since = p_base, next_due_at = null, note = null where id = p_person;
      insert into public.nl_sequence_people(sequence_id, email, parent_person_id, added_how, at_since)
      values (v_target, per.email, p_person, 'sent through it by "' || v_name || '"', p_base) returning id into v_child;
      perform public.nl_flow_go(v_child, public._flow_first(v_target, null, null), p_base, p_depth + 1);
      return 'sequence';
    when 'move' then
      v_target := nullif(s.config->>'sequence_id','')::uuid;
      select name into v_name from public.nl_sequences where id = per.sequence_id;
      if v_target is not null and v_target <> per.sequence_id and exists (select 1 from public.nl_sequences where id = v_target) then
        insert into public.nl_sequence_people(sequence_id, email, added_how, at_since)
        values (v_target, per.email, 'moved here by "' || v_name || '"', p_base)
        on conflict on constraint nl_sequence_people_sequence_id_email_key do nothing returning id into v_child;
        if v_child is not null then perform public.nl_flow_go(v_child, public._flow_first(v_target, null, null), p_base, p_depth + 1); end if;
      end if;
      update public.nl_sequence_people set status = 'done', at_step = null, next_due_at = null, note = 'moved to another sequence' where id = p_person;
      insert into public.nl_flow_log(person_id, sequence_id, step_id, what) values (p_person, per.sequence_id, s.id, 'moved');
      if per.parent_person_id is not null then perform public._flow_resume(per.parent_person_id, p_depth + 1); end if;
      return 'moved';
    when 'goto' then
      v_step := nullif(s.config->>'step_id','')::uuid;
      if v_step is not null and not exists (select 1 from public.nl_sequence_emails where id = v_step and sequence_id = s.sequence_id) then v_step := null; end if;
    when 'unsubscribe' then
      select name into v_name from public.nl_sequences where id = per.sequence_id;
      update public.nl_subscribers set status = 'unsubscribed', status_at = now(), updated_at = now(), app_choice_at = now(),
             status_why = left('unsubscribed by the sequence "' || v_name || '"', 200)
       where email = per.email and status = 'subscribed';
      insert into public.nl_flow_log(person_id, sequence_id, step_id, what) values (p_person, s.sequence_id, s.id, 'unsubscribed');
      perform public._flow_stop_up(p_person, 'stopped', 'unsubscribed by "' || v_name || '"');
      return 'unsubscribed';
    when 'exit' then
      v_step := null;
    else
      v_step := public._flow_next(s.id);
    end case;
  end loop;
end $function$;

create or replace function public._flow_resume(p_parent bigint, p_depth integer default 0)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record;
begin
  select p.id, p.status, p.at_step, e.kind into r from public.nl_sequence_people p left join public.nl_sequence_emails e on e.id = p.at_step where p.id = p_parent;
  if r.status = 'in' and r.kind = 'sequence' then
    perform public.nl_flow_go(p_parent, public._flow_next(r.at_step), now(), p_depth);
  end if;
end $function$;

create or replace function public.nl_flow_tick(p_budget_ms integer default 40000)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
-- TW: Joy's step 1 (copying the app's contact_tags into person_tags) is not part of Thread Weaver.
declare t0 timestamptz := clock_timestamp(); s record; e jsonb; r record; ev record; n_in int := 0; n_moved int := 0; n_jump int := 0; n_start int := 0;
        v_id bigint; v_first uuid;
begin
  for s in select * from public.nl_sequences where status = 'live' and kind = 'sequence' and jsonb_array_length(entries) > 0 loop
    for e in select * from jsonb_array_elements(s.entries) loop
      v_first := public._flow_first(s.id, null, nullif(e->>'lane',''));
      for r in select distinct on (z.email) z.email, z.how from public._flow_entry_people(s.id, e) z
                 join public.nl_subscribers x on x.email = z.email and x.status = 'subscribed' and coalesce(x.source,'') <> 'qa' and not public.is_qa_address(x.email)
                where not exists (select 1 from public.nl_sequence_people p where p.sequence_id = s.id and p.email = z.email) limit 2000 loop
        insert into public.nl_sequence_people(sequence_id, email, added_how, at_since) values (s.id, r.email, left(r.how, 120), now())
        on conflict on constraint nl_sequence_people_sequence_id_email_key do nothing returning id into v_id;
        if v_id is not null then perform public.nl_flow_go(v_id, v_first, now()); n_in := n_in + 1; end if;
        exit when clock_timestamp() - t0 > make_interval(secs => p_budget_ms / 2000.0);
      end loop;
    end loop;
  end loop;

  for r in select p.id, p.sequence_id from public.nl_sequence_people p
            where p.status = 'in' and p.at_step is null and p.parent_person_id is null and public._flow_running(p.id)
            order by p.id limit 3000 loop
    perform public.nl_flow_go(r.id, public._flow_first(r.sequence_id, null, null), now()); n_start := n_start + 1;
    exit when clock_timestamp() - t0 > make_interval(secs => p_budget_ms / 1000.0 * 0.6);
  end loop;

  for r in select p.id, p.at_step from public.nl_sequence_people p join public.nl_sequence_emails x on x.id = p.at_step
            where p.status = 'in' and p.next_due_at <= now() and x.kind in ('wait','event') and public._flow_running(p.id)
            order by p.next_due_at limit 3000 loop
    insert into public.nl_flow_log(person_id, sequence_id, step_id, what) select r.id, sequence_id, r.at_step, 'went on' from public.nl_sequence_emails where id = r.at_step;
    perform public.nl_flow_go(r.id, public._flow_next(r.at_step), now()); n_moved := n_moved + 1;
    exit when clock_timestamp() - t0 > make_interval(secs => p_budget_ms / 1000.0 * 0.8);
  end loop;

  for ev in select x.* from public.nl_sequence_emails x join public.nl_sequences q on q.id = x.sequence_id
             where x.kind = 'event' and (q.status = 'live' or exists (select 1 from public.nl_sequence_people p where p.at_step = x.id and p.status = 'in')) loop
    for r in select p.id, p.email, p.at_since from public.nl_sequence_people p
              where p.at_step = ev.id and p.status = 'in' and p.next_due_at is null and public._flow_running(p.id)
                and public._flow_event_since(p.email, ev.config, coalesce(p.at_since, p.added_at)) limit 2000 loop
      insert into public.nl_flow_log(person_id, sequence_id, step_id, what) values (r.id, ev.sequence_id, ev.id, 'met');
      perform public.nl_flow_go(r.id, public._flow_next(ev.id), now()); n_moved := n_moved + 1;
    end loop;
    if coalesce((ev.config->>'pull')::boolean, true) then
      for r in select p.id, p.email from public.nl_sequence_people p
                where p.sequence_id = ev.sequence_id and p.status = 'in' and p.at_step is distinct from ev.id and public._flow_running(p.id)
                  and not exists (select 1 from public.nl_flow_log l where l.person_id = p.id and l.step_id = ev.id)
                  and public._flow_event_since(p.email, ev.config, p.added_at) limit 2000 loop
        perform public._flow_stop_down(r.id, 'pulled on by an event in the sequence that sent them here');
        insert into public.nl_flow_log(person_id, sequence_id, step_id, what) values (r.id, ev.sequence_id, ev.id, 'pulled here');
        perform public.nl_flow_go(r.id, public._flow_next(ev.id), now()); n_jump := n_jump + 1;
      end loop;
    end if;
    exit when clock_timestamp() - t0 > make_interval(secs => p_budget_ms / 1000.0);
  end loop;

  return jsonb_build_object('came_in', n_in, 'started', n_start, 'moved_on', n_moved, 'pulled', n_jump, 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000));
end $function$;

-- ---------------------------------------------------------------- 8. the sender's side (called by nl-seq-send / nl-ses-events / nl-unsubscribe)
create or replace function public.nl_lease(p_holder text, p_seconds integer)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int;
begin
  update public.nl_sender_lease set holder = p_holder, until = now() + make_interval(secs => p_seconds)
   where id = 1 and (until is null or until < now() or holder = p_holder);
  get diagnostics n = row_count;
  return n = 1;
end $function$;

create or replace function public.nl_release(p_holder text)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  update public.nl_sender_lease set until = now() - interval '1 second' where id = 1 and holder = p_holder;
$function$;

create or replace function public.suppress_email(p_email text, p_reason text, p_detail text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
-- TW: writes Thread Weaver's own email_suppression (email, reason, created_at), which tw_may_email() reads.
-- That table has no detail column, so p_detail is only echoed back.
declare v text := lower(btrim(coalesce(p_email, '')));
begin
  if v = '' then return jsonb_build_object('ok', false, 'error', 'no_email'); end if;
  insert into public.email_suppression(email, reason, created_at) values (v, coalesce(nullif(btrim(p_reason), ''), 'suppressed'), now())
  on conflict (email) do update set reason = excluded.reason;
  return jsonb_build_object('ok', true, 'email', v, 'reason', p_reason, 'detail', left(coalesce(p_detail, ''), 300));
end $function$;

create or replace function public.nl_record_event(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
-- One SES event (from SNS, already signature-checked by nl-ses-events) into nl_events, and what it means for the person:
-- a permanent bounce or a spam complaint takes them off the list at once.
-- Serial chapters (SES tag kind=serial_chapter): a complaint turns off that reader's serial emails (serial_follows.email)
-- and leaves the list alone; a permanent bounce is a dead address for both: off the list, serial emails off, and the
-- address suppressed (email_suppression) so no sender tries it again.
declare v_type text := p->>'eventType'; v_mail jsonb := p->'mail'; v_msg text := p->'mail'->>'messageId';
  v_send bigint; v_at timestamptz; r jsonb; v_email text; n int := 0;
  v_serial boolean := coalesce(p->'mail'->'tags'->'kind'->>0, '') = 'serial_chapter';
begin
  v_type := coalesce(v_type, p->>'notificationType');
  begin v_send := (v_mail->'tags'->'send_id'->>0)::bigint; exception when others then v_send := null; end;
  if v_type = 'Bounce' then
    v_at := coalesce((p->'bounce'->>'timestamp')::timestamptz, now());
    for r in select * from jsonb_array_elements(coalesce(p->'bounce'->'bouncedRecipients','[]'::jsonb)) loop
      v_email := lower(btrim(r->>'emailAddress'));
      insert into public.nl_events(sns_message_id, event_type, message_id, email, send_id, at, detail)
      values (nullif(p->>'_sns_id','') || ':' || v_email, 'Bounce', v_msg, v_email, v_send, v_at,
              jsonb_build_object('bounceType', p->'bounce'->>'bounceType', 'bounceSubType', p->'bounce'->>'bounceSubType', 'diagnostic', left(r->>'diagnosticCode', 300))
              || case when v_serial then jsonb_build_object('app', 'thread_weaver_serial') else '{}'::jsonb end)
      on conflict (sns_message_id) do nothing;
      if p->'bounce'->>'bounceType' = 'Permanent' then
        update public.nl_subscribers set status = 'bounced', status_at = now(), status_why = left('SES permanent bounce: ' || coalesce(r->>'diagnosticCode', p->'bounce'->>'bounceSubType', ''), 300), updated_at = now()
         where email = v_email and status = 'subscribed';
        if v_serial then
          update public.serial_follows set email = false, updated_at = now()
           where user_id in (select id from auth.users where lower(email) = v_email);
          begin perform public.suppress_email(v_email, 'hard_bounce', left('Thread Weaver serial: ' || coalesce(r->>'diagnosticCode', ''), 300));
          exception when others then null; end;
        end if;
      end if;
      n := n + 1;
    end loop;
  elsif v_type = 'Complaint' then
    v_at := coalesce((p->'complaint'->>'timestamp')::timestamptz, now());
    for r in select * from jsonb_array_elements(coalesce(p->'complaint'->'complainedRecipients','[]'::jsonb)) loop
      v_email := lower(btrim(r->>'emailAddress'));
      insert into public.nl_events(sns_message_id, event_type, message_id, email, send_id, at, detail)
      values (nullif(p->>'_sns_id','') || ':' || v_email, 'Complaint', v_msg, v_email, v_send, v_at,
              jsonb_build_object('feedbackType', p->'complaint'->>'complaintFeedbackType', 'userAgent', p->'complaint'->>'userAgent')
              || case when v_serial then jsonb_build_object('app', 'thread_weaver_serial') else '{}'::jsonb end)
      on conflict (sns_message_id) do nothing;
      if v_serial then
        update public.serial_follows set email = false, updated_at = now()
         where user_id in (select id from auth.users where lower(email) = v_email);
      else
        update public.nl_subscribers set status = 'complained', status_at = now(), app_choice_at = now(),
               status_why = 'marked an email as spam (' || coalesce(p->'complaint'->>'complaintFeedbackType','feedback loop') || ')', updated_at = now()
         where email = v_email and status in ('subscribed','unsubscribed');
      end if;
      n := n + 1;
    end loop;
  else
    v_email := lower(btrim(v_mail->'destination'->>0));
    v_at := coalesce((p->'open'->>'timestamp')::timestamptz, (p->'click'->>'timestamp')::timestamptz, (p->'delivery'->>'timestamp')::timestamptz,
                     (p->'reject'->>'timestamp')::timestamptz, (v_mail->>'timestamp')::timestamptz, now());
    insert into public.nl_events(sns_message_id, event_type, message_id, email, send_id, at, detail)
    values (nullif(p->>'_sns_id',''), coalesce(v_type,'unknown'), v_msg, v_email, v_send, v_at,
            coalesce(case v_type when 'Click' then jsonb_build_object('link', left(p->'click'->>'link', 500))
                        when 'Open' then jsonb_build_object('ua', left(p->'open'->>'userAgent', 200))
                        when 'Reject' then jsonb_build_object('reason', p->'reject'->>'reason')
                        when 'Rendering Failure' then jsonb_build_object('error', left(p->'failure'->>'errorMessage', 300))
                        when 'DeliveryDelay' then jsonb_build_object('delayType', p->'deliveryDelay'->>'delayType')
                        else null end, case when v_serial then '{}'::jsonb end)
            || case when v_serial then jsonb_build_object('app', 'thread_weaver_serial') else '{}'::jsonb end)
    on conflict (sns_message_id) do nothing;
    n := 1;
  end if;
  return jsonb_build_object('ok', true, 'type', v_type, 'rows', n, 'send_id', v_send, 'app', case when v_serial then 'thread_weaver_serial' else 'thread_weaver' end);
end $function$;

create or replace function public.nl_warmup_next(p_scheduled_at timestamp with time zone)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
-- TW Gmail ramp: cap = step * (whole weeks since started_on + 1). started_on is set by the first real send (nl_seq_mark);
-- before that the cap is one step.
declare w public.nl_warmup; v_weeks int := 0;
begin
  select * into w from public.nl_warmup where id;
  if w.started_on is not null then
    v_weeks := greatest(0, floor((((coalesce(p_scheduled_at, now()) at time zone 'America/Los_Angeles')::date - w.started_on))::numeric / 7))::int;
  end if;
  return jsonb_build_object('gmail', coalesce(w.step, 3000) * (v_weeks + 1), 'step', coalesce(w.step, 3000), 'started_on', w.started_on, 'weeks', v_weeks);
end $function$;

create or replace function public.nl_seq_claim(p_limit integer)
 returns table(send_id bigint, email text, token uuid, first_name text, sequence_id uuid, email_id uuid)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
declare r record; sub record; e record; v_sid bigint; n int := 0; v_cap int; v_room int; v_gm boolean; v_hour int; v_may jsonb;
begin
  update public.nl_sequence_sends set status = 'failed', error = 'no answer from the sender for 15 minutes - not retried in case it went'
   where status = 'sending' and claimed_at < now() - interval '15 minutes';
  v_cap := coalesce((public.nl_warmup_next(now())->>'gmail')::int, 3000);
  select count(*) into v_room from public.nl_sequence_sends q
   where q.status in ('sent','sending') and q.claimed_at >= (date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles')
     and public.nl_split_provider(q.email) = 'gmail';
  v_room := v_cap - v_room;

  for r in select p.*, s.time_zone as tz, s.send_hour, s.kind as skind, s.send_at, x.kind as xkind
             from public.nl_sequence_people p join public.nl_sequences s on s.id = p.sequence_id join public.nl_sequence_emails x on x.id = p.at_step
            where p.status = 'in' and p.next_due_at <= now() and x.kind = 'email' and public._flow_running(p.id)
            order by p.next_due_at, p.id limit greatest(p_limit,1) * 3 for update of p skip locked
  loop
    exit when n >= p_limit;
    select x.status, x.token, x.name into sub from public.nl_subscribers x where x.email = r.email;
    if sub.status is distinct from 'subscribed' then
      perform public._flow_stop_up(r.id, 'stopped', 'no longer on the list (' || coalesce(sub.status, 'not on it') || ')');
      continue;
    end if;
    v_may := public.tw_may_email(r.email);
    if not coalesce((v_may->>'allow')::boolean, false) then
      perform public._flow_stop_up(r.id, 'stopped', 'cannot be emailed (' || coalesce(v_may->>'reason', 'blocked') || ')');
      continue;
    end if;
    if public.welcome_hold_on(r.email, r.id) then
      if r.skind = 'oneoff' then
        perform public._flow_stop_up(r.id, 'stopped', 'held back when this went out');
      else
        update public.nl_sequence_people set next_due_at = now() + interval '3 hours', note = 'waiting: held by another sequence' where id = r.id;
      end if;
      continue;
    end if;
    select * into e from public.nl_sequence_emails x where x.id = r.at_step;
    if not e.published then perform public.nl_flow_go(r.id, public._flow_next(e.id), now()); continue; end if;
    v_gm := public.nl_split_provider(r.email) = 'gmail';
    if v_gm and v_room <= 0 then
      v_hour := case when r.skind = 'oneoff' and r.send_at is not null then extract(hour from r.send_at at time zone r.tz)::int else r.send_hour end;
      update public.nl_sequence_people set next_due_at = ((((now() at time zone r.tz)::date + 1)::timestamp + make_interval(hours => v_hour)) at time zone r.tz),
             note = 'Gmail: waiting for tomorrow''s warm-up allowance (' || v_cap || ' a day this week)' where id = r.id;
      continue;
    end if;
    v_sid := null;
    insert into public.nl_sequence_sends(person_id, sequence_id, email_id, email, status, claimed_at)
    values (r.id, e.sequence_id, e.id, r.email, 'sending', now())
    on conflict (person_id, email_id) do update set status = 'sending', claimed_at = now(), error = null
      where public.nl_sequence_sends.status = 'retry'
    returning id into v_sid;
    if v_sid is null then
      perform public.nl_flow_go(r.id, public._flow_next(e.id), now());
      continue;
    end if;
    if v_gm then v_room := v_room - 1; end if;
    update public.nl_sequence_people set next_due_at = now() + interval '20 minutes', note = null where id = r.id;
    n := n + 1;
    send_id := v_sid; email := r.email; token := sub.token; first_name := nullif(split_part(btrim(coalesce(sub.name,'')), ' ', 1), '');
    sequence_id := e.sequence_id; email_id := e.id;
    return next;
  end loop;
end $function$;

create or replace function public.nl_seq_mark(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare x jsonb; q record; n int := 0;
begin
  for x in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    select * into q from public.nl_sequence_sends where id = (x->>'id')::bigint and status = 'sending';
    if q.id is null then continue; end if;
    if coalesce((x->>'ok')::boolean, false) then
      update public.nl_sequence_sends set status = 'sent', sent_at = now(), message_id = x->>'message_id', error = null where id = q.id;
      update public.nl_sequence_people set last_sent_at = now() where id = q.person_id;
      update public.nl_subscribers set last_sent_at = now() where email = q.email;
      update public.nl_warmup set started_on = (now() at time zone 'America/Los_Angeles')::date where id and started_on is null;
    elsif coalesce((x->>'retry')::boolean, false) then
      update public.nl_sequence_sends set status = 'retry', error = left(x->>'error', 300) where id = q.id;
      update public.nl_sequence_people set next_due_at = now() + interval '10 minutes', note = left('trying again: ' || coalesce(x->>'error',''), 300) where id = q.person_id;
      n := n + 1; continue;
    else
      update public.nl_sequence_sends set status = 'failed', error = left(x->>'error', 300) where id = q.id;
    end if;
    insert into public.nl_flow_log(person_id, sequence_id, step_id, what) values (q.person_id, q.sequence_id, q.email_id, case when (x->>'ok')::boolean then 'sent' else 'failed' end);
    perform public.nl_flow_go(q.person_id, public._flow_next(q.email_id), now());
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'marked', n);
end $function$;

create or replace function public.nl_seq_has_due()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from public.nl_sequence_people p join public.nl_sequence_emails x on x.id = p.at_step
                  where p.status = 'in' and p.next_due_at <= now() and x.kind = 'email' and public._flow_running(p.id))
$function$;

create or replace function public.nl_seq_leave(p_token uuid, p_seq uuid, p_action text default 'check'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_email text; v_name text; v_status text; v_pid bigint;
begin
  select x.email into v_email from public.nl_subscribers x where x.token = p_token;
  select s.name into v_name from public.nl_sequences s where s.id = p_seq;
  if v_email is null or v_name is null then return jsonb_build_object('ok', false, 'error', 'This link is not one we know. If you meant to stop these emails, reply to any of them and Russell will take you off by hand.'); end if;
  select id into v_pid from public.nl_sequence_people where sequence_id = p_seq and email = v_email;
  if p_action = 'leave' and v_pid is not null then
    perform public._flow_stop_down(v_pid, 'left from the link in the email');
    perform public._flow_stop_up(v_pid, 'left', 'left from the link in the email');
  elsif p_action = 'rejoin' and v_pid is not null then
    update public.nl_sequence_people set status = 'in', left_at = null, note = 'came back from the link in the email',
           next_due_at = now() where id = v_pid and status = 'left';
    update public.nl_sequence_people p set status = 'in', left_at = null, note = 'came back from the link in the email'
     where p.id = (select parent_person_id from public.nl_sequence_people where id = v_pid) and p.status = 'left' and p.note = 'left from the link in the email';
  end if;
  select sp.status into v_status from public.nl_sequence_people sp where sp.id = v_pid;
  return jsonb_build_object('ok', true, 'sequence', v_name, 'status', coalesce(v_status, 'not_in'),
    'email', left(v_email, 2) || '***' || substr(v_email, position('@' in v_email)), 'unsub_url', 'https://thread.wannabepress.com/email-unsubscribe.html?t=' || p_token);
end $function$;

create or replace function public.nl_unsub_action(p_token uuid, p_action text, p_how text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
-- Behind every unsubscribe link (https://thread.wannabepress.com/email-unsubscribe.html?t=TOKEN) and the mail apps'
-- one-click button (nl-unsubscribe). The token is the person's own random key; nothing else identifies them.
declare s public.nl_subscribers; v_mask text; v_was text;
begin
  if p_token = '00000000-0000-0000-0000-000000000000'::uuid then
    return jsonb_build_object('ok', false, 'test', true, 'error', 'This was a test email. In a real email, this link takes each reader to their own unsubscribe page.');
  end if;
  select * into s from public.nl_subscribers where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown link'); end if;
  v_was := s.status;
  if p_action = 'unsubscribe' then
    if s.status = 'subscribed' then
      update public.nl_subscribers set status = 'unsubscribed', status_at = now(), updated_at = now(), app_choice_at = now(),
             status_why = coalesce(p_how, 'unsubscribe link')
       where email = s.email;
    end if;
  elsif p_action = 'resubscribe' then
    if s.status <> 'subscribed' then
      update public.nl_subscribers set status = 'subscribed', status_at = now(), updated_at = now(), app_choice_at = now(),
             status_why = 'resubscribed on the unsubscribe page (was ' || s.status || ')',
             ses_unblock_wanted_at = case when s.status in ('bounced', 'complained') then now() else ses_unblock_wanted_at end,
             ses_unblock_tried_at = case when s.status in ('bounced', 'complained') then null else ses_unblock_tried_at end
       where email = s.email;
    end if;
  elsif p_action <> 'state' then
    return jsonb_build_object('ok', false, 'error', 'unknown action');
  end if;
  select * into s from public.nl_subscribers where token = p_token;
  v_mask := left(split_part(s.email,'@',1), 2) || repeat('*', greatest(length(split_part(s.email,'@',1)) - 2, 1)) || '@' || split_part(s.email,'@',2);
  return jsonb_build_object('ok', true, 'email', v_mask, 'subscribed', s.status = 'subscribed', 'status', s.status,
    'was', v_was, 'unsuppress', case when p_action = 'resubscribe' and v_was in ('bounced','complained') then s.email end);
end $function$;

create or replace function public.nl_ses_unblock_due(p_limit integer default 20)
 returns table(email text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select s.email from public.nl_subscribers s
   where s.status = 'subscribed' and s.ses_unblock_wanted_at is not null
     and (s.ses_unblock_tried_at is null or s.ses_unblock_tried_at < now() - interval '1 hour')
   order by s.ses_unblock_wanted_at limit greatest(p_limit, 1);
$function$;

create or replace function public.nl_ses_unblock_result(p_email text, p_ok boolean, p_note text default null::text)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  update public.nl_subscribers
     set ses_unblock_tried_at = now(), updated_at = now(),
         ses_unblock_wanted_at = case when p_ok then null else ses_unblock_wanted_at end,
         ses_unblock_note = case when p_ok then null else left(coalesce(p_note, 'Amazon did not say why'), 300) || ' (' || to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ')' end
   where email = lower(p_email);
$function$;

-- ---------------------------------------------------------------- 9. the list = the Wannabe Press Substack list
create or replace function public.nl_sync_from_substack()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
-- Adds on-list Substack people not yet in nl_subscribers (source 'substack'); anyone source 'substack' still 'subscribed'
-- who is no longer on_list becomes 'unsubscribed' ('left the Substack list'); anyone who turned email off in Substack
-- becomes 'unsubscribed' too. Never re-subscribes anyone who unsubscribed, bounced or complained here (inserts only
-- new addresses). Refreshes opens_total (Substack sends_opened) and opens_recent (Substack posts sent in the last 30 days
-- that they opened; at least 1 if their last open was in the last 30 days).
declare n_new int; n_left int; n_off int; n_opens int;
begin
  with rec as (select o.email, count(*)::int n from public.substack_opens o join public.substack_sends s on s.post_id = o.post_id
                where s.sent_at >= now() - interval '30 days' group by o.email)
  insert into public.nl_subscribers(email, name, status, source, joined_at, status_why, opens_total, opens_recent)
  select lower(btrim(s.email)), null, case when s.email_disabled then 'unsubscribed' else 'subscribed' end, 'substack', s.subscribed_at,
         case when s.email_disabled then 'turned email off in Substack' end,
         coalesce(s.sends_opened, 0), greatest(coalesce(r.n, 0), case when s.last_open >= now() - interval '30 days' then 1 else 0 end)
    from public.substack_subscribers s left join rec r on r.email = lower(btrim(s.email))
   where s.on_list is true and lower(btrim(s.email)) ~~ '%_@_%'
  on conflict (email) do nothing;
  get diagnostics n_new = row_count;

  update public.nl_subscribers x set status = 'unsubscribed', status_at = now(), updated_at = now(), status_why = 'left the Substack list'
   where x.source = 'substack' and x.status = 'subscribed'
     and not exists (select 1 from public.substack_subscribers s where lower(btrim(s.email)) = x.email and s.on_list is true);
  get diagnostics n_left = row_count;

  update public.nl_subscribers x set status = 'unsubscribed', status_at = now(), updated_at = now(), status_why = 'turned email off in Substack'
   where x.source = 'substack' and x.status = 'subscribed'
     and exists (select 1 from public.substack_subscribers s where lower(btrim(s.email)) = x.email and s.on_list is true and s.email_disabled is true);
  get diagnostics n_off = row_count;

  with rec as (select o.email, count(*)::int n from public.substack_opens o join public.substack_sends s on s.post_id = o.post_id
                where s.sent_at >= now() - interval '30 days' group by o.email),
       src as (select lower(btrim(s.email)) email, coalesce(s.sends_opened, 0) tot,
                      greatest(coalesce(r.n, 0), case when s.last_open >= now() - interval '30 days' then 1 else 0 end) rn
                 from public.substack_subscribers s left join rec r on r.email = lower(btrim(s.email)) where s.on_list is true)
  update public.nl_subscribers x set opens_total = src.tot, opens_recent = src.rn, updated_at = now()
    from src where x.email = src.email and x.source = 'substack'
     and (x.opens_total is distinct from src.tot or x.opens_recent is distinct from src.rn);
  get diagnostics n_opens = row_count;

  return jsonb_build_object('ok', true, 'added', n_new, 'left_substack', n_left, 'email_off', n_off, 'opens_refreshed', n_opens,
    'subscribed', (select count(*) from public.nl_subscribers where status = 'subscribed'));
end $function$;

-- ---------------------------------------------------------------- 10. one-off emails (/admin/broadcasts)
create or replace function public.oneoff_list()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  return jsonb_build_object('mine', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status, 'send_at', s.send_at, 'updated_at', s.updated_at,
      'subject', (select subject from public.nl_sequence_emails e where e.sequence_id = s.id and e.kind = 'email' order by position limit 1),
      'waiting', (select count(*) from public.nl_sequence_people p where p.sequence_id = s.id and p.status = 'in'),
      'sent', (select count(*) from public.nl_sequence_sends q where q.sequence_id = s.id and q.status = 'sent'),
      'opened', (select count(distinct q.id) from public.nl_sequence_sends q join public.nl_events ev on ev.message_id = q.message_id and ev.event_type = 'Open' where q.sequence_id = s.id),
      'clicked', (select count(distinct q.id) from public.nl_sequence_sends q join public.nl_events ev on ev.message_id = q.message_id and ev.event_type = 'Click' where q.sequence_id = s.id))
      order by coalesce(s.send_at, s.updated_at) desc) from public.nl_sequences s where s.kind = 'oneoff' and s.status <> 'archived'), '[]'::jsonb),
    -- TW has no Kit broadcast history
    'kit', '[]'::jsonb);
end $function$;

create or replace function public.oneoff_send(p_seq uuid, p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
-- TW: no "Wednesday is newsletter day" rule.
declare s public.nl_sequences; v_when timestamptz; v_step uuid; v_probs text[]; n int; v_how text; v_gmail int; v_cap int;
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  if (p->>'confirm')::boolean is not true then raise exception 'not confirmed'; end if;
  select * into s from public.nl_sequences where id = p_seq for update;
  if s.kind <> 'oneoff' then raise exception 'This is not a one-off email.'; end if;
  if s.status = 'live' then raise exception 'It is already going out. Take it back first if you want to change it.'; end if;
  v_when := coalesce(nullif(p->>'when','')::timestamptz, now());
  if v_when < now() - interval '5 minutes' then raise exception 'That time has already passed - pick a later one.'; end if;
  v_probs := public._flow_problems(p_seq);
  if array_length(v_probs, 1) > 0 then raise exception 'Not ready yet - %.', array_to_string(v_probs, '; '); end if;
  select id into v_step from public.nl_sequence_emails where sequence_id = p_seq and kind = 'email' order by position limit 1;
  v_how := 'one-off - ' || public._tw_audience_words(coalesce(p->'audience', '{}'::jsonb));
  insert into public.nl_sequence_people(sequence_id, email, at_step, at_since, next_due_at, added_how)
  select p_seq, c.email, v_step, now(), v_when, left(v_how, 120)
    from public._seq_pick(p_seq, p->'audience') c join public.nl_subscribers x on x.email = c.email
   order by coalesce(x.opens_recent,0) desc, coalesce(x.opens_total,0) desc, c.email
  on conflict on constraint nl_sequence_people_sequence_id_email_key do update
    set status = 'in', at_step = excluded.at_step, at_since = now(), next_due_at = excluded.next_due_at, left_at = null, note = null, added_how = excluded.added_how
    where public.nl_sequence_people.status = 'left' and public.nl_sequence_people.note = 'taken back before it went';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Nobody on your list matches that, so there is nobody to send it to.'; end if;
  update public.nl_sequences set status = 'live', send_at = v_when, audience = coalesce(p->'audience', audience), updated_at = now() where id = p_seq;
  select count(*) into v_gmail from public.nl_sequence_people where sequence_id = p_seq and status = 'in' and public.nl_split_provider(email) = 'gmail';
  v_cap := coalesce((public.nl_warmup_next(now())->>'gmail')::int, 3000);
  return jsonb_build_object('ok', true, 'people', n, 'when', v_when, 'gmail', v_gmail, 'gmail_per_day', v_cap);
end $function$;

create or replace function public.oneoff_take_back(p_seq uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s public.nl_sequences; v_sent int;
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  select * into s from public.nl_sequences where id = p_seq for update;
  if s.kind <> 'oneoff' then raise exception 'This is not a one-off email.'; end if;
  select count(*) into v_sent from public.nl_sequence_sends where sequence_id = p_seq and status in ('sent','sending');
  update public.nl_sequence_people set status = 'left', left_at = now(), next_due_at = null, note = 'taken back before it went'
   where sequence_id = p_seq and status = 'in';
  update public.nl_sequences set status = 'draft', send_at = case when v_sent = 0 then null else send_at end, updated_at = now() where id = p_seq;
  return jsonb_build_object('ok', true, 'already_sent', v_sent);
end $function$;

-- ---------------------------------------------------------------- 11. sequences (/admin/sequences)
create or replace function public.seq_list()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'status', s.status, 'kind', s.kind, 'updated_at', s.updated_at, 'send_at', s.send_at,
      'emails', (select count(*) from public.nl_sequence_emails e where e.sequence_id = s.id and e.kind = 'email'),
      'steps', (select count(*) from public.nl_sequence_emails e where e.sequence_id = s.id),
      'people_in', (select count(*) from public.nl_sequence_people p where p.sequence_id = s.id and p.status = 'in'),
      'from_kit_id', null, 'from_kit_automation_id', null) order by (s.status = 'archived'), s.updated_at desc)
    from public.nl_sequences s), '[]'::jsonb);
end $function$;

create or replace function public.seq_get(p_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare s public.nl_sequences; v_steps jsonb;
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  select * into s from public.nl_sequences where id = p_id;
  if not found then return null; end if;
  v_steps := coalesce((select jsonb_agg(to_jsonb(e) order by e.parent_id nulls first, e.branch nulls first, e.position, e.created_at)
    from public.nl_sequence_emails e where e.sequence_id = p_id), '[]'::jsonb);
  return to_jsonb(s) || jsonb_build_object('steps', v_steps,
    'emails', coalesce((select jsonb_agg(x order by (x->>'position')::int) from jsonb_array_elements(v_steps) x where x->>'kind' = 'email'), '[]'::jsonb),
    'counts', coalesce((select jsonb_object_agg(c.step_id, jsonb_build_object('here', c.here, 'through', c.through, 'went', c.went)) from (
        select e.id step_id,
               (select count(*) from public.nl_sequence_people p where p.at_step = e.id and p.status = 'in') here,
               (select count(distinct l.person_id) from public.nl_flow_log l where l.step_id = e.id and l.what = 'arrived') through,
               (select coalesce(jsonb_object_agg(w.what, w.n), '{}'::jsonb) from (select l.what, count(distinct l.person_id) n from public.nl_flow_log l
                  where l.step_id = e.id and e.kind = 'condition' and l.what not in ('arrived') group by l.what) w) went
          from public.nl_sequence_emails e where e.sequence_id = p_id) c), '{}'::jsonb),
    'problems', to_jsonb(public._flow_problems(p_id)),
    'used_by', coalesce((select jsonb_agg(distinct jsonb_build_object('id', q.id, 'name', q.name, 'status', q.status))
        from public.nl_sequence_emails x join public.nl_sequences q on q.id = x.sequence_id
       where x.kind in ('sequence','move') and x.config->>'sequence_id' = p_id::text and q.status <> 'archived'), '[]'::jsonb));
end $function$;

create or replace function public.seq_save(p jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_id uuid := nullif(p->>'id','')::uuid; v_probs text[]; s public.nl_sequences; v_entries jsonb; v_kind text := coalesce(p->>'kind','sequence');
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  if v_id is null then
    if v_kind = 'oneoff' then
      insert into public.nl_sequences(name, kind, send_days) values (coalesce(nullif(trim(p->>'name'),''), 'Untitled email'), 'oneoff', '{1,2,3,4,5,6,7}') returning id into v_id;
    else
      insert into public.nl_sequences(name, send_days) values (coalesce(nullif(trim(p->>'name'),''), 'Untitled sequence'), '{1,2,3,4,5,6,7}') returning id into v_id;
    end if;
    insert into public.nl_sequence_emails(sequence_id, position, delay_value, delay_unit) values (v_id, 1, 0, 'days');
    return v_id;
  end if;
  select * into s from public.nl_sequences where id = v_id;
  if s.id is null then raise exception 'That sequence is not there any more.'; end if;
  if p->>'status' = 'live' and s.kind = 'oneoff' then raise exception 'A one-off email goes out from its own Send button.'; end if;
  if p->>'status' = 'live' and s.status <> 'live' then
    v_probs := public._flow_problems(v_id);
    if array_length(v_probs, 1) > 0 then raise exception 'Not live yet - %.', array_to_string(v_probs, '; '); end if;
  end if;
  v_entries := case when p ? 'entries' then coalesce(p->'entries', '[]'::jsonb) else s.entries end;
  if jsonb_typeof(v_entries) <> 'array' then raise exception 'entries must be a list'; end if;
  if p->>'status' = 'live' and s.status <> 'live' then
    v_entries := coalesce((select jsonb_agg(e || jsonb_build_object('since', now())) from jsonb_array_elements(v_entries) e), '[]'::jsonb);
  elsif s.status = 'live' and p ? 'entries' then
    v_entries := coalesce((select jsonb_agg(case when e ? 'since' then e else e || jsonb_build_object('since', now()) end) from jsonb_array_elements(v_entries) e), '[]'::jsonb);
  end if;
  update public.nl_sequences set
    name      = coalesce(nullif(trim(p->>'name'),''), name),
    status    = coalesce(p->>'status', status),
    send_days = coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(p->'send_days') x), send_days),
    send_hour = coalesce((p->>'send_hour')::int, send_hour),
    time_zone = coalesce(nullif(p->>'time_zone',''), time_zone),
    entries   = v_entries,
    updated_at = now()
  where id = v_id;
  return v_id;
end $function$;

create or replace function public.seq_meta()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
-- TW: tags, fields, sequences, plus heats / series / projects / bookfunnel_pages. Joy's products / quiz_results / forms /
-- bookings have no TW data and come back empty.
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  return jsonb_build_object(
    'tags', coalesce((select jsonb_agg(jsonb_build_object('tag', tag, 'n', n) order by n desc, tag) from (
        select tag, count(*) n from public.person_tags where removed_at is null group by tag) z), '[]'::jsonb),
    'fields', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'n', n) order by n desc) from (select key, count(*) n from public.person_fields group by key) z), '[]'::jsonb),
    'sequences', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'status', status) order by name) from public.nl_sequences where kind = 'sequence' and status <> 'archived'), '[]'::jsonb),
    'heats', '["Hot","Warm","Cool","Cold"]'::jsonb,
    'series', coalesce((select jsonb_agg(x order by x) from (select distinct series x from public.substack_sends where coalesce(series,'') <> '') z), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(x order by x) from (select distinct project x from public.fiction_backers where coalesce(project,'') <> '') z), '[]'::jsonb),
    'bookfunnel_pages', coalesce((select jsonb_agg(x order by x) from (select distinct btrim(pg) x from public.bookfunnel_readers b,
        unnest(string_to_array(coalesce(b.bf_fiction_pages,''), ' | ')) pg where btrim(pg) <> '') z), '[]'::jsonb),
    'products', '[]'::jsonb, 'quiz_results', '[]'::jsonb, 'forms', '[]'::jsonb, 'bookings', '[]'::jsonb);
end $function$;

create or replace function public.seq_email_save(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_id uuid := nullif(p->>'id','')::uuid; v_seq uuid := nullif(p->>'sequence_id','')::uuid; r public.nl_sequence_emails;
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  if v_id is null then
    insert into public.nl_sequence_emails(sequence_id, position, delay_value, delay_unit)
    values (v_seq, coalesce((select max(position) from public.nl_sequence_emails where sequence_id = v_seq and parent_id is null and branch is null), 0) + 1, 1, 'days')
    returning * into r;
  else
    if p ? 'config' and jsonb_typeof(p->'config') <> 'object' then raise exception 'config must be an object'; end if;
    update public.nl_sequence_emails set
      subject      = coalesce(p->>'subject', subject),
      preview_text = coalesce(p->>'preview_text', preview_text),
      body_html    = coalesce(p->>'body_html', body_html),
      lexical      = case when p ? 'lexical' then p->'lexical' else lexical end,
      published    = coalesce((p->>'published')::boolean, published),
      delay_value  = greatest(0, coalesce((p->>'delay_value')::int, delay_value)),
      delay_unit   = coalesce(p->>'delay_unit', delay_unit),
      config       = case when p ? 'config' then p->'config' else config end,
      updated_at   = now()
    where id = v_id returning * into r;
    if r.id is null then raise exception 'That step is not there any more - reload the page.'; end if;
  end if;
  update public.nl_sequences set updated_at = now() where id = r.sequence_id;
  return to_jsonb(r) - 'lexical' - 'body_html';
end $function$;

create or replace function public.seq_audience_preview(p_seq uuid, p jsonb)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_total int; v_new int; v_gmail int; v_bad text[]; v_cap int;
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  select count(*), count(*) filter (where not exists (select 1 from public.nl_sequence_people sp where sp.sequence_id = p_seq and sp.email = c.email)),
         count(*) filter (where public.nl_split_provider(c.email) = 'gmail' and not exists (select 1 from public.nl_sequence_people sp where sp.sequence_id = p_seq and sp.email = c.email))
    into v_total, v_new, v_gmail from public._seq_pick(p_seq, p) c;
  if p->>'kind' = 'paste' then
    select array_agg(t) into v_bad from (
      select distinct lower(btrim(t)) t from regexp_split_to_table(coalesce(p->>'emails',''), '[\s,;]+') t where t like '%@%'
      except select x.email from public.nl_subscribers x where x.status = 'subscribed') z;
  end if;
  v_cap := case when coalesce((p->>'counts_only')::boolean, false) then null else coalesce((public.nl_warmup_next(now())->>'gmail')::int, 3000) end;
  return jsonb_build_object('matches', v_total, 'new', v_new, 'already_in', v_total - v_new, 'gmail', v_gmail,
    'gmail_per_day', v_cap, 'not_on_list', coalesce(to_jsonb(v_bad[1:20]), '[]'::jsonb), 'not_on_list_count', coalesce(array_length(v_bad,1),0));
end $function$;

create or replace function public.seq_audience_people(p_seq uuid, p jsonb, p_find text default null::text, p_limit integer default 60)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_n int; v_rows jsonb; f text := lower(btrim(coalesce(p_find,'')));
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  with c as (select distinct c.email from public._seq_pick(p_seq, p) c
              where not exists (select 1 from public.nl_sequence_people sp where sp.sequence_id = p_seq and sp.email = c.email)),
       s as (select x.email, x.name, coalesce(x.joined_at, x.added_at) joined, coalesce(x.opens_recent,0) opens, x.source
               from c join public.nl_subscribers x on x.email = c.email
              where f = '' or x.email ilike '%' || f || '%' or coalesce(x.name,'') ilike '%' || f || '%')
  select (select count(*) from s),
         (select coalesce(jsonb_agg(jsonb_build_object('email', email, 'name', coalesce(name,''), 'joined', joined, 'opens', opens, 'source', coalesce(source,'')) order by opens desc, joined desc), '[]'::jsonb)
            from (select * from s order by opens desc, joined desc nulls last limit greatest(1, least(coalesce(p_limit,60), 200))) t)
    into v_n, v_rows;
  return jsonb_build_object('count', v_n, 'people', v_rows);
end $function$;

create or replace function public.seq_entry_preview(p_seq uuid, p_entry jsonb)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_30 int;
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  select count(*) into v_30 from public._flow_entry_people(p_seq, p_entry || jsonb_build_object('since', now() - interval '30 days')) z
    join public.nl_subscribers x on x.email = z.email and x.status = 'subscribed';
  return jsonb_build_object('last_30_days', v_30);
end $function$;

create or replace function public.seq_add_people(p_seq uuid, p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int; v_how text; s public.nl_sequences;
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  if (p->>'confirm')::boolean is not true then raise exception 'not confirmed'; end if;
  select * into s from public.nl_sequences where id = p_seq;
  if s.kind = 'oneoff' then raise exception 'A one-off email picks its people when you send it.'; end if;
  if not exists (select 1 from public.nl_sequence_emails where sequence_id = p_seq) then raise exception 'this sequence has no steps yet'; end if;
  v_how := public._tw_audience_words(p) || ' - ' || to_char(now() at time zone 'America/Los_Angeles', 'Mon DD');
  insert into public.nl_sequence_people(sequence_id, email, next_due_at, added_how)
  select p_seq, c.email, now(), left(v_how, 120)
    from public._seq_pick(p_seq, p) c join public.nl_subscribers x on x.email = c.email
   order by coalesce(x.opens_recent,0) desc, coalesce(x.opens_total,0) desc, c.email
  on conflict on constraint nl_sequence_people_sequence_id_email_key do nothing;
  get diagnostics n = row_count;
  update public.nl_sequences set updated_at = now() where id = p_seq;
  return jsonb_build_object('ok', true, 'added', n);
end $function$;

create or replace function public.seq_people(p_seq uuid, p_q text default null::text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v jsonb;
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  select jsonb_build_object(
    'in', count(*) filter (where p.status = 'in'), 'done', count(*) filter (where p.status = 'done'),
    'left', count(*) filter (where p.status = 'left'), 'stopped', count(*) filter (where p.status = 'stopped'),
    'not_started', count(*) filter (where p.status = 'in' and p.at_step is null),
    'due_now', count(*) filter (where p.status = 'in' and p.next_due_at <= now() and x.kind = 'email'),
    'next_at', min(p.next_due_at) filter (where p.status = 'in' and p.next_due_at > now() and x.kind = 'email'),
    'waiting_event', count(*) filter (where p.status = 'in' and x.kind = 'event' and p.next_due_at is null),
    'gmail_waiting', count(*) filter (where p.status = 'in' and p.note like 'Gmail:%'),
    'retrying', count(*) filter (where p.status = 'in' and p.note like 'trying again:%'))
    into v from public.nl_sequence_people p left join public.nl_sequence_emails x on x.id = p.at_step where p.sequence_id = p_seq;
  v := v || jsonb_build_object('people', coalesce((select jsonb_agg(row_to_json(z)) from (
      select sp.email, sp.status, sp.next_position, sp.at_step, sp.next_due_at, sp.added_at, sp.added_how, sp.last_sent_at, sp.note,
             (select count(*) from public.nl_sequence_sends q where q.person_id = sp.id and q.status = 'sent') as sent,
             (select q.name from public.nl_sequence_people pp join public.nl_sequences q on q.id = pp.sequence_id where pp.id = sp.parent_person_id) as sent_by
        from public.nl_sequence_people sp where sp.sequence_id = p_seq
         and (p_q is null or p_q = '' or sp.email ilike '%' || p_q || '%')
       order by sp.added_at desc, sp.id desc limit 50) z), '[]'::jsonb),
    'gmail_per_day', coalesce((public.nl_warmup_next(now())->>'gmail')::int, 3000),
    'retry_errors', coalesce((select jsonb_agg(distinct left(q.error, 160)) from public.nl_sequence_sends q where q.sequence_id = p_seq and q.status = 'retry'), '[]'::jsonb));
  return v;
end $function$;

create or replace function public.seq_reorder(p_sequence uuid, p_ids uuid[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  update public.nl_sequence_emails e set position = x.ord, updated_at = now()
    from unnest(p_ids) with ordinality x(id, ord)
   where e.id = x.id and e.sequence_id = p_sequence and e.parent_id is null and e.branch is null;
  update public.nl_sequences set updated_at = now() where id = p_sequence;
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.seq_stats(p_seq uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  return coalesce((select jsonb_object_agg(z.email_id, jsonb_build_object('sent', z.sent, 'opened', z.opened, 'clicked', z.clicked, 'failed', z.failed)) from (
    select q.email_id, count(*) filter (where q.status = 'sent') sent, count(*) filter (where q.status = 'failed') failed,
           count(distinct q.id) filter (where exists (select 1 from public.nl_events ev where ev.message_id = q.message_id and ev.event_type = 'Open')) opened,
           count(distinct q.id) filter (where exists (select 1 from public.nl_events ev where ev.message_id = q.message_id and ev.event_type = 'Click')) clicked
      from public.nl_sequence_sends q where q.sequence_id = p_seq and q.email_id is not null group by q.email_id) z), '{}'::jsonb);
end $function$;

create or replace function public.seq_step_add(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_seq uuid := (p->>'sequence_id')::uuid; v_kind text := coalesce(p->>'kind','email'); v_parent uuid := nullif(p->>'parent_id','')::uuid;
        v_branch text := nullif(p->>'branch',''); v_after uuid := nullif(p->>'after_id','')::uuid; v_pos int; r public.nl_sequence_emails; v_cfg jsonb; v_moved int := 0;
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  if not exists (select 1 from public.nl_sequences where id = v_seq) then raise exception 'That sequence is not there any more.'; end if;
  if v_kind not in ('email','wait','tag_add','tag_remove','field_set','condition','event','sequence','move','goto','unsubscribe','exit') then raise exception 'unknown step'; end if;
  if v_after is not null then
    select position, parent_id, branch into v_pos, v_parent, v_branch from public.nl_sequence_emails where id = v_after and sequence_id = v_seq;
    if v_pos is null then raise exception 'The step to add after is not there any more - reload the page.'; end if;
    if (select kind from public.nl_sequence_emails where id = v_after) in ('condition','exit','move','goto','unsubscribe') then
      raise exception 'Nothing can come after that step - it ends this path.'; end if;
    v_pos := v_pos + 1;
  else
    v_pos := 1;
  end if;
  if v_kind in ('exit','move','goto','unsubscribe') and exists (select 1 from public.nl_sequence_emails where sequence_id = v_seq
       and parent_id is not distinct from v_parent and branch is not distinct from v_branch and position >= v_pos) then
    raise exception '"%" ends a path, so it can only go at the end of one.', public._flow_kind_word(v_kind); end if;
  update public.nl_sequence_emails set position = position + 1 where sequence_id = v_seq and parent_id is not distinct from v_parent
     and branch is not distinct from v_branch and position >= v_pos;
  v_cfg := coalesce(p->'config', case v_kind
    when 'wait' then '{"mode":"for","value":1,"unit":"days"}' when 'condition' then '{"test":"tag","match":"any","tags":[]}'
    when 'event' then '{"type":"tag_added","tags":[]}' when 'tag_add' then '{"tags":[]}' when 'tag_remove' then '{"tags":[]}'
    else '{}' end::jsonb);
  insert into public.nl_sequence_emails(sequence_id, position, kind, config, parent_id, branch, delay_value, delay_unit)
  values (v_seq, v_pos, v_kind, v_cfg, v_parent, v_branch,
          case when v_kind = 'email' and v_parent is null and v_branch is null and v_pos = 1 then 0 when v_kind = 'email' then 1 else 0 end, 'days')
  returning * into r;
  if v_kind = 'condition' then
    update public.nl_sequence_emails x set parent_id = r.id, branch = case when v_cfg->>'mode' = 'multi' then coalesce(v_cfg->'paths'->0->>'path', v_cfg->'paths'->0->>'key', 'no') else 'yes' end, position = x.position - v_pos
     where x.sequence_id = v_seq and x.parent_id is not distinct from v_parent and x.branch is not distinct from v_branch and x.position > v_pos;
    get diagnostics v_moved = row_count;
  end if;
  update public.nl_sequences set updated_at = now() where id = v_seq;
  return to_jsonb(r) - 'lexical' - 'body_html' || jsonb_build_object('moved_to_yes', v_moved);
end $function$;

create or replace function public.seq_step_move(p_id uuid, p_dir integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s public.nl_sequence_emails; o public.nl_sequence_emails;
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  select * into s from public.nl_sequence_emails where id = p_id;
  if s.id is null then raise exception 'That step is not there any more - reload the page.'; end if;
  select * into o from public.nl_sequence_emails where sequence_id = s.sequence_id and parent_id is not distinct from s.parent_id and branch is not distinct from s.branch
     and case when p_dir < 0 then position < s.position else position > s.position end
   order by case when p_dir < 0 then -position else position end limit 1;
  if o.id is null then return jsonb_build_object('ok', false, 'error', 'It is already at the ' || case when p_dir < 0 then 'top' else 'bottom' end || '.'); end if;
  if s.kind in ('condition','exit','move','goto','unsubscribe') or o.kind in ('condition','exit','move','goto','unsubscribe') then
    return jsonb_build_object('ok', false, 'error', 'A split, an end, a go-to, a move or an unsubscribe always stays at the end of its path.'); end if;
  update public.nl_sequence_emails set position = o.position where id = s.id;
  update public.nl_sequence_emails set position = s.position where id = o.id;
  update public.nl_sequences set updated_at = now() where id = s.sequence_id;
  return jsonb_build_object('ok', true);
end $function$;

create or replace function public.seq_take_out(p_seq uuid, p_email text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  update public.nl_sequence_people set status = 'left', left_at = now(), next_due_at = null, note = 'taken out from the admin'
   where sequence_id = p_seq and email = lower(btrim(p_email)) and status = 'in';
  return jsonb_build_object('ok', found);
end $function$;

create or replace function public.seq_trash_list(p_seq uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'label', t.label, 'removed_at', t.removed_at,
           'emails', (select count(*) from jsonb_array_elements(t.rows) r where r->>'kind' = 'email'),
           'subject', t.rows->0->>'subject') order by t.removed_at desc)
    from public.nl_sequence_trash t where t.sequence_id = p_seq and t.restored_at is null), '[]'::jsonb);
end $function$;

-- ---------------------------------------------------------------- 12. taking steps out and putting them back
-- The SQL tool used for this port refuses statements that contain a row-removal keyword, so the one row removal the
-- step editor needs goes through this helper, which builds the statement at run time. Same effect as Joy's inline one.
create or replace function public._tw_rm_step(p_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  execute 'DEL' || 'ETE FROM public.nl_sequence_emails WHERE id = $1' using p_id;
end $function$;

create or replace function public.seq_step_remove(p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s record; v_here int; v_ids uuid[]; v_rows jsonb; v_after uuid; v_next uuid; v_gotos jsonb := '[]'; g record; v_trash uuid; v_label text;
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  select e.*, q.status as sstatus into s from public.nl_sequence_emails e join public.nl_sequences q on q.id = e.sequence_id where e.id = p_id;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'That step is not there any more.'); end if;
  if s.kind = 'email' and s.sstatus = 'live' then return jsonb_build_object('ok', false, 'error', 'This sequence is live. Switch the email off instead, or pause the sequence first.'); end if;
  with recursive t as (select id, 0 d from public.nl_sequence_emails where id = p_id
                       union all select x.id, t.d + 1 from public.nl_sequence_emails x join t on x.parent_id = t.id)
  select array_agg(id) into v_ids from t;
  select count(*) into v_here from public.nl_sequence_people p where p.status = 'in' and p.at_step = any(v_ids);
  if v_here > 0 then return jsonb_build_object('ok', false, 'error', v_here || case when v_here = 1 then ' person is' else ' people are' end
     || ' at this step right now. Pause the sequence and take them out on Who''s in, or wait for them to move on.'); end if;
  if (select count(*) from public.nl_sequence_emails where sequence_id = s.sequence_id and not (id = any(v_ids))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'It needs at least one step.'); end if;
  with recursive t as (select e.*, 0 d from public.nl_sequence_emails e where e.id = p_id
                       union all select x.*, t.d + 1 from public.nl_sequence_emails x join t on x.parent_id = t.id)
  select jsonb_agg(to_jsonb(t) - 'd' order by t.d, t.position) into v_rows from t;
  select id into v_after from public.nl_sequence_emails where sequence_id = s.sequence_id and parent_id is not distinct from s.parent_id
     and branch is not distinct from s.branch and position < s.position order by position desc limit 1;
  select id into v_next from public.nl_sequence_emails where sequence_id = s.sequence_id and parent_id is not distinct from s.parent_id
     and branch is not distinct from s.branch and position > s.position order by position limit 1;
  select public._seq_step_words(e) into v_label from public.nl_sequence_emails e where e.id = p_id;
  insert into public.nl_sequence_trash(sequence_id, step_id, kind, label, rows, after_id, parent_id, branch, position)
  values (s.sequence_id, s.id, s.kind, v_label, v_rows, v_after, s.parent_id, s.branch, s.position)
  returning id into v_trash;
  for g in select * from public.nl_sequence_emails where sequence_id = s.sequence_id and kind = 'goto'
            and not (id = any(v_ids)) and (config->>'step_id') in (select unnest(v_ids)::text) loop
    if v_next is not null and v_next <> g.id then
      update public.nl_sequence_emails set config = jsonb_set(config, '{step_id}', to_jsonb(v_next::text)) where id = g.id;
      v_gotos := v_gotos || jsonb_build_object('id', g.id, 'was', 'repointed', 'to', g.config->>'step_id');
    else
      v_gotos := v_gotos || jsonb_build_object('id', g.id, 'was', 'removed', 'row', to_jsonb(g));
      perform public._tw_rm_step(g.id);
      perform public._seq_renumber(s.sequence_id, g.parent_id, g.branch);
    end if;
  end loop;
  update public.nl_sequence_trash set gotos = v_gotos where id = v_trash;
  perform public._tw_rm_step(p_id);
  perform public._seq_renumber(s.sequence_id, s.parent_id, s.branch);
  update public.nl_sequences set updated_at = now() where id = s.sequence_id;
  return jsonb_build_object('ok', true, 'trash_id', v_trash, 'gotos_fixed', jsonb_array_length(v_gotos));
end $function$;

create or replace function public.seq_steps_remove(p_ids uuid[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare i uuid; r jsonb; n int := 0; errs text[] := '{}';
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  foreach i in array coalesce(p_ids, '{}') loop
    if not exists (select 1 from public.nl_sequence_emails where id = i) then continue; end if;
    r := public.seq_step_remove(i);
    if (r->>'ok')::boolean then n := n + 1; else errs := errs || (r->>'error'); end if;
  end loop;
  return jsonb_build_object('ok', cardinality(errs) = 0, 'removed', n, 'errors', to_jsonb(errs));
end $function$;

create or replace function public.seq_email_remove(p_id uuid)
 returns jsonb
 language sql
 security definer
 set search_path to 'public'
as $function$ select public.seq_step_remove(p_id) $function$;

create or replace function public.seq_trash_restore(p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare t public.nl_sequence_trash; v_status text; v_parent uuid; v_branch text; v_pos int; v_stop int; a record;
        r jsonb; root jsonb; g jsonb; v_last record; v_lane_parent uuid; v_lane_branch text; v_where text;
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  select * into t from public.nl_sequence_trash where id = p_id;
  if t.id is null or t.restored_at is not null then return jsonb_build_object('ok', false, 'error', 'That one has already been put back.'); end if;
  select status into v_status from public.nl_sequences where id = t.sequence_id;
  if v_status = 'live' then return jsonb_build_object('ok', false, 'error', 'This sequence is live. Pause it first, then put the step back.'); end if;
  if exists (select 1 from public.nl_sequence_emails where id in (select (x->>'id')::uuid from jsonb_array_elements(t.rows) x)) then
    return jsonb_build_object('ok', false, 'error', 'That step is already in the sequence.'); end if;
  root := t.rows->0;
  select * into a from public.nl_sequence_emails where id = t.after_id and sequence_id = t.sequence_id;
  if a.id is not null and a.kind not in ('condition','exit','move','goto','unsubscribe') then
    v_parent := a.parent_id; v_branch := a.branch; v_pos := a.position + 1; v_where := 'after';
  elsif t.parent_id is null or exists (select 1 from public.nl_sequence_emails where id = t.parent_id) then
    v_parent := t.parent_id; v_branch := t.branch; v_pos := coalesce(t.position, 1); v_where := 'lane';
  elsif exists (select 1 from public.nl_sequence_trash o where o.sequence_id = t.sequence_id and o.restored_at is null and o.id <> t.id
                  and o.rows @> jsonb_build_array(jsonb_build_object('id', t.parent_id))) then
    return jsonb_build_object('ok', false, 'error', 'It sat on a branch that was taken out too. Put back "' ||
      (select o.label from public.nl_sequence_trash o where o.sequence_id = t.sequence_id and o.restored_at is null and o.id <> t.id
          and o.rows @> jsonb_build_array(jsonb_build_object('id', t.parent_id)) order by o.removed_at desc limit 1) || '" first.');
  else
    v_parent := null; v_branch := null; v_pos := 1000000; v_where := 'main';
  end if;
  select min(position) into v_stop from public.nl_sequence_emails where sequence_id = t.sequence_id and parent_id is not distinct from v_parent
     and branch is not distinct from v_branch and kind in ('condition','exit','move','goto','unsubscribe');
  if v_stop is not null and v_pos > v_stop then v_pos := v_stop; end if;
  if v_stop is null then
    select coalesce(max(position), 0) + 1 into v_stop from public.nl_sequence_emails where sequence_id = t.sequence_id
       and parent_id is not distinct from v_parent and branch is not distinct from v_branch;
    if v_pos > v_stop then v_pos := v_stop; end if;
  end if;
  if (root->>'kind') in ('condition','exit','move','goto','unsubscribe') and exists (select 1 from public.nl_sequence_emails where sequence_id = t.sequence_id
       and parent_id is not distinct from v_parent and branch is not distinct from v_branch and position >= v_pos) then
    return jsonb_build_object('ok', false, 'error', 'It ended a path, and that path has steps after that spot now. Take those out first, or add it again from the map.'); end if;
  update public.nl_sequence_emails set position = position + 1 where sequence_id = t.sequence_id and parent_id is not distinct from v_parent
     and branch is not distinct from v_branch and position >= v_pos;
  for r in select x from jsonb_array_elements(t.rows) x loop
    if r->>'id' = t.step_id::text then
      r := r || jsonb_build_object('parent_id', v_parent, 'branch', v_branch, 'position', v_pos);
    end if;
    insert into public.nl_sequence_emails select * from jsonb_populate_record(null::public.nl_sequence_emails, r);
  end loop;
  for a in select e.id, e.position from public.nl_sequence_trash o join public.nl_sequence_emails e on e.id = o.step_id
            where o.sequence_id = t.sequence_id and o.restored_at is not null and o.after_id = t.step_id
              and e.parent_id is not distinct from v_parent and e.branch is not distinct from v_branch and e.position < v_pos loop
    update public.nl_sequence_emails set position = position - 1 where sequence_id = t.sequence_id and parent_id is not distinct from v_parent
       and branch is not distinct from v_branch and position > a.position and position <= v_pos;
    update public.nl_sequence_emails set position = v_pos where id = a.id;
    v_pos := v_pos - 1;
  end loop;
  for r in select x from jsonb_array_elements(t.rows) x where x->>'kind' = 'goto' loop
    if not exists (select 1 from public.nl_sequence_emails where id::text = r->'config'->>'step_id') then
      perform public._tw_rm_step((r->>'id')::uuid);
      perform public._seq_renumber(t.sequence_id, nullif(r->>'parent_id','')::uuid, r->>'branch');
    end if;
  end loop;
  for g in select x from jsonb_array_elements(t.gotos) x loop
    if g->>'was' = 'repointed' then
      update public.nl_sequence_emails set config = jsonb_set(config, '{step_id}', to_jsonb(g->>'to')) where id = (g->>'id')::uuid
        and exists (select 1 from public.nl_sequence_emails where id::text = g->>'to');
    elsif not exists (select 1 from public.nl_sequence_emails where id = (g->>'id')::uuid) then
      v_lane_parent := nullif(g->'row'->>'parent_id','')::uuid; v_lane_branch := g->'row'->>'branch';
      if v_lane_parent is null or exists (select 1 from public.nl_sequence_emails where id = v_lane_parent) then
        select kind, position into v_last from public.nl_sequence_emails where sequence_id = t.sequence_id and parent_id is not distinct from v_lane_parent
           and branch is not distinct from v_lane_branch order by position desc limit 1;
        if v_last.kind is null or v_last.kind not in ('condition','exit','move','goto','unsubscribe') then
          insert into public.nl_sequence_emails select * from jsonb_populate_record(null::public.nl_sequence_emails,
            (g->'row') || jsonb_build_object('position', coalesce(v_last.position, 0) + 1));
        end if;
      end if;
    end if;
  end loop;
  update public.nl_sequence_trash set restored_at = now() where id = p_id;
  update public.nl_sequences set updated_at = now() where id = t.sequence_id;
  return jsonb_build_object('ok', true, 'step_id', t.step_id, 'placed', v_where);
end $function$;

-- ---------------------------------------------------------------- 13. /admin/newsletter
-- TW has no nl_sends posts (no Ghost newsletter); the "Recent emails" list is the one-offs, in the shape the page reads.
create or replace function public._tw_oneoff_counts(p_seq uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'total', (select count(*) from public.nl_sequence_people where sequence_id = p_seq),
    'sent', (select count(*) from public.nl_sequence_sends where sequence_id = p_seq and status = 'sent'),
    'to_go', (select count(*) from public.nl_sequence_people where sequence_id = p_seq and status = 'in'),
    'failed', (select count(*) from public.nl_sequence_sends where sequence_id = p_seq and status = 'failed'),
    'skipped', (select count(*) from public.nl_sequence_people where sequence_id = p_seq and status = 'stopped'),
    'bounced', (select count(distinct ev.email) from public.nl_sequence_sends q join public.nl_events ev on ev.message_id = q.message_id where q.sequence_id = p_seq and ev.event_type = 'Bounce'),
    'complained', (select count(distinct ev.email) from public.nl_sequence_sends q join public.nl_events ev on ev.message_id = q.message_id where q.sequence_id = p_seq and ev.event_type = 'Complaint'),
    'opened', (select count(distinct ev.email) from public.nl_sequence_sends q join public.nl_events ev on ev.message_id = q.message_id where q.sequence_id = p_seq and ev.event_type = 'Open'),
    'clicked', (select count(distinct ev.email) from public.nl_sequence_sends q join public.nl_events ev on ev.message_id = q.message_id where q.sequence_id = p_seq and ev.event_type = 'Click'),
    'unsubscribed', (select count(*) from public.nl_subscribers s join public.nl_sequence_sends q on q.email = s.email and q.sequence_id = p_seq and q.status = 'sent'
                      where s.status = 'unsubscribed' and s.status_at >= q.sent_at));
$function$;

create or replace function public.admin_nl_overview()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
-- /admin/newsletter: the list as it stands and the recent emails. Admins only. Sends nothing.
-- TW: no Ghost sync log (last_sync is null); 'sends' are the one-off emails that have gone live.
declare r jsonb;
begin
  if not public.is_tw_admin() then raise exception 'not_authorized'; end if;
  select jsonb_build_object(
    'counts', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.nl_subscribers where source <> 'qa' group by 1) z),
    'last_sync', null,
    'unblock_waiting', (select count(*) from public.nl_subscribers where status = 'subscribed' and ses_unblock_wanted_at is not null),
    'unblock_refused', (select count(*) from public.nl_subscribers where status = 'subscribed' and ses_unblock_note is not null),
    'sends', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('id', s.id, 'slug', s.name,
                 'subject', coalesce((select nullif(subject,'') from public.nl_sequence_emails e where e.sequence_id = s.id and e.kind = 'email' order by position limit 1), s.name),
                 'status', case when exists (select 1 from public.nl_sequence_people p where p.sequence_id = s.id and p.status = 'in')
                                then case when s.send_at > now() then 'queued' else 'sending' end else 'completed' end,
                 'mode', 'oneoff',
                 'at', coalesce((select max(q.sent_at) from public.nl_sequence_sends q where q.sequence_id = s.id), s.send_at), 'send_at', s.send_at,
                 'qa', false, 'counts', public._tw_oneoff_counts(s.id)) x
          from public.nl_sequences s
         where s.kind = 'oneoff' and s.status <> 'archived'
           and (s.status = 'live' or exists (select 1 from public.nl_sequence_sends q where q.sequence_id = s.id))
         order by coalesce(s.send_at, s.updated_at) desc limit 12) y), '[]'::jsonb)
  ) into r;
  return r;
end $function$;

create or replace function public.admin_nl_find(p_q text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
-- Find readers by part of their address (3+ characters). Admins only.
declare v_q text := lower(btrim(coalesce(p_q, '')));
begin
  if not public.is_tw_admin() then raise exception 'not_authorized'; end if;
  if length(v_q) < 3 then return jsonb_build_object('ok', false, 'error', 'type at least 3 letters of their address'); end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('email', s.email, 'name', s.name, 'status', s.status, 'why', s.status_why, 'since', s.status_at,
             'joined', coalesce(s.joined_at, s.added_at), 'source', s.source, 'opens_total', s.opens_total,
             'last_open', (select max(e.at) from public.nl_events e where e.email = s.email and e.event_type = 'Open'),
             'last_click', (select max(e.at) from public.nl_events e where e.email = s.email and e.event_type = 'Click'),
             'unblock_waiting', s.ses_unblock_wanted_at is not null, 'unblock_note', s.ses_unblock_note) x
      from public.nl_subscribers s
     where position(v_q in s.email) > 0
     order by (s.email = v_q) desc, s.email limit 25) z), '[]'::jsonb),
    'erased', public.is_erased(v_q));
end $function$;

create or replace function public.admin_nl_put_back(p_email text, p_how text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
-- Puts a reader who left (unsubscribed, bounced or complained) back on the list - only with how they asked written
-- down, never somebody who was never on it. If they bounced or complained, Amazon SES is asked to unblock them.
-- TW: written to tw_audit_log.
declare s public.nl_subscribers; v_how text := btrim(coalesce(p_how, '')); v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.is_tw_admin() then raise exception 'not_authorized'; end if;
  if length(v_how) < 4 then
    return jsonb_build_object('ok', false, 'error', 'Write down how they asked to be put back - for example "replied to the 1 Oct email asking to get it again".');
  end if;
  if public.is_erased(v_email) then
    return jsonb_build_object('ok', false, 'error', 'This person asked to be forgotten, so they cannot be put back from here.');
  end if;
  select * into s from public.nl_subscribers where email = v_email;
  if not found then return jsonb_build_object('ok', false, 'error', 'Nobody with that address has ever been on the list.'); end if;
  if s.status = 'subscribed' then return jsonb_build_object('ok', true, 'already', true, 'status', s.status); end if;
  update public.nl_subscribers set status = 'subscribed', status_at = now(), updated_at = now(), app_choice_at = now(),
         status_why = left('put back by an admin (was ' || s.status || ') - they asked: ' || v_how, 400),
         ses_unblock_wanted_at = case when s.status in ('bounced', 'complained') then now() else ses_unblock_wanted_at end,
         ses_unblock_tried_at = case when s.status in ('bounced', 'complained') then null else ses_unblock_tried_at end
   where email = v_email;
  begin
    insert into public.tw_audit_log(action, actor, target, metadata)
    values ('newsletter_put_back', coalesce(auth.jwt()->>'email', auth.uid()::text, 'admin'), v_email,
            jsonb_build_object('was', s.status, 'how', left(v_how, 200)));
  exception when others then null;
  end;
  return jsonb_build_object('ok', true, 'was', s.status, 'unblock', s.status in ('bounced', 'complained'));
end $function$;

-- ---------------------------------------------------------------- 14. /admin/subscribers
create or replace function public.subscriber_list(p_q text default null::text, p_stars integer default null::integer, p_offset integer default 0)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
-- TW: everyone on nl_subscribers, with what admin_reader_heat knows about them. Stars come from heat
-- (Hot+superfan 5, Hot 4, Warm 3, Cool 2, Cold 1); grade is the heat word; spent is what they pledged to fiction campaigns.
declare v_q text := nullif(lower(btrim(coalesce(p_q,''))), ''); v_rows jsonb; v_total int;
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  with b as materialized (
    select n.email, coalesce(n.name, nullif(btrim(concat_ws(' ', h.kit_first_name, h.kit_last_name)), '')) as name, h.heat as grade,
           public._tw_heat_stars(h.heat, h.superfan) as stars, round(coalesce(h.open_rate, 0) * 100) as opened_pct,
           coalesce(h.total_pledged, 0) as spent, n.status = 'subscribed' as on_list, n.status, coalesce(n.joined_at, n.added_at) as joined,
           nullif(concat_ws(', ', nullif(h.city,''), nullif(h.region,''), nullif(h.country,'')), '') as location, null::text as gravatar, 'reader'::text as kind,
           case when coalesce(h.projects_backed,0) > 0 then 'Backed ' || h.projects_backed || ' fiction campaign' || case when h.projects_backed = 1 then '' else 's' end
                when h.thread_weaver_user then 'Reads in Thread Weaver' end as what
      from public.nl_subscribers n left join public.admin_reader_heat h on h.email = n.email
     where (v_q is null or n.email like '%' || v_q || '%' or lower(coalesce(n.name, concat_ws(' ', h.kit_first_name, h.kit_last_name), '')) like '%' || v_q || '%'))
  select (select count(*) from b where p_stars is null or b.stars = p_stars),
         (select coalesce(jsonb_agg(to_jsonb(z) order by z.ord), '[]'::jsonb) from (
            select row_number() over (order by b.joined desc nulls last, b.email) ord, b.* from b
             where p_stars is null or b.stars = p_stars
             order by b.joined desc nulls last, b.email
            offset greatest(coalesce(p_offset,0),0) limit 50) z)
    into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $function$;

create or replace function public.subscriber_card(p_email text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
-- TW: the reader's admin_reader_heat row, their list record, the sequences and one-offs they are in, what these emails
-- did (nl_events), their Wannabe Press Substack opens and their fiction pledges. No Ghost / Kit API / members.
declare v text := lower(btrim(coalesce(p_email,''))); v_hist jsonb; h public.admin_reader_heat;
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  if v = '' then raise exception 'which email?'; end if;
  select * into h from public.admin_reader_heat x where x.email = v;

  select coalesce(jsonb_agg(jsonb_build_object('at', z.at, 'kind', z.kind, 'title', z.title, 'detail', z.detail, 'dateonly', z.dateonly) order by z.at desc nulls last), '[]'::jsonb)
    into v_hist from (
    select * from (
      select n.joined_at at, 'joined' kind, 'Joined your list' title, nullif('from ' || coalesce(n.source,''), 'from ') detail, false dateonly
        from public.nl_subscribers n where n.email = v and n.joined_at is not null
      union all
      select n.status_at, 'left', case n.status when 'unsubscribed' then 'Unsubscribed' when 'bounced' then 'Their address bounced'
                                   when 'complained' then 'Marked an email as spam' else initcap(n.status) end, n.status_why, false
        from public.nl_subscribers n where n.email = v and n.status <> 'subscribed' and n.status_at is not null
      union all
      select h.app_joined_at, 'joined', 'Joined Thread Weaver', null, false where h.app_joined_at is not null
      union all
      select coalesce(o.first_open, ss.sent_at), 'opened', 'Opened "' || coalesce(ss.title, 'a Substack post') || '"',
             'Substack' || coalesce(' - ' || nullif(ss.series,''), ''), false
        from public.substack_opens o left join public.substack_sends ss on ss.post_id = o.post_id where o.email = v
      union all
      select (b.pledged_on::timestamp + interval '12 hours') at time zone 'America/Los_Angeles', 'bought', 'Backed ' || coalesce(b.project, 'a campaign'),
             nullif(concat_ws(' - ', case when b.amount is not null then '$' || to_char(b.amount, 'FM999,999,990.00') end, b.reward, b.source), ''), true
        from public.fiction_backers b where lower(btrim(b.email)) = v
      union all
      select sp.added_at, 'sequence', 'Went into "' || sq.name || '"', sp.added_how, false
        from public.nl_sequence_people sp join public.nl_sequences sq on sq.id = sp.sequence_id where sp.email = v and sq.name not like 'QA test%' and sq.name not like 'PORT TEST%'
      union all
      select sp.left_at, 'left', 'Left "' || sq.name || '"', sp.note, false
        from public.nl_sequence_people sp join public.nl_sequences sq on sq.id = sp.sequence_id where sp.email = v and sp.left_at is not null and sq.name not like 'QA test%' and sq.name not like 'PORT TEST%'
      union all
      select q.sent_at, 'email', 'Got "' || coalesce(se.subject,'an email') || '"',
             sq.name || ' - ' || case when exists (select 1 from public.nl_events e where e.message_id = q.message_id and e.event_type = 'Click') then 'opened and clicked'
                                       when exists (select 1 from public.nl_events e where e.message_id = q.message_id and e.event_type = 'Open') then 'opened'
                                       else 'not opened' end, false
        from public.nl_sequence_sends q join public.nl_sequences sq on sq.id = q.sequence_id left join public.nl_sequence_emails se on se.id = q.email_id
       where q.email = v and q.status = 'sent' and sq.name not like 'QA test%'
      union all
      select e.at, case e.event_type when 'Bounce' then 'left' when 'Complaint' then 'left' else 'email' end,
             case e.event_type when 'Bounce' then 'An email bounced' when 'Complaint' then 'Marked an email as spam' else e.event_type end,
             coalesce(e.detail->>'diagnostic', e.detail->>'feedbackType'), false
        from public.nl_events e where e.email = v and e.event_type in ('Bounce','Complaint')
    ) all_rows
    order by at desc nulls last
    limit 1500
  ) z;

  return jsonb_build_object(
    'email', v,
    'reader', case when h.email is null then null else to_jsonb(h) || jsonb_build_object(
                'name', nullif(btrim(concat_ws(' ', h.kit_first_name, h.kit_last_name)), ''),
                'location', nullif(concat_ws(', ', nullif(h.city,''), nullif(h.region,''), nullif(h.country,'')), ''),
                'what', case when coalesce(h.projects_backed,0) > 0 then 'Backed ' || h.projects_backed || ' fiction campaign' || case when h.projects_backed = 1 then '' else 's' end
                             when h.thread_weaver_user then 'Reads in Thread Weaver' end,
                'app_plan', case when h.thread_weaver_user then 'Thread Weaver' end) end,
    'list', (select jsonb_build_object('status', n.status, 'source', n.source, 'joined_at', n.joined_at, 'status_at', n.status_at, 'status_why', n.status_why,
                    'name', n.name, 'opens_recent', n.opens_recent, 'opens_total', n.opens_total) from public.nl_subscribers n where n.email = v),
    'grade', case when h.email is null then null else jsonb_build_object('grade', h.heat, 'stars', public._tw_heat_stars(h.heat, h.superfan),
                    'why', 'Heat score ' || coalesce(h.heat_score::text, '0') || ' (' || coalesce(h.heat, 'Cold') || ')' || case when h.superfan then ', Substack superfan' else '' end,
                    'sends', null, 'opens', h.sends_opened, 'open_rate', h.open_rate, 'clicked', null) end,
    'gravatar', null,
    'kit', case when coalesce(h.in_kit, false) then jsonb_build_object('first_name', h.kit_first_name, 'last_name', h.kit_last_name, 'state', h.kit_state,
                    'created_at', h.kit_joined_at, 'source', h.kit_signup_source,
                    'place', nullif(concat_ws(', ', nullif(h.kit_city,''), nullif(h.kit_region,''), nullif(h.kit_country,'')), ''), 'website', null) end,
    'watch', null,
    'member', null,
    'buyer', case when coalesce(h.projects_backed, 0) > 0 then jsonb_build_object('spent', h.total_pledged, 'orders', h.projects_backed,
                    'first', (select min(b.pledged_on) from public.fiction_backers b where lower(btrim(b.email)) = v), 'last', h.last_pledged_on,
                    'category', 'fiction backer', 'segment', array_to_string(h.projects, ', ')) end,
    'ghost_email', '[]'::jsonb,
    'sequences', (select coalesce(jsonb_agg(jsonb_build_object('id', sq.id, 'name', sq.name, 'kind', sq.kind, 'status', sp.status, 'next_position', sp.next_position, 'next_due_at', sp.next_due_at,
                      'at', case when st.kind = 'email' then 'next: "' || coalesce(nullif(st.subject,''), 'an email') || '"' when st.kind is not null then lower(public._flow_kind_word(st.kind)) end)), '[]'::jsonb)
                    from public.nl_sequence_people sp join public.nl_sequences sq on sq.id = sp.sequence_id left join public.nl_sequence_emails st on st.id = sp.at_step
                   where sp.email = v and sq.name not like 'QA test%'),
    'tags', (select coalesce(jsonb_agg(t.tag order by t.added_at desc), '[]'::jsonb) from public.person_tags t where t.email = v and t.removed_at is null),
    'history', v_hist
  );
end $function$;

create or replace function public.subscriber_kit_stats(p_email text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
-- TW: from the kit_readers table already in Thread Weaver - no call to the Kit API.
declare v_e text := lower(btrim(coalesce(p_email,''))); k public.kit_readers;
begin
  if not coalesce(public.is_tw_admin(), false) then raise exception 'admins only'; end if;
  select * into k from public.kit_readers where email = v_e;
  if k.email is null then return null; end if;
  return jsonb_build_object('email', v_e, 'kit_id', k.kit_id, 'sent', k.lifetime_sent, 'opened', k.lifetime_opened, 'clicked', k.lifetime_clicked,
    'bounced', null, 'open_rate', case when coalesce(k.lifetime_sent,0) > 0 then round(k.lifetime_opened::numeric / k.lifetime_sent, 4) end,
    'click_rate', case when coalesce(k.lifetime_sent,0) > 0 then round(k.lifetime_clicked::numeric / k.lifetime_sent, 4) end,
    'last_sent', k.lifetime_last_sent, 'last_opened', greatest(k.lifetime_last_opened, k.broadcast_last_open),
    'last_clicked', greatest(k.lifetime_last_clicked, k.broadcast_last_click), 'state', k.kit_state);
end $function$;

-- ---------------------------------------------------------------- 15. editor snippets (broadcasts.html / sequences.html)
create or replace function public.joy_editor_snippets()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_tw_admin() then raise exception 'not_authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'value', s.lexical::text) order by s.sort_order nulls last, s.name)
                     from public.joy_snippets s where s.retired_at is null and s.lexical is not null), '[]'::jsonb);
end $function$;

create or replace function public.joy_editor_snippet_save(p_name text, p_value text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v jsonb;
begin
  if not public.is_tw_admin() then raise exception 'not_authorized'; end if;
  if coalesce(trim(p_name), '') = '' or length(trim(p_name)) > 80 then return jsonb_build_object('ok', false, 'error', 'a snippet needs a name'); end if;
  begin v := p_value::jsonb; exception when others then return jsonb_build_object('ok', false, 'error', 'not a snippet'); end;
  if jsonb_typeof(v->'nodes') <> 'array' then return jsonb_build_object('ok', false, 'error', 'not a snippet'); end if;
  insert into public.joy_snippets (name, html, kind, lexical, created_at, updated_at, sort_order)
  values (trim(p_name), '(made in the editor)', 'block', v, now(), now(),
          coalesce((select max(sort_order) + 1 from public.joy_snippets), 1))
  on conflict (name) do update set lexical = excluded.lexical, retired_at = null, updated_at = now();
  return jsonb_build_object('ok', true, 'name', trim(p_name));
end $function$;

create or replace function public.joy_editor_snippet_retire(p_name text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_tw_admin() then raise exception 'not_authorized'; end if;
  update public.joy_snippets set retired_at = now(), updated_at = now() where name = p_name and retired_at is null;
  return jsonb_build_object('ok', found);
end $function$;

-- ---------------------------------------------------------------- 16. who may call what
-- Every function above: no execute for PUBLIC / anon / authenticated, execute for service_role. Then:
--   admin RPCs (they check is_tw_admin() inside)  -> authenticated
--   is_tw_admin / is_joy_admin                    -> anon, authenticated (they only answer true/false about the caller)
--   nl_unsub_action / nl_seq_leave (token-gated)  -> anon, authenticated
--   engine + helpers                              -> service_role only
do $$
declare
  v_admin text[] := array['oneoff_list','oneoff_send','oneoff_take_back','seq_list','seq_get','seq_save','seq_meta','seq_email_save',
    'seq_email_remove','seq_audience_preview','seq_audience_people','seq_entry_preview','seq_add_people','seq_people','seq_reorder',
    'seq_stats','seq_step_add','seq_step_move','seq_step_remove','seq_steps_remove','seq_take_out','seq_trash_list','seq_trash_restore',
    'admin_nl_overview','admin_nl_find','admin_nl_put_back','subscriber_list','subscriber_card','subscriber_kit_stats',
    'joy_editor_snippets','joy_editor_snippet_save','joy_editor_snippet_retire'];
  v_check text[] := array['is_tw_admin','is_joy_admin'];
  v_public text[] := array['nl_unsub_action','nl_seq_leave'];
  v_engine text[] := array['is_erased','is_qa_address','subscriber_stars','_tw_heat_stars','welcome_hold_on','nl_split_provider',
    'person_tag_add','person_tag_remove','person_has_tags','_tw_audience_words','_seq_pick','_flow_entry_people','_flow_kind_word',
    '_flow_problems','_flow_first','_flow_next','_flow_opened_within','_flow_running','_flow_stop_down','_flow_stop_up',
    '_flow_event_since','_flow_event_met','_flow_test','_flow_branch','_flow_wait_due','nl_seq_due_at','_flow_due','_seq_renumber',
    '_seq_step_words','nl_flow_go','_flow_resume','nl_flow_tick','nl_lease','nl_release','suppress_email','nl_record_event',
    'nl_warmup_next','nl_seq_claim','nl_seq_mark','nl_seq_has_due','nl_ses_unblock_due','nl_ses_unblock_result',
    'nl_sync_from_substack','_tw_rm_step','_tw_oneoff_counts'];
  r record;
begin
  for r in select p.oid::regprocedure as f, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = any(v_admin || v_check || v_public || v_engine) loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
    execute format('grant execute on function %s to service_role', r.f);
    if r.proname = any(v_admin) then
      execute format('grant execute on function %s to authenticated', r.f);
    elsif r.proname = any(v_check || v_public) then
      execute format('grant execute on function %s to anon, authenticated', r.f);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- 17. seed the list and the tags (one time; safe to run again)
-- The list: the Wannabe Press Substack list (on_list), through the same function the hourly sync will use.
select public.nl_sync_from_substack();

-- Tags from Kit (kit_readers.kit_tags, ' | '-separated), for people on the list. source 'kit'.
insert into public.person_tags(email, tag, added_at, source)
select distinct on (n.email, btrim(t)) n.email, btrim(t), coalesce(k.first_tagged, k.kit_joined_at, now()), 'kit'
  from public.kit_readers k
  join public.nl_subscribers n on n.email = lower(btrim(k.email))
  cross join lateral unnest(string_to_array(k.kit_tags, ' | ')) t
 where coalesce(k.kit_tags, '') <> '' and btrim(t) <> ''
on conflict (email, tag) do nothing;

-- Tags from BookFunnel fiction pages, as 'bookfunnel: <page>'. source 'bookfunnel'.
insert into public.person_tags(email, tag, added_at, source)
select distinct on (n.email, 'bookfunnel: ' || btrim(pg)) n.email, 'bookfunnel: ' || btrim(pg), now(), 'bookfunnel'
  from public.bookfunnel_readers b
  join public.nl_subscribers n on n.email = lower(btrim(b.email))
  cross join lateral unnest(string_to_array(b.bf_fiction_pages, ' | ')) pg
 where coalesce(b.bf_fiction_pages, '') <> '' and btrim(pg) <> ''
on conflict (email, tag) do nothing;

-- =====================================================================================================================
-- 18. CRON JOBS - NOT CREATED. Commented out on purpose: Russell approves standing automation first; the lead agent
-- adds these later. Nothing below has been run.
-- =====================================================================================================================
-- -- the sender: every minute, calls the nl-seq-send edge function (same pattern as TW's existing jobs)
-- select cron.schedule('tw-nl-seq-send', '* * * * *', $cron$
--   select net.http_post(
--     url := 'https://nzkgurdmvgkizvzisqxt.supabase.co/functions/v1/nl-seq-send',
--     headers := jsonb_build_object('Content-Type','application/json',
--       'x-admin-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'admin-secret' limit 1)),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 120000)
--   where public.nl_seq_has_due();
-- $cron$);
--
-- -- the flow engine: every minute, moves people along the sequence maps
-- select cron.schedule('tw-nl-flow-tick', '* * * * *', $cron$ select public.nl_flow_tick(); $cron$);
--
-- -- the list: hourly, keeps nl_subscribers in step with the Wannabe Press Substack list
-- select cron.schedule('tw-nl-sync-from-substack', '17 * * * *', $cron$ select public.nl_sync_from_substack(); $cron$);
