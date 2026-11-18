// Recipin – client (vanilla JS modules, hash routing, no build step)
import { scaleIngredient, baseServings, findDurations, formatClock, formatQty } from './kitchen.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');
const dialog = $('#dialog');

// Public share mode: /s/<token>
const SHARE_TOKEN = (location.pathname.match(/^\/s\/([\w-]+)/) || [])[1] || null;
const READONLY = !!SHARE_TOKEN;
document.body.classList.toggle('readonly', READONLY);

// ---------- templating ----------
const RAW = Symbol('raw');
const raw = (s) => ({ [RAW]: String(s) });
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const part = (v) => (v && v[RAW] !== undefined ? v[RAW] : esc(v));
function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += Array.isArray(vals[i]) ? vals[i].map(part).join('') : part(vals[i]);
  });
  return raw(out);
}
const render = (el, h) => (el.innerHTML = h[RAW]);
const icon = (name, cls = '') => raw(`<svg class="ic ${cls}" aria-hidden="true"><use href="/icons.svg#i-${name}"/></svg>`);
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
function toast(msg, { error = false, ic = error ? 'x' : 'check' } = {}) {
  const t = $('#toast');
  render(t, html`${icon(ic, 'sm')}<span>${msg}</span>`);
  t.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 3200);
}

function fmtMinutes(m) {
  if (!m) return '';
  if (m < 60) return `${m} דק׳`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  const hs = h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : `${h} שע׳`;
  return r ? `${hs} ${r} דק׳` : hs;
}
const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const KOSHER = { בשרי: 'k-meat', חלבי: 'k-dairy', פרווה: 'k-parve' };
const kosherOf = (r) => r.tags.find((t) => KOSHER[t]);
const PH = ['#FCE7DA', '#FBE3A6', '#DCEFD9', '#F8D9CF', '#E7E0F5', '#D9EAF7'];
const phColor = (s) => PH[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % PH.length];
const placeholder = (title, ic = 'cooking-pot') => html`<div class="ph" style="--ph:${phColor(title)}">${icon(ic)}<b>${title}</b></div>`;

// ---------- colour palettes ----------
const THEMES = [
  { id: 'minimal', name: 'מינימלי', desc: 'נקי, אוורירי, גווני פסטל · ברירת המחדל', dots: ['#1D1C1A', '#DFE9DD', '#F6E3D6'] },
  { id: 'terracotta', name: 'טרקוטה', desc: 'חמים וביתי, כמו סיר חרס', dots: ['#9A3412', '#2F7D5B', '#FCE7DA'] },
  { id: 'cafe', name: 'קפה ומאפה', desc: 'חום קרמל, דבש וקרם', dots: ['#92400E', '#4F7A3A', '#FBE9C8'] },
  { id: 'wine', name: 'יין וענבים', desc: 'בורדו עמוק עם נגיעת זהב', dots: ['#7A1F3D', '#A16207', '#F7E1E8'] },
  { id: 'market', name: 'שוק ירוק', desc: 'זית, עשבי תיבול ורעננות', dots: ['#3F6B2A', '#0F766E', '#E4EED8'] },
  { id: 'sea', name: 'ים תיכון', desc: 'כחול אריחים יווני ושמש', dots: ['#1D4E89', '#2F7D5B', '#E0EAF6'] },
];
function currentTheme() {
  return document.documentElement.dataset.theme || 'terracotta';
}
function applyTheme(id) {
  if (id === 'terracotta') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem('recipin-theme', id);
  } catch {
    /* storage unavailable */
  }
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  $$('meta[name=theme-color]').forEach((m) => m.setAttribute('content', bg));
}
function themeDialog() {
  openDialog(
    html`<div class="dlg">
      <div class="dlg-head"><h2>צבעי הספר</h2><button class="btn round quiet" data-close aria-label="סגירה">${icon('x')}</button></div>
      <div class="swatches" role="radiogroup" aria-label="פלטת צבעים">
        ${THEMES.map(
          (t) => html`<button class="swatch" role="radio" aria-checked="${t.id === currentTheme()}" data-theme-id="${t.id}">
            <span class="dots">${t.dots.map((c) => html`<i style="background:${c}"></i>`)}</span>
            <span><strong>${t.name}</strong><small>${t.desc}</small></span>${icon('check')}
          </button>`,
        )}
      </div>
    </div>`,
    () => {
      $('.swatches', dialog).onclick = (e) => {
        const b = e.target.closest('[data-theme-id]');
        if (!b) return;
        applyTheme(b.dataset.themeId);
        $$('.swatch', dialog).forEach((x) => x.setAttribute('aria-checked', x === b));
      };
    },
  );
}

// ---------- state ----------
const state = { tags: [], collections: [], filters: [], q: '', recipesCount: 0 };
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

const scrollMemo = {};
let lastHash = location.hash;
async function route() {
  scrollMemo[lastHash] = window.scrollY;
  const cameFromRecipe = /^#\/r\/\d+$/.test(lastHash);
  lastHash = location.hash;
  const { parts, params } = parseHash();
  renderChrome(parts);
  closeCook();
  try {
    if (READONLY) {
      if (parts[0] === 'r') await showRecipe(Number(parts[1]));
      else await showSharedHome();
    } else if (!parts.length) await showHome();
    else if (parts[0] === 'fav') await showList({ favorite: true });
    else if (parts[0] === 'collections') await showCollections();
    else if (parts[0] === 'c') await showList({ collection: Number(parts[1]) });
    else if (parts[0] === 'add' && parts[1] === 'link') showAddLink(params.get('url') || '');
    else if (parts[0] === 'add' && parts[1] === 'photo') showAddPhoto();
    else if (parts[0] === 'add' && parts[1] === 'write') showAddWrite();
    else if (parts[0] === 'add') showAddChoose();
    else if (parts[0] === 'import') return location.replace('#/add/link?url=' + encodeURIComponent(params.get('url') || ''));
    else if (parts[0] === 'r' && parts[2] === 'edit') await showEditPage(Number(parts[1]));
    else if (parts[0] === 'r') await showRecipe(Number(parts[1]));
    else if (parts[0] === 'shares') await showShares();
    else await showHome();
  } catch (e) {
    render(
      view,
      html`<div class="page narrow"><div class="empty">${emptyArt()}<h2>אופס, משהו השתבש</h2><p>${e.message}</p><a class="btn primary" href="#/">חזרה לספר</a></div></div>`,
    );
  }
  const isGrid = !parts.length || ['fav', 'c'].includes(parts[0]);
  window.scrollTo(0, isGrid && cameFromRecipe ? scrollMemo[location.hash] || 0 : 0);
}
window.addEventListener('hashchange', route);

const NAV = [
  { href: '#/', key: '', label: 'הספר', ic: 'book-open' },
  { href: '#/collections', key: 'collections', label: 'אוספים', ic: 'layers-2' },
  { href: '#/add', key: 'add', label: 'תיוק', ic: 'plus', fab: true },
  { href: '#/fav', key: 'fav', label: 'מועדפים', ic: 'heart' },
  { href: '#/shares', key: 'shares', label: 'שיתופים', ic: 'share-2' },
];
function renderChrome(parts) {
  const key = parts[0] === 'c' ? 'collections' : parts[0] === 'import' ? 'add' : parts[0] || '';
  const cur = (k) => raw(k === key ? 'aria-current="page"' : '');
  if (READONLY) {
    render($('#topnav'), html``);
    render($('#topCta'), html`<span class="chip" style="box-shadow:none">${icon('book-open', 'sm')} צפייה בלבד</span><button class="btn round quiet" id="themeBtn" aria-label="צבעי הספר">${icon('palette')}</button>`);
    $('#themeBtn').onclick = themeDialog;
    render($('#tabbar'), html``);
    $('#tabbar').hidden = true;
    return;
  }
  render(
    $('#topnav'),
    html`${NAV.filter((n) => !n.fab).map((n) => html`<a href="${n.href}" ${cur(n.key)}>${icon(n.ic)}${n.label}</a>`)}`,
  );
  render($('#topCta'), html`<button class="btn round quiet" id="themeBtn" aria-label="צבעי הספר">${icon('palette')}</button><a class="btn primary hide-m" href="#/add">${icon('plus')}תיוק מתכון</a>`);
  $('#themeBtn').onclick = themeDialog;
  render(
    $('#tabbar'),
    html`${NAV.map((n) =>
      n.fab
        ? html`<a class="fab" href="${n.href}" aria-label="תיוק מתכון חדש" ${cur(n.key)}>${icon(n.ic)}</a>`
        : html`<a href="${n.href}" ${cur(n.key)}>${icon(n.ic)}<span>${n.label}</span></a>`,
    )}`,
  );
}

