// The LTTV streaming apps (Fire TV): every movie and show from your own playlists goes into the app of
// the streaming service it's on — LTTV Fresh (Hulu), Binge (Netflix), Prestige (Max), Peak (Paramount+),
// Family (Disney+), Spark (Prime Video), Bright (Peacock), Studio (Apple TV+) — and anything else into
// LTTV Library, so nothing is lost. Where a title streams comes from, best first:
//  1. Watchmode (Settings → Movies & Shows key): each service's whole US catalog, as it is now.
//  2. Shows: the network / streaming service TVmaze lists, mapped to where that network streams
//     (NBC → Peacock, FX and ABC → Hulu, HBO → Max, CBS → Paramount+, Disney Channel → Disney+…).
//  3. Movies: the studio Wikidata lists, mapped to where that studio's films stream
//     (Warner Bros. → Max, Universal → Peacock, Disney / Pixar / Marvel → Disney+, Sony → Netflix…).
// Lookups run once per title in the background (paced) and are kept on the device.
// The apps have LTTV's own names and colors; the service names are only used to look titles up.
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
  /** The service whose titles it shows (used to look titles up, never shown as branding). */
  service: string;
  color: string;
  /** Watchmode source names (none: LTTV Library, everything not on a service). */
  wm?: RegExp;
  /** TVmaze networks / streaming services whose shows stream here. */
  networks?: RegExp;
  /** Wikidata studios / distributors whose movies stream here. */
  studios?: RegExp;
}

export const SERVICE_APPS: ServiceApp[] = [
  {
    id: 'fresh', name: 'LTTV Fresh', service: 'Hulu', color: '#FFB020', wm: /^hulu$/i,
    networks: /^(hulu|fx on hulu|fx|fxx|fxm|abc|freeform|fox|abc family)$/i,
    studios: /^(searchlight pictures|fox searchlight pictures|hulu|hulu originals)$/i,
  },
  {
    id: 'binge', name: 'LTTV Binge', service: 'Netflix', color: '#FF4FA0', wm: /^netflix$/i,
    networks: /^netflix$/i,
    studios: /^(netflix|netflix animation|columbia pictures|sony pictures( releasing| entertainment| animation| classics)?|tristar pictures|screen gems)$/i,
  },
  {
    id: 'prestige', name: 'LTTV Prestige', service: 'Max', color: '#CBD5E1', wm: /^(max|hbo max)$/i,
    networks: /^(hbo|hbo max|max|cinemax|tnt|tbs|trutv|cnn|discovery|discovery channel|tlc|hgtv|food network|investigation discovery|id|animal planet|adult swim|cartoon network|travel channel|own)$/i,
    studios: /^(warner bros\.?( pictures| entertainment| animation)?|new line cinema|hbo( films)?|dc (films|studios|entertainment)|a24|castle rock entertainment)$/i,
  },
  {
    id: 'peak', name: 'LTTV Peak', service: 'Paramount+', color: '#D946EF', wm: /^paramount\s*\+/i,
    networks: /^(paramount\+|cbs|cbs all access|showtime|comedy central|mtv|nickelodeon|nick jr\.?|bet|bet\+|paramount network|cmt|tv land|vh1|smithsonian channel|pluto tv)$/i,
    studios: /^(paramount pictures|paramount players|paramount animation|nickelodeon movies|mtv films|cbs films|miramax)$/i,
  },
  {
    id: 'family', name: 'LTTV Family', service: 'Disney+', color: '#FDE68A', wm: /^disney\s*\+$/i,
    networks: /^(disney\+|disney channel|disney junior|disney xd|national geographic|nat geo wild|national geographic channel)$/i,
    studios: /^(walt disney pictures|walt disney studios motion pictures|walt disney animation studios|disney\+|pixar|marvel studios|lucasfilm|20th century studios|20th century fox|twentieth century fox|disneynature)$/i,
  },
  {
    id: 'spark', name: 'LTTV Spark', service: 'Prime Video', color: '#FB7185', wm: /^(amazon )?prime video$/i,
    networks: /^(prime video|amazon|amazon prime video|amazon freevee|freevee|imdb tv|mgm\+|epix)$/i,
    studios: /^(amazon studios|amazon mgm studios|metro-goldwyn-mayer|mgm|united artists|united artists releasing|orion pictures|amazon prime video)$/i,
  },
  {
    id: 'bright', name: 'LTTV Bright', service: 'Peacock', color: '#A78BFA', wm: /^peacock( premium)?$/i,
    networks: /^(peacock|nbc|bravo|usa network|syfy|e!|oxygen|telemundo|cnbc|msnbc|universal kids)$/i,
    studios: /^(universal pictures|universal studios|focus features|dreamworks animation|illumination( entertainment)?|blumhouse productions|working title films)$/i,
  },
  {
    id: 'studio', name: 'LTTV Studio', service: 'Apple TV+', color: '#2DD4BF', wm: /^apple tv\s*\+?$/i,
    networks: /^(apple tv\+|apple tv)$/i,
    studios: /^(apple tv\+|apple studios|apple original films|apple tv)$/i,
  },
  { id: 'library', name: 'LTTV Library', service: '', color: '#93C5FD' },
];

