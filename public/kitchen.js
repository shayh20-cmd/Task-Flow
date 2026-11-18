// Kitchen helpers: scale ingredient quantities and find timers in step text.
// Pure functions (no DOM) so they run in the browser and in Node tests.

const UNICODE_FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const WORD_NUMBERS = [
  ['שלושת רבעי', 0.75],
  ['שלושה רבעים', 0.75],
  ['חצי', 0.5],
  ['רבע', 0.25],
  ['שליש', 1 / 3],
];

const NUM = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d*[½¼¾⅓⅔⅛⅜⅝⅞]|\d+(?:[.,]\d+)?)`;
const LEAD = new RegExp(String.raw`^(\s*)(${NUM})(\s*[-–]\s*(${NUM}))?`);

function parseNumber(s) {
  s = s.trim().replace(',', '.');
  let m;
  if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + +m[2] / +m[3];
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return +m[2] ? +m[1] / +m[2] : NaN;
  if ((m = s.match(/^(\d*)([½¼¾⅓⅔⅛⅜⅝⅞])$/))) return (m[1] ? +m[1] : 0) + UNICODE_FRACTIONS[m[2]];
  return parseFloat(s);
}

const NICE = [
  [0, ''], [0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾'], [1, ''],
];
/** 1.5 → "1½", 0.333 → "⅓", 2.4 → "2.4" */
export function formatQty(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  let whole = Math.floor(n);
  const frac = n - whole;
  for (const [v, sym] of NICE) {
    if (Math.abs(frac - v) < 0.04) {
      if (v === 1) whole += 1;
      if (!whole && !sym) return '0';
      return `${whole || ''}${v === 1 ? '' : sym}` || String(whole);
    }
  }
  return String(Math.round(n * 10) / 10);
}

/**
 * Split an ingredient line into { lead, qty, rest } with qty scaled by factor.
 * qty is '' when no leading quantity was found.
 */
export function scaleIngredient(line, factor = 1) {
  if (line.startsWith('## ')) return { lead: '', qty: '', rest: line, scaled: false };
  const m = line.match(LEAD);
  if (m) {
    const a = parseNumber(m[2]);
    const b = m[4] ? parseNumber(m[4]) : null;
    if (Number.isFinite(a)) {
      if (factor === 1) return { lead: m[1], qty: m[0].slice(m[1].length), rest: line.slice(m[0].length), scaled: false };
      const qty = formatQty(a * factor) + (b != null && Number.isFinite(b) ? `–${formatQty(b * factor)}` : '');
      return { lead: m[1], qty, rest: line.slice(m[0].length), scaled: true };
    }
  }
  for (const [word, value] of WORD_NUMBERS) {
    if (line.trimStart().startsWith(word + ' ')) {
      const lead = line.match(/^\s*/)[0];
      const rest = line.trimStart().slice(word.length);
      if (factor === 1) return { lead, qty: word, rest, scaled: false };
      return { lead, qty: formatQty(value * factor), rest, scaled: true };
    }
  }
  return { lead: '', qty: '', rest: line, scaled: false };
}

/** First number in a servings string: "4 מנות" → 4, "12-14 עוגיות" → 12. */
export function baseServings(s) {
  const m = String(s || '').match(/\d+(?:[.,]\d+)?/);
  const n = m ? parseFloat(m[0].replace(',', '.')) : NaN;
  return n > 0 ? n : null;
}

const UNIT_SECONDS = [
  [/^(שניות|שנייה|שניה|sec|secs|seconds?)$/i, 1],
  [/^(דקות|דקה|דק['׳]?|min|mins|minutes?)$/i, 60],
  [/^(שעות|שעה|hr|hrs|hours?)$/i, 3600],
];
const DURATION = new RegExp(
  String.raw`(\d+(?:[.,]\d+)?|חצי|רבע)(?:\s*(?:[-–]|עד)\s*(\d+(?:[.,]\d+)?))?\s*(שניות|שנייה|שניה|דקות|דקה|דק['׳]?|שעות|שעה|seconds?|secs?|minutes?|mins?|hours?|hrs?)(?![\p{L}])`,
  'giu',
);
const SPECIAL = [
  [/שעה וחצי/g, 5400],
  [/שעתיים/g, 7200],
  [/חצי שעה/g, 1800],
  [/רבע שעה/g, 900],
];

/** Find cooking durations in a step: [{ label, seconds, index }] */
export function findDurations(text) {
  const found = [];
  const taken = [];
  for (const [re, seconds] of SPECIAL) {
    for (const m of text.matchAll(re)) {
      found.push({ label: m[0], seconds, index: m.index });
      taken.push([m.index, m.index + m[0].length]);
    }
  }
  for (const m of text.matchAll(DURATION)) {
    if (taken.some(([s, e]) => m.index < e && m.index + m[0].length > s)) continue;
    const n = m[1] === 'חצי' ? 0.5 : m[1] === 'רבע' ? 0.25 : parseFloat(m[1].replace(',', '.'));
    const unit = UNIT_SECONDS.find(([re]) => re.test(m[3]));
    if (!unit || !(n > 0)) continue;
    const seconds = Math.round(n * unit[1]);
    if (seconds < 10 || seconds > 48 * 3600) continue;
    found.push({ label: m[0].trim(), seconds, index: m.index });
  }
  return found.sort((a, b) => a.index - b.index);
}

export function formatClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
