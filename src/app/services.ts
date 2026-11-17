// The LTTV service apps (Fire TV): one app per streaming service, each showing the movies and shows
// from your own playlists that are on that service. Which service a title is on comes from:
//  - Watchmode (Settings → Movies & Shows key): every title on the service in the US, movies and shows,
//    most popular first;
//  - TVmaze (free, no key): the streaming service or network each show is from, looked up once per show
//    in the background (paced, saved on the device), so the apps fill in as shows are checked.
// The apps have LTTV's own names and colors; the service name is only used to look titles up.
import { cleanTitle, isEnglishCategory, normTitle, titleYear } from '../core/vod';
import { openRemote } from './platform';
import { repo } from './state';
import { dedupe, itemName, loadAllMovies, loadAllSeries, type VodHome, type VodItem, type VodRow } from './vod';
import { paced } from './vodmeta';
import { serviceTitles, watchmodeKey, type WmTitle } from './watchmode';

export interface ServiceApp {
  /** Id used by the Fire TV app tile ("svc:fresh"). */
  id: string;
  /** The app's name on the TV. */
  name: string;
  /** The service whose titles it shows (looked up by name, never shown as branding). */
  service: string;
  color: string;
  /** Watchmode source names. */
  wm: RegExp;
  /** TVmaze web channel / network names. */
  tvmaze: RegExp;
}

export const SERVICE_APPS: ServiceApp[] = [
  { id: 'fresh', name: 'LTTV Fresh', service: 'Hulu', color: '#FFB020', wm: /^hulu$/i, tvmaze: /^(hulu|fx on hulu)$/i },
  { id: 'binge', name: 'LTTV Binge', service: 'Netflix', color: '#FF4FA0', wm: /^netflix$/i, tvmaze: /^netflix$/i },
  { id: 'prestige', name: 'LTTV Prestige', service: 'Max', color: '#CBD5E1', wm: /^(max|hbo max)$/i, tvmaze: /^(max|hbo max|hbo)$/i },
  { id: 'peak', name: 'LTTV Peak', service: 'Paramount+', color: '#D946EF', wm: /^paramount\s*\+/i, tvmaze: /^paramount\s*\+/i },
  { id: 'family', name: 'LTTV Family', service: 'Disney+', color: '#FDE68A', wm: /^disney\s*\+$/i, tvmaze: /^disney\s*\+$/i },
];

export const serviceApp = (id?: string) => SERVICE_APPS.find((s) => s.id === id);

const FOREIGN = /\b(vostfr|vost|vf|vff|truefrench|french|latino|castellano|español|espanol|dublado|legendado|deutsch|german|ita|italiano|türkçe|turkce|arabic|hindi|dubbed)\b/i;
const english = (name: string) => isEnglishCategory(name) && !FOREIGN.test(name);
const keyOf = (name: string) => normTitle(cleanTitle(name));

// ---- TVmaze: where each show is from -------------------------------------------------------------

const TVMAZE = () => {
  try {
    return localStorage.getItem('lttvTvmazeBase') || 'https://api.tvmaze.com';
  } catch {
    return 'https://api.tvmaze.com';
  }
};
const HOMES_KV = 'tvmaze:homes1';
/** Show key -> "Web channel|Network" ('' = not found). */
type Homes = Record<string, string>;
let homes: Homes | null = null;
let job: Promise<void> | null = null;
const listeners = new Set<() => void>();
export const sorting = { done: 0, total: 0, running: false };

async function loadHomes(): Promise<Homes> {
  if (!homes) homes = (await repo.getKv<Homes>(HOMES_KV).catch(() => undefined)) ?? {};
  return homes;
}

function saveHomes() {
  if (homes) void repo.setKv(HOMES_KV, homes).catch(() => undefined);
}

/** Look up every show not checked yet, one at a time (shared with poster lookups' pacing). */
function sortShows(shows: { k: string; name: string; year?: number }[]) {
  if (job) return;
  job = (async () => {
    const h = await loadHomes();
    const todo = shows.filter((x) => !(x.k in h));
    sorting.total = shows.length;
    sorting.done = shows.length - todo.length;
    sorting.running = todo.length > 0;
    let fails = 0;
    let lastSave = Date.now();
    for (const x of todo) {
      try {
        const j = (await paced('tvmaze', async () => {
          const { stream } = await openRemote(`${TVMAZE()}/singlesearch/shows?q=${encodeURIComponent(x.name)}`, AbortSignal.timeout?.(15_000));
          return JSON.parse(await new Response(stream).text());
        }, false)) as { premiered?: string; webChannel?: { name?: string } | null; network?: { name?: string } | null } | null;
        const prem = Number(String(j?.premiered ?? '').slice(0, 4)) || 0;
        const ok = !!j && (!x.year || !prem || Math.abs(prem - x.year) <= 1);
        h[x.k] = ok ? [j?.webChannel?.name, j?.network?.name].filter(Boolean).join('|') : '';
        fails = 0;
      } catch (e) {
        if (/404|not found/i.test(String((e as Error).message))) h[x.k] = '';
        else if (++fails >= 6) break; // offline: try again next time
        else await new Promise((r) => setTimeout(r, 3000));
      }
      sorting.done++;
      if (sorting.done % 20 === 0) listeners.forEach((l) => l());
      if (Date.now() - lastSave > 20_000) {
        saveHomes();
        lastSave = Date.now();
      }
    }
    saveHomes();
    sorting.running = false;
    listeners.forEach((l) => l());
  })().finally(() => {
    job = null;
  });
}

