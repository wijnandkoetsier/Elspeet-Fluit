// Demo store: everything in localStorage on this device. Same interface as store-supabase.js.
import { matchChangeNotifications, unavailableNotification } from './logic.js';

const KEY = 'scheidsapp-demo-v2';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

function seed() {
  const iso = (d) => d.toISOString().slice(0, 10);
  const sat = new Date();
  sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7));
  const d1 = iso(sat);
  const next = new Date(sat); next.setDate(next.getDate() + 7);
  const d2 = iso(next);
  const referees = [
    { id: 'r1', name: 'Anouk de Vries', email: 'anouk@example.nl', pref_categories: ['JO11', 'JO12'], avoid_categories: [], active: true, user_id: 'u1' },
    { id: 'r2', name: 'Bram Jansen', email: 'bram@example.nl', pref_categories: ['JO15', 'JO17'], avoid_categories: ['JO8'], active: true, user_id: 'u2' },
    { id: 'r3', name: 'Chris Bakker', email: '', pref_categories: [], avoid_categories: [], active: true, user_id: null },
    // Daan is planner én scheidsrechter.
    { id: 'r4', name: 'Daan Visser', email: 'daan@example.nl', pref_categories: ['Senioren'], avoid_categories: [], active: true, user_id: 'u4', is_planner: true },
  ];
  const mk = (date, time, home, away, field, category) => ({ id: uid(), date, time, duration: 60, home, away, field, category, referee_id: null, published: false, external_ref: false });
  const matches = [
    mk(d1, '08:30', 'Elspeet JO8-1', 'SVO JO8-2', 'Veld 2A', 'JO8'),
    mk(d1, '09:00', 'Elspeet JO11-1', 'Blauw Wit JO11-3', 'Veld 1', 'JO11'),
    mk(d1, '10:15', 'Elspeet JO12-2', 'DOS JO12-1', 'Veld 2', 'JO12'),
    mk(d1, '11:30', 'Elspeet JO15-1', 'Rood Wit JO15-1', 'Veld 1', 'JO15'),
    mk(d1, '13:00', 'Elspeet JO17-1', 'Fortuna JO17-2', 'Veld 1', 'JO17'),
    mk(d2, '09:00', 'Elspeet JO11-2', 'Zwart Geel JO11-1', 'Veld 1', 'JO11'),
    mk(d2, '14:30', 'Elspeet 1', 'VV Oost 1', 'Hoofdveld', 'Senioren'),
  ];
  matches[6].duration = 105;
  matches[6].external_ref = true; // KNVB stelt aan
  const availability = [
    { id: uid(), referee_id: 'r1', date: d1, available: true, start_time: '08:00', end_time: '12:00', max_matches: 2 },
    { id: uid(), referee_id: 'r2', date: d1, available: true, start_time: '10:00', end_time: '16:00', max_matches: 2 },
    { id: uid(), referee_id: 'r4', date: d1, available: false, start_time: '', end_time: '', max_matches: null },
  ];
  return { matches, referees, availability, notifications: [], user: null };
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { return seed(); }
}

