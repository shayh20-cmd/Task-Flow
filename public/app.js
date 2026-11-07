// Recipin – client (vanilla JS, hash routing, no build step)

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');
const dialog = $('#dialog');

// Public share mode: /s/<token>
const SHARE_TOKEN = (location.pathname.match(/^\/s\/([\w-]+)/) || [])[1] || null;
const READONLY = !!SHARE_TOKEN;

// ---------- tiny helpers ----------
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** Tagged template that escapes interpolations. Use raw() to insert trusted HTML. */
const RAW = Symbol('raw');
const raw = (s) => ({ [RAW]: String(s) });
function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (Array.isArray(v)) out += v.map((x) => (x && x[RAW] !== undefined ? x[RAW] : esc(x))).join('');
      else out += v && v[RAW] !== undefined ? v[RAW] : esc(v);
    }
  });
  return raw(out);
}
const render = (el, h) => (el.innerHTML = h[RAW]);
const safeUrl = (u) => (/^(https?:\/\/|\/uploads\/)/i.test(u || '') ? u : '');

async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `שגיאה ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 3200);
}

function fmtMinutes(m) {
  if (!m) return '';
  if (m < 60) return `${m} דק׳`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} ש׳ ${r} דק׳` : `${h} ש׳`;
}

const KIND_LABEL = { link: 'מלינק', manual: 'כתיבה חופשית', photo: 'מתמונה' };
const PALETTE = ['#fde2cf', '#fbe7a1', '#d9f0d3', '#d6e6fb', '#f5d5e5', '#e7dcf7'];
const colorFor = (s) => PALETTE[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

// ---------- state ----------
const state = { tags: [], collections: [], selectedTags: [], q: '' };

async function refreshMeta() {
  if (READONLY) return;
  [state.tags, state.collections] = await Promise.all([api('/api/tags'), api('/api/collections')]);
}

// ---------- routing ----------
function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = h.split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(query) };
}

async function route() {
  const { parts, params } = parseHash();
  renderTopActions();
  window.scrollTo(0, 0);
  try {
    if (READONLY) {
      if (parts[0] === 'r') return await showRecipe(Number(parts[1]));
      return await showSharedHome();
    }
    if (!parts.length) return await showHome({});
    if (parts[0] === 'fav') return await showHome({ favorite: true });
    if (parts[0] === 'c') return await showHome({ collection: Number(parts[1]) });
    if (parts[0] === 'add') return showAdd(params.get('mode') || 'link');
    if (parts[0] === 'import') return showAdd('link', params.get('url') || '');
    if (parts[0] === 'r' && parts[2] === 'edit') return await showEditor(await api(`/api/recipes/${Number(parts[1])}`));
    if (parts[0] === 'r') return await showRecipe(Number(parts[1]));
    if (parts[0] === 'shares') return await showShares();
    return await showHome({});
  } catch (e) {
    render(view, html`<div class="empty"><h2>אופס</h2><p>${e.message}</p><a class="btn" href="#/">חזרה לספר</a></div>`);
  }
}
window.addEventListener('hashchange', route);

function renderTopActions() {
  const el = $('#topActions');
  if (READONLY) {
    render(el, html`<span class="badge">צפייה בלבד</span>`);
    return;
  }
  render(
    el,
    html`<a class="btn ghost hide-sm" href="#/shares" title="קישורי שיתוף">שיתופים</a>
      <a class="btn primary" href="#/add">+ תיוק מתכון</a>`,
  );
}

$('#searchForm').addEventListener('submit', (e) => e.preventDefault());
let searchTimer;
$('#searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = e.target.value.trim();
    const { parts } = parseHash();
    const onGrid = !parts.length || ['fav', 'c'].includes(parts[0]);
    if (onGrid) loadGrid();
    else location.hash = '#/';
  }, 220);
});

