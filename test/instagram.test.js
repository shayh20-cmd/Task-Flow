import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser } from 'linkedom';
import { instagramPost, importInstagram } from '../public/shared/instagram.js';
import { parseDoc as serverDoc } from '../server/extract.js';
import { parseDoc as domDoc } from '../public/shared/extract-dom.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const ADAPTERS = { server: serverDoc, app: (h) => domDoc(h, DOMParser) };

/** fake network: embed page and post page answer with the given fixtures */
const io = (embed, page, parse) => ({
  parse,
  fetchText: async (u) => {
    const f = u.includes('/embed/') ? embed : page;
    if (!f) throw new Error('blocked');
    return fx(f);
  },
});

test('recognises post / reel links', () => {
  assert.deepEqual(instagramPost('https://www.instagram.com/p/DAbc123xyz/?igsh=xx'), { kind: 'p', code: 'DAbc123xyz' });
  assert.deepEqual(instagramPost('https://instagram.com/reel/C9z_Ab-12/'), { kind: 'reel', code: 'C9z_Ab-12' });
  assert.deepEqual(instagramPost('https://www.instagram.com/noa.bakes/p/DAbc123xyz/'), { kind: 'p', code: 'DAbc123xyz' });
  assert.equal(instagramPost('https://www.ynet.co.il/food'), null);
});

for (const [name, parse] of Object.entries(ADAPTERS)) {
  test(`[${name}] embed page: caption, author, largest image`, async () => {
    const r = await importInstagram('https://www.instagram.com/p/DAbc123xyz/', io('ig-embed.html', 'ig-login.html', parse));
    assert.equal(r.method, 'instagram');
    assert.equal(r.recipe.title, 'עוגיות חמאה פריכות');
    assert.equal(r.recipe.author, '@noa.bakes');
    assert.equal(r.recipe.image, 'https://scontent.cdninstagram.com/v/1080.jpg');
    assert.deepEqual(r.recipe.ingredients, ['250 גרם חמאה', '1 כוס סוכר', '3 כוסות קמח']);
    assert.deepEqual(r.recipe.steps, ['מערבבים הכל לבצק.', 'אופים 12 דקות ב-180 מעלות.']);
    assert.ok(!r.caption.includes('View all'));
    assert.ok(r.recipe.suggestedTags.includes('עוגיות'));
  });

  test(`[${name}] embed with JSON data (reel)`, async () => {
    const r = await importInstagram('https://www.instagram.com/reel/C9zAb12/', io('ig-embed-json.html', 'ig-login.html', parse));
    assert.equal(r.recipe.title, 'Quick tomato soup');
    assert.equal(r.recipe.image, 'https://scontent.cdninstagram.com/v/reel-cover.jpg');
    assert.deepEqual(r.recipe.ingredients, ['6 tomatoes', '1 onion']);
    assert.equal(r.recipe.sourceUrl, 'https://www.instagram.com/reel/C9zAb12/');
  });

  test(`[${name}] embed blocked → link-preview tags`, async () => {
    const r = await importInstagram('https://www.instagram.com/p/XYZ12345/', io(null, 'ig-preview.html', parse));
    assert.equal(r.method, 'instagram');
    assert.equal(r.recipe.author, '@dana.cooks');
    assert.equal(r.recipe.title, 'שקשוקה של שישי');
    assert.deepEqual(r.recipe.ingredients, ['6 עגבניות', '4 ביצים']);
    assert.equal(r.recipe.image, 'https://scontent.cdninstagram.com/v/shak.jpg?stp=dst-jpg&oh=abc');
  });

  test(`[${name}] everything blocked → link card with a clear message`, async () => {
    const r = await importInstagram('https://www.instagram.com/p/XYZ12345/', io(null, null, parse));
    assert.equal(r.method, 'link');
    assert.match(r.error, /אינסטגרם/);
    assert.equal(r.recipe.sourceName, 'Instagram');
  });
}
