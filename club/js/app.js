// Clubapp V.V. Elspeet: schermen en navigatie. Geen build-stap, gewone ES-modules.
import * as api from './api.js';
import { SITE, CAT_VERSLAGEN, INSTAGRAM } from './config.js';

const $view = document.getElementById('view');
const $sheet = document.getElementById('sheet');
const $back = document.getElementById('back');

// ---------- Hulpjes ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const DAYS_LONG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MONTHS_LONG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

const toDate = (d, t = '00:00') => new Date(`${d}T${t}:00`);
const short = (d) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
const long = (d) => `${DAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
const postDate = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`; };
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

function untilText(d) {
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const days = Math.round((day - startOfToday()) / 864e5);
  if (days <= 0) return 'Vandaag';
  if (days === 1) return 'Morgen';
  return `Over ${days} dagen`;
}

const store = {
  get(k, def) { try { return JSON.parse(localStorage.getItem(`vve.${k}`)) ?? def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem(`vve.${k}`, JSON.stringify(v)); } catch { /* privé-venster */ } },
};
const favorites = () => store.get('fav', []);
const isFav = (name) => favorites().includes(name);
function toggleFav(name) {
  const f = favorites();
  store.set('fav', f.includes(name) ? f.filter((x) => x !== name) : [...f, name]);
}

