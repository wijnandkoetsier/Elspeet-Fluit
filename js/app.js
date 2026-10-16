import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY, SPORTLINK_SYNC_URL, APP_NAME, CLUB_NAME, CATEGORIES } from './config.js';
import { createLocalStore } from './store-local.js';
import {
  candidates, proposeDay, availabilityDates, seasonOf, seasonCounts, csvMatches, toCSV, matchEnd, fromMin, toMin,
  assignmentIssue, defaultDuration, fieldName, overlaps,
  categoryGroups, prefState, togglePrefGroup, togglePrefTeam, prefLabel, upgradeCategory, upgradePrefs,
} from './logic.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fmtDate = (d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(d + 'T12:00:00').toLocaleDateString('nl-NL', opts);

let store;
const state = { data: { matches: [], referees: [], availability: [], notifications: [], offers: [] }, day: null, installPrompt: null, login: null, showAllOpen: false };

// ---------- Tekstgrootte (per toestel) ----------
const TEXT_SIZES = [['klein', 'Klein', 14], ['normaal', 'Normaal', 16], ['groot', 'Groot', 18], ['extra', 'Extra groot', 20]];
const SIZE_KEY = 'scheidsapp-tekstgrootte';

function getTextSize() {
  // Default is the smallest size; users can pick a bigger one under Instellingen.
  try { return localStorage.getItem(SIZE_KEY) || 'klein'; } catch { return 'klein'; }
}

function applyTextSize(key = getTextSize()) {
  const size = (TEXT_SIZES.find(([k]) => k === key) || TEXT_SIZES[0])[2];
  document.documentElement.style.fontSize = size + 'px';
}

function setTextSize(key) {
  try { localStorage.setItem(SIZE_KEY, key); } catch {}
  applyTextSize(key);
}

// ---------- Boot ----------
async function boot() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const { createSupabaseStore } = await import('./store-supabase.js');
    store = createSupabaseStore(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    store = createLocalStore();
  }
  $('#app-name').textContent = APP_NAME;
  $('#club').textContent = `${CLUB_NAME} · scheidsrechters`;
  document.title = APP_NAME;
  try { await store.init(); } catch (e) { toast(e.message, true); }
  store.onChange(refresh);
  window.addEventListener('hashchange', render);
  await refresh().catch(() => {});
  hideSplash();
}

// Start screen: logo with a spinning ball, at least 2 seconds after the app was opened.
const SPLASH_MS = 2000;
function hideSplash() {
  const el = $('#splash');
  if (!el) return;
  setTimeout(() => {
    el.classList.add('gone');
    setTimeout(() => el.remove(), 400);
  }, Math.max(0, SPLASH_MS - performance.now()));
}

async function refresh() {
  if (store.user) {
    try {
      state.data = await store.loadAll();
      // Show fields the short way everywhere ("Veld 1-hoofdveld" → "Veld 1").
      state.data.matches.forEach((m) => { if (m.field) m.field = fieldName(m.field); m.category = upgradeCategory(m); });
      // Old categories (Senioren/Veteranen/Vrouwen) shown the new way until the database is migrated.
      state.data.referees.forEach((r) => { r.pref_categories = upgradePrefs(r.pref_categories); r.avoid_categories = upgradePrefs(r.avoid_categories); });
    } catch (e) { toast('Laden mislukt: ' + e.message, true); }
  }
  render();
}

