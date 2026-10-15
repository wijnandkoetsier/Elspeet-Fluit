-- Scheidsrechtersapp – database schema voor Supabase.
-- Plak dit in Supabase → SQL Editor → New query → Run.

create extension if not exists pgcrypto;

-- Profiel per ingelogde gebruiker. Rol: 'planner' of 'referee'.
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  name text,
  role text not null default 'referee' check (role in ('planner', 'referee')),
  created_at timestamptz default now()
);

-- Scheidsrechters. user_id is leeg voor scheidsrechters zonder account.
create table if not exists public.referees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  user_id uuid unique references auth.users on delete set null,
  pref_categories text[] not null default '{}',
  avoid_categories text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz default now()
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  time text not null,                 -- 'HH:MM'
  duration int not null default 90,   -- minuten
  home text not null,
  away text,
  field text,
  category text,
  referee_id uuid references public.referees on delete set null,
  published boolean not null default false,
  external_ref boolean not null default false,  -- KNVB stelt scheidsrechter aan
  notes text,
  created_at timestamptz default now()
);
create index if not exists matches_date_idx on public.matches (date);

create table if not exists public.availability (
  id uuid primary key default gen_random_uuid(),
  referee_id uuid not null references public.referees on delete cascade,
  date date not null,
  available boolean not null default true,
  start_time text,
  end_time text,
  max_matches int,
  updated_at timestamptz default now(),
  unique (referee_id, date)
);

-- Helpers ------------------------------------------------------------------
create or replace function public.is_planner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'planner');
$$;

create or replace function public.my_referee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from referees where user_id = auth.uid();
$$;

-- Bij een nieuwe aanmelding: profiel aanmaken en koppelen aan een bestaande
-- scheidsrechter met hetzelfde e-mailadres (of een nieuwe aanmaken).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare ref_id uuid;
begin
  insert into profiles (id, email, name) values (new.id, new.email, split_part(new.email, '@', 1))
  on conflict (id) do nothing;

  update referees set user_id = new.id
   where user_id is null and lower(email) = lower(new.email)
   returning id into ref_id;

  if ref_id is null then
    insert into referees (name, email, user_id) values (split_part(new.email, '@', 1), new.email, new.id);
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Scheidsrechters mogen alleen hun eigen voorkeuren en naam wijzigen.
create or replace function public.guard_referee_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() is leeg bij systeemacties (zoals de aanmeld-trigger); dan niets blokkeren.
  if auth.uid() is not null and not is_planner() then
    new.user_id := old.user_id;
    new.email := old.email;
    new.active := old.active;
  end if;
  return new;
end $$;
drop trigger if exists referees_guard on public.referees;
create trigger referees_guard before update on public.referees
  for each row execute function public.guard_referee_update();

-- Gebruikers mogen hun eigen rol niet aanpassen.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_planner() then new.role := old.role; end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Row Level Security ---------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.referees enable row level security;
alter table public.matches enable row level security;
alter table public.availability enable row level security;

drop policy if exists "profiles read" on public.profiles;
drop policy if exists "profiles update" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (true);
create policy "profiles update" on public.profiles for update to authenticated
  using (id = auth.uid() or is_planner());

drop policy if exists "referees read" on public.referees;
drop policy if exists "referees planner" on public.referees;
drop policy if exists "referees self" on public.referees;
create policy "referees read" on public.referees for select to authenticated using (true);
create policy "referees planner" on public.referees for all to authenticated
  using (is_planner()) with check (is_planner());
create policy "referees self" on public.referees for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Iedereen leest alle wedstrijden; de app toont scheidsrechters alleen gepubliceerde aanstellingen.
drop policy if exists "matches read" on public.matches;
drop policy if exists "matches planner" on public.matches;
create policy "matches read" on public.matches for select to authenticated using (true);
create policy "matches planner" on public.matches for all to authenticated
  using (is_planner()) with check (is_planner());

drop policy if exists "availability read" on public.availability;
drop policy if exists "availability own" on public.availability;
drop policy if exists "availability planner" on public.availability;
create policy "availability read" on public.availability for select to authenticated using (true);
create policy "availability own" on public.availability for all to authenticated
  using (referee_id = my_referee_id()) with check (referee_id = my_referee_id());
create policy "availability planner" on public.availability for all to authenticated
  using (is_planner()) with check (is_planner());

-- Realtime: wijzigingen direct naar alle telefoons.
do $$ begin
  alter publication supabase_realtime add table public.matches, public.referees, public.availability;
exception when others then null; end $$;

-- Eerste planner instellen (na eerste keer inloggen), bijvoorbeeld:
-- update public.profiles set role = 'planner' where email = 'planner@jouwclub.nl';
