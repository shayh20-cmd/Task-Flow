// Recipe extraction from a web page — no AI.
// Order: 1) Schema.org Recipe as JSON-LD  2) Schema.org Microdata  3) Open Graph link card.
import * as cheerio from 'cheerio';
import { safeFetch } from './net.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export async function fetchPage(url, { timeoutMs = 15000 } = {}) {
  const res = await safeFetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'he,en;q=0.8' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`האתר החזיר שגיאה ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (type && !/html|xml/i.test(type)) throw new Error('הקישור אינו דף אינטרנט');
  return { html: await res.text(), finalUrl: res.finalUrl || url };
}

export async function extractFromUrl(url) {
  const { html, finalUrl } = await fetchPage(url);
  return extractFromHtml(html, finalUrl);
}

/** Returns { method: 'jsonld'|'microdata'|'link', recipe: {...} } */
export function extractFromHtml(html, url = '') {
  const $ = cheerio.load(html);
  const og = readOpenGraph($, url);

  const ld = findJsonLdRecipe($);
  if (ld) return { method: 'jsonld', recipe: finalize(normalizeRecipe(ld, url), og, url) };

  const md = readMicrodata($, url);
  if (md) return { method: 'microdata', recipe: finalize(md, og, url) };

  return {
    method: 'link',
    recipe: finalize({ title: og.title, description: og.description, image: og.image, ingredients: [], steps: [] }, og, url),
  };
}

// ---------- JSON-LD ----------

function findJsonLdRecipe($) {
  const candidates = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    const data = parseJsonLoose(raw);
    if (data) collectRecipes(data, candidates, 0);
  });
  // Prefer the candidate with the most content.
  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0] || null;
}

function score(r) {
  return (r.recipeIngredient?.length || r.ingredients?.length || 0) + (r.recipeInstructions ? 5 : 0);
}

function parseJsonLoose(raw) {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .replace(/^<!--/, '')
    .replace(/-->$/, '')
    .replace(/^\s*\/\/\s*<!\[CDATA\[/, '')
    .replace(/\/\/\s*\]\]>\s*$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    // Some sites leave raw control characters (newlines/tabs) inside strings.
    try {
      return JSON.parse(cleaned.replace(/[\u0000-\u001F]+/g, ' '));
    } catch {
      return null;
    }
  }
}

function isType(node, type) {
  const t = node?.['@type'];
  if (!t) return false;
  const list = Array.isArray(t) ? t : [t];
  return list.some((x) => String(x).replace(/^.*[/#:]/, '').toLowerCase() === type.toLowerCase());
}

function collectRecipes(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > 8) return;
  if (Array.isArray(node)) {
    for (const n of node) collectRecipes(n, out, depth + 1);
    return;
  }
  if (isType(node, 'Recipe')) out.push(node);
  if (node['@graph']) collectRecipes(node['@graph'], out, depth + 1);
  for (const key of ['mainEntity', 'mainEntityOfPage', 'itemListElement', 'item', 'hasPart']) {
    if (node[key] && typeof node[key] === 'object') collectRecipes(node[key], out, depth + 1);
  }
}

function normalizeRecipe(r, url) {
  return {
    title: text(r.name || r.headline),
    description: text(r.description),
    image: pickImage(r.image, url),
    author: pickName(r.author),
    ingredients: toList(r.recipeIngredient || r.ingredients).map(text).filter(Boolean),
    steps: flattenInstructions(r.recipeInstructions),
    prepMinutes: isoDurationToMinutes(r.prepTime),
    cookMinutes: isoDurationToMinutes(r.cookTime),
    totalMinutes: isoDurationToMinutes(r.totalTime),
    servings: pickYield(r.recipeYield),
    category: toList(r.recipeCategory).map(text).filter(Boolean),
    cuisine: toList(r.recipeCuisine).map(text).filter(Boolean),
    keywords: splitKeywords(r.keywords),
  };
}

/** Steps become a flat list of strings; a HowToSection name becomes a "## heading" line. */
function flattenInstructions(ins) {
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (typeof node === 'string') {
      const t = text(node);
      if (!t) return;
      // A single blob of text: split into lines/sentences that look like steps.
      const parts = t.includes('\n') ? t.split(/\n+/) : [t];
      for (const p of parts) if (p.trim()) out.push(p.trim());
      return;
    }
    if (Array.isArray(node)) return node.forEach(walk);
    if (isType(node, 'HowToSection')) {
      if (node.name) out.push('## ' + text(node.name));
      return walk(node.itemListElement || node.steps);
    }
    if (isType(node, 'HowToStep') || isType(node, 'HowToDirection') || isType(node, 'HowToTip') || node.text) {
      const t = text(node.text || node.name || node.description);
      if (t) out.push(t);
      return;
    }
    if (node.itemListElement) walk(node.itemListElement);
  };
  // Keep line breaks inside plain-string instructions before text() collapses them.
  if (typeof ins === 'string') {
    const decoded = decodeEntities(stripTags(ins.replace(/<\/(p|li|div)>|<br\s*\/?>/gi, '\n')));
    return decoded.split(/\n+/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
  walk(ins);
  return out;
}

// ---------- Microdata ----------

function readMicrodata($, url) {
  const scope = $('[itemscope][itemtype*="schema.org/Recipe" i]').first();
  if (!scope.length) return null;
  const prop = (name) => scope.find(`[itemprop="${name}"]`);
  const val = (el) => {
    const $el = $(el);
    return text($el.attr('content') || $el.attr('datetime') || $el.attr('src') || $el.attr('href') || $el.text());
  };
  const ingredients = [...prop('recipeIngredient'), ...prop('ingredients')].map(val).filter(Boolean);
  let steps = [];
  const ins = prop('recipeInstructions');
  ins.each((_, el) => {
    const lis = $(el).find('li');
    if (lis.length) lis.each((__, li) => steps.push(text($(li).text())));
    else steps.push(...$(el).text().split(/\n+/).map(text));
  });
  steps = steps.filter(Boolean);
  const img = prop('image').first();
  return {
    title: val(prop('name').first()),
    description: val(prop('description').first()),
    image: absUrl(img.attr('src') || img.attr('content') || img.attr('href'), url),
    author: val(prop('author').first()),
    ingredients,
    steps,
    prepMinutes: isoDurationToMinutes(val(prop('prepTime').first())),
    cookMinutes: isoDurationToMinutes(val(prop('cookTime').first())),
    totalMinutes: isoDurationToMinutes(val(prop('totalTime').first())),
    servings: pickYield(val(prop('recipeYield').first())),
    category: prop('recipeCategory').map((_, e) => val(e)).get().filter(Boolean),
    cuisine: prop('recipeCuisine').map((_, e) => val(e)).get().filter(Boolean),
    keywords: splitKeywords(val(prop('keywords').first())),
  };
}

// ---------- Open Graph ----------

function readOpenGraph($, url) {
  const meta = (...names) => {
    for (const n of names) {
      const v = $(`meta[property="${n}"]`).attr('content') || $(`meta[name="${n}"]`).attr('content');
      if (v) return text(v);
    }
    return '';
  };
  return {
    title: meta('og:title', 'twitter:title') || text($('title').first().text()),
    description: meta('og:description', 'twitter:description', 'description'),
    image: absUrl(meta('og:image', 'og:image:url', 'twitter:image'), url),
    siteName: meta('og:site_name') || hostOf(url),
  };
}

function finalize(r, og, url) {
  const total = r.totalMinutes || (r.prepMinutes || 0) + (r.cookMinutes || 0) || null;
  return {
    title: r.title || og.title || hostOf(url) || 'מתכון ללא שם',
    description: r.description || og.description || '',
    image: r.image || og.image || '',
    author: r.author || '',
    sourceUrl: url,
    sourceName: og.siteName || hostOf(url),
    ingredients: dedupe(r.ingredients || []),
    steps: r.steps || [],
    prepMinutes: r.prepMinutes || null,
    cookMinutes: r.cookMinutes || null,
    totalMinutes: total,
    servings: r.servings || '',
    suggestedTags: dedupe([...(r.category || []), ...(r.cuisine || []), ...(r.keywords || [])].map((t) => t.trim()))
      .filter((t) => t && t.length <= 30)
      .slice(0, 12),
  };
}

// ---------- helpers ----------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
function stripTags(s) {
  return s.replace(/<[^>]*>/g, ' ');
}
function text(v) {
  if (v == null) return '';
  if (typeof v === 'object') v = v['@value'] ?? v.name ?? v.text ?? '';
  // Decode twice: some sites double-encode (&amp;quot;).
  return decodeEntities(decodeEntities(stripTags(String(v)))).replace(/\s+/g, ' ').trim();
}
function toList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
function dedupe(arr) {
  const seen = new Set();
  return arr.filter((x) => {
    const k = String(x).toLowerCase();
    if (!x || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function splitKeywords(k) {
  if (!k) return [];
  if (Array.isArray(k)) return k.map(text).filter(Boolean);
  return text(k).split(/[,،;|]/).map((s) => s.trim()).filter(Boolean);
}
function pickName(a) {
  const first = toList(a)[0];
  if (!first) return '';
  return typeof first === 'string' ? text(first) : text(first.name);
}
function pickImage(img, base) {
  const first = toList(img)[0];
  if (!first) return '';
  if (typeof first === 'string') return absUrl(first, base);
  return absUrl(first.url || first.contentUrl || first['@id'], base);
}
function pickYield(y) {
  const list = toList(y).map(text).filter(Boolean);
  if (!list.length) return '';
  // Prefer the more descriptive variant ("4 מנות" over "4").
  return list.sort((a, b) => b.length - a.length)[0];
}
function absUrl(u, base) {
  if (!u) return '';
  try {
    return new URL(u, base || undefined).href;
  } catch {
    return /^https?:\/\//.test(u) ? u : '';
  }
}
function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** "PT1H30M" -> 90, "P0DT45M" -> 45, "30" -> 30 */
export function isoDurationToMinutes(d) {
  if (d == null || d === '') return null;
  if (typeof d === 'number') return d > 0 ? Math.round(d) : null;
  const s = String(d).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10) || null;
  const m = s.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!m) return null;
  const [, D, H, M, S] = m.map((x) => (x ? parseFloat(x) : 0));
  const total = Math.round(D * 1440 + H * 60 + M + S / 60);
  return total > 0 ? total : null;
}