// ---------- illustrations ----------
function heroArt() {
  return raw(`<svg class="hero-deco" viewBox="0 0 200 200" aria-hidden="true">
    <circle cx="112" cy="104" r="82" style="fill:var(--surface)" opacity=".6"/>
    <path d="M150 52c18-6 30 2 32 14-14 4-26 0-32-14z" fill="#6FAE8A"/><path d="M150 52c10 2 20 8 32 14" stroke="#2F7D5B" stroke-width="2" fill="none"/>
    <path d="M36 118h150a75 75 0 0 1-150 0z" style="fill:var(--primary)" opacity=".88"/>
    <path d="M36 118h150" style="stroke:var(--primary)" stroke-width="8" stroke-linecap="round"/>
    <ellipse cx="111" cy="117" rx="70" ry="9" style="fill:var(--butter)"/>
    <circle cx="90" cy="114" r="6" fill="#E8862E"/><circle cx="120" cy="112" r="5" fill="#6FAE8A"/><circle cx="140" cy="116" r="4" fill="#B42318"/>
    <path d="M86 92c-8-10 8-14 0-26M110 88c-8-10 8-14 0-26M134 92c-8-10 8-14 0-26" stroke="#C9A58C" stroke-width="5" stroke-linecap="round" fill="none" opacity=".75"/>
    <path d="M70 150c20 14 62 14 82 0" style="stroke:var(--surface)" stroke-width="4" stroke-linecap="round" fill="none" opacity=".35"/>
  </svg>`);
}
function emptyArt() {
  return raw(`<svg class="art" viewBox="0 0 160 160" aria-hidden="true">
    <circle cx="80" cy="80" r="74" fill="var(--primary-soft)"/>
    <rect x="42" y="40" width="76" height="92" rx="12" fill="var(--surface)" stroke="var(--primary)" stroke-width="4"/>
    <path d="M56 40v92" stroke="var(--primary)" stroke-width="4"/>
    <path d="M70 62h34M70 76h28M70 90h32" stroke="var(--line)" stroke-width="5" stroke-linecap="round"/>
    <path d="M104 26l12 0 0 26-6-5-6 5z" fill="var(--accent)"/>
    <circle cx="118" cy="112" r="16" fill="var(--butter)"/><path d="M111 112l5 5 9-10" stroke="#3A2A05" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`);
}

// ---------- grid pieces ----------
function cardHtml(r, i = 0) {
  const img = safeUrl(r.cover);
  const k = kosherOf(r);
  const linkOnly = r.kind === 'link' && !r.ingredients.length;
  const extra = r.tags.filter((t) => !KOSHER[t] && !r.autoTags.includes(t)).slice(0, 3);
  return html`<article class="card ${READONLY ? '' : 'has-fav'}" style="--i:${Math.min(i, 12)}">
    <a href="#/r/${r.id}" aria-label="${r.title}">
      <div class="media">
        ${img ? html`<img src="${img}" alt="" loading="lazy" decoding="async" onerror="this.hidden=true" />` : placeholder(r.title)}
        <div class="badges">${k ? html`<span class="kosher ${KOSHER[k]}">${k}</span>` : html`<span></span>`}</div>
        ${r.totalMinutes ? html`<span class="time-badge">${icon('clock', 'sm')}${fmtMinutes(r.totalMinutes)}</span>` : ''}
      </div>
      <div class="body">
        <h3>${r.title}</h3>
        ${r.sourceName ? html`<div class="src">${icon(linkOnly ? 'link' : 'bookmark', 'sm')}${r.sourceName}</div>` : ''}
        ${extra.length ? html`<div class="mini-tags">${extra.map((t) => html`<span>${t}</span>`)}</div>` : ''}
      </div>
    </a>
    ${READONLY
      ? ''
      : html`<button class="fav-btn" data-fav="${r.id}" aria-pressed="${r.favorite}" aria-label="${r.favorite ? 'הסרה מהמועדפים' : 'הוספה למועדפים'}"><span>${icon('heart', 'sm')}</span></button>`}
  </article>`;
}

function skeletonGrid(n = 8) {
  const hs = [220, 300, 260, 340, 240, 280, 320, 230];
  return html`${Array.from({ length: n }, (_, i) => html`<div class="skeleton" style="height:${hs[i % hs.length]}px;margin-bottom:16px;break-inside:avoid"></div>`)}`;
}

function mosaic(covers, cls = '') {
  const c = covers.map(safeUrl).filter(Boolean).slice(0, 4);
  const size = ['empty', 'one', 'two', 'three', ''][c.length];
  return html`<div class="mosaic ${size} ${cls}">${c.length ? c.map((u) => html`<div><img src="${u}" alt="" loading="lazy" /></div>`) : html`<div>${icon('layers-2', 'lg')}</div>`}</div>`;
}
function albumHtml(c) {
  return html`<a class="album" href="#/c/${c.id}">${mosaic(c.covers || [])}<strong>${c.name}</strong><span>${c.count} מתכונים</span></a>`;
}

function filtersHtml(tags) {
  const on = new Set(state.filters);
  const pressed = (t) => raw(`aria-pressed="${on.has(t)}"`);
  const counts = Object.fromEntries(tags.map((t) => [t.tag, t.count]));
  const quick = ['בשרי', 'חלבי', 'פרווה'].filter((t) => counts[t] || on.has(t));
  const rest = tags.filter((t) => !KOSHER[t.tag] && t.tag !== 'עד 30 דקות').slice(0, 30);
  const hasQuick = counts['עד 30 דקות'] || on.has('עד 30 דקות');
  if (!quick.length && !rest.length && !hasQuick) return html``;
  return html`${quick.map((t) => html`<button class="chip ${KOSHER[t]}" data-tag="${t}" ${pressed(t)}><span class="dot"></span>${t}</button>`)}
    ${hasQuick ? html`<button class="chip" data-tag="עד 30 דקות" ${pressed('עד 30 דקות')}>${icon('timer', 'sm')}עד 30 דק׳</button>` : ''}
    ${(quick.length || hasQuick) && rest.length ? html`<span class="sep" aria-hidden="true"></span>` : ''}
    ${rest.map((t) => html`<button class="chip" data-tag="${t.tag}" ${pressed(t.tag)}>${t.tag} <small>${t.count}</small></button>`)}
    ${state.filters.length ? html`<button class="chip" data-clear>${icon('x', 'sm')}ניקוי</button>` : ''}`;
}

let gridCtx = {};
async function loadGrid() {
  const grid = $('#grid');
  if (!grid) return;
  const qs = new URLSearchParams();
  if (state.q) qs.set('q', state.q);
  state.filters.forEach((t) => qs.append('tag', t));
  let recipes, tags;
  if (READONLY) {
    const data = await api(`/api/public/${SHARE_TOKEN}?${qs}`);
    ({ recipes, tags } = data);
  } else {
    if (gridCtx.collection) qs.set('collection', gridCtx.collection);
    if (gridCtx.favorite) qs.set('favorite', '1');
    recipes = await api(`/api/recipes?${qs}`);
    tags = state.tags;
  }
  const f = $('#filters');
  if (f) render(f, filtersHtml(tags));
  const count = $('#count');
  if (count) count.textContent = `${recipes.length} מתכונים`;
  if (!recipes.length) {
    const filtered = state.q || state.filters.length;
    render(
      grid,
      html`<div class="empty">${emptyArt()}
        ${filtered
          ? html`<h2>לא מצאנו מתכון כזה</h2><p>נסו מילה אחרת או הסירו חלק מהסינונים.</p><button class="btn soft" id="clearAll">ניקוי החיפוש</button>`
          : READONLY
            ? html`<h2>אין כאן מתכונים עדיין</h2>`
            : gridCtx.favorite
              ? html`<h2>עוד אין מועדפים</h2><p>לחצו על הלב בכרטיס של מתכון שאתם אוהבים, והוא יחכה לכם כאן.</p>`
              : gridCtx.collection
                ? html`<h2>האוסף ריק</h2><p>פתחו מתכון, לחצו "עריכה" וסמנו את האוסף הזה.</p>`
                : html`<h2>הספר מחכה למתכון הראשון</h2><p>הדביקו קישור, צלמו דף מספר או כתבו את המתכון של סבתא.</p><a class="btn primary big" href="#/add">${icon('plus')}תיוק המתכון הראשון</a>`}
      </div>`,
    );
    $('#clearAll')?.addEventListener('click', () => {
      state.q = '';
      state.filters = [];
      const s = $('#search');
      if (s) s.value = '';
      loadGrid();
    });
    return;
  }
  render(grid, html`${recipes.map((r, i) => cardHtml(r, i))}`);
}

