// Free, key-less US lists for the Movies / Shows home rows (no Watchmode key needed): Apple's US iTunes
// charts (movies overall and by genre, TV seasons) and TVmaze's US TV / streaming schedule (shows with
// their network or streaming service, genres and popularity). Pure parsing; app/freelists.ts fetches.

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === 'object' ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const yearOf = (v: unknown): number | undefined => {
  const m = /(19|20)\d\d/.exec(str(v));
  return m ? Number(m[0]) : undefined;
};

export interface ChartTitle {
  title: string;
  year?: number;
}

/** iTunes RSS chart (topmovies / toptvseasons) -> titles with their release year, in chart order. */
export function parseItunesChartTitles(json: unknown, tv = false): ChartTitle[] {
  const out: ChartTitle[] = [];
  const seen = new Set<string>();
  for (const x of arr(obj(obj(json).feed).entry)) {
    const e = obj(x);
    let title = str(obj(e['im:name']).label);
    // TV charts list seasons ("The Bear, Season 3"): the show is what matters (and its year isn't the season's).
    if (tv) title = title.replace(/,?\s*[-:(]?\s*(the complete\s+)?(season|series|vol\.?|volume)\s*\d+.*$/i, '').trim();
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    out.push({ title, year: tv ? undefined : yearOf(obj(e['im:releaseDate']).label) });
  }
  return out;
}

export interface ScheduleShow {
  name: string;
  year?: number;
  /** TVmaze popularity (higher = more watched). */
  weight: number;
  /** Streaming service or TV network ("Netflix", "HBO", "NBC"). */
  channel: string;
  genres: string[];
  type: string;
  /** Air date of the newest episode seen (YYYY-MM-DD). */
  aired: string;
}

/** TVmaze /schedule or /schedule/web -> the English-language shows in it. */
export function parseScheduleShows(json: unknown): ScheduleShow[] {
  const out: ScheduleShow[] = [];
  for (const x of arr(json)) {
    const e = obj(x);
    const s = obj(e.show ?? obj(e._embedded).show);
    const name = str(s.name);
    if (!name || str(s.language || 'English') !== 'English') continue;
    const channel = str(obj(s.webChannel).name) || str(obj(s.network).name);
    out.push({ name, year: yearOf(s.premiered), weight: Number(s.weight) || 0, channel, genres: arr(s.genres).map(str).filter(Boolean), type: str(s.type), aired: str(e.airdate) });
  }
  return out;
}

/** Many days of schedule -> one entry per show (newest air date kept). */
export function mergeShows(lists: ScheduleShow[][]): ScheduleShow[] {
  const by = new Map<string, ScheduleShow>();
  for (const s of lists.flat()) {
    const k = s.name.toLowerCase();
    const had = by.get(k);
    if (!had) by.set(k, { ...s });
    else if (s.aired > had.aired) had.aired = s.aired;
  }
  return [...by.values()];
}

export const SHOW_SERVICES: { label: string; re: RegExp }[] = [
  { label: 'Netflix', re: /^netflix$/i },
  { label: 'Hulu', re: /^hulu$/i },
  { label: 'Max', re: /^(max|hbo|hbo max)$/i },
  { label: 'Disney+', re: /^disney\s*\+$/i },
  { label: 'Prime Video', re: /^(amazon )?prime video$/i },
  { label: 'Apple TV+', re: /^apple tv\s*\+?$/i },
  { label: 'Peacock', re: /^peacock$/i },
  { label: 'Paramount+', re: /^paramount\s*\+$/i },
];
export const BROADCAST = /^(abc|cbs|nbc|fox|the cw|cw)$/i;

export const SHOW_GENRES: { label: string; test: (s: ScheduleShow) => boolean }[] = [
  { label: 'Dramas', test: (s) => s.genres.includes('Drama') },
  { label: 'Comedies', test: (s) => s.genres.includes('Comedy') },
  { label: 'Crime', test: (s) => s.genres.includes('Crime') },
  { label: 'Action & Adventure', test: (s) => s.genres.includes('Action') || s.genres.includes('Adventure') },
  { label: 'Thrillers', test: (s) => s.genres.includes('Thriller') || s.genres.includes('Mystery') },
  { label: 'Sci-Fi & Fantasy', test: (s) => s.genres.includes('Science-Fiction') || s.genres.includes('Fantasy') || s.genres.includes('Supernatural') },
  { label: 'Horror', test: (s) => s.genres.includes('Horror') },
  { label: 'Reality', test: (s) => s.type === 'Reality' || s.type === 'Game Show' },
  { label: 'Talk & Late Night', test: (s) => s.type === 'Talk Show' },
  { label: 'Documentaries', test: (s) => s.type === 'Documentary' },
  { label: 'Animation', test: (s) => s.type === 'Animation' },
  { label: 'Kids & Family', test: (s) => s.genres.includes('Children') || s.genres.includes('Family') },
];
