-- AURA 2026 — Supabase schema (migration-safe).
--
-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to run repeatedly, and safe on a database that still has the ORIGINAL
-- table from the first version of this project: missing columns are added and
-- the year column is converted from integer to text rather than being skipped.

create extension if not exists pgcrypto;

-- 1. Base table (only when nothing exists yet).
create table if not exists public.registrations (
  id         uuid primary key default gen_random_uuid(),
  event      text not null,
  name       text not null,
  department text not null,
  year       text not null,
  phone      text not null,
  email      text not null,
  created_at timestamptz not null default now()
);

-- 2. Bring an older table up to date. Each step is independent and idempotent.
alter table public.registrations add column if not exists choice             text;
alter table public.registrations add column if not exists team_name          text;
alter table public.registrations add column if not exists partner_name       text;
alter table public.registrations add column if not exists partner_department text;
alter table public.registrations add column if not exists partner_year       text;
alter table public.registrations add column if not exists created_at         timestamptz not null default now();

-- The first version stored teamName; carry any data across, then drop it.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'registrations' and column_name = 'teamname') then
    execute 'update public.registrations set team_name = coalesce(team_name, "teamName") where "teamName" is not null';
    execute 'alter table public.registrations drop column "teamName"';
  end if;
end $$;

-- Drop every CHECK constraint on the table BEFORE changing column types.
-- The first version had "year between 1 and 3"; once year becomes text that
-- constraint reads as "text >= integer" and Postgres refuses the conversion.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public' and rel.relname = 'registrations' and con.contype = 'c'
  loop
    execute format('alter table public.registrations drop constraint %I', constraint_name);
  end loop;
end $$;

-- Triggers from the first version compare year to an integer too, so remove
-- them before the type change.
drop trigger if exists registration_capacity_guard       on public.registrations;
drop trigger if exists registration_total_capacity_guard on public.registrations;
drop trigger if exists registration_year_three_guard     on public.registrations;
drop function if exists public.enforce_year_three_capacity();
drop function if exists public.enforce_total_registration_capacity();
drop function if exists public.year_three_slots(text);
drop function if exists public.registration_slots_remaining();

-- year was integer in the first version; the app treats it as text.
do $$
declare
  current_type text;
begin
  select data_type into current_type from information_schema.columns
   where table_schema = 'public' and table_name = 'registrations' and column_name = 'year';
  if current_type in ('integer', 'bigint', 'smallint') then
    execute 'alter table public.registrations alter column year type text using year::text';
  end if;
end $$;

-- 3. Normalised keys that power duplicate detection.
--    Generated columns cannot be added conditionally inside one statement, so
--    check first. Existing rows are backfilled automatically by Postgres.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'registrations' and column_name = 'email_key') then
    execute $sql$alter table public.registrations
                 add column email_key text generated always as (lower(btrim(email))) stored$sql$;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'registrations' and column_name = 'phone_key') then
    execute $sql$alter table public.registrations
                 add column phone_key text generated always as
                 (right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)) stored$sql$;
  end if;
end $$;

-- 4. Event name check. Drop the old constraint first: the original version
--    allowed different names, which would reject valid rows now.
alter table public.registrations drop constraint if exists registrations_event_check;
alter table public.registrations add  constraint registrations_event_check
  check (event in ('Flush the Brain','Treasure Hunt','Bug Hunt','Murder Mystery','Debate'))
  not valid;   -- not valid = existing rows are left alone, new rows are checked

alter table public.registrations drop constraint if exists registrations_year_check;
alter table public.registrations add  constraint registrations_year_check
  check (year in ('1','2','3')) not valid;

-- 5. Duplicate protection, enforced by the database so it holds even when two
--    students submit at the same instant.
--    If this fails you already have duplicate rows: the query at the very
--    bottom of this file will show them.
create unique index if not exists uniq_event_email on public.registrations (event, email_key);
create unique index if not exists uniq_event_phone on public.registrations (event, phone_key);

create index if not exists idx_registrations_event      on public.registrations (event);
create index if not exists idx_registrations_created_at on public.registrations (created_at desc);

