// The Android app parses pages with DOMParser; it must give the same result as the server (cheerio).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DOMParser } from 'linkedom';
import { extractFromHtml as serverExtract } from '../server/extract.js';
import { extractFromHtml as domExtract } from '../public/shared/extract-dom.js';

const dir = new URL('./fixtures/', import.meta.url);
for (const name of readdirSync(dir).filter((f) => f.endsWith('.html'))) {
  test(`DOM adapter matches server on ${name}`, () => {
    const html = readFileSync(new URL(name, dir), 'utf8');
    const url = 'https://www.example.co.il/recipes/x';
    assert.deepEqual(domExtract(html, url, DOMParser), serverExtract(html, url));
  });
}