async function act(fn, ok) {
  try {
    await fn();
    if (ok) toast(ok);
    if (store.mode === 'cloud') await refresh();
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- Routing ----------
// Line icons (24px grid, stroke = currentColor) so the tab bar stays black and white.
const svg = (d) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  planning: svg('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>'),
  ball: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 4.5h-5L8 10z"/><path d="M12 3v4M16 10l4.5-1.5M14.5 14.5l2.5 4M9.5 14.5l-2.5 4M8 10L3.5 8.5"/>'),
  people: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.4 0 4 1.6 4.5 4"/>'),
  settings: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  whistle: svg('<circle cx="9" cy="14" r="5"/><path d="M12.5 10.5L20 6v4l-6 2.5M9 14h.01"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4"/>'),
  date: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"/>'),
  download: svg('<path d="M12 4v11M7 10.5l5 5 5-5M4.5 20h15"/>'),
  prev: svg('<path d="M15 5l-7 7 7 7"/>'),
  next: svg('<path d="M9 5l7 7-7 7"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  bell: svg('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
  home: svg('<path d="M4 11l8-6.5 8 6.5"/><path d="M6.5 9.5V20h11V9.5"/><path d="M10 20v-5h4v5"/>'),
  more: svg('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'),
  refresh: svg('<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>'),
  upload: svg('<path d="M12 16V4M7 8.5l5-5 5 5M4.5 20h15"/>'),
  warn: svg('<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5h.01"/>'),
};
// Tabs per role. Hidden routes are reachable via Overzicht (planner) or Instellingen and light up their parent tab.
const ROUTES = {
  planner: [
    ['planning', 'Planning', ICONS.planning],
    ['wedstrijden', 'Wedstrijden', ICONS.ball],
    ['overzicht', 'Overzicht', ICONS.home],
    ['scheidsrechters', 'Scheidsen', ICONS.people],
    ['meldingen', 'Meldingen', ICONS.bell],
  ],
  referee: [
    ['mijn', 'Mijn fluiten', ICONS.whistle],
    ['beschikbaarheid', 'Beschikbaar', ICONS.calendar],
    ['overzicht', 'Overzicht', ICONS.home],
    ['meldingen', 'Meldingen', ICONS.bell],
    ['profiel', 'Instellingen', ICONS.settings],
  ],
};
const HIDDEN = { planner: { mijn: 'overzicht', beschikbaarheid: 'overzicht', voorkeuren: 'overzicht', profiel: 'overzicht', meer: 'overzicht' }, referee: { voorkeuren: 'profiel' } };
// The screen the app opens on: Overzicht, in the middle of the tab bar.
const HOME = { planner: 'overzicht', referee: 'overzicht' };

const unreadCount = () => state.data.notifications.filter((n) => !n.read_at).length;

function render() {
  const user = store.user;
  const nav = $('#nav');
  const view = $('#view');
  $('#demo-badge').hidden = store.mode !== 'demo';
  if (!user) {
    nav.innerHTML = '';
    view.innerHTML = loginView();
    bindLogin();
    return;
  }
  const role = user.role === 'planner' ? 'planner' : 'referee';
  const routes = ROUTES[role];
  const hidden = HIDDEN[role];
  let route = location.hash.replace(/^#\/?/, '');
  if (!routes.some(([r]) => r === route) && !hidden[route]) route = HOME[role];
  const activeTab = hidden[route] || route;
  const unread = unreadCount();
  nav.innerHTML = routes.map(([r, label, icon]) =>
    `<a href="#${r}" class="${r === activeTab ? 'active' : ''}"><span>${icon}${r === 'meldingen' && unread ? `<b class="badge">${unread > 9 ? '9+' : unread}</b>` : ''}</span>${label}</a>`).join('');
  try { unread ? navigator.setAppBadge?.(unread) : navigator.clearAppBadge?.(); } catch {}
  const views = { planning, wedstrijden, scheidsrechters, overzicht: role === 'planner' ? plannerOverzicht : overzicht,
    mijn, beschikbaarheid, voorkeuren, profiel, meldingen, meer: plannerOverzicht };
  view.innerHTML = '';
  views[route](view);
}

// ---------- Login ----------
function loginView() {
  if (store.mode === 'demo') {
    const people = state.people || [];
    return `
      <section class="card login">
        <h2>Welkom</h2>
        <p>Dit is de <b>demo-modus</b>: gegevens blijven op dit toestel. Koppel Supabase in <code>js/config.js</code> om te delen met je club.</p>
        <button class="btn primary block" data-login="planner">Inloggen als planner (Daan)</button>
        <div class="row">
          <select id="demo-ref" aria-label="Scheidsrechter">${people.filter((r) => !r.is_planner).map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>
          <button class="btn" data-login="referee">Als scheidsrechter</button>
        </div>
      </section>`;
  }
  const l = state.login;
  if (l?.step === 'code') {
    return `
      <section class="card login">
        <h2>Vul je code in</h2>
        <p>We hebben een e-mail gestuurd naar <b>${esc(l.email)}</b> met een inlogcode.</p>
        <form id="code-form">
          <input name="token" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,13}" maxlength="13" placeholder="Code uit de mail" class="code-input" aria-label="Code" title="De code uit de mail (6 tot 10 cijfers)">
          <button class="btn primary block">Inloggen</button>
        </form>
        <p class="muted">Staat er geen code in de mail, maar alleen een link? Tik dan op de link in de mail, het liefst op dit toestel.</p>
        <button class="btn ghost block" id="code-back">Ander e-mailadres of nieuwe code</button>
      </section>`;
  }
  return `
    <section class="card login">
      <h2>Inloggen</h2>
      <p>Vul het e-mailadres in dat bij de club bekend is. Je krijgt een e-mail om in te loggen, zonder wachtwoord.</p>
      <form id="login-form">
        <input type="email" name="email" required placeholder="naam@voorbeeld.nl" autocomplete="email" value="${esc(l?.email || '')}" aria-label="E-mailadres">
        <button class="btn primary block">Stuur code</button>
      </form>
    </section>`;
}

function bindLogin() {
  if (store.mode === 'demo') {
    if (!state.people) store.demoPeople().then((p) => { state.people = p; render(); });
    document.querySelectorAll('[data-login]').forEach((b) => b.onclick = () =>
      act(async () => {
        await store.signIn({ role: b.dataset.login, refereeId: $('#demo-ref')?.value });
        location.hash = '';
      }));
    return;
  }
  const lf = $('#login-form');
  if (lf) lf.onsubmit = (e) => {
    e.preventDefault();
    const email = new FormData(e.target).get('email').trim();
    act(async () => { await store.signIn({ email }); state.login = { step: 'code', email }; render(); }, 'Code verstuurd. Kijk in je mail.');
  };
  const cf = $('#code-form');
  if (cf) {
    cf.onsubmit = (e) => {
      e.preventDefault();
      // Supabase sends 6 to 10 digits depending on the project setting; ignore spaces from copy-paste.
      const token = new FormData(e.target).get('token').replace(/\D/g, '');
      act(async () => { await store.verifyCode({ email: state.login.email, token }); state.login = null; location.hash = ''; });
    };
    $('#code-back').onclick = () => { state.login = { email: state.login.email }; render(); };
  }
}

// ---------- Planner: planning ----------
function matchDays() {
  return [...new Set(state.data.matches.map((m) => m.date))].sort();
}

// Team names keep 'JO12-2' together: a non-breaking hyphen stops the line from wrapping inside it.
const team = (name) => esc(name).replace(/-/g, '\u2011');

// One compact row in a day list: time | teams + labels / details | action.
function matchRow(m, { sub = '', action = '', attrs = '', time = m.time } = {}) {
  const labels = [
    m.category && `<span class="label">${esc(m.category)}</span>`,
    m.match_type && `<span class="label type">${esc(m.match_type)}</span>`,
    m.external_ref && '<span class="label knvb">KNVB</span>',
  ].filter(Boolean).join('');
  return `
    <div class="mrow ${m.external_ref ? 'dim' : ''}" ${attrs}>
      <div class="t">${esc(time)}</div>
      <div class="info">
        <div class="teams"><span class="home">${team(m.home)}</span>${m.away ? `<span class="away">${team(m.away)}</span>` : ''}</div>
        <div class="sub">${labels}${sub}</div>
      </div>
      ${action}
    </div>`;
}

function dayList(title, pill, rows) {
  return `
    <section class="card day-list">
      <header class="day-head"><h2>${title}</h2><span class="pills">${pill}</span></header>
      ${rows}
    </section>`;
}

// Days to plan: every match day plus the coming four Saturdays (so empty Saturdays show too).
function planDays() {
  const today = todayISO();
  const set = new Set(state.data.matches.map((m) => m.date));
  availabilityDates([], new Date(today + 'T12:00:00')).forEach((d) => set.add(d));
  return [...set].sort();
}

const DAY_FILTERS = [['alle', 'Alle'], ['open', 'Open'], ['concept', 'Concept']];

// Shared date navigator (Planning and Wedstrijden): arrows, day tiles, optional filter. Uses state.day.
function pickDay(days) {
  const today = todayISO();
  if (!state.day || !days.includes(state.day)) state.day = days.find((d) => d >= today) || days[days.length - 1];
  return state.day;
}

function dateNav(days, day, { filter = null } = {}) {
  const { matches } = state.data;
  const today = todayISO();
  const idx = days.indexOf(day);
  const firstSat = days.find((d) => d >= today && new Date(d + 'T12:00:00').getDay() === 6);
  const tile = (d) => {
    const ms = matches.filter((m) => m.date === d);
    const hasOpen = ms.some((m) => !m.external_ref && !m.referee_id);
    const hasIssue = ms.some((m) => assignmentIssue(m, state.data));
    const label = d === today ? 'Vandaag' : d === firstSat ? 'Deze zaterdag' : fmtDate(d, { weekday: 'short' });
    return `<button class="day-tile ${d === day ? 'on' : ''} ${d < today ? 'past' : ''}" data-day="${d}">
      <span class="dl">${label}</span>
      <b>${fmtDate(d, { day: 'numeric', month: 'short' }).replace('.', '')}</b>
      <span class="dn">${ms.length} ${ms.length === 1 ? 'wedstrijd' : 'wedstrijden'}</span>
      <span class="dots">${hasIssue ? '<i class="issue-dot" title="Probleem met aanstelling"></i>' : ''}${hasOpen ? '<i class="open-dot" title="Open wedstrijden"></i>' : ''}</span>
    </button>`;
  };
  return `
    <section class="card date-nav">
      <div class="date-head">
        <button class="icon-btn" id="day-prev" aria-label="Vorige dag" ${idx <= 0 ? 'disabled' : ''}>${ICONS.prev}</button>
        <h2>${ICONS.date}<span>${fmtDate(day, { weekday: 'short', day: 'numeric', month: 'long' })}</span></h2>
        <button class="icon-btn" id="day-next" aria-label="Volgende dag" ${idx >= days.length - 1 ? 'disabled' : ''}>${ICONS.next}</button>
        <button class="icon-btn" id="export" aria-label="Programma exporteren" title="Programma exporteren">${ICONS.download}</button>
      </div>
      <div class="day-tiles" id="day-tiles">${days.map(tile).join('')}</div>
      ${filter ? `<div class="filter-seg" role="tablist">${DAY_FILTERS.map(([k, label]) =>
        `<button role="tab" aria-selected="${k === filter}" class="${k === filter ? 'on' : ''}" data-filter="${k}">${label}</button>`).join('')}</div>` : ''}
    </section>`;
}

function bindDateNav(view, days, day) {
  const idx = days.indexOf(day);
  const go = (d) => { state.day = d; render(); };
  view.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => go(b.dataset.day));
  $('#day-prev').onclick = () => idx > 0 && go(days[idx - 1]);
  $('#day-next').onclick = () => idx < days.length - 1 && go(days[idx + 1]);
  view.querySelectorAll('[data-filter]').forEach((b) => b.onclick = () => { state.filter = b.dataset.filter; render(); });
  const tiles = $('#day-tiles'), on = $('.day-tile.on', tiles);
  if (on) tiles.scrollLeft = on.offsetLeft - tiles.offsetLeft - 4;
  const refName = (id) => state.data.referees.find((r) => r.id === id)?.name || '?';
  $('#export').onclick = () => exportDay(day,
    state.data.matches.filter((m) => m.date === day).sort((a, b) => a.time.localeCompare(b.time)), refName);
}

function planning(view) {
  const { matches, referees } = state.data;
  const days = planDays();
  const day = pickDay(days);
  const filter = state.filter || 'alle';
  const dayMatches = matches.filter((m) => m.date === day).sort((a, b) => a.time.localeCompare(b.time));
  const own = dayMatches.filter((m) => !m.external_ref);
  const open = own.filter((m) => !m.referee_id);
  const unpublished = own.filter((m) => m.referee_id && !m.published);
  const refName = (id) => referees.find((r) => r.id === id)?.name || '?';

  const shown = dayMatches.filter((m) => filter === 'alle'
    || (filter === 'open' && !m.external_ref && !m.referee_id)
    || (filter === 'concept' && m.referee_id && !m.published));

  const rows = shown.map((m) => {
    const parts = m.field ? [esc(m.field)] : [];
    let action = '';
    if (m.external_ref) {
      parts.push(m.sportlink_referee ? `KNVB: ${esc(m.sportlink_referee)}` : 'KNVB stelt aan');
    } else if (m.referee_id) {
      const issue = assignmentIssue(m, state.data);
      const status = m.referee_from_sportlink ? 'via Sportlink' : m.published ? 'gepubliceerd' : 'concept';
      parts.push(`<span class="st ${issue ? 'issue' : m.published ? 'pub' : 'concept'}">${esc(refName(m.referee_id))}<small>${status}</small></span>`);
      if (issue) parts.push(`<span class="issue-text">${ICONS.warn}${esc(issue.join(', '))}</span>`);
      action = `<button class="btn pill-btn ${issue ? 'assign' : ''}" data-assign="${m.id}">${issue ? 'Oplossen' : 'Wijzig'}</button>`;
    } else {
      const n = candidates(m, state.data).filter((c) => c.status === 'ok').length;
      parts.push(`<span class="st ${n ? 'ok' : 'none'}">${n ? `${n} beschikbaar` : 'niemand beschikbaar'}</span>`);
      if (m.sportlink_referee) parts.push(`<span class="sl-ref">In Sportlink: ${esc(m.sportlink_referee)}</span>`);
      const offeredBy = (state.data.offers || []).filter((o) => o.match_id === m.id).map((o) => refName(o.referee_id));
      if (offeredBy.length) parts.push(`<span class="offer-text">✋ ${esc(offeredBy.join(', '))} ${offeredBy.length === 1 ? 'biedt' : 'bieden'} zich aan</span>`);
      action = `<button class="btn pill-btn assign" data-assign="${m.id}">Toewijzen</button>`;
    }
    return matchRow(m, { sub: parts.join('<span class="sep">·</span>'), action });
  }).join('') || `<p class="muted list-empty">${dayMatches.length ? 'Geen wedstrijden in deze selectie.' : 'Geen wedstrijden op deze dag.'}</p>`;

  const issues = own.filter((m) => assignmentIssue(m, state.data)).length;
  const pill = !own.length ? '' : `${issues ? `<span class="pill issue">${issues} ${issues === 1 ? 'probleem' : 'problemen'}</span>` : ''}${open.length ? `<span class="pill open">${open.length} open</span>` : issues ? '' : '<span class="pill done">Alles ingevuld</span>'}`;

  view.innerHTML = `
    ${dateNav(days, day, { filter })}
    ${open.length ? '<div class="actions top"><button class="btn small" id="propose">✨ Voorstel maken</button></div>' : ''}
    ${dayList(fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' }), pill, rows)}
    ${whoCanReferee(day)}
    ${unpublished.length ? `<div class="publish-space"></div>
      <div class="publish-bar"><button class="btn primary" id="publish">Publiceren (${unpublished.length})</button></div>` : ''}`;

  bindDateNav(view, days, day);
  view.querySelectorAll('[data-assign]').forEach((b) => b.onclick = () => assignSheet(b.dataset.assign));
  $('#all-avail').onclick = () => availabilitySheet(day);
  const prop = $('#propose');
  if (prop) prop.onclick = () => {
    const list = proposeDay(day, state.data);
    if (!list.length) return toast('Geen voorstel mogelijk: niemand (meer) beschikbaar voor open wedstrijden.');
    act(async () => {
      for (const p of list) await store.updateMatches([p.matchId], { referee_id: p.refereeId, published: false });
    }, `${list.length} wedstrijd(en) ingevuld als concept. Controleer en publiceer.`);
  };
  const pub = $('#publish');
  if (pub) pub.onclick = () => act(() => store.updateMatches(unpublished.map((m) => m.id), { published: true }),
    'Planning gepubliceerd. Scheidsrechters zien hun aanstelling nu in de app.');
}

// Availability of every active referee on a day, grouped.
function dayAvailability(day) {
  const { referees, availability, matches } = state.data;
  const groups = { yes: [], no: [], none: [] };
  for (const r of referees.filter((x) => x.active !== false)) {
    const a = availability.find((x) => x.referee_id === r.id && x.date === day);
    const assigned = matches.filter((m) => m.date === day && m.referee_id === r.id).length;
    const entry = { r, a, assigned };
    (a ? (a.available ? groups.yes : groups.no) : groups.none).push(entry);
  }
  groups.yes.sort((x, y) => (x.a.start_time || '').localeCompare(y.a.start_time || '') || x.r.name.localeCompare(y.r.name));
  return groups;
}

function availRow({ r, a, assigned }, editable = false) {
  const hours = a?.available
    ? (a.start_time || a.end_time ? `${a.start_time || 'begin'} – ${a.end_time || 'eind'}` : 'Hele dag')
    : a ? 'Niet beschikbaar' : 'Nog niets ingevuld';
  const extra = [a?.max_matches ? `max ${a.max_matches}` : '', assigned ? `fluit ${assigned}×` : ''].filter(Boolean).join(' · ');
  const full = a?.available && a.max_matches && assigned >= a.max_matches;
  const st = !a ? 'none' : !a.available ? 'no' : full ? 'full' : assigned ? 'busy' : 'free';
  return `
    <div class="arow ${editable ? 'tap' : ''}" ${editable ? `data-edit-av="${r.id}" role="button" tabindex="0"` : ''}>
      <div class="avatar">${esc(initials(r.name))}</div>
      <div class="info"><b>${esc(r.name)}</b><small>${esc(hours)}${extra ? ` · ${esc(extra)}` : ''}</small></div>
      <i class="adot ${st}" title="${{ free: 'Vrij', busy: 'Al aangesteld, nog ruimte', full: 'Maximum bereikt', no: 'Niet beschikbaar', none: 'Onbekend' }[st]}"></i>
    </div>`;
}

function whoCanReferee(day) {
  const g = dayAvailability(day);
  return `
    <section class="card day-list who">
      <header class="day-head"><h2>Wie kan er fluiten?</h2>
        <span class="pills"><span class="pill ${g.yes.length ? 'done' : ''}">${g.yes.length} beschikbaar</span></span></header>
      <div class="who-body">
        ${g.yes.map((x) => availRow(x)).join('') || '<p class="muted">Nog niemand heeft zich beschikbaar gemeld.</p>'}
        <button class="link-row" id="all-avail">
          <span>Alle beschikbaarheid${g.none.length ? ` <small class="pill open">${g.none.length} niets ingevuld</small>` : ''}</span>${ICONS.arrow}
        </button>
      </div>
    </section>`;
}

function availabilitySheet(day) {
  const g = dayAvailability(day);
  const block = (title, list) => list.length ? `<h4 class="sheet-sub">${title} (${list.length})</h4>${list.map((x) => availRow(x, true)).join('')}` : '';
  const withMail = g.none.filter((x) => x.r.email).map((x) => x.r);
  sheet(`
    <h3>Beschikbaarheid ${fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
    <p class="muted">Tik op een naam om de beschikbaarheid voor die persoon in te vullen.</p>
    <div class="who">
      ${block('Beschikbaar', g.yes)}
      ${block('Niet beschikbaar', g.no)}
      ${block('Nog niets ingevuld', g.none)}
    </div>
    ${withMail.length ? `<a class="btn block" href="${remindLink(withMail, day)}">✉️ Herinnering mailen (${withMail.length})</a>
      <p class="muted">Werkt dit niet? Mail dan zelf naar: <span class="select">${withMail.map((r) => esc(r.email)).join(', ')}</span></p>` : ''}
  `, (el, close) => {
    el.querySelectorAll('[data-edit-av]').forEach((row) => row.onclick = () => { close(); availEditor(row.dataset.editAv, day); });
  });
}

// Planner fills in availability on behalf of someone (also for referees without an account).
function availEditor(refereeId, day) {
  const r = state.data.referees.find((x) => x.id === refereeId);
  const a = state.data.availability.find((x) => x.referee_id === refereeId && x.date === day);
  let choice = a ? (a.available ? 'yes' : 'no') : 'none';
  sheet(`
    <h3>${esc(r.name)}</h3>
    <p class="muted">${fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    <div class="seg three" id="av-choice">
      <button data-c="yes">✓ Beschikbaar</button><button data-c="no">✕ Niet</button><button data-c="none">Onbekend</button>
    </div>
    <div class="row small" id="av-times">
      <label>Van<input type="time" id="av-start" value="${esc(a?.start_time || '')}"></label>
      <label>Tot<input type="time" id="av-end" value="${esc(a?.end_time || '')}"></label>
      <label>Max<select id="av-max">${['', 1, 2, 3, 4].map((x) => `<option value="${x}" ${String(a?.max_matches ?? '') === String(x) ? 'selected' : ''}>${x || '–'}</option>`).join('')}</select></label>
    </div>
    <p class="field-error" id="av-err" hidden></p>
    <button class="btn primary block" id="av-save">Opslaan</button>`, (el, close) => {
    const paint = () => {
      el.querySelectorAll('[data-c]').forEach((b) => { b.className = b.dataset.c === choice ? `on ${choice}` : ''; });
      $('#av-times', el).hidden = choice !== 'yes';
    };
    el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { choice = b.dataset.c; paint(); });
    paint();
    $('#av-save', el).onclick = () => {
      const start = $('#av-start', el).value, end = $('#av-end', el).value;
      if (choice === 'yes' && start && end && end <= start) {
        const err = $('#av-err', el); err.textContent = 'De eindtijd moet later zijn dan de begintijd.'; err.hidden = false; return;
      }
      close();
      if (choice === 'none') return act(() => store.deleteAvailability(refereeId, day), 'Beschikbaarheid gewist');
      act(() => store.saveAvailability({
        referee_id: refereeId, date: day, available: choice === 'yes',
        start_time: choice === 'yes' ? start : '', end_time: choice === 'yes' ? end : '',
        max_matches: choice === 'yes' ? (Number($('#av-max', el).value) || null) : null,
      }), `Opgeslagen voor ${r.name}`);
    };
  });
}

function remindLink(refs, day) {
  const bcc = refs.map((r) => r.email).filter(Boolean).join(',');
  const subject = `Beschikbaarheid ${fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}`;
  const body = `Hoi,\n\nWil je je beschikbaarheid voor ${fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' })} invullen in ${APP_NAME}?\n\n${location.origin + location.pathname}\n\nBedankt!`;
  return `mailto:?bcc=${encodeURIComponent(bcc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function exportDay(day, list, refName) {
  const rows = [['Datum', 'Tijd', 'Thuis', 'Uit', 'Veld', 'Categorie', 'Scheidsrechter']];
  for (const m of list) rows.push([day, m.time, m.home, m.away, m.field, m.category, m.external_ref ? 'KNVB' : (m.referee_id ? refName(m.referee_id) : '')]);
  download(`programma-${day}.csv`, '﻿' + toCSV(rows), 'text/csv');
}

function assignSheet(matchId) {
  const m = state.data.matches.find((x) => x.id === matchId);
  const list = candidates(m, state.data);
  const label = { ok: 'Beschikbaar', unknown: 'Onbekend', no: 'Niet' };
  sheet(`
    <h3>${esc(m.time)} · ${esc(m.home)}${m.away ? ' – ' + esc(m.away) : ''}</h3>
    <p class="muted">${[m.field, m.category, m.match_type].filter(Boolean).map(esc).join(' · ')}</p>
    ${m.referee_from_sportlink
      ? '<p class="muted note">Deze aanstelling komt uit Sportlink. Wijzig hem in Sportlink; een wijziging hier wordt bij de volgende synchronisatie teruggezet.</p>'
      : m.sportlink_referee ? `<p class="muted note">In Sportlink staat als scheidsrechter: <b>${esc(m.sportlink_referee)}</b></p>` : ''}
    <div class="cands">
      ${list.map((c) => `
        <button class="cand ${c.status} ${c.referee.id === m.referee_id ? 'current' : ''}" data-ref="${c.referee.id}">
          <span class="dot"></span>
          <span class="who"><b>${esc(c.referee.name)}</b><small>${esc(c.reasons.join(' · ') || label[c.status])}</small></span>
          <span class="count" title="Wedstrijden dit seizoen">${c.season}×</span>
        </button>`).join('') || '<p>Nog geen scheidsrechters.</p>'}
    </div>
    ${m.referee_id ? '<button class="btn danger block" id="unassign">Toewijzing verwijderen</button>' : ''}
  `, (el, close) => {
    el.querySelectorAll('[data-ref]').forEach((b) => b.onclick = async () => {
      const c = list.find((x) => x.referee.id === b.dataset.ref);
      if (c.referee.id === m.referee_id) return close();
      if (c.status === 'no' && !await ask(`${c.referee.name}: ${c.reasons.join(', ')}. Toch toewijzen?`, 'Toch toewijzen')) return;
      close();
      act(() => store.updateMatches([m.id], { referee_id: c.referee.id, published: false, referee_from_sportlink: false }), `${c.referee.name} toegewezen (concept).`);
    });
    const un = $('#unassign', el);
    if (un) un.onclick = () => { close(); act(() => store.updateMatches([m.id], { referee_id: null, published: false, referee_from_sportlink: false })); };
  });
}

// ---------- Planner: wedstrijden ----------
function wedstrijden(view) {
  const days = planDays();
  const day = pickDay(days);
  const ms = state.data.matches.filter((m) => m.date === day).sort((a, b) => a.time.localeCompare(b.time));
  view.innerHTML = `
    ${dateNav(days, day)}
    <div class="actions top"><button class="btn primary" id="add-match">＋ Wedstrijd</button></div>
    ${dayList(
      fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' }),
      `<span class="pill">${ms.length} ${ms.length === 1 ? 'wedstrijd' : 'wedstrijden'}</span>`,
      ms.map((m) => matchRow(m, {
        sub: [m.field, `${m.duration || 90} min`, m.sportlink_code ? 'Sportlink' : ''].filter(Boolean).map(esc).join('<span class="sep">·</span>'),
        action: '<span class="chev" aria-hidden="true">›</span>',
        attrs: `data-edit="${m.id}" role="button" tabindex="0"`,
      })).join('') || '<p class="muted list-empty">Geen wedstrijden op deze dag.</p>',
    )}`;
  bindDateNav(view, days, day);
  $('#add-match').onclick = () => matchForm({ date: day, time: '10:00', duration: 60 });
  view.querySelectorAll('[data-edit]').forEach((el) => el.onclick = () =>
    matchForm(state.data.matches.find((m) => m.id === el.dataset.edit)));
}

// Sportlink: status line for the Meer page (cloud: via our own hosting; demo: sample data).
function sportlinkStatus() {
  const last = state.data.lastSync;
  const canFetch = store.mode === 'demo' || !!SPORTLINK_SYNC_URL;
  const when = last ? new Date(last.at).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
  const text = !last ? (canFetch ? 'Nog niet opgehaald.' : 'Nog niet gekoppeld. Zie de README, stap Sportlink.')
    : last.ok ? `Bijgewerkt ${when}: ${last.added} nieuw, ${last.updated} gewijzigd, ${last.removed} vervallen.`
    : `Laatste poging mislukt (${when}): ${last.message || 'onbekende fout'}`;
  return { text, canFetch, ok: !!last?.ok, failed: last && !last.ok };
}

function bindSportlink() {
  const b = $('#sl-sync');
  if (!b) return;
  b.onclick = async () => {
    b.disabled = true;
    $('.sub', b).textContent = 'Bezig met ophalen…';
    try {
      const r = await store.syncSportlink(SPORTLINK_SYNC_URL);
      toast(`Sportlink: ${r.added} nieuw, ${r.updated} gewijzigd, ${r.removed} vervallen.`);
      await refresh();
    } catch (e) {
      toast(e.message, true);
      b.disabled = false;
      render();
    }
  };
}

function matchForm(m) {
  sheet(`
    <h3>${m.id ? 'Wedstrijd bewerken' : 'Nieuwe wedstrijd'}</h3>
    ${m.sportlink_code ? '<p class="muted note">Deze wedstrijd komt uit Sportlink. Datum, tijd, teams en veld worden bij elke synchronisatie bijgewerkt vanuit Sportlink; wijzig ze daar.</p>' : ''}
    <form id="mf" class="form">
      <div class="row"><label>Datum<input type="date" name="date" required value="${esc(m.date)}"></label>
        <label>Aanvang<input type="time" name="time" required value="${esc(m.time)}"></label></div>
      <label>Thuis<input name="home" required value="${esc(m.home)}" placeholder="Elspeet JO11-1"></label>
      <label>Uit<input name="away" value="${esc(m.away)}" placeholder="Tegenstander"></label>
      <div class="row"><label>Veld<input name="field" value="${esc(m.field)}"></label>
        <label>Duur (min)<input type="number" name="duration" min="20" max="180" value="${esc(m.duration || 90)}"></label></div>
      <label>Categorie<select name="category"><option value=""></option>${CATEGORIES.map((c) => `<option ${c === m.category ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="external_ref" ${m.external_ref ? 'checked' : ''}> KNVB stelt scheidsrechter aan</label>
      <button class="btn primary block">Opslaan</button>
      ${m.id ? '<button type="button" class="btn danger block" id="del">Verwijderen</button>' : ''}
    </form>`, (el, close) => {
    $('#mf', el).onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const row = { ...f, duration: Number(f.duration) || 90, external_ref: !!f.external_ref };
      if (row.external_ref) { row.referee_id = null; row.published = false; }
      if (m.id) row.id = m.id;
      close();
      state.day = row.date;
      act(() => store.saveMatches([row]), 'Opgeslagen');
    };
    // Picking a category fills in the usual KNVB playing time.
    $('select[name=category]', el).onchange = (e) => { if (e.target.value) $('input[name=duration]', el).value = defaultDuration(e.target.value); };
    const del = $('#del', el);
    if (del) del.onclick = async () => { if (await ask('Wedstrijd verwijderen?', 'Verwijderen')) { close(); act(() => store.deleteMatch(m.id), 'Verwijderd'); } };
  });
}

function importSheet() {
  sheet(`
    <h3>Wedstrijden importeren</h3>
    <p class="muted">CSV uit Sportlink of Excel (opslaan als CSV). Kolommen: <b>datum, tijd, thuis</b>, optioneel <b>uit, veld, categorie</b>.</p>
    <input type="file" id="csvfile" accept=".csv,text/csv">
    <textarea id="csvtext" rows="6" placeholder="datum;tijd;thuis;uit;veld;categorie&#10;12-10-2026;09:00;Elspeet JO11-1;DOS JO11-2;Veld 1;JO11"></textarea>
    <p id="csvinfo" class="muted"></p>
    <button class="btn primary block" id="doimport" disabled>Importeren</button>`, (el, close) => {
    let parsed = [];
    const parse = () => {
      try {
        parsed = csvMatches($('#csvtext', el).value);
        const exists = (p) => state.data.matches.some((m) => m.date === p.date && m.time === p.time && m.home === p.home);
        const dupes = parsed.filter(exists).length;
        parsed = parsed.filter((p) => !exists(p));
        $('#csvinfo', el).textContent = `${parsed.length} nieuwe wedstrijd(en)${dupes ? `, ${dupes} bestaan al` : ''}.`;
      } catch (e) { parsed = []; $('#csvinfo', el).textContent = e.message; }
      $('#doimport', el).disabled = !parsed.length;
    };
    $('#csvtext', el).oninput = parse;
    $('#csvfile', el).onchange = async (e) => { $('#csvtext', el).value = await e.target.files[0].text(); parse(); };
    $('#doimport', el).onclick = () => { close(); act(() => store.saveMatches(parsed), `${parsed.length} geïmporteerd`); };
  });
}

// ---------- Planner: scheidsrechters ----------
function scheidsrechters(view) {
  const counts = seasonCounts(state.data.matches, todayISO());
  const season = seasonOf(todayISO()).label;
  view.innerHTML = `
    <div class="actions top"><button class="btn primary" id="add-ref">＋ Scheidsrechter</button>
      <button class="btn ghost" id="export-season">⬇︎ Seizoenscijfers</button></div>
    <div class="list">
      ${state.data.referees.map((r) => `
        <article class="card ref tap ${r.active === false ? 'dim' : ''}" data-edit="${r.id}">
          <div class="avatar">${esc(initials(r.name))}</div>
          <div class="body"><b>${esc(r.name)}</b>
            <div class="meta">${r.is_planner ? '<span class="label">Planner</span> ' : ''}${r.sportlink_name ? '<span class="label type">Uit Sportlink</span> ' : ''}${r.user_id ? 'heeft ingelogd' : r.email ? 'nog niet ingelogd' : 'geen e-mail'}${(r.pref_categories || []).length ? ' · graag ' + esc(prefLabel(r.pref_categories, CATEGORIES)) : ''}</div></div>
          <div class="count">${counts[r.id] || 0}<small>${season}</small></div>
        </article>`).join('') || '<section class="card empty"><p>Nog geen scheidsrechters.</p></section>'}
    </div>
    <p class="muted pad">Alleen wie hier met een e-mailadres staat, kan inloggen. Deel daarna de link naar de app.</p>`;
  $('#add-ref').onclick = () => refForm({ name: '', email: '', active: true, pref_categories: [], avoid_categories: [] });
  $('#export-season').onclick = () => {
    const rows = [['Scheidsrechter', `Wedstrijden ${season}`]];
    state.data.referees.forEach((r) => rows.push([r.name, counts[r.id] || 0]));
    download(`seizoen-${season.replace('/', '-')}.csv`, '﻿' + toCSV(rows), 'text/csv');
  };
  view.querySelectorAll('[data-edit]').forEach((el) => el.onclick = () => refForm(state.data.referees.find((r) => r.id === el.dataset.edit)));
}

const initials = (n) => n.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

// Upcoming assignments of one referee (shown when a planner opens that referee).
function refAssignments(r) {
  const today = todayISO();
  const { start, end } = seasonOf(today);
  const mine = state.data.matches.filter((m) => m.referee_id === r.id);
  const upcoming = mine.filter((m) => m.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const past = mine.filter((m) => m.date < today && m.date >= start && m.date <= end).length;
  const rows = upcoming.map((m) => {
    const status = m.referee_from_sportlink ? 'via Sportlink' : m.published ? 'gepubliceerd' : 'concept';
    const issue = assignmentIssue(m, state.data);
    return `
      <button class="mrow menu ref-match" data-goto="${m.date}">
        <div class="t">${esc(m.time)}<small>${esc(fmtDate(m.date))}</small></div>
        <div class="info"><div class="teams"><span class="home">${team(m.home)}</span>${m.away ? `<span class="away">${team(m.away)}</span>` : ''}</div>
          <div class="sub">${[m.field, m.category].filter(Boolean).map(esc).join('<span class="sep">·</span>')}<span class="sep">·</span>
            <span class="st ${issue ? 'issue' : m.published ? 'pub' : 'concept'}">${status}</span>${issue ? `<span class="issue-text">${ICONS.warn}${esc(issue.join(', '))}</span>` : ''}</div></div>
        <span class="chev" aria-hidden="true">›</span>
      </button>`;
  }).join('');
  return `
    <div class="card day-list ref-assignments">
      <header class="day-head"><h2>Aangesteld</h2><span class="pills"><span class="pill ${upcoming.length ? 'done' : ''}">${upcoming.length} komend</span></span></header>
      ${rows || '<p class="muted list-empty">Geen komende aanstellingen.</p>'}
      ${past ? `<p class="muted list-empty">Dit seizoen al ${past} keer gefloten.</p>` : ''}
    </div>`;
}

function refForm(r) {
  sheet(`
    <h3>${r.id ? esc(r.name) : 'Nieuwe scheidsrechter'}</h3>
    ${r.id ? refAssignments(r) : ''}
    ${r.id ? '<h4 class="sheet-sub">Gegevens</h4>' : ''}
    <form id="rf" class="form">
      <label>Naam<input name="name" required value="${esc(r.name)}"></label>
      <label>E-mail <small class="muted">(nodig om in te loggen)</small><input type="email" name="email" value="${esc(r.email)}"></label>
      <label class="check"><input type="checkbox" name="active" ${r.active !== false ? 'checked' : ''}> Actief (kan worden ingepland)</label>
      ${r.id ? `<label class="check"><input type="checkbox" name="is_planner" ${r.is_planner ? 'checked' : ''} ${r.user_id ? '' : 'disabled'}> Planner
        ${r.user_id ? '' : '<small class="muted">(kan pas na eerste keer inloggen)</small>'}</label>` : ''}
      <p class="field-error" id="rf-err" hidden></p>
      <button class="btn primary block">Opslaan</button>
      ${r.id ? '<button type="button" class="btn danger block" id="del">Verwijderen</button>' : ''}
    </form>`, (el, close) => {
    $('#rf', el).onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const row = { name: f.name.trim(), email: f.email.trim() || null, active: !!f.active };
      const err = $('#rf-err', el), btn = $('#rf button.primary', el);
      if (!row.name) { err.textContent = 'Vul een naam in.'; err.hidden = false; return; }
      if (r.id) row.id = r.id;
      const plannerChanged = r.id && r.user_id && !!f.is_planner !== !!r.is_planner;
      // Keep the sheet open until the save really worked, so a failure is visible.
      btn.disabled = true; btn.textContent = 'Bezig met opslaan…'; err.hidden = true;
      try {
        await store.saveReferee(row);
        if (plannerChanged) await store.setPlanner(r.id, !!f.is_planner);
        close();
        toast(r.id ? 'Opgeslagen' : `${row.name} is toegevoegd`);
        if (store.mode === 'cloud') await refresh();
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
        btn.disabled = false; btn.textContent = 'Opslaan';
      }
    };
    const del = $('#del', el);
    if (del) del.onclick = async () => { if (await ask(`${r.name} verwijderen?`, 'Verwijderen')) { close(); act(() => store.deleteReferee(r.id), 'Verwijderd'); } };
    // Tap an assignment → open that day in the planning.
    el.querySelectorAll('[data-goto]').forEach((b) => b.onclick = () => { close(); state.day = b.dataset.goto; location.hash = 'planning'; render(); });
  });
}

// ---------- Referee: overzicht ----------
const OPEN_DAYS_AHEAD = 28;

function overzicht(view) {
  const me = store.user.referee_id;
  const today = todayISO();
  const { matches, notifications } = state.data;
  const offers = state.data.offers || [];
  const byTime = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);
  const horizon = new Date(today + 'T12:00:00'); horizon.setDate(horizon.getDate() + OPEN_DAYS_AHEAD);
  const until = `${horizon.getFullYear()}-${String(horizon.getMonth() + 1).padStart(2, '0')}-${String(horizon.getDate()).padStart(2, '0')}`;
  const mine = matches.filter((m) => m.referee_id === me && m.published && m.date >= today).sort(byTime);
  const myDay = matches.filter((m) => m.referee_id === me && m.date >= today);
  const allOpen = matches.filter((m) => !m.referee_id && !m.external_ref && m.date >= today && m.date <= until).sort(byTime);
  // Only what this referee likes to whistle ("Wat fluit je graag?" in Instellingen), unless they ask for all.
  const prefs = state.data.referees.find((r) => r.id === me)?.pref_categories || [];
  const filtered = prefs.length > 0 && !state.showAllOpen;
  const open = filtered ? allOpen.filter((m) => prefs.includes(m.category)) : allOpen;
  const hiddenCount = allOpen.length - open.length;
  const filterNote = !prefs.length ? ''
    : filtered ? `<p class="muted list-intro filter-note">Alleen wat je graag fluit: <b>${esc(prefLabel(prefs, CATEGORIES))}</b>. <a href="#profiel">Aanpassen</a>${hiddenCount ? ` · <button class="linkish" id="show-all-open">Toon alle ${allOpen.length}</button>` : ''}</p>`
    : `<p class="muted list-intro filter-note">Alle open wedstrijden. <button class="linkish" id="show-pref-open">Alleen wat ik graag fluit</button></p>`;
  const todo = availabilityDates(matches).filter((d) => !state.data.availability.some((a) => a.referee_id === me && a.date === d));
  const latest = notifications.slice(0, 3);
  const unread = notifications.filter((n) => !n.read_at).length;

  const openRows = open.map((m) => {
    const offered = offers.some((o) => o.match_id === m.id && o.referee_id === me);
    const busy = myDay.find((x) => overlaps(x, m));
    const action = offered
      ? `<button class="btn pill-btn offered" data-unoffer="${m.id}" title="Aanbod intrekken">✓ Aangeboden</button>`
      : busy ? `<span class="muted small-note">Je fluit dan al</span>`
      : `<button class="btn pill-btn assign" data-offer="${m.id}">Ik kan fluiten</button>`;
    return matchRow(m, { time: m.time, sub: [fmtDate(m.date), m.field].filter(Boolean).map(esc).join('<span class="sep">·</span>'), action });
  }).join('');

  view.innerHTML = `
    <h2 class="hello">Hoi ${esc(store.user.name.split(' ')[0])}</h2>
    ${!me ? '<section class="card warn">Je account is nog niet gekoppeld aan een scheidsrechter. Vraag de planner om je e-mailadres toe te voegen.</section>' : ''}
    ${todo.length ? `<a class="card warn tap block" href="#beschikbaarheid">📅 Vul je beschikbaarheid in voor ${todo.length} dag(en) →</a>` : ''}
    ${dayList('Ik fluit', `<span class="pill ${mine.length ? 'done' : ''}">${mine.length} komend</span>`,
      (mine.slice(0, 3).map((m) => matchRow(m, {
        sub: [fmtDate(m.date), m.field].filter(Boolean).map(esc).join('<span class="sep">·</span>'),
        action: `<button class="btn pill-btn" data-ics="${m.id}">Agenda</button>`,
      })).join('') || '<p class="muted list-empty">Je hebt nog geen aanstellingen.</p>')
      + (mine.length > 3 ? `<a class="link-row pad-row" href="#mijn"><span>Alle ${mine.length} wedstrijden</span>${ICONS.arrow}</a>` : ''))}
    ${dayList('Laatste meldingen', unread ? `<span class="pill open">${unread} nieuw</span>` : '',
      (latest.map(notifRow).join('') || '<p class="muted list-empty">Nog geen meldingen.</p>')
      + (notifications.length ? `<a class="link-row pad-row" href="#meldingen"><span>Alle meldingen</span>${ICONS.arrow}</a>` : ''))}
    ${dayList('Open wedstrijden', `<span class="pill ${open.length ? 'open' : ''}">${open.length} zonder scheids</span>`,
      filterNote + (openRows ? `<p class="muted list-intro">Nog geen scheidsrechter voor de komende ${OPEN_DAYS_AHEAD / 7} weken. Tik op <b>Ik kan fluiten</b>, dan krijgt de planner bericht.</p>${openRows}`
        : `<p class="muted list-empty">${hiddenCount ? 'Geen open wedstrijden in wat je graag fluit.' : 'Alle wedstrijden van de komende weken hebben een scheidsrechter.'}</p>`))}`;

  view.querySelectorAll('[data-ics]').forEach((b) => b.onclick = () => calendarSheet(matches.find((x) => x.id === b.dataset.ics)));
  bindNotifRows(view);
  const showAll = $('#show-all-open'), showPref = $('#show-pref-open');
  if (showAll) showAll.onclick = () => { state.showAllOpen = true; render(); };
  if (showPref) showPref.onclick = () => { state.showAllOpen = false; render(); };
  view.querySelectorAll('[data-offer]').forEach((b) => b.onclick = () => {
    b.disabled = true;
    act(() => store.addOffer(b.dataset.offer), 'Doorgegeven: de planner weet dat je kunt fluiten.');
  });
  view.querySelectorAll('[data-unoffer]').forEach((b) => b.onclick = async () => {
    if (!await ask('Aanbod intrekken? De planner ziet dan niet meer dat je kunt.', 'Intrekken')) return;
    act(() => store.removeOffer(b.dataset.unoffer), 'Aanbod ingetrokken');
  });
}