function bindGrid() {
  $('#filters')?.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.clear !== undefined) state.filters = [];
    else {
      const t = b.dataset.tag;
      state.filters = state.filters.includes(t) ? state.filters.filter((x) => x !== t) : [...state.filters, t];
    }
    loadGrid();
  });
  $('#grid')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fav]');
    if (!b) return;
    e.preventDefault();
    const fav = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', fav);
    b.setAttribute('aria-label', fav ? 'הסרה מהמועדפים' : 'הוספה למועדפים');
    try {
      await api(`/api/recipes/${b.dataset.fav}`, { method: 'PUT', body: { favorite: fav } });
      if (fav) toast('נשמר במועדפים', { ic: 'heart' });
      if (gridCtx.favorite && !fav) loadGrid();
    } catch (err) {
      b.setAttribute('aria-pressed', !fav);
      toast(err.message, { error: true });
    }
  });
  let t;
  $('#search')?.addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.q = e.target.value.trim();
      loadGrid();
    }, 200);
  });
}

// ---------- home ----------
function greeting() {
  const h = new Date().getHours();
  if (h < 11) return 'בוקר טוב! מה על הגז היום?';
  if (h < 16) return 'מה מבשלים היום?';
  if (h < 21) return 'מה לארוחת הערב?';
  return 'משהו קטן לפני השינה?';
}

async function showHome() {
  gridCtx = {};
  document.title = 'Recipin · ספר המתכונים';
  await refreshMeta();
  const total = (await api('/api/recipes')).length;
  render(
    view,
    html`<div class="page">
      <section class="hero">
        ${heroArt()}
        <div class="eyebrow">${icon('book-open', 'sm')}ספר המתכונים שלי</div>
        <h1>${greeting()}</h1>
        <p>${total ? `${total} מתכונים${state.collections.length ? ` ב-${state.collections.length} אוספים` : ''}` : 'כל המתכונים שלך, במקום אחד'}</p>
        <div class="searchbox">
          ${icon('search')}
          <label class="sr-only" for="search">חיפוש</label>
          <input id="search" type="search" placeholder="חפשו מתכון, מצרך או תגית…" value="${state.q}" autocomplete="off" enterkeyhint="search" />
        </div>
      </section>
      <div class="filters" id="filters" role="toolbar" aria-label="סינון לפי תגיות"></div>
      ${state.collections.length
        ? html`<div class="section-title"><h2>האוספים שלי</h2><a class="back-link" href="#/collections">לכל האוספים</a></div>
          <div class="shelf">${state.collections.map(albumHtml)}
            <button class="album new" id="newCol"><div class="mosaic">${icon('folder-plus', 'lg')}</div><strong>אוסף חדש</strong></button>
          </div>`
        : ''}
      <div class="section-title"><h2>כל המתכונים</h2><small id="count"></small></div>
      <div class="grid" id="grid">${skeletonGrid()}</div>
    </div>`,
  );
  $('#newCol')?.addEventListener('click', () => collectionDialog());
  bindGrid();
  await loadGrid();
}

async function showList(ctx) {
  gridCtx = ctx;
  await refreshMeta();
  const col = ctx.collection ? state.collections.find((c) => c.id === ctx.collection) : null;
  if (ctx.collection && !col) throw new Error('האוסף לא נמצא');
  document.title = `${col ? col.name : 'מועדפים'} · Recipin`;
  render(
    view,
    html`<div class="page">
      ${col ? html`<a class="back-link" href="#/collections">${icon('arrow-right', 'sm')}כל האוספים</a>` : ''}
      <div class="page-head">
        <div>
          <div class="eyebrow">${icon(col ? 'layers-2' : 'heart', 'sm')}${col ? 'אוסף' : 'שמורים במיוחד'}</div>
          <h1>${col ? col.name : 'המועדפים שלי'}</h1>
          ${col?.description ? html`<p class="muted" style="margin-top:6px">${col.description}</p>` : ''}
        </div>
        ${col
          ? html`<div class="actions">
              <button class="btn quiet" id="editCol">${icon('pencil', 'sm')}עריכה</button>
              <button class="btn primary" id="shareCol">${icon('share-2', 'sm')}שיתוף האוסף</button>
            </div>`
          : ''}
      </div>
      <div class="searchbox" style="margin-top:0">${icon('search')}<label class="sr-only" for="search">חיפוש</label>
        <input id="search" type="search" placeholder="חיפוש באוסף…" value="${state.q}" autocomplete="off" /></div>
      <div class="filters" id="filters" role="toolbar" aria-label="סינון לפי תגיות"></div>
      <div class="section-title"><span></span><small id="count"></small></div>
      <div class="grid" id="grid">${skeletonGrid(6)}</div>
    </div>`,
  );
  if (col) {
    $('#editCol').onclick = () => collectionDialog(col);
    $('#shareCol').onclick = () => shareDialog('collection', col.id, col.name, 'layers-2');
  }
  bindGrid();
  await loadGrid();
}

async function showCollections() {
  document.title = 'אוספים · Recipin';
  await refreshMeta();
  render(
    view,
    html`<div class="page">
      <div class="page-head">
        <div><div class="eyebrow">${icon('layers-2', 'sm')}מסודר ונקי</div><h1>האוספים שלי</h1></div>
        <div class="actions"><button class="btn quiet" id="shareBook">${icon('share-2', 'sm')}שיתוף כל הספר</button><button class="btn primary" id="newCol">${icon('folder-plus', 'sm')}אוסף חדש</button></div>
      </div>
      ${state.collections.length
        ? html`<div class="albums">${state.collections.map(albumHtml)}</div>`
        : html`<div class="empty">${emptyArt()}<h2>עוד אין אוספים</h2><p>אוספים עוזרים לקבץ מתכונים: "שבת", "מתכוני סבתא", "ארוחות של 20 דקות".</p><button class="btn primary big" id="newCol2">${icon('folder-plus')}יצירת אוסף ראשון</button></div>`}
    </div>`,
  );
  $('#newCol').onclick = () => collectionDialog();
  $('#newCol2')?.addEventListener('click', () => collectionDialog());
  $('#shareBook').onclick = () => shareDialog('book', null, 'כל ספר המתכונים', 'book-open');
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
    html`<div class="page">
      <section class="hero">
        ${heroArt()}
        <div class="eyebrow">${icon('send', 'sm')}שותף איתך ב-Recipin</div>
        <h1>${data.title}</h1>
        <p id="count"></p>
        <div class="searchbox">${icon('search')}<label class="sr-only" for="search">חיפוש</label>
          <input id="search" type="search" placeholder="חיפוש מתכון או מצרך…" autocomplete="off" /></div>
      </section>
      <div class="filters" id="filters" role="toolbar" aria-label="סינון לפי תגיות"></div>
      <div class="grid" id="grid" style="margin-top:16px">${skeletonGrid()}</div>
    </div>`,
  );
  bindGrid();
  await loadGrid();
}

// ---------- recipe page ----------
function groupLines(items) {
  const groups = [];
  let cur = { title: '', items: [] };
  items.forEach((it, idx) => {
    if (it.startsWith('## ')) {
      if (cur.title || cur.items.length) groups.push(cur);
      cur = { title: it.slice(3), items: [] };
    } else cur.items.push({ text: it, idx });
  });
  groups.push(cur);
  return groups.filter((g) => g.title || g.items.length);
}

/** Step text → HTML with clickable timer chips. */
function stepWithTimers(text) {
  const ds = findDurations(text);
  if (!ds.length) return esc(text);
  let out = '';
  let pos = 0;
  for (const d of ds) {
    const at = text.indexOf(d.label, Math.max(pos, d.index));
    if (at < 0) continue;
    out += esc(text.slice(pos, at));
    out += `<button type="button" class="timer-chip" data-timer="${d.seconds}" data-label="${esc(d.label)}" aria-label="הפעלת טיימר ל${esc(d.label)}"><svg class="ic sm" aria-hidden="true"><use href="/icons.svg#i-timer"/></svg>${esc(d.label)}</button>`;
    pos = at + d.label.length;
  }
  return out + esc(text.slice(pos));
}

