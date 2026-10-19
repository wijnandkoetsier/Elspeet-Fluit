// Datalaag: alles komt van de WordPress-site van de club.
// - Nieuws, verslagen, foto's en pagina's: de standaard WordPress REST API (live).
// - Programma, uitslagen, standen, teams, agenda, sponsors: /wp-json/vve/v1/app,
//   met de momentopname in data/snapshot.json als terugval.
import { SITE, APP_ENDPOINT } from './config.js';

const WP = `${SITE}/wp-json/wp/v2`;
const memo = new Map();

async function getJson(url, { timeout = 8000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function cached(key, fn) {
  if (!memo.has(key)) memo.set(key, fn().catch((e) => { memo.delete(key); throw e; }));
  return memo.get(key);
}

/** Clubdata (programma, teams, …). Geeft altijd iets terug: live, of anders de momentopname. */
export function clubData() {
  return cached('club', async () => {
    try {
      const live = await getJson(APP_ENDPOINT, { timeout: 5000 });
      if (live && Array.isArray(live.matches)) return { ...(await snapshot()), ...live, source: 'live' };
    } catch { /* endpoint bestaat nog niet of geen verbinding */ }
    return snapshot();
  });
}

function snapshot() {
  return cached('snapshot', () => getJson(new URL('../data/snapshot.json', import.meta.url).href));
}

export function categories() {
  return cached('cats', async () => {
    const list = await getJson(`${WP}/categories?per_page=100&_fields=id,slug,name,count`);
    return list.filter((c) => c.slug !== 'uncategorized');
  });
}

export async function categoryBySlug(slug) {
  return (await categories()).find((c) => c.slug === slug) || null;
}

const POST_FIELDS = 'id,date,link,title,excerpt,categories,featured_media,_links.wp:featuredmedia,_embedded';

/** Berichten, optioneel binnen één categorie (slug). */
export function posts({ category = '', page = 1, perPage = 10 } = {}) {
  return cached(`posts:${category}:${page}:${perPage}`, async () => {
    let q = `per_page=${perPage}&page=${page}&_embed=wp:featuredmedia&_fields=${POST_FIELDS}`;
    if (category) {
      const cat = await categoryBySlug(category);
      if (!cat) return [];
      q += `&categories=${cat.id}`;
    }
    return (await getJson(`${WP}/posts?${q}`)).map(normalizePost);
  });
}

export function post(id) {
  return cached(`post:${id}`, async () => normalizePost(await getJson(`${WP}/posts/${id}?_embed=wp:featuredmedia`)));
}

/** Een gewone WordPress-pagina (bijv. "contributie") om binnen de app te tonen. */
export function page(slug) {
  return cached(`page:${slug}`, async () => {
    // Eerst het app-endpoint (levert ook themapagina's), anders de gewone WordPress-pagina.
    try {
      const a = await getJson(`${SITE}/wp-json/vve/v1/pagina/${encodeURIComponent(slug)}`, { timeout: 5000 });
      if (a?.html) return a;
    } catch { /* endpoint bestaat nog niet */ }
    const [p] = await getJson(`${WP}/pages?slug=${encodeURIComponent(slug)}&_fields=id,title,content,link`);
    if (!p) throw new Error('Pagina niet gevonden');
    return { title: text(p.title.rendered), html: p.content.rendered, link: p.link };
  });
}

/** Recente foto's uit de mediabibliotheek. */
export function photos({ perPage = 24 } = {}) {
  return cached(`photos:${perPage}`, async () => {
    const list = await getJson(`${WP}/media?media_type=image&per_page=${perPage}&_fields=id,date,alt_text,caption,media_details,source_url,post`);
    return list.map((m) => {
      const s = m.media_details?.sizes || {};
      return {
        id: m.id,
        thumb: (s.medium_large || s.medium || s.full || {}).source_url || m.source_url,
        full: (s.large || s.full || {}).source_url || m.source_url,
        alt: m.alt_text || text(m.caption?.rendered || ''),
        post: m.post,
      };
    });
  });
}

function normalizePost(p) {
  const media = p._embedded?.['wp:featuredmedia']?.[0];
  const sizes = media?.media_details?.sizes || {};
  return {
    id: p.id,
    date: p.date,
    link: p.link,
    title: text(p.title?.rendered || ''),
    excerpt: text(p.excerpt?.rendered || ''),
    html: p.content?.rendered || '',
    categories: p.categories || [],
    image: media ? (sizes.medium_large || sizes.large || sizes.full || {}).source_url || media.source_url : '',
  };
}

/** HTML-entiteiten en tags weg: "Elspeet VR1 &#8211; ESC" → "Elspeet VR1 – ESC". */
export function text(htmlStr) {
  const d = new DOMParser().parseFromString(htmlStr, 'text/html');
  return (d.body.textContent || '').replace(/\s+/g, ' ').trim();
}

/** WordPress-HTML veilig maken om in de app te tonen. */
export function cleanHtml(htmlStr) {
  const d = new DOMParser().parseFromString(htmlStr, 'text/html');
  d.querySelectorAll('script,style,form,object,embed,link,meta').forEach((n) => n.remove());
  d.querySelectorAll('iframe').forEach((f) => {
    const src = f.getAttribute('src') || '';
    if (!/^https:\/\/(www\.)?(youtube(-nocookie)?\.com|player\.vimeo\.com)\//.test(src)) f.remove();
  });
  d.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    }
    if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
    if (el.tagName === 'IMG') { el.setAttribute('loading', 'lazy'); el.removeAttribute('width'); el.removeAttribute('height'); }
  });
  return d.body.innerHTML;
}