// ---------- Referee: mijn wedstrijden ----------
// Only the matches this referee whistles: what's coming up, and what was already played this season.
function mijn(view) {
  const me = store.user.referee_id;
  const today = todayISO();
  const mine = state.data.matches.filter((m) => m.referee_id === me && m.published)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const upcoming = mine.filter((m) => m.date >= today);
  const { start, label } = seasonOf(today);
  const played = mine.filter((m) => m.date >= start && m.date < today).reverse();
  const sub = (m) => [fmtDate(m.date), m.field].filter(Boolean).map(esc).join('<span class="sep">·</span>');

  view.innerHTML = `
    ${!me ? '<section class="card warn">Je account is nog niet gekoppeld aan een scheidsrechter. Vraag de planner om je e-mailadres toe te voegen.</section>' : ''}
    ${upcoming.length ? dayList('Komende wedstrijden', `<span class="pill done">${upcoming.length}</span>`,
      upcoming.map((m) => matchRow(m, {
        sub: sub(m),
        action: `<button class="btn pill-btn" data-ics="${m.id}">Agenda</button>`,
      })).join(''))
      : '<section class="card empty"><p>Je hebt nog geen wedstrijden om te fluiten.</p></section>'}
    ${played.length ? dayList(`Gefloten seizoen ${label}`, `<span class="pill">${played.length}</span>`,
      played.map((m) => matchRow(m, { sub: sub(m) })).join('')) : ''}`;
  view.querySelectorAll('[data-ics]').forEach((b) => b.onclick = () =>
    calendarSheet(state.data.matches.find((x) => x.id === b.dataset.ics)));
}

