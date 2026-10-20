// Demo store: everything in localStorage on this device. Same interface as store-supabase.js.
import { matchChangeNotifications, unavailableNotification, matchLabel } from './logic.js';

const KEY = 'scheidsapp-demo-v10';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

function seed() {
  // Local calendar date (toISOString would give the UTC date, a day off around midnight).
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const sat = new Date();
  sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7));
  const d1 = iso(sat);
  const next = new Date(sat); next.setDate(next.getDate() + 7);
  const d2 = iso(next);
  const referees = [
    { id: 'r1', name: 'Anouk de Vries', email: 'anouk@example.nl', phone: '06 12345678', pref_categories: ['O11', 'O12'], avoid_categories: [], active: true, user_id: 'u1' },
    { id: 'r2', name: 'Bram Jansen', email: 'bram@example.nl', phone: '06 87654321', pref_categories: ['O15', 'O17'], avoid_categories: [], active: true, user_id: 'u2' },
    { id: 'r3', name: 'Chris Bakker', email: '', pref_categories: [], avoid_categories: [], active: true, user_id: null },
    // Daan is planner én scheidsrechter.
    { id: 'r4', name: 'Daan Visser', email: 'daan@example.nl', pref_categories: ['1e', '2e'], avoid_categories: [], active: true, user_id: 'u4', is_planner: true },
    // Eva plant alleen en fluit zelf niet.
    { id: 'r5', name: 'Eva Mulder', email: 'eva@example.nl', pref_categories: [], avoid_categories: [], active: true, is_referee: false, user_id: 'u5', is_planner: true },
  ];
  const mk = (date, time, home, away, field, category) => ({ id: uid(), date, time, duration: 60, home, away, field, category, referee_id: null, published: false, external_ref: false });
  const matches = [
    mk(d1, '08:30', 'Elspeet O8-1', 'SVO O8-2', 'Veld 2A', 'O8'),
    mk(d1, '09:00', 'Elspeet O11-1', 'Blauw Wit O11-3', 'Veld 1', 'O11'),
    mk(d1, '10:15', 'Elspeet O12-2', 'DOS O12-1', 'Veld 2', 'O12'),
    mk(d1, '11:30', 'Elspeet O15-1', 'Rood Wit O15-1', 'Veld 1', 'O15'),
    mk(d1, '13:00', 'Elspeet O17-1', 'Fortuna O17-2', 'Veld 1', 'O17'),
    mk(d2, '09:00', 'Elspeet O11-2', 'Zwart Geel O11-1', 'Veld 1', 'O11'),
    mk(d2, '14:30', 'Elspeet 1', 'VV Oost 1', 'Hoofdveld', '1e'),
  ];
  // JO7-ochtend thuis: één wedstrijd met de vier wedstrijdjes erin (zoals de Sportlink-koppeling die maakt).
  matches.push({ ...mk(d1, '09:00', 'Elspeet O7', '', 'Veld 1 A1a, Veld 1 A1b', 'O7'), duration: 70, parts: [
    { time: '09:00', home: 'Elspeet O7-1', away: 'Elspeet O7-2', field: 'Veld 1 A1a' },
    { time: '09:20', home: 'Elspeet O7-1', away: 'Nunspeet O7-3', field: 'Veld 1 A1a' },
    { time: '09:20', home: 'Elspeet O7-2', away: 'Hulshorst O7-2', field: 'Veld 1 A1b' },
    { time: '09:40', home: 'Elspeet O7-1', away: 'Hulshorst O7-2', field: 'Veld 1 A1a' },
    { time: '09:40', home: 'Elspeet O7-2', away: 'Nunspeet O7-3', field: 'Veld 1 A1b' }] });
  matches[6].duration = 105;
  matches[6].external_ref = true; // KNVB stelt aan
  const availability = [
    { id: uid(), referee_id: 'r1', date: d1, available: true, start_time: '', end_time: '', times: ['08:30', '09:00', '10:15'], max_matches: 2 },
    { id: uid(), referee_id: 'r2', date: d1, available: true, start_time: '', end_time: '', times: ['10:15', '11:30', '13:00'], max_matches: 2 },
    { id: uid(), referee_id: 'r4', date: d1, available: false, start_time: '', end_time: '', times: [], max_matches: null },
  ];
  // The weekly reminder (database job on Thursday evening, see supabase/schema.sql) as it would arrive.
  const notifications = [{
    id: uid(), referee_id: 'r1', to_planners: false, kind: 'reminder', title: 'Vul je beschikbaarheid in',
    body: `Voor ${new Date(d2 + 'T12:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })} weten we nog niet of je kunt fluiten.`,
    date: d2, created_at: new Date(Date.now() - 2 * 3600000).toISOString(), read_at: null,
  }];
  return { matches, referees, availability, notifications, offers: [], user: null };
}

