import { SUPABASE_URL, SUPABASE_ANON_KEY, CLUB_NAME, CATEGORIES } from './config.js';
import { createLocalStore } from './store-local.js';
import {
  candidates, proposeDay, availabilityDates, seasonOf, seasonCounts, csvMatches, toCSV, matchEnd, fromMin, toMin,
} from './logic.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fmtDate = (d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  new Date(d + 'T12:00:00').toLocaleDateString('nl-NL', opts);

let store;
const state = { data: { matches: [], referees: [], availability: [] }, day: null, installPrompt: null };

// ---------- Boot ----------
async function boot() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const { createSupabaseStore } = await import('./store-supabase.js');
    store = createSupabaseStore(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    store = createLocalStore();
  }
  $('#club').textContent = CLUB_NAME;
  document.title = `Scheidsrechters · ${CLUB_NAME}`;
  try { await store.init(); } catch (e) { toast(e.message, true); }
  store.onChange(refresh);
  window.addEventListener('hashchange', render);
  await refresh();
}

async function refresh() {
  if (store.user) {
    try { state.data = await store.loadAll(); } catch (e) { toast('Laden mislukt: ' + e.message, true); }
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
const ROUTES = {
  planner: [
    ['planning', 'Planning', '📋'],
    ['wedstrijden', 'Wedstrijden', '⚽'],
    ['scheidsrechters', 'Scheidsen', '👥'],
    ['profiel', 'Profiel', '⚙️'],
  ],
  referee: [
    ['mijn', 'Mijn fluiten', '🏁'],
    ['beschikbaarheid', 'Beschikbaar', '📅'],
    ['profiel', 'Profiel', '⚙️'],
  ],
};

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
  const routes = ROUTES[user.role] || ROUTES.referee;
  let route = location.hash.replace('#/', '');
  if (!routes.some(([r]) => r === route)) route = routes[0][0];
  nav.innerHTML = routes.map(([r, label, icon]) =>
    `<a href="#/${r}" class="${r === route ? 'active' : ''}"><span>${icon}</span>${label}</a>`).join('');
  const views = { planning, wedstrijden, scheidsrechters, mijn, beschikbaarheid, profiel };
  view.innerHTML = '';
  views[route](view);
}

// ---------- Login ----------
function loginView() {
  if (store.mode === 'demo') {
    const refs = state.data.referees.length ? state.data.referees : [];
    return `
      <section class="card login">
        <h2>Welkom 👋</h2>
        <p>Dit is de <b>demo-modus</b>: gegevens blijven op dit toestel. Koppel Supabase in <code>js/config.js</code> om te delen met je club.</p>
        <button class="btn primary block" data-login="planner">Inloggen als planner</button>
        <div class="row">
          <select id="demo-ref">${refs.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>
          <button class="btn" data-login="referee">Als scheidsrechter</button>
        </div>
      </section>`;
  }
  return `
    <section class="card login">
      <h2>Inloggen</h2>
      <p>Vul je e-mailadres in. Je krijgt een link om in te loggen, zonder wachtwoord.</p>
      <form id="login-form">
        <input type="email" name="email" required placeholder="naam@voorbeeld.nl" autocomplete="email">
        <button class="btn primary block">Stuur inloglink</button>
      </form>
      <p id="login-msg" class="muted"></p>
    </section>`;
}

function bindLogin() {
  if (store.mode === 'demo') {
    if (!state.data.referees.length) store.loadAll().then((d) => { state.data = d; render(); });
    document.querySelectorAll('[data-login]').forEach((b) => b.onclick = () =>
      act(async () => {
        await store.signIn({ role: b.dataset.login, refereeId: $('#demo-ref')?.value });
        location.hash = '';
      }));
    return;
  }
  $('#login-form').onsubmit = (e) => {
    e.preventDefault();
    const email = new FormData(e.target).get('email');
    act(async () => { const r = await store.signIn({ email }); $('#login-msg').textContent = r.message; });
  };
}

// ---------- Planner: planning ----------
function matchDays() {
  return [...new Set(state.data.matches.map((m) => m.date))].sort();
}

function planning(view) {
  const { matches, referees, availability } = state.data;
  const days = matchDays();
  if (!days.length) {
    view.innerHTML = `<section class="card empty"><p>Nog geen wedstrijden.</p><a class="btn primary" href="#/wedstrijden">Wedstrijden toevoegen</a></section>`;
    return;
  }
  const today = todayISO();
  if (!state.day || !days.includes(state.day)) state.day = days.find((d) => d >= today) || days[days.length - 1];
  const day = state.day;
  const dayMatches = matches.filter((m) => m.date === day).sort((a, b) => a.time.localeCompare(b.time));
  const own = dayMatches.filter((m) => !m.external_ref);
  const assigned = own.filter((m) => m.referee_id);
  const unpublished = assigned.filter((m) => !m.published);
  const missing = referees.filter((r) => r.active !== false && !availability.some((a) => a.referee_id === r.id && a.date === day));
  const refName = (id) => referees.find((r) => r.id === id)?.name || '?';

  view.innerHTML = `
    <div class="chips scroll">${days.map((d) => `<button class="chip ${d === day ? 'on' : ''} ${d < today ? 'past' : ''}" data-day="${d}">${fmtDate(d)}</button>`).join('')}</div>
    <section class="card">
      <h2>${fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
      <div class="stats">
        <div><b>${own.length}</b><span>te fluiten</span></div>
        <div><b>${assigned.length}</b><span>toegewezen</span></div>
        <div><b>${assigned.length - unpublished.length}</b><span>gepubliceerd</span></div>
      </div>
      <div class="actions">
        <button class="btn" id="propose">✨ Voorstel maken</button>
        <button class="btn primary" id="publish" ${unpublished.length ? '' : 'disabled'}>Publiceren (${unpublished.length})</button>
        <button class="btn ghost" id="export">⬇︎ Export</button>
      </div>
      ${missing.length ? `<details class="missing"><summary>${missing.length} scheidsrechter(s) nog niets ingevuld</summary>
        <p>${missing.map((r) => esc(r.name)).join(', ')}</p>
        ${missing.some((r) => r.email) ? `<a class="btn small" href="${remindLink(missing, day)}">✉️ Herinnering mailen</a>` : ''}
      </details>` : '<p class="muted">Iedereen heeft beschikbaarheid ingevuld.</p>'}
    </section>
    <div class="list">
      ${dayMatches.map((m) => {
        const avail = candidates(m, state.data).filter((c) => c.status === 'ok').length;
        let refHtml;
        if (m.external_ref) refHtml = '<span class="tag knvb">KNVB stelt aan</span>';
        else if (m.referee_id) refHtml = `<span class="tag ${m.published ? 'pub' : 'concept'}">${esc(refName(m.referee_id))} · ${m.published ? 'gepubliceerd' : 'concept'}</span>`;
        else refHtml = `<span class="tag open">Open · ${avail} beschikbaar</span>`;
        return `
          <article class="card match ${m.external_ref ? 'dim' : ''}">
            <div class="time">${esc(m.time)}<small>${fromMin(matchEnd(m) % 1440)}</small></div>
            <div class="body">
              <div class="teams">${esc(m.home)}${m.away ? ` – ${esc(m.away)}` : ''}</div>
              <div class="meta">${[m.field, m.category].filter(Boolean).map(esc).join(' · ')}</div>
              ${refHtml}
            </div>
            ${m.external_ref ? '' : `<button class="btn small" data-assign="${m.id}">${m.referee_id ? 'Wijzig' : 'Toewijzen'}</button>`}
          </article>`;
      }).join('')}
    </div>`;

  view.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => { state.day = b.dataset.day; render(); });
  view.querySelectorAll('[data-assign]').forEach((b) => b.onclick = () => assignSheet(b.dataset.assign));
  $('#propose').onclick = () => {
    const prop = proposeDay(day, state.data);
    if (!prop.length) return toast('Geen voorstel mogelijk: niemand (meer) beschikbaar voor open wedstrijden.');
    act(async () => {
      for (const p of prop) await store.updateMatches([p.matchId], { referee_id: p.refereeId, published: false });
    }, `${prop.length} wedstrijd(en) ingevuld als concept. Controleer en publiceer.`);
  };
  $('#publish').onclick = () => act(() => store.updateMatches(unpublished.map((m) => m.id), { published: true }),
    'Planning gepubliceerd. Scheidsrechters zien hun aanstelling nu in de app.');
  $('#export').onclick = () => exportDay(day, dayMatches, refName);
}