// ---------- home / grid ----------
let gridCtx = {};
async function showHome(ctx) {
  gridCtx = ctx;
  await refreshMeta();
  const col = ctx.collection ? state.collections.find((c) => c.id === ctx.collection) : null;
  const title = col ? col.name : ctx.favorite ? 'מועדפים' : 'כל המתכונים';
  render(
    view,
    html`<div class="layout">
      <aside class="sidebar">
        <nav class="shelf">
          <a href="#/" class="${!ctx.collection && !ctx.favorite ? 'active' : ''}">📖 כל המתכונים</a>
          <a href="#/fav" class="${ctx.favorite ? 'active' : ''}">♥ מועדפים</a>
          <h3>אוספים</h3>
          ${state.collections.map(
            (c) => html`<a href="#/c/${c.id}" class="${ctx.collection === c.id ? 'active' : ''}">${c.name}<small>${c.count}</small></a>`,
          )}
          <button class="link-btn" id="newCollection">+ אוסף חדש</button>
        </nav>
      </aside>
      <section class="content">
        <div class="content-head">
          <h1>${title}</h1>
          <div class="head-actions">
            ${col ? html`<button class="btn ghost" id="editCol">עריכה</button>` : ''}
            <button class="btn ghost" id="shareBtn">שיתוף ${col ? 'האוסף' : 'הספר'}</button>
          </div>
        </div>
        ${col?.description ? html`<p class="muted">${col.description}</p>` : ''}
        <div class="tagbar" id="tagbar"></div>
        <div class="grid" id="grid"></div>
      </section>
    </div>`,
  );
  $('#newCollection').onclick = () => collectionDialog();
  $('#shareBtn').onclick = () => shareDialog(col ? 'collection' : 'book', col?.id, col ? `האוסף "${col.name}"` : 'כל ספר המתכונים');
  if (col) $('#editCol').onclick = () => collectionDialog(col);
  await loadGrid();
}

function renderTagbar(tags) {
  const el = $('#tagbar');
  if (!el) return;
  const selected = new Set(state.selectedTags);
  const list = [...state.selectedTags.filter((t) => !tags.some((x) => x.tag === t)).map((tag) => ({ tag, count: 0 })), ...tags];
  render(
    el,
    html`${list.slice(0, 40).map(
      (t) => html`<button class="chip ${selected.has(t.tag) ? 'on' : ''}" data-tag="${t.tag}">#${t.tag}${t.count ? html` <small>${t.count}</small>` : ''}</button>`,
    )}${state.selectedTags.length ? html`<button class="chip clear" data-clear>ניקוי ✕</button>` : ''}`,
  );
  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.clear !== undefined) state.selectedTags = [];
    else {
      const t = b.dataset.tag;
      state.selectedTags = selected.has(t) ? state.selectedTags.filter((x) => x !== t) : [...state.selectedTags, t];
    }
    loadGrid();
  };
}

async function loadGrid() {
  const qs = new URLSearchParams();
  if (state.q) qs.set('q', state.q);
  state.selectedTags.forEach((t) => qs.append('tag', t));
  let recipes, tags;
  if (READONLY) {
    const data = await api(`/api/public/${SHARE_TOKEN}?${qs}`);
    recipes = data.recipes;
    tags = data.tags;
  } else {
    if (gridCtx.collection) qs.set('collection', gridCtx.collection);
    if (gridCtx.favorite) qs.set('favorite', '1');
    recipes = await api(`/api/recipes?${qs}`);
    tags = state.tags;
  }
  renderTagbar(tags);
  const grid = $('#grid');
  if (!grid) return;
  if (!recipes.length) {
    const filtered = state.q || state.selectedTags.length;
    render(
      grid,
      html`<div class="empty wide">
        ${filtered
          ? html`<p>לא נמצאו מתכונים שמתאימים לחיפוש.</p>`
          : READONLY
            ? html`<p>אין כאן מתכונים עדיין.</p>`
            : html`<h2>הספר עוד ריק</h2><p>הדביקו קישור למתכון, צלמו דף מספר, או כתבו מתכון משלכם.</p><a class="btn primary" href="#/add">+ תיוק המתכון הראשון</a>`}
      </div>`,
    );
    return;
  }
  render(grid, html`${recipes.map(cardHtml)}`);
}

function cardHtml(r) {
  const img = safeUrl(r.cover);
  const time = fmtMinutes(r.totalMinutes);
  return html`<a class="card" href="#/r/${r.id}" data-t="${r.title}">
    ${img
      ? html`<img src="${img}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:this.closest('.card').dataset.t}))" />`
      : html`<div class="ph" style="background:${colorFor(r.title)}">${r.title}</div>`}
    <div class="card-body">
      <h3>${r.title}</h3>
      <div class="meta">
        ${r.kind === 'link' && !r.ingredients.length ? html`<span class="kind">🔗 ${r.sourceName || 'קישור'}</span>` : r.sourceName ? html`<span>${r.sourceName}</span>` : ''}
        ${time ? html`<span>⏱ ${time}</span>` : ''}
        ${r.favorite ? html`<span class="fav">♥</span>` : ''}
      </div>
      ${r.tags.length ? html`<div class="mini-tags">${r.tags.slice(0, 4).map((t) => html`<span>#${t}</span>`)}</div>` : ''}
    </div>
  </a>`;
}

async function showSharedHome() {
  const data = await api(`/api/public/${SHARE_TOKEN}`);
  if (data.scope === 'recipe' && data.recipes[0]) {
    location.replace(`#/r/${data.recipes[0].id}`);
    return;
  }
  document.title = `${data.title} · Recipin`;
  render(
    view,
    html`<section class="content solo">
      <div class="content-head"><h1>${data.title}</h1></div>
      <p class="muted">ספר מתכונים ששותף איתך ב-Recipin</p>
      <div class="tagbar" id="tagbar"></div>
      <div class="grid" id="grid"></div>
    </section>`,
  );
  await loadGrid();
}

