import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

let server, base, dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'recipin-test-'));
  const { app } = createApp({ dataDir: dir, password: '' });
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = async (path, method = 'GET', body) => {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
};

test('full flow: create, tag filter, search, collections, share links', async () => {
  const a = await call('/api/recipes', 'POST', {
    kind: 'manual', title: 'פשטידת ירקות', ingredients: ['3 ביצים', 'גבינה צהובה'], steps: ['מערבבים', 'אופים'],
    tags: ['חלבי', 'ערב'], autoTags: ['חלבי'], notes: 'סוד: פחות מלח',
  });
  assert.equal(a.status, 201);
  assert.deepEqual(a.data.autoTags, ['חלבי']);
  const b = await call('/api/recipes', 'POST', { kind: 'link', title: 'שניצל', sourceUrl: 'https://x.example/schnitzel', tags: ['בשרי'] });
  assert.equal(b.status, 201);

  assert.equal((await call('/api/recipes', 'POST', { title: '' })).status, 400);

  assert.equal((await call('/api/recipes?tag=חלבי')).data.length, 1);
  assert.equal((await call('/api/recipes?q=' + encodeURIComponent('גבינה'))).data[0].title, 'פשטידת ירקות');
  assert.equal((await call('/api/recipes?q=' + encodeURIComponent('ערב'))).data.length, 1, 'search covers tags');

  const col = await call('/api/collections', 'POST', { name: 'ארוחות ערב' });
  await call(`/api/recipes/${a.data.id}`, 'PUT', { collections: [col.data.id], favorite: true });
  assert.equal((await call(`/api/recipes?collection=${col.data.id}`)).data.length, 1);
  assert.equal((await call('/api/recipes?favorite=1')).data.length, 1);
  assert.equal((await call('/api/collections')).data[0].count, 1);

  // Share a collection: only its recipes, without private notes.
  const share = await call('/api/shares', 'POST', { scope: 'collection', targetId: col.data.id });
  assert.equal(share.status, 201);
  const pub = await call(`/api/public/${share.data.token}`);
  assert.equal(pub.data.title, 'ארוחות ערב');
  assert.equal(pub.data.recipes.length, 1);
  assert.equal(pub.data.recipes[0].notes, undefined);
  // Same share again → same token.
  assert.equal((await call('/api/shares', 'POST', { scope: 'collection', targetId: col.data.id })).data.token, share.data.token);

  const book = await call('/api/shares', 'POST', { scope: 'book' });
  assert.equal((await call(`/api/public/${book.data.token}`)).data.recipes.length, 2);

  const single = await call('/api/shares', 'POST', { scope: 'recipe', targetId: b.data.id });
  assert.deepEqual((await call(`/api/public/${single.data.token}`)).data.recipes.map((r) => r.title), ['שניצל']);

  // Revoke.
  await call(`/api/shares/${share.data.token}`, 'DELETE');
  assert.equal((await call(`/api/public/${share.data.token}`)).status, 404);

  // Import duplicate detection (uses supplied HTML, no network).
  const html = readFileSync(new URL('./fixtures/no-recipe.html', import.meta.url), 'utf8');
  const imp = await call('/api/import', 'POST', { url: 'https://x.example/schnitzel', html });
  assert.equal(imp.data.method, 'link');
  assert.equal(imp.data.duplicate.id, b.data.id);

  // Tags list with counts.
  const tags = (await call('/api/tags')).data;
  assert.ok(tags.find((t) => t.tag === 'חלבי' && t.count === 1));

  await call(`/api/recipes/${a.data.id}`, 'DELETE');
  assert.equal((await call(`/api/recipes/${a.data.id}`)).status, 404);
});

test('import rejects internal addresses', async () => {
  const r = await call('/api/import', 'POST', { url: 'http://127.0.0.1:1/secret' });
  assert.equal(r.data.method, 'link');
  assert.match(r.data.error, /פנימית/);
});

test('autotags endpoint', async () => {
  const r = await call('/api/autotags', 'POST', { ingredients: ['חזה עוף'], totalMinutes: 25 });
  assert.deepEqual(r.data.tags, ['בשרי', 'עד 30 דקות']);
});

test('password protects editing but not share links', async () => {
  const d = mkdtempSync(join(tmpdir(), 'recipin-pw-'));
  const { app, store } = createApp({ dataDir: d, password: 's3cret' });
  const srv = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  const url = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal((await fetch(url + '/api/recipes')).status, 401);
    const auth = { Authorization: 'Basic ' + Buffer.from('me:s3cret').toString('base64') };
    assert.equal((await fetch(url + '/api/recipes', { headers: auth })).status, 200);
    const share = store.createShare('book');
    assert.equal((await fetch(`${url}/api/public/${share.token}`)).status, 200);
  } finally {
    srv.close();
    rmSync(d, { recursive: true, force: true });
  }
});
