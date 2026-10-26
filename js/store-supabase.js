// Cloud store: Supabase (Postgres + Auth + Realtime). Schema: supabase/schema.sql.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

// Supabase reports a refused sign-up (our handle_new_user trigger) as a generic database error.
// Login messages only apply to login calls (context 'auth'); database errors get their own wording.
function friendly(message, context = 'db') {
  if (context === 'auth') {
    if (/database error saving new user|niet bekend bij de club/i.test(message)) {
      return 'Dit e-mailadres is niet bekend bij de club. Vraag de planner om je toe te voegen.';
    }
    if (/token has expired|otp.*(expired|invalid)|invalid.*(otp|token)/i.test(message)) return 'De code klopt niet of is verlopen. Vraag een nieuwe code aan.';
    // Two different Supabase limits: one request per ~60 s per address, and (without own SMTP)
    // only a few e-mails per hour for the whole project.
    const secs = message.match(/after (\d+) seconds?/i);
    if (secs) return `Even wachten: je kunt over ${secs[1]} seconden een nieuwe code aanvragen.`;
    if (/email rate limit|over_email_send_rate_limit/i.test(message)) {
      return 'Er zijn het afgelopen uur te veel inlogmails verstuurd. Gebruik de code uit de laatste mail die je kreeg (die werkt een uur), of probeer het later opnieuw.';
    }
    if (/rate limit|too many|security purposes/i.test(message)) return 'Te veel pogingen achter elkaar. Wacht even en probeer het dan opnieuw.';
    // The mail server (SMTP) refused or failed to send the e-mail.
    if (/not authorized|error sending (magic link|confirmation|otp)/i.test(message)) {
      return 'De inlogmail kon niet worden verstuurd. Probeer het over een paar minuten opnieuw. Lukt het dan nog niet, laat het de planner weten.';
    }
    return message;
  }
  if (/jwt|row-level security|permission denied/i.test(message)) {
    return 'Opslaan is niet gelukt: je inlog is verlopen of je hebt hier geen rechten voor. Log uit en opnieuw in.';
  }
  if (/failed to fetch|network/i.test(message)) return 'Geen verbinding. Controleer je internet en probeer het opnieuw.';
  return message;
}

