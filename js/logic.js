// Pure planning logic: no DOM, no storage. Shared by the UI and the auto-proposal.

export const toMin = (t) => {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  return h * 60 + (m || 0);
};

export const fromMin = (n) =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

export const matchEnd = (m) => toMin(m.time) + (Number(m.duration) || 90);

// Two matches overlap when they are on the same day and their time ranges intersect,
// including a short buffer so a referee can move between fields.
export function overlaps(a, b, buffer = 15) {
  if (a.date !== b.date) return false;
  return toMin(a.time) < matchEnd(b) + buffer && toMin(b.time) < matchEnd(a) + buffer;
}

// Football season runs from 1 July to 30 June.
export function seasonOf(date) {
  const d = new Date(date + 'T12:00:00');
  const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  return { start: `${y}-07-01`, end: `${y + 1}-06-30`, label: `${y}/${String(y + 1).slice(2)}` };
}

export function seasonCounts(matches, date) {
  const { start, end } = seasonOf(date);
  const counts = {};
  for (const m of matches) {
    if (m.referee_id && m.date >= start && m.date <= end) counts[m.referee_id] = (counts[m.referee_id] || 0) + 1;
  }
  return counts;
}

/**
 * Rank referees for a match.
 * status: 'ok' (available, fits), 'unknown' (nothing filled in), 'no' (unavailable or conflict).
 */
export function candidates(match, { referees, availability, matches, offers = [] }) {
  const counts = seasonCounts(matches, match.date);
  const start = toMin(match.time);
  const end = matchEnd(match);

  return referees
    .filter((r) => r.active !== false && r.is_referee !== false)
    .map((r) => {
      const av = availability.find((a) => a.referee_id === r.id && a.date === match.date);
      const offered = offers.some((o) => o.match_id === match.id && o.referee_id === r.id);
      const sameDay = matches.filter((m) => m.id !== match.id && m.referee_id === r.id && m.date === match.date);
      const conflict = sameDay.find((m) => overlaps(m, match));
      const reasons = [];
      let status = 'ok';

      if (!av) {
        // Offering for this match counts as being available for it.
        status = offered ? 'ok' : 'unknown';
        if (!offered) reasons.push('Niets ingevuld');
      } else if (!av.available) {
        status = 'no';
        reasons.push('Niet beschikbaar');
      } else {
        if (av.start_time && toMin(av.start_time) > start) { status = 'no'; reasons.push(`Pas vanaf ${av.start_time}`); }
        if (av.end_time && toMin(av.end_time) < end) { status = 'no'; reasons.push(`Tot ${av.end_time}`); }
        if (av.times?.length && !av.times.includes(match.time)) { status = 'no'; reasons.push(`Kan niet om ${match.time}`); }
        if (av.max_matches && sameDay.length >= av.max_matches) { status = 'no'; reasons.push(`Max ${av.max_matches} per dag bereikt`); }
      }
      if (conflict) { status = 'no'; reasons.push(`Fluit al ${conflict.time} ${conflict.home}`); }

      const prefs = r.pref_categories || [];
      const avoid = r.avoid_categories || [];
      const likes = match.category && prefs.includes(match.category);
      const dislikes = match.category && avoid.includes(match.category);
      if (offered) reasons.unshift('Biedt zich aan');
      if (likes) reasons.push('Fluit dit graag');
      if (dislikes) reasons.push('Liever niet deze categorie');

      const statusRank = { ok: 0, unknown: 1, no: 2 }[status];
      const score = statusRank * 1000 - (offered ? 100 : 0) + (dislikes ? 50 : 0) - (likes ? 50 : 0) + (counts[r.id] || 0);
      return { referee: r, status, reasons, season: counts[r.id] || 0, day: sameDay.length, score, offered };
    })
    .sort((a, b) => a.score - b.score || a.referee.name.localeCompare(b.referee.name));
}

// JO7 plays four short matches on one Saturday at one club. hosting/sportlink-sync.php leaves out the
// mornings at another club and turns a home morning into one match with m.parts (one referee for all).
// isAwayJo7 only catches older loose JO7 rows from before that: no parts and no "Elspeet" in the field.
export const isAwayJo7 = (m) => m.category === 'O7' && !m.parts?.length && !!m.sportlink_code && !/elspeet/i.test(m.field || '');
// Does the club have to provide a referee? Not when the KNVB appoints one.
export const needsReferee = (m) => !m.external_ref;

// Greedy proposal for all unassigned matches on a day. Returns [{matchId, refereeId}].
export function proposeDay(date, data) {
  const working = data.matches.map((m) => ({ ...m }));
  const proposal = [];
  const todo = working.filter((m) => m.date === date && !m.referee_id && needsReferee(m))
    .sort((a, b) => toMin(a.time) - toMin(b.time));
  for (const m of todo) {
    const best = candidates(m, { ...data, matches: working }).find((c) => c.status === 'ok');
    if (best) {
      m.referee_id = best.referee.id;
      proposal.push({ matchId: m.id, refereeId: best.referee.id });
    }
  }
  return proposal;
}