function remindLink(refs, day) {
  const bcc = refs.map((r) => r.email).filter(Boolean).join(',');
  const subject = `Beschikbaarheid ${fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}`;
  const body = `Hoi,\n\nWil je je beschikbaarheid voor ${fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' })} invullen in de scheidsrechtersapp?\n\n${location.origin + location.pathname}\n\nBedankt!`;
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
    <p class="muted">${[m.field, m.category].filter(Boolean).map(esc).join(' · ')}</p>
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
    el.querySelectorAll('[data-ref]').forEach((b) => b.onclick = () => {
      const c = list.find((x) => x.referee.id === b.dataset.ref);
      if (c.status === 'no' && !confirm(`${c.referee.name}: ${c.reasons.join(', ')}.\nToch toewijzen?`)) return;
      close();
      act(() => store.updateMatches([m.id], { referee_id: c.referee.id, published: false }), `${c.referee.name} toegewezen (concept).`);
    });
    const un = $('#unassign', el);
    if (un) un.onclick = () => { close(); act(() => store.updateMatches([m.id], { referee_id: null, published: false })); };
  });
}

// ---------- Planner: wedstrijden ----------
function wedstrijden(view) {
  const today = todayISO();
  const showPast = state.showPast;
  const list = state.data.matches.filter((m) => showPast || m.date >= today)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const byDay = {};
  list.forEach((m) => (byDay[m.date] ||= []).push(m));
  view.innerHTML = `
    <div class="actions top">
      <button class="btn primary" id="add-match">＋ Wedstrijd</button>
      <button class="btn" id="import">📥 CSV importeren</button>
      <label class="toggle"><input type="checkbox" id="past" ${showPast ? 'checked' : ''}> Ook verleden</label>
    </div>
    ${Object.entries(byDay).map(([d, ms]) => `
      <h3 class="day">${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
      ${ms.map((m) => `
        <article class="card match tap" data-edit="${m.id}">
          <div class="time">${esc(m.time)}</div>
          <div class="body">
            <div class="teams">${esc(m.home)}${m.away ? ` – ${esc(m.away)}` : ''}</div>
            <div class="meta">${[m.field, m.category, m.external_ref ? 'KNVB' : ''].filter(Boolean).map(esc).join(' · ')}</div>
          </div>
        </article>`).join('')}`).join('') || '<section class="card empty"><p>Geen komende wedstrijden.</p></section>'}`;
  $('#add-match').onclick = () => matchForm({ date: state.day || today, time: '10:00', duration: 60 });
  $('#import').onclick = importSheet;
  $('#past').onchange = (e) => { state.showPast = e.target.checked; render(); };
  view.querySelectorAll('[data-edit]').forEach((el) => el.onclick = () =>
    matchForm(state.data.matches.find((m) => m.id === el.dataset.edit)));
}

function matchForm(m) {
  sheet(`
    <h3>${m.id ? 'Wedstrijd bewerken' : 'Nieuwe wedstrijd'}</h3>
    <form id="mf" class="form">
      <div class="row"><label>Datum<input type="date" name="date" required value="${esc(m.date)}"></label>
        <label>Aanvang<input type="time" name="time" required value="${esc(m.time)}"></label></div>
      <label>Thuis<input name="home" required value="${esc(m.home)}" placeholder="MVC JO11-1"></label>
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
    const del = $('#del', el);
    if (del) del.onclick = () => { if (confirm('Wedstrijd verwijderen?')) { close(); act(() => store.deleteMatch(m.id), 'Verwijderd'); } };
  });
}

function importSheet() {
  sheet(`
    <h3>Wedstrijden importeren</h3>
    <p class="muted">CSV uit Sportlink of Excel (opslaan als CSV). Kolommen: <b>datum, tijd, thuis</b>, optioneel <b>uit, veld, categorie</b>.</p>
    <input type="file" id="csvfile" accept=".csv,text/csv">
    <textarea id="csvtext" rows="6" placeholder="datum;tijd;thuis;uit;veld;categorie&#10;12-10-2026;09:00;MVC JO11-1;DOS JO11-2;Veld 1;JO11"></textarea>
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
            <div class="meta">${r.user_id || store.mode === 'demo' && r.email ? '📱 account' : 'geen account'}${(r.pref_categories || []).length ? ' · graag ' + esc(r.pref_categories.join(', ')) : ''}</div></div>
          <div class="count">${counts[r.id] || 0}<small>${season}</small></div>
        </article>`).join('') || '<section class="card empty"><p>Nog geen scheidsrechters.</p></section>'}
    </div>
    ${store.mode === 'cloud' ? '<p class="muted pad">Scheidsrechters met een e-mailadres worden automatisch gekoppeld zodra ze voor het eerst inloggen.</p>' : ''}`;
  $('#add-ref').onclick = () => refForm({ name: '', email: '', active: true, pref_categories: [], avoid_categories: [] });
  $('#export-season').onclick = () => {
    const rows = [['Scheidsrechter', `Wedstrijden ${season}`]];
    state.data.referees.forEach((r) => rows.push([r.name, counts[r.id] || 0]));
    download(`seizoen-${season.replace('/', '-')}.csv`, '﻿' + toCSV(rows), 'text/csv');
  };
  view.querySelectorAll('[data-edit]').forEach((el) => el.onclick = () => refForm(state.data.referees.find((r) => r.id === el.dataset.edit)));
}

const initials = (n) => n.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

function refForm(r) {
  sheet(`
    <h3>${r.id ? 'Scheidsrechter bewerken' : 'Nieuwe scheidsrechter'}</h3>
    <form id="rf" class="form">
      <label>Naam<input name="name" required value="${esc(r.name)}"></label>
      <label>E-mail <small class="muted">(nodig om in te loggen)</small><input type="email" name="email" value="${esc(r.email)}"></label>
      <label class="check"><input type="checkbox" name="active" ${r.active !== false ? 'checked' : ''}> Actief</label>
      <button class="btn primary block">Opslaan</button>
      ${r.id ? '<button type="button" class="btn danger block" id="del">Verwijderen</button>' : ''}
    </form>`, (el, close) => {
    $('#rf', el).onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const row = { name: f.name.trim(), email: f.email.trim() || null, active: !!f.active };
      if (r.id) row.id = r.id;
      close();
      act(() => store.saveReferee(row), 'Opgeslagen');
    };
    const del = $('#del', el);
    if (del) del.onclick = () => { if (confirm(`${r.name} verwijderen?`)) { close(); act(() => store.deleteReferee(r.id), 'Verwijderd'); } };
  });
}

// ---------- Referee: mijn wedstrijden ----------
function mijn(view) {
  const me = store.user.referee_id;
  const today = todayISO();
  const mine = state.data.matches.filter((m) => m.referee_id === me && m.published)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const upcoming = mine.filter((m) => m.date >= today);
  const { start, end, label } = seasonOf(today);
  const season = mine.filter((m) => m.date >= start && m.date <= end && m.date < today);
  const perCat = {};
  season.forEach((m) => { perCat[m.category || 'Overig'] = (perCat[m.category || 'Overig'] || 0) + 1; });
  const todo = availabilityDates(state.data.matches).filter((d) => !state.data.availability.some((a) => a.referee_id === me && a.date === d));

  view.innerHTML = `
    <h2 class="hello">Hoi ${esc(store.user.name.split(' ')[0])}</h2>
    ${!me ? '<section class="card warn">Je account is nog niet gekoppeld aan een scheidsrechter. Vraag de planner om je e-mailadres toe te voegen.</section>' : ''}
    ${todo.length ? `<a class="card warn tap block" href="#/beschikbaarheid">📅 Vul je beschikbaarheid in voor ${todo.length} dag(en) →</a>` : ''}
    <h3 class="day">Komende wedstrijden</h3>
    ${upcoming.map((m) => `
      <article class="card match">
        <div class="time">${esc(m.time)}<small>${fmtDate(m.date)}</small></div>
        <div class="body"><div class="teams">${esc(m.home)}${m.away ? ` – ${esc(m.away)}` : ''}</div>
          <div class="meta">${[m.field, m.category].filter(Boolean).map(esc).join(' · ')}</div></div>
        <button class="btn small ghost" data-ics="${m.id}" title="Zet in agenda">📆</button>
      </article>`).join('') || '<section class="card empty"><p>Nog geen gepubliceerde aanstellingen.</p></section>'}
    <h3 class="day">Seizoen ${label}</h3>
    <section class="card">
      <div class="stats"><div><b>${season.length}</b><span>gefloten</span></div><div><b>${upcoming.length}</b><span>gepland</span></div></div>
      ${Object.keys(perCat).length ? `<p class="muted">${Object.entries(perCat).map(([c, n]) => `${esc(c)}: ${n}`).join(' · ')}</p>` : ''}
    </section>`;
  view.querySelectorAll('[data-ics]').forEach((b) => b.onclick = () => {
    const m = state.data.matches.find((x) => x.id === b.dataset.ics);
    download(`wedstrijd-${m.date}.ics`, ics(m), 'text/calendar');
  });
}

function ics(m) {
  const dt = (date, min) => `${date.replace(/-/g, '')}T${fromMin(min).replace(':', '')}00`;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//scheidsapp//NL', 'BEGIN:VEVENT',
    `UID:${m.id}@scheidsapp`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;TZID=Europe/Amsterdam:${dt(m.date, Math.max(0, toMin(m.time) - 30))}`,
    `DTEND;TZID=Europe/Amsterdam:${dt(m.date, Math.min(1439, matchEnd(m)))}`,
    `SUMMARY:Fluiten: ${m.home}${m.away ? ' - ' + m.away : ''}`,
    `LOCATION:${CLUB_NAME}${m.field ? ', ' + m.field : ''}`,
    `DESCRIPTION:Aanvang ${m.time} (30 min van tevoren aanwezig)`,
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
    card.querySelectorAll('[data-set]').forEach((b) => b.onclick = () => {
      const yes = b.dataset.set === 'yes';
      if (!yes && state.data.matches.some((m) => m.date === d && m.referee_id === me)
        && !confirm('Je bent die dag al aangesteld. Toch afmelden? Neem ook contact op met de planner.')) return;
      const row = { ...base(), available: yes };
      saveAv(row);
    });
    card.querySelectorAll('[data-f]').forEach((inp) => inp.onchange = () => {
      const row = { ...base(), [inp.dataset.f]: inp.dataset.f === 'max_matches' ? (Number(inp.value) || null) : inp.value };
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
    ${ref ? `
    <section class="card">
      <h3>Wat fluit je graag?</h3>
      <p class="muted">Tik om te wisselen: <span class="tag pub">graag</span> <span class="tag concept">liever niet</span>. De planner houdt hier rekening mee.</p>
      <div class="chips wrap">${CATEGORIES.map((c) => {
        const s = (ref.pref_categories || []).includes(c) ? 'like' : (ref.avoid_categories || []).includes(c) ? 'avoid' : '';
        return `<button class="chip ${s}" data-cat="${c}">${c}</button>`;
      }).join('')}</div>
    </section>` : ''}
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
  $('#pf').onsubmit = (e) => { e.preventDefault(); act(() => store.updateProfile({ name: new FormData(e.target).get('name').trim() }), 'Opgeslagen'); };
  view.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => {
    const c = b.dataset.cat;
    const like = new Set(ref.pref_categories || []), avoid = new Set(ref.avoid_categories || []);
    if (like.has(c)) { like.delete(c); avoid.add(c); } else if (avoid.has(c)) avoid.delete(c); else like.add(c);
    ref.pref_categories = [...like]; ref.avoid_categories = [...avoid];
    render();
    act(() => store.saveReferee({ id: ref.id, pref_categories: ref.pref_categories, avoid_categories: ref.avoid_categories }));
  });
  const inst = $('#install');
  if (inst) inst.onclick = async () => { state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; render(); };
  $('#logout').onclick = () => act(() => store.signOut());
  const reset = $('#reset');
  if (reset) reset.onclick = () => { if (confirm('Alle demo-gegevens terugzetten?')) act(() => store.resetDemo(), 'Demo hersteld'); };
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

boot();