async function getRecipe(id) {
  if (!READONLY) return api(`/api/recipes/${id}`);
  const data = await api(`/api/public/${SHARE_TOKEN}`);
  const r = data.recipes.find((x) => x.id === id);
  if (!r) throw new Error('המתכון לא נמצא בשיתוף הזה');
  r.shareScope = data.scope;
  return r;
}

async function showRecipe(id) {
  const r = await getRecipe(id);
  document.title = `${r.title} · Recipin`;
  const cover = safeUrl(r.cover);
  const source = safeUrl(r.sourceUrl);
  const linkOnly = r.kind === 'link' && !r.ingredients.length && !r.steps.length;
  const realSteps = r.steps.filter((s) => !s.startsWith('## '));
  const realIngs = r.ingredients.filter((s) => !s.startsWith('## '));
  const base = baseServings(r.servings);
  const k = kosherOf(r);
  const backHref = READONLY && r.shareScope === 'recipe' ? '' : '#/';
  const stats = [
    r.totalMinutes && { ic: 'clock', v: fmtMinutes(r.totalMinutes), l: 'זמן כולל' },
    r.prepMinutes && { ic: 'pen-line', v: fmtMinutes(r.prepMinutes), l: 'הכנה' },
    r.cookMinutes && { ic: 'cooking-pot', v: fmtMinutes(r.cookMinutes), l: 'בישול / אפייה' },
    r.servings && { ic: 'users', v: r.servings, l: 'כמות' },
  ].filter(Boolean);

  render(
    view,
    html`<article class="recipe">
      <div class="r-hero">
        <div class="frame ${cover ? '' : 'ph-frame'}">
          ${cover ? html`<img src="${cover}" alt="" fetchpriority="high" />` : placeholder(r.title, 'chef-hat')}
          <div class="overlay">
            ${backHref ? html`<a class="glass" href="${backHref}" aria-label="חזרה">${icon('arrow-right')}</a>` : html`<span></span>`}
            ${READONLY
              ? ''
              : html`<div class="group">
                  <button class="glass" id="favBtn" aria-pressed="${r.favorite}" aria-label="${r.favorite ? 'הסרה מהמועדפים' : 'הוספה למועדפים'}">${icon('heart')}</button>
                  <button class="glass" id="shareBtn" aria-label="שיתוף המתכון">${icon('share-2')}</button>
                  <a class="glass" href="#/r/${r.id}/edit" aria-label="עריכת המתכון">${icon('pencil')}</a>
                </div>`}
          </div>
        </div>
      </div>
      <section class="r-sheet">
        ${k ? html`<span class="kosher ${KOSHER[k]}" style="box-shadow:none;background:var(--surface-2);margin-bottom:10px">${k}</span>` : ''}
        <h1>${r.title}</h1>
        ${r.description ? html`<p class="desc">${r.description}</p>` : ''}
        ${source || r.author
          ? html`<div class="r-meta">
              ${source ? html`<a class="src-chip" href="${source}" target="_blank" rel="noopener noreferrer">${icon('external-link', 'sm')}${r.sourceName || hostOf(source)}</a>` : ''}
              ${r.author ? html`<span class="muted small">מאת ${r.author}</span>` : ''}
            </div>`
          : ''}
        ${stats.length ? html`<div class="stats">${stats.map((s) => html`<div class="stat">${icon(s.ic, 'lg')}<div><b>${s.v}</b><span>${s.l}</span></div></div>`)}</div>` : ''}
        ${r.tags.length
          ? html`<div class="r-tags">${r.tags.filter((t) => !KOSHER[t]).map((t) => html`<a class="chip" href="#/" data-tag="${t}">${t}</a>`)}</div>`
          : ''}
        <div class="r-cta">
          ${realSteps.length ? html`<button class="btn primary big" id="cookBtn">${icon('chef-hat')}מצב בישול</button>` : ''}
          ${linkOnly && source
            ? html`<a class="btn primary big" href="${source}" target="_blank" rel="noopener noreferrer">${icon('external-link')}פתיחת המתכון באתר</a>`
            : ''}
        </div>
      </section>
      ${linkOnly
        ? html`<div class="r-notice"><div class="notice">${icon('link')}<p>המתכון שמור כקישור. ${READONLY ? '' : html`כדאי <a href="#/r/${r.id}/edit">להוסיף את המצרכים וההוראות</a>, כך שהם יישמרו גם אם האתר ישתנה.`}</p></div></div>`
        : ''}
      ${realIngs.length || realSteps.length
        ? html`${realIngs.length && realSteps.length
            ? html`<div class="seg" role="tablist" aria-label="תצוגה">
                <button role="tab" aria-selected="true" data-tab="ingredients">${icon('list-checks', 'sm')}מצרכים · ${realIngs.length}</button>
                <button role="tab" aria-selected="false" data-tab="steps">${icon('cooking-pot', 'sm')}הכנה · ${realSteps.length}</button>
              </div>`
            : ''}
          <div class="r-content" id="rContent" data-tab="ingredients">
            ${realIngs.length
              ? html`<section class="ingredients panel" aria-labelledby="h-ing">
                  <div class="panel-head"><h2 id="h-ing">מצרכים</h2>
                    <div class="stepper" role="group" aria-label="שינוי כמות">
                      <button type="button" data-step="-1" aria-label="פחות">${icon('minus', 'sm')}</button>
                      <output id="servOut" aria-live="polite"></output>
                      <button type="button" data-step="1" aria-label="יותר">${icon('plus', 'sm')}</button>
                    </div>
                  </div>
                  <div id="ingList"></div>
                </section>`
              : ''}
            ${realSteps.length
              ? html`<section class="steps panel" aria-labelledby="h-steps">
                  <div class="panel-head"><h2 id="h-steps">אופן ההכנה</h2><span class="muted small">לחצו על מספר לסימון</span></div>
                  ${groupLines(r.steps).map(
                    (g) => html`${g.title ? html`<h4>${g.title}</h4>` : ''}<ol class="step-list">${g.items.map(
                      (s) => html`<li class="step" data-i="${s.idx}"><button type="button" class="num" aria-pressed="false" aria-label="סימון השלב כבוצע"></button><div class="txt">${raw(stepWithTimers(s.text))}</div></li>`,
                    )}</ol>`,
                  )}
                </section>`
              : ''}
          </div>`
        : ''}
      ${r.notes
        ? html`<section class="notes-card"><div class="paper"><h2>${icon('notebook-pen', 'sm')}הערות שלי</h2><p class="hand">${r.notes}</p></div></section>`
        : ''}
      ${r.images.length
        ? html`<section class="gallery"><h2>תמונות</h2><div class="row">${r.images
            .map(safeUrl)
            .filter(Boolean)
            .map((u) => html`<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="" loading="lazy" /></a>`)}</div></section>`
        : ''}
    </article>`,
  );

  // numbering for step buttons (continues across sections)
  $$('.step .num').forEach((b, i) => {
    b.textContent = i + 1;
    b.setAttribute('aria-label', `סימון שלב ${i + 1} כבוצע`);
  });

  // servings / scaling
  let factor = 1;
  const checked = new Set();
  const drawIngs = () => {
    const out = $('#servOut');
    if (!out) return;
    out.textContent = base ? `${formatQty(base * factor)} ${r.servings.replace(/^[\d.,\s\-–]+/, '').trim() || 'מנות'}` : `×${formatQty(factor)}`;
    render(
      $('#ingList'),
      html`${groupLines(r.ingredients).map(
        (g) => html`${g.title ? html`<h4>${g.title}</h4>` : ''}<ul class="ing-list">${g.items.map((it) => {
          const s = scaleIngredient(it.text, factor);
          return html`<li><label><input type="checkbox" data-i="${it.idx}" ${raw(checked.has(it.idx) ? 'checked' : '')} /><span>${s.lead}${s.qty ? html`<span class="qty ${s.scaled ? 'scaled' : ''}">${s.qty}</span>` : ''}${s.rest}</span></label></li>`;
        })}</ul>`,
      )}`,
    );
  };
  drawIngs();
  $('#ingList')?.addEventListener('change', (e) => {
    const i = Number(e.target.dataset.i);
    e.target.checked ? checked.add(i) : checked.delete(i);
  });
  $('.stepper')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    const dir = Number(b.dataset.step);
    if (base) factor = Math.max(1, base * factor + dir) / base;
    else factor = Math.max(0.5, factor + dir * 0.5);
    drawIngs();
  });

  // steps: toggle done + timers
  $$('.step').forEach((li) =>
    li.addEventListener('click', (e) => {
      const chip = e.target.closest('.timer-chip');
      if (chip) return startTimer(Number(chip.dataset.timer), `${r.title}: ${chip.dataset.label}`);
      if (e.target.closest('a')) return;
      const done = !li.classList.contains('done');
      li.classList.toggle('done', done);
      $('.num', li).setAttribute('aria-pressed', done);
    }),
  );

  // mobile tabs
  $$('.seg button').forEach(
    (b) =>
      (b.onclick = () => {
        $$('.seg button').forEach((x) => x.setAttribute('aria-selected', x === b));
        $('#rContent').dataset.tab = b.dataset.tab;
      }),
  );

  $$('.r-tags .chip').forEach(
    (a) =>
      (a.onclick = () => {
        state.filters = [a.dataset.tag];
        state.q = '';
      }),
  );
  $('#cookBtn')?.addEventListener('click', () => openCook(r, () => factor));
  if (READONLY) return;
  $('#favBtn').onclick = async (e) => {
    const b = e.currentTarget;
    const fav = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', fav);
    await api(`/api/recipes/${r.id}`, { method: 'PUT', body: { favorite: fav } });
    toast(fav ? 'נשמר במועדפים' : 'הוסר מהמועדפים', { ic: 'heart' });
  };
  $('#shareBtn').onclick = () => shareDialog('recipe', r.id, r.title, 'utensils-crossed');
}