// ---- The app's page ---------------------------------------------------------------------------------

/** The page of a service app: Shows and Movies from your playlists that are on that service. */
export async function loadServiceHome(id: string, onUpdate: (h: VodHome) => void): Promise<VodHome> {
  const app = serviceApp(id);
  if (!app) throw new Error('Unknown app');
  const [movies, shows] = await Promise.all([loadAllMovies(), loadAllSeries()]);
  const mItems: VodItem[] = movies.filter((m) => english(m.name)).map((m) => ({ kind: 'movie', playlistId: m.playlistId, m }));
  const sItems: VodItem[] = shows.filter((s) => english(s.name)).map((s) => ({ kind: 'series', playlistId: s.playlistId, s }));
  const index = (list: VodItem[]) => {
    const by = new Map<string, VodItem[]>();
    for (const it of list) {
      const k = keyOf(itemName(it));
      if (!k) continue;
      const l = by.get(k);
      if (l) l.push(it);
      else by.set(k, [it]);
    }
    return by;
  };
  const mBy = index(mItems);
  const sBy = index(sItems);
  const yearOf = (it: VodItem) => Number(it.kind === 'movie' ? it.m.year : it.s.year) || Number(titleYear(itemName(it))) || 0;
  const pick = (by: Map<string, VodItem[]>, t: WmTitle) => {
    const cands = by.get(keyOf(t.title));
    if (!cands) return undefined;
    return dedupe(cands.filter((c) => !t.year || !yearOf(c) || Math.abs(yearOf(c) - t.year) <= 1))[0];
  };

  // Watchmode: everything on the service (needs the user's key).
  let wmShows: WmTitle[] = [];
  let wmMovies: WmTitle[] = [];
  if (watchmodeKey()) {
    [wmShows, wmMovies] = await Promise.all([
      serviceTitles('shows', app.wm).catch(() => [] as WmTitle[]),
      serviceTitles('movies', app.wm).catch(() => [] as WmTitle[]),
    ]);
  }

  const h = await loadHomes();
  const build = (): VodHome => {
    const fromWm = (by: Map<string, VodItem[]>, list: WmTitle[]) => list.map((t) => pick(by, t)).filter((x): x is VodItem => !!x);
    const fromTvmaze = dedupe(sItems.filter((it) => (h[keyOf(itemName(it))] ?? '').split('|').some((n) => n && app.tvmaze.test(n))))
      .sort((a, b) => yearOf(b) - yearOf(a) || itemName(a).localeCompare(itemName(b)));
    const showList = dedupe([...fromWm(sBy, wmShows), ...fromTvmaze]);
    const movieList = dedupe(fromWm(mBy, wmMovies));
    const rows: VodRow[] = [];
    const note = sorting.running ? `checking your shows: ${sorting.done.toLocaleString()} of ${sorting.total.toLocaleString()}` : undefined;
    if (showList.length) {
      rows.push({ id: 'svc-top-shows', title: 'Popular Shows', items: showList.slice(0, 30), note });
      if (showList.length > 30) rows.push({ id: 'svc-new-shows', title: 'Newest Shows', items: [...showList].sort((a, b) => yearOf(b) - yearOf(a)).slice(0, 60) });
      rows.push({ id: 'svc-all-shows', title: `All Shows (${showList.length})`, items: [...showList].sort((a, b) => cleanTitle(itemName(a)).localeCompare(cleanTitle(itemName(b)))) });
    }
    if (movieList.length) {
      rows.push({ id: 'svc-top-movies', title: 'Popular Movies', items: movieList.slice(0, 30) });
      if (movieList.length > 30) rows.push({ id: 'svc-new-movies', title: 'Newest Movies', items: [...movieList].sort((a, b) => yearOf(b) - yearOf(a)).slice(0, 60) });
      rows.push({ id: 'svc-all-movies', title: `All Movies (${movieList.length})`, items: [...movieList].sort((a, b) => cleanTitle(itemName(a)).localeCompare(cleanTitle(itemName(b)))) });
    }
    return { rows, categories: [], otherLanguages: [], loading: sorting.running && !rows.length };
  };

  // Shows not checked yet are looked up in the background; the page refreshes as they come in.
  const seen = new Set<string>();
  const queue: { k: string; name: string; year?: number }[] = [];
  for (const it of sItems) {
    const k = keyOf(itemName(it));
    if (!k || seen.has(k)) continue;
    seen.add(k);
    queue.push({ k, name: cleanTitle(itemName(it)) || itemName(it), year: yearOf(it) || undefined });
  }
  const refresh = () => onUpdate(build());
  listeners.add(refresh);
  sortShows(queue);
  if (!job) listeners.delete(refresh);
  else void job.finally(() => listeners.delete(refresh));
  const first = build();
  onUpdate(first);
  return first;
}

/** Shown on the page while nothing is found yet. */
export function serviceHint(): string {
  return watchmodeKey()
    ? 'Nothing from your playlists is on this service yet.'
    : 'Still checking your shows. For movies too, add a Watchmode key in Settings → Movies & Shows.';
}