// Dates a referee should fill in: Saturdays of the coming 4 weeks plus any day that has matches.
export function availabilityDates(matches, today = new Date(), weeks = 4) {
  const iso = (d) => d.toISOString().slice(0, 10);
  const set = new Set();
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const last = new Date(d);
  last.setUTCDate(last.getUTCDate() + weeks * 7);
  for (const x = new Date(d); x <= last; x.setUTCDate(x.getUTCDate() + 1)) {
    if (x.getUTCDay() === 6) set.add(iso(x));
  }
  for (const m of matches) if (m.date >= iso(d) && m.date <= iso(last)) set.add(m.date);
  return [...set].sort();
}

// Category from a team name in KNVB naming: "Elspeet O13-1JM" → O13, old "JO11-1" → O11, "VR1" → Vrouwen.
// Same rules as category_from_team() in hosting/sportlink-sync.php.
export function categoryFromTeam(team) {
  const t = String(team || '');
  const m = t.match(/\b[JM]?O\s?(\d{1,2})(?=-|\b|[A-Z])/i);
  if (m) return 'O' + Number(m[1]);
  if (/30\+/.test(t)) return 'VR30+';
  if (/\bVR\s?\d|vrouwen|dames/i.test(t)) return 'VR1';
  if (/4[05]\+/.test(t)) return '40+';
  if (/35\+|vet|VE\d/i.test(t)) return '35+';
  if (/7\s?[x×]\s?7/i.test(t)) return '7x7';
  // "Elspeet 2" or "Elspeet 2 (zon)" → 2e
  const n = t.match(/(\d+)\s*(?:\([^)]*\))?\s*$/);
  return (n ? Number(n[1]) : 1) + 'e';
}

// Categories before the split of seniors and women into teams. Matches get a category from their
// home team again; preferences become the whole group. Same mapping as the migration in schema.sql.
const LEGACY_PREFS = { Senioren: ['1e', '2e', '3e', '4e', '5e', '7x7'], Veteranen: ['35+', '40+'], Vrouwen: ['VR1', 'VR30+'], '45+': ['40+'] };
export function upgradeCategory(m) {
  return LEGACY_PREFS[m.category] ? categoryFromTeam(m.home) : m.category;
}
export function upgradePrefs(list) {
  if (!(list || []).some((c) => LEGACY_PREFS[c])) return list || [];
  return [...new Set(list.flatMap((c) => LEGACY_PREFS[c] || [c]))];
}

// Playing time incl. half-time break in minutes (KNVB match lengths). Same table as default_duration() in PHP.
export function defaultDuration(category) {
  const m = String(category || '').match(/^[JM]?O(\d{1,2})$/);
  if (m) {
    const age = Number(m[1]);
    return age <= 9 ? 45 : age <= 11 ? 55 : age <= 13 ? 65 : age <= 15 ? 75 : age <= 17 ? 85 : 105;
  }
  if (category === '7x7') return 60;
  return ['35+', '40+', 'VR30+'].includes(category) ? 80 : 105;
}

// "Veld 1-hoofdveld" → "Veld 1". Same rule as clean_field() in hosting/sportlink-sync.php.
export function fieldName(field) {
  const s = String(field || '').trim();
  const short = s.replace(/\s*[-–]?\s*hoofdveld\b/i, '').trim() || s;
  return short.replace(/^veld\b/i, 'Veld');
}