// ---------- cooking mode ----------
let wakeLock = null;
let cookKeys = null;
async function keepAwake() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    wakeLock = null;
  }
  const w = $('#wake');
  if (w) w.hidden = !wakeLock;
}
document.addEventListener('visibilitychange', () => {
  if (!$('#cook').hidden && document.visibilityState === 'visible') keepAwake();
});

function openCook(r, getFactor) {
  const steps = [];
  let section = '';
  for (const s of r.steps) {
    if (s.startsWith('## ')) section = s.slice(3);
    else steps.push({ text: s, section });
  }
  let i = 0;
  let showIngs = false;
  const el = $('#cook');
  const draw = () => {
    const st = steps[i];
    const last = i === steps.length - 1;
    render(
      el,
      html`<div class="cook-top">
          <button class="btn round quiet" id="cookClose" aria-label="יציאה ממצב בישול">${icon('x', 'lg')}</button>
          <h2>${r.title}</h2>
          <span class="wake" id="wake" hidden>${icon('check', 'sm')}המסך יישאר דלוק</span>
        </div>
        <div class="progress" role="progressbar" aria-valuemin="1" aria-valuemax="${steps.length}" aria-valuenow="${i + 1}" aria-label="התקדמות"><i style="width:${((i + 1) / steps.length) * 100}%"></i></div>
        <div class="cook-body" aria-live="polite">
          ${showIngs
            ? html`<div class="label">מצרכים</div><div class="panel cook-ings"><ul class="ing-list">${r.ingredients.map((x) =>
                x.startsWith('## ')
                  ? html`<h4>${x.slice(3)}</h4>`
                  : html`<li><label><input type="checkbox" /><span>${(() => {
                      const s = scaleIngredient(x, getFactor());
                      return html`${s.lead}${s.qty ? html`<span class="qty ${s.scaled ? 'scaled' : ''}">${s.qty}</span>` : ''}${s.rest}`;
                    })()}</span></label></li>`,
              )}</ul></div>`
            : html`<div class="label">שלב ${i + 1} מתוך ${steps.length}</div>
              ${st.section ? html`<div><span class="sect">${st.section}</span></div>` : ''}
              <p class="text">${raw(stepWithTimers(st.text))}</p>`}
        </div>
        <div class="cook-nav">
          <button class="btn big" id="prev" ${raw(i === 0 || showIngs ? 'disabled' : '')}>${icon('arrow-right')}הקודם</button>
          <button class="btn big soft" id="ings" aria-pressed="${showIngs}">${icon(showIngs ? 'cooking-pot' : 'list-checks')}<span class="sr-only">${showIngs ? 'חזרה לשלבים' : 'מצרכים'}</span></button>
          ${last && !showIngs
            ? html`<button class="btn big accent" id="done">${icon('check')}סיימתי!</button>`
            : html`<button class="btn big primary" id="next" ${raw(showIngs ? 'disabled' : '')}>הבא${icon('arrow-left')}</button>`}
        </div>`,
    );
    $('#wake').hidden = !wakeLock;
    $('#cookClose').onclick = closeCook;
    $('#prev').onclick = () => (i > 0 && (i--, draw()));
    $('#next')?.addEventListener('click', () => (i < steps.length - 1 && (i++, draw())));
    $('#done')?.addEventListener('click', () => {
      closeCook();
      toast('בתיאבון!', { ic: 'chef-hat' });
    });
    $('#ings').onclick = () => ((showIngs = !showIngs), draw());
    $$('.timer-chip', el).forEach((c) => (c.onclick = () => startTimer(Number(c.dataset.timer), `שלב ${i + 1}: ${c.dataset.label}`)));
  };
  el.hidden = false;
  document.body.style.overflow = 'hidden';
  draw();
  keepAwake();
  cookKeys = (e) => {
    if (e.key === 'Escape') closeCook();
    if (showIngs) return;
    if (e.key === 'ArrowLeft' && i < steps.length - 1) (i++, draw());
    if (e.key === 'ArrowRight' && i > 0) (i--, draw());
  };
  document.addEventListener('keydown', cookKeys);
  $('#cookClose').focus();
}
function closeCook() {
  const el = $('#cook');
  if (el.hidden) return;
  el.hidden = true;
  document.body.style.overflow = '';
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
  document.removeEventListener('keydown', cookKeys);
}

// ---------- timers ----------
const timers = [];
let timerTick = null;
let audioCtx = null;
function beep() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach((t) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + t + 0.18);
      o.connect(g).connect(audioCtx.destination);
      o.start(audioCtx.currentTime + t);
      o.stop(audioCtx.currentTime + t + 0.2);
    });
  } catch {
    /* audio not available */
  }
}
function startTimer(seconds, label) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); // unlock audio on user gesture
  } catch {
    /* ignore */
  }
  timers.push({ id: Math.random().toString(36).slice(2), label, end: Date.now() + seconds * 1000, ringing: false, lastBeep: 0 });
  toast(`טיימר הופעל: ${formatClock(seconds)}`, { ic: 'timer' });
  drawTimers();
  timerTick ||= setInterval(drawTimers, 500);
}
function drawTimers() {
  const now = Date.now();
  for (const t of timers) {
    if (!t.ringing && now >= t.end) {
      t.ringing = true;
      navigator.vibrate?.([300, 150, 300]);
      toast(`הטיימר הסתיים: ${t.label}`, { ic: 'timer' });
    }
    if (t.ringing && now - t.lastBeep > 2500 && now - t.end < 60000) {
      t.lastBeep = now;
      beep();
    }
  }
  render(
    $('#timers'),
    html`${timers.map(
      (t) => html`<div class="timer ${t.ringing ? 'ring' : ''}">
        ${icon('timer')}<b>${t.ringing ? 'הסתיים!' : formatClock((t.end - now) / 1000)}</b><small>${t.label}</small>
        <button data-stop="${t.id}" aria-label="${t.ringing ? 'כיבוי הטיימר' : 'ביטול הטיימר'}">${icon(t.ringing ? 'check' : 'x', 'sm')}</button>
      </div>`,
    )}`,
  );
  if (!timers.length) {
    clearInterval(timerTick);
    timerTick = null;
  }
}
$('#timers').addEventListener('click', (e) => {
  const b = e.target.closest('[data-stop]');
  if (!b) return;
  const i = timers.findIndex((t) => t.id === b.dataset.stop);
  if (i >= 0) timers.splice(i, 1);
  drawTimers();
});

// ---------- add flow ----------
function showAddChoose() {
  document.title = 'תיוק מתכון · Recipin';
  render(
    view,
    html`<div class="page narrow">
      <div class="page-head"><div><div class="eyebrow">${icon('plus', 'sm')}תיוק חדש</div><h1>איך המתכון הגיע אליך?</h1></div></div>
      <div class="choose">
        <a class="choice" href="#/add/link"><span class="bubble b-link">${icon('link')}</span><div><strong>מקישור</strong><span>מכל אתר מתכונים. המצרכים וההוראות יסודרו לבד</span></div></a>
        <a class="choice" href="#/add/photo"><span class="bubble b-photo">${icon('camera')}</span><div><strong>מצילום</strong><span>דף מספר, כתב יד או צילום מסך</span></div></a>
        <a class="choice" href="#/add/write"><span class="bubble b-write">${icon('pen-line')}</span><div><strong>כתיבה חופשית</strong><span>המתכון שלך, במילים שלך</span></div></a>
      </div>
    </div>`,
  );
}

