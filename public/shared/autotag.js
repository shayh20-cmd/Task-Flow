// Rule-based auto tags from ingredients + times. No AI.
// Deliberately no automatic "gluten-free" tag: a false positive could harm someone with celiac.

// Phrases that contain a dairy/meat word but aren't dairy/meat. Removed before matching.
const NOT_DAIRY = [
  'חלב קוקוס', 'חלב שקדים', 'חלב סויה', 'חלב שיבולת שועל', 'חלב אורז', 'חלב צמחי', 'משקה סויה', 'משקה שקדים',
  'שמנת צמחית', 'שמנת קוקוס', 'קרם קוקוס', 'חמאת בוטנים', 'חמאת שקדים', 'חמאת קקאו', 'חמאה צמחית', 'מרגרינה',
  'גבינה טבעונית', 'יוגורט סויה', 'יוגורט קוקוס',
  'coconut milk', 'almond milk', 'soy milk', 'oat milk', 'rice milk', 'plant milk', 'coconut cream',
  'peanut butter', 'almond butter', 'cocoa butter', 'vegan butter', 'vegan cheese', 'non-dairy', 'dairy-free',
];
const DAIRY = [
  'חלב', 'חמאה', 'שמנת', 'גבינ', 'יוגורט', 'לבנה', 'לאבנה', 'קוטג', 'מוצרלה', 'פרמזן', 'ריקוטה', 'מסקרפונה',
  'פטה', 'בולגרית', 'צפתית', 'חלומי', 'צ\'דר', 'מעדן חלב', 'רוויון', 'אשל', 'שוקולד חלב',
  'milk', 'butter', 'cream', 'cheese', 'yogurt', 'yoghurt', 'mozzarella', 'parmesan', 'ricotta', 'mascarpone',
  'feta', 'cheddar', 'ghee', 'buttermilk', 'kefir',
];
const NOT_MEAT = ['אבקת מרק עוף פרווה', 'מרק עוף צמחי', 'בשר צמחי', 'טבעול', 'אגוז הודו', 'אגוזי הודו', 'vegan chicken', 'plant-based meat', 'beyond meat'];
const MEAT = [
  'עוף', 'בשר', 'בקר', 'כבש', 'טלה', 'הודו', 'שניצל', 'כרעיים', 'שוקיים', 'כנפיים', 'חזה', 'פרגית', 'פרגיות',
  'אנטריקוט', 'אסאדו', 'צלעות', 'נקניק', 'סלמי', 'פסטרמה', 'כבד', 'שווארמה', 'המבורגר', 'אווז', 'ברווז',
  'chicken', 'beef', 'lamb', 'turkey', 'veal', 'pork', 'bacon', 'ham', 'sausage', 'steak', 'ground meat', 'mince',
  'duck', 'salami', 'pastrami', 'brisket',
];
const FISH = ['דג', 'סלמון', 'טונה', 'אמנון', 'דניס', 'לברק', 'בקלה', 'סרדין', 'אנשובי', 'מושט', 'בורי',
  'fish', 'salmon', 'tuna', 'cod', 'tilapia', 'anchov', 'sardine', 'trout', 'sea bass'];
const EGG = ['ביצ', 'egg'];
const HONEY = ['דבש', 'honey'];

const lower = (s) => String(s || '').toLowerCase();

function strip(text, phrases) {
  let t = text;
  for (const p of phrases) t = t.split(p).join(' ');
  return t;
}

// Short Hebrew words that hide inside other words ("לכבד" = to serve, "אגוז הודו" = coconut):
// these match only as a whole word, with an optional one-letter prefix (ו/ה/ב/מ/ש; not ל — "לכבד" is "to serve") and plural ending.
const WHOLE_WORD = new Set(['כבד', 'חזה', 'הודו', 'כבש', 'טלה', 'בקר', 'דג']);

function hasWord(text, words) {
  return words.some((w) => {
    // English: require a word boundary at the start.
    if (/[a-z]/.test(w)) return new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(text);
    if (WHOLE_WORD.has(w)) return new RegExp(`(^|[^\\p{L}])[והבמש]?${w}(ים|ות|ה)?(?=$|[^\\p{L}])`, 'u').test(text);
    // Other Hebrew words: substring is fine (prefixes like ו/ה/ב attach to words).
    return text.includes(w);
  });
}

/**
 * @param {{ingredients?: string[], totalMinutes?: number|null}} recipe
 * @returns {string[]} auto tags (Hebrew)
 */
/** Tags that autoTags() can produce. They are managed by Recipin, not renamed by hand. */
export const AUTO_TAGS = ['בשרי', 'חלבי', 'פרווה', 'דגים', 'טבעוני', 'צמחוני', 'עד 30 דקות', 'הכנה ארוכה'];

export function autoTags(recipe) {
  const ings = (recipe.ingredients || []).map(lower).filter((l) => !l.startsWith('##'));
  const tags = [];
  if (ings.length) {
    const all = ings.join(' | ');
    const dairy = hasWord(strip(all, NOT_DAIRY), DAIRY);
    const meat = hasWord(strip(all, NOT_MEAT), MEAT);
    const fish = hasWord(all, FISH);
    if (meat) tags.push('בשרי');
    else if (dairy) tags.push('חלבי');
    else tags.push('פרווה');
    if (fish) tags.push('דגים');
    if (!meat && !fish) {
      if (!dairy && !hasWord(all, EGG) && !hasWord(all, HONEY)) tags.push('טבעוני');
      else tags.push('צמחוני');
    }
  }
  const t = recipe.totalMinutes;
  if (t && t <= 30) tags.push('עד 30 דקות');
  else if (t && t > 120) tags.push('הכנה ארוכה');
  return tags;
}
