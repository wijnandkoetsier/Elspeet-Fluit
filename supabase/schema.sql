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
-- Wedstrijden uit Sportlink (zie hosting/sportlink-sync.php): herkend aan de Sportlink-wedstrijdcode.
alter table public.matches add column if not exists sportlink_code text unique;
alter table public.matches add column if not exists source text not null default 'manual';
alter table public.matches add column if not exists match_type text;          -- 'Oefen', 'Beker' of leeg (competitie)
alter table public.matches add column if not exists sportlink_referee text;   -- scheidsrechter volgens Sportlink
alter table public.matches add column if not exists referee_from_sportlink boolean not null default false;
-- JO7-ochtend: één wedstrijd in de app (één scheidsrechter), de losse wedstrijden staan hierin:
-- [{"time": "09:00", "opponent": "SVO JO7-1", "field": "Veld 3", "code": "..."}, ...]
alter table public.matches add column if not exists parts jsonb;
-- Afgelast (volgt Sportlink, of door de planner aangevinkt): blijft zichtbaar, maar heeft geen scheidsrechter nodig.
alter table public.matches add column if not exists cancelled boolean not null default false;
-- Scheidsrechters die uit Sportlink zijn overgenomen worden herkend aan hun naam in Sportlink.
alter table public.referees add column if not exists sportlink_name text;
-- Rol: is_referee = kan worden ingepland (uit = alleen planner). invite_planner = wordt planner bij
-- de eerste keer inloggen (en blijft gelijk met de rol daarna).
alter table public.referees add column if not exists is_referee boolean not null default true;
alter table public.referees add column if not exists invite_planner boolean not null default false;
-- Telefoonnummer, zodat de planner kan bellen of appen (scheidsrechter mag het zelf aanpassen).
alter table public.referees add column if not exists phone text;

-- Logboek van de Sportlink-synchronisatie (laatste run zichtbaar voor planners).
create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'sportlink',
  at timestamptz not null default now(),
  ok boolean not null,
  added int not null default 0,
  updated int not null default 0,
  removed int not null default 0,
  total int not null default 0,
  message text
);

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
-- Aanvangstijden waarop iemand kan fluiten (leeg = alle tijden van die dag).
alter table public.availability add column if not exists times text[] not null default '{}';

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

-- Scheidsrechter biedt zich aan voor een open wedstrijd ("Ik kan fluiten").
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches on delete cascade,
  referee_id uuid not null references public.referees on delete cascade,
  created_at timestamptz not null default now(),
  unique (match_id, referee_id)
);

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