export const serviceApp = (id?: string) => SERVICE_APPS.find((s) => s.id === id);
const STREAMERS = SERVICE_APPS.filter((s) => s.id !== 'library');

const FOREIGN = /\b(vostfr|vost|vf|vff|truefrench|french|latino|castellano|español|espanol|dublado|legendado|deutsch|german|ita|italiano|türkçe|turkce|arabic|hindi|dubbed)\b/i;
const english = (name: string) => isEnglishCategory(name) && !FOREIGN.test(name);
const keyOf = (name: string) => normTitle(cleanTitle(name));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const override = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) || d;
  } catch {
    return d;
  }
};
async function getJson(url: string): Promise<unknown> {
  const { stream } = await openRemote(url, AbortSignal.timeout?.(25_000));
  return JSON.parse(await new Response(stream).text());
}

// ---- The library and what's known about it ---------------------------------------------------------

interface Lib {
  movies: VodItem[];
  shows: VodItem[];
}
let libJob: Promise<Lib> | null = null;
const yearOf = (it: VodItem) => Number(it.kind === 'movie' ? it.m.year : it.s.year) || Number(titleYear(itemName(it))) || 0;

function library(): Promise<Lib> {
  libJob ??= (async () => {
    const [movies, shows] = await Promise.all([loadAllMovies(), loadAllSeries()]);
    return {
      movies: movies.filter((m) => english(m.name)).map((m): VodItem => ({ kind: 'movie', playlistId: m.playlistId, m })),
      shows: shows.filter((s) => english(s.name)).map((s): VodItem => ({ kind: 'series', playlistId: s.playlistId, s })),
    };
  })().catch((e) => {
    libJob = null;
    throw e;
  });
  return libJob;
}

/** Show key -> "Web channel|Network" from TVmaze ('' = not found). */
const HOMES_KV = 'tvmaze:homes1';
/** Movie key -> "Studio|Distributor|…" from Wikidata ('' = not found). */
const STUDIOS_KV = 'wikidata:studios1';
let homes: Record<string, string> = {};
let studios: Record<string, string> = {};
/** Each service's catalog from Watchmode (in popularity order). */
const wm = new Map<string, { shows: WmTitle[]; movies: WmTitle[] }>();
let loadedKnown: Promise<void> | null = null;
export const sorting = { shows: 0, showsTotal: 0, movies: 0, moviesTotal: 0, catalogs: 0, catalogsTotal: 0 };

let version = 0;
const listeners = new Set<() => void>();
let notifyTimer: ReturnType<typeof setTimeout> | undefined;
/** Something new is known: pages refresh (at most every 3 seconds). */
function changed() {
  version++;
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = undefined;
    listeners.forEach((l) => l());
  }, 3000);
}

function loadKnown() {
  loadedKnown ??= (async () => {
    homes = (await repo.getKv<Record<string, string>>(HOMES_KV).catch(() => undefined)) ?? {};
    studios = (await repo.getKv<Record<string, string>>(STUDIOS_KV).catch(() => undefined)) ?? {};
  })();
  return loadedKnown;
}

