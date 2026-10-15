// High-quality channel logos from the free "tv-logo/tv-logos" collection (transparent
// PNGs made for dark backgrounds, github.com/tv-logo/tv-logos). LTTV bundles only the
// list of file names and loads the matching image from GitHub when it's shown.
// A logo is used only when its name matches the channel exactly (after removing
// quality tags, country prefixes etc.) within the channel's country, so it's the
// right brand; otherwise the playlist's own logo stays.
import type { LineupChannel } from './types';
import { channelKey, channelKeys, networkForBroadcast } from './networks';
import { myTvEntryFor } from './mytv';

interface LogoIndex {
  sha: string;
  folders: Record<string, string[]>;
}

/** Our country keys -> folders in the collection (first match wins). */
const COUNTRY_FOLDERS: Record<string, string[]> = {
  us: ['united-states'], uk: ['united-kingdom'], ca: ['canada'], au: ['australia'], ie: ['ireland', 'united-kingdom'], nz: ['new-zealand'],
  fr: ['france'], de: ['germany'], es: ['spain'], it: ['italy'], pt: ['portugal'], br: ['brazil'], mx: ['mexico', 'world-latin-america'],
  latam: ['world-latin-america', 'mexico', 'argentina', 'chile', 'costa-rica'], ar_country: ['argentina', 'world-latin-america'], cl: ['chile'], cr: ['costa-rica'],
  in: ['india'], pk: ['world-asia', 'india'], nl: ['netherlands'], be: ['belgium'], ch: ['switzerland'], at: ['austria'], pl: ['poland'], tr: ['turkey'],
  gr: ['greece'], se: ['nordic'], no: ['nordic'], dk: ['nordic'], fi: ['nordic'], is: ['nordic'], za: ['south-africa', 'world-africa'], africa: ['world-africa', 'south-africa'],
  al: ['albania'], ro: ['romania'], ru: ['russia'], ua: ['ukraine'], rs: ['serbia'], hr: ['croatia'], si: ['slovenia'], ba: ['serbia', 'croatia'], mk: ['serbia'],
  exyu: ['serbia', 'croatia', 'slovenia'], bg: ['bulgaria'], cz: ['czech-republic'], sk: ['slovakia'], hu: ['hungary'], il: ['israel'], lb: ['lebanon', 'world-middle-east'],
  ar: ['world-middle-east', 'united-arab-emirates', 'lebanon'], ae: ['united-arab-emirates', 'world-middle-east'], sa: ['world-middle-east'], my: ['malaysia'],
  ph: ['philippines'], sg: ['singapore'], id: ['indonesia'], hk: ['hong-kong'], carib: ['caribbean'], lt: ['lithuania'], lu: ['luxembourg'], mt: ['malta'], az: ['azerbaijan'],
};
/** When the playlist gives no country: the usual suspects. */
const DEFAULT_FOLDERS = ['united-states', 'united-kingdom', 'canada'];

/** Design variants of the same logo; plain first, then the ones that read best on dark. */
const VARIANTS: Record<string, number> = { logo: 0, light: 1, white: 2, hz: 3, flat: 4, alt: 5, square: 6, color: 7, colour: 7, framed: 8 };
const SKIP = /(^|-)(icon|logo-\d{4}|\d{4}-logo|mosaic|old|retro|3d)(-|$)/;

/** New York locals: the network's logo. */
const LOCAL_NETWORK: Record<number, string[]> = {
  2: ['cbs'], 4: ['nbc'], 5: ['fox'], 7: ['abc'], 9: ['mynetworktv', 'my9'], 11: ['pix11', 'cw'], 13: ['thirteen', 'pbs'], 21: ['pbs'], 25: ['nyclife'],
  31: ['iontelevision', 'ion'], 33: ['metv'], 41: ['univision'], 47: ['telemundo'], 50: ['njpbs', 'pbs'], 68: ['unimas'],
};

let index: LogoIndex | null = null;
let loading: Promise<void> | null = null;
const byFolder = new Map<string, Map<string, string>>();
const listeners = new Set<() => void>();
const cache = new Map<string, string | null>();
let enabled = true;

export function setHqLogos(on: boolean) {
  if (on === enabled) return;
  enabled = on;
  cache.clear();
  for (const l of listeners) l();
}

export function logosReady(): boolean {
  return !!index;
}

