// Movies & Shows home rows from Watchmode (US, English): popular, new, each streaming service, each genre.
// Watchmode gives title lists; LTTV shows the ones your provider has. The API key is the user's own
// (Settings → Movies & Shows) and is never part of the app's code. Lists are cached on the device for
// 3 days (a refresh costs ~20 credits per section), genres / services for 30 days.
import { openRemote } from './platform';
import { getState, repo } from './state';

const BASE = () => {
  try {
    return localStorage.getItem('lttvWatchmodeBase') || 'https://api.watchmode.com/v1';
  } catch {
    return 'https://api.watchmode.com/v1';
  }
};
const LIST_TTL = 3 * 86400_000;
const META_TTL = 30 * 86400_000;

export function watchmodeKey(): string {
  return (getState().settings.watchmodeKey ?? '').trim();
}

async function call(path: string, key = watchmodeKey()): Promise<unknown> {
  if (!key) throw new Error('No Watchmode API key');
  const { stream } = await openRemote(`${BASE()}${path}`, AbortSignal.timeout?.(20_000), { 'X-API-Key': key, Accept: 'application/json' });
  const j = JSON.parse(await new Response(stream).text()) as { success?: boolean; statusMessage?: string };
  if (j && j.success === false) throw new Error(j.statusMessage || 'Watchmode refused the request');
  return j;
}

/** Check a key (Settings "Test"): lists the US streaming services (1 credit). */
export async function testWatchmodeKey(key: string): Promise<number> {
  const list = (await call('/sources/?regions=US&types=sub', key.trim())) as unknown[];
  if (!Array.isArray(list)) throw new Error('Unexpected answer from Watchmode');
  return list.length;
}

interface Named {
  id: number;
  name: string;
}

async function cached<T>(k: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = await repo.getKv<{ at: number; v: T }>(k).catch(() => undefined);
  if (hit && Date.now() - hit.at < ttl) return hit.v;
  try {
    const v = await load();
    await repo.setKv(k, { at: Date.now(), v }).catch(() => undefined);
    return v;
  } catch (e) {
    if (hit) return hit.v; // stale is better than nothing
    throw e;
  }
}

const SERVICES: { label: string; re: RegExp }[] = [
  { label: 'Netflix', re: /^netflix$/i },
  { label: 'Hulu', re: /^hulu$/i },
  { label: 'Max', re: /^(max|hbo max)$/i },
  { label: 'Disney+', re: /^disney\s*\+$/i },
  { label: 'Prime Video', re: /^(amazon )?prime video$/i },
  { label: 'Apple TV+', re: /^apple tv\s*\+$/i },
  { label: 'Paramount+', re: /^paramount\s*\+$/i },
  { label: 'Peacock', re: /^peacock( premium)?$/i },
];

const GENRES: { label: string; re: RegExp }[] = [
  { label: 'Action & Adventure', re: /^(action|adventure|action & adventure)$/i },
  { label: 'Comedies', re: /^comedy$/i },
  { label: 'Dramas', re: /^drama$/i },
  { label: 'Thrillers & Mysteries', re: /^(thriller|mystery)$/i },
  { label: 'Crime', re: /^crime$/i },
  { label: 'Horror', re: /^horror$/i },
  { label: 'Sci-Fi & Fantasy', re: /^(science fiction|sci-fi & fantasy|fantasy)$/i },
  { label: 'Kids & Family', re: /^(family|kids)$/i },
  { label: 'Animation', re: /^animation$/i },
  { label: 'Romance', re: /^romance$/i },
  { label: 'Documentaries', re: /^documentary$/i },
  { label: 'Reality', re: /^reality$/i },
];

export interface WmTitle {
  title: string;
  year?: number;
}
export interface WmRow {
  id: string;
  title: string;
  titles: WmTitle[];
}

type Kind = 'movies' | 'shows';

async function listTitles(kind: Kind, extra: string): Promise<WmTitle[]> {
  const types = kind === 'movies' ? 'movie' : 'tv_series,tv_miniseries';
  const j = (await call(`/list-titles/?types=${types}&regions=US&languages=en&sort_by=popularity_desc&limit=250${extra}`)) as { titles?: { title?: string; year?: number }[] };
  return (j.titles ?? []).filter((t) => t.title).map((t) => ({ title: t.title!, year: t.year || undefined }));
}

const pause = () => new Promise((r) => setTimeout(r, 700)); // well under 120 requests / minute

/**
 * The home rows for Movies or Shows (cached 3 days): Popular, New, one per streaming service, one per genre.
 * onRow is called as rows arrive so the page fills in.
 */
export async function watchmodeRows(kind: Kind, onRow?: (rows: WmRow[]) => void): Promise<WmRow[]> {
  const key = watchmodeKey();
  if (!key) return [];
  const cacheKey = `watchmode:rows:${kind}`;
  const hit = await repo.getKv<{ at: number; key: string; rows: WmRow[] }>(cacheKey).catch(() => undefined);
  if (hit && hit.key === key.slice(-6) && Date.now() - hit.at < LIST_TTL && hit.rows.length) return hit.rows;

  const genres = await cached<Named[]>('watchmode:genres', META_TTL, async () => (await call('/genres/')) as Named[]);
  const sources = await cached<Named[]>('watchmode:sources', META_TTL, async () => (await call('/sources/?regions=US&types=sub')) as Named[]);
  const since = new Date(Date.now() - 180 * 86400_000);
  const ymd = `${since.getFullYear()}${String(since.getMonth() + 1).padStart(2, '0')}${String(since.getDate()).padStart(2, '0')}`;
  const plan: { id: string; title: string; extra: string }[] = [
    { id: 'popular', title: kind === 'movies' ? 'Popular Movies' : 'Popular Shows', extra: '' },
    { id: 'new', title: kind === 'movies' ? 'New Releases' : 'New Shows', extra: `&release_date_start=${ymd}` },
  ];
  for (const s of SERVICES) {
    const ids = sources.filter((x) => s.re.test(x.name)).map((x) => x.id);
    if (ids.length) plan.push({ id: `svc:${s.label}`, title: `Popular on ${s.label}`, extra: `&source_ids=${ids.join(',')}` });
  }
  for (const g of GENRES) {
    const ids = genres.filter((x) => g.re.test(x.name)).map((x) => x.id);
    if (ids.length && !(kind === 'movies' && g.label === 'Reality')) plan.push({ id: `genre:${g.label}`, title: g.label, extra: `&genres=${ids.join(',')}` });
  }
  const rows: WmRow[] = [];
  for (const p of plan) {
    try {
      rows.push({ id: p.id, title: p.title, titles: await listTitles(kind, p.extra) });
      onRow?.(rows.slice());
    } catch (e) {
      if (!rows.length) throw e; // bad key / no credits: stop early
    }
    await pause();
  }
  if (rows.length) await repo.setKv(cacheKey, { at: Date.now(), key: key.slice(-6), rows }).catch(() => undefined);
  return rows;
}

/** Forget cached lists (a new key, or "Refresh now"). */
export async function clearWatchmodeCache() {
  for (const k of ['watchmode:rows:movies', 'watchmode:rows:shows']) await repo.setKv(k, null).catch(() => undefined);
}
