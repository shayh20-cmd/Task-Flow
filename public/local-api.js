// On-device backend for the Android app: answers the same /api/* calls as the Node server,
// but stores everything in IndexedDB on the phone. Images are kept as (resized) blobs.
import { autoTags, AUTO_TAGS } from './shared/autotag.js';
import { extractFromHtml, parseDoc } from './shared/extract-dom.js';
import { instagramPost, importInstagram } from './shared/instagram.js';
import { DEFAULT_CATEGORIES, suggestCategory } from './shared/category.js';

const DB_NAME = 'recipin';
const DB_VERSION = 3; // v2: 'tags' store for tags created in tag management · v3: 'categories'
let dbPromise;

function openDb() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('recipes')) db.createObjectStore('recipes', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('collections')) db.createObjectStore('collections', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('tags')) db.createObjectStore('tags', { keyPath: 'tag' });
      if (!db.objectStoreNames.contains('categories')) {
        const cats = db.createObjectStore('categories', { keyPath: 'name' });
        DEFAULT_CATEGORIES.forEach((name, position) => cats.put({ name, position }));
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
const done = (req) => new Promise((res, rej) => ((req.onsuccess = () => res(req.result)), (req.onerror = () => rej(req.error))));
async function store(name, mode = 'readonly') {
  return (await openDb()).transaction(name, mode).objectStore(name);
}
const getAll = async (name) => done((await store(name)).getAll());
const getOne = async (name, id) => done((await store(name)).get(id));
const put = async (name, value) => done((await store(name, 'readwrite')).put(value));
const del = async (name, id) => done((await store(name, 'readwrite')).delete(id));
const clear = async (name) => done((await store(name, 'readwrite')).clear());

// ---------- images: "idb:<id>" in storage, blob: URLs in the UI ----------
const urlById = new Map();
const idByUrl = new Map();
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function imageUrl(ref) {
  if (!ref || !ref.startsWith('idb:')) return ref || '';
  const id = ref.slice(4);
  if (urlById.has(id)) return urlById.get(id);
  const rec = await getOne('images', id);
  if (!rec) return '';
  const url = URL.createObjectURL(rec.blob);
  urlById.set(id, url);
  idByUrl.set(url, id);
  return url;
}

async function resize(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    return await new Promise((res) => canvas.toBlob((b) => res(b || file), 'image/jpeg', 0.85));
  } catch {
    return file; // format the WebView can't decode: keep the original
  }
}

async function saveImage(blob) {
  const id = newId();
  await put('images', { id, blob });
  const url = URL.createObjectURL(blob);
  urlById.set(id, url);
  idByUrl.set(url, id);
  return { ref: 'idb:' + id, url };
}

/** UI value → stored value. Remote images are downloaded so the recipe keeps its photo offline. */
async function toRef(u) {
  if (!u) return '';
  if (u.startsWith('idb:')) return u;
  if (idByUrl.has(u)) return 'idb:' + idByUrl.get(u);
  if (/^https?:\/\//i.test(u)) {
    try {
      const r = await fetch(u);
      const blob = await r.blob();
      if (r.ok && blob.type.startsWith('image/') && blob.size < 15e6) return (await saveImage(await resize(blob))).ref;
    } catch {
      /* offline or blocked: keep the remote URL */
    }
  }
  return u;
}

async function present(r) {
  return { ...r, cover: await imageUrl(r.cover), images: await Promise.all((r.images || []).map(imageUrl)) };
}

// ---------- recipes ----------
const toList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const str = (v, n = 2000) => String(v ?? '').slice(0, n);
const minutes = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Math.round(Number(v)));