// ---------- recipe page ----------
function listHtml(items, ordered) {
  // "## title" lines become sub-headings and restart numbering.
  const groups = [];
  let cur = { title: '', items: [] };
  for (const it of items) {
    if (it.startsWith('## ')) {
      if (cur.title || cur.items.length) groups.push(cur);
      cur = { title: it.slice(3), items: [] };
    } else cur.items.push(it);
  }
  groups.push(cur);
  const tag = ordered ? 'ol' : 'ul';
  return groups
    .filter((g) => g.title || g.items.length)
    .map(
      (g) =>
        `${g.title ? `<h4>${esc(g.title)}</h4>` : ''}<${tag}>${g.items
          .map((i) => (ordered ? `<li>${esc(i)}</li>` : `<li><label><input type="checkbox" /> <span>${esc(i)}</span></label></li>`))
          .join('')}</${tag}>`,
    )
    .join('');
}

async function showRecipe(id) {
  let r;
  if (READONLY) {
    const data = await api(`/api/public/${SHARE_TOKEN}`);
    r = data.recipes.find((x) => x.id === id);
    if (!r) throw new Error('המתכון לא נמצא בשיתוף הזה');
    r.shareScope = data.scope;
  } else r = await api(`/api/recipes/${id}`);
  document.title = `${r.title} · Recipin`;
  const cover = safeUrl(r.cover);
  const source = safeUrl(r.sourceUrl);
  const isLinkOnly = r.kind === 'link' && !r.ingredients.length && !r.steps.length;
  const times = [
    r.prepMinutes && `הכנה: ${fmtMinutes(r.prepMinutes)}`,
    r.cookMinutes && `בישול: ${fmtMinutes(r.cookMinutes)}`,
    r.totalMinutes && `סה״כ: ${fmtMinutes(r.totalMinutes)}`,
    r.servings && `כמות: ${r.servings}`,
  ].filter(Boolean);
  const back = READONLY ? (r.shareScope === 'recipe' ? '' : '#/') : '#/';
  render(
    view,
    html`<article class="recipe">
      <div class="recipe-top">
        ${back ? html`<a href="${back}" class="back">→ חזרה</a>` : html`<span></span>`}
        ${READONLY
          ? ''
          : html`<div class="head-actions">
              <button class="btn ghost icon" id="favBtn" title="מועדף" aria-pressed="${r.favorite}">${r.favorite ? '♥' : '♡'}</button>
              <button class="btn ghost" id="shareRecipe">שיתוף</button>
              <a class="btn ghost" href="#/r/${r.id}/edit">עריכה</a>
              <button class="btn ghost danger" id="delBtn">מחיקה</button>
            </div>`}
      </div>
      <div class="recipe-hero ${cover ? '' : 'no-img'}">
        ${cover ? html`<img src="${cover}" alt="" />` : ''}
        <div>
          <h1>${r.title}</h1>
          ${r.description ? html`<p class="desc">${r.description}</p>` : ''}
          ${times.length ? html`<div class="times">${times.map((t) => html`<span>${t}</span>`)}</div>` : ''}
          ${r.tags.length ? html`<div class="tags">${r.tags.map((t) => html`<a class="chip" href="${READONLY ? '#/' : '#/'}" data-tag="${t}">#${t}</a>`)}</div>` : ''}
          ${source
            ? html`<a class="btn ${isLinkOnly ? 'primary' : 'ghost'} source" href="${source}" target="_blank" rel="noopener noreferrer">${isLinkOnly ? 'פתיחת המתכון באתר' : 'למתכון המקורי'}${r.sourceName ? ` · ${r.sourceName}` : ''} ↗</a>`
            : ''}
          ${r.author ? html`<p class="muted small">מאת ${r.author}</p>` : ''}
        </div>
      </div>
      ${isLinkOnly
        ? html`<div class="notice">המתכון שמור כקישור. ${READONLY ? '' : html`אפשר <a href="#/r/${r.id}/edit">להוסיף את המצרכים וההוראות ידנית</a> כדי שיישמרו גם אם האתר ישתנה.`}</div>`
        : ''}
      <div class="recipe-body">
        ${r.ingredients.length ? html`<section class="ingredients"><h2>מצרכים</h2>${raw(listHtml(r.ingredients, false))}</section>` : ''}
        ${r.steps.length ? html`<section class="steps"><h2>אופן ההכנה</h2>${raw(listHtml(r.steps, true))}</section>` : ''}
      </div>
      ${r.notes ? html`<section class="notes"><h2>הערות שלי</h2><p>${r.notes}</p></section>` : ''}
      ${r.images.length
        ? html`<section class="gallery"><h2>תמונות</h2><div>${r.images.map(safeUrl).filter(Boolean).map((u) => html`<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="" loading="lazy" /></a>`)}</div></section>`
        : ''}
    </article>`,
  );
  $$('.recipe .tags .chip').forEach(
    (a) => (a.onclick = () => {
      state.selectedTags = [a.dataset.tag];
      state.q = '';
      $('#searchInput').value = '';
    }),
  );
  if (READONLY) return;
  $('#favBtn').onclick = async () => {
    await api(`/api/recipes/${r.id}`, { method: 'PUT', body: { favorite: !r.favorite } });
    showRecipe(r.id);
  };
  $('#shareRecipe').onclick = () => shareDialog('recipe', r.id, `המתכון "${r.title}"`);
  $('#delBtn').onclick = async () => {
    if (!confirm(`למחוק את "${r.title}"?`)) return;
    await api(`/api/recipes/${r.id}`, { method: 'DELETE' });
    toast('המתכון נמחק');
    location.hash = '#/';
  };
}

