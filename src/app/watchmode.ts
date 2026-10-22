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

const refreshing = new Map<Kind, Promise<WmRow[]>>();

/**
 * The home rows for Movies or Shows (cached 3 days): Popular, New, one per streaming service, one per genre.
 * onRow is called as rows arrive so the page fills in.
 */
export async function watchmodeRows(kind: Kind, onRow?: (rows: WmRow[]) => void): Promise<WmRow[]> {
  const key = watchmodeKey();
  if (!key) return [];
  const cacheKey = `watchmode:rows:${kind}`;
  const hit = await repo.getKv<{ at: number; key: string; rows: WmRow[] }>(cacheKey).catch(() => undefined);
  if (hit && hit.key === key.slice(-6) && hit.rows.length) {
    // Saved lists show right away; old ones (3 days) are refreshed quietly for next time.
    if (Date.now() - hit.at > LIST_TTL && !refreshing.has(kind)) {
      const job = fetchRows(kind, key, cacheKey).finally(() => refreshing.delete(kind));
      refreshing.set(kind, job);
      job.catch(() => undefined);
    }
    return hit.rows;
  }
  const running = refreshing.get(kind);
  if (running) return running;
  const job = fetchRows(kind, key, cacheKey, onRow).finally(() => refreshing.delete(kind));
  refreshing.set(kind, job);
  return job;
}

async function fetchRows(kind: Kind, key: string, cacheKey: string, onRow?: (rows: WmRow[]) => void): Promise<WmRow[]> {

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
  // Three lists at a time (well under Watchmode's 120 requests / minute); rows keep the plan's order.
  const got: (WmRow | null)[] = plan.map(() => null);
  let next = 0;
  let firstError: Error | null = null;
  const emit = () => onRow?.(got.filter((x): x is WmRow => !!x));
  const lane = async () => {
    while (next < plan.length) {
      const i = next++;
      const p = plan[i];
      try {
        got[i] = { id: p.id, title: p.title, titles: await listTitles(kind, p.extra) };
        emit();
      } catch (e) {
        firstError ??= e as Error;
        if (i < 2 && !got.some(Boolean)) next = plan.length; // bad key / out of credits: stop early
      }
    }
  };
  await Promise.all([lane(), lane(), lane()]);
  const rows = got.filter((x): x is WmRow => !!x);
  if (!rows.length && firstError) throw firstError;
  if (rows.length) await repo.setKv(cacheKey, { at: Date.now(), key: key.slice(-6), rows }).catch(() => undefined);
  return rows;
}

/** Forget cached lists (a new key, or "Refresh now"). */
export async function clearWatchmodeCache() {
  for (const k of ['watchmode:rows:movies', 'watchmode:rows:shows']) await repo.setKv(k, null).catch(() => undefined);
}
