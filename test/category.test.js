import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestCategory } from '../public/shared/category.js';

const cat = (title, ingredients = []) => suggestCategory({ title, ingredients });

test('title decides first', () => {
  assert.equal(cat('סלט עוף אסייתי', ['חזה עוף']), 'סלטים');
  assert.equal(cat('מרק עוף של סבתא', ['עוף שלם']), 'מרקים');
  assert.equal(cat('עוגת גזר'), 'קינוחים');
  assert.equal(cat('עוגיות חמאה של סבתא רחל'), 'קינוחים');
  assert.equal(cat('שקשוקה של אבא'), 'ארוחת בוקר');
  assert.equal(cat('פשטידת ירקות'), 'מאפים ולחמים');
  assert.equal(cat('אורז יווני עם עדשים'), 'פסטה ואורז');
  assert.equal(cat('Classic Chicken Noodle Soup'), 'מרקים');
  assert.equal(cat('רוטב עגבניות ביתי'), 'רטבים וממרחים');
  assert.equal(cat('שניצל פריך בתנור'), 'עוף');
  assert.equal(cat('קציצות דגים ברוטב עגבניות'), 'דגים');
});

test('otherwise the main protein in the ingredients', () => {
  assert.equal(cat('ארוחת ערב מהירה', ['4 שוקיים', 'פפריקה']), 'עוף');
  assert.equal(cat('תבשיל של שישי', ['1 ק"ג בשר בקר', 'בצל']), 'בשר');
  assert.equal(cat('בתנור עם לימון', ['פילה סלמון', 'לימון']), 'דגים');
  assert.equal(cat('קציצות עדשים', ['2 כוסות עדשים']), '');
  assert.equal(cat('עוגת קוקוס'), 'קינוחים');
  assert.equal(cat('משהו', ['כוס אגוז הודו']), '');
  assert.equal(cat('', []), '');
});

test('Hebrew standalone words (no \\b in JS for Hebrew)', () => {
  assert.equal(cat('מוס שוקולד'), 'קינוחים');
  assert.equal(cat('תה נענע קר'), 'משקאות');
  assert.equal(cat('חזה הודו בתנור'), 'עוף');
  assert.equal(cat('ציר עוף'), 'מרקים');
  assert.equal(cat('מוסקה'), '');
});