// ---------- add ----------
function showAdd(mode, url = '') {
  document.title = 'תיוק מתכון · Recipin';
  render(
    view,
    html`<section class="content solo narrow">
      <h1>תיוק מתכון חדש</h1>
      <div class="tabs" role="tablist">
        <button role="tab" data-mode="link" aria-selected="${mode === 'link'}">🔗 מקישור</button>
        <button role="tab" data-mode="photo" aria-selected="${mode === 'photo'}">📷 מתמונה</button>
        <button role="tab" data-mode="manual" aria-selected="${mode === 'manual'}">✍️ כתיבה חופשית</button>
      </div>
      <div id="addPane"></div>
    </section>`,
  );
  $$('.tabs button').forEach((b) => (b.onclick = () => (location.hash = `#/add?mode=${b.dataset.mode}`)));
  const pane = $('#addPane');
  if (mode === 'manual') return showEditor({ kind: 'manual' }, pane);
  if (mode === 'photo') return addPhoto(pane);
  return addLink(pane, url);
}

function addLink(pane, initial) {
  render(
    pane,
    html`<form class="import" id="importForm">
        <label for="urlInput">הדביקו קישור למתכון מכל אתר</label>
        <div class="row">
          <input id="urlInput" type="url" inputmode="url" placeholder="https://…" value="${initial}" required />
          <button class="btn primary" type="submit">ייבוא</button>
        </div>
        <p class="muted small">Recipin קורא את נתוני המתכון שהאתר מפרסם (מצרכים, הוראות, זמנים ותמונה). אם אין כאלה, המתכון יישמר ככרטיס קישור.</p>
      </form>
      <div id="importResult"></div>
      <details class="tip">
        <summary>תיוק בלחיצה אחת מהדפדפן</summary>
        <p>גררו את הכפתור הזה לסרגל הסימניות. כשתהיו בדף של מתכון, לחצו עליו והמתכון ייפתח כאן מוכן לשמירה:</p>
        <p><a class="btn" id="bookmarklet" href="#">📌 שמירה ל-Recipin</a></p>
        <p>בטלפון אנדרואיד: התקינו את Recipin למסך הבית (תפריט הדפדפן ← "התקנת אפליקציה"), ואז Recipin יופיע בתפריט "שיתוף" של כל אפליקציה.</p>
      </details>`,
  );
  $('#bookmarklet').href = `javascript:location.href=${JSON.stringify(location.origin + '/#/import?url=')}+encodeURIComponent(location.href)`;
  $('#bookmarklet').onclick = (e) => {
    e.preventDefault();
    toast('גררו את הכפתור לסרגל הסימניות');
  };
  const form = $('#importForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'קורא את המתכון…';
    try {
      const res = await api('/api/import', { method: 'POST', body: { url: $('#urlInput').value } });
      const r = res.recipe;
      const out = $('#importResult');
      const found = res.method !== 'link';
      render(
        out,
        html`<div class="notice ${found ? 'ok' : ''}">
          ${found
            ? html`✓ נמצא מתכון: ${r.ingredients.length} מצרכים ו-${r.steps.filter((s) => !s.startsWith('## ')).length} שלבים. בדקו ושמרו.`
            : res.error
              ? html`לא הצלחנו לקרוא את האתר (${res.error}). אפשר לשמור את המתכון ככרטיס קישור ולהשלים פרטים ידנית.`
              : html`האתר לא מפרסם נתוני מתכון מובנים, לכן המתכון יישמר ככרטיס קישור. אפשר להדביק את המצרכים וההוראות בעצמכם.`}
          ${res.duplicate ? html`<br />⚠️ המתכון הזה כבר שמור אצלך: <a href="#/r/${res.duplicate.id}">${res.duplicate.title}</a>` : ''}
        </div><div id="editorHost"></div>`,
      );
      await showEditor(
        {
          kind: 'link',
          title: r.title,
          description: r.description,
          cover: r.image,
          author: r.author,
          sourceUrl: r.sourceUrl,
          sourceName: r.sourceName,
          ingredients: r.ingredients,
          steps: r.steps,
          prepMinutes: r.prepMinutes,
          cookMinutes: r.cookMinutes,
          totalMinutes: r.totalMinutes,
          servings: r.servings,
          tags: [...res.autoTags, ...r.suggestedTags],
          autoTags: res.autoTags,
        },
        $('#editorHost'),
      );
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'ייבוא';
    }
  };
  if (initial) form.requestSubmit();
}

