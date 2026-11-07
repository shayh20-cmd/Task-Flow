import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoTags } from '../server/autotag.js';

const tags = (ingredients, totalMinutes) => autoTags({ ingredients, totalMinutes });

test('dairy', () => {
  assert.deepEqual(tags(['200 גרם חמאה', '2 כוסות קמח', '3 ביצים']), ['חלבי', 'צמחוני']);
});

test('meat wins over everything and is not vegetarian', () => {
  assert.deepEqual(tags(['1 ק"ג כרעיים עוף', 'מלח', 'פפריקה']), ['בשרי']);
});

test('parve + vegan', () => {
  assert.deepEqual(tags(['2 כוסות קמח', 'חצי כוס שמן', 'מים', 'סוכר']), ['פרווה', 'טבעוני']);
});

test('plant milks and peanut butter are not dairy', () => {
  assert.deepEqual(tags(['1 כוס חלב קוקוס', '2 כפות חמאת בוטנים', 'שיבולת שועל']), ['פרווה', 'טבעוני']);
  assert.deepEqual(tags(['1 cup almond milk', 'oats']), ['פרווה', 'טבעוני']);
});

test('fish is parve, tagged fish, not vegetarian', () => {
  assert.deepEqual(tags(['פילה סלמון', 'לימון']), ['פרווה', 'דגים']);
});

test('English words need a word start (no "ham" in "shamrock")', () => {
  assert.deepEqual(tags(['shamrock leaves', 'water']), ['פרווה', 'טבעוני']);
  assert.deepEqual(tags(['2 tbsp butter']), ['חלבי', 'צמחוני']);
});

test('time tags', () => {
  assert.ok(tags(['מים'], 20).includes('עד 30 דקות'));
  assert.ok(tags(['מים'], 180).includes('הכנה ארוכה'));
  assert.deepEqual(tags([], 25), ['עד 30 דקות']);
});

test('section headings are ignored', () => {
  assert.deepEqual(tags(['## לבצק', 'קמח', 'מים']), ['פרווה', 'טבעוני']);
});