const running = new Set<string>();
/** Starts each lookup unless it's already running (an app opened again later picks up where it stopped). */
function startLookups(lib: Lib) {
  const run = (name: string, job: () => Promise<void>) => {
    if (running.has(name)) return;
    running.add(name);
    void job().catch(() => undefined).finally(() => {
      running.delete(name);
      changed();
    });
  };
  run('watchmode', watchmodeJob);
  run('shows', () => showsJob(lib));
  run('movies', () => moviesJob(lib));
}

async function watchmodeJob() {
  if (!watchmodeKey()) return;
  const list = STREAMERS.filter((s) => s.wm);
  sorting.catalogsTotal = list.length;
  sorting.catalogs = 0;
  for (const s of list) {
    try {
      const [shows, movies] = await Promise.all([serviceTitles('shows', s.wm!), serviceTitles('movies', s.wm!)]);
      wm.set(s.id, { shows, movies });
    } catch {
      /* out of credits / offline: the other sources still sort */
    }
    sorting.catalogs++;
    changed();
  }
}

/** TVmaze: the network / streaming service of every show not checked yet. */
async function showsJob(lib: Lib) {
  const todo = new Map<string, { name: string; year: number }>();
  for (const it of lib.shows) {
    const k = keyOf(itemName(it));
    if (k && !(k in homes) && !todo.has(k)) todo.set(k, { name: cleanTitle(itemName(it)) || itemName(it), year: yearOf(it) });
  }
  sorting.showsTotal = new Set(lib.shows.map((it) => keyOf(itemName(it)))).size;
  sorting.shows = sorting.showsTotal - todo.size;
  let fails = 0;
  let lastSave = Date.now();
  for (const [k, x] of todo) {
    try {
      const j = (await paced('tvmaze', () => getJson(`${override('lttvTvmazeBase', 'https://api.tvmaze.com')}/singlesearch/shows?q=${encodeURIComponent(x.name)}`), false)) as
        { premiered?: string; webChannel?: { name?: string } | null; network?: { name?: string } | null } | null;
      const prem = Number(String(j?.premiered ?? '').slice(0, 4)) || 0;
      const ok = !!j && (!x.year || !prem || Math.abs(prem - x.year) <= 1);
      homes[k] = ok ? [j?.webChannel?.name, j?.network?.name].filter(Boolean).join('|') : '';
      fails = 0;
    } catch (e) {
      if (/404|not found/i.test(String((e as Error).message))) homes[k] = '';
      else if (++fails >= 6) break; // offline: carry on next time
      else await sleep(3000);
    }
    sorting.shows++;
    changed();
    if (Date.now() - lastSave > 20_000) {
      void repo.setKv(HOMES_KV, homes).catch(() => undefined);
      lastSave = Date.now();
    }
  }
  await repo.setKv(HOMES_KV, homes).catch(() => undefined);
}

const FILM_TYPES = 'wd:Q11424 wd:Q29168811 wd:Q202866 wd:Q24869 wd:Q506240 wd:Q93204';
const sparqlString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"@en`;

