import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scaleIngredient, formatQty, baseServings, findDurations, formatClock } from '../public/kitchen.js';

const scaled = (line, f) => {
  const r = scaleIngredient(line, f);
  return r.lead + r.qty + r.rest;
};

test('formatQty uses kitchen fractions', () => {
  assert.equal(formatQty(1.5), '1½');
  assert.equal(formatQty(0.25), '¼');
  assert.equal(formatQty(2 / 3), '⅔');
  assert.equal(formatQty(3), '3');
  assert.equal(formatQty(0.99), '1');
  assert.equal(formatQty(2.4), '2.4');
});

test('scale ingredient lines', () => {
  assert.equal(scaled('2 כוסות קמח', 2), '4 כוסות קמח');
  assert.equal(scaled('1/2 כוס סוכר', 3), '1½ כוס סוכר');
  assert.equal(scaled('1 1/2 cups milk', 2), '3 cups milk');
  assert.equal(scaled('½ כפית מלח', 2), '1 כפית מלח');
  assert.equal(scaled('1½ כוסות מים', 2), '3 כוסות מים');
  assert.equal(scaled('2-3 שיני שום', 2), '4–6 שיני שום');
  assert.equal(scaled('חצי כוס שמן', 2), '1 כוס שמן');
  assert.equal(scaled('200 גרם חמאה', 0.5), '100 גרם חמאה');
  assert.equal(scaled('מלח ופלפל', 2), 'מלח ופלפל');
  assert.equal(scaled('## לבצק', 2), '## לבצק');
  assert.equal(scaleIngredient('2 ביצים', 2).scaled, true);
  assert.equal(scaleIngredient('2 ביצים', 1).qty, '2');
});

test('base servings', () => {
  assert.equal(baseServings('4 מנות'), 4);
  assert.equal(baseServings('12-14 עוגיות'), 12);
  assert.equal(baseServings('2 עוגות'), 2);
  assert.equal(baseServings(''), null);
});

test('find durations in steps (Hebrew + English)', () => {
  assert.deepEqual(findDurations('אופים 35 דקות ב-180 מעלות.').map((d) => d.seconds), [2100]);
  assert.deepEqual(findDurations("מבשלים 10 דק' ואז עוד 5 דקות").map((d) => d.seconds), [600, 300]);
  assert.deepEqual(findDurations('מתפיחים שעה וחצי').map((d) => d.seconds), [5400]);
  assert.deepEqual(findDurations('מתפיחים כשעתיים').map((d) => d.seconds), [7200]);
  assert.deepEqual(findDurations('מבשלים חצי שעה').map((d) => d.seconds), [1800]);
  assert.deepEqual(findDurations('אופים 20-25 דקות').map((d) => [d.label, d.seconds]), [['20-25 דקות', 1200]]);
  assert.deepEqual(findDurations('Simmer for 2 hours.').map((d) => d.seconds), [7200]);
  assert.deepEqual(findDurations('Bake 12 minutes').map((d) => d.seconds), [720]);
  assert.deepEqual(findDurations('מוסיפים 3 ביצים ו-2 כוסות'), []);
  assert.deepEqual(findDurations('אופים ב-180 מעלות'), []);
});

test('clock format', () => {
  assert.equal(formatClock(65), '1:05');
  assert.equal(formatClock(3725), '1:02:05');
});