export function createSupabaseStore(url, key) {
  const sb = createClient(url, key, { auth: { persistSession: true, detectSessionInUrl: true } });
  let user = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f());
  const check = ({ data, error }) => { if (error) throw new Error(friendly(error.message)); return data; };
  const checkAuth = ({ data, error }) => { if (error) throw new Error(friendly(error.message, 'auth')); return data; };

  // Writes: if the login has expired (common after the app sat in the background), refresh it and
  // try once more. Updates select the changed ids, because a refused update returns no error.
  async function write(run, { expectRows = 0 } = {}) {
    let res = await run();
    if (res.error && /jwt|row-level security|permission denied/i.test(res.error.message)) {
      await sb.auth.refreshSession().catch(() => {});
      res = await run();
    }
    const data = check(res);
    if (expectRows && Array.isArray(data) && data.length === 0) {
      throw new Error(friendly('row-level security'));
    }
    return data;
  }

  async function loadUser(session) {
    if (!session) { user = null; return null; }
    const profile = check(await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle());
    const ref = check(await sb.from('referees').select('id').eq('user_id', session.user.id).maybeSingle());
    user = {
      id: session.user.id,
      email: session.user.email,
      name: profile?.name || session.user.email,
      role: profile?.role || 'referee',
      referee_id: ref?.id || null,
    };
    return user;
  }

  sb.channel('db-changes')
    .on('postgres_changes', { event: '*', schema: 'public' }, emit)
    .subscribe();

  return {
    mode: 'cloud',
    get user() { return user; },
    async init() {
      const { data } = await sb.auth.getSession();
      // Never await Supabase calls inside this callback: supabase-js holds its auth lock while it runs,
      // so a query here (e.g. during the hourly token refresh) waits for itself and every later
      // request hangs. Defer the work, and only reload the profile when someone signs in or out.
      sb.auth.onAuthStateChange((event, session) => {
        if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return;
        setTimeout(async () => {
          const before = user?.id;
          try { await loadUser(session); } catch { /* shown on the next action */ }
          if (before !== user?.id) emit();
        }, 0);
      });
      return loadUser(data.session);
    },
    // Step 1: e-mail a 6-digit code (the e-mail also contains a link, which keeps working in a browser).
    async signIn({ email }) {
      checkAuth(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } }));
      return { done: false, message: `We hebben een code gestuurd naar ${email}.` };
    },
    // Step 2: the code typed into the app, so login also works inside an installed app.
    async verifyCode({ email, token }) {
      const data = checkAuth(await sb.auth.verifyOtp({ email, token, type: 'email' }));
      await loadUser(data.session);
      emit();
    },
    async signOut() { await sb.auth.signOut(); user = null; emit(); },
    async loadAll() {
      const planner = user?.role === 'planner';
      const [matches, referees, availability, notifications, plannerIds, syncRuns, offers, signups] = await Promise.all([
        sb.from('matches').select('*').order('date').order('time'),
        sb.from('referees').select('*').order('name'),
        sb.from('availability').select('*'),
        sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(100),
        planner ? sb.rpc('planner_referees') : Promise.resolve({ data: [] }),
        planner ? sb.from('sync_runs').select('*').order('at', { ascending: false }).limit(1) : Promise.resolve({ data: [] }),
        sb.from('offers').select('*'),
        planner ? sb.from('signup_requests').select('*').order('created_at') : Promise.resolve({ data: [] }),
      ]);
      const plannerSet = new Set(check(plannerIds) || []);
      return {
        matches: check(matches),
        referees: check(referees).map((r) => ({ ...r, is_planner: plannerSet.has(r.id) })),
        availability: check(availability),
        notifications: check(notifications),
        lastSync: (check(syncRuns) || [])[0] || null,
        offers: check(offers) || [],
        signups: check(signups) || [],
      };
    },
    // Nieuwe scheidsrechter meldt zich aan (zonder account). Antwoord: 'ok', 'bekend' of 'al_aangemeld'.
    async requestSignup({ name, email, phone, note }) {
      return check(await sb.rpc('request_signup', { p_name: name, p_email: email, p_phone: phone || null, p_note: note || null }));
    },
    async mergeReferees(keepId, dropId, name) { check(await sb.rpc('merge_referees', { p_keep: keepId, p_drop: dropId, p_name: name || null })); },
    async deleteSignup(id) { check(await sb.from('signup_requests').delete().eq('id', id)); },
    // Ask our own hosting (hosting/sportlink-sync.php) to fetch Sportlink now, as the logged-in planner.
    async syncSportlink(url) {
      const { data } = await sb.auth.getSession();
      let res;
      try {
        res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token}` } });
      } catch {
        throw new Error('Kan de Sportlink-koppeling niet bereiken. Klopt SPORTLINK_SYNC_URL en staat het adres van de app in allowed_origins?');
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || `Sportlink ophalen mislukt (${res.status}).`);
      return body;
    },
    async saveMatches(list) {
      const inserts = list.filter((m) => !m.id);
      const updates = list.filter((m) => m.id);
      if (inserts.length) await write(() => sb.from('matches').insert(inserts));
      for (const m of updates) await write(() => sb.from('matches').update(m).eq('id', m.id).select('id'), { expectRows: 1 });
    },
    async updateMatches(ids, patch) {
      if (ids.length) await write(() => sb.from('matches').update(patch).in('id', ids).select('id'), { expectRows: 1 });
    },
    async deleteMatch(id) { await write(() => sb.from('matches').delete().eq('id', id)); },
    async saveReferee(r) {
      const { is_planner, ...row } = r;
      if (row.id) await write(() => sb.from('referees').update(row).eq('id', row.id).select('id'), { expectRows: 1 });
      else await write(() => sb.from('referees').insert(row));
    },
    async deleteReferee(id) { await write(() => sb.from('referees').delete().eq('id', id)); },
    async setPlanner(refereeId, value) { check(await sb.rpc('set_planner', { p_referee: refereeId, p_value: value })); },
    async saveAvailability(a) {
      const { id, ...row } = a;
      await write(() => sb.from('availability').upsert(row, { onConflict: 'referee_id,date' }));
    },
    async deleteAvailability(refereeId, date) {
      check(await sb.from('availability').delete().eq('referee_id', refereeId).eq('date', date));
    },
    async addOffer(matchId) {
      await write(() => sb.from('offers').upsert({ match_id: matchId, referee_id: user.referee_id }, { onConflict: 'match_id,referee_id', ignoreDuplicates: true }));
    },
    async removeOffer(matchId) {
      await write(() => sb.from('offers').delete().eq('match_id', matchId).eq('referee_id', user.referee_id));
    },
    async markRead(ids) {
      if (ids.length) check(await sb.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids));
    },
    async savePushSubscription(sub) {
      check(await sb.from('push_subscriptions').upsert(
        { user_id: user.id, endpoint: sub.endpoint, keys: sub.keys }, { onConflict: 'endpoint' }));
    },
    async updateProfile({ name, phone }) {
      check(await sb.from('profiles').update({ name }).eq('id', user.id));
      if (user.referee_id) check(await sb.from('referees').update(phone === undefined ? { name } : { name, phone }).eq('id', user.referee_id));
      user.name = name;
      emit();
    },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}