-- 6. Row Level Security: the API uses the service role key, which bypasses RLS.
--    Enabling it with no public policy means a leaked anon key grants nothing.
alter table public.registrations enable row level security;
drop policy if exists "public can create registrations" on public.registrations;
drop policy if exists "anon can read registrations"     on public.registrations;

-- 7. Year 3 eligibility, enforced server-side as well as in the form.
create or replace function public.enforce_year_three_rule()
returns trigger language plpgsql as $$
begin
  if new.event in ('Flush the Brain','Treasure Hunt','Murder Mystery') then
    if new.year = '3' or new.partner_year = '3' then
      raise exception 'Year 3 students are not eligible for this event.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists registration_capacity_guard        on public.registrations;
drop trigger if exists registration_total_capacity_guard  on public.registrations;
drop trigger if exists registration_year_three_guard      on public.registrations;
create trigger registration_year_three_guard
  before insert on public.registrations
  for each row execute function public.enforce_year_three_rule();

-- How many Year 3 places each limited event offers. Keep this in step with
-- YEAR_THREE_LIMIT in src/server/validate.js.
create or replace function public.year_three_cap(event_name text)
returns integer language sql immutable as $$
  select case when event_name in ('Bug Hunt','Debate') then 15 else 0 end;
$$;

-- How many Year 3 places a single submission would consume.
create or replace function public.new_year_three_seats(payload jsonb)
returns integer language sql immutable as $$
  select (case when payload->>'year' = '3' then 1 else 0 end)
       + (case when payload->>'partnerYear' = '3' then 1 else 0 end);
$$;

-- 8. Atomic insert with an optional global cap. Counting and inserting in one
--    call prevents the last place being handed to two people at once.
create or replace function public.create_registration(payload jsonb, total_capacity integer default 0)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  inserted public.registrations;
begin
  if total_capacity > 0 then
    perform pg_advisory_xact_lock(hashtext('aura_registration_capacity'));
    if (select count(*) from public.registrations) >= total_capacity then
      raise exception 'Registration is closed. All % places are filled.', total_capacity
        using errcode = 'check_violation';
    end if;
  end if;

  -- Year 3 places are limited for Bug Hunt and Debate (15 each). Counted per
  -- student, so a team with two Year 3 members uses two places. The advisory
  -- lock makes the count and the insert atomic under simultaneous submissions.
  if new_year_three_seats(payload) > 0
     and year_three_cap(payload->>'event') > 0 then
    perform pg_advisory_xact_lock(hashtext('aura_year_three_' || (payload->>'event')));
    if (select count(*) from public.registrations
          where event = payload->>'event' and year = '3')
     + (select count(*) from public.registrations
          where event = payload->>'event' and partner_year = '3')
     + new_year_three_seats(payload) > year_three_cap(payload->>'event') then
      raise exception 'All % Year 3 places for % are filled.',
        year_three_cap(payload->>'event'), payload->>'event'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.registrations
    (event, choice, team_name, name, department, year,
     partner_name, partner_department, partner_year, phone, email)
  values (
    payload->>'event',      nullif(payload->>'choice', ''),
    nullif(payload->>'teamName', ''),
    payload->>'name',       payload->>'department', payload->>'year',
    nullif(payload->>'partnerName', ''),
    nullif(payload->>'partnerDepartment', ''),
    nullif(payload->>'partnerYear', ''),
    payload->>'phone',      payload->>'email'
  )
  returning * into inserted;

  return inserted;
end;
$$;

-- 9. Dashboard counts in a single round trip.
create or replace function public.registration_stats()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'total',   (select count(*) from public.registrations),
    'teams',   (select count(*) from public.registrations where team_name is not null and team_name <> ''),
    'byEvent', coalesce((select jsonb_object_agg(event, c)
                         from (select event, count(*) as c from public.registrations group by event) s), '{}'::jsonb)
  );
$$;

revoke all on function public.create_registration(jsonb, integer) from anon, authenticated;
revoke all on function public.registration_stats()                from anon, authenticated;

-- Done. Expect "Success. No rows returned."
--
-- If step 5 failed with "could not create unique index", you have duplicates.
-- Find them with:
--   select event, lower(btrim(email)) as email, count(*)
--     from public.registrations group by 1,2 having count(*) > 1;
-- Delete the extras, then run this file again.
