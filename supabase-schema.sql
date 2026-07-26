-- AURA 2026 — Supabase schema.
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to re-run: every statement is idempotent.

create extension if not exists pgcrypto;

create table if not exists public.registrations (
  id                 uuid primary key default gen_random_uuid(),
  event              text not null check (event in
                       ('Flush the Brain','Treasure Hunt','Bug Hunt','Murder Mystery','Debate')),
  choice             text,
  team_name          text,
  name               text not null,
  department         text not null,
  year               text not null check (year in ('1','2','3')),
  partner_name       text,
  partner_department text,
  partner_year       text,
  phone              text not null,
  email              text not null,
  -- Normalised keys power the duplicate constraints below.
  email_key          text generated always as (lower(btrim(email))) stored,
  phone_key          text generated always as (right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)) stored,
  created_at         timestamptz not null default now()
);

-- Duplicate protection, enforced by the database so it holds even when two
-- students submit at the same instant.
create unique index if not exists uniq_event_email on public.registrations (event, email_key);
create unique index if not exists uniq_event_phone on public.registrations (event, phone_key);

create index if not exists idx_registrations_event      on public.registrations (event);
create index if not exists idx_registrations_created_at on public.registrations (created_at desc);

-- Row Level Security: the API talks to Postgres with the service role key,
-- which bypasses RLS. Enabling it with no public policy means that even if the
-- anon key leaks, nobody can read or write participant data directly.
alter table public.registrations enable row level security;

drop policy if exists "public can create registrations" on public.registrations;
drop policy if exists "anon can read registrations"     on public.registrations;

-- Year 3 eligibility, enforced server-side as well as in the form.
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

drop trigger if exists registration_year_three_guard on public.registrations;
create trigger registration_year_three_guard
  before insert on public.registrations
  for each row execute function public.enforce_year_three_rule();

-- Atomic insert with an optional global cap. Counting and inserting inside one
-- function call prevents the last place being handed to two people at once.
create or replace function public.create_registration(payload jsonb, total_capacity integer default 0)
returns public.registrations
language plpgsql security definer set search_path = public as $$
declare
  inserted public.registrations;
begin
  if total_capacity > 0 then
    -- Serialise concurrent callers so the count cannot go stale mid-insert.
    perform pg_advisory_xact_lock(hashtext('aura_registration_capacity'));
    if (select count(*) from public.registrations) >= total_capacity then
      raise exception 'Registration is closed. All % places are filled.', total_capacity
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

-- Aggregate counts in one round trip for the dashboard.
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
revoke all on function public.registration_stats() from anon, authenticated;