function addPhoto(pane) {
  render(
    pane,
    html`<label class="dropzone" id="drop">
        <input type="file" accept="image/*" multiple id="photoInput" hidden />
        <strong>📷 צלמו או בחרו תמונות של המתכון</strong>
        <span class="muted">דף מספר, כתב יד של סבתא, צילום מסך מאינסטגרם… אפשר כמה תמונות.</span>
      </label>
      <div id="editorHost"></div>`,
  );
  const input = $('#photoInput');
  const handle = async (files) => {
    if (!files.length) return;
    toast('מעלה תמונות…');
    try {
      const urls = await uploadFiles(files);
      $('#drop').classList.add('small');
      await showEditor({ kind: 'photo', cover: urls[0], images: urls.slice(1), title: '' }, $('#editorHost'));
      $('#f-title')?.focus();
    } catch (e) {
      toast(e.message, true);
    }
  };
  input.onchange = () => handle([...input.files]);
  const drop = $('#drop');
  drop.ondragover = (e) => (e.preventDefault(), drop.classList.add('over'));
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    handle([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')));
  };
}

async function uploadFiles(files) {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  const res = await api('/api/uploads', { method: 'POST', form });
  if (!res.files.length) throw new Error('לא הועלו תמונות (רק קבצי תמונה, עד 10MB)');
  return res.files.map((f) => f.url);
}

// ---------- editor ----------
async function showEditor(r, host) {
  await refreshMeta();
  const isNew = !r.id;
  if (!host) {
    document.title = `עריכה: ${r.title} · Recipin`;
    render(view, html`<section class="content solo narrow"><a href="#/r/${r.id}" class="back">→ ביטול</a><h1>עריכת מתכון</h1><div id="editorHost"></div></section>`);
    host = $('#editorHost');
  }
  const ed = {
    tags: [...new Set(r.tags || [])],
    autoTags: new Set(r.autoTags || []),
    removedAuto: new Set(),
    cover: r.cover || '',
    images: [...(r.images || [])],
  };
  render(
    host,
    html`<form class="editor" id="editor" novalidate>
      <div class="cover-edit">
        <div class="cover-preview" id="coverPreview"></div>
        <div class="cover-actions">
          <label class="btn ghost">החלפת תמונה<input type="file" accept="image/*" id="coverFile" hidden /></label>
          <button type="button" class="btn ghost" id="coverRemove">הסרה</button>
        </div>
      </div>
      <label>שם המתכון *<input id="f-title" required value="${r.title || ''}" placeholder="למשל: עוגת שמרים של סבתא" /></label>
      <label>תיאור קצר<textarea id="f-description" rows="2">${r.description || ''}</textarea></label>
      <div class="row3">
        <label>הכנה (דק׳)<input id="f-prep" type="number" min="0" inputmode="numeric" value="${r.prepMinutes ?? ''}" /></label>
        <label>בישול (דק׳)<input id="f-cook" type="number" min="0" inputmode="numeric" value="${r.cookMinutes ?? ''}" /></label>
        <label>סה״כ (דק׳)<input id="f-total" type="number" min="0" inputmode="numeric" value="${r.totalMinutes ?? ''}" /></label>
        <label>כמות / מנות<input id="f-servings" value="${r.servings || ''}" placeholder="8 מנות" /></label>
      </div>
      <label>מצרכים <small class="muted">(מצרך בכל שורה. שורה שמתחילה ב-## היא כותרת, למשל ## לבצק)</small>
        <textarea id="f-ingredients" rows="8" placeholder="2 כוסות קמח&#10;1 כף סוכר">${(r.ingredients || []).join('\n')}</textarea></label>
      <label>אופן ההכנה <small class="muted">(שלב בכל שורה)</small>
        <textarea id="f-steps" rows="8">${(r.steps || []).join('\n')}</textarea></label>
      <div class="field">
        <span class="label">תגיות</span>
        <div class="tag-input" id="tagInput"><input id="tagText" placeholder="הוסיפו תגית ולחצו Enter" list="tagList" /></div>
        <datalist id="tagList">${state.tags.map((t) => html`<option value="${t.tag}"></option>`)}</datalist>
        <div class="suggest" id="tagSuggest"></div>
      </div>
      ${state.collections.length
        ? html`<div class="field"><span class="label">אוספים</span><div class="checks">
            ${state.collections.map((c) => html`<label class="check"><input type="checkbox" name="col" value="${c.id}" ${raw((r.collections || []).includes(c.id) ? 'checked' : '')} /> ${c.name}</label>`)}
          </div></div>`
        : ''}
      <label>הערות אישיות<textarea id="f-notes" rows="3" placeholder="פחות סוכר בפעם הבאה, להכפיל לשבת…">${r.notes || ''}</textarea></label>
      <div class="field">
        <span class="label">תמונות נוספות</span>
        <div class="thumbs" id="thumbs"></div>
        <label class="btn ghost">+ הוספת תמונות<input type="file" accept="image/*" multiple id="moreFiles" hidden /></label>
      </div>
      <label>קישור למקור<input id="f-source" type="url" value="${r.sourceUrl || ''}" placeholder="https://…" /></label>
      <div class="editor-actions">
        <button class="btn primary big" type="submit">${isNew ? 'שמירה לספר' : 'שמירת שינויים'}</button>
      </div>
    </form>`,
  );

  const drawCover = () => {
    const u = safeUrl(ed.cover);
    render($('#coverPreview'), u ? html`<img src="${u}" alt="" />` : html`<span class="muted">אין תמונה ראשית</span>`);
    $('#coverRemove').hidden = !u;
  };
  const drawThumbs = () => {
    render(
      $('#thumbs'),
      html`${ed.images.map(
        (u, i) => html`<div class="thumb"><img src="${safeUrl(u)}" alt="" /><button type="button" data-i="${i}" title="הסרה">✕</button><button type="button" class="mk" data-cover="${i}" title="לתמונה ראשית">★</button></div>`,
      )}`,
    );
  };
  const drawTags = () => {
    $$('.tag-input .chip').forEach((c) => c.remove());
    const input = $('#tagText');
    ed.tags.forEach((t) => {
      const c = document.createElement('span');
      c.className = 'chip on' + (ed.autoTags.has(t) ? ' auto' : '');
      c.title = ed.autoTags.has(t) ? 'תגית אוטומטית. לחצו להסרה' : 'לחצו להסרה';
      c.textContent = '#' + t + ' ✕';
      c.onclick = () => {
        ed.tags = ed.tags.filter((x) => x !== t);
        if (ed.autoTags.has(t)) ed.removedAuto.add(t);
        drawTags();
      };
      input.before(c);
    });
    const used = new Set(ed.tags);
    const sugg = state.tags.map((t) => t.tag).filter((t) => !used.has(t)).slice(0, 12);
    render(
      $('#tagSuggest'),
      sugg.length ? html`<span class="muted small">הצעות:</span> ${sugg.map((t) => html`<button type="button" class="chip" data-t="${t}">#${t}</button>`)}` : html``,
    );
  };
  const addTag = (t) => {
    t = t.trim().replace(/^#/, '');
    if (t && !ed.tags.includes(t)) ed.tags.push(t);
    drawTags();
  };

  drawCover();
  drawThumbs();
  drawTags();

  $('#tagText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(e.target.value);
      e.target.value = '';
    } else if (e.key === 'Backspace' && !e.target.value && ed.tags.length) {
      ed.tags.pop();
      drawTags();
    }
  });
  $('#tagText').addEventListener('change', (e) => {
    if (state.tags.some((t) => t.tag === e.target.value)) {
      addTag(e.target.value);
      e.target.value = '';
    }
  });
  $('#tagSuggest').onclick = (e) => {
    const b = e.target.closest('[data-t]');
    if (b) addTag(b.dataset.t);
  };

  // Live auto-tags (בשרי/חלבי/פרווה, זמן) as the ingredients change.
  let autoTimer;
  const refreshAuto = () => {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(async () => {
      if (!$('#f-ingredients')) return; // user navigated away
      const ingredients = lines('#f-ingredients');
      const totalMinutes = Number($('#f-total').value) || Number($('#f-prep').value) + Number($('#f-cook').value) || null;
      const { tags } = await api('/api/autotags', { method: 'POST', body: { ingredients, totalMinutes } });
      // Drop stale auto tags, add new ones (unless the user removed them).
      ed.tags = ed.tags.filter((t) => !ed.autoTags.has(t) || tags.includes(t));
      ed.autoTags = new Set(tags);
      const fresh = tags.filter((t) => !ed.removedAuto.has(t) && !ed.tags.includes(t));
      ed.tags = [...fresh, ...ed.tags];
      drawTags();
    }, 500);
  };
  ['#f-ingredients', '#f-total', '#f-prep', '#f-cook'].forEach((s) => $(s).addEventListener('input', refreshAuto));
  if (isNew && r.kind !== 'link') refreshAuto();

  $('#coverFile').onchange = async (e) => {
    try {
      [ed.cover] = await uploadFiles([...e.target.files]);
      drawCover();
    } catch (err) {
      toast(err.message, true);
    }
  };
  $('#coverRemove').onclick = () => {
    ed.cover = '';
    drawCover();
  };
  $('#moreFiles').onchange = async (e) => {
    try {
      ed.images.push(...(await uploadFiles([...e.target.files])));
      drawThumbs();
    } catch (err) {
      toast(err.message, true);
    }
  };
  $('#thumbs').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cover !== undefined) {
      const i = Number(b.dataset.cover);
      const old = ed.cover;
      ed.cover = ed.images[i];
      ed.images.splice(i, 1);
      if (old) ed.images.unshift(old);
      drawCover();
    } else ed.images.splice(Number(b.dataset.i), 1);
    drawThumbs();
  };

  $('#editor').onsubmit = async (e) => {
    e.preventDefault();
    const pending = $('#tagText').value.trim();
    if (pending) addTag(pending);
    const title = $('#f-title').value.trim();
    if (!title) {
      $('#f-title').focus();
      return toast('חסר שם למתכון', true);
    }
    const num = (s) => ($(s).value === '' ? null : Number($(s).value));
    const sourceUrl = $('#f-source').value.trim();
    const body = {
      kind: r.kind || 'manual',
      title,
      description: $('#f-description').value.trim(),
      cover: ed.cover,
      images: ed.images,
      ingredients: lines('#f-ingredients'),
      steps: lines('#f-steps'),
      notes: $('#f-notes').value.trim(),
      prepMinutes: num('#f-prep'),
      cookMinutes: num('#f-cook'),
      totalMinutes: num('#f-total') ?? ((num('#f-prep') || 0) + (num('#f-cook') || 0) || null),
      servings: $('#f-servings').value.trim(),
      sourceUrl,
      sourceName: sourceUrl === r.sourceUrl ? r.sourceName || '' : hostOf(sourceUrl),
      author: r.author || '',
      tags: ed.tags,
      autoTags: [...ed.autoTags],
      collections: $$('input[name=col]:checked').map((c) => Number(c.value)),
    };
    const btn = $('#editor button[type=submit]');
    btn.disabled = true;
    try {
      const saved = isNew ? await api('/api/recipes', { method: 'POST', body }) : await api(`/api/recipes/${r.id}`, { method: 'PUT', body });
      toast(isNew ? 'המתכון נשמר בספר 📌' : 'השינויים נשמרו');
      location.hash = `#/r/${saved.id}`;
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  };
}