const isOurs = (team) => /^elspeet\b/i.test(team);
const initials = (team) => team.replace(/^(sv|vv|v\.v\.|sp)\s+/i, '').replace(/['’]\d+/g, '').trim().slice(0, 2).toUpperCase();
const crest = (team) => isOurs(team)
  ? '<img class="crest" src="../icons/logo.png" alt="">'
  : `<span class="crest ghost" aria-hidden="true">${esc(initials(team))}</span>`;

function outcome(m) {
  if (!m.score) return null;
  const [h, a] = m.score.split('-').map(Number);
  const ourHome = isOurs(m.home);
  const us = ourHome ? h : a; const them = ourHome ? a : h;
  return us > them ? ['W', 'Gewonnen', 'win'] : us < them ? ['V', 'Verloren', 'loss'] : ['G', 'Gelijk', 'draw'];
}

const homeAway = (m) => (isOurs(m.home) ? 'Thuis' : 'Uit');

function setTitle(t) { document.title = t ? `${t} · VV Elspeet` : 'VV Elspeet'; }
function loading() { return '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton short"></div>'; }
function errorBox(msg = 'Dit kon niet geladen worden. Controleer je verbinding.') {
  return `<p class="note warn">${esc(msg)}</p>`;
}

// ---------- Kalender (.ics) ----------

function icsDownload({ title, start, minutes = 105, location = '', description = '' }) {
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  const end = new Date(start.getTime() + minutes * 6e4);
  const clean = (s) => String(s).replace(/[,;\\]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const body = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VV Elspeet//Clubapp//NL', 'BEGIN:VEVENT',
    `UID:${fmt(start)}-${title.replace(/\W+/g, '')}@vv-elspeet`, `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`, `SUMMARY:${clean(title)}`,
    location && `LOCATION:${clean(location)}`, description && `DESCRIPTION:${clean(description)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
  a.download = `${title.replace(/[^\w-]+/g, '-').toLowerCase()}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Bouwstenen ----------

function matchRow(m, { showDate = false } = {}) {
  const o = outcome(m);
  const d = toDate(m.date, m.time);
  return `<button class="match" type="button" data-match="${esc(m.date + m.time + m.home)}">
    <span class="m-when">${showDate ? `<small>${short(d)}</small>` : ''}<b>${esc(m.time)}</b></span>
    <span class="m-teams">
      <span class="${isOurs(m.home) ? 'ours' : ''}">${esc(m.home)}</span>
      <span class="${isOurs(m.away) ? 'ours' : ''}">${esc(m.away)}</span>
    </span>
    ${m.score
      ? `<span class="m-score ${o[2]}"><b>${esc(m.score.replace('-', '–'))}</b><small>${o[0]}</small></span>`
      : `<span class="m-meta"><small>${esc(m.field || homeAway(m))}</small>${m.type !== 'Competitie' ? `<span class="tag">${esc(m.type)}</span>` : ''}</span>`}
  </button>`;
}

function groupByDate(list, desc = false) {
  const by = new Map();
  for (const m of [...list].sort((a, b) => (desc ? -1 : 1) * ((a.date + a.time).localeCompare(b.date + b.time)))) {
    if (!by.has(m.date)) by.set(m.date, []);
    by.get(m.date).push(m);
  }
  return [...by].map(([date, ms]) => `<h3 class="daykop">${long(toDate(date))}</h3><div class="card list">${ms.map((m) => matchRow(m)).join('')}</div>`).join('');
}

function bigMatch(m, label) {
  const d = toDate(m.date, m.time);
  const o = outcome(m);
  return `<article class="hero-match">
    <div class="hm-kop"><span>${esc(label)}</span>${o ? `<span class="tag ${o[2]}">${o[1]}</span>` : `<span class="tag geel">${untilText(d)}</span>`}</div>
    <div class="hm-body">
      <div class="hm-team">${crest(m.home)}<b>${esc(m.home)}</b></div>
      <div class="hm-mid">${o ? `<b class="hm-score">${esc(m.score.replace('-', '–'))}</b>` : `<b class="hm-time">${esc(m.time)}</b>`}<small>${short(d)}</small></div>
      <div class="hm-team">${crest(m.away)}<b>${esc(m.away)}</b></div>
    </div>
    <div class="hm-voet"><span>${esc(homeAway(m))}${m.field ? ` · ${esc(m.field)}` : ''} · ${esc(m.type)}</span>
      ${o ? '' : `<button class="link" type="button" data-ics="${esc(m.date + m.time + m.home)}">＋ In agenda</button>`}</div>
  </article>`;
}

function postCard(p, { big = false } = {}) {
  return `<a class="post ${big ? 'big' : ''}" href="#/bericht/${p.id}">
    ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : '<div class="post-noimg"><img src="../icons/logo.png" alt=""></div>'}
    <span class="post-txt"><small>${postDate(p.date)}</small><b>${esc(p.title)}</b>${big ? `<span class="muted clamp">${esc(p.excerpt)}</span>` : ''}</span>
  </a>`;
}

async function fillPosts(el, opts, { empty = 'Nog geen berichten.', big = false } = {}) {
  try {
    const list = await api.posts(opts);
    el.innerHTML = list.length ? list.map((p, i) => postCard(p, { big: big && i === 0 })).join('') : `<p class="muted">${esc(empty)}</p>`;
    return list;
  } catch {
    el.innerHTML = errorBox('Berichten konden niet geladen worden van de clubsite.');
    return [];
  }
}

function standTable(rows, highlight = 'Elspeet 1') {
  return `<div class="card table-wrap"><table class="stand">
    <thead><tr><th>#</th><th class="l">Team</th><th>G</th><th>W</th><th>GL</th><th>V</th><th>DS</th><th>P</th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="${r.team === highlight ? 'me' : ''}"><td>${r.pos}</td><td class="l">${esc(r.team)}</td><td>${r.g}</td><td>${r.w}</td><td>${r.gl}</td><td>${r.v}</td><td>${r.ds > 0 ? '+' : ''}${r.ds}</td><td><b>${r.p}</b></td></tr>`).join('')}</tbody>
  </table></div>`;
}

const chips = (items, active, attr) => `<div class="chips" role="tablist">${items.map(([val, label]) =>
  `<button type="button" class="chip ${val === active ? 'on' : ''}" ${attr}="${esc(val)}" aria-selected="${val === active}">${esc(label)}</button>`).join('')}</div>`;

const section = (title, more = '', moreLabel = 'Alles') =>
  `<div class="blokkop"><h2>${esc(title)}</h2>${more ? `<a href="${more}">${esc(moreLabel)} →</a>` : ''}</div>`;

function sourceNote(data) {
  if (data.source === 'live') return '';
  const d = new Date(data.updated);
  return `<p class="note">Prototype: programma en uitslagen zijn een momentopname van ${short(d)}. Live gegevens komen via Sportlink zodra de koppeling op de site staat.</p>`;
}

// ---------- Schermen ----------

async function viewHome() {
  setTitle('');
  const data = await api.clubData();
  const now = new Date();
  const upcoming = data.matches.filter((m) => !m.score && toDate(m.date, m.time) >= startOfToday()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const played = data.matches.filter((m) => m.score).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const next1 = upcoming.find((m) => m.team === 'Elspeet 1');
  const last1 = played.find((m) => m.team === 'Elspeet 1');
  const favs = favorites().filter((f) => f !== 'Elspeet 1');
  const favCards = favs.map((f) => {
    const m = upcoming.find((x) => x.team === f) || played.find((x) => x.team === f);
    return m ? `<div class="card list"><div class="row-kop"><b>★ ${esc(f)}</b><a href="#/teams/${esc(slugOf(data, f))}">Team →</a></div>${matchRow(m, { showDate: true })}</div>` : '';
  }).join('');
  const agenda = data.agenda.filter((a) => toDate(a.date, a.time) >= now).slice(0, 2);
  const logos = [...data.sponsors.logos].sort(() => Math.random() - 0.5).slice(0, 8);

  $view.innerHTML = `
    <section class="welkom">
      <h1>Samen voetballen<br>op de Heide.</h1>
      <p>Van kabouters tot veteranen: bij V.V. Elspeet speelt het hele dorp.</p>
    </section>
    ${next1 ? bigMatch(next1, 'Volgende wedstrijd · Elspeet 1') : ''}
    ${last1 ? `<a class="result-strip" href="#/elspeet-1">${(() => { const o = outcome(last1); return `<span class="tag ${o[2]}">${o[1]}</span><span>${esc(last1.home)} <b>${esc(last1.score.replace('-', '–'))}</b> ${esc(last1.away)}</span><span class="muted">Elspeet 1 →</span>`; })()}</a>` : ''}
    <div class="tiles">
      <a href="#/programma">▦<b>Programma</b><small>Deze week</small></a>
      <a href="#/uitslagen">✓<b>Uitslagen</b><small>Scores en stand</small></a>
      <a href="#/verslagen">✎<b>Verslagen</b><small>Van het veld</small></a>
      <a href="#/agenda">◷<b>Agenda</b><small>Activiteiten</small></a>
    </div>
    ${favCards ? section('Mijn teams', '#/teams', 'Wijzigen') + favCards : `<a class="card hint" href="#/teams"><b>☆ Volg je eigen team</b><span class="muted">Kies een team en zie hier direct de volgende wedstrijd.</span></a>`}
    ${section('Nieuws', '#/nieuws')}
    <div class="posts" id="home-news">${loading()}</div>
    ${agenda.length ? section('Agenda', '#/agenda') + `<div class="card list">${agenda.map(agendaRow).join('')}</div>` : ''}
    ${section('Onze sponsors', '#/sponsoren')}
    <div class="logo-strip">${logos.map((l) => `<img src="${esc(data.sponsors.logoBase + l)}" alt="" loading="lazy">`).join('')}</div>
    ${sourceNote(data)}`;
  fillPosts(document.getElementById('home-news'), { perPage: 3 });
}

function slugOf(data, name) { return data.teams.find((t) => t.name === name)?.slug || ''; }

const GROUPS = [['', 'Alle'], ['Senioren', 'Senioren'], ['Junioren', 'Junioren'], ['Pupillen', 'Pupillen']];

async function viewProgramma(mode = 'programma') {
  setTitle(mode === 'uitslagen' ? 'Uitslagen' : 'Programma');
  const data = await api.clubData();
  const group = store.get('group', '');
  const list = data.matches.filter((m) => (!group || m.group === group) && (mode === 'uitslagen' ? m.score : !m.score && toDate(m.date) >= startOfToday()));
  const af = data.cancelled?.length ? `<p class="note warn"><b>Afgelast:</b> ${data.cancelled.map(esc).join(', ')}</p>` : '';
  $view.innerHTML = `
    <h1 class="paginakop">Wedstrijden</h1>
    <div class="seg"><a href="#/programma" class="${mode === 'programma' ? 'on' : ''}">Programma</a><a href="#/uitslagen" class="${mode === 'uitslagen' ? 'on' : ''}">Uitslagen</a></div>
    ${chips(GROUPS, group, 'data-group')}
    ${af}
    ${list.length ? groupByDate(list, mode === 'uitslagen') : `<p class="muted pad">Geen wedstrijden gevonden.</p>`}
    ${mode === 'uitslagen' && data.standings['Elspeet 1'] ? section('Stand Elspeet 1', '#/elspeet-1', 'Elspeet 1') + standTable(data.standings['Elspeet 1']) : ''}
    <p class="muted small">Co = competitie · Be = beker · Oe = oefenwedstrijd. Tik op een wedstrijd voor details.</p>
    ${sourceNote(data)}`;
}

async function viewNieuws(cat = '') {
  const isVerslagen = cat === CAT_VERSLAGEN;
  setTitle(isVerslagen ? 'Wedstrijdverslagen' : 'Nieuws');
  $view.innerHTML = `
    <h1 class="paginakop">${isVerslagen ? 'Wedstrijdverslagen' : 'Nieuws'}</h1>
    <p class="lead">${isVerslagen ? 'De laatste verhalen van het veld.' : 'Verslagen, clubnieuws en aankondigingen.'}</p>
    <div id="cats"></div>
    <div class="posts" id="list">${loading()}</div>
    <button class="btn ghost wide" id="more" type="button" hidden>Meer berichten</button>`;
  api.categories().then((cats) => {
    const items = [['', 'Alles'], ...cats.filter((c) => c.count > 0).map((c) => [c.slug, c.name])];
    document.getElementById('cats').innerHTML = chips(items, cat, 'data-cat');
  }).catch(() => {});
  let page = 1;
  const listEl = document.getElementById('list');
  const moreBtn = document.getElementById('more');
  const first = await fillPosts(listEl, { category: cat, perPage: 10 }, { big: true });
  moreBtn.hidden = first.length < 10;
  moreBtn.onclick = async () => {
    page += 1; moreBtn.disabled = true;
    try {
      const next = await api.posts({ category: cat, page, perPage: 10 });
      listEl.insertAdjacentHTML('beforeend', next.map((p) => postCard(p)).join(''));
      moreBtn.hidden = next.length < 10;
    } catch { moreBtn.hidden = true; }
    moreBtn.disabled = false;
  };
}

async function viewBericht(id) {
  $view.innerHTML = loading();
  try {
    const [p, cats] = await Promise.all([api.post(id), api.categories().catch(() => [])]);
    setTitle(p.title);
    const labels = cats.filter((c) => p.categories.includes(c.id));
    $view.innerHTML = `<article class="artikel">
      ${p.image ? `<img class="art-img" src="${esc(p.image)}" alt="">` : ''}
      <div class="art-meta">${labels.map((c) => `<a class="tag" href="#/nieuws/${esc(c.slug)}">${esc(c.name)}</a>`).join('')}<small>${postDate(p.date)}</small></div>
      <h1>${esc(p.title)}</h1>
      <div class="prose">${api.cleanHtml(p.html)}</div>
      <div class="art-acties">
        <button class="btn" type="button" data-share="${esc(p.link)}" data-title="${esc(p.title)}">Delen</button>
        <a class="btn ghost" href="${esc(p.link)}" target="_blank" rel="noopener">Op de website</a>
      </div>
    </article>`;
  } catch {
    $view.innerHTML = errorBox('Dit bericht kon niet geladen worden.');
  }
}

async function viewMedia() {
  setTitle('Media');
  $view.innerHTML = `
    <h1 class="paginakop">Media</h1>
    <p class="lead">Wedstrijdverslagen, foto's en video's van V.V. Elspeet.</p>
    <a class="card insta" href="https://www.instagram.com/${INSTAGRAM}/" target="_blank" rel="noopener">
      <span class="insta-logo" aria-hidden="true">◎</span>
      <span><b>@${INSTAGRAM}</b><small>Wedstrijddagen, de pupil van de week en het leven rond het sportpark.</small></span>
      <span class="btn small">Volg</span>
    </a>
    ${section("Foto's")}
    <div class="grid" id="photos">${loading()}</div>
    ${section('Wedstrijdverslagen', '#/verslagen')}
    <div class="posts" id="verslagen">${loading()}</div>
    <a class="card hint" href="#/pagina/verzoek-mediateam"><b>Foto's of een verslag nodig?</b><span class="muted">Doe een aanvraag bij het web- en mediateam.</span></a>`;
  fillPosts(document.getElementById('verslagen'), { category: CAT_VERSLAGEN, perPage: 3 });
  const el = document.getElementById('photos');
  try {
    const list = await api.photos({ perPage: 24 });
    el.innerHTML = list.length
      ? list.map((ph) => `<button type="button" class="ph" data-photo="${esc(ph.full)}" data-alt="${esc(ph.alt)}"><img src="${esc(ph.thumb)}" alt="${esc(ph.alt)}" loading="lazy"></button>`).join('')
      : '<p class="muted">Nog geen foto\'s.</p>';
  } catch {
    el.innerHTML = errorBox("Foto's konden niet geladen worden.");
  }
}

async function viewTeams() {
  setTitle('Teams');
  const data = await api.clubData();
  const favs = favorites();
  const block = (g) => `<h3 class="daykop">${g}</h3><div class="card list">${data.teams.filter((t) => t.group === g).map((t) => `
    <div class="team-row">
      <a href="#/teams/${esc(t.slug)}"><b>${esc(t.name)}</b><small>${esc(t.info)}</small></a>
      <button type="button" class="star ${favs.includes(t.name) ? 'on' : ''}" data-fav="${esc(t.name)}" aria-label="${favs.includes(t.name) ? 'Niet meer volgen' : 'Volgen'}: ${esc(t.name)}">${favs.includes(t.name) ? '★' : '☆'}</button>
    </div>`).join('')}</div>`;
  $view.innerHTML = `
    <h1 class="paginakop">Teams</h1>
    <p class="lead">Van kabouters tot 45+. Tik op ☆ om een team te volgen.</p>
    ${['Senioren', 'Junioren', 'Pupillen'].map(block).join('')}`;
}

async function viewTeam(slug) {
  const data = await api.clubData();
  const t = data.teams.find((x) => x.slug === slug);
  if (!t) { $view.innerHTML = errorBox('Team niet gevonden.'); return; }
  if (t.name === 'Elspeet 1') { location.replace('#/elspeet-1'); return; }
  setTitle(t.name);
  const ms = data.matches.filter((m) => m.team === t.name);
  const up = ms.filter((m) => !m.score).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const res = ms.filter((m) => m.score).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const fav = isFav(t.name);
  $view.innerHTML = `
    <section class="team-kop">
      <img src="../icons/logo.png" alt="">
      <div><small>${esc(t.group)}</small><h1>${esc(t.name)}</h1><span class="muted">${esc(t.info)}</span></div>
    </section>
    <button type="button" class="btn ${fav ? 'ghost' : ''} wide" data-fav="${esc(t.name)}">${fav ? '★ Je volgt dit team' : '☆ Volg dit team'}</button>
    ${section('Programma')}
    ${up.length ? `<div class="card list">${up.map((m) => matchRow(m, { showDate: true })).join('')}</div>` : '<p class="muted pad">Geen wedstrijden gepland.</p>'}
    ${section('Laatste uitslagen')}
    ${res.length ? `<div class="card list">${res.map((m) => matchRow(m, { showDate: true })).join('')}</div>` : '<p class="muted pad">Nog geen uitslagen.</p>'}
    ${data.standings[t.name] ? section('Stand') + standTable(data.standings[t.name], t.name) : ''}
    <div id="team-news"></div>
    ${sourceNote(data)}`;
  const cat = await api.categoryBySlug(slug).catch(() => null);
  if (cat?.count) {
    const el = document.getElementById('team-news');
    el.innerHTML = section('Nieuws en verslagen', `#/nieuws/${slug}`) + `<div class="posts">${loading()}</div>`;
    fillPosts(el.querySelector('.posts'), { category: slug, perPage: 3 });
  }
}

async function viewElspeet1() {
  setTitle('Elspeet 1');
  const data = await api.clubData();
  const e1 = data.elspeet1;
  const ms = data.matches.filter((m) => m.team === 'Elspeet 1');
  const next = ms.filter((m) => !m.score && toDate(m.date, m.time) >= startOfToday()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const res = ms.filter((m) => m.score).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const form = res.slice(0, 5).map(outcome).map((o) => `<span class="vorm ${o[2]}" title="${o[1]}">${o[0]}</span>`).join('');
  const fav = isFav('Elspeet 1');
  const rank = data.standings['Elspeet 1']?.find((r) => r.team === 'Elspeet 1');
  $view.innerHTML = `
    <section class="vlag">
      <small>Het eerste elftal</small>
      <h1>Elspeet 1</h1>
      <p>Het vlaggenschip van de vereniging.</p>
      <div class="vlag-stats">
        ${rank ? `<span><b>${rank.pos}e</b><small>in de stand</small></span><span><b>${rank.p}</b><small>punten</small></span>` : ''}
        <span><b class="vorm-rij">${form}</b><small>vorm</small></span>
      </div>
    </section>
    <button type="button" class="btn ${fav ? 'ghost' : ''} wide" data-fav="Elspeet 1">${fav ? '★ Je volgt Elspeet 1' : '☆ Volg Elspeet 1'}</button>
    ${next[0] ? bigMatch(next[0], 'Volgende wedstrijd') : ''}
    ${next.length > 1 ? `<div class="card list">${next.slice(1).map((m) => matchRow(m, { showDate: true })).join('')}</div>` : ''}
    ${data.standings['Elspeet 1'] ? section('Stand') + standTable(data.standings['Elspeet 1']) : ''}
    ${section('Uitslagen')}
    <div class="card list">${res.map((m) => matchRow(m, { showDate: true })).join('')}</div>
    ${section('Wedstrijdverslagen', '#/nieuws/elspeet-1')}
    <div class="posts" id="e1-news">${loading()}</div>
    ${section('Over het team')}
    <div class="card pad-l">${e1.intro.map((p) => `<p>${esc(p)}</p>`).join('')}
      <dl class="feiten">${e1.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>
    ${section('Technische staf')}
    <div class="card list">${e1.staff.map(([rol, naam]) => `<div class="kv"><span class="muted">${esc(rol)}</span><b>${esc(naam)}</b></div>`).join('')}</div>
    ${sourceNote(data)}`;
  fillPosts(document.getElementById('e1-news'), { category: 'elspeet-1', perPage: 3 });
}

async function viewClub() {
  setTitle('Over de club');
  const data = await api.clubData();
  const c = data.club;
  $view.innerHTML = `
    <h1 class="paginakop">Over de club</h1>
    <div class="stats"><span><b>1953</b><small>opgericht</small></span><span><b>${c.teams}</b><small>teams</small></span><span><b>${esc(c.members)}</b><small>leden</small></span></div>
    <div class="card pad-l">${c.about.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
    ${section('Clubinformatie')}
    <div class="card list">${c.pages.map(([label, slug]) => `<a class="nav-row" href="#/pagina/${esc(slug)}"><span>${esc(label)}</span><span aria-hidden="true">›</span></a>`).join('')}</div>
    <div class="cta-duo">
      <a class="card cta" href="#/pagina/lid-worden"><b>Word lid</b><small>Eerst drie keer gratis meetrainen.</small></a>
      <a class="card cta" href="#/contact"><b>Word vrijwilliger</b><small>Zonder vrijwilligers geen club.</small></a>
    </div>`;
}

async function viewPagina(slug) {
  $view.innerHTML = loading();
  try {
    const p = await api.page(slug);
    setTitle(p.title);
    // De meeste infopagina's komen nu uit het thema en hebben geen eigen inhoud in WordPress.
    // Tot het app-endpoint ze levert, verwijzen we naar de website.
    if (!api.text(p.html)) {
      $view.innerHTML = `<article class="artikel"><h1>${esc(p.title)}</h1>
        <div class="card hint"><b>Deze pagina staat op de website</b><span class="muted">In de volgende versie van de app lees je hem hier.</span></div>
        <div class="art-acties"><a class="btn" href="${esc(p.link)}" target="_blank" rel="noopener">Open ${esc(p.title)} →</a></div></article>`;
      return;
    }
    $view.innerHTML = `<article class="artikel"><h1>${esc(p.title)}</h1><div class="prose">${api.cleanHtml(p.html)}</div>
      <div class="art-acties"><a class="btn ghost" href="${esc(p.link)}" target="_blank" rel="noopener">Op de website</a></div></article>`;
  } catch {
    $view.innerHTML = errorBox('Deze pagina kon niet geladen worden.') + `<p class="pad"><a href="${SITE}/${esc(slug)}/" target="_blank" rel="noopener">Open op de website →</a></p>`;
  }
}

async function viewSponsoren() {
  setTitle('Sponsoren');
  const data = await api.clubData();
  const s = data.sponsors;
  $view.innerHTML = `
    <h1 class="paginakop">Sponsoren</h1>
    <p class="lead">Dankzij hen kan iedereen in Elspeet blijven voetballen.</p>
    <div class="logo-grid">${s.logos.map((l) => `<img src="${esc(s.logoBase + l)}" alt="" loading="lazy">`).join('')}</div>
    ${section('Word sponsor')}
    <div class="card list">${s.packages.map(([stars, name, txt]) => `<div class="pakket"><span class="sterren">${stars}</span><b>${esc(name)}</b><small class="muted">${esc(txt)}</small></div>`).join('')}</div>
    <a class="btn wide" href="mailto:${esc(data.club.sponsorEmail)}?subject=${encodeURIComponent('Sponsoring V.V. Elspeet')}">Mail de sponsorcommissie</a>`;
}

function agendaRow(a) {
  const d = toDate(a.date, a.time);
  return `<div class="agenda-row">
    <span class="datum"><b>${d.getDate()}</b><small>${MONTHS[d.getMonth()]}</small></span>
    <span class="ag-txt"><b>${esc(a.title)}</b><small>${DAYS_LONG[d.getDay()]} · ${esc(a.time)} uur</small></span>
    <button type="button" class="iconbtn small" data-agenda="${esc(a.date + a.title)}" aria-label="Zet ${esc(a.title)} in je agenda">＋</button>
  </div>`;
}

async function viewAgenda() {
  setTitle('Agenda');
  const data = await api.clubData();
  const list = data.agenda.filter((a) => toDate(a.date, a.time) >= startOfToday());
  $view.innerHTML = `
    <h1 class="paginakop">Agenda</h1>
    <p class="lead">Alle activiteiten naast het voetbal: van pubquiz tot jeugdtoernooi.</p>
    ${list.length ? `<div class="card list">${list.map(agendaRow).join('')}</div>` : '<p class="muted">Geen activiteiten gepland.</p>'}
    <a class="card hint" href="#/pagina/roosters"><b>Roosters</b><span class="muted">Kantinediensten, bestuurskamer en schoonmaak.</span></a>`;
}

async function viewContact() {
  setTitle('Contact');
  const c = (await api.clubData()).club;
  const maps = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('Uddelerweg 100, 8075 CK Elspeet')}`;
  $view.innerHTML = `
    <h1 class="paginakop">Contact</h1>
    <p class="lead">Kom langs op de Heide. Iedereen is welkom: om te kijken, mee te trainen of voor een kop koffie.</p>
    <div class="acties">
      <a class="actie" href="tel:${esc(c.phone.replace(/\D/g, ''))}">☎<span>Bellen</span></a>
      <a class="actie" href="mailto:${esc(c.email)}">✉<span>Mailen</span></a>
      <a class="actie" href="${maps}" target="_blank" rel="noopener">➤<span>Route</span></a>
      <a class="actie" href="https://www.instagram.com/${INSTAGRAM}/" target="_blank" rel="noopener">◎<span>Instagram</span></a>
    </div>
    <div class="card list">
      <div class="kv"><span class="muted">Adres</span><b>${esc(c.address)}</b></div>
      <div class="kv"><span class="muted">Kantine</span><b>${esc(c.phone)}</b></div>
      <div class="kv"><span class="muted">Open</span><b>${esc(c.canteen)}</b></div>
      <div class="kv"><span class="muted">Parkeren</span><b>${esc(c.parking)}</b></div>
      <div class="kv"><span class="muted">E-mail</span><b>${esc(c.email)}</b></div>
      <div class="kv"><span class="muted">Sponsoring</span><b>${esc(c.sponsorEmail)}</b></div>
      <div class="kv"><span class="muted">KNVB</span><b>Verenigingscode ${esc(c.knvbCode)}</b></div>
    </div>
    ${section('Stuur een bericht')}
    <form class="card form" id="contact">
      <label>Naam<input name="naam" required autocomplete="name"></label>
      <label>Bericht<textarea name="bericht" rows="4" required></textarea></label>
      <button class="btn wide" type="submit">Verstuur via e-mail</button>
    </form>`;
  document.getElementById('contact').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    location.href = `mailto:${c.email}?subject=${encodeURIComponent(`Bericht via de app van ${f.get('naam')}`)}&body=${encodeURIComponent(f.get('bericht'))}`;
  };
}

function viewMeer() {
  setTitle('Meer');
  const items = [
    ['#/elspeet-1', 'Elspeet 1', 'Selectie, stand en verslagen'],
    ['#/verslagen', 'Wedstrijdverslagen', 'De verhalen van het veld'],
    ['#/media', 'Media', "Foto's, video's en Instagram"],
    ['#/agenda', 'Agenda', 'Activiteiten van de club'],
    ['#/club', 'Over de club', 'Geschiedenis, bestuur en info'],
    ['#/sponsoren', 'Sponsoren', 'Onze partners en pakketten'],
    ['#/contact', 'Contact', 'Adres, kantine en route'],
  ];
  $view.innerHTML = `
    <h1 class="paginakop">Meer</h1>
    <div class="card list">${items.map(([h, t, s]) => `<a class="nav-row" href="${h}"><span><b>${t}</b><small>${s}</small></span><span aria-hidden="true">›</span></a>`).join('')}</div>
    <p class="muted small pad">Installeer de app: iPhone → Safari → Deel → Zet op beginscherm. Android → Chrome → ⋮ → App installeren.</p>`;
}

// ---------- Sheet (wedstrijddetails, foto's) ----------

function openSheet(html) {
  $sheet.innerHTML = `<div class="sheet-bg" data-close></div><div class="sheet-body" role="dialog" aria-modal="true"><button class="sheet-x" type="button" data-close aria-label="Sluiten">×</button>${html}</div>`;
  $sheet.hidden = false;
  document.body.classList.add('noscroll');
}
function closeSheet() { $sheet.hidden = true; $sheet.innerHTML = ''; document.body.classList.remove('noscroll'); }

async function findMatch(key) {
  return (await api.clubData()).matches.find((m) => m.date + m.time + m.home === key);
}

async function showMatch(key) {
  const data = await api.clubData();
  const m = await findMatch(key);
  if (!m) return;
  const slug = slugOf(data, m.team);
  openSheet(`${bigMatch(m, m.team)}
    <div class="list">
      <div class="kv"><span class="muted">Datum</span><b>${long(toDate(m.date))} · ${esc(m.time)}</b></div>
      <div class="kv"><span class="muted">Locatie</span><b>${esc(homeAway(m) === 'Thuis' ? `Op de Heide${m.field ? `, ${m.field}` : ''}` : m.field || 'Uit')}</b></div>
      ${m.referee ? `<div class="kv"><span class="muted">Scheidsrechter</span><b>${esc(m.referee)}</b></div>` : ''}
    </div>
    <div class="art-acties">
      ${!m.score ? `<button class="btn" type="button" data-ics="${esc(key)}">＋ In agenda</button>` : ''}
      ${slug ? `<a class="btn ghost" href="#/${m.team === 'Elspeet 1' ? 'elspeet-1' : `teams/${slug}`}">Naar ${esc(m.team)}</a>` : ''}
    </div>`);
}

// ---------- Router ----------

const routes = [
  [/^\/?$/, 'home', viewHome],
  [/^\/programma$/, 'programma', () => viewProgramma('programma')],
  [/^\/uitslagen$/, 'programma', () => viewProgramma('uitslagen')],
  [/^\/nieuws$/, 'nieuws', () => viewNieuws('')],
  [/^\/nieuws\/([\w-]+)$/, 'nieuws', (c) => viewNieuws(c)],
  [/^\/verslagen$/, 'meer', () => viewNieuws(CAT_VERSLAGEN)],
  [/^\/bericht\/(\d+)$/, 'nieuws', (id) => viewBericht(id), true],
  [/^\/media$/, 'meer', viewMedia],
  [/^\/teams$/, 'teams', viewTeams],
  [/^\/teams\/([\w-]+)$/, 'teams', (s) => viewTeam(s), true],
  [/^\/elspeet-1$/, 'meer', viewElspeet1],
  [/^\/club$/, 'meer', viewClub],
  [/^\/pagina\/([\w-]+)$/, 'meer', (s) => viewPagina(s), true],
  [/^\/sponsoren$/, 'meer', viewSponsoren],
  [/^\/agenda$/, 'meer', viewAgenda],
  [/^\/contact$/, 'meer', viewContact],
  [/^\/meer$/, 'meer', viewMeer],
];

let depth = 0;
async function route() {
  closeSheet();
  const path = location.hash.replace(/^#/, '') || '/';
  const hit = routes.find(([re]) => re.test(path)) || routes[0];
  const [re, tab, fn, detail] = hit;
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  // Terugknop op detailschermen en op alles wat onder "Meer" hangt.
  $back.hidden = path === '/meer' || !(detail || tab === 'meer');
  $view.classList.remove('in'); void $view.offsetWidth; $view.classList.add('in');
  window.scrollTo(0, 0);
  try {
    await fn(...(path.match(re) || []).slice(1));
  } catch (e) {
    console.error(e);
    $view.innerHTML = errorBox();
  }
}

window.addEventListener('hashchange', () => { depth += 1; route(); });
$back.addEventListener('click', () => (depth > 0 ? history.back() : (location.hash = '#/meer')));

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-match],[data-ics],[data-agenda],[data-fav],[data-group],[data-cat],[data-photo],[data-share],[data-close]');
  if (!t) return;
  if (t.dataset.close !== undefined) return closeSheet();
  if (t.dataset.ics) {
    const m = await findMatch(t.dataset.ics);
    if (m) icsDownload({ title: `${m.home} – ${m.away}`, start: toDate(m.date, m.time), location: isOurs(m.home) ? 'Sportpark Op de Heide, Uddelerweg 100, Elspeet' : m.field, description: m.type });
    return;
  }
  if (t.dataset.match) return showMatch(t.dataset.match);
  if (t.dataset.agenda) {
    const a = (await api.clubData()).agenda.find((x) => x.date + x.title === t.dataset.agenda);
    if (a) icsDownload({ title: `${a.title} · V.V. Elspeet`, start: toDate(a.date, a.time), minutes: 180, location: 'Sportpark Op de Heide, Uddelerweg 100, Elspeet' });
    return;
  }
  if (t.dataset.fav) { toggleFav(t.dataset.fav); return route(); }
  if (t.dataset.group !== undefined) { store.set('group', t.dataset.group); return route(); }
  if (t.dataset.cat !== undefined) { location.hash = t.dataset.cat ? `#/nieuws/${t.dataset.cat}` : '#/nieuws'; return; }
  if (t.dataset.photo) return openSheet(`<img class="foto-groot" src="${esc(t.dataset.photo)}" alt="${esc(t.dataset.alt)}">${t.dataset.alt ? `<p class="muted">${esc(t.dataset.alt)}</p>` : ''}`);
  if (t.dataset.share) {
    if (navigator.share) navigator.share({ title: t.dataset.title, url: t.dataset.share }).catch(() => {});
    else { navigator.clipboard?.writeText(t.dataset.share); t.textContent = 'Link gekopieerd'; }
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$sheet.hidden) closeSheet(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
route();
