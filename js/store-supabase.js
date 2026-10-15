// Cloud store: Supabase (Postgres + Auth + Realtime). Schema: supabase/schema.sql.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export function createSupabaseStore(url, key) {
  const sb = createClient(url, key, { auth: { persistSession: true, detectSessionInUrl: true } });
  let user = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f());
  const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

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
      sb.auth.onAuthStateChange(async (_e, session) => {
        const before = user?.id;
        await loadUser(session);
        if (before !== user?.id) emit();
      });
      return loadUser(data.session);
    },
    async signIn({ email }) {
      check(await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } }));
      return { done: false, message: `We hebben een inloglink gestuurd naar ${email}. Open die op dit toestel.` };
    },
    async signOut() { await sb.auth.signOut(); user = null; emit(); },
    async loadAll() {
      const [matches, referees, availability] = await Promise.all([
        sb.from('matches').select('*').order('date').order('time'),
        sb.from('referees').select('*').order('name'),
        sb.from('availability').select('*'),
      ]);
      return { matches: check(matches), referees: check(referees), availability: check(availability) };
    },
    async saveMatches(list) {
      const inserts = list.filter((m) => !m.id);
      const updates = list.filter((m) => m.id);
      if (inserts.length) check(await sb.from('matches').insert(inserts));
      for (const m of updates) check(await sb.from('matches').update(m).eq('id', m.id));
    },
    async updateMatches(ids, patch) { check(await sb.from('matches').update(patch).in('id', ids)); },
    async deleteMatch(id) { check(await sb.from('matches').delete().eq('id', id)); },
    async saveReferee(r) {
      if (r.id) check(await sb.from('referees').update(r).eq('id', r.id));
      else check(await sb.from('referees').insert(r));
    },
    async deleteReferee(id) { check(await sb.from('referees').delete().eq('id', id)); },
    async saveAvailability(a) {
      const { id, ...row } = a;
      check(await sb.from('availability').upsert(row, { onConflict: 'referee_id,date' }));
    },
    async deleteAvailability(refereeId, date) {
      check(await sb.from('availability').delete().eq('referee_id', refereeId).eq('date', date));
    },
    async updateProfile({ name }) {
      check(await sb.from('profiles').update({ name }).eq('id', user.id));
      if (user.referee_id) check(await sb.from('referees').update({ name }).eq('id', user.referee_id));
      user.name = name;
      emit();
    },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}
