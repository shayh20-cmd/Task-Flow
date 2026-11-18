import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipeText } from '../public/shared/recipe-text.js';

test('Hebrew Instagram caption with headers, emoji and hashtags', () => {
  const caption = `🍫 בבקה שוקולד הכי עסיסית שיש! 🍫
המתכון שכולם ביקשו, מושלם לשבת ❤️

📝 מצרכים (ל-2 בבקות):
▪️ 1 ק"ג קמח
▪️ 20 גרם שמרים יבשים
▪️ ½ כוס סוכר
▪️ 1.5 כוסות חלב
למילוי:
▪️ 200 גרם שוקולד מריר
▪️ 3 כפות קקאו

👩‍🍳 אופן ההכנה:
1. מערבבים את כל חומרי הבצק ולשים 10 דקות.
2. מתפיחים שעה וחצי.
3. מורחים מילוי, מגלגלים ואופים 30 דקות ב-175 מעלות.

בתיאבון! שמרו את המתכון 💾
#בבקה #שוקולד #מתכונים_לשבת #אפייה`;
  const r = parseRecipeText(caption);
  assert.equal(r.title, 'בבקה שוקולד הכי עסיסית שיש');
  assert.equal(r.description, 'המתכון שכולם ביקשו, מושלם לשבת');
  assert.deepEqual(r.ingredients, [
    '1 ק"ג קמח',
    '20 גרם שמרים יבשים',
    '½ כוס סוכר',
    '1.5 כוסות חלב',
    '## למילוי',
    '200 גרם שוקולד מריר',
    '3 כפות קקאו',
  ]);
  assert.deepEqual(r.steps, [
    'מערבבים את כל חומרי הבצק ולשים 10 דקות.',
    'מתפיחים שעה וחצי.',
    'מורחים מילוי, מגלגלים ואופים 30 דקות ב-175 מעלות.',
  ]);
  assert.equal(r.servings, '2 בבקות');
  assert.deepEqual(r.suggestedTags, ['בבקה', 'שוקולד', 'מתכונים לשבת', 'אפייה']);
});

test('servings are detected', () => {
  assert.equal(parseRecipeText('שקשוקה\nמצרכים ל-4 מנות:\n6 עגבניות').servings, '4 מנות');
  assert.equal(parseRecipeText('Pancakes\nServes 4\nIngredients:\n1 cup flour').servings, '4 servings');
});

test('English caption', () => {
  const r = parseRecipeText(`Easy 15-minute garlic pasta 🍝
Ingredients:
- 200g spaghetti
- 4 cloves garlic
- 3 tbsp olive oil
Method:
1) Cook the pasta.
2) Fry garlic in oil for 2 minutes and toss.
Save this for later! #pasta #quickdinner`);
  assert.equal(r.title, 'Easy 15-minute garlic pasta');
  assert.deepEqual(r.ingredients, ['200g spaghetti', '4 cloves garlic', '3 tbsp olive oil']);
  assert.deepEqual(r.steps, ['Cook the pasta.', 'Fry garlic in oil for 2 minutes and toss.']);
  assert.deepEqual(r.suggestedTags, ['pasta', 'quickdinner']);
});

test('no headers: classify by quantities and numbering', () => {
  const r = parseRecipeText(`סלט עדשים של סבתא
2 כוסות עדשים ירוקות
1 בצל סגול
חצי צרור פטרוזיליה
1. מבשלים את העדשים 20 דקות.
2. מערבבים עם הירקות ומתבלים.`);
  assert.equal(r.title, 'סלט עדשים של סבתא');
  assert.deepEqual(r.ingredients, ['2 כוסות עדשים ירוקות', '1 בצל סגול', 'חצי צרור פטרוזיליה']);
  assert.deepEqual(r.steps, ['מבשלים את העדשים 20 דקות.', 'מערבבים עם הירקות ומתבלים.']);
});

test('caption without a recipe stays as description', () => {
  const r = parseRecipeText('ערב מושלם עם חברים 🥂 #friday');
  assert.equal(r.title, 'ערב מושלם עם חברים');
  assert.deepEqual(r.ingredients, []);
  assert.deepEqual(r.steps, []);
});

test('empty input', () => {
  assert.deepEqual(parseRecipeText(''), { title: '', description: '', ingredients: [], steps: [], servings: '', suggestedTags: [] });
});

test('"מה צריכים?" header and ingredients without a leading quantity', () => {
  const r = parseRecipeText(`אורז יווני עם עדשים
מה צריכים?
2 כוסות אורז בסמטי
כרישה קצוצה
בצל סגול קצוץ
כפית וחצי מלח
איך מכינים:
מקפיצים את הירקות 5 דקות.`);
  assert.deepEqual(r.ingredients, ['2 כוסות אורז בסמטי', 'כרישה קצוצה', 'בצל סגול קצוץ', 'כפית וחצי מלח']);
  assert.deepEqual(r.steps, ['מקפיצים את הירקות 5 דקות.']);
});

test('no ingredients header but a steps header: the quantity block becomes the ingredients', () => {
  const r = parseRecipeText(`פסטה ברוטב עגבניות. מהיר ומנחם.
250 גרם פסטה
3 עגבניות
שום כתוש
2 כפות שמן זית
אופן ההכנה:
מבשלים את הפסטה.`);
  assert.equal(r.title, 'פסטה ברוטב עגבניות');
  assert.deepEqual(r.ingredients, ['250 גרם פסטה', '3 עגבניות', 'שום כתוש', '2 כפות שמן זית']);
});

test('OCR cleanup: reversed "ל-180" and step numbers without a dot', async () => {
  const { cleanOcrText } = await import('../public/shared/recipe-text.js');
  assert.equal(cleanOcrText('מחממים תנור 180-7 מעלות.'), 'מחממים תנור ל-180 מעלות.');
  assert.equal(cleanOcrText('אופים 25 דקות 180-ב מעלות'), 'אופים 25 דקות ב-180 מעלות');
  assert.equal(cleanOcrText('2 כוסות קמח\n|\n\n\n\n1 כוס סוכר'), '2 כוסות קמח\n\n1 כוס סוכר');
  const r = parseRecipeText('עוגה\nמצרכים:\n3 ביצים\nאופן ההכנה:\n1. מערבבים.\n2. יוצקים לתבנית.\n3 אופים 40 דקות.');
  assert.deepEqual(r.steps, ['מערבבים.', 'יוצקים לתבנית.', 'אופים 40 דקות.']);
});
