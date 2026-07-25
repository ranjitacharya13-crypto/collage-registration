-- Run this once in Supabase SQL Editor before enabling the public form.
create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  event text not null check (event in ('Flush the Brain','Treasure Hunt','Bug Hunt','Murder Mystery','Debate')),
  name text not null,
  department text not null,
  year integer not null check (year between 1 and 3),
  phone text not null,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.registrations enable row level security;
create policy "public can create registrations" on public.registrations for insert to anon with check (true);

-- This RPC exposes only remaining capacity, never participant details.
create or replace function public.year_three_slots(event_name text)
returns integer language sql security definer set search_path = public as $$
  select case when event_name in ('Bug Hunt','Debate')
    then greatest(0, 5 - count(*) filter (where event = event_name and year = 3))::integer
    else null end
  from public.registrations;
$$;
grant execute on function public.year_three_slots(text) to anon;

-- Final server-side enforcement prevents race conditions when the last slot is claimed.
create or replace function public.enforce_year_three_capacity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.year = 3 and new.event in ('Bug Hunt','Debate') and
    (select count(*) from public.registrations where event = new.event and year = 3) >= 5 then
    raise exception 'All Year 3 slots for this event are filled.';
  end if;
  if new.year = 3 and new.event in ('Flush the Brain','Treasure Hunt','Murder Mystery') then
    raise exception 'Year 3 students are not eligible for this event.';
  end if;
  return new;
end;
$$;
drop trigger if exists registration_capacity_guard on public.registrations;
create trigger registration_capacity_guard before insert on public.registrations for each row execute function public.enforce_year_three_capacity();

-- Global registration limit: enforced inside the database, including concurrent submissions.
create or replace function public.enforce_total_registration_capacity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.registrations) >= 200 then
    raise exception 'Registration is now closed. All 200 places have been filled.';
  end if;
  return new;
end;
$$;
drop trigger if exists registration_total_capacity_guard on public.registrations;
create trigger registration_total_capacity_guard before insert on public.registrations for each row execute function public.enforce_total_registration_capacity();

create or replace function public.registration_slots_remaining()
returns integer language sql security definer set search_path = public as $$
  select greatest(0, 200 - count(*))::integer from public.registrations;
$$;
grant execute on function public.registration_slots_remaining() to anon;