export function onLogosReady(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Load the name index (a separate ~45 KB chunk) once. */
export function loadLogoIndex(): Promise<void> {
  loading ??= import('../data/tv-logos.json')
    .then((m) => {
      index = ((m as { default?: LogoIndex }).default ?? (m as unknown as LogoIndex));
      cache.clear();
      for (const l of listeners) l();
    })
    .catch(() => undefined);
  return loading;
}

/** For tests: use a given index. */
export function setLogoIndex(i: LogoIndex) {
  index = i;
  byFolder.clear();
  cache.clear();
}

/** "espn-2-us" -> key "espn2" and how preferred this design variant is. */
export function slugKey(slug: string): { key: string; rank: number } | null {
  if (SKIP.test(slug) || /(^|\/)(old|retro|archive)(\/|$)/.test(slug)) return null;
  const depth = slug.split('/').length - 1;
  const toks = slug.replace(/^.*\//, '').split('-');
  if (toks.length > 1 && /^[a-z]{2,4}$/.test(toks[toks.length - 1])) toks.pop(); // country suffix
  let rank = 0;
  const kept = toks.filter((t) => {
    const r = VARIANTS[t];
    if (r !== undefined) {
      rank = Math.max(rank, r);
      return false;
    }
    return true;
  });
  // "a-and-e" style names keep their words; channelKey normalises like channel names.
  const words = kept.map((t) => (t === 'nbcsn' ? 'nbc sports' : t)).join(' ').replace(/^.*\//, '');
  const key = channelKey(words.replace(/\band\b/g, '&').replace(/\bplus\b/g, '+'));
  return key ? { key, rank: rank + depth * 10 } : null;
}

function folderMap(folder: string): Map<string, string> {
  let m = byFolder.get(folder);
  if (m) return m;
  m = new Map();
  const ranks = new Map<string, number>();
  for (const slug of index?.folders[folder] ?? []) {
    const k = slugKey(slug);
    if (!k) continue;
    const prev = ranks.get(k.key);
    if (prev === undefined || k.rank < prev || (k.rank === prev && slug.length < m.get(k.key)!.length)) {
      m.set(k.key, slug);
      ranks.set(k.key, k.rank);
    }
  }
  byFolder.set(folder, m);
  return m;
}

export function logoBase(): string {
  try {
    const o = localStorage.getItem('lttvLogoBase');
    if (o) return o;
  } catch {
    /* ignore */
  }
  return `https://raw.githubusercontent.com/tv-logo/tv-logos/${index?.sha ?? 'main'}/countries/`;
}

/** Names to look up for a channel, most specific first. */
export function logoKeys(ch: Pick<LineupChannel, 'originalName' | 'cleanedName' | 'group' | 'myTv' | 'country'>): string[] {
  const keys: string[] = [];
  const add = (k: string | undefined) => {
    if (k && k.length >= 2 && !keys.includes(k)) keys.push(k);
  };
  for (const k of channelKeys(ch.cleanedName || ch.originalName)) add(k);
  for (const k of channelKeys(ch.originalName)) add(k);
  const e = myTvEntryFor(ch);
  if (e?.local) for (const k of LOCAL_NETWORK[e.n] ?? []) add(k);
  else if (e) for (const n of [e.name, ...(e.aliases ?? [])]) add(channelKey(n));
  const net = networkForBroadcast(ch.cleanedName || ch.originalName).network;
  if (net && !e?.local) for (const k of net.keys) add(k);
  // "YES" <-> "YES Network", "Discovery" <-> "Discovery Channel" (already stripped by channelKey)
  for (const k of [...keys]) {
    if (k.endsWith('network') && k.length > 9) add(k.slice(0, -7));
    else add(k + 'network');
  }
  return keys;
}

/** Best high-quality logo URL for a channel, or undefined (keep the playlist logo). */
export function bestLogo(ch: Pick<LineupChannel, 'key' | 'originalName' | 'cleanedName' | 'group' | 'myTv' | 'country'>): string | undefined {
  if (!enabled || !index) return undefined;
  const hit = cache.get(ch.key);
  if (hit !== undefined) return hit ?? undefined;
  let url: string | undefined;
  const folders = [...(ch.country ? COUNTRY_FOLDERS[ch.country] ?? [] : DEFAULT_FOLDERS), 'international'];
  const keys = logoKeys(ch);
  outer: for (const f of folders) {
    const m = folderMap(f);
    for (const k of keys) {
      const slug = m.get(k);
      if (slug) {
        url = `${logoBase()}${f}/${slug}.png`;
        break outer;
      }
    }
  }
  if (cache.size > 60_000) cache.clear();
  cache.set(ch.key, url ?? null);
  return url;
}
