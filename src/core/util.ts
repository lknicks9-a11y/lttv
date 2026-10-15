/** cyrb53: fast, well-distributed 53-bit string hash. Used for stable ids. */
export function hash53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function uid(prefix = ''): string {
  const rnd = Math.random().toString(36).slice(2, 10);
  return prefix + Date.now().toString(36) + rnd;
}

/**
 * Redact a URL for display/logging: keep scheme + host, hide credentials,
 * path segments that look like secrets, and the whole query string.
 */
export function redactUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    // Only the final segment is shown, and only if it looks like a plain file name.
    const showLast = /^[\w.-]{1,40}\.[a-z0-9]{2,5}$/i.test(last) && !/\d{5,}/.test(last);
    const path = parts.length === 0 ? '' : parts.length === 1 && showLast ? '/' + last : showLast ? '/…/' + last : '/…';
    return `${u.protocol}//${u.host}${path}${u.search ? '?…' : ''}`;
  } catch {
    return url.length > 24 ? url.slice(0, 12) + '…' : '…';
  }
}

/** Decode %XX sequences when the string actually looks URL-encoded; never throws. */
export function maybeDecodeURIComponent(s: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(s)) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Yield to the event loop so long loops don't freeze the UI / worker message handling. */
export function yieldToLoop(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export function lowerBound<T>(arr: T[], pred: (x: T) => boolean): number {
  // first index where pred(x) is true, assuming arr is partitioned false...true
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (pred(arr[mid])) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
