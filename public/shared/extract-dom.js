// Browser / Android-app recipe extraction: parse with DOMParser and run the shared core.
import { extractWith } from './extract-core.js';

export function extractFromHtml(html, url = '', DOMParserImpl = globalThis.DOMParser) {
  const doc = new DOMParserImpl().parseFromString(html, 'text/html');
  const mdRoot =
    [...doc.querySelectorAll('[itemscope][itemtype]')].find((el) => /schema\.org\/Recipe/i.test(el.getAttribute('itemtype') || '')) || null;
  const metaSel = (attr, n) => [...doc.querySelectorAll(`meta[${attr}]`)].find((m) => m.getAttribute(attr) === n);
  return extractWith(
    {
      ldTexts: [...doc.querySelectorAll('script')].filter((s) => (s.getAttribute('type') || '').toLowerCase() === 'application/ld+json').map((s) => s.textContent || ''),
      meta: (n) => (metaSel('property', n) || metaSel('name', n))?.getAttribute('content') || '',
      title: doc.querySelector('title')?.textContent || '',
      mdRoot,
      all: (node, sel) => [...node.querySelectorAll(sel)],
      attr: (node, name) => node.getAttribute(name) ?? undefined,
      text: (node) => node.textContent || '',
    },
    url,
  );
}