// Times for a calendar entry: be there 30 minutes before kick-off, until the end of the match.
function calendarTimes(m) {
  const start = Math.max(0, toMin(m.time) - 30);
  const end = Math.min(1439, matchEnd(m));
  const stamp = (min) => `${m.date.replace(/-/g, '')}T${fromMin(min).replace(':', '')}00`;
  return { start, end, stamp };
}

const calendarTitle = (m) => `Fluiten: ${m.home}${m.away ? ' - ' + m.away : ''}`;
const calendarPlace = (m) => `${CLUB_NAME}${m.field ? ', ' + m.field : ''}`;
const calendarNote = (m) => `Aanvang ${m.time} (30 min van tevoren aanwezig)`;

// Let the referee pick their calendar: Google and Outlook open a filled-in "new event" screen,
// the file works for Apple Calendar and others (on Android a file only lands in Downloads).
function calendarSheet(m) {
  const { start, end, stamp } = calendarTimes(m);
  const google = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
    action: 'TEMPLATE', text: calendarTitle(m), dates: `${stamp(start)}/${stamp(end)}`,
    ctz: 'Europe/Amsterdam', location: calendarPlace(m), details: calendarNote(m),
  });
  const iso = (min) => `${m.date}T${fromMin(min)}:00`;
  const outlook = 'https://outlook.live.com/calendar/0/deeplink/compose?' + new URLSearchParams({
    path: '/calendar/action/compose', rru: 'addevent', subject: calendarTitle(m),
    startdt: iso(start), enddt: iso(end), location: calendarPlace(m), body: calendarNote(m),
  });
  const isApple = /iphone|ipad|ipod|macintosh/i.test(navigator.userAgent);
  const fileRow = `<button class="mrow menu" id="cal-file"><span class="micon">${ICONS.calendar}</span>
      <div class="info"><b>Apple Agenda of andere agenda</b><div class="sub">${isApple ? 'Opent "Voeg toe aan agenda"' : 'Download een agendabestand (.ics) en open het'}</div></div><span class="chev" aria-hidden="true">›</span></button>`;
  const link = (href, title, sub) => `<a class="mrow menu" href="${href}" target="_blank" rel="noopener"><span class="micon">${ICONS.date}</span>
      <div class="info"><b>${title}</b><div class="sub">${sub}</div></div><span class="chev" aria-hidden="true">›</span></a>`;
  sheet(`
    <h3>Zet in je agenda</h3>
    <p class="muted">${esc(fmtDate(m.date, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${esc(fromMin(start))}–${esc(fromMin(end))} · ${esc(m.home)}</p>
    <div class="card day-list cal-options">
      ${isApple ? fileRow : ''}
      ${link(esc(google), 'Google Agenda', 'Opent een nieuwe afspraak, alles al ingevuld')}
      ${link(esc(outlook), 'Outlook', 'Opent een nieuwe afspraak in Outlook')}
      ${isApple ? '' : fileRow}
    </div>`, (el, close) => {
    $('#cal-file', el).onclick = () => { download(`wedstrijd-${m.date}.ics`, ics(m), 'text/calendar'); close(); };
    el.querySelectorAll('a.mrow').forEach((a) => a.addEventListener('click', () => setTimeout(close, 300)));
  });
}