function addPageHead(title, eyebrowIc, eyebrow) {
  return html`<a class="back-link" href="#/add">${icon('arrow-right', 'sm')}דרכי תיוק</a>
    <div class="page-head" style="margin-bottom:0"><div><div class="eyebrow">${icon(eyebrowIc, 'sm')}${eyebrow}</div><h1>${title}</h1></div></div>`;
}

function showAddLink(initial) {
  document.title = 'תיוק מקישור · Recipin';
  const canPaste = !!navigator.clipboard?.readText;
  render(
    view,
    html`<div class="page narrow">
      ${addPageHead('הדביקו קישור למתכון', 'link', 'תיוק מקישור')}
      <form class="paste-card" id="importForm" novalidate>
        <label class="field" for="urlInput">קישור למתכון</label>
        <div class="paste-row">
          <input id="urlInput" type="url" inputmode="url" placeholder="https://…" value="${initial}" autocomplete="off" aria-describedby="urlHelp" />
          ${canPaste ? html`<button type="button" class="btn soft" id="pasteBtn">${icon('clipboard-paste', 'sm')}הדבקה</button>` : ''}
        </div>
        <p class="helper" id="urlHelp">Recipin קורא את נתוני המתכון שהאתר מפרסם. אם אין כאלה, המתכון יישמר ככרטיס קישור.</p>
        <button class="btn primary big block" type="submit" style="margin-top:16px">${icon('sparkles')}ייבוא המתכון</button>
        <div id="importState"></div>
      </form>
      <div id="editorHost"></div>
      <div class="tips" id="tips">
        <div class="tip"><strong>${icon('bookmark', 'sm')}תיוק בלחיצה מהמחשב</strong>
          <p>גררו את הכפתור לסרגל הסימניות. בדף של מתכון, לחיצה עליו תפתח אותו כאן מוכן לשמירה.</p>
          <p style="margin-top:10px"><a class="btn soft" id="bookmarklet" href="#">${icon('bookmark', 'sm')}שמירה ל-Recipin</a></p></div>
        <div class="tip"><strong>${icon('share-2', 'sm')}תיוק מהטלפון</strong>
          <p>באנדרואיד: התקינו את Recipin למסך הבית מתפריט הדפדפן. אחרי זה הוא יופיע בתפריט "שיתוף" של כל אפליקציה.</p></div>
      </div>
    </div>`,
  );
  $('#bookmarklet').href = `javascript:location.href=${JSON.stringify(location.origin + '/#/add/link?url=')}+encodeURIComponent(location.href)`;
  $('#bookmarklet').onclick = (e) => {
    e.preventDefault();
    toast('גררו את הכפתור לסרגל הסימניות', { ic: 'bookmark' });
  };
  $('#pasteBtn')?.addEventListener('click', async () => {
    try {
      const t = await navigator.clipboard.readText();
      const m = t.match(/https?:\/\/\S+/);
      $('#urlInput').value = m ? m[0] : t.trim();
      $('#importForm').requestSubmit();
    } catch {
      $('#urlInput').focus();
      toast('אין גישה ללוח. הדביקו ידנית', { error: true });
    }
  });
  const form = $('#importForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const url = $('#urlInput').value.trim();
    if (!/https?:\/\//i.test(url)) {
      $('#urlInput').setAttribute('aria-invalid', 'true');
      render($('#importState'), html`<p class="field"><span class="err">${icon('x', 'sm')}צריך קישור שמתחיל ב-https://</span></p>`);
      $('#urlInput').focus();
      return;
    }
    $('#urlInput').removeAttribute('aria-invalid');
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    const stepsUi = ['מתחברים לאתר', 'מחפשים את המתכון בדף', 'מסדרים מצרכים ושלבים'];
    let phase = 0;
    const drawPhase = () =>
      render(
        $('#importState'),
        html`<ol class="progress-steps">${stepsUi.map(
          (s, i) => html`<li class="${i < phase ? 'done' : i === phase ? 'on' : ''}"><span class="st">${i < phase ? icon('check', 'sm') : ''}</span>${s}</li>`,
        )}</ol>`,
      );
    drawPhase();
    const ticker = setInterval(() => phase < 2 && (phase++, drawPhase()), 650);
    try {
      const res = await api('/api/import', { method: 'POST', body: { url } });
      clearInterval(ticker);
      const r = res.recipe;
      const found = res.method !== 'link';
      const nSteps = r.steps.filter((s) => !s.startsWith('## ')).length;
      render(
        $('#importState'),
        html`<div class="notice ${found ? 'ok' : ''}" style="margin-top:16px">
          ${icon(found ? 'sparkles' : 'link')}
          <p>${found
            ? html`<strong>מצאנו את המתכון!</strong> ${r.ingredients.length} מצרכים ו-${nSteps} שלבים. עברו על הפרטים ושמרו.`
            : res.error
              ? html`<strong>לא הצלחנו לקרוא את האתר</strong> (${res.error}). אפשר לשמור ככרטיס קישור ולהשלים בהמשך.`
              : html`<strong>האתר לא מפרסם נתוני מתכון.</strong> נשמור אותו ככרטיס קישור, ואפשר להדביק כאן את המצרכים וההוראות.`}
            ${res.duplicate ? html`<br />כבר יש לך את המתכון הזה: <a href="#/r/${res.duplicate.id}">${res.duplicate.title}</a>` : ''}</p>
        </div>`,
      );
      $('#tips').hidden = true;
      await mountEditor($('#editorHost'), {
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
      });
      $('#editorHost').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    } catch (err) {
      clearInterval(ticker);
      render($('#importState'), html``);
      toast(err.message, { error: true });
    } finally {
      btn.disabled = false;
    }
  };
  if (initial) form.requestSubmit();
  else if (matchMedia('(min-width: 761px)').matches) $('#urlInput').focus();
}