/** Wikidata: the studios and distributors of every movie not checked yet, 30 titles per query. */
async function moviesJob(lib: Lib) {
  const todo = new Map<string, { title: string; year: number }>();
  for (const it of lib.movies) {
    const k = keyOf(itemName(it));
    const title = cleanTitle(itemName(it)) || itemName(it);
    if (k && !(k in studios) && !todo.has(k)) todo.set(k, { title, year: yearOf(it) });
  }
  sorting.moviesTotal = new Set(lib.movies.map((it) => keyOf(itemName(it)))).size;
  sorting.movies = sorting.moviesTotal - todo.size;
  const all = [...todo.entries()];
  let fails = 0;
  for (let i = 0; i < all.length; i += 30) {
    const batch = all.slice(i, i + 30);
    // Titles as written and in Title Case (providers often use capitals).
    const labels = new Set<string>();
    for (const [, x] of batch) {
      labels.add(x.title);
      labels.add(x.title.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(Of|The|A|An|And|In|On|At|To|For)\b(?!$)/g, (w, _m, off: number) => (off === 0 ? w : w.toLowerCase())));
    }
    const q = `SELECT ?t ?y ?cLabel WHERE {
  VALUES ?t { ${[...labels].map(sparqlString).join(' ')} }
  VALUES ?type { ${FILM_TYPES} }
  ?f rdfs:label ?t; wdt:P31 ?type.
  OPTIONAL { ?f wdt:P577 ?date. BIND(YEAR(?date) AS ?y) }
  { ?f wdt:P272 ?c. } UNION { ?f wdt:P750 ?c. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
    try {
      await sleep(1500);
      const j = (await getJson(`${override('lttvWikidataBase', 'https://query.wikidata.org/sparql')}?format=json&query=${encodeURIComponent(q)}`)) as
        { results?: { bindings?: { t?: { value: string }; y?: { value: string }; cLabel?: { value: string } }[] } };
      // Title -> year -> companies
      const found = new Map<string, Map<number, Set<string>>>();
      for (const b of j.results?.bindings ?? []) {
        const k = keyOf(b.t?.value ?? '');
        const c = b.cLabel?.value;
        if (!k || !c) continue;
        const y = Number(b.y?.value) || 0;
        const byYear = found.get(k) ?? new Map<number, Set<string>>();
        found.set(k, byYear);
        const set = byYear.get(y) ?? new Set<string>();
        byYear.set(y, set);
        set.add(c);
      }
      for (const [k, x] of batch) {
        const byYear = found.get(k);
        let pick: Set<string> | undefined;
        if (byYear) {
          // The film from the same year (remakes share titles); without a year, the newest.
          const years = [...byYear.keys()].sort((a, b) => b - a);
          const y = x.year ? years.find((v) => !v || Math.abs(v - x.year) <= 1) : years[0];
          pick = y !== undefined ? byYear.get(y) : undefined;
        }
        studios[k] = pick ? [...pick].join('|') : '';
        sorting.movies++;
      }
      fails = 0;
      changed();
      if ((i / 30) % 10 === 0) void repo.setKv(STUDIOS_KV, studios).catch(() => undefined);
    } catch {
      if (++fails >= 4) break; // offline / busy: carry on next time
      await sleep(10_000);
      i -= 30; // try this batch again
    }
  }
  await repo.setKv(STUDIOS_KV, studios).catch(() => undefined);
}

// ---- Which app each title goes in ----------------------------------------------------------------------

let assigned: { version: number; map: Map<string, string[]>; rank: Map<string, number> } | null = null;
const itemKey = (it: VodItem) => `${it.kind === 'movie' ? 'm' : 's'}:${keyOf(itemName(it))}`;

/** Show: the first of its streaming service / network that a service app takes. */
function showHome(k: string): string[] {
  for (const n of (homes[k] ?? '').split('|')) {
    const name = n.trim();
    if (!name) continue;
    const app = STREAMERS.find((s) => s.networks?.test(name));
    if (app) return [app.id];
  }
  return [];
}

/** Movie: the services its studios' films stream on; a streaming original goes only to its own service. */
function movieHome(k: string): string[] {
  const companies = (studios[k] ?? '').split('|').map((c) => c.trim()).filter(Boolean);
  const out = new Set<string>();
  for (const c of companies) for (const s of STREAMERS) if (s.studios?.test(c)) out.add(s.id);
  for (const original of ['binge', 'spark', 'studio']) {
    if (out.has(original) && companies.some((c) => /^(netflix|amazon|apple)/i.test(c))) return [original];
  }
  return [...out];
}

function assignments(lib: Lib) {
  if (assigned?.version === version) return assigned;
  const map = new Map<string, string[]>();
  const rank = new Map<string, number>();
  // Watchmode first: what each service actually has now.
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
  const mBy = index(lib.movies);
  const sBy = index(lib.shows);
  for (const [id, cat] of wm) {
    for (const [by, list, p] of [[sBy, cat.shows, 's'], [mBy, cat.movies, 'm']] as const) {
      list.forEach((t, i) => {
        const k = keyOf(t.title);
        const cands = by.get(k);
        if (!cands || !cands.some((c) => !t.year || !yearOf(c) || Math.abs(yearOf(c) - t.year) <= 1)) return;
        const key = `${p}:${k}`;
        const l = map.get(key) ?? [];
        if (!l.includes(id)) l.push(id);
        map.set(key, l);
        if (!rank.has(key)) rank.set(key, i);
      });
    }
  }
  // Then the network / studio for everything Watchmode didn't place.
  for (const it of lib.shows) {
    const key = itemKey(it);
    if (!map.has(key)) {
      const h = showHome(key.slice(2));
      if (h.length) map.set(key, h);
    }
  }
  for (const it of lib.movies) {
    const key = itemKey(it);
    if (!map.has(key)) {
      const h = movieHome(key.slice(2));
      if (h.length) map.set(key, h);
    }
  }
  assigned = { version, map, rank };
  return assigned;
}

// ---- The app's page ---------------------------------------------------------------------------------

function buildPage(app: ServiceApp, lib: Lib): VodHome {
  const { map, rank } = assignments(lib);
  const inApp = (it: VodItem) => {
    const ids = map.get(itemKey(it));
    return app.id === 'library' ? !ids?.length : !!ids?.includes(app.id);
  };
  const byPopular = (a: VodItem, b: VodItem) => (rank.get(itemKey(a)) ?? 1e9) - (rank.get(itemKey(b)) ?? 1e9) || yearOf(b) - yearOf(a);
  const byNewest = (a: VodItem, b: VodItem) => yearOf(b) - yearOf(a) || cleanTitle(itemName(a)).localeCompare(cleanTitle(itemName(b)));
  const byName = (a: VodItem, b: VodItem) => cleanTitle(itemName(a)).localeCompare(cleanTitle(itemName(b)));
  const shows = dedupe(lib.shows.filter(inApp));
  const movies = dedupe(lib.movies.filter(inApp));
  const checking = sorting.shows < sorting.showsTotal || sorting.movies < sorting.moviesTotal || sorting.catalogs < sorting.catalogsTotal;
  const note = checking
    ? `sorting your library: ${sorting.shows.toLocaleString()}/${sorting.showsTotal.toLocaleString()} shows, ${sorting.movies.toLocaleString()}/${sorting.moviesTotal.toLocaleString()} movies`
    : undefined;
  const rows: VodRow[] = [];
  const section = (list: VodItem[], what: 'Shows' | 'Movies', first: boolean) => {
    if (!list.length) return;
    const hasRank = list.some((it) => rank.has(itemKey(it)));
    rows.push({ id: `svc-top-${what}`, title: hasRank ? `Popular ${what}` : `New ${what}`, items: [...list].sort(hasRank ? byPopular : byNewest).slice(0, 30), note: first ? note : undefined });
    if (list.length > 30 && hasRank) rows.push({ id: `svc-new-${what}`, title: `New ${what}`, items: [...list].sort(byNewest).slice(0, 60) });
    rows.push({ id: `svc-all-${what}`, title: `All ${what} (${list.length.toLocaleString()})`, items: [...list].sort(byName) });
  };
  section(shows, 'Shows', true);
  section(movies, 'Movies', !shows.length);
  return { rows, categories: [], otherLanguages: [], loading: checking && !rows.length };
}

/** The page of a streaming app: its Shows and Movies from your playlists, filling in as titles are sorted. */
export async function loadServiceHome(id: string, onUpdate: (h: VodHome) => void): Promise<VodHome> {
  const app = serviceApp(id);
  if (!app) throw new Error('Unknown app');
  const [lib] = await Promise.all([library(), loadKnown()]);
  const refresh = () => onUpdate(buildPage(app, lib));
  listeners.add(refresh);
  // Keep listening while lookups run (pages that closed just ignore the update).
  setTimeout(() => listeners.delete(refresh), 6 * 3600_000);
  startLookups(lib);
  const first = buildPage(app, lib);
  onUpdate(first);
  return first;
}

/** Shown on the page while nothing is found yet. */
export function serviceHint(): string {
  return watchmodeKey()
    ? 'Still sorting your movies and shows — they appear here as they’re found.'
    : 'Still sorting your movies and shows — they appear here as they’re found. A Watchmode key (Settings → Movies & Shows) makes this exact.';
}