const lines = (sel) =>
  $(sel)
    .value.split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// ---------- dialogs ----------
function openDialog(content, onReady) {
  render(dialog, content);
  dialog.showModal();
  $$('[data-close]', dialog).forEach((b) => (b.onclick = () => dialog.close()));
  onReady?.();
}

function collectionDialog(col) {
  openDialog(
    html`<form method="dialog" class="dlg" id="colForm">
      <h2>${col ? 'עריכת אוסף' : 'אוסף חדש'}</h2>
      <label>שם<input id="c-name" required value="${col?.name || ''}" placeholder="מתכוני סבתא, שבת, ארוחות מהירות…" /></label>
      <label>תיאור<textarea id="c-desc" rows="2">${col?.description || ''}</textarea></label>
      <div class="dlg-actions">
        ${col ? html`<button type="button" class="btn ghost danger" id="c-del">מחיקת האוסף</button>` : ''}
        <span></span>
        <button type="button" class="btn ghost" data-close>ביטול</button>
        <button class="btn primary">שמירה</button>
      </div>
    </form>`,
    () => {
      $('#c-name').focus();
      $('#colForm').onsubmit = async (e) => {
        e.preventDefault();
        const body = { name: $('#c-name').value.trim(), description: $('#c-desc').value.trim() };
        if (!body.name) return;
        const saved = col ? await api(`/api/collections/${col.id}`, { method: 'PUT', body }) : await api('/api/collections', { method: 'POST', body });
        dialog.close();
        location.hash = `#/c/${saved.id}`;
        route();
      };
      if (col)
        $('#c-del').onclick = async () => {
          if (!confirm('למחוק את האוסף? המתכונים עצמם יישארו בספר.')) return;
          await api(`/api/collections/${col.id}`, { method: 'DELETE' });
          dialog.close();
          location.hash = '#/';
        };
    },
  );
}

