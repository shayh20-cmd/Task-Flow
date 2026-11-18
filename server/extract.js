// Server-side recipe extraction: fetch the page, parse it with cheerio, run the shared core.
import * as cheerio from 'cheerio';
import { safeFetch } from './net.js';
import { extractWith, isoDurationToMinutes } from '../public/shared/extract-core.js';

export { isoDurationToMinutes };

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export async function fetchPage(url, { timeoutMs = 15000 } = {}) {
  const res = await safeFetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'he,en;q=0.8' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`האתר החזיר שגיאה ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (type && !/html|xml/i.test(type)) throw new Error('הקישור אינו דף אינטרנט');
  return { html: await res.text(), finalUrl: res.finalUrl || url };
}

export async function extractFromUrl(url) {
  const { html, finalUrl } = await fetchPage(url);
  return extractFromHtml(html, finalUrl);
}

export function extractFromHtml(html, url = '') {
  const $ = cheerio.load(html);
  const root = $('[itemscope][itemtype*="schema.org/Recipe" i]').first();
  return extractWith(
    {
      ldTexts: $('script[type="application/ld+json"]').map((_, el) => $(el).contents().text()).get(),
      meta: (n) => $(`meta[property="${n}"]`).attr('content') || $(`meta[name="${n}"]`).attr('content') || '',
      title: $('title').first().text(),
      mdRoot: root.length ? root[0] : null,
      all: (node, sel) => $(node).find(sel).toArray(),
      attr: (node, name) => $(node).attr(name),
      text: (node) => $(node).text(),
    },
    url,
  );
}

/** Small query adapter over cheerio, used by the Instagram importer. */
export function parseDoc(html) {
  const $ = cheerio.load(html);
  return {
    all: (sel) => $(sel).toArray(),
    html: (node) => $(node).html() || '',
    text: (node) => $(node).text(),
    attr: (node, n) => $(node).attr(n),
    meta: (n) => $(`meta[property="${n}"]`).attr('content') || $(`meta[name="${n}"]`).attr('content') || '',
  };
}
