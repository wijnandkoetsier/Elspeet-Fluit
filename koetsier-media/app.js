// Koetsier Media: haalt de cijfers rechtstreeks bij Windsor.ai op, met de API-sleutel die op dit toestel is opgeslagen.
'use strict';

const KEY_STORE = 'km-windsor-key';
const DATA_CACHE = 'km-data-v1';
const MAX_AGE_MS = 3 * 60 * 60 * 1000; // cijfers zijn 3 uur geldig, daarna opnieuw ophalen

// Welke Windsor.ai-gegevens de app gebruikt
const SOURCES = {
  ads_lang: { connector: 'all', fields: 'date,datasource,account_name,spend', date_preset: 'last_2years',
    select_accounts: 'facebook__579117036808079,facebook__617052584106738,facebook__595733410074043,facebook__451606250333107,facebook__1818267011841069,facebook__344846652799267,facebook__1196613908296180,facebook__1301968845413232,google_ads__897-233-7929,google_ads__546-911-1040,google_ads__449-825-1491,google_ads__220-995-8676,google_ads__732-199-7215,linkedin__510774969,openai_ads__880' },
  ga4_lang: { connector: 'googleanalytics4', fields: 'date,account_name,sessions,purchase_revenue,transactions,first_time_purchasers', date_preset: 'last_2years',
    select_accounts: '242224638,263823380,344223908' },
  leads_lang: { connector: 'facebook', fields: 'date,account_name,custom_conversion_action_name,custom_conversion_action_count', date_preset: 'last_400d',
    select_accounts: '617052584106738,451606250333107,1818267011841069,595733410074043', filter: [['custom_conversion_action_name', 'contains', 'Engaged Visits']] },
  events_lang: { connector: 'googleanalytics4', fields: 'date,account_name,event_name,event_count', date_preset: 'last_400d',
    select_accounts: '344223908,283467915', filter: [['event_name', 'contains', 'sollicitatie'], 'or', ['event_name', 'eq', 'booking_complete']] },
  ads_per_ad: { connector: 'facebook', fields: 'date,account_name,ad_name,spend', date_preset: 'last_30d',
    select_accounts: '617052584106738,451606250333107,1818267011841069,595733410074043' },
  leads_per_ad: { connector: 'facebook', fields: 'date,account_name,ad_name,custom_conversion_action_name,custom_conversion_action_count', date_preset: 'last_30d',
    select_accounts: '617052584106738,451606250333107,1818267011841069,595733410074043', filter: [['custom_conversion_action_name', 'contains', 'Engaged Visits']] },
  br_producten_1d: { connector: 'googleanalytics4', fields: 'item_name,items_purchased,item_revenue', date_preset: 'last_1d', select_accounts: '242224638' },
  br_producten_7d: { connector: 'googleanalytics4', fields: 'item_name,items_purchased,item_revenue', date_preset: 'last_7d', select_accounts: '242224638' },
  br_producten_30d: { connector: 'googleanalytics4', fields: 'item_name,items_purchased,item_revenue', date_preset: 'last_30d', select_accounts: '242224638' },
  pg_land_meta: { connector: 'facebook', fields: 'date,country,spend', date_preset: 'last_30d', select_accounts: '344846652799267' },
  pg_land_google: { connector: 'google_ads', fields: 'date,geo_target_country,spend', date_preset: 'last_30d', select_accounts: '449-825-1491' },
  pg_land_ga4: { connector: 'googleanalytics4', fields: 'date,country,purchase_revenue,first_time_purchasers', date_preset: 'last_30d', select_accounts: '263823380' },
  bronnen: { connector: 'googleanalytics4', fields: 'date,account_name,session_source_medium,event_name,event_count', date_preset: 'last_30d',
    select_accounts: '344223908,283467915', filter: [['event_name', 'contains', 'sollicitatie'], 'or', ['event_name', 'eq', 'booking_complete']] },
};
const TEXT_FIELDS = ['datasource', 'account_name', 'custom_conversion_action_name', 'event_name', 'ad_name', 'item_name', 'country', 'geo_target_country', 'session_source_medium'];

const getKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } };
const setKey = (k) => { try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch { /* geen opslag */ } };

class KeyError extends Error {}

function windsorUrl(src, key) {
  const p = new URLSearchParams({ api_key: key, fields: src.fields, date_preset: src.date_preset, _max_rows: '200000' });
  if (src.select_accounts) p.set('select_accounts', src.select_accounts);
  if (src.filter) p.set('filter', JSON.stringify(src.filter));
  return `https://connectors.windsor.ai/${src.connector}?${p}`;
}

// Eén gegevensbron ophalen: eerst uit de cache op het toestel, anders bij Windsor.ai
async function fetchSource(id, minAt) {
  const src = SOURCES[id];
  const cacheUrl = new URL('km-data/' + id, location.href).href;
  let cache = null;
  try { cache = await caches.open(DATA_CACHE); } catch { /* geen cache beschikbaar */ }
  if (cache) {
    const hit = await cache.match(cacheUrl);
    const at = hit && Number(hit.headers.get('x-fetched-at'));
    if (hit && Date.now() - at < MAX_AGE_MS && at >= minAt) return { rows: await hit.json(), at };
  }
  const key = getKey();
  if (!key) throw new KeyError('Geen API-sleutel');
  const res = await fetch(windsorUrl(src, key));
  const body = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403 || (body && /api key|not authorized/i.test(JSON.stringify(body.error || '')))) throw new KeyError('Windsor.ai accepteert deze API-sleutel niet.');
  if (!res.ok || !body || !Array.isArray(body.data)) throw new Error('Windsor.ai gaf geen gegevens terug' + (body && body.error ? ': ' + JSON.stringify(body.error) : '.'));
  const rows = body.data.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'date' ? String(v).slice(0, 10) : TEXT_FIELDS.includes(k) ? String(v ?? '') : Number(v) || 0])));
  const at = Date.now();
  if (cache) await cache.put(cacheUrl, new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json', 'x-fetched-at': String(at) } })).catch(() => {});
  return { rows, at };
}