function ics(m) {
  const { start, end, stamp } = calendarTimes(m);
  // Escape text per RFC 5545 and include the Amsterdam time zone so every calendar shows the right time.
  const text = (v) => String(v).replace(/[\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${APP_NAME}//NL`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Amsterdam',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${m.id}@elspeet-fluit`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;TZID=Europe/Amsterdam:${stamp(start)}`,
    `DTEND;TZID=Europe/Amsterdam:${stamp(end)}`,
    `SUMMARY:${text(calendarTitle(m))}`,
    `LOCATION:${text(calendarPlace(m))}`,
    `DESCRIPTION:${text(calendarNote(m))}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

// ---------- Referee: beschikbaarheid ----------
function beschikbaarheid(view) {
  const me = store.user.referee_id;
  if (!me) { view.innerHTML = '<section class="card warn">Je account is nog niet gekoppeld aan een scheidsrechter.</section>'; return; }
  const dates = availabilityDates(state.data.matches);
  const av = (d) => state.data.availability.find((a) => a.referee_id === me && a.date === d);
  view.innerHTML = `
    <p class="muted pad">Geef per dag door of je kunt fluiten. Wijzigingen worden direct opgeslagen.</p>
    ${dates.map((d) => {
      const a = av(d);
      const n = state.data.matches.filter((m) => m.date === d && !m.external_ref).length;
      const mine = state.data.matches.filter((m) => m.date === d && m.referee_id === me && m.published).length;
      return `
        <section class="card avail" data-date="${d}">
          <div class="head"><b>${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}</b>
            <small class="muted">${n} wedstrijden${mine ? ` · jij fluit er ${mine}` : ''}</small></div>
          <div class="seg">
            <button class="${a?.available ? 'on yes' : ''}" data-set="yes">✓ Beschikbaar</button>
            <button class="${a && !a.available ? 'on no' : ''}" data-set="no">✕ Niet</button>
          </div>
          ${a?.available ? `
            <div class="row small">
              <label>Van<input type="time" data-f="start_time" value="${esc(a.start_time || '')}"></label>
              <label>Tot<input type="time" data-f="end_time" value="${esc(a.end_time || '')}"></label>
              <label>Max<select data-f="max_matches">${['', 1, 2, 3, 4].map((x) => `<option value="${x}" ${String(a.max_matches ?? '') === String(x) ? 'selected' : ''}>${x || '–'}</option>`).join('')}</select></label>
            </div>` : ''}
        </section>`;
    }).join('')}
    <section class="card">
      <h3>Langere afwezigheid</h3>
      <p class="muted">Vakantie of blessure? Meld alle wedstrijddagen in één keer af.</p>
      <div class="row small"><label>Van<input type="date" id="abs-from"></label><label>Tot<input type="date" id="abs-to"></label></div>
      <button class="btn block" id="abs">Afmelden voor deze periode</button>
    </section>`;

  view.querySelectorAll('.avail').forEach((card) => {
    const d = card.dataset.date;
    const base = () => av(d) || { referee_id: me, date: d, start_time: '', end_time: '', max_matches: null };
    card.querySelectorAll('[data-set]').forEach((b) => b.onclick = async () => {
      const yes = b.dataset.set === 'yes';
      if (!yes && state.data.matches.some((m) => m.date === d && m.referee_id === me)
        && !await ask('Je bent die dag al aangesteld. Toch afmelden? De planner krijgt hiervan een melding.', 'Toch afmelden')) return;
      const row = { ...base(), available: yes };
      saveAv(row);
    });
    card.querySelectorAll('[data-f]').forEach((inp) => inp.onchange = () => {
      const row = { ...base(), [inp.dataset.f]: inp.dataset.f === 'max_matches' ? (Number(inp.value) || null) : inp.value };
      if (row.start_time && row.end_time && row.end_time <= row.start_time) {
        toast('De eindtijd moet later zijn dan de begintijd.', true);
        inp.value = base()[inp.dataset.f] || '';
        return;
      }
      saveAv(row);
    });
  });
  $('#abs').onclick = () => {
    const from = $('#abs-from').value, to = $('#abs-to').value;
    if (!from || !to || to < from) return toast('Kies een geldige periode', true);
    const days = new Set(state.data.matches.filter((m) => m.date >= from && m.date <= to).map((m) => m.date));
    for (let x = new Date(from + 'T12:00:00'); x <= new Date(to + 'T12:00:00'); x.setDate(x.getDate() + 1)) {
      if (x.getDay() === 6 || x.getDay() === 0) days.add(x.toISOString().slice(0, 10));
    }
    act(async () => {
      for (const d of days) await store.saveAvailability({ ...(av(d) || { referee_id: me, date: d }), available: false });
    }, `Afgemeld voor ${days.size} dag(en)`);
  };
}

function saveAv(row) {
  // Optimistic update so the UI responds instantly.
  const list = state.data.availability;
  const i = list.findIndex((a) => a.referee_id === row.referee_id && a.date === row.date);
  if (i >= 0) list[i] = row; else list.push(row);
  render();
  act(() => store.saveAvailability(row));
}

// ---------- Profiel ----------
// ---------- Wat fluit je graag? (Instellingen, en voor planners ook onder Meer) ----------
function prefsCard(ref) {
  const pst = prefState(ref.pref_categories, CATEGORIES);
  const groups = categoryGroups(CATEGORIES);
  return `
    <section class="card prefs">
      <h3>Wat fluit je graag?</h3>
      <p class="muted">Kies eerst een groep. Wil je alleen bepaalde teams, tik die dan ook aan. Laat je de teams open, dan geldt de hele groep. Je ziet bij <b>Open wedstrijden</b> dan alleen deze wedstrijden.</p>
      <div class="chips groups">${groups.map(([g]) =>
        `<button class="chip group ${pst[g].on ? 'like' : ''}" data-group="${g}" aria-pressed="${pst[g].on}">${g}</button>`).join('')}</div>
      ${groups.filter(([, cs]) => cs.length > 1).map(([g, cs]) => `
        <div class="pref-teams ${pst[g].on ? '' : 'off'}">
          <small>${g}${pst[g].on && !pst[g].teams.length ? ' · alle teams' : ''}</small>
          <div class="chips wrap">${cs.map((c) => `${c === '7x7' ? '<span class="chip-break"></span>' : ''}<button class="chip ${pst[g].teams.includes(c) ? 'on' : ''}" data-cat="${c}" aria-pressed="${pst[g].teams.includes(c)}">${c}</button>`).join('')}</div>
        </div>`).join('')}
    </section>`;
}

function bindPrefs(view, ref) {
  const savePrefs = (prefs) => {
    ref.pref_categories = prefs; ref.avoid_categories = [];
    render();
    act(() => store.saveReferee({ id: ref.id, pref_categories: ref.pref_categories, avoid_categories: [] }));
  };
  view.querySelectorAll('[data-group]').forEach((b) => b.onclick = () => savePrefs(togglePrefGroup(ref.pref_categories, b.dataset.group, CATEGORIES)));
  view.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => savePrefs(togglePrefTeam(ref.pref_categories, b.dataset.cat, CATEGORIES)));
}

function voorkeuren(view) {
  const ref = state.data.referees.find((r) => r.id === store.user.referee_id);
  view.innerHTML = ref ? prefsCard(ref) : '<section class="card warn">Je staat nog niet als scheidsrechter in de lijst.</section>';
  if (ref) bindPrefs(view, ref);
}

function profiel(view) {
  const u = store.user;
  const ref = state.data.referees.find((r) => r.id === u.referee_id);
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  view.innerHTML = `
    <section class="card">
      <h3>Mijn gegevens</h3>
      <form id="pf" class="form">
        <label>Naam<input name="name" required value="${esc(u.name)}"></label>
        <p class="muted">${esc(u.email)} · ${u.role === 'planner' ? 'Planner' : 'Scheidsrechter'}</p>
        <button class="btn block">Opslaan</button>
      </form>
    </section>
    <section class="card">
      <h3>Tekstgrootte</h3>
      <div class="seg sizes" role="radiogroup" aria-label="Tekstgrootte">
        ${TEXT_SIZES.map(([k, label, px]) => `<button role="radio" aria-checked="${k === getTextSize()}" class="${k === getTextSize() ? 'on' : ''}" data-size="${k}" title="${label}">
          <span style="font-size:${px}px">A</span><small>${label}</small></button>`).join('')}
      </div>
      <p class="size-preview">Zo ziet de tekst eruit. De keuze geldt alleen voor dit toestel.</p>
    </section>
    ${ref ? prefsCard(ref) : ''}
    ${standalone ? '' : `
    <section class="card">
      <h3>📱 Zet de app op je telefoon</h3>
      ${isIOS
        ? '<p>Tik in Safari op <b>Deel</b> (vierkant met pijl) en kies <b>Zet op beginscherm</b>.</p>'
        : state.installPrompt
          ? '<button class="btn primary block" id="install">Installeren</button>'
          : '<p>Open het browsermenu (⋮) en kies <b>App installeren</b> of <b>Toevoegen aan startscherm</b>.</p>'}
    </section>`}
    <section class="card">
      <button class="btn block" id="logout">Uitloggen</button>
      ${store.mode === 'demo' ? '<button class="btn ghost block" id="reset">Demo-gegevens herstellen</button>' : ''}
    </section>`;
  view.querySelectorAll('[data-size]').forEach((b) => b.onclick = () => { setTextSize(b.dataset.size); render(); });
  $('#pf').onsubmit = (e) => { e.preventDefault(); act(() => store.updateProfile({ name: new FormData(e.target).get('name').trim() }), 'Opgeslagen'); };
  if (ref) bindPrefs(view, ref);
  const inst = $('#install');
  if (inst) inst.onclick = async () => { state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; render(); };
  $('#logout').onclick = () => act(() => store.signOut());
  const reset = $('#reset');
  if (reset) reset.onclick = async () => { if (await ask('Alle demo-gegevens terugzetten?', 'Terugzetten')) act(() => store.resetDemo(), 'Demo hersteld'); };
}

// ---------- Meldingen ----------
const KIND_ICON = { assigned: '✓', changed: '↻', withdrawn: '✕', cancelled: '✕', unavailable: '!', offer: '✋' };

function notifRow(n) {
  return `
    <div class="nrow ${n.read_at ? '' : 'unread'} k-${esc(n.kind)}" data-n="${n.id}" role="button" tabindex="0">
      <span class="nicon" aria-hidden="true">${KIND_ICON[n.kind] || '•'}</span>
      <div class="info"><b>${esc(n.title)}</b><span>${esc(n.body || '')}</span><small>${timeAgo(n.created_at)}</small></div>
      ${n.read_at ? '' : '<i class="udot" title="Ongelezen"></i>'}
    </div>`;
}

function bindNotifRows(view) {
  view.querySelectorAll('[data-n]').forEach((row) => row.onclick = () => {
    const n = state.data.notifications.find((x) => x.id === row.dataset.n);
    if (!n.read_at) act(() => store.markRead([n.id]));
    if (n.to_planners && n.date) { state.day = n.date; location.hash = 'planning'; }
    else if (n.kind !== 'cancelled' && n.kind !== 'withdrawn') location.hash = 'mijn';
  });
}

function timeAgo(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return 'zojuist';
  if (min < 60) return `${min} min geleden`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} uur geleden`;
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}

function meldingen(view) {
  const list = state.data.notifications;
  const unread = list.filter((n) => !n.read_at);
  view.innerHTML = `
    ${pushCard()}
    <section class="card day-list">
      <header class="day-head"><h2>Meldingen</h2>
        ${unread.length ? `<button class="btn pill-btn" id="read-all">Alles gelezen</button>` : ''}</header>
      ${list.map(notifRow).join('') || '<p class="muted list-empty">Nog geen meldingen. Hier zie je aanstellingen, wijzigingen en afmeldingen.</p>'}
    </section>`;
  const ra = $('#read-all');
  if (ra) ra.onclick = () => act(() => store.markRead(unread.map((n) => n.id)));
  bindNotifRows(view);
  bindPush();
}

// Push notifications need an installed app (iOS), a VAPID key and the cloud backend.
function pushStatus() {
  if (store.mode !== 'cloud' || !VAPID_PUBLIC_KEY) return 'unconfigured';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ? 'install' : 'unsupported';
  }
  return Notification.permission === 'granted' ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off';
}

function pushCard() {
  const st = pushStatus();
  const text = {
    unconfigured: store.mode === 'demo'
      ? 'In de demo verschijnen meldingen alleen hier. In de echte app krijg je ze ook als pushmelding op je telefoon.'
      : 'Pushmeldingen zijn nog niet ingesteld door de beheerder. Meldingen verschijnen wel hier.',
    install: 'Zet de app eerst op je beginscherm (Deel → Zet op beginscherm) en open hem vanaf daar. Daarna kun je pushmeldingen aanzetten.',
    unsupported: 'Deze browser ondersteunt geen pushmeldingen. Meldingen verschijnen wel hier.',
    denied: 'Pushmeldingen zijn geblokkeerd. Zet ze aan in de instellingen van je telefoon voor deze app.',
    on: 'Pushmeldingen staan aan op dit toestel.',
    off: 'Krijg direct bericht op je telefoon bij een aanstelling of wijziging.',
  }[st];
  return `
    <section class="card push ${st}">
      <div class="push-head">${ICONS.bell}<b>Pushmeldingen</b>${st === 'on' ? '<span class="pill done">Aan</span>' : ''}</div>
      <p class="muted">${text}</p>
      ${st === 'off' ? '<button class="btn primary block" id="push-on">Meldingen aanzetten</button>' : ''}
    </section>`;
}

function bindPush() {
  const b = $('#push-on');
  if (!b) return;
  b.onclick = () => act(async () => {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { render(); throw new Error('Meldingen zijn niet toegestaan.'); }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY) });
    await store.savePushSubscription(sub.toJSON());
    render();
  }, 'Pushmeldingen staan aan.');
}