function showAddPhoto() {
  document.title = 'תיוק מצילום · Recipin';
  render(
    view,
    html`<div class="page narrow">
      ${addPageHead('צלמו או העלו את המתכון', 'camera', 'תיוק מצילום')}
      <label class="dropzone" id="drop">
        <input type="file" accept="image/*" multiple id="photoInput" class="sr-only" />
        <span class="bubble b-photo">${icon('camera')}</span>
        <strong>בחירת תמונות או צילום</strong>
        <span class="muted">דף מספר, כתב יד של סבתא, צילום מסך מאינסטגרם. אפשר כמה תמונות.</span>
      </label>
      <div id="editorHost"></div>
    </div>`,
  );
  const input = $('#photoInput');
  const handle = async (files) => {
    if (!files.length) return;
    const drop = $('#drop');
    drop.classList.add('small');
    render($('strong', drop), html`מעלה ${files.length} תמונות…`);
    try {
      const urls = await uploadFiles(files);
      render($('strong', drop), html`${files.length} תמונות הועלו · החלפה`);
      await mountEditor($('#editorHost'), { kind: 'photo', cover: urls[0], images: urls.slice(1), title: '' });
      $('#f-title')?.focus();
    } catch (e) {
      toast(e.message, { error: true });
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

function showAddWrite() {
  document.title = 'כתיבת מתכון · Recipin';
  render(view, html`<div class="page narrow">${addPageHead('כתיבת מתכון', 'pen-line', 'כתיבה חופשית')}<div id="editorHost"></div></div>`);
  mountEditor($('#editorHost'), { kind: 'manual' }).then(() => $('#f-title').focus());
}

async function uploadFiles(files) {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  const res = await api('/api/uploads', { method: 'POST', form });
  if (!res.files.length) throw new Error('לא הועלו תמונות (רק קבצי תמונה, עד 10MB)');
  return res.files.map((f) => f.url);
}

// ---------- editor ----------
async function showEditPage(id) {
  const r = await api(`/api/recipes/${id}`);
  document.title = `עריכה: ${r.title} · Recipin`;
  render(
    view,
    html`<div class="page narrow">
      <a class="back-link" href="#/r/${r.id}">${icon('arrow-right', 'sm')}חזרה למתכון</a>
      <div class="page-head" style="margin-bottom:0"><div><div class="eyebrow">${icon('pencil', 'sm')}עריכה</div><h1>${r.title}</h1></div></div>
      <div id="editorHost"></div>
    </div>`,
  );
  await mountEditor($('#editorHost'), r);
}

async function mountEditor(host, r) {
  await refreshMeta();
  const isNew = !r.id;
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
      <section class="ed-card">
        <h2><span class="num">1</span>פרטי המתכון</h2>
        <div class="cover-edit">
          <div class="cover-preview" id="coverPreview"></div>
          <div class="cover-actions">
            <label class="btn soft">${icon('image-plus', 'sm')}<span id="coverLabel">החלפת תמונה</span><input type="file" accept="image/*" id="coverFile" class="sr-only" /></label>
            <button type="button" class="btn quiet" id="coverRemove">${icon('trash-2', 'sm')}הסרה</button>
          </div>
        </div>
        <div class="field">
          <label class="label" for="f-title">שם המתכון</label>
          <input id="f-title" required value="${r.title || ''}" placeholder="למשל: עוגת השמרים של סבתא" aria-describedby="titleErr" />
          <span class="err" id="titleErr" hidden>${icon('x', 'sm')}צריך לתת למתכון שם</span>
        </div>
        <div class="field"><label class="label" for="f-description">תיאור קצר <span class="hint">(לא חובה)</span></label>
          <textarea id="f-description" rows="2">${r.description || ''}</textarea></div>
        <div class="cols-4">
          <div class="field"><label class="label" for="f-prep">הכנה (דק׳)</label><input id="f-prep" type="number" min="0" inputmode="numeric" value="${r.prepMinutes ?? ''}" /></div>
          <div class="field"><label class="label" for="f-cook">בישול (דק׳)</label><input id="f-cook" type="number" min="0" inputmode="numeric" value="${r.cookMinutes ?? ''}" /></div>
          <div class="field"><label class="label" for="f-total">סה״כ (דק׳)</label><input id="f-total" type="number" min="0" inputmode="numeric" value="${r.totalMinutes ?? ''}" /></div>
          <div class="field"><label class="label" for="f-servings">כמות</label><input id="f-servings" value="${r.servings || ''}" placeholder="4 מנות" /></div>
        </div>
      </section>
      <section class="ed-card">
        <h2><span class="num">2</span>מצרכים</h2>
        <div class="field"><label class="sr-only" for="f-ingredients">מצרכים</label>
          <textarea id="f-ingredients" rows="8" placeholder="2 כוסות קמח&#10;1 כף סוכר&#10;## לציפוי&#10;100 גרם שוקולד" aria-describedby="ingHint">${(r.ingredients || []).join('\n')}</textarea>
          <span class="hint" id="ingHint">מצרך בכל שורה. שורה שמתחילה ב-## היא כותרת (למשל ## לבצק). כמויות בתחילת השורה יוכפלו אוטומטית כשמשנים מנות.</span></div>
      </section>
      <section class="ed-card">
        <h2><span class="num">3</span>אופן ההכנה</h2>
        <div class="field"><label class="sr-only" for="f-steps">שלבי הכנה</label>
          <textarea id="f-steps" rows="8" aria-describedby="stepHint">${(r.steps || []).join('\n')}</textarea>
          <span class="hint" id="stepHint">שלב בכל שורה. זמנים כמו "35 דקות" יהפכו לטיימר בלחיצה.</span></div>
      </section>
      <section class="ed-card">
        <h2><span class="num">4</span>תגיות ואוספים</h2>
        <div class="field">
          <label class="label" for="tagText">תגיות <span class="hint">· הירוקות נוספו אוטומטית לפי המצרכים</span></label>
          <div class="tag-input" id="tagInput"><input id="tagText" placeholder="הוסיפו תגית ולחצו Enter" list="tagList" enterkeyhint="done" /></div>
          <datalist id="tagList">${state.tags.map((t) => html`<option value="${t.tag}"></option>`)}</datalist>
          <div class="suggest" id="tagSuggest"></div>
        </div>
        ${state.collections.length
          ? html`<div class="field"><span class="label">אוספים</span><div class="checks">
              ${state.collections.map((c) => html`<label class="check"><input type="checkbox" name="col" value="${c.id}" ${raw((r.collections || []).includes(c.id) ? 'checked' : '')} />${c.name}</label>`)}
            </div></div>`
          : ''}
      </section>
      <section class="ed-card">
        <h2><span class="num">5</span>הערות ותמונות</h2>
        <div class="field"><label class="label" for="f-notes">הערות אישיות <span class="hint">(לא משותפות עם אחרים)</span></label>
          <textarea id="f-notes" rows="3" placeholder="פחות סוכר בפעם הבאה, להכפיל לשבת…">${r.notes || ''}</textarea></div>
        <div class="field"><span class="label">תמונות נוספות</span>
          <div class="thumbs" id="thumbs"></div>
          <label class="btn soft" style="align-self:flex-start">${icon('image-plus', 'sm')}הוספת תמונות<input type="file" accept="image/*" multiple id="moreFiles" class="sr-only" /></label></div>
        <div class="field"><label class="label" for="f-source">קישור למקור</label><input id="f-source" type="url" value="${r.sourceUrl || ''}" placeholder="https://…" /></div>
      </section>
      <div class="savebar">
        ${isNew ? '' : html`<button type="button" class="btn quiet danger" id="delBtn" style="margin-inline-end:auto">${icon('trash-2', 'sm')}מחיקה</button>`}
        ${isNew ? '' : html`<a class="btn quiet" href="#/r/${r.id}">ביטול</a>`}
        <button class="btn primary big" type="submit">${icon('check')}${isNew ? 'שמירה לספר' : 'שמירת שינויים'}</button>
      </div>
    </form>`,
  );

  const drawCover = () => {
    const u = safeUrl(ed.cover);
    render($('#coverPreview'), u ? html`<img src="${u}" alt="תמונה ראשית" />` : html`${icon('image-plus', 'lg')}`);
    $('#coverRemove').hidden = !u;
    $('#coverLabel').textContent = u ? 'החלפת תמונה' : 'הוספת תמונה';
  };
  const drawThumbs = () =>
    render(
      $('#thumbs'),
      html`${ed.images.map(
        (u, i) => html`<div class="thumb"><img src="${safeUrl(u)}" alt="" />
          <button type="button" class="rm" data-i="${i}" aria-label="הסרת התמונה">${icon('x', 'sm')}</button>
          <button type="button" class="mk" data-cover="${i}" aria-label="קביעה כתמונה ראשית">${icon('star', 'sm')}</button></div>`,
      )}`,
    );
  const drawTags = () => {
    $$('#tagInput .chip').forEach((c) => c.remove());
    const input = $('#tagText');
    for (const t of ed.tags) {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'chip' + (ed.autoTags.has(t) ? ' auto' : '');
      c.setAttribute('aria-label', `הסרת התגית ${t}`);
      c.innerHTML = `${esc(t)} <svg class="ic sm" aria-hidden="true"><use href="/icons.svg#i-x"/></svg>`;
      c.onclick = () => {
        ed.tags = ed.tags.filter((x) => x !== t);
        if (ed.autoTags.has(t)) ed.removedAuto.add(t);
        drawTags();
        input.focus();
      };
      input.before(c);
    }
    const used = new Set(ed.tags);
    const sugg = state.tags.map((t) => t.tag).filter((t) => !used.has(t) && !KOSHER[t]).slice(0, 10);
    render(
      $('#tagSuggest'),
      sugg.length ? html`<span class="hint">הצעות:</span>${sugg.map((t) => html`<button type="button" class="chip" data-t="${t}">${icon('plus', 'sm')}${t}</button>`)}` : html``,
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

  let autoTimer;
  const refreshAuto = () => {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(async () => {
      if (!$('#f-ingredients')) return;
      const totalMinutes = Number($('#f-total').value) || Number($('#f-prep').value) + Number($('#f-cook').value) || null;
      const { tags } = await api('/api/autotags', { method: 'POST', body: { ingredients: lines('#f-ingredients'), totalMinutes } });
      if (!$('#f-ingredients')) return;
      ed.tags = ed.tags.filter((t) => !ed.autoTags.has(t) || tags.includes(t));
      ed.autoTags = new Set(tags);
      const fresh = tags.filter((t) => !ed.removedAuto.has(t) && !ed.tags.includes(t));
      ed.tags = [...fresh, ...ed.tags];
      drawTags();
    }, 450);
  };
  ['#f-ingredients', '#f-total', '#f-prep', '#f-cook'].forEach((s) => $(s).addEventListener('input', refreshAuto));
  if (isNew && r.kind !== 'link') refreshAuto();

  $('#f-title').addEventListener('input', () => {
    $('#f-title').removeAttribute('aria-invalid');
    $('#titleErr').hidden = true;
  });
  $('#coverFile').onchange = async (e) => {
    try {
      [ed.cover] = await uploadFiles([...e.target.files]);
      drawCover();
    } catch (err) {
      toast(err.message, { error: true });
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
      toast(err.message, { error: true });
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
  $('#delBtn')?.addEventListener('click', async () => {
    if (!confirm(`למחוק את "${r.title}"? אי אפשר לבטל.`)) return;
    await api(`/api/recipes/${r.id}`, { method: 'DELETE' });
    toast('המתכון נמחק', { ic: 'trash-2' });
    location.hash = '#/';
  });

  $('#editor').onsubmit = async (e) => {
    e.preventDefault();
    const pending = $('#tagText').value.trim();
    if (pending) addTag(pending);
    const title = $('#f-title').value.trim();
    if (!title) {
      $('#f-title').setAttribute('aria-invalid', 'true');
      $('#titleErr').hidden = false;
      $('#f-title').focus();
      return;
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
    const btn = $('#editor [type=submit]');
    btn.disabled = true;
    try {
      const saved = isNew ? await api('/api/recipes', { method: 'POST', body }) : await api(`/api/recipes/${r.id}`, { method: 'PUT', body });
      toast(isNew ? 'המתכון נשמר בספר' : 'השינויים נשמרו');
      location.hash = `#/r/${saved.id}`;
    } catch (err) {
      toast(err.message, { error: true });
      btn.disabled = false;
    }
  };
}
const lines = (sel) =>
  $(sel)
    .value.split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

// ---------- dialogs ----------
function openDialog(content, onReady) {
  render(dialog, content);
  dialog.showModal();
  $$('[data-close]', dialog).forEach((b) => (b.onclick = () => dialog.close()));
  onReady?.();
}
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close(); // click on backdrop
});