function load() {
  try {
    const db = JSON.parse(localStorage.getItem(KEY)) || seed();
    db.offers ||= [];
    return db;
  } catch { return seed(); }
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
      if (isPlanner()) return { matches: [...db.matches], referees: [...db.referees], availability: [...db.availability], notifications, offers: [...db.offers], lastSync: db.lastSync || null };
      return {
        matches: [...db.matches],
        referees: db.referees.filter((r) => r.id === me),
        availability: db.availability.filter((a) => a.referee_id === me),
        notifications,
        offers: db.offers.filter((o) => o.referee_id === me),
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
      else db.referees.push({ active: true, is_referee: true, pref_categories: [], avoid_categories: [], user_id: null, ...r, is_planner: !!r.invite_planner, id: uid() });
      save();
    },
    async deleteReferee(id) {
      db.referees = db.referees.filter((r) => r.id !== id);
      db.matches.forEach((m) => { if (m.referee_id === id) { m.referee_id = null; m.published = false; } });
      db.availability = db.availability.filter((a) => a.referee_id !== id);
      db.notifications = db.notifications.filter((n) => n.referee_id !== id);
      save();
    },
    // Demo: pretend Sportlink returned a few home matches for the Saturday after next.
    async syncSportlink() {
      const sat = new Date();
      sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7) + 14);
      const d = `${sat.getFullYear()}-${String(sat.getMonth() + 1).padStart(2, '0')}-${String(sat.getDate()).padStart(2, '0')}`;
      const feed = [
        ['SL-1001', '08:45', 'Elspeet O9-1', 'Nunspeet O9-3', 'Veld 2', 'O9', 45],
        ['SL-1002', '10:00', 'Elspeet O13-1', 'Hulshorst O13-2', 'Veld 1', 'O13', 65],
        ['SL-1003', '11:30', 'Elspeet O15-1', 'Putten O15-1', 'Veld 1', 'O15', 75],
      ];
      let added = 0;
      for (const [code, time, home, away, field, category, duration] of feed) {
        if (db.matches.some((m) => m.sportlink_code === code)) continue;
        const fromSportlink = code === 'SL-1002' ? 'r2' : null; // in Sportlink al aangesteld: Bram Jansen
        db.matches.push({ id: uid(), sportlink_code: code, source: 'sportlink', date: d, time, home, away, field, category, duration,
          match_type: code === 'SL-1001' ? 'Oefen' : '', sportlink_referee: fromSportlink ? 'Jansen, B. (Bram)' : '',
          referee_id: fromSportlink, published: !!fromSportlink, referee_from_sportlink: !!fromSportlink, external_ref: false });
        added++;
      }
      db.lastSync = { at: new Date().toISOString(), ok: true, added, updated: 0, removed: 0, total: feed.length };
      save();
      return { ok: true, ...db.lastSync };
    },
    async setPlanner(refereeId, value) {
      const r = db.referees.find((x) => x.id === refereeId);
      if (refereeId === db.user.referee_id && !value) throw new Error('Je kunt jezelf niet als planner verwijderen.');
      r.is_planner = value; r.invite_planner = value;
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
    // "Ik kan fluiten": same rules as the offers table and its trigger in the database.
    async addOffer(matchId) {
      const me = db.user.referee_id;
      if (db.offers.some((o) => o.match_id === matchId && o.referee_id === me)) return;
      const m = db.matches.find((x) => x.id === matchId);
      db.offers.push({ id: uid(), match_id: matchId, referee_id: me, created_at: new Date().toISOString() });
      const name = db.referees.find((r) => r.id === me)?.name || 'Scheidsrechter';
      notify([{ referee_id: null, to_planners: true, kind: 'offer', title: `${name} wil fluiten`, body: matchLabel(m), match_id: m.id, date: m.date }]);
      save();
    },
    async removeOffer(matchId) {
      db.offers = db.offers.filter((o) => !(o.match_id === matchId && o.referee_id === db.user.referee_id));
      save();
    },
    async markRead(ids) {
      const now = new Date().toISOString();
      db.notifications.forEach((n) => { if (ids.includes(n.id) && !n.read_at) n.read_at = now; });
      save();
    },
    async updateProfile({ name, phone }) {
      db.user.name = name;
      const r = db.referees.find((x) => x.id === db.user.referee_id);
      if (r) { r.name = name; if (phone !== undefined) r.phone = phone; }
      save();
    },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}
