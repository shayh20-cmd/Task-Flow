// Instagram import without login. Instagram pages are a login wall for apps, so we try the
// public routes in order: (1) the post's "embed/captioned" page, (2) Open Graph tags served to
// link-preview crawlers. The caption is then turned into a recipe by parseRecipeText.
// Shared by the server and the Android app; they pass in how to fetch and how to parse HTML.
import { parseRecipeText } from './recipe-text.js';

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const PREVIEW_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

export function instagramPost(url) {
  const m = String(url).match(/instagram\.com\/(?:[\w.]+\/)?(p|reels?|tv)\/([\w-]{5,})/i);
  return m ? { kind: m[1].toLowerCase().startsWith('reel') ? 'reel' : m[1].toLowerCase(), code: m[2] } : null;
}

const decode = (s) =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

function biggestFromSrcset(srcset) {
  if (!srcset) return '';
  return (
    srcset
      .split(',')
      .map((p) => p.trim().split(/\s+/))
      .map(([u, w]) => ({ u, w: parseInt(w, 10) || 0 }))
      .sort((a, b) => b.w - a.w)[0]?.u || ''
  );
}

/** Read caption / image / author from the embed page. `doc` = { all(sel), html(node), text(node), attr(node, n) } */
export function readEmbed(html, doc) {
  let caption = '';
  let author = '';
  const cap = doc.all('.Caption')[0];
  if (cap) {
    const user = doc.all('.CaptionUsername')[0];
    author = user ? doc.text(user).trim() : '';
    let inner = doc.html(cap) || '';
    inner = inner.replace(/<a[^>]*class="[^"]*CaptionUsername[^"]*"[^>]*>[\s\S]*?<\/a>/i, '');
    inner = inner.replace(/<div[^>]*class="[^"]*CaptionComments[^"]*"[\s\S]*$/i, '');
    caption = decode(inner).trim();
  }
  if (!caption) {
    // Newer embeds carry the post as JSON inside a script.
    const m = html.match(/"edge_media_to_caption"\s*:\s*\{\s*"edges"\s*:\s*\[\s*\{\s*"node"\s*:\s*\{\s*"text"\s*:\s*("(?:[^"\\]|\\.)*")/);
    if (m) {
      try {
        caption = JSON.parse(m[1]);
      } catch {
        /* ignore */
      }
    }
  }
  if (!author) {
    const u = doc.all('.UsernameText')[0] || doc.all('.Username')[0];
    author = u ? doc.text(u).trim() : '';
  }
  let image = '';
  const img = doc.all('img.EmbeddedMediaImage')[0];
  if (img) image = biggestFromSrcset(doc.attr(img, 'srcset')) || doc.attr(img, 'src') || '';
  if (!image) {
    const m = html.match(/"display_url"\s*:\s*("(?:[^"\\]|\\.)*")/);
    if (m) {
      try {
        image = JSON.parse(m[1]);
      } catch {
        /* ignore */
      }
    }
  }
  return { caption, author, image: decode(image) };
}

/** Read caption / image from link-preview meta tags. `meta(name)` returns the content. */
export function readPreview(meta) {
  const desc = meta('og:description') || meta('description') || '';
  const title = meta('og:title') || '';
  let caption = '';
  let author = '';
  // '12K likes, 80 comments - noa.bakes on March 3, 2026: "Chocolate babka…"'
  const m = desc.match(/^[\d.,KMk]+\s+\S+,\s*[\d.,KMk]+\s+\S+\s*-\s*([\w.]+)[^:]*:\s*([\s\S]*)$/);
  if (m) {
    author = m[1];
    caption = m[2];
  } else {
    const t = title.match(/^(.+?)\s+(?:on|ב-?)\s*Instagram\s*:\s*([\s\S]*)$/i);
    if (t) {
      author = t[1];
      caption = t[2];
    } else caption = desc;
  }
  caption = decode(caption).trim().replace(/^["“”]|["“”]\.?$/g, '').trim();
  return { caption, author, image: decode(meta('og:image') || '') };
}

/**
 * @param {string} url
 * @param {{ fetchText: (url: string, headers: object) => Promise<string>, parse: (html: string) => object }} io
 *   parse(html) → { all(sel), html(node), text(node), attr(node, n), meta(name) }
 */
export async function importInstagram(url, { fetchText, parse }) {
  const post = instagramPost(url);
  const canonical = post ? `https://www.instagram.com/${post.kind === 'reel' ? 'reel' : 'p'}/${post.code}/` : url;
  let got = { caption: '', author: '', image: '' };
  const errors = [];

  if (post) {
    try {
      const html = await fetchText(`https://www.instagram.com/p/${post.code}/embed/captioned/`, { 'User-Agent': MOBILE_UA });
      got = readEmbed(html, parse(html));
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (!got.caption || !got.image) {
    try {
      const html = await fetchText(canonical, { 'User-Agent': PREVIEW_UA });
      const prev = readPreview(parse(html).meta);
      got = { caption: got.caption || prev.caption, author: got.author || prev.author, image: got.image || prev.image };
    } catch (e) {
      errors.push(e.message);
    }
  }

  const parsed = parseRecipeText(got.caption);
  const found = parsed.ingredients.length || parsed.steps.length;
  return {
    method: got.caption ? 'instagram' : 'link',
    source: 'instagram',
    caption: got.caption,
    error: got.caption ? undefined : 'אינסטגרם לא מאפשר לקרוא את הפוסט הזה',
    recipe: {
      title: parsed.title || (got.author ? `מתכון של ${got.author}` : 'מתכון מאינסטגרם'),
      description: found ? parsed.description : parsed.description || '',
      image: got.image,
      author: got.author ? '@' + got.author.replace(/^@/, '') : '',
      sourceUrl: canonical,
      sourceName: 'Instagram',
      ingredients: parsed.ingredients,
      steps: parsed.steps,
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: null,
      servings: parsed.servings,
      suggestedTags: parsed.suggestedTags,
    },
  };
}