export function createLocalStore() {
  let db = load();
  const listeners = new Set();
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {}
    listeners.forEach((f) => f());
  };
  window.addEventListener('storage', (e) => { if (e.key === KEY) { db = load(); listeners.forEach((f) => f()); } });

  const notify = (list) => {
    for (const n of list) db.notifications.unshift({ ...n, id: uid(), created_at: new Date().toISOString(), read_at: null });
  };
  // Apply a change to one match and record the notifications the database trigger would create.
  const changeMatch = (m, patch) => {
    const before = { ...m };
    Object.assign(m, patch);
    notify(matchChangeNotifications(before, m));
  };
  const isPlanner = () => db.user?.role === 'planner';

  return {
    mode: 'demo',
    async init() { return db.user; },
    get user() { return db.user; },
    // In demo you "log in" by picking a person; the planner is the referee marked is_planner.
    async signIn({ role, refereeId }) {
      const ref = role === 'planner'
        ? db.referees.find((r) => r.is_planner) || db.referees[0]
        : db.referees.find((r) => r.id === refereeId) || db.referees[0];
      db.user = { id: 'demo-' + ref.id, name: ref.name, email: ref.email, role: ref.is_planner ? 'planner' : 'referee', referee_id: ref.id };
      save();
      return { done: true };
    },
    async signOut() { db.user = null; save(); },
    async resetDemo() { const user = db.user; db = seed(); db.user = user && db.referees.some((r) => r.id === user.referee_id) ? user : null; save(); },
    async demoPeople() { return db.referees.filter((r) => r.user_id || r.is_planner); },
    // Mirrors the row level security in the database: referees only get their own rows.
    async loadAll() {
      const me = db.user?.referee_id;
      const notifications = db.notifications.filter((n) => n.referee_id === me || (n.to_planners && isPlanner()));
      if (isPlanner()) return { matches: [...db.matches], referees: [...db.referees], availability: [...db.availability], notifications };
      return {
        matches: [...db.matches],
        referees: db.referees.filter((r) => r.id === me),
        availability: db.availability.filter((a) => a.referee_id === me),
        notifications,
      };
    },
    async saveMatches(list) {
      for (const m of list) {
        const ex = m.id && db.matches.find((x) => x.id === m.id);
        if (ex) changeMatch(ex, m);
        else db.matches.push({ referee_id: null, published: false, external_ref: false, duration: 90, ...m, id: uid() });
      }
      save();
    },
    async updateMatches(ids, patch) {
      db.matches.forEach((m) => { if (ids.includes(m.id)) changeMatch(m, patch); });
      save();
    },
    async deleteMatch(id) {
      const m = db.matches.find((x) => x.id === id);
      if (m) notify(matchChangeNotifications(m, null));
      db.matches = db.matches.filter((x) => x.id !== id);
      save();
    },
    async saveReferee(r) {
      if (r.id) Object.assign(db.referees.find((x) => x.id === r.id), r);
      else db.referees.push({ active: true, pref_categories: [], avoid_categories: [], user_id: null, ...r, id: uid() });
      save();
    },
    async deleteReferee(id) {
      db.referees = db.referees.filter((r) => r.id !== id);
      db.matches.forEach((m) => { if (m.referee_id === id) { m.referee_id = null; m.published = false; } });
      db.availability = db.availability.filter((a) => a.referee_id !== id);
      db.notifications = db.notifications.filter((n) => n.referee_id !== id);
      save();
    },
    async setPlanner(refereeId, value) {
      const r = db.referees.find((x) => x.id === refereeId);
      if (!r.user_id && !r.is_planner) throw new Error('Deze scheidsrechter heeft nog niet ingelogd.');
      if (refereeId === db.user.referee_id && !value) throw new Error('Je kunt jezelf niet als planner verwijderen.');
      r.is_planner = value;
      save();
    },
    async saveAvailability(a) {
      const ex = db.availability.find((x) => x.referee_id === a.referee_id && x.date === a.date);
      const byPlannerForOther = isPlanner() && a.referee_id !== db.user.referee_id;
      if (!byPlannerForOther) {
        const name = db.referees.find((r) => r.id === a.referee_id)?.name || 'Scheidsrechter';
        const n = unavailableNotification(ex, a, db.matches, name);
        if (n) notify([n]);
      }
      if (ex) Object.assign(ex, a); else db.availability.push({ ...a, id: uid() });
      save();
    },
    async deleteAvailability(refereeId, date) {
      db.availability = db.availability.filter((x) => !(x.referee_id === refereeId && x.date === date));
      save();
    },
    async markRead(ids) {
      const now = new Date().toISOString();
      db.notifications.forEach((n) => { if (ids.includes(n.id) && !n.read_at) n.read_at = now; });
      save();
    },
    async updateProfile({ name }) {
      db.user.name = name;
      const r = db.referees.find((x) => x.id === db.user.referee_id);
      if (r) r.name = name;
      save();
    },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}