// Kleine vervanger van de dashboard-functies die de pagina gebruikt
const dash = (() => {
  const store = {};
  const calcs = {};
  const memo = {};
  const listeners = [];
  let version = 0;
  let minAt = 0;
  let scheduled = false;
  const changed = () => {
    version++;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; for (const fn of listeners) fn(); });
  };
  const load = (id) => {
    store[id] = { status: 'loading', data: [] };
    fetchSource(id, minAt).then(({ rows, at }) => { store[id] = { status: 'ok', data: rows, at }; changed(); })
      .catch((e) => { store[id] = { status: 'error', data: [], message: e.message, keyError: e instanceof KeyError }; changed(); });
  };
  const api = {
    calc(id, { inputs, fn }) { calcs[id] = { inputs, fn }; },
    loader() {},
    data(id) {
      if (calcs[id]) {
        const ins = calcs[id].inputs.map((i) => api.data(i));
        const bad = ins.find((s) => s.status === 'error');
        if (bad) return { status: 'error', data: [], message: bad.message, keyError: bad.keyError };
        if (ins.some((s) => s.status !== 'ok')) return { status: 'loading', data: [] };
        const m = memo[id];
        if (m && m.version === version) return m.result;
        try {
          const result = { status: 'ok', data: calcs[id].fn(...ins.map((s) => s.data)) };
          memo[id] = { version, result };
          return result;
        } catch (e) {
          console.error(id, e);
          return { status: 'error', data: [], message: e.message };
        }
      }
      if (!SOURCES[id]) return { status: 'error', data: [], message: 'Onbekende bron ' + id };
      if (!store[id]) load(id);
      return store[id];
    },
    onData(fn) { listeners.push(fn); fn(); },
    setLink(name) { try { history.replaceState(null, '', name && name !== 'overzicht' ? '#' + name : location.pathname); } catch { /* niets */ } },
    // Alles opnieuw bij Windsor.ai ophalen (alleen wat nu in beeld is laadt meteen)
    refresh() { minAt = Date.now(); for (const id of Object.keys(store)) delete store[id]; changed(); },
    reset() { for (const id of Object.keys(store)) delete store[id]; changed(); },
    lastUpdate() { const ts = Object.values(store).filter((s) => s.at).map((s) => s.at); return ts.length ? Math.min(...ts) : null; },
    keyProblem() { return Object.values(store).some((s) => s.keyError); },
    colors: [],
  };
  let resizeTimer;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(changed, 150); });
  return api;
})();


dash.calc('klanten', {
  title: 'Resultaten per klant',
  description: 'Per klant de afgesproken metrics voor gisteren, 7 en 30 dagen, met de periode ervoor ter vergelijking.',
  inputs: ['ads_lang', 'leads_lang', 'ga4_lang', 'events_lang'],
  fn: (advertenties, meta_leads, ga4, ga4_events) => {
    const KLANTEN = [
      { client: 'Beddenreus', ads: /beddenreus|beter bed/i, kanalen: ['facebook', 'google_ads'], ga4: 'GA4 03) - REUS - Beddenreus.nl' },
      { client: 'Beko NL', ads: /^Beko Netherlands$/, kanalen: ['facebook'], leads: 'Beko Netherlands' },
      { client: 'Beko BE', ads: /^Beko BELUX$/, kanalen: ['facebook'], leads: 'Beko BELUX' },
      { client: 'Whirlpool NL', ads: /^Whirlpool Nederland$/, kanalen: ['facebook'], leads: 'Whirlpool Nederland' },
      { client: 'Whirlpool BE', ads: /^Whirlpool Belux$/, kanalen: ['facebook'], leads: 'Whirlpool Belux' },
      { client: 'Pure Goat Company', ads: /pure goat/i, kanalen: ['facebook', 'google_ads'], ga4: 'GA4 - Pure Goat Company' },
      { client: 'Public Search', ads: /public search/i, kanalen: [], ga4: 'Public Search', sollicitaties: 'Public Search' },
      { client: 'Quality Lodgings', ads: /quality lodgings/i, kanalen: [], bookings: 'Quality Lodgings - GA4' },
    ];
    const isSollicitatie = (n) => /sollicitatie/i.test(n) && n !== 'sollicitatie_verstuurd' && !n.startsWith('sollicitatie_contact');
    const terug = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);
    const laatste = advertenties.reduce((m, r) => (r.date > m ? r.date : m), '');
    if (!laatste) return [];
    const PERIODES = [['gisteren', 1], ['7d', 7], ['30d', 30]].map(([p, n]) => ({ p, start: terug(laatste, n), vorig: terug(laatste, 2 * n) }));
    const leeg = () => ({ spend: 0, revenue: 0, transactions: 0, sessions: 0, new_buyers: 0, leads: 0, applications: 0, bookings: 0 });
    const acc = new Map();
    for (const k of KLANTEN) for (const { p } of PERIODES) acc.set(k.client + '|' + p, { cur: leeg(), prev: leeg() });
    const voegToe = (client, date, f, v) => {
      if (!v || date > laatste) return;
      for (const { p, start, vorig } of PERIODES) {
        if (date > start) acc.get(client + '|' + p).cur[f] += v;
        else if (date > vorig) acc.get(client + '|' + p).prev[f] += v;
      }
    };
    for (const r of advertenties) {
      const k = KLANTEN.find((x) => x.ads.test(r.account_name) && (!x.kanalen.length || x.kanalen.includes(r.datasource)));
      if (k) voegToe(k.client, r.date, 'spend', r.spend);
    }
    for (const r of meta_leads) {
      const k = KLANTEN.find((x) => x.leads === r.account_name);
      if (k && r.custom_conversion_action_name.startsWith('Engaged Visits')) voegToe(k.client, r.date, 'leads', r.custom_conversion_action_count);
    }
    for (const r of ga4) {
      const k = KLANTEN.find((x) => x.ga4 === r.account_name);
      if (!k) continue;
      voegToe(k.client, r.date, 'revenue', r.purchase_revenue);
      voegToe(k.client, r.date, 'transactions', r.transactions);
      voegToe(k.client, r.date, 'sessions', r.sessions);
      voegToe(k.client, r.date, 'new_buyers', r.first_time_purchasers);
    }
    for (const r of ga4_events) {
      const s = KLANTEN.find((x) => x.sollicitaties === r.account_name);
      if (s && isSollicitatie(r.event_name)) voegToe(s.client, r.date, 'applications', r.event_count);
      const b = KLANTEN.find((x) => x.bookings === r.account_name);
      if (b && r.event_name === 'booking_complete') voegToe(b.client, r.date, 'bookings', r.event_count);
    }
    const deel = (a, b) => (a && b ? a / b : null);
    const afgeleid = (t, client) => {
      const resultaat = client === 'Pure Goat Company' ? t.new_buyers : t.leads || t.applications || t.bookings;
      const conv = client === 'Public Search' ? t.applications : t.transactions;
      return { roas: deel(t.revenue, t.spend), cpa: deel(t.spend, resultaat), conv_rate: deel(conv, t.sessions) };
    };
    const chg = (a, b) => (a != null && b ? Math.round(((a - b) / b) * 1000) / 1000 : null);
    const rond = (x, n) => (x == null ? null : Math.round(x * 10 ** n) / 10 ** n);
    const rows = [];
    for (const k of KLANTEN) for (const { p } of PERIODES) {
      const { cur, prev } = acc.get(k.client + '|' + p);
      const a = afgeleid(cur, k.client), b = afgeleid(prev, k.client);
      const row = { client: k.client, period: p, last_date: laatste,
        spend: rond(cur.spend, 2), revenue: rond(cur.revenue, 2), roas: rond(a.roas, 2), transactions: cur.transactions,
        conv_rate: rond(a.conv_rate, 4), leads: cur.leads, new_buyers: cur.new_buyers, applications: cur.applications,
        bookings: cur.bookings, cpa: rond(a.cpa, 2) };
      for (const f of ['spend', 'revenue', 'transactions', 'leads', 'new_buyers', 'applications', 'bookings']) row[f + '_chg'] = chg(cur[f], prev[f]);
      for (const f of ['roas', 'cpa', 'conv_rate']) row[f + '_chg'] = chg(a[f], b[f]);
      rows.push(row);
    }
    return rows;
  },
});

