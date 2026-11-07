import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS recipes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      kind          TEXT NOT NULL DEFAULT 'manual',   -- manual | photo | link
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      cover         TEXT NOT NULL DEFAULT '',          -- main image (local /uploads/... or remote URL)
      images        TEXT NOT NULL DEFAULT '[]',        -- JSON array of extra image URLs
      ingredients   TEXT NOT NULL DEFAULT '[]',        -- JSON array of strings ("## x" = section heading)
      steps         TEXT NOT NULL DEFAULT '[]',        -- JSON array of strings ("## x" = section heading)
      notes         TEXT NOT NULL DEFAULT '',          -- personal notes ("less sugar next time")
      source_url    TEXT NOT NULL DEFAULT '',
      source_name   TEXT NOT NULL DEFAULT '',
      author        TEXT NOT NULL DEFAULT '',
      prep_minutes  INTEGER,
      cook_minutes  INTEGER,
      total_minutes INTEGER,
      servings      TEXT NOT NULL DEFAULT '',
      favorite      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_recipes_source ON recipes(source_url);

    CREATE TABLE IF NOT EXISTS recipe_tags (
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      tag       TEXT NOT NULL,
      auto      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (recipe_id, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_tags_tag ON recipe_tags(tag);

    CREATE TABLE IF NOT EXISTS collections (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS collection_recipes (
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      recipe_id     INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      PRIMARY KEY (collection_id, recipe_id)
    );

    CREATE TABLE IF NOT EXISTS shares (
      token      TEXT PRIMARY KEY,
      scope      TEXT NOT NULL,          -- book | collection | recipe
      target_id  INTEGER,                -- null for book
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return new Store(db);
}

const J = (s, d = []) => {
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};

const FIELDS = {
  kind: 'kind', title: 'title', description: 'description', cover: 'cover', images: 'images',
  ingredients: 'ingredients', steps: 'steps', notes: 'notes', sourceUrl: 'source_url', sourceName: 'source_name',
  author: 'author', prepMinutes: 'prep_minutes', cookMinutes: 'cook_minutes', totalMinutes: 'total_minutes',
  servings: 'servings', favorite: 'favorite',
};
const JSON_FIELDS = new Set(['images', 'ingredients', 'steps']);

class Store {
  constructor(db) {
    this.db = db;
  }

  rowToRecipe(r) {
    if (!r) return null;
    const tags = this.db.prepare('SELECT tag, auto FROM recipe_tags WHERE recipe_id = ? ORDER BY auto, tag').all(r.id);
    const cols = this.db
      .prepare('SELECT collection_id FROM collection_recipes WHERE recipe_id = ?')
      .all(r.id)
      .map((c) => c.collection_id);
    return {
      id: r.id, kind: r.kind, title: r.title, description: r.description, cover: r.cover,
      images: J(r.images), ingredients: J(r.ingredients), steps: J(r.steps), notes: r.notes,
      sourceUrl: r.source_url, sourceName: r.source_name, author: r.author,
      prepMinutes: r.prep_minutes, cookMinutes: r.cook_minutes, totalMinutes: r.total_minutes,
      servings: r.servings, favorite: !!r.favorite,
      tags: tags.map((t) => t.tag), autoTags: tags.filter((t) => t.auto).map((t) => t.tag),
      collections: cols, createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  getRecipe(id) {
    return this.rowToRecipe(this.db.prepare('SELECT * FROM recipes WHERE id = ?').get(id));
  }

  /** filters: { q, tags: string[], collection, favorite, ids } */
  listRecipes({ q = '', tags = [], collection = null, favorite = false, ids = null } = {}) {
    const where = [];
    const args = [];
    if (q) {
      // Simple LIKE across title, ingredients, description, notes, tags.
      const like = `%${q}%`;
      where.push(`(r.title LIKE ? OR r.ingredients LIKE ? OR r.description LIKE ? OR r.notes LIKE ? OR r.source_name LIKE ?
        OR EXISTS (SELECT 1 FROM recipe_tags t WHERE t.recipe_id = r.id AND t.tag LIKE ?))`);
      args.push(like, like, like, like, like, like);
    }
    for (const tag of tags) {
      where.push('EXISTS (SELECT 1 FROM recipe_tags t WHERE t.recipe_id = r.id AND t.tag = ?)');
      args.push(tag);
    }
    if (collection) {
      where.push('EXISTS (SELECT 1 FROM collection_recipes c WHERE c.recipe_id = r.id AND c.collection_id = ?)');
      args.push(Number(collection));
    }
    if (favorite) where.push('r.favorite = 1');
    if (ids) {
      if (!ids.length) return [];
      where.push(`r.id IN (${ids.map(() => '?').join(',')})`);
      args.push(...ids);
    }
    const sql = `SELECT r.* FROM recipes r ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.created_at DESC, r.id DESC`;
    return this.db.prepare(sql).all(...args).map((r) => this.rowToRecipe(r));
  }

  findBySource(url) {
    if (!url) return null;
    const r = this.db.prepare('SELECT id, title FROM recipes WHERE source_url = ? LIMIT 1').get(url);
    return r || null;
  }

  createRecipe(data) {
    const cols = [];
    const vals = [];
    for (const [k, col] of Object.entries(FIELDS)) {
      if (data[k] === undefined) continue;
      cols.push(col);
      vals.push(this.encode(k, data[k]));
    }
    const info = this.db
      .prepare(`INSERT INTO recipes (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...vals);
    const id = Number(info.lastInsertRowid);
    this.setTags(id, data.tags || [], data.autoTags || []);
    if (data.collections) this.setRecipeCollections(id, data.collections);
    return this.getRecipe(id);
  }

  updateRecipe(id, data) {
    const sets = [];
    const vals = [];
    for (const [k, col] of Object.entries(FIELDS)) {
      if (data[k] === undefined) continue;
      sets.push(`${col} = ?`);
      vals.push(this.encode(k, data[k]));
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      this.db.prepare(`UPDATE recipes SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    }
    if (data.tags !== undefined) this.setTags(id, data.tags, data.autoTags || []);
    if (data.collections !== undefined) this.setRecipeCollections(id, data.collections);
    return this.getRecipe(id);
  }

  encode(k, v) {
    if (JSON_FIELDS.has(k)) return JSON.stringify(Array.isArray(v) ? v.map(String) : []);
    if (k === 'favorite') return v ? 1 : 0;
    if (k.endsWith('Minutes')) return v === '' || v == null || isNaN(Number(v)) ? null : Math.round(Number(v));
    return v == null ? '' : String(v);
  }

  deleteRecipe(id) {
    this.db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
    this.db.prepare("DELETE FROM shares WHERE scope = 'recipe' AND target_id = ?").run(id);
  }

  setTags(id, tags, autoTags = []) {
    const clean = (t) => String(t).trim().replace(/^#/, '').slice(0, 40);
    const auto = new Set(autoTags.map(clean));
    const all = [...new Set(tags.map(clean).filter(Boolean))];
    this.db.prepare('DELETE FROM recipe_tags WHERE recipe_id = ?').run(id);
    const ins = this.db.prepare('INSERT OR IGNORE INTO recipe_tags (recipe_id, tag, auto) VALUES (?, ?, ?)');
    for (const t of all) ins.run(id, t, auto.has(t) ? 1 : 0);
  }

  allTags() {
    return this.db.prepare('SELECT tag, COUNT(*) AS count FROM recipe_tags GROUP BY tag ORDER BY count DESC, tag').all();
  }

  // ---- collections ----
  listCollections() {
    return this.db
      .prepare(
        `SELECT c.*, COUNT(cr.recipe_id) AS count,
           (SELECT r.cover FROM collection_recipes x JOIN recipes r ON r.id = x.recipe_id
             WHERE x.collection_id = c.id AND r.cover != '' ORDER BY r.created_at DESC LIMIT 1) AS cover
         FROM collections c LEFT JOIN collection_recipes cr ON cr.collection_id = c.id
         GROUP BY c.id ORDER BY c.name`,
      )
      .all();
  }
  getCollection(id) {
    return this.db.prepare('SELECT * FROM collections WHERE id = ?').get(id) || null;
  }
  createCollection({ name, description = '' }) {
    const info = this.db.prepare('INSERT INTO collections (name, description) VALUES (?, ?)').run(name, description);
    return this.getCollection(Number(info.lastInsertRowid));
  }
  updateCollection(id, { name, description }) {
    const c = this.getCollection(id);
    if (!c) return null;
    this.db
      .prepare('UPDATE collections SET name = ?, description = ? WHERE id = ?')
      .run(name ?? c.name, description ?? c.description, id);
    return this.getCollection(id);
  }
  deleteCollection(id) {
    this.db.prepare('DELETE FROM collections WHERE id = ?').run(id);
    this.db.prepare("DELETE FROM shares WHERE scope = 'collection' AND target_id = ?").run(id);
  }
  setRecipeCollections(recipeId, ids) {
    this.db.prepare('DELETE FROM collection_recipes WHERE recipe_id = ?').run(recipeId);
    const ins = this.db.prepare('INSERT OR IGNORE INTO collection_recipes (collection_id, recipe_id) VALUES (?, ?)');
    for (const cid of ids) if (this.getCollection(cid)) ins.run(Number(cid), recipeId);
  }

  // ---- shares ----
  createShare(scope, targetId = null) {
    const existing = this.db
      .prepare('SELECT * FROM shares WHERE scope = ? AND target_id IS ?')
      .get(scope, targetId ?? null);
    if (existing) return existing;
    const token = randomBytes(12).toString('base64url');
    this.db.prepare('INSERT INTO shares (token, scope, target_id) VALUES (?, ?, ?)').run(token, scope, targetId ?? null);
    return this.getShare(token);
  }
  getShare(token) {
    return this.db.prepare('SELECT * FROM shares WHERE token = ?').get(token) || null;
  }
  listShares() {
    return this.db.prepare('SELECT * FROM shares ORDER BY created_at DESC').all();
  }
  deleteShare(token) {
    this.db.prepare('DELETE FROM shares WHERE token = ?').run(token);
  }
}