function collectionDialog(col) {
  openDialog(
    html`<form class="dlg" id="colForm" novalidate>
      <div class="dlg-head"><h2>${col ? 'עריכת אוסף' : 'אוסף חדש'}</h2><button type="button" class="btn round quiet" data-close aria-label="סגירה">${icon('x')}</button></div>
      <div class="field"><label class="label" for="c-name">שם האוסף</label><input id="c-name" required value="${col?.name || ''}" placeholder="שבת, מתכוני סבתא, ארוחות מהירות…" /></div>
      <div class="field"><label class="label" for="c-desc">תיאור <span class="hint">(לא חובה)</span></label><textarea id="c-desc" rows="2">${col?.description || ''}</textarea></div>
      <div class="dlg-actions">
        ${col ? html`<button type="button" class="btn quiet danger" id="c-del">${icon('trash-2', 'sm')}מחיקת האוסף</button>` : ''}
        <span class="spacer"></span>
        <button class="btn primary">${icon('check', 'sm')}שמירה</button>
      </div>
    </form>`,
    () => {
      $('#c-name').focus();
      $('#colForm').onsubmit = async (e) => {
        e.preventDefault();
        const body = { name: $('#c-name').value.trim(), description: $('#c-desc').value.trim() };
        if (!body.name) return $('#c-name').setAttribute('aria-invalid', 'true');
        const saved = col ? await api(`/api/collections/${col.id}`, { method: 'PUT', body }) : await api('/api/collections', { method: 'POST', body });
        dialog.close();
        toast(col ? 'האוסף עודכן' : 'האוסף נוצר', { ic: 'layers-2' });
        if (location.hash === `#/c/${saved.id}`) route();
        else location.hash = `#/c/${saved.id}`;
      };
      $('#c-del')?.addEventListener('click', async () => {
        if (!confirm('למחוק את האוסף? המתכונים עצמם יישארו בספר.')) return;
        await api(`/api/collections/${col.id}`, { method: 'DELETE' });
        dialog.close();
        location.hash = '#/collections';
      });
    },
  );
}

async function shareDialog(scope, targetId, label, ic) {
  const share = await api('/api/shares', { method: 'POST', body: { scope, targetId } });
  const link = `${location.origin}/s/${share.token}`;
  const text = `${label} ב-Recipin: ${link}`;
  openDialog(
    html`<div class="dlg">
      <div class="dlg-head"><h2>שיתוף</h2><button class="btn round quiet" data-close aria-label="סגירה">${icon('x')}</button></div>
      <div class="share-target"><span class="bubble">${icon(ic)}</span><div><strong>${label}</strong><div class="muted small">צפייה בלבד · ההערות האישיות לא משותפות</div></div></div>
      <div class="share-grid">
        <a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">${icon('message-circle', 'lg')}וואטסאפ</a>
        <a class="btn" href="mailto:?subject=${encodeURIComponent('מתכונים מ-Recipin')}&body=${encodeURIComponent(text)}">${icon('mail', 'lg')}מייל</a>
        ${navigator.share
          ? html`<button class="btn" id="nativeShare">${icon('send', 'lg')}עוד…</button>`
          : html`<button class="btn" id="copyBtn2">${icon('copy', 'lg')}העתקה</button>`}
      </div>
      <div class="field"><label class="label" for="shareLink">הקישור</label>
        <div class="link-row"><input readonly value="${link}" id="shareLink" /><button class="btn soft" id="copyBtn">${icon('copy', 'sm')}העתקה</button></div></div>
      <div class="dlg-actions"><button class="btn quiet danger" id="revoke">${icon('x', 'sm')}ביטול הקישור</button></div>
    </div>`,
    () => {
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(link);
        } catch {
          $('#shareLink').select();
          document.execCommand('copy');
        }
        toast('הקישור הועתק', { ic: 'copy' });
      };
      $('#copyBtn').onclick = copy;
      $('#copyBtn2')?.addEventListener('click', copy);
      $('#nativeShare')?.addEventListener('click', () => navigator.share({ title: 'Recipin', text: label, url: link }).catch(() => {}));
      $('#revoke').onclick = async () => {
        if (!confirm('לבטל את הקישור? מי שקיבל אותו כבר לא יוכל לצפות.')) return;
        await api(`/api/shares/${share.token}`, { method: 'DELETE' });
        dialog.close();
        toast('הקישור בוטל');
      };
    },
  );
}

async function showShares() {
  document.title = 'שיתופים · Recipin';
  const [shares, collections] = await Promise.all([api('/api/shares'), api('/api/collections')]);
  const rows = await Promise.all(
    shares.map(async (s) => {
      if (s.scope === 'book') return { s, ic: 'book-open', name: 'כל ספר המתכונים' };
      if (s.scope === 'collection') return { s, ic: 'layers-2', name: collections.find((c) => c.id === s.target_id)?.name || 'אוסף' };
      const r = await api(`/api/recipes/${s.target_id}`).catch(() => null);
      return { s, ic: 'utensils-crossed', name: r?.title || 'מתכון' };
    }),
  );
  render(
    view,
    html`<div class="page narrow">
      <div class="page-head">
        <div><div class="eyebrow">${icon('share-2', 'sm')}מי רואה מה</div><h1>קישורי שיתוף</h1></div>
        <button class="btn primary" id="shareBook">${icon('book-open', 'sm')}שיתוף כל הספר</button>
      </div>
      ${rows.length
        ? html`<ul class="share-list">${rows.map(
            ({ s, ic, name }) => html`<li><span class="bubble">${icon(ic)}</span>
              <div class="info"><strong>${name}</strong><a href="/s/${s.token}" target="_blank" rel="noopener">${location.host}/s/${s.token}</a></div>
              <button class="btn quiet danger" data-t="${s.token}">${icon('x', 'sm')}ביטול</button></li>`,
          )}</ul>`
        : html`<div class="empty">${emptyArt()}<h2>עוד לא שיתפת כלום</h2><p>אפשר לשתף את כל הספר, אוסף או מתכון בודד. מי שמקבל את הקישור יכול רק לצפות.</p></div>`}
    </div>`,
  );
  $('#shareBook').onclick = () => shareDialog('book', null, 'כל ספר המתכונים', 'book-open');
  $$('.share-list [data-t]').forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm('לבטל את הקישור?')) return;
        await api(`/api/shares/${b.dataset.t}`, { method: 'DELETE' });
        toast('הקישור בוטל');
        showShares();
      }),
  );
}

// ---------- boot ----------
if ('serviceWorker' in navigator && !READONLY) navigator.serviceWorker.register('/sw.js').catch(() => {});
route();