dash.calc('dagbasis', {
  title: 'Dagcijfers per klant',
  description: 'Kosten, omzet, transacties, sessies, nieuwe kopers, leads, sollicitaties en boekingen per klant per dag, tot twee jaar terug.',
  inputs: ['ads_lang', 'ga4_lang', 'leads_lang', 'events_lang'],
  fn: (ads_lang, ga4_lang, leads_lang, events_lang) => {
    const KLANTEN = [
      { client: 'Beddenreus', ads: /beddenreus|beter bed/i, kanalen: ['facebook', 'google_ads'], ga4: 'GA4 03) - REUS - Beddenreus.nl' },
      { client: 'Beko NL', ads: /^Beko Netherlands$/, kanalen: ['facebook'], leads: 'Beko Netherlands' },
      { client: 'Beko BE', ads: /^Beko BELUX$/, kanalen: ['facebook'], leads: 'Beko BELUX' },
      { client: 'Whirlpool NL', ads: /^Whirlpool Nederland$/, kanalen: ['facebook'], leads: 'Whirlpool Nederland' },
      { client: 'Whirlpool BE', ads: /^Whirlpool Belux$/, kanalen: ['facebook'], leads: 'Whirlpool Belux' },
      { client: 'Pure Goat Company', ads: /pure goat/i, kanalen: ['facebook', 'google_ads'], ga4: 'GA4 - Pure Goat Company' },
      { client: 'Public Search', ads: /public search/i, kanalen: [], ga4: 'Public Search', sollicitaties: 'Public Search' },
      { client: 'Quality Lodgings', ads: /quality lodgings/i, kanalen: [], bookings: 'Quality Lodgings - GA4' },
    ];
    const isSollicitatie = (n) => /sollicitatie/i.test(n) && n !== 'sollicitatie_verstuurd' && !n.startsWith('sollicitatie_contact');
    const m = new Map();
    const voegToe = (client, date, f, v) => {
      if (!v) return;
      const k = client + '|' + date;
      if (!m.has(k)) m.set(k, { client, date, spend: 0, revenue: 0, transactions: 0, sessions: 0, new_buyers: 0, leads: 0, applications: 0, bookings: 0 });
      m.get(k)[f] += v;
    };
    for (const r of ads_lang) {
      const k = KLANTEN.find((x) => x.ads.test(r.account_name) && (!x.kanalen.length || x.kanalen.includes(r.datasource)));
      if (k) voegToe(k.client, r.date, 'spend', r.spend);
    }
    for (const r of leads_lang) {
      const k = KLANTEN.find((x) => x.leads === r.account_name);
      if (k && r.custom_conversion_action_name.startsWith('Engaged Visits')) voegToe(k.client, r.date, 'leads', r.custom_conversion_action_count);
    }
    for (const r of ga4_lang) {
      const k = KLANTEN.find((x) => x.ga4 === r.account_name);
      if (!k) continue;
      voegToe(k.client, r.date, 'revenue', r.purchase_revenue);
      voegToe(k.client, r.date, 'transactions', r.transactions);
      voegToe(k.client, r.date, 'sessions', r.sessions);
      voegToe(k.client, r.date, 'new_buyers', r.first_time_purchasers);
    }
    for (const r of events_lang) {
      const s = KLANTEN.find((x) => x.sollicitaties === r.account_name);
      if (s && isSollicitatie(r.event_name)) voegToe(s.client, r.date, 'applications', r.event_count);
      const b = KLANTEN.find((x) => x.bookings === r.account_name);
      if (b && r.event_name === 'booking_complete') voegToe(b.client, r.date, 'bookings', r.event_count);
    }
    return [...m.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  },
});

dash.calc('trend', {
  title: 'Trend per klant',
  description: 'Per klant per dag (laatste 30 dagen), per week (dit jaar) en per maand (laatste 12 maanden), met ROAS en CPA.',
  inputs: ['dagbasis'],
  fn: (dagbasis) => {
    const DAG = 864e5;
    const t = (s) => Date.parse(s + 'T00:00:00Z');
    const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
    const laatste = dagbasis.reduce((m, r) => (r.spend > 0 && r.date > m ? r.date : m), '');
    if (!laatste) return [];
    const maandag = (s) => { const d = t(s); return iso(d - ((new Date(d).getUTCDay() + 6) % 7) * DAG); };
    const jaar = laatste.slice(0, 4);
    const week1 = maandag(jaar + '-01-04');
    const dagStart = iso(t(laatste) - 29 * DAG);
    const maanden = [];
    for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(+jaar, +laatste.slice(5, 7) - 1 - i, 1)); maanden.push(iso(d.getTime()).slice(0, 7)); }
    const RESULTAAT = { 'Beko NL': 'leads', 'Beko BE': 'leads', 'Whirlpool NL': 'leads', 'Whirlpool BE': 'leads', 'Pure Goat Company': 'new_buyers', 'Public Search': 'applications', 'Quality Lodgings': 'bookings' };
    const acc = new Map();
    const add = (client, grain, key, start, r) => {
      const k = client + '|' + grain + '|' + key;
      if (!acc.has(k)) acc.set(k, { client, grain, key, start, spend: 0, revenue: 0, leads: 0, new_buyers: 0, applications: 0, bookings: 0 });
      const a = acc.get(k);
      for (const f of ['spend', 'revenue', 'leads', 'new_buyers', 'applications', 'bookings']) a[f] += r[f];
    };
    for (const r of dagbasis) {
      if (r.date > laatste) continue;
      if (r.date >= dagStart) add(r.client, 'dag', r.date, r.date, r);
      const ma = maandag(r.date);
      if (ma >= week1) add(r.client, 'week', 'wk' + String(Math.round((t(ma) - t(week1)) / (7 * DAG)) + 1).padStart(2, '0'), ma, r);
      const mnd = r.date.slice(0, 7);
      if (maanden.includes(mnd)) add(r.client, 'maand', mnd, mnd + '-01', r);
    }
    const rond = (x, n) => (x == null ? null : Math.round(x * 10 ** n) / 10 ** n);
    const eindeMaand = (s) => iso(Date.UTC(+s.slice(0, 4), +s.slice(5, 7), 0));
    return [...acc.values()].sort((a, b) => (a.start < b.start ? -1 : 1)).map((a) => {
      const res = RESULTAAT[a.client] ? a[RESULTAAT[a.client]] : 0;
      const eind = a.grain === 'week' ? iso(t(a.start) + 6 * DAG) : a.grain === 'maand' ? eindeMaand(a.start) : a.start;
      return { client: a.client, grain: a.grain, key: a.key, start: a.start, partial: eind > laatste,
        spend: rond(a.spend, 2), revenue: rond(a.revenue, 2), leads: a.leads, new_buyers: a.new_buyers, applications: a.applications, bookings: a.bookings,
        roas: a.revenue > 0 && a.spend > 0 ? rond(a.revenue / a.spend, 2) : null, cpa: res > 0 ? rond(a.spend / res, 2) : null };
    });
  },
});

