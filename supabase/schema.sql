-- Scheidsrechtersapp – database schema voor Supabase.
-- Plak dit in Supabase → SQL Editor → New query → Run. Opnieuw uitvoeren is veilig.

create extension if not exists pgcrypto;

-- Profiel per ingelogde gebruiker. Rol: 'planner' of 'referee'.
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  name text,
  role text not null default 'referee' check (role in ('planner', 'referee')),
  created_at timestamptz default now()
);

-- Scheidsrechters. user_id is leeg zolang iemand nog niet heeft ingelogd (of geen account heeft).
-- Alleen wie hier met zijn e-mailadres staat, kan een account aanmaken.
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

-- Meldingen: voor één scheidsrechter (referee_id) of voor alle planners (to_planners).
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  referee_id uuid references public.referees on delete cascade,
  to_planners boolean not null default false,
  kind text not null,
  title text not null,
  body text,
  match_id uuid references public.matches on delete set null,
  date date,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_ref_idx on public.notifications (referee_id, created_at desc);

-- Pushmeldingen: één rij per toestel dat meldingen heeft aangezet.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz default now()
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

create or replace function public.match_label(m public.matches) returns text
language sql immutable as $$
  select to_char(m.date, 'DD-MM') || ' ' || m.time || ' ' || m.home
    || coalesce(' – ' || nullif(m.away, ''), '') || coalesce(', ' || nullif(m.field, ''), '');
$$;

-- Aanmelden kan alleen met een e-mailadres dat de planner heeft toegevoegd.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare ref referees;
begin
  select * into ref from referees
   where user_id is null and lower(email) = lower(new.email)
   order by created_at limit 1;
  if ref.id is null then
    raise exception 'Dit e-mailadres is niet bekend bij de club. Vraag de planner om je toe te voegen.';
  end if;
  insert into profiles (id, email, name) values (new.id, new.email, ref.name)
  on conflict (id) do nothing;
  update referees set user_id = new.id where id = ref.id;
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