function base64UrlToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// ---------- Meer (planner) ----------
// ---------- Planner: overzicht ----------
// Short explanation, the tabs with what needs attention, and the former "Meer" items.
const menuLink = (href, icon, title, sub, right = '') => `
  <a class="mrow menu" href="#${href}"><span class="micon">${icon}</span>
    <div class="info"><b>${title}</b><div class="sub">${sub}</div>${right && right.replace(/<[^>]+>/g, '') ? `<div class="menu-pills">${right}</div>` : ''}</div><span class="chev" aria-hidden="true">›</span></a>`;

function plannerOverzicht(view) {
  const me = store.user.referee_id;
  const today = todayISO();
  const { matches, referees, notifications } = state.data;
  const offers = state.data.offers || [];
  const coming = matches.filter((m) => m.date >= today);
  const open = coming.filter((m) => !m.referee_id && !m.external_ref);
  const concept = coming.filter((m) => m.referee_id && !m.published);
  const issues = coming.filter((m) => assignmentIssue(m, state.data)).length;
  const offered = open.filter((m) => offers.some((o) => o.match_id === m.id)).length;
  const unread = notifications.filter((n) => !n.read_at).length;
  const pill = (n, text, cls = 'open') => (n ? `<span class="pill ${cls}">${n} ${text}</span>` : '');

  view.innerHTML = `
    <h2 class="hello">Hoi ${esc(store.user.name.split(' ')[0])}</h2>
    <section class="card day-list">
      <header class="day-head"><h2>Zo werkt het</h2></header>
      <ol class="steps">
        <li><b>Wedstrijden</b> komen elk uur uit Sportlink. Je kunt ze ook zelf toevoegen.</li>
        <li><b>Scheidsrechters</b> geven hun beschikbaarheid en voorkeuren door, en kunnen zich aanbieden voor open wedstrijden.</li>
        <li>In <b>Planning</b> wijs je per speeldag een scheidsrechter toe. Dat is eerst een concept.</li>
        <li>Na <b>Publiceren</b> krijgt de scheidsrechter een melding en staat de wedstrijd bij Mijn fluiten.</li>
      </ol>
    </section>
    <section class="card day-list">
      <header class="day-head"><h2>Direct naar</h2></header>
      ${menuLink('planning', ICONS.planning, 'Planning', 'Per speeldag toewijzen en publiceren',
        `${pill(open.length, 'open')}${pill(concept.length, 'concept', '')}${pill(issues, 'probleem', 'issue')}`)}
      ${menuLink('wedstrijden', ICONS.ball, 'Wedstrijden', 'Alle wedstrijden bekijken, toevoegen of wijzigen',
        `${pill(coming.length, 'komend', '')}`)}
      ${menuLink('scheidsrechters', ICONS.people, 'Scheidsen', 'Scheidsrechters, contactgegevens en aanstellingen',
        `${pill(referees.filter((r) => r.active !== false).length, 'actief', '')}`)}
      ${menuLink('meldingen', ICONS.bell, 'Meldingen', 'Afmeldingen, wijzigingen en aanbiedingen',
        `${pill(offered, 'aanbod', 'done')}${pill(unread, 'nieuw')}`)}
    </section>
    <section class="card day-list">
      <header class="day-head"><h2>Ik fluit zelf ook</h2></header>
      ${me ? menuLink('mijn', ICONS.whistle, 'Mijn fluiten', 'De wedstrijden die je zelf fluit')
        + menuLink('beschikbaarheid', ICONS.calendar, 'Mijn beschikbaarheid', 'Geef door wanneer je zelf kunt fluiten')
        + menuLink('voorkeuren', ICONS.ball, 'Wat fluit je graag?', (() => {
          const prefs = referees.find((r) => r.id === me)?.pref_categories || [];
          return prefs.length ? 'Graag: ' + esc(prefLabel(prefs, CATEGORIES)) : 'Geef je voorkeur op voor groepen en teams';
        })())
        : '<p class="muted list-empty">Je staat nog niet als scheidsrechter in de lijst.</p>'}
    </section>
    <section class="card day-list">
      <header class="day-head"><h2>Wedstrijden importeren</h2></header>
      ${(() => { const sl = sportlinkStatus(); return `
      <button class="mrow menu ${sl.failed ? 'failed' : ''}" id="sl-sync" ${sl.canFetch ? '' : 'disabled'}><span class="micon">${ICONS.refresh}</span>
        <div class="info"><b>Sportlink${sl.canFetch ? ': nu ophalen' : ''}</b><div class="sub">${esc(sl.text)}${store.mode === 'demo' ? ' In de demo komen er voorbeeldwedstrijden bij.' : ''}</div></div>
        ${sl.ok ? '<span class="pill done">Gekoppeld</span>' : ''}</button>`; })()}
      <button class="mrow menu" id="csv-import"><span class="micon">${ICONS.upload}</span>
        <div class="info"><b>CSV importeren</b><div class="sub">Wedstrijden uit een Excel- of CSV-bestand</div></div><span class="chev" aria-hidden="true">›</span></button>
    </section>
    <section class="card day-list">
      <header class="day-head"><h2>App</h2></header>
      ${menuLink('profiel', ICONS.settings, 'Instellingen', 'Naam, tekstgrootte, app installeren, uitloggen')}
    </section>`;
  bindSportlink();
  $('#csv-import').onclick = importSheet;
}

// ---------- UI helpers ----------
function sheet(html, bind) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button class="close" aria-label="Sluiten">✕</button>${html}</div>`;
  const close = () => wrap.remove();
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  $('.close', wrap).onclick = close;
  document.body.appendChild(wrap);
  bind?.(wrap, close);
}

// In-page confirmation (native confirm() is blocked in some embedded views).
function ask(message, okLabel = 'OK') {
  return new Promise((resolve) => {
    sheet(`<h3>${esc(message)}</h3>
      <div class="actions"><button class="btn" id="ask-no">Annuleren</button>
      <button class="btn primary" id="ask-yes">${esc(okLabel)}</button></div>`, (el, close) => {
      const done = (v) => { close(); resolve(v); };
      $('#ask-yes', el).onclick = () => done(true);
      $('#ask-no', el).onclick = () => done(false);
      $('.close', el).onclick = () => done(false);
      el.onclick = (e) => { if (e.target === el) done(false); };
    });
  });
}

let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 3500);
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installPrompt = e; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

applyTextSize();
boot();