async function cleanRecipe(body, prev = {}) {
  const r = { ...prev };
  for (const k of ['kind', 'title', 'description', 'notes', 'sourceUrl', 'sourceName', 'author', 'servings', 'category'])
    if (body[k] !== undefined) r[k] = str(body[k], k === 'notes' || k === 'description' ? 20000 : 2000);
  for (const k of ['ingredients', 'steps']) if (body[k] !== undefined) r[k] = toList(body[k]).map((x) => String(x).trim()).filter(Boolean);
  for (const k of ['prepMinutes', 'cookMinutes', 'totalMinutes']) if (body[k] !== undefined) r[k] = minutes(body[k]);
  if (body.favorite !== undefined) r.favorite = !!body.favorite;
  if (body.collections !== undefined) r.collections = toList(body.collections).map(Number).filter(Boolean);
  if (body.tags !== undefined) {
    const clean = (t) => String(t).trim().replace(/^#/, '').slice(0, 40);
    r.tags = [...new Set(toList(body.tags).map(clean).filter(Boolean))];
    const auto = new Set(toList(body.autoTags).map(clean));
    r.autoTags = r.tags.filter((t) => auto.has(t));
  }
  if (body.cover !== undefined) r.cover = await toRef(body.cover);
  if (body.images !== undefined) r.images = await Promise.all(toList(body.images).map(toRef));
  if (r.kind && !['manual', 'photo', 'link'].includes(r.kind)) r.kind = 'manual';
  return r;
}

const DEFAULTS = {
  kind: 'manual', title: '', description: '', cover: '', images: [], ingredients: [], steps: [], notes: '',
  sourceUrl: '', sourceName: '', author: '', prepMinutes: null, cookMinutes: null, totalMinutes: null,
  servings: '', favorite: false, category: '', tags: [], autoTags: [], collections: [],
};

function matches(r, { q, tags, collection, favorite, category }) {
  if (favorite && !r.favorite) return false;
  if (category && (r.category || '') !== category) return false;
  if (collection && !r.collections.includes(collection)) return false;
  for (const t of tags) if (!r.tags.includes(t)) return false;
  if (q) {
    const hay = [r.title, r.description, r.notes, r.sourceName, ...r.ingredients, ...r.tags].join('\n').toLowerCase();
    if (!hay.includes(q.toLowerCase())) return false;
  }
  return true;
}
const newestFirst = (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.id - a.id;

async function listRecipes(params) {
  const all = (await getAll('recipes')).filter((r) => matches(r, params)).sort(newestFirst);
  return Promise.all(all.map(present));
}

// ---------- collections ----------
async function listCollections() {
  const [cols, recipes] = await Promise.all([getAll('collections'), getAll('recipes')]);
  recipes.sort(newestFirst);
  const out = [];
  for (const c of cols) {
    const inCol = recipes.filter((r) => r.collections.includes(c.id));
    const covers = await Promise.all(inCol.filter((r) => r.cover).slice(0, 4).map((r) => imageUrl(r.cover)));
    out.push({ ...c, count: inCol.length, covers });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

// ---------- import from link (native HTTP in the app, so no CORS) ----------
const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
async function importUrl(body) {
  let url = String(body.url || '').trim();
  const m = url.match(/https?:\/\/\S+/);
  if (m) url = m[0];
  if (!/^https?:\/\//i.test(url)) throw Object.assign(new Error('נא להדביק קישור שמתחיל ב-http'), { status: 400 });
  let result;
  if (instagramPost(url) && !body.html) {
    const fetchText = async (u, headers) => {
      const r = await fetch(u, { headers });
      if (!r.ok) throw new Error(`שגיאה ${r.status}`);
      return r.text();
    };
    result = await importInstagram(url, { fetchText, parse: (h) => parseDoc(h) }).catch((e) => ({
      method: 'link', source: 'instagram', error: e.message,
      recipe: { title: 'מתכון מאינסטגרם', sourceUrl: url, sourceName: 'Instagram', ingredients: [], steps: [], suggestedTags: [] },
    }));
  } else try {
    let html = body.html;
    let finalUrl = url;
    if (!html) {
      const res = await fetch(url, { headers: { 'Accept-Language': 'he,en;q=0.8', Accept: 'text/html' } });
      if (!res.ok) throw new Error(`האתר החזיר שגיאה ${res.status}`);
      html = await res.text();
      finalUrl = res.url || url;
    }
    result = extractFromHtml(String(html), finalUrl);
  } catch (e) {
    const msg = /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'אין חיבור לאתר' : e.message;
    result = { method: 'link', error: msg, recipe: { title: '', sourceUrl: url, sourceName: hostOf(url), ingredients: [], steps: [], suggestedTags: [] } };
  }
  const recipes = await getAll('recipes');
  const dupRec = recipes.find((r) => r.sourceUrl && (r.sourceUrl === url || r.sourceUrl === result.recipe.sourceUrl));
  return { ...result, autoTags: autoTags(result.recipe), duplicate: dupRec ? { id: dupRec.id, title: dupRec.title } : null };
}

// ---------- backup ----------
const blobToB64 = (blob) =>
  new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
const b64ToBlob = (b64, type) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};

export async function exportBackup() {
  const [recipes, collections, images, tags, categories] = await Promise.all([getAll('recipes'), getAll('collections'), getAll('images'), getAll('tags'), getAll('categories')]);
  const imgs = [];
  for (const i of images) imgs.push({ id: i.id, type: i.blob.type || 'image/jpeg', data: await blobToB64(i.blob) });
  return { app: 'recipin', version: 1, exportedAt: new Date().toISOString(), recipes, collections, tags, categories, images: imgs };
}

/** Replaces everything on the device with the backup's content. */
export async function restoreBackup(data) {
  if (!data || data.app !== 'recipin' || !Array.isArray(data.recipes)) throw new Error('הקובץ אינו גיבוי של Recipin');
  await Promise.all([clear('recipes'), clear('collections'), clear('images'), clear('tags')]);
  for (const t of data.tags || []) await put('tags', t);
  if (Array.isArray(data.categories) && data.categories.length) {
    await clear('categories');
    for (const c of data.categories) await put('categories', c);
  }
  for (const i of data.images || []) await put('images', { id: i.id, blob: b64ToBlob(i.data, i.type) });
  for (const c of data.collections || []) await put('collections', c);
  for (const r of data.recipes) await put('recipes', { ...DEFAULTS, ...r });
  urlById.clear();
  idByUrl.clear();
  return { recipes: data.recipes.length };
}

/**
 * One-time update after the auto-tag rules change: recompute only the automatic tags of each recipe
 * (manual tags and a manually chosen kashrut stay). Runs once per rules version.
 */
const AUTOTAG_RULES_VERSION = '2';
export async function refreshAutoTagsOnce() {
  try {
    if (localStorage.getItem('recipin-autotag-rules') === AUTOTAG_RULES_VERSION) return 0;
  } catch {
    return 0;
  }
  const KOSHER = ['בשרי', 'חלבי', 'פרווה'];
  let changed = 0;
  for (const r of await getAll('recipes')) {
    const oldAuto = new Set(r.autoTags || []);
    const manual = r.tags.filter((t) => !oldAuto.has(t));
    const manualKosher = manual.some((t) => KOSHER.includes(t));
    let fresh = autoTags(r);
    if (manualKosher) fresh = fresh.filter((t) => !KOSHER.includes(t));
    const tags = [...new Set([...fresh, ...manual])];
    if (tags.join('|') !== r.tags.join('|')) {
      await put('recipes', { ...r, tags, autoTags: fresh });
      changed++;
    }
  }
  try {
    localStorage.setItem('recipin-autotag-rules', AUTOTAG_RULES_VERSION);
  } catch {
    /* ignore */
  }
  return changed;
}

/** One-time: existing recipes without a category get a suggested one (they can be changed later). */
export async function assignCategoriesOnce() {
  try {
    if (localStorage.getItem('recipin-categories-assigned') === '1') return 0;
  } catch {
    return 0;
  }
  let n = 0;
  for (const r of await getAll('recipes')) {
    if (r.category) continue;
    const c = suggestCategory(r);
    if (c) {
      await put('recipes', { ...r, category: c });
      n++;
    }
  }
  try {
    localStorage.setItem('recipin-categories-assigned', '1');
  } catch {
    /* ignore */
  }
  return n;
}

export async function stats() {
  const [recipes, collections, images] = await Promise.all([getAll('recipes'), getAll('collections'), getAll('images')]);
  const bytes = images.reduce((s, i) => s + (i.blob?.size || 0), 0);
  return { recipes: recipes.length, collections: collections.length, images: images.length, bytes };
}

// ---------- router ----------
const err = (status, message) => Object.assign(new Error(message), { status });

export async function localApi(path, { method = 'GET', body, form } = {}) {
  const u = new URL(path, 'http://local');
  const parts = u.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const [res, idStr] = parts;
  const id = Number(idStr);
  const now = new Date().toISOString();

  if (res === 'recipes') {
    if (!idStr && method === 'GET')
      return listRecipes({
        q: (u.searchParams.get('q') || '').trim(),
        tags: u.searchParams.getAll('tag'),
        collection: Number(u.searchParams.get('collection')) || null,
        favorite: u.searchParams.get('favorite') === '1',
        category: u.searchParams.get('category') || '',
      });
    if (!idStr && method === 'POST') {
      const r = await cleanRecipe(body, { ...DEFAULTS });
      if (!r.title.trim()) throw err(400, 'חסרה כותרת למתכון');
      r.createdAt = r.updatedAt = now;
      r.id = await put('recipes', r);
      return present(r);
    }
    const prev = await getOne('recipes', id);
    if (!prev) throw err(404, 'המתכון לא נמצא');
    if (method === 'GET') return present(prev);
    if (method === 'PUT') {
      const r = await cleanRecipe(body, prev);
      r.updatedAt = now;
      await put('recipes', r);
      return present(r);
    }
    if (method === 'DELETE') {
      await del('recipes', id);
      const refs = [prev.cover, ...(prev.images || [])].filter((x) => x?.startsWith('idb:'));
      for (const ref of refs) await del('images', ref.slice(4));
      return null;
    }
  }

  if (res === 'uploads' && method === 'POST') {
    const files = form ? form.getAll('files') : [];
    const out = [];
    for (const f of files) {
      if (!f.type?.startsWith('image/')) continue;
      if (f.size > 25e6) throw err(413, 'הקובץ גדול מדי');
      out.push({ url: (await saveImage(await resize(f))).url });
    }
    return { files: out };
  }

  if (res === 'import' && method === 'POST') return importUrl(body || {});

  if (res === 'autotags' && method === 'POST')
    return { tags: autoTags({ ingredients: toList(body?.ingredients).map(String), totalMinutes: Number(body?.totalMinutes) || null }) };

  if (res === 'categories') {
    const name = (v) => String(v ?? '').trim().slice(0, 40);
    const cats = (await getAll('categories')).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'he'));
    if (!idStr && method === 'GET') {
      const recipes = await getAll('recipes');
      return cats.map((c) => ({ ...c, count: recipes.filter((r) => r.category === c.name).length }));
    }
    if (!idStr && method === 'POST') {
      const n = name(body?.name);
      if (!n) throw err(400, 'חסר שם לקטגוריה');
      if (!cats.some((c) => c.name === n)) await put('categories', { name: n, position: cats.length });
      return { name: n };
    }
    if (idStr === 'order' && method === 'PUT') {
      const names = toList(body?.names).map(name);
      for (const c of cats) await put('categories', { ...c, position: names.indexOf(c.name) < 0 ? 999 : names.indexOf(c.name) });
      return localApi('/api/categories');
    }
    const from = name(decodeURIComponent(idStr));
    if (method === 'PUT') {
      const to = name(body?.name);
      if (!to) throw err(400, 'חסר שם לקטגוריה');
      const old = cats.find((c) => c.name === from);
      await del('categories', from);
      if (!cats.some((c) => c.name === to)) await put('categories', { name: to, position: old?.position ?? cats.length });
      for (const r of await getAll('recipes')) if (r.category === from) await put('recipes', { ...r, category: to });
      return { name: to };
    }
    if (method === 'DELETE') {
      await del('categories', from);
      for (const r of await getAll('recipes')) if (r.category === from) await put('recipes', { ...r, category: '' });
      return null;
    }
  }

  if (res === 'tags') {
    const name = (v) => String(v ?? '').trim().replace(/^#/, '').slice(0, 40);
    const tag = idStr ? name(decodeURIComponent(idStr)) : '';
    const sub = parts[2];
    if (!idStr && method === 'GET') {
      const counts = {};
      for (const t of await getAll('tags')) counts[t.tag] = 0;
      for (const r of await getAll('recipes')) for (const t of r.tags) counts[t] = (counts[t] || 0) + 1;
      return Object.entries(counts)
        .map(([t, count]) => ({ tag: t, count, auto: AUTO_TAGS.includes(t) }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'he'));
    }
    if (!idStr && method === 'POST') {
      const t = name(body?.name);
      if (!t) throw err(400, 'חסר שם לתגית');
      await put('tags', { tag: t, createdAt: now });
      return { tag: t };
    }
    if (sub === 'recipes' && method === 'POST') {
      const add = new Set(toList(body?.add).map(Number));
      const remove = new Set(toList(body?.remove).map(Number));
      for (const r of await getAll('recipes')) {
        if (add.has(r.id) && !r.tags.includes(tag)) await put('recipes', { ...r, tags: [...r.tags, tag] });
        if (remove.has(r.id) && r.tags.includes(tag))
          await put('recipes', { ...r, tags: r.tags.filter((x) => x !== tag), autoTags: (r.autoTags || []).filter((x) => x !== tag) });
      }
      return { tag };
    }
    if (method === 'PUT') {
      const to = name(body?.name);
      if (!to) throw err(400, 'חסר שם לתגית');
      if (AUTO_TAGS.includes(tag)) throw err(400, 'תגית אוטומטית אי אפשר לשנות');
      if (to !== tag) {
        for (const r of await getAll('recipes')) {
          if (!r.tags.includes(tag)) continue;
          const tags = [...new Set(r.tags.map((x) => (x === tag ? to : x)))];
          await put('recipes', { ...r, tags, autoTags: (r.autoTags || []).filter((x) => x !== tag) });
        }
        await del('tags', tag);
        await put('tags', { tag: to, createdAt: now });
      }
      return { tag: to };
    }
    if (method === 'DELETE') {
      for (const r of await getAll('recipes'))
        if (r.tags.includes(tag)) await put('recipes', { ...r, tags: r.tags.filter((x) => x !== tag), autoTags: (r.autoTags || []).filter((x) => x !== tag) });
      await del('tags', tag);
      return null;
    }
  }

  if (res === 'collections') {
    if (!idStr && method === 'GET') return listCollections();
    if (!idStr && method === 'POST') {
      const name = str(body?.name).trim();
      if (!name) throw err(400, 'חסר שם לאוסף');
      const c = { name, description: str(body?.description), createdAt: now };
      c.id = await put('collections', c);
      return c;
    }
    const c = await getOne('collections', id);
    if (!c) throw err(404, 'האוסף לא נמצא');
    if (method === 'PUT') {
      const next = { ...c, name: body?.name != null ? str(body.name).trim() || c.name : c.name, description: body?.description ?? c.description };
      await put('collections', next);
      return next;
    }
    if (method === 'DELETE') {
      await del('collections', id);
      for (const r of await getAll('recipes'))
        if (r.collections.includes(id)) await put('recipes', { ...r, collections: r.collections.filter((x) => x !== id) });
      return null;
    }
  }

  throw err(404, 'לא נמצא');
}