-- Planner maakt iemand anders planner (of niet meer). Jezelf terugzetten kan niet,
-- zodat de club nooit zonder planner komt te zitten.
create or replace function public.set_planner(p_referee uuid, p_value boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not is_planner() then raise exception 'Alleen planners kunnen dit wijzigen.'; end if;
  select user_id into uid from referees where id = p_referee;
  if uid is null then raise exception 'Deze scheidsrechter heeft nog niet ingelogd.'; end if;
  if uid = auth.uid() and not p_value then raise exception 'Je kunt jezelf niet als planner verwijderen.'; end if;
  update profiles set role = case when p_value then 'planner' else 'referee' end where id = uid;
end $$;

-- Rollen van gekoppelde scheidsrechters (alleen voor planners).
create or replace function public.planner_referees() returns setof uuid
language sql stable security definer set search_path = public as $$
  select r.id from referees r join profiles p on p.id = r.user_id
   where p.role = 'planner' and is_planner();
$$;

-- Meldingen bij wijzigingen in de planning ------------------------------------
create or replace function public.notify_match_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.published and old.referee_id is not null then
      insert into notifications (referee_id, kind, title, body, date)
      values (old.referee_id, 'cancelled', 'Wedstrijd vervallen', match_label(old), old.date);
    end if;
    return old;
  end if;

  if old.published and old.referee_id is not null
     and (new.referee_id is distinct from old.referee_id or not new.published) then
    insert into notifications (referee_id, kind, title, body, match_id, date)
    values (old.referee_id, 'withdrawn', 'Aanstelling ingetrokken', match_label(old), new.id, old.date);
  elsif old.published and new.published and new.referee_id = old.referee_id
     and (new.date, new.time, coalesce(new.field, '')) is distinct from (old.date, old.time, coalesce(old.field, '')) then
    insert into notifications (referee_id, kind, title, body, match_id, date)
    values (new.referee_id, 'changed', 'Wedstrijd gewijzigd', match_label(new) || ' (was ' || match_label(old) || ')', new.id, new.date);
  end if;

  if new.published and new.referee_id is not null
     and (not old.published or old.referee_id is distinct from new.referee_id) then
    insert into notifications (referee_id, kind, title, body, match_id, date)
    values (new.referee_id, 'assigned', 'Je bent aangesteld', match_label(new), new.id, new.date);
  end if;
  return new;
end $$;
drop trigger if exists matches_notify on public.matches;
create trigger matches_notify after update or delete on public.matches
  for each row execute function public.notify_match_change();

-- Scheidsrechter meldt zich af op een dag waarop hij al is aangesteld → melding voor planners.
create or replace function public.notify_unavailable() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; who text;
begin
  -- Geen melding als het al 'niet beschikbaar' was, of als een planner het voor iemand anders invult.
  if new.available or (tg_op = 'UPDATE' and not old.available)
     or (is_planner() and new.referee_id is distinct from my_referee_id()) then return new; end if;
  select count(*) into n from matches where referee_id = new.referee_id and date = new.date;
  if n = 0 then return new; end if;
  select name into who from referees where id = new.referee_id;
  insert into notifications (to_planners, kind, title, body, date)
  values (true, 'unavailable', who || ' heeft zich afgemeld',
          'Afgemeld voor ' || to_char(new.date, 'DD-MM') || ', maar aangesteld bij ' || n || ' wedstrijd(en).', new.date);
  return new;
end $$;
drop trigger if exists availability_notify on public.availability;
create trigger availability_notify after insert or update on public.availability
  for each row execute function public.notify_unavailable();

-- Row Level Security ---------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.referees enable row level security;
alter table public.matches enable row level security;
alter table public.availability enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;

-- Scheidsrechters zien alleen hun eigen gegevens; planners zien alles.
drop policy if exists "profiles read" on public.profiles;
drop policy if exists "profiles update" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (id = auth.uid() or is_planner());
create policy "profiles update" on public.profiles for update to authenticated
  using (id = auth.uid() or is_planner());

drop policy if exists "referees read" on public.referees;
drop policy if exists "referees planner" on public.referees;
drop policy if exists "referees self" on public.referees;
create policy "referees read" on public.referees for select to authenticated
  using (user_id = auth.uid() or is_planner());
create policy "referees planner" on public.referees for all to authenticated
  using (is_planner()) with check (is_planner());
create policy "referees self" on public.referees for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Iedereen die is ingelogd ziet het wedstrijdprogramma (nodig voor de beschikbaarheidsdagen);
-- de app toont scheidsrechters alleen hun eigen, gepubliceerde aanstellingen.
drop policy if exists "matches read" on public.matches;
drop policy if exists "matches planner" on public.matches;
create policy "matches read" on public.matches for select to authenticated using (true);
create policy "matches planner" on public.matches for all to authenticated
  using (is_planner()) with check (is_planner());

drop policy if exists "availability read" on public.availability;
drop policy if exists "availability own" on public.availability;
drop policy if exists "availability planner" on public.availability;
create policy "availability own" on public.availability for all to authenticated
  using (referee_id = my_referee_id()) with check (referee_id = my_referee_id());
create policy "availability planner" on public.availability for all to authenticated
  using (is_planner()) with check (is_planner());

drop policy if exists "notifications read" on public.notifications;
drop policy if exists "notifications mark read" on public.notifications;
create policy "notifications read" on public.notifications for select to authenticated
  using (referee_id = my_referee_id() or (to_planners and is_planner()));
create policy "notifications mark read" on public.notifications for update to authenticated
  using (referee_id = my_referee_id() or (to_planners and is_planner()));

drop policy if exists "push own" on public.push_subscriptions;
create policy "push own" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Realtime: wijzigingen direct naar alle telefoons.
do $$ begin
  alter publication supabase_realtime add table public.matches, public.referees, public.availability, public.notifications;
exception when others then null; end $$;

-- Eerste planner instellen:
--   1. insert into public.referees (name, email, active) values ('Jouw naam', 'jij@voorbeeld.nl', true);
--   2. Log één keer in de app in met dat e-mailadres.
--   3. update public.profiles set role = 'planner' where email = 'jij@voorbeeld.nl';
-- Daarna kun je andere planners in de app aanwijzen (Scheidsen → naam → Planner).
