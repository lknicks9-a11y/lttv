// Home rows for Movies / Shows without a Watchmode key, from free US lists (see core/freelists.ts):
// the same shape as Watchmode's rows — Top, New, Popular on each service, genres — so the page only shows
// titles that are popular in the US. Cached on the device for 12 hours.
import { openRemote } from './platform';
import { repo } from './state';
import { BROADCAST, mergeShows, parseItunesChartTitles, parseScheduleShows, SHOW_GENRES, SHOW_SERVICES, type ChartTitle, type ScheduleShow } from '../core/freelists';
import type { WmRow } from './watchmode';

const TTL = 12 * 3600_000;
const base = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) || d;
  } catch {
    return d;
  }
};
async function json(url: string): Promise<unknown> {
  const { stream } = await openRemote(url, AbortSignal.timeout?.(15_000));
  return JSON.parse(await new Response(stream).text());
}

/** Apple's US movie genre charts. */
const MOVIE_GENRES: { label: string; genre: number }[] = [
  { label: 'Action & Adventure', genre: 4401 },
  { label: 'Comedies', genre: 4404 },
  { label: 'Dramas', genre: 4406 },
  { label: 'Thrillers', genre: 4416 },
  { label: 'Horror', genre: 4408 },
  { label: 'Sci-Fi & Fantasy', genre: 4413 },
  { label: 'Kids & Family', genre: 4410 },
  { label: 'Holiday', genre: 4420 },
  { label: 'Romance', genre: 4412 },
  { label: 'Independent', genre: 4409 },
  { label: 'Sports', genre: 4417 },
  { label: 'Documentaries', genre: 4405 },
  { label: 'Classics', genre: 4403 },
];

async function chart(path: string, tv = false): Promise<ChartTitle[]> {
  try {
    return parseItunesChartTitles(await json(`${base('lttvItunesBase', 'https://itunes.apple.com')}/us/rss/${path}/json`), tv);
  } catch {
    return [];
  }
}

const running = new Map<string, Promise<WmRow[]>>();

export async function freeRows(kind: 'movies' | 'shows', onRow?: (rows: WmRow[]) => void): Promise<WmRow[]> {
  const ck = `free:rows:${kind}`;
  const hit = await repo.getKv<{ at: number; rows: WmRow[] }>(ck).catch(() => undefined);
  if (hit?.rows.length && Date.now() - hit.at < TTL) return hit.rows;
  let job = running.get(kind);
  if (!job) {
    job = (kind === 'movies' ? movieRows(onRow) : showRows(onRow)).finally(() => running.delete(kind));
    running.set(kind, job);
  }
  const rows = await job;
  if (rows.length) await repo.setKv(ck, { at: Date.now(), rows }).catch(() => undefined);
  else if (hit?.rows.length) return hit.rows; // offline: the last lists
  return rows;
}

async function movieRows(onRow?: (rows: WmRow[]) => void): Promise<WmRow[]> {
  const top = await chart('topmovies/limit=100');
  const rows: WmRow[] = [];
  if (top.length) rows.push({ id: 'popular', title: 'Top Movies', titles: top });
  onRow?.(rows);
  const genres: { label: string; titles: ChartTitle[] }[] = [];
  let next = 0;
  const lane = async () => {
    while (next < MOVIE_GENRES.length) {
      const g = MOVIE_GENRES[next++];
      genres.push({ label: g.label, titles: await chart(`topmovies/limit=100/genre=${g.genre}`) });
    }
  };
  await Promise.all([lane(), lane(), lane()]);
  // New releases: this year's and last year's from all the charts, most popular first.
  const now = new Date().getFullYear();
  const seen = new Set<string>();
  const fresh = [top, ...MOVIE_GENRES.map((g) => genres.find((x) => x.label === g.label)?.titles ?? [])].flat().filter((t) => t.year && t.year >= now - 1 && !seen.has(t.title) && seen.add(t.title));
  if (fresh.length) rows.push({ id: 'new', title: 'New Releases', titles: fresh });
  for (const g of MOVIE_GENRES) {
    const t = genres.find((x) => x.label === g.label)?.titles ?? [];
    if (t.length) rows.push({ id: `genre:${g.label}`, title: g.label, titles: t });
  }
  return rows;
}

async function showRows(onRow?: (rows: WmRow[]) => void): Promise<WmRow[]> {
  const tvm = base('lttvTvmazeBase', 'https://api.tvmaze.com');
  const top = await chart('toptvseasons/limit=100', true);
  const rows: WmRow[] = [];
  if (top.length) rows.push({ id: 'popular', title: 'Top Shows', titles: top });
  onRow?.(rows);
  // Two weeks of the US TV and streaming schedule.
  const jobs: string[] = [];
  for (let d = 0; d < 14; d++) {
    const day = new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10);
    jobs.push(`${tvm}/schedule/web?date=${day}&country=US`, `${tvm}/schedule?country=US&date=${day}`);
  }
  const lists: ScheduleShow[][] = [];
  let next = 0;
  const lane = async () => {
    while (next < jobs.length) {
      const u = jobs[next++];
      try {
        lists.push(parseScheduleShows(await json(u)));
      } catch {
        /* skip that day */
      }
    }
  };
  await Promise.all([lane(), lane(), lane(), lane()]);
  const shows = mergeShows(lists).sort((a, b) => b.weight - a.weight);
  const titles = (l: ScheduleShow[]) => l.map((s) => ({ title: s.name }));
  if (!top.length && shows.length) rows.push({ id: 'popular', title: 'Top Shows', titles: titles(shows) });
  const week = new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10);
  const fresh = shows.filter((s) => s.aired >= week);
  if (fresh.length) rows.push({ id: 'new-episodes', title: 'New Episodes', titles: titles(fresh) });
  for (const s of SHOW_SERVICES) {
    const l = shows.filter((x) => s.re.test(x.channel));
    if (l.length) rows.push({ id: `svc:${s.label}`, title: `Popular on ${s.label}`, titles: titles(l) });
  }
  const bc = shows.filter((x) => BROADCAST.test(x.channel));
  if (bc.length) rows.push({ id: 'svc:broadcast', title: 'Popular on ABC, CBS, NBC & FOX', titles: titles(bc) });
  for (const g of SHOW_GENRES) {
    const l = shows.filter(g.test);
    if (l.length) rows.push({ id: `genre:${g.label}`, title: g.label, titles: titles(l) });
  }
  return rows;
}