dash.calc('vorig_jaar', {
  title: 'Beddenreus tegen vorig jaar',
  description: 'Kosten, omzet en ROAS van Beddenreus in de laatste 30 dagen en dit jaar tot nu, tegenover dezelfde weekdagen 52 weken eerder.',
  inputs: ['dagbasis'],
  fn: (dagbasis) => {
    const rs = dagbasis.filter((r) => r.client === 'Beddenreus');
    const laatste = rs.reduce((m, r) => (r.spend > 0 && r.date > m ? r.date : m), '');
    if (!laatste) return [];
    // 52 weken terug: elke maandag valt op de maandag van dezelfde week vorig jaar
    const vj = (s) => new Date(Date.parse(s + 'T00:00:00Z') - 364 * 864e5).toISOString().slice(0, 10);
    const start30 = new Date(Date.parse(laatste + 'T00:00:00Z') - 29 * 864e5).toISOString().slice(0, 10);
    const VENSTERS = [['30d', start30], ['ytd', laatste.slice(0, 4) + '-01-01']];
    const som = (a, b) => rs.filter((r) => r.date >= a && r.date <= b).reduce((s, r) => ({ spend: s.spend + r.spend, revenue: s.revenue + r.revenue }), { spend: 0, revenue: 0 });
    const chg = (a, b) => (a != null && b ? Math.round(((a - b) / b) * 1000) / 1000 : null);
    const rond = (x, n) => (x == null ? null : Math.round(x * 10 ** n) / 10 ** n);
    return VENSTERS.map(([window, start]) => {
      const nu = som(start, laatste), toen = som(vj(start), vj(laatste));
      const roas = nu.spend ? nu.revenue / nu.spend : null, roasLy = toen.spend ? toen.revenue / toen.spend : null;
      return { window, from: start, to: laatste, spend: rond(nu.spend, 2), spend_ly: rond(toen.spend, 2), revenue: rond(nu.revenue, 2), revenue_ly: rond(toen.revenue, 2),
        roas: rond(roas, 2), roas_ly: rond(roasLy, 2), spend_chg: chg(nu.spend, toen.spend), revenue_chg: chg(nu.revenue, toen.revenue), roas_chg: chg(roas, roasLy) };
    });
  },
});

