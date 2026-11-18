// Main category of a recipe (one per recipe): rule-based suggestion from the title and ingredients. No AI.

export const DEFAULT_CATEGORIES = [
  'סלטים',
  'מרקים',
  'עוף',
  'בשר',
  'דגים',
  'צמחוני',
  'פסטה ואורז',
  'מאפים ולחמים',
  'תוספות',
  'קינוחים',
  'ארוחת בוקר',
  'רטבים וממרחים',
  'משקאות',
];

// Title words decide first: "סלט עוף" is a salad, "מרק עוף" is a soup, "עוגת גזר" is a dessert.
const BY_TITLE = [
  ['קינוחים', /עוג(ה|ת|ות|יות|יה)|קינוח|מוס(?=$|[^\p{L}])|פודינג|גלידה|טירמיסו|בראוניז|מאפינס|קאפקייק|ריבת חלב|פאי(?=$|[^\p{L}])|טארט|פבלובה|מרנג|קרם ברולה|ממתק|שוקולד|סופלה|crumble|cake|cookie|brownie|dessert|pudding|mousse|tart|ice cream/iu],
  ['סלטים', /סלט|טאבולה|קולסלאו|salad/iu],
  ['מרקים', /מרק|ציר(?=$|[^\p{L}])|קציצות במרק|soup|broth/iu],
  ['ארוחת בוקר', /שקשוקה|חביתה|פנקייק|פנקייקים|גרנולה|דייסה|ביצה עלומה|טוסט צרפתי|בוקר|omelet|pancake|granola|porridge|breakfast/iu],
  // only when the name starts with it: "קציצות ברוטב עגבניות" is a main dish, "רוטב עגבניות" is a sauce
  ['רטבים וממרחים', /^\s*(רוטב|ממרח|מטבל|פסטו|טחינה|חומוס|מטבוחה|איולי|סלסה|sauce|dip|spread|pesto|dressing)/iu],
  ['משקאות', /שייק|לימונדה|משקה|קוקטייל|תה(?=$|[^\p{L}])|קפה|סמוטי|smoothie|lemonade|drink|cocktail|latte/iu],
  ['מאפים ולחמים', /לחם|חלה|לחמני|פוקאצ|פיתות|פיצה|בורקס|מאפה|מאפים|פשטיד|קיש|גלט|בצק|כרואסון|בייגל|bread|focaccia|pizza|quiche|pie\b|bagel|buns?/iu],
  ['פסטה ואורז', /פסטה|ספגטי|פטוצ'יני|לזניה|ניוקי|ריזוטו|אורז|מג'דרה|פלאו|קוסקוס|נודלס|pasta|spaghetti|lasagna|risotto|rice|noodles|gnocchi/iu],
  ['תוספות', /תוספת|פירה|צ'יפס|תפוחי אדמה|ירקות צלויים|ירקות בתנור|side dish|mashed|fries|roasted vegetables/iu],
  ['דגים', /דג |דגים|סלמון|טונה|אמנון|דניס|לברק|בקלה|שרימפס|פירות ים|fish|salmon|tuna|cod|shrimp|seafood/iu],
  ['עוף', /עוף|פרגית|פרגיות|שניצל|כרעיים|שוקיים|כנפיים|הודו(?=$|[^\p{L}])|chicken|turkey/iu],
  ['בשר', /בשר|בקר|כבש|טלה|אנטריקוט|אסאדו|צלעות|המבורגר|קבב|שווארמה|סטייק|קציצות בשר|beef|lamb|steak|burger|meatballs/iu],
];

// Otherwise the main protein in the ingredients decides.
const CHICKEN = /עוף|פרגית|פרגיות|כרעיים|שוקיים|כנפיים|חזה עוף|chicken/i;
const TURKEY = /(^|[^\p{L}])הודו(?=$|[^\p{L}])|turkey/iu;
const MEAT = /בשר|בקר|כבש|טלה|אנטריקוט|אסאדו|צלעות|סטייק|beef|lamb|steak|veal/i;
const FISH = /(^|[^\p{L}])[והב]?דג(ים)?(?=$|[^\p{L}])|סלמון|טונה|אמנון|דניס|לברק|בקלה|שרימפס|fish|salmon|tuna|cod|shrimp/iu;
const NOT_MEAT = /בשר צמחי|טבעול|אגוז(י)? הודו|אבקת מרק עוף|plant-based|vegan/gi;

/** @returns {string} a category from DEFAULT_CATEGORIES, or '' when there is nothing to go on */
export function suggestCategory({ title = '', ingredients = [] } = {}) {
  const t = String(title);
  for (const [cat, re] of BY_TITLE) if (re.test(t)) return cat;
  const ings = (ingredients || []).filter((l) => !String(l).startsWith('## ')).join(' | ').replace(NOT_MEAT, ' ');
  if (!ings.trim()) return '';
  if (FISH.test(ings) && !CHICKEN.test(ings) && !MEAT.test(ings)) return 'דגים';
  if (CHICKEN.test(ings) || TURKEY.test(ings)) return 'עוף';
  if (MEAT.test(ings)) return 'בשר';
  if (FISH.test(ings)) return 'דגים';
  return '';
}
