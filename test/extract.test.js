import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractFromHtml, isoDurationToMinutes } from '../server/extract.js';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('JSON-LD inside @graph (WordPress/Yoast style), Hebrew, sections', () => {
  const { method, recipe: r } = extractFromHtml(fx('wordpress-graph.html'), 'https://example.co.il/cake');
  assert.equal(method, 'jsonld');
  assert.equal(r.title, 'עוגת שמרים שוקולד & קינמון');
  assert.equal(r.description, 'עוגת שמרים רכה ועשירה');
  assert.equal(r.author, 'דנה כהן');
  assert.equal(r.image, 'https://example.co.il/cake-1200.jpg');
  assert.equal(r.servings, '2 עוגות');
  assert.equal(r.prepMinutes, 40);
  assert.equal(r.cookMinutes, 35);
  assert.equal(r.totalMinutes, 195);
  assert.equal(r.ingredients.length, 5);
  assert.equal(r.ingredients[0], '1 ק"ג קמח');
  assert.deepEqual(r.steps, [
    '## הבצק',
    'מערבבים את הקמח עם השמרים.',
    'מוסיפים חמאה וחלב ולשים 10 דקות.',
    '## המילוי',
    'ממיסים שוקולד עם חמאה.',
    'אופים 35 דקות ב-180 מעלות.',
  ]);
  assert.equal(r.sourceName, 'בלוג האפייה');
  assert.ok(r.suggestedTags.includes('עוגות'));
  assert.ok(r.suggestedTags.includes('שבת'));
});

test('JSON-LD array, multi-type, string instructions, relative image', () => {
  const { method, recipe: r } = extractFromHtml(fx('plain-array.html'), 'https://www.soups.com/recipes/chicken');
  assert.equal(method, 'jsonld');
  assert.equal(r.title, 'Chicken Soup');
  assert.equal(r.image, 'https://www.soups.com/img/soup.jpg');
  assert.deepEqual(r.steps, ['Put everything in a pot.', 'Simmer for 2 hours.', 'Serve hot.']);
  assert.equal(r.totalMinutes, 150);
  assert.equal(r.servings, '6');
  assert.equal(r.sourceName, 'soups.com');
});

test('Microdata fallback', () => {
  const { method, recipe: r } = extractFromHtml(fx('microdata.html'), 'https://cook.example/pancakes');
  assert.equal(method, 'microdata');
  assert.equal(r.title, 'Fluffy Pancakes');
  assert.deepEqual(r.ingredients, ['1 cup flour', '1 cup milk', '1 egg']);
  assert.deepEqual(r.steps, ['Mix.', 'Fry.']);
  assert.equal(r.totalMinutes, 20);
  assert.equal(r.image, 'https://cook.example/p.jpg');
});

test('No structured data → link card from Open Graph', () => {
  const { method, recipe: r } = extractFromHtml(fx('no-recipe.html'), 'https://blog.example/post');
  assert.equal(method, 'link');
  assert.equal(r.title, 'שקשוקה של אבא');
  assert.equal(r.image, 'https://blog.example/shakshuka.jpg');
  assert.equal(r.sourceName, 'הבלוג של אבא');
  assert.deepEqual(r.ingredients, []);
});

test('Broken JSON-LD does not crash', () => {
  const { method } = extractFromHtml('<script type="application/ld+json">{not json</script><title>x</title>', 'https://a.b/');
  assert.equal(method, 'link');
});

test('ISO 8601 durations', () => {
  assert.equal(isoDurationToMinutes('PT1H30M'), 90);
  assert.equal(isoDurationToMinutes('PT45M'), 45);
  assert.equal(isoDurationToMinutes('P0DT0H20M'), 20);
  assert.equal(isoDurationToMinutes('PT0M'), null);
  assert.equal(isoDurationToMinutes('30'), 30);
  assert.equal(isoDurationToMinutes('garbage'), null);
  assert.equal(isoDurationToMinutes(undefined), null);
});