async function shareDialog(scope, targetId, label) {
  const share = await api('/api/shares', { method: 'POST', body: { scope, targetId } });
  const link = `${location.origin}/s/${share.token}`;
  const text = `${label} ב-Recipin: ${link}`;
  openDialog(
    html`<div class="dlg">
      <h2>שיתוף ${label}</h2>
      <p class="muted">כל מי שיקבל את הקישור יוכל לצפות (בלי לערוך). ההערות האישיות לא משותפות.</p>
      <div class="row"><input readonly value="${link}" id="shareLink" /><button class="btn primary" id="copyBtn">העתקה</button></div>
      <div class="share-btns">
        <a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">וואטסאפ</a>
        <a class="btn" href="mailto:?subject=${encodeURIComponent('מתכונים מ-Recipin')}&body=${encodeURIComponent(text)}">מייל</a>
        ${navigator.share ? html`<button class="btn" id="nativeShare">שיתוף…</button>` : ''}
      </div>
      <div class="dlg-actions">
        <button class="btn ghost danger" id="revoke">ביטול הקישור</button>
        <span></span>
        <button class="btn ghost" data-close>סגירה</button>
      </div>
    </div>`,
    () => {
      $('#copyBtn').onclick = async () => {
        try {
          await navigator.clipboard.writeText(link);
        } catch {
          $('#shareLink').select();
          document.execCommand('copy');
        }
        toast('הקישור הועתק');
      };
      if ($('#nativeShare')) $('#nativeShare').onclick = () => navigator.share({ title: 'Recipin', text: label, url: link }).catch(() => {});
      $('#revoke').onclick = async () => {
        await api(`/api/shares/${share.token}`, { method: 'DELETE' });
        dialog.close();
        toast('הקישור בוטל. מי שקיבל אותו כבר לא יוכל לצפות.');
      };
    },
  );
}