dash.calc('top_ads', {
  title: 'Top 5 ads Beko en Whirlpool',
  description: 'De vijf Meta-ads met de meeste leads (Engaged Visits) per account, met kosten en CPA.',
  inputs: ['ads_per_ad', 'leads_per_ad'],
  fn: (ads_per_ad, leads_per_ad) => {
    const ACCOUNT = { 'Beko Netherlands': 'Beko NL', 'Beko BELUX': 'Beko BE', 'Whirlpool Nederland': 'Whirlpool NL', 'Whirlpool Belux': 'Whirlpool BE' };
    const laatste = ads_per_ad.reduce((m, r) => (r.date > m ? r.date : m), '');
    if (!laatste) return [];
    const terug = (n) => new Date(Date.parse(laatste + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);
    const PERIODES = [['gisteren', terug(1)], ['7d', terug(7)], ['30d', terug(30)]];
    const acc = new Map();
    const add = (r, f, v) => {
      const client = ACCOUNT[r.account_name];
      if (!client || !v) return;
      for (const [p, start] of PERIODES) {
        if (r.date <= start || r.date > laatste) continue;
        const k = client + '|' + p + '|' + r.ad_name;
        if (!acc.has(k)) acc.set(k, { client, period: p, ad_name: r.ad_name, spend: 0, leads: 0 });
        acc.get(k)[f] += v;
      }
    };
    for (const r of ads_per_ad) add(r, 'spend', r.spend);
    for (const r of leads_per_ad) if (r.custom_conversion_action_name.startsWith('Engaged Visits')) add(r, 'leads', r.custom_conversion_action_count);
    const groepen = new Map();
    for (const a of acc.values()) { const k = a.client + '|' + a.period; if (!groepen.has(k)) groepen.set(k, []); groepen.get(k).push(a); }
    const rows = [];
    for (const lijst of groepen.values()) {
      lijst.sort((a, b) => b.leads - a.leads || b.spend - a.spend).slice(0, 5).forEach((a, i) => rows.push({
        client: a.client, period: a.period, rank: i + 1, ad_name: a.ad_name, spend: Math.round(a.spend * 100) / 100, leads: a.leads,
        cpa: a.leads ? Math.round((a.spend / a.leads) * 100) / 100 : null }));
    }
    return rows;
  },
});

dash.calc('producten', {
  title: 'Top 15 producten Beddenreus',
  description: 'De vijftien meest verkochte producten in GA4 (aantal stuks), met de omzet per product.',
  inputs: ['br_producten_1d', 'br_producten_7d', 'br_producten_30d'],
  fn: (br_producten_1d, br_producten_7d, br_producten_30d) => [['gisteren', br_producten_1d], ['7d', br_producten_7d], ['30d', br_producten_30d]].flatMap(([period, rs]) =>
    rs.filter((r) => r.items_purchased > 0).sort((a, b) => b.items_purchased - a.items_purchased || b.item_revenue - a.item_revenue).slice(0, 15)
      .map((r, i) => ({ period, rank: i + 1, item_name: r.item_name, items: r.items_purchased, revenue: Math.round(r.item_revenue * 100) / 100 }))),
});

dash.calc('landen', {
  title: 'Pure Goat per land',
  description: 'Kosten (Meta + Google Ads), omzet en nieuwe kopers (GA4) per land, met ROAS en CPA.',
  inputs: ['pg_land_meta', 'pg_land_google', 'pg_land_ga4'],
  fn: (pg_land_meta, pg_land_google, pg_land_ga4) => {
    const laatste = [...pg_land_meta, ...pg_land_ga4].reduce((m, r) => (r.date > m ? r.date : m), '');
    if (!laatste) return [];
    const terug = (n) => new Date(Date.parse(laatste + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);
    const PERIODES = [['7d', terug(7)], ['30d', terug(30)]];
    const acc = new Map();
    const add = (date, country, f, v) => {
      if (!v || !country) return;
      for (const [p, start] of PERIODES) {
        if (date <= start || date > laatste) continue;
        const k = p + '|' + country;
        if (!acc.has(k)) acc.set(k, { period: p, country, spend: 0, revenue: 0, new_buyers: 0 });
        acc.get(k)[f] += v;
      }
    };
    for (const r of pg_land_meta) add(r.date, r.country, 'spend', r.spend);
    for (const r of pg_land_google) add(r.date, r.geo_target_country, 'spend', r.spend);
    for (const r of pg_land_ga4) { add(r.date, r.country, 'revenue', r.purchase_revenue); add(r.date, r.country, 'new_buyers', r.first_time_purchasers); }
    const rond = (x, n) => (x == null ? null : Math.round(x * 10 ** n) / 10 ** n);
    return [...acc.values()].sort((a, b) => b.revenue - a.revenue || b.spend - a.spend).map((a) => ({
      period: a.period, country: a.country, spend: rond(a.spend, 2), revenue: rond(a.revenue, 2),
      roas: a.spend > 0 && a.revenue > 0 ? rond(a.revenue / a.spend, 2) : null, new_buyers: a.new_buyers,
      cpa: a.new_buyers > 0 && a.spend > 0 ? rond(a.spend / a.new_buyers, 2) : null }));
  },
});

dash.calc('bronnen_tabel', {
  title: 'Top 10 bronnen',
  description: 'Sollicitaties (Public Search) en boekingen (Quality Lodgings) per GA4-bron, met kosten en CPA voor betaalde kanalen.',
  inputs: ['bronnen', 'ads_lang'],
  fn: (bronnen, advertenties) => {
    const KLANT = { 'Public Search': { client: 'Public Search', ads: /public search/i }, 'Quality Lodgings - GA4': { client: 'Quality Lodgings', ads: /quality lodgings/i } };
    const PLATFORM = { facebook: 'Meta Ads', google_ads: 'Google Ads', linkedin: 'LinkedIn Ads', openai_ads: 'ChatGPT Ads' };
    const isSollicitatie = (n) => /sollicitatie/i.test(n) && n !== 'sollicitatie_verstuurd' && !n.startsWith('sollicitatie_contact');
    // Betaald verkeer gaat naar het advertentieplatform, de rest blijft bron / medium
    const bron = (sm) => {
      const [src = '', med = ''] = sm.split(' / ').map((s) => s.trim().toLowerCase());
      const betaald = /^(cpc|ppc|cpm|paid.*|ads?|display|paidsocial|paid_social|social_paid|social-paid)$/.test(med);
      if (betaald && /^(meta|facebook|fb|ig|instagram|m\.facebook\.com|l\.facebook\.com|an)$/.test(src)) return PLATFORM.facebook;
      if (betaald && /^google/.test(src)) return PLATFORM.google_ads;
      if (betaald && /linkedin/.test(src)) return PLATFORM.linkedin;
      if (betaald && /chatgpt|openai/.test(src)) return PLATFORM.openai_ads;
      return sm;
    };
    const laatste = advertenties.reduce((m, r) => (r.date > m ? r.date : m), '');
    if (!laatste) return [];
    const terug = (n) => new Date(Date.parse(laatste + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);
    const PERIODES = [['gisteren', terug(1)], ['7d', terug(7)], ['30d', terug(30)]];
    const acc = new Map();
    const add = (client, date, b, f, v) => {
      if (!v) return;
      for (const [p, start] of PERIODES) {
        if (date <= start || date > laatste) continue;
        const k = client + '|' + p + '|' + b;
        if (!acc.has(k)) acc.set(k, { client, period: p, bron: b, conversions: 0, spend: 0 });
        acc.get(k)[f] += v;
      }
    };
    for (const r of bronnen) {
      const k = KLANT[r.account_name];
      if (!k) continue;
      const telt = k.client === 'Public Search' ? isSollicitatie(r.event_name) : r.event_name === 'booking_complete';
      if (telt) add(k.client, r.date, bron(r.session_source_medium), 'conversions', r.event_count);
    }
    for (const r of advertenties) {
      const k = Object.values(KLANT).find((x) => x.ads.test(r.account_name));
      if (k && PLATFORM[r.datasource]) add(k.client, r.date, PLATFORM[r.datasource], 'spend', r.spend);
    }
    const groepen = new Map();
    for (const a of acc.values()) { const k = a.client + '|' + a.period; if (!groepen.has(k)) groepen.set(k, []); groepen.get(k).push(a); }
    const rows = [];
    for (const lijst of groepen.values()) {
      lijst.sort((a, b) => b.conversions - a.conversions || b.spend - a.spend);
      const top = lijst.filter((a) => a.conversions > 0).slice(0, 10);
      for (const a of lijst) if (a.spend > 0 && !top.includes(a)) top.push(a);
      top.forEach((a, i) => rows.push({ client: a.client, period: a.period, rank: i + 1, bron: a.bron, conversions: a.conversions,
        spend: a.spend > 0 ? Math.round(a.spend * 100) / 100 : null, cpa: a.spend > 0 && a.conversions > 0 ? Math.round((a.spend / a.conversions) * 100) / 100 : null }));
    }
    return rows;
  },
});


(() => {
  const PERIODS = [['gisteren', 'Gisteren'], ['7d', '7 dagen'], ['30d', '30 dagen']];
  const CLIENTS = [
    ['Beddenreus', [['spend', 'Kosten'], ['revenue', 'Omzet'], ['roas', 'ROAS'], ['transactions', 'Transacties'], ['conv_rate', 'Conversieratio']]],
    ['Beko NL', [['spend', 'Kosten'], ['leads', 'Leads'], ['cpa', 'CPA']]],
    ['Beko BE', [['spend', 'Kosten'], ['leads', 'Leads'], ['cpa', 'CPA']]],
    ['Whirlpool NL', [['spend', 'Kosten'], ['leads', 'Leads'], ['cpa', 'CPA']]],
    ['Whirlpool BE', [['spend', 'Kosten'], ['leads', 'Leads'], ['cpa', 'CPA']]],
    ['Pure Goat Company', [['spend', 'Kosten'], ['revenue', 'Omzet'], ['roas', 'ROAS'], ['new_buyers', 'Nieuwe kopers'], ['cpa', 'CPA']]],
    ['Public Search', [['spend', 'Kosten'], ['applications', 'Sollicitaties'], ['cpa', 'CPA'], ['conv_rate', 'Conversieratio']]],
    ['Quality Lodgings', [['spend', 'Kosten'], ['bookings', 'Booking complete'], ['cpa', 'CPA']]],
  ];
  // Wat elke detailpagina laat zien
  const DETAIL = {
    'Beddenreus': { charts: [['revenue', 'Omzet'], ['roas', 'ROAS']], grains: ['maand', 'week'], extra: ['vorig_jaar', 'producten'] },
    'Beko NL': { charts: [['spend', 'Kosten'], ['leads', 'Leads'], ['cpa', 'CPA']], grains: ['dag', 'week', 'maand'], extra: ['top_ads'] },
    'Beko BE': { charts: [['spend', 'Kosten'], ['leads', 'Leads'], ['cpa', 'CPA']], grains: ['dag', 'week', 'maand'], extra: ['top_ads'] },
    'Whirlpool NL': { charts: [['spend', 'Kosten'], ['leads', 'Leads'], ['cpa', 'CPA']], grains: ['dag', 'week', 'maand'], extra: ['top_ads'] },
    'Whirlpool BE': { charts: [['spend', 'Kosten'], ['leads', 'Leads'], ['cpa', 'CPA']], grains: ['dag', 'week', 'maand'], extra: ['top_ads'] },
    'Pure Goat Company': { charts: [['revenue', 'Omzet'], ['roas', 'ROAS'], ['new_buyers', 'Nieuwe kopers'], ['cpa', 'CPA']], grains: ['dag', 'week', 'maand'], extra: ['landen'] },
    'Public Search': { charts: [['spend', 'Kosten'], ['applications', 'Sollicitaties'], ['cpa', 'CPA']], grains: ['dag', 'week', 'maand'], extra: ['bronnen'] },
    'Quality Lodgings': { charts: [['spend', 'Kosten'], ['bookings', 'Booking complete'], ['cpa', 'CPA']], grains: ['dag', 'week', 'maand'], extra: ['bronnen'] },
  };
  const GRAIN_LABEL = { dag: 'Per dag', week: 'Per week', maand: 'Per maand' };
  const GRAIN_NOTE = { dag: 'Laatste 30 dagen.', week: 'Weken van dit jaar (maandag t/m zondag).', maand: 'Laatste 12 maanden.' };
  const MAAND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const DAGN = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  const eur0 = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const eur2 = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const n0 = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });
  const n2 = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct2 = new Intl.NumberFormat('nl-NL', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const compact = new Intl.NumberFormat('nl-NL', { notation: 'compact', maximumFractionDigits: 1 });
  const money = (v) => (Math.abs(v) < 100 ? eur2.format(v) : eur0.format(v));
  const count = (v) => n0.format(v);
  const FMT = { spend: money, revenue: money, cpa: (v) => eur2.format(v), roas: (v) => n2.format(v), conv_rate: (v) => pct2.format(v),
    transactions: count, leads: count, new_buyers: count, applications: count, bookings: count, items: count, conversions: count };
  const AXIS = { spend: (v) => '€' + compact.format(v), revenue: (v) => '€' + compact.format(v), cpa: (v) => '€' + compact.format(v), roas: (v) => n2.format(v) };
  const RATIO = new Set(['roas', 'cpa']);
  const SENSE = { spend: 0, revenue: 1, roas: 1, transactions: 1, conv_rate: 1, leads: 1, new_buyers: 1, applications: 1, bookings: 1, cpa: -1 };
  const enc = (s) => String(s).replace(/%/g, '%25').replace(/&/g, '%26').replace(/=/g, '%3D');
  const slug = (c) => 'klant-' + c.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const mark = (e, src, field, where) => { e.setAttribute('data-source', src); if (field) e.setAttribute('data-field', field); if (where) e.setAttribute('data-where', where); return e; };
  const dayLabel = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return `${DAGN[d.getUTCDay()]} ${d.getUTCDate()} ${MAAND[d.getUTCMonth()]}`; };
  const shortDate = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return `${d.getUTCDate()} ${MAAND[d.getUTCMonth()]}`; };
  const failedStatus = (s) => s.status !== 'ok' && s.status !== 'loading';
  const failLine = () => el('div', 'km-fail', 'Laden mislukt');

  const state = { client: null, grain: {}, period: {} };

  function delta(src, field, where, chg) {
    const d = el('span', 'km-d');
    if (chg == null) return d;
    const pct = Math.round(chg * 100);
    d.textContent = (pct > 0 ? '+' : pct < 0 ? '−' : '±') + Math.abs(pct) + '%';
    const s = (SENSE[field] ?? 0) * Math.sign(pct);
    if (s > 0) d.classList.add('km-good');
    if (s < 0) d.classList.add('km-bad');
    return mark(d, src, field + '_chg', where);
  }

  function seg(options, current, onPick, label) {
    const g = el('div', 'km-seg');
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', label);
    for (const [v, text] of options) {
      const b = el('button', null, text);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(v === current));
      b.addEventListener('click', () => { onPick(v); render(); });
      g.append(b);
    }
    return g;
  }

  function kpiTable(k, client, metrics) {
    const table = el('table', 'km-t km-kpi');
    const thead = el('thead'), htr = el('tr');
    htr.append(el('th', null, ''));
    for (const [, label] of PERIODS) htr.append(el('th', null, label));
    thead.append(htr);
    const tbody = el('tbody');
    for (const [f, label] of metrics) {
      const tr = el('tr');
      tr.append(el('td', null, label));
      for (const [p] of PERIODS) {
        const r = k.data.find((x) => x.client === client && x.period === p);
        const where = `client=${enc(client)}&period=${p}`;
        const td = el('td');
        const v = el('span', null, r && r[f] != null ? FMT[f](r[f]) : '—');
        if (r && r[f] != null) mark(v, 'klanten', f, where);
        td.append(v);
        if (r) td.append(delta('klanten', f, where, r[f + '_chg']));
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(thead, tbody);
    const wrap = el('div', 'km-tablewrap');
    wrap.append(table);
    return wrap;
  }

  function cardHead(client, withButton) {
    const head = el('div', 'km-card-head');
    head.append(el('h2', null, client));
    if (withButton) {
      const b = el('button', 'km-more', 'Details →');
      b.type = 'button';
      b.setAttribute('aria-label', 'Details van ' + client);
      b.addEventListener('click', () => openClient(client));
      head.append(b);
    }
    return head;
  }

  function openClient(client) {
    state.client = client;
    dash.setLink(slug(client));
    render();
    document.getElementById('overzicht').scrollIntoView();
  }

  function renderOverview(main, k) {
    const box = el('section', 'km-clients');
    box.id = 'klanten';
    if (k.status !== 'ok' || !k.data.length) {
      box.append(...(failedStatus(k) ? [el('div', 'km-card km-fail', 'Laden mislukt')] : CLIENTS.map(() => el('div', 'km-card km-skel dash-skeleton'))));
    } else {
      box.append(...CLIENTS.map(([client, metrics]) => {
        const card = el('article', 'km-card');
        card.id = slug(client) + '-kaart';
        card.append(cardHead(client, true), kpiTable(k, client, metrics));
        return card;
      }));
    }
    main.append(box);
  }

  // Kleine grafiek: staven voor aantallen en bedragen, een lijn voor ROAS en CPA
  function drawChart(box, rows, field, grain) {
    box.replaceChildren();
    const W = Math.max(260, box.clientWidth || 320), H = 170;
    const vals = rows.map((r) => r[field]);
    const max = d3.max(vals, (v) => v ?? 0) || 1;
    const y = d3.scaleLinear([0, max], [H - 22, 8]).nice();
    const ticks = y.ticks(3);
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img');
    const fmtAxis = AXIS[field] || ((v) => compact.format(v));
    const probe = svg.append('text').attr('font-size', 11);
    let left = 0;
    for (const t of ticks) { probe.text(fmtAxis(t)); left = Math.max(left, probe.node().getComputedTextLength()); }
    probe.remove();
    const mL = Math.ceil(left) + 8, mR = 4;
    const x = d3.scaleBand(rows.map((r) => r.key), [mL, W - mR]).padding(0.25);
    svg.append('g').selectAll('line').data(ticks).join('line').attr('x1', mL).attr('x2', W - mR).attr('y1', (t) => y(t)).attr('y2', (t) => y(t)).attr('stroke', 'var(--cds-chart-grid)').attr('stroke-width', 1);
    svg.append('g').selectAll('text').data(ticks).join('text').attr('x', mL - 6).attr('y', (t) => y(t)).attr('dy', '0.32em').attr('text-anchor', 'end').attr('font-size', 11).attr('fill', 'var(--color-fg-muted)').text(fmtAxis);
    const label = (r) => grain === 'dag' ? shortDate(r.start) : grain === 'week' ? r.key.replace('wk', 'wk ') : MAAND[+r.start.slice(5, 7) - 1] + (r.start.slice(5, 7) === '01' ? " '" + r.start.slice(2, 4) : '');
    const fit = Math.max(1, Math.floor((W - mL) / 46));
    const step = Math.max(1, Math.ceil(rows.length / fit));
    svg.append('g').selectAll('text').data(rows.filter((r, i) => (rows.length - 1 - i) % step === 0)).join('text')
      .attr('x', (r) => x(r.key) + x.bandwidth() / 2).attr('y', H - 5).attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', 'var(--color-fg-muted)').text(label);
    let marks;
    if (RATIO.has(field)) {
      const line = d3.line().defined((r) => r[field] != null).x((r) => x(r.key) + x.bandwidth() / 2).y((r) => y(r[field]));
      svg.append('path').datum(rows).attr('d', line).attr('fill', 'none').attr('stroke', 'var(--color-fg)').attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
      marks = svg.append('g').selectAll('circle').data(rows.filter((r) => r[field] != null)).join('circle')
        .attr('cx', (r) => x(r.key) + x.bandwidth() / 2).attr('cy', (r) => y(r[field])).attr('r', rows.length > 20 ? 2.5 : 3.5)
        .attr('fill', (r) => (r.partial ? 'var(--color-panel)' : 'var(--color-fg)')).attr('stroke', 'var(--color-fg)').attr('stroke-width', 1.5);
    } else {
      const bw = Math.min(32, x.bandwidth());
      const off = (x.bandwidth() - bw) / 2;
      marks = svg.append('g').selectAll('rect').data(rows).join('rect')
        .attr('x', (r) => x(r.key) + off).attr('width', bw).attr('y', (r) => y(r[field] || 0)).attr('height', (r) => Math.max(0, y(0) - y(r[field] || 0)))
        .attr('rx', Math.min(4, bw / 2)).attr('fill', 'var(--km-blue)').attr('opacity', (r) => (r.partial ? 0.45 : 1));
    }
    const tip = el('div', 'km-tip');
    tip.hidden = true;
    box.append(tip);
    const name = (r) => grain === 'dag' ? dayLabel(r.start) : grain === 'week' ? 'Week ' + +r.key.slice(2) + ' (vanaf ' + shortDate(r.start) + ')' : MAAND[+r.start.slice(5, 7) - 1] + ' ' + r.start.slice(0, 4);
    svg.append('g').selectAll('rect').data(rows).join('rect').attr('x', (r) => x(r.key)).attr('width', x.step()).attr('y', 0).attr('height', H - 22).attr('fill', 'transparent')
      .on('pointerenter pointermove', (ev, r) => {
        marks.attr('opacity', (o) => (o === r ? 1 : 0.45));
        tip.replaceChildren(el('span', null, name(r) + (r.partial ? ' (t/m gisteren)' : '')), document.createTextNode(r[field] == null ? '—' : FMT[field](r[field])));
        tip.hidden = false;
        const [px] = d3.pointer(ev, box);
        tip.style.left = Math.max(0, Math.min(box.clientWidth - tip.offsetWidth, px - tip.offsetWidth / 2)) + 'px';
        tip.style.top = '0px';
      })
      .on('pointerleave', () => { marks.attr('opacity', (r) => (!RATIO.has(field) && r.partial ? 0.45 : 1)); tip.hidden = true; });
  }

  function section(id, title, controls) {
    const sec = el('section', 'km-sec');
    sec.id = id;
    const head = el('div', 'km-sec-head');
    head.append(el('h3', null, title));
    if (controls) head.append(controls);
    sec.append(head);
    return sec;
  }

  function renderTrend(detail, client, cfg) {
    const grain = state.grain[client] || cfg.grains[0];
    const ctl = cfg.grains.length > 1 ? seg(cfg.grains.map((g) => [g, GRAIN_LABEL[g]]), grain, (g) => { state.grain[client] = g; }, 'Kies periode van de grafieken') : null;
    const sec = section('trend', 'Ontwikkeling', ctl);
    const t = dash.data('trend');
    const grid = el('div', 'km-charts');
    const ready = [];
    for (const [f, label] of cfg.charts) {
      const card = el('div', 'km-chartcard');
      card.id = 'grafiek-' + f;
      card.append(el('h4', null, label));
      const box = el('div', 'km-chart');
      box.setAttribute('aria-label', label + ' ' + GRAIN_LABEL[grain].toLowerCase());
      mark(box, 'trend');
      if (t.status === 'ok') ready.push([box, f]);
      else if (failedStatus(t)) box.append(failLine());
      else box.classList.add('dash-skeleton');
      card.append(box);
      grid.append(card);
    }
    sec.append(grid, el('p', 'km-note', GRAIN_NOTE[grain] + (grain !== 'dag' ? ' De lichtere staaf is de lopende periode t/m gisteren.' : '')));
    detail.append(sec);
    if (t.status === 'ok') {
      const rows = t.data.filter((r) => r.client === client && r.grain === grain);
      requestAnimationFrame(() => { for (const [box, f] of ready) rows.length ? drawChart(box, rows, f, grain) : box.append(el('p', 'km-empty', 'Nog geen gegevens.')); });
    }
  }

  // Tabel met één rij per data-rij; de sleutel staat op de <tr>
  function rowTable(src, keyCols, rows, cols) {
    const table = el('table', 'km-t');
    mark(table, src);
    table.setAttribute('data-row-key', keyCols.join(','));
    const thead = el('thead'), htr = el('tr');
    for (const [f, label, cls] of cols) { const th = el('th', cls || null, label); if (f) th.setAttribute('data-field', f); htr.append(th); }
    thead.append(htr);
    const tbody = el('tbody');
    for (const r of rows) {
      const tr = el('tr');
      tr.setAttribute('data-key', keyCols.map((c) => encodeURIComponent(String(r[c]))).join(','));
      for (const [f, , cls, fmt] of cols) tr.append(el('td', cls || null, r[f] == null ? '—' : fmt ? fmt(r[f]) : String(r[f])));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    const wrap = el('div', 'km-panel km-tablewrap');
    wrap.append(table);
    return wrap;
  }

  function tableSection(detail, id, title, src, periods, client, build) {
    const key = id + '|' + client;
    const cur = state.period[key] || periods[periods.length - 1][0];
    const sec = section(id, title, seg(periods, cur, (p) => { state.period[key] = p; }, 'Kies periode'));
    const d = dash.data(src);
    if (d.status !== 'ok') sec.append(failedStatus(d) ? failLine() : el('div', 'km-panel km-skel dash-skeleton'));
    else sec.append(build(d.data, cur));
    detail.append(sec);
  }

  function renderVorigJaar(detail) {
    const sec = section('vorig-jaar', 'Tegen vorig jaar');
    const v = dash.data('vorig_jaar');
    if (v.status !== 'ok') { sec.append(failedStatus(v) ? failLine() : el('div', 'km-panel km-skel dash-skeleton')); detail.append(sec); return; }
    const W = [['30d', 'Laatste 30 dagen'], ['ytd', 'Dit jaar t/m gisteren']];
    const wrap = el('div', 'km-panel km-tablewrap');
    for (const [w, title] of W) {
      const r = v.data.find((x) => x.window === w);
      const where = 'window=' + w;
      const table = el('table', 'km-t km-kpi');
      table.id = 'vorig-jaar-' + w;
      const thead = el('thead'), htr = el('tr');
      htr.append(el('th', null, title), el('th', null, 'Nu'), el('th', null, 'Vorig jaar'));
      thead.append(htr);
      const tbody = el('tbody');
      for (const [f, label] of [['spend', 'Kosten'], ['revenue', 'Omzet'], ['roas', 'ROAS']]) {
        const tr = el('tr');
        const td = el('td'), tdLy = el('td');
        if (r) {
          td.append(r[f] == null ? el('span', null, '—') : mark(el('span', null, FMT[f](r[f])), 'vorig_jaar', f, where), delta('vorig_jaar', f, where, r[f + '_chg']));
          tdLy.append(r[f + '_ly'] == null ? el('span', null, '—') : mark(el('span', null, FMT[f](r[f + '_ly'])), 'vorig_jaar', f + '_ly', where));
        }
        tr.append(el('td', null, label), td, tdLy);
        tbody.append(tr);
      }
      table.append(thead, tbody);
      wrap.append(table);
    }
    sec.append(wrap, el('p', 'km-note', 'Vergeleken met dezelfde week vorig jaar (52 weken terug, maandag tegen maandag). Kosten uit Meta en Google Ads, omzet uit GA4.'));
    detail.append(sec);
  }

  function renderDetail(main, k, client) {
    const cfg = DETAIL[client];
    const detail = el('div', 'km-detail');
    detail.id = slug(client);
    const back = el('button', 'km-back', '← Alle klanten');
    back.type = 'button';
    back.addEventListener('click', () => { state.client = null; dash.setLink('overzicht'); render(); });
    detail.append(back);
    const card = el('article', 'km-card');
    card.append(cardHead(client, false));
    if (k.status === 'ok' && k.data.length) card.append(kpiTable(k, client, CLIENTS.find(([c]) => c === client)[1]));
    else card.append(failedStatus(k) ? failLine() : el('div', 'km-skel dash-skeleton'));
    detail.append(card);
    renderTrend(detail, client, cfg);
    const P3 = [['gisteren', 'Gisteren'], ['7d', '7 dagen'], ['30d', '30 dagen']];
    for (const x of cfg.extra) {
      if (x === 'vorig_jaar') renderVorigJaar(detail);
      if (x === 'producten') tableSection(detail, 'producten', 'Top 15 verkochte producten', 'producten', P3, client, (rows, p) => {
        const rs = rows.filter((r) => r.period === p);
        return rs.length ? rowTable('producten', ['period', 'rank'], rs, [['rank', '#'], ['item_name', 'Product', 'km-name'], ['items', 'Aantal', null, FMT.items], ['revenue', 'Omzet', null, FMT.revenue]]) : el('p', 'km-empty', 'Geen verkopen in deze periode.');
      });
      if (x === 'top_ads') tableSection(detail, 'top-ads', 'Top 5 ads', 'top_ads', P3, client, (rows, p) => {
        const rs = rows.filter((r) => r.client === client && r.period === p);
        return rs.length ? rowTable('top_ads', ['client', 'period', 'rank'], rs, [['rank', '#'], ['ad_name', 'Ad', 'km-name'], ['spend', 'Kosten', null, FMT.spend], ['leads', 'Leads', null, FMT.leads], ['cpa', 'CPA', null, FMT.cpa]]) : el('p', 'km-empty', 'Geen ads met kosten in deze periode.');
      });
      if (x === 'landen') tableSection(detail, 'landen', 'Prestaties per land', 'landen', [['7d', '7 dagen'], ['30d', '30 dagen']], client, (rows, p) => {
        const rs = rows.filter((r) => r.period === p);
        return rs.length ? rowTable('landen', ['period', 'country'], rs, [['country', 'Land', 'km-name'], ['spend', 'Kosten', null, FMT.spend], ['revenue', 'Omzet', null, FMT.revenue], ['roas', 'ROAS', null, FMT.roas], ['new_buyers', 'Nieuwe kopers', null, FMT.new_buyers], ['cpa', 'CPA', null, FMT.cpa]]) : el('p', 'km-empty', 'Geen gegevens in deze periode.');
      });
      if (x === 'bronnen') {
        const conv = client === 'Public Search' ? 'Sollicitaties' : 'Booking complete';
        tableSection(detail, 'bronnen', 'Top 10 bronnen (GA4)', 'bronnen_tabel', P3, client, (rows, p) => {
          const rs = rows.filter((r) => r.client === client && r.period === p);
          const frag = document.createDocumentFragment();
          frag.append(rs.length ? rowTable('bronnen_tabel', ['client', 'period', 'rank'], rs, [['rank', '#'], ['bron', 'Bron', 'km-name'], ['conversions', conv, null, FMT.conversions], ['spend', 'Kosten', null, FMT.spend], ['cpa', 'CPA', null, FMT.cpa]]) : el('p', 'km-empty', 'Geen gegevens in deze periode.'),
            el('p', 'km-note', 'Betaald verkeer is samengevoegd per advertentieplatform, met de kosten van dat platform. Overige bronnen hebben geen kosten.'));
          return frag;
        });
      }
    }
    main.append(detail);
  }

  function render() {
    const k = dash.data('klanten');
    const sub = document.getElementById('km-sub');
    if (k.status === 'ok' && k.data.length) {
      sub.classList.remove('dash-skeleton');
      const date = mark(el('b', null, dayLabel(k.data[0].last_date)), 'klanten', 'last_date');
      date.setAttribute('data-row', '0');
      sub.replaceChildren('Cijfers t/m ', date, ', vergeleken met de periode ervoor.');
    } else {
      sub.classList.toggle('dash-skeleton', !failedStatus(k));
      sub.textContent = failedStatus(k) ? 'De cijfers konden niet worden geladen.' : '—';
    }
    const main = document.getElementById('km-main');
    main.replaceChildren();
    if (state.client && DETAIL[state.client]) renderDetail(main, k, state.client);
    else renderOverview(main, k);
  }

  // Een link naar een klant opent meteen die detailpagina
  const fromLink = CLIENTS.map(([c]) => c).find((c) => slug(c) === location.hash.slice(1));
  if (fromLink) state.client = fromLink;
  dash.onData(render);
})();

// API-sleutel, vernieuwen en installeren
(() => {
  const screen = document.getElementById('km-keyscreen');
  const app = document.getElementById('km-app');
  const input = document.getElementById('km-key');
  const msg = document.getElementById('km-key-msg');
  const updated = document.getElementById('km-updated');
  const show = (text) => {
    screen.hidden = false;
    app.hidden = true;
    msg.textContent = text || '';
    msg.hidden = !text;
  };
  const hide = () => { screen.hidden = true; app.hidden = false; };

  document.getElementById('km-key-save').addEventListener('click', () => {
    const k = input.value.trim();
    if (!k) { msg.textContent = 'Vul je API-sleutel in.'; msg.hidden = false; return; }
    setKey(k);
    input.value = '';
    hide();
    dash.reset();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('km-key-save').click(); });
  document.getElementById('km-refresh').addEventListener('click', () => dash.refresh());
  document.getElementById('km-change-key').addEventListener('click', () => show(''));
  document.getElementById('km-key-cancel').addEventListener('click', () => { if (getKey()) hide(); });

  if (!getKey()) show('');
  dash.onData(() => {
    if (!getKey()) return;
    if (dash.keyProblem()) { setKey(''); show('Windsor.ai accepteert deze API-sleutel niet. Controleer hem en vul hem opnieuw in.'); return; }
    const at = dash.lastUpdate();
    updated.textContent = at ? 'Cijfers opgehaald om ' + new Date(at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '';
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
