// Outbound fetch that refuses private/internal addresses (the import feature fetches user-supplied URLs).
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function isPrivate(ip) {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

async function assertPublic(u) {
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('כתובת לא תקינה');
  if (process.env.RECIPIN_ALLOW_PRIVATE === '1') return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.some((a) => isPrivate(a.address))) throw new Error('לא ניתן לייבא מכתובת פנימית');
}

/** fetch with manual redirect handling so every hop is checked. */
export async function safeFetch(url, init = {}, maxRedirects = 5) {
  let current = new URL(url);
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublic(current);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current);
      continue;
    }
    Object.defineProperty(res, 'finalUrl', { value: current.href });
    return res;
  }
  throw new Error('יותר מדי הפניות');
}