async function showShares() {
  document.title = 'שיתופים · Recipin';
  const [shares, collections] = await Promise.all([api('/api/shares'), api('/api/collections')]);
  const names = {};
  for (const s of shares) {
    if (s.scope === 'book') names[s.token] = '📖 כל הספר';
    else if (s.scope === 'collection') names[s.token] = '🗂 ' + (collections.find((c) => c.id === s.target_id)?.name || 'אוסף');
    else {
      try {
        names[s.token] = '🍽 ' + (await api(`/api/recipes/${s.target_id}`)).title;
      } catch {
        names[s.token] = 'מתכון';
      }
    }
  }
  render(
    view,
    html`<section class="content solo narrow">
      <a href="#/" class="back">→ חזרה</a>
      <h1>קישורי שיתוף פעילים</h1>
      ${shares.length
        ? html`<ul class="share-list">${shares.map(
            (s) => html`<li><span>${names[s.token]}</span><a href="/s/${s.token}" target="_blank" rel="noopener">${location.origin}/s/${s.token}</a><button class="btn ghost danger" data-t="${s.token}">ביטול</button></li>`,
          )}</ul>`
        : html`<p class="muted">עוד לא שיתפת כלום. אפשר לשתף את כל הספר, אוסף או מתכון בודד.</p>`}
    </section>`,
  );
  $$('.share-list button').forEach(
    (b) => (b.onclick = async () => {
      await api(`/api/shares/${b.dataset.t}`, { method: 'DELETE' });
      showShares();
    }),
  );
}

// ---------- boot ----------
if (READONLY) {
  $('.logo').setAttribute('href', '#/');
}
if ('serviceWorker' in navigator && !READONLY) navigator.serviceWorker.register('/sw.js').catch(() => {});
route();
