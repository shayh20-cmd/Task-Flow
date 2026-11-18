// Turn free recipe text (an Instagram caption, a WhatsApp message, a pasted blog post) into
// { title, description, ingredients, steps, servings, suggestedTags } — rule-based, no AI.

const ING_HEADER =
  /^(?:ה?מצרכים|ה?מרכיבים|ה?רכיבים|ה?חומרים|מה צריך|מה צריך\?|רשימת קניות|ingredients?|you'?ll need|what you(?:'ll)? need)(?:\s|:|$|\(|ל|-)/i;
const STEP_HEADER =
  /^(?:אופן\s*ה?הכנה|דרך\s*ה?הכנה|שלבי\s*ה?הכנה|הוראות(?:\s*הכנה)?|ה?הכנה|איך מכינים|instructions?|method|directions?|preparation|how to(?: make)?|steps?)(?:\s|:|$|\(|-)/i;
const END_LINE = /^(?:בתיאבון|בהצלחה|שמרו|תשמרו|תייגו|שתפו|לחצו|קישור ב|לינק ב|למתכונים נוספים|enjoy|save this|follow|tag a friend|link in bio)/i;
const QTY_START =
  /^(?:\d|[½¼¾⅓⅔⅛]|חצי\s|רבע\s|שליש\s|כוס|כוסות|כף\s|כפות|כפית|כפיות|קורט|קמצוץ|מעט|חופן|שקית|שקיות|חבילה|חבילת|קופסה|קופסת|צרור|גרם|ק"ג|קילו|ליטר|מ"ל|יחידה|יחידות|ביצה|ביצים)/;
const NUMBERED = /^\(?(\d{1,2})[.)\-:]\s*/;

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;
const LEAD_JUNK = /^[^\p{L}\p{N}(½¼¾⅓⅔⅛"'#]+/u;

function cleanLine(line) {
  return line
    .replace(/[​-‏‪-‮⁦-⁩]/g, '') // invisible direction marks
    .replace(EMOJI, ' ')
    .replace(LEAD_JUNK, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHashtags(text) {
  const tags = [];
  const lines = text.split('\n').map((line) => {
    let n = 0;
    const rest = line.replace(/(^|\s)#([\p{L}\p{N}_]{2,40})/gu, (_, sp, t) => {
      tags.push(t.replace(/_/g, ' '));
      n++;
      return sp;
    });
    // a hashtag line with a stray word or two ("#cookies #baking & fun") is dropped entirely
    if (n && rest.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean).length <= 2) return '';
    return rest;
  });
  return { text: lines.join('\n'), tags: [...new Set(tags)] };
}

function shortTitle(line) {
  let t = line.replace(/\s*[:–-]\s*$/, '');
  const cut = t.search(/[.!?](\s|$)/);
  if (cut > 8) t = t.slice(0, cut);
  if (t.length > 60) {
    // a long opening sentence: keep its first clause
    const clause = t.slice(15, 61).search(/[,،;]|\s[-–]\s/);
    t = clause >= 0 ? t.slice(0, clause + 15) : t.slice(0, 58).replace(/\s+\S*$/, '') + '…';
  }
  return t.trim();
}

/** True when the text has no sign of a written recipe (no quantities or units anywhere). */
export function isStoryOnly(text) {
  return !/(\d|[½¼¾⅓⅔]|חצי|רבע)\s*(כוס|כוסות|כף|כפות|כפית|כפיות|גרם|ג'|ק"ג|קילו|מ"ל|ליטר|יחידות|ביצים|cups?|tbsp|tsp|g\b|grams?|ml\b|oz\b)/i.test(text || '');
}

function findServings(text) {
  // "מצרכים (ל-2 בבקות):" — the unit after "ל-" in an ingredients header can be any word
  const h = text.match(/(?:מצרכים|מרכיבים|רכיבים)[^\n]*?ל-?\s*(\d{1,3}(?:\s*[-–]\s*\d{1,3})?)\s+(\p{L}+)/u);
  if (h) return `${h[1].replace(/\s+/g, '')} ${h[2]}`;
  const en = text.match(/(?:serves|servings?|makes|yield)[:\s]*(\d{1,3}(?:\s*[-–]\s*\d{1,3})?)\s*(servings?|people|pieces|cookies)?/i);
  if (en) return `${en[1].replace(/\s+/g, '')} ${en[2] || 'servings'}`;
  const m =
    text.match(/(?:ל-?|כ-?)?(\d{1,3}(?:\s*[-–]\s*\d{1,3})?)\s*(מנות|סועדים|אנשים|יחידות|עוגיות|קציצות|לחמניות|חתיכות|פרוסות)/);
  if (!m) return '';
  return `${m[1].replace(/\s+/g, '')} ${m[2] || 'מנות'}`.trim();
}

function asSubheading(line) {
  // "לבצק:" / "For the sauce:" inside a section → "## לבצק"
  const t = line.replace(/:$/, '').trim();
  if (line.endsWith(':') && t.length <= 32 && !/\d/.test(t)) return '## ' + t;
  return null;
}

/** @returns {{title:string, description:string, ingredients:string[], steps:string[], servings:string, suggestedTags:string[]}} */
export function parseRecipeText(input) {
  const { text, tags } = extractHashtags(String(input || '').replace(/\r\n?/g, '\n'));
  const lines = text
    .split('\n')
    .map(cleanLine)
    .filter((l) => l && !/^[.\-–—_*=~]+$/.test(l));

  const intro = [];
  const ingredients = [];
  const steps = [];
  let mode = 'intro';
  let sawHeader = false;

  for (const raw of lines) {
    const line = raw.replace(/^[-–•*]\s*/, '');
    if (ING_HEADER.test(line) && line.length <= 60) {
      mode = 'ing';
      sawHeader = true;
      const after = line.split(':').slice(1).join(':').trim();
      if (after && !/^\(?ל/.test(after) && after.length > 2 && QTY_START.test(after)) ingredients.push(after);
      continue;
    }
    if (STEP_HEADER.test(line) && line.length <= 60) {
      mode = 'steps';
      sawHeader = true;
      const after = line.split(':').slice(1).join(':').trim();
      if (after.length > 6) steps.push(after.replace(NUMBERED, ''));
      continue;
    }
    if (END_LINE.test(line) && mode !== 'intro') {
      mode = 'end';
      continue;
    }
    if (mode === 'intro') intro.push(line);
    else if (mode === 'ing') ingredients.push(asSubheading(line) || line);
    else if (mode === 'steps') steps.push(asSubheading(line) || line.replace(NUMBERED, ''));
  }

  // No headers: classify line by line (numbered → step, starts with a quantity → ingredient).
  if (!sawHeader) {
    const rest = [];
    for (const line of intro) {
      if (NUMBERED.test(line) && line.length > 12) steps.push(line.replace(NUMBERED, ''));
      else if (QTY_START.test(line) && line.length <= 70 && !/[.!?]$/.test(line)) ingredients.push(line);
      else if (ingredients.length && !steps.length && line.length > 40) steps.push(line);
      else if (steps.length) steps.push(line);
      else rest.push(line);
    }
    intro.length = 0;
    intro.push(...rest);
  }

  const titleLine = intro.find((l) => !END_LINE.test(l)) || '';
  const description = intro
    .filter((l) => l !== titleLine && !END_LINE.test(l))
    .slice(0, 3)
    .join(' ')
    .slice(0, 400);

  return {
    title: titleLine ? shortTitle(titleLine) : '',
    description,
    ingredients,
    steps,
    servings: findServings(text),
    suggestedTags: tags.slice(0, 12),
  };
}
