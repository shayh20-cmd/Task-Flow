// Instagram import without login. Instagram pages are a login wall for apps, so we try the
// public routes in order: (1) the post's "embed/captioned" page, (2) Open Graph tags served to
// link-preview crawlers. The caption is then turned into a recipe by parseRecipeText.
// Shared by the server and the Android app; they pass in how to fetch and how to parse HTML.
import { parseRecipeText, isStoryOnly } from './recipe-text.js';

// Instagram serves the full embed page (caption + the cover the owner picked) to plain clients,
// but an empty JavaScript shell to browser user agents. So Recipin identifies itself as itself.
const CLIENT_UA = 'Recipin/0.1 (recipe book app)';

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

/** The post as JSON inside the embed page ("contextJSON" → gql_data.shortcode_media), if present. */
function embeddedMedia(html) {
  const m = html.match(/"contextJSON"\s*:\s*("(?:[^"\\]|\\.)*")/);
  if (!m) return null;
  try {
    return JSON.parse(JSON.parse(m[1]))?.gql_data?.shortcode_media || null;
  } catch {
    return null;
  }
}

/** Read caption / image / author from the embed page. `doc` = { all(sel), html(node), text(node), attr(node, n) } */
export function readEmbed(html, doc) {
  let caption = '';
  let author = '';
  const media = embeddedMedia(html);
  const cap = doc.all('.Caption')[0];
  if (cap) {
    const user = doc.all('.CaptionUsername')[0];
    author = user ? doc.text(user).trim() : '';
    let inner = doc.html(cap) || '';
    inner = inner.replace(/<a[^>]*class="[^"]*CaptionUsername[^"]*"[^>]*>[\s\S]*?<\/a>/i, '');
    inner = inner.replace(/<div[^>]*class="[^"]*CaptionComments[^"]*"[\s\S]*$/i, '');
    caption = decode(inner).trim();
  }
  if (!caption && media) caption = media.edge_media_to_caption?.edges?.[0]?.node?.text || '';
  if (!author && media) author = media.owner?.username || '';
  if (!caption) {
    // Older embeds carry the post as JSON inside a script.
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
  // display_url is the full-size cover the owner picked (for reels: the selected thumbnail)
  let image = media?.display_url || '';
  const img = image ? null : doc.all('img.EmbeddedMediaImage')[0];
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
      const html = await fetchText(`https://www.instagram.com/p/${post.code}/embed/captioned/`, { 'User-Agent': CLIENT_UA });
      got = readEmbed(html, parse(html));
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (!got.caption || !got.image) {
    try {
      const html = await fetchText(canonical, { 'User-Agent': CLIENT_UA });
      const prev = readPreview(parse(html).meta);
      got = { caption: got.caption || prev.caption, author: got.author || prev.author, image: got.image || prev.image };
    } catch (e) {
      errors.push(e.message);
    }
  }

  const parsed = parseRecipeText(got.caption);
  const found = parsed.ingredients.length || parsed.steps.length;
  const fullText = got.caption.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, '$1').replace(/\n{3,}/g, '\n\n').trim();
  return {
    method: got.caption ? 'instagram' : 'link',
    source: 'instagram',
    caption: got.caption,
    // the post has text but no written recipe (e.g. the recipe is only in the video)
    storyOnly: !!got.caption && !found && isStoryOnly(got.caption),
    error: got.caption ? undefined : 'אינסטגרם לא מאפשר לקרוא את הפוסט הזה',
    recipe: {
      title: parsed.title || (got.author ? `מתכון של ${got.author}` : 'מתכון מאינסטגרם'),
      description: found ? parsed.description : fullText.slice(0, 5000),
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