// Minimal CSV parser (handles quotes, ; or , separators).
export function parseCSV(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

// Accepts dd-mm-yyyy, dd/mm/yyyy or yyyy-mm-dd.
export function normalizeDate(s) {
  s = String(s).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

export function csvMatches(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const idx = {
    date: col('datum', 'date'),
    time: col('tijd', 'aanvang', 'time'),
    home: col('thuis', 'home'),
    away: col('uit', 'away', 'tegenstander'),
    field: col('veld', 'field'),
    category: col('categorie', 'klasse', 'category'),
  };
  if (idx.date < 0 || idx.time < 0 || idx.home < 0) {
    throw new Error('CSV mist kolommen. Nodig: datum, tijd, thuis (optioneel: uit, veld, categorie).');
  }
  return rows.slice(1).map((r) => {
    const home = (r[idx.home] || '').trim();
    const category = (idx.category >= 0 && (r[idx.category] || '').trim()) || categoryFromTeam(home);
    return {
      date: normalizeDate(r[idx.date]),
      time: (r[idx.time] || '').trim().slice(0, 5).replace('.', ':'),
      home,
      away: idx.away >= 0 ? (r[idx.away] || '').trim() : '',
      field: idx.field >= 0 ? (r[idx.field] || '').trim() : '',
      category,
      duration: defaultDuration(category),
    };
  }).filter((m) => m.date && /^\d{1,2}:\d{2}$/.test(m.time) && m.home);
}

export function toCSV(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(';')).join('\r\n');
}

// ---------- Meldingen (zelfde regels als de database-triggers in supabase/schema.sql) ----------

export function matchLabel(m) {
  const [, mo, d] = m.date.split('-');
  return `${d}-${mo} ${m.time} ${m.home}${m.away ? ` – ${m.away}` : ''}${m.field ? `, ${m.field}` : ''}`;
}

// old/neu are the match before and after a change; neu = null when the match is deleted.
export function matchChangeNotifications(old, neu) {
  const out = [];
  const note = (referee_id, kind, title, body, m) => out.push({ referee_id, to_planners: false, kind, title, body, match_id: neu?.id || null, date: m.date });
  if (!neu) {
    if (old.published && old.referee_id) note(old.referee_id, 'cancelled', 'Wedstrijd vervallen', matchLabel(old), old);
    return out;
  }
  if (old.published && old.referee_id && (neu.referee_id !== old.referee_id || !neu.published)) {
    note(old.referee_id, 'withdrawn', 'Aanstelling ingetrokken', matchLabel(old), old);
  } else if (old.published && neu.published && neu.referee_id === old.referee_id
    && (neu.date !== old.date || neu.time !== old.time || (neu.field || '') !== (old.field || ''))) {
    note(neu.referee_id, 'changed', 'Wedstrijd gewijzigd', `${matchLabel(neu)} (was ${matchLabel(old)})`, neu);
  }
  if (neu.published && neu.referee_id && (!old.published || old.referee_id !== neu.referee_id)) {
    note(neu.referee_id, 'assigned', 'Je bent aangesteld', matchLabel(neu), neu);
  }
  return out;
}

// A referee marks a day unavailable while already assigned that day → note for planners.
export function unavailableNotification(prev, row, matches, refereeName) {
  if (row.available || (prev && !prev.available)) return null;
  const n = matches.filter((m) => m.referee_id === row.referee_id && m.date === row.date).length;
  if (!n) return null;
  const [, mo, d] = row.date.split('-');
  return {
    referee_id: null, to_planners: true, kind: 'unavailable', date: row.date, match_id: null,
    title: `${refereeName} heeft zich afgemeld`,
    body: `Afgemeld voor ${d}-${mo}, maar aangesteld bij ${n} wedstrijd(en).`,
  };
}

// Why the referee assigned to a match can no longer do it (null when fine).
export function assignmentIssue(m, data) {
  if (!m.referee_id || !needsReferee(m)) return null;
  const c = candidates(m, data).find((x) => x.referee.id === m.referee_id);
  if (!c) return ['Niet meer actief'];
  return c.status === 'no' ? c.reasons.filter((r) => !/graag|liever/i.test(r)) : null;
}

// ---------- Voorkeuren: groepen en teams ----------
// "Wat fluit je graag?" is stored as the full list of categories (pref_categories), so candidates()
// keeps working. Choosing a group means all its categories; choosing teams narrows the group down.
export const GROUP_NAMES = ['Pupillen', 'Junioren', 'Senioren', 'Vrouwen'];

export function groupOf(category) {
  const n = /^O(\d+)$/.exec(category || '');
  if (n) return +n[1] <= 12 ? 'Pupillen' : 'Junioren';
  return /^VR|^Vrouwen$/.test(category || '') ? 'Vrouwen' : 'Senioren';
}

export function categoryGroups(categories) {
  return GROUP_NAMES.map((g) => [g, categories.filter((c) => groupOf(c) === g)]).filter(([, cs]) => cs.length);
}

// What the picker shows: a group is on when any of its categories is chosen; teams are only
// marked when the group is narrowed down (all of them chosen reads as "the whole group").
export function prefState(prefs, categories) {
  const set = new Set(prefs || []);
  return Object.fromEntries(categoryGroups(categories).map(([g, cs]) => {
    const chosen = cs.filter((c) => set.has(c));
    return [g, { on: chosen.length > 0, teams: chosen.length === cs.length ? [] : chosen }];
  }));
}

export function togglePrefGroup(prefs, group, categories) {
  const cs = categories.filter((c) => groupOf(c) === group);
  const set = new Set(prefs || []);
  const on = cs.some((c) => set.has(c));
  cs.forEach((c) => (on ? set.delete(c) : set.add(c)));
  return categories.filter((c) => set.has(c));
}

// Tapping a team: the first team narrows the whole group down to that team; removing the last
// chosen team goes back to the whole group (the group itself is switched off with its own chip).
export function togglePrefTeam(prefs, team, categories) {
  const g = groupOf(team);
  const cs = categories.filter((c) => groupOf(c) === g);
  const set = new Set(prefs || []);
  const chosen = cs.filter((c) => set.has(c));
  if (chosen.length === 0 || chosen.length === cs.length) {
    cs.forEach((c) => set.delete(c)); set.add(team);
  } else if (set.has(team)) {
    set.delete(team);
    if (chosen.length === 1) cs.forEach((c) => set.add(c));
  } else set.add(team);
  return categories.filter((c) => set.has(c));
}

// Short text for a preference list, e.g. "Pupillen, O15, O17".
export function prefLabel(prefs, categories) {
  const st = prefState(prefs, categories);
  return Object.entries(st).filter(([, s]) => s.on).map(([g, s]) => (s.teams.length ? s.teams.join(', ') : g)).join(', ');
}