-- Wedstrijd in een melding: "do 30 okt 20:00 · Elspeet VR30+1 – Hierden VR30+2 · Veld 1 A".
-- Zelfde opbouw als matchLabel() in js/logic.js.
create or replace function public.match_label(m public.matches) returns text
language sql immutable as $$
  select (array['zo','ma','di','wo','do','vr','za'])[extract(dow from m.date)::int + 1] || ' '
    || extract(day from m.date)::int || ' '
    || (array['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'])[extract(month from m.date)::int] || ' '
    || m.time || ' · ' || m.home
    || coalesce(' – ' || nullif(m.away, ''), '') || coalesce(' · ' || nullif(m.field, ''), '');
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
  insert into profiles (id, email, name, role)
  values (new.id, new.email, ref.name, case when ref.invite_planner then 'planner' else 'referee' end)
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
    new.is_referee := old.is_referee;
    new.invite_planner := old.invite_planner;
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
-- zodat de club nooit zonder planner komt te zitten. Nog niet ingelogd: wordt planner bij de eerste keer inloggen.
create or replace function public.set_planner(p_referee uuid, p_value boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not is_planner() then raise exception 'Alleen planners kunnen dit wijzigen.'; end if;
  select user_id into uid from referees where id = p_referee;
  if uid = auth.uid() and not p_value then raise exception 'Je kunt jezelf niet als planner verwijderen.'; end if;
  update referees set invite_planner = p_value where id = p_referee;
  if uid is not null then
    update profiles set role = case when p_value then 'planner' else 'referee' end where id = uid;
  end if;
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

  -- Afgelast of toch weer door: melding voor de aangestelde scheidsrechter.
  if old.published and new.published and new.referee_id is not null and new.referee_id = old.referee_id
     and new.cancelled is distinct from old.cancelled then
    insert into notifications (referee_id, kind, title, body, match_id, date)
    values (new.referee_id, case when new.cancelled then 'cancelled' else 'changed' end,
            case when new.cancelled then 'Wedstrijd afgelast' else 'Wedstrijd gaat toch door' end,
            match_label(new), new.id, new.date);
    return new;
  end if;

  -- Geen melding als de scheidsrechter zelf net is verwijderd (dan wordt de wedstrijd vrijgemaakt).
  if old.published and old.referee_id is not null
     and (new.referee_id is distinct from old.referee_id or not new.published)
     and exists (select 1 from referees where id = old.referee_id) then
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
  select count(*) into n from matches where referee_id = new.referee_id and date = new.date and not cancelled;
  if n = 0 then return new; end if;
  select name into who from referees where id = new.referee_id;
  insert into notifications (to_planners, kind, title, body, date)
  values (true, 'unavailable', who || ' heeft zich afgemeld',
          'Afgemeld voor ' || to_char(new.date, 'DD-MM') || ', maar aangesteld bij ' || n || case when n = 1 then ' wedstrijd.' else ' wedstrijden.' end, new.date);
  return new;
end $$;
-- Aanbod van een scheidsrechter → melding voor planners.
create or replace function public.notify_offer() returns trigger
language plpgsql security definer set search_path = public as $$
declare m matches; who text;
begin
  select * into m from matches where id = new.match_id;
  select name into who from referees where id = new.referee_id;
  insert into notifications (to_planners, kind, title, body, match_id, date)
  values (true, 'offer', who || ' wil fluiten', match_label(m), m.id, m.date);
  return new;
end $$;
drop trigger if exists offers_notify on public.offers;
create trigger offers_notify after insert on public.offers
  for each row execute function public.notify_offer();

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
alter table public.sync_runs enable row level security;
alter table public.offers enable row level security;

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

drop policy if exists "sync runs read" on public.sync_runs;
create policy "sync runs read" on public.sync_runs for select to authenticated using (is_planner());
-- Schrijven gebeurt alleen door de synchronisatie zelf, met de service role-sleutel (die RLS overslaat).

drop policy if exists "offers read" on public.offers;
drop policy if exists "offers own insert" on public.offers;
drop policy if exists "offers delete" on public.offers;
create policy "offers read" on public.offers for select to authenticated
  using (referee_id = my_referee_id() or is_planner());
create policy "offers own insert" on public.offers for insert to authenticated
  with check (referee_id = my_referee_id());
create policy "offers delete" on public.offers for delete to authenticated
  using (referee_id = my_referee_id() or is_planner());

drop policy if exists "push own" on public.push_subscriptions;
create policy "push own" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Realtime: wijzigingen direct naar alle telefoons.
do $$ begin
  alter publication supabase_realtime add table public.matches, public.referees, public.availability, public.notifications;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.offers;
exception when others then null; end $$;

-- Herinnering: elke donderdagavond een melding (en pushmelding) voor wie de komende week wedstrijden
-- heeft om te fluiten, maar nog niet heeft doorgegeven of hij of zij kan. Eén melding per persoon per dag.
create or replace function public.remind_availability() returns int
language plpgsql security definer set search_path = public as $$
declare
  day_names text[] := array['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  month_names text[] := array['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus',
    'september', 'oktober', 'november', 'december'];
  rec record;
  sent int := 0;
begin
  for rec in
    select distinct on (r.id) r.id as referee_id, m.date
    from referees r
    join matches m on m.date between current_date + 1 and current_date + 7 and not m.external_ref and not m.cancelled
    where r.active and r.is_referee and r.user_id is not null
      and not exists (select 1 from availability a where a.referee_id = r.id and a.date = m.date)
      and not exists (select 1 from notifications n where n.referee_id = r.id and n.kind = 'reminder' and n.date = m.date)
    order by r.id, m.date
  loop
    insert into notifications (referee_id, kind, title, body, date)
    values (rec.referee_id, 'reminder', 'Vul je beschikbaarheid in',
      'Voor ' || day_names[extract(dow from rec.date)::int + 1] || ' ' || extract(day from rec.date)::int || ' '
        || month_names[extract(month from rec.date)::int] || ' weten we nog niet of je kunt fluiten.',
      rec.date);
    sent := sent + 1;
  end loop;
  return sent;
end $$;
revoke execute on function public.remind_availability() from public, anon, authenticated;

-- Inplannen met pg_cron: donderdag 17:00 UTC (18:00 in de winter, 19:00 in de zomer).
-- Lukt dit niet? Zet in Supabase de extensie pg_cron aan (Database → Extensions) en voer dit bestand opnieuw uit.
do $$ begin
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.unschedule(jobid) from cron.job where jobname = 'beschikbaarheid-herinnering';
  perform cron.schedule('beschikbaarheid-herinnering', '0 17 * * 4', 'select public.remind_availability()');
exception when others then
  raise notice 'Herinnering niet ingepland (%). Zet pg_cron aan en voer dit bestand opnieuw uit.', sqlerrm;
end $$;

-- Eerste planner instellen:
--   1. insert into public.referees (name, email, active) values ('Jouw naam', 'jij@voorbeeld.nl', true);
--   2. Log één keer in de app in met dat e-mailadres.
--   3. update public.profiles set role = 'planner' where email = 'jij@voorbeeld.nl';
-- Daarna kun je andere planners in de app aanwijzen (Scheidsen → naam → Planner).

-- Categorieën per team (senioren 1e–5e, 7x7, 35+, 40+; vrouwen VR1, VR30+) in plaats van
-- Senioren/Veteranen/Vrouwen. Zelfde regels als categoryFromTeam() in js/logic.js. Eenmalig, mag vaker.
update public.matches set category = case
    when home ~ '30\+' then 'VR30+'
    when home ~* '(\mvr\s?\d|vrouwen|dames)' then 'VR1'
    when home ~ '4[05]\+' then '40+'
    when home ~* '(35\+|vet|ve\d)' then '35+'
    when home ~* '7\s?[x×]\s?7' then '7x7'
    when home ~ '\d+\s*(\([^)]*\))?\s*$' then (substring(home from '(\d+)\s*(?:\([^)]*\))?\s*$')::int)::text || 'e'
    else '1e' end
  where category in ('Senioren', 'Veteranen', 'Vrouwen', '45+');

create or replace function public.upgrade_categories(list text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct c), '{}') from unnest(list) p,
    lateral unnest(case p
      when 'Senioren' then array['1e', '2e', '3e', '4e', '5e', '7x7']
      when 'Veteranen' then array['35+', '40+']
      when '45+' then array['40+']
      when 'Vrouwen' then array['VR1', 'VR30+']
      else array[p] end) c
$$;
update public.referees set pref_categories = public.upgrade_categories(pref_categories),
    avoid_categories = public.upgrade_categories(avoid_categories)
  where pref_categories && array['Senioren', 'Veteranen', 'Vrouwen', '45+'] or avoid_categories && array['Senioren', 'Veteranen', 'Vrouwen', '45+'];
