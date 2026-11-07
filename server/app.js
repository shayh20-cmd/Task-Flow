import express from 'express';
import multer from 'multer';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { extractFromUrl, extractFromHtml } from './extract.js';
import { autoTags } from './autotag.js';
import { safeFetch } from './net.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'image/heic': '.heic' };
const MAX_IMAGE = 10 * 1024 * 1024;

export function createApp({ dataDir = join(ROOT, 'data'), dbFile, password = process.env.RECIPIN_PASSWORD } = {}) {
  const uploadsDir = join(dataDir, 'uploads');
  mkdirSync(uploadsDir, { recursive: true });
  const store = openDb(dbFile || join(dataDir, 'recipin.db'));
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  // ---------- optional password (protects editing; share links stay public) ----------
  if (password) {
    const expected = Buffer.from(password);
    app.use('/api', (req, res, next) => {
      if (req.path.startsWith('/public/')) return next();
      const header = req.headers.authorization || '';
      const [, b64] = header.match(/^Basic (.+)$/) || [];
      const given = Buffer.from(b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '');
      if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
      res.set('WWW-Authenticate', 'Basic realm="Recipin"').status(401).json({ error: 'נדרשת סיסמה' });
    });
  }

  // ---------- uploads ----------
  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadsDir,
      filename: (_req, file, cb) => cb(null, randomBytes(10).toString('hex') + (IMAGE_TYPES[file.mimetype] || extname(file.originalname).toLowerCase() || '.img')),
    }),
    limits: { fileSize: MAX_IMAGE, files: 20 },
    fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
  });
  app.post('/api/uploads', upload.array('files'), (req, res) => {
    res.json({ files: (req.files || []).map((f) => ({ url: '/uploads/' + f.filename })) });
  });
  app.use('/uploads', express.static(uploadsDir, { maxAge: '30d', immutable: true }));

  /** Download a remote image so the recipe keeps its photo even if the site disappears. */
  async function localizeImage(url) {
    if (!url || !/^https?:\/\//i.test(url)) return url;
    try {
      const r = await safeFetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 Recipin' } });
      const type = (r.headers.get('content-type') || '').split(';')[0].trim();
      if (!r.ok || !IMAGE_TYPES[type]) return url;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_IMAGE) return url;
      const name = randomBytes(10).toString('hex') + IMAGE_TYPES[type];
      writeFileSync(join(uploadsDir, name), buf);
      return '/uploads/' + name;
    } catch {
      return url; // keep the remote URL as a fallback
    }
  }

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const toList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

  function cleanRecipeInput(body, { partial = false } = {}) {
    const out = {};
    const str = ['kind', 'title', 'description', 'cover', 'notes', 'sourceUrl', 'sourceName', 'author', 'servings'];
    for (const k of str) if (body[k] !== undefined) out[k] = String(body[k] ?? '').slice(0, k === 'notes' || k === 'description' ? 20000 : 2000);
    for (const k of ['images', 'ingredients', 'steps', 'tags', 'autoTags', 'collections']) {
      if (body[k] !== undefined) out[k] = toList(body[k]).map((x) => (k === 'collections' ? Number(x) : String(x).trim())).filter((x) => x !== '' && x === x);
    }
    for (const k of ['prepMinutes', 'cookMinutes', 'totalMinutes']) if (body[k] !== undefined) out[k] = body[k];
    if (body.favorite !== undefined) out.favorite = !!body.favorite;
    if (out.kind && !['manual', 'photo', 'link'].includes(out.kind)) out.kind = 'manual';
    if (!partial && !out.title?.trim()) throw Object.assign(new Error('חסרה כותרת למתכון'), { status: 400 });
    return out;
  }

  async function localizeAll(data) {
    if (data.cover) data.cover = await localizeImage(data.cover);
    if (data.images) data.images = await Promise.all(data.images.map(localizeImage));
    return data;
  }

  // ---------- recipes ----------
  app.get('/api/recipes', (req, res) => {
    res.json(
      store.listRecipes({
        q: String(req.query.q || '').trim(),
        tags: toList(req.query.tag).map(String),
        collection: req.query.collection ? Number(req.query.collection) : null,
        favorite: req.query.favorite === '1',
      }),
    );
  });
  app.get('/api/recipes/:id', (req, res) => {
    const r = store.getRecipe(Number(req.params.id));
    r ? res.json(r) : res.status(404).json({ error: 'המתכון לא נמצא' });
  });
  app.post('/api/recipes', wrap(async (req, res) => {
    const data = await localizeAll(cleanRecipeInput(req.body));
    res.status(201).json(store.createRecipe(data));
  }));
  app.put('/api/recipes/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!store.getRecipe(id)) return res.status(404).json({ error: 'המתכון לא נמצא' });
    const data = await localizeAll(cleanRecipeInput(req.body, { partial: true }));
    res.json(store.updateRecipe(id, data));
  }));
  app.delete('/api/recipes/:id', (req, res) => {
    store.deleteRecipe(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- import from link ----------
  app.post('/api/import', wrap(async (req, res) => {
    let url = String(req.body.url || '').trim();
    // Shared text from phones often has the link inside other text.
    const m = url.match(/https?:\/\/\S+/);
    if (m) url = m[0];
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'נא להדביק קישור שמתחיל ב-http' });
    const duplicate = store.findBySource(url);
    let result;
    try {
      result = req.body.html ? extractFromHtml(String(req.body.html), url) : await extractFromUrl(url);
    } catch (e) {
      // Site unreachable / blocked us: still let the user save it as a link card.
      result = { method: 'link', error: e.message, recipe: { title: '', sourceUrl: url, sourceName: hostOf(url), ingredients: [], steps: [], suggestedTags: [] } };
    }
    const dup = duplicate || store.findBySource(result.recipe.sourceUrl);
    res.json({ ...result, autoTags: autoTags(result.recipe), duplicate: dup });
  }));

  app.post('/api/autotags', (req, res) => {
    res.json({ tags: autoTags({ ingredients: toList(req.body.ingredients).map(String), totalMinutes: Number(req.body.totalMinutes) || null }) });
  });

  app.get('/api/tags', (_req, res) => res.json(store.allTags()));

  // ---------- collections ----------
  app.get('/api/collections', (_req, res) => res.json(store.listCollections()));
  app.post('/api/collections', (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'חסר שם לאוסף' });
    res.status(201).json(store.createCollection({ name, description: String(req.body.description || '') }));
  });
  app.put('/api/collections/:id', (req, res) => {
    const c = store.updateCollection(Number(req.params.id), req.body);
    c ? res.json(c) : res.status(404).json({ error: 'האוסף לא נמצא' });
  });
  app.delete('/api/collections/:id', (req, res) => {
    store.deleteCollection(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- sharing ----------
  app.get('/api/shares', (_req, res) => res.json(store.listShares()));
  app.post('/api/shares', (req, res) => {
    const scope = String(req.body.scope || '');
    const targetId = req.body.targetId != null ? Number(req.body.targetId) : null;
    if (!['book', 'collection', 'recipe'].includes(scope)) return res.status(400).json({ error: 'סוג שיתוף לא תקין' });
    if (scope === 'collection' && !store.getCollection(targetId)) return res.status(404).json({ error: 'האוסף לא נמצא' });
    if (scope === 'recipe' && !store.getRecipe(targetId)) return res.status(404).json({ error: 'המתכון לא נמצא' });
    res.status(201).json(store.createShare(scope, scope === 'book' ? null : targetId));
  });
  app.delete('/api/shares/:token', (req, res) => {
    store.deleteShare(req.params.token);
    res.status(204).end();
  });

  function sharedRecipeIds(share) {
    if (share.scope === 'recipe') return [share.target_id];
    if (share.scope === 'collection') return store.listRecipes({ collection: share.target_id }).map((r) => r.id);
    return null; // book = everything
  }
  const publicView = ({ notes, collections, favorite, ...r }) => r; // hide private fields

  app.get('/api/public/:token', (req, res) => {
    const share = store.getShare(req.params.token);
    if (!share) return res.status(404).json({ error: 'הקישור אינו פעיל' });
    const ids = sharedRecipeIds(share);
    const recipes = store.listRecipes({
      q: String(req.query.q || '').trim(),
      tags: toList(req.query.tag).map(String),
      ids,
    });
    let title = 'ספר המתכונים';
    if (share.scope === 'collection') title = store.getCollection(share.target_id)?.name || title;
    if (share.scope === 'recipe') title = recipes[0]?.title || title;
    const tagCounts = {};
    for (const r of store.listRecipes({ ids })) for (const t of r.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
    res.json({
      scope: share.scope,
      title,
      recipes: recipes.map(publicView),
      tags: Object.entries(tagCounts).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count),
    });
  });

  // ---------- PWA share target (Android "Share → Recipin") ----------
  app.get('/share-target', (req, res) => {
    const blob = [req.query.url, req.query.text, req.query.title].filter(Boolean).join(' ');
    const m = blob.match(/https?:\/\/\S+/);
    res.redirect('/#/import?url=' + encodeURIComponent(m ? m[0] : blob));
  });

  // ---------- static app ----------
  const pub = join(ROOT, 'public');
  app.use(express.static(pub, { index: 'index.html' }));
  app.get('/s/:token', (_req, res) => res.sendFile(join(pub, 'index.html')));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'לא נמצא' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status === 413 ? 'הקובץ גדול מדי (עד 10MB)' : err.message || 'שגיאה' });
  });

  return { app, store };
}

function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
