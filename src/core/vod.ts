// Movies and shows (video on demand) from the user's own provider: Xtream "player_api.php"
// lists (get_vod_streams, get_series, get_series_info…) and VOD entries in plain M3U playlists.
// Pure parsing and URL building; nothing is bundled or searched for elsewhere.
import { normalizeServer, type XtreamLogin } from './xtream';

export interface VodCategory {
  id: string;
  name: string;
}

export interface VodMovie {
  id: string;
  name: string;
  poster?: string;
  categoryId: string;
  rating?: number;
  year?: string;
  added?: number;
  ext: string;
  /** Direct URL (M3U playlists); Xtream movies build theirs from the login. */
  url?: string;
}

export interface VodSeries {
  id: string;
  name: string;
  poster?: string;
  categoryId: string;
  rating?: number;
  year?: string;
  plot?: string;
  genre?: string;
  cast?: string;
  backdrop?: string;
  /** Last update from the provider (unix seconds). */
  added?: number;
}

export interface VodEpisode {
  id: string;
  season: number;
  episode: number;
  title: string;
  ext: string;
  plot?: string;
  image?: string;
  durationSec?: number;
  url?: string;
}

export interface VodDetails {
  plot?: string;
  genre?: string;
  cast?: string;
  director?: string;
  year?: string;
  durationSec?: number;
  rating?: number;
  poster?: string;
  backdrop?: string;
  trailer?: string;
  /** Video height of the file (from the provider's media info), e.g. 1080. */
  height?: number;
}

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === 'object' ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number | undefined => {
  const n = Number(str(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const yearOf = (...vals: unknown[]): string | undefined => {
  for (const v of vals) {
    const m = /(19|20)\d\d/.exec(str(v));
    if (m) return m[0];
  }
  return undefined;
};
const url = (v: unknown): string | undefined => {
  const s = str(Array.isArray(v) ? v[0] : v);
  return /^https?:\/\//i.test(s) ? s : undefined;
};

export function parseCategories(json: unknown): VodCategory[] {
  return arr(json).map((c) => ({ id: str(obj(c).category_id), name: str(obj(c).category_name) })).filter((c) => c.id && c.name);
}

/** get_vod_streams -> movies (newest first within a category is up to the caller). */
export function parseMovies(json: unknown): VodMovie[] {
  return arr(json).map((x) => {
    const m = obj(x);
    return {
      id: str(m.stream_id),
      name: str(m.name),
      poster: url(m.stream_icon) ?? url(m.cover),
      categoryId: str(m.category_id),
      rating: num(m.rating_5based) ? num(m.rating_5based)! * 2 : num(m.rating),
      year: yearOf(m.year, m.releaseDate, m.name),
      added: num(m.added),
      ext: str(m.container_extension) || 'mp4',
    };
  }).filter((m) => m.id && m.name);
}

export function parseSeriesList(json: unknown): VodSeries[] {
  return arr(json).map((x) => {
    const s = obj(x);
    return {
      id: str(s.series_id),
      name: str(s.name),
      poster: url(s.cover),
      categoryId: str(s.category_id),
      rating: num(s.rating_5based) ? num(s.rating_5based)! * 2 : num(s.rating),
      year: yearOf(s.releaseDate, s.release_date, s.year, s.name),
      plot: str(s.plot) || undefined,
      genre: str(s.genre) || undefined,
      cast: str(s.cast) || undefined,
      backdrop: url(s.backdrop_path),
      added: num(s.last_modified),
    };
  }).filter((s) => s.id && s.name);
}

function durationSec(info: J): number | undefined {
  const secs = num(info.duration_secs);
  if (secs) return secs;
  const m = /^(\d+):(\d\d)(?::(\d\d))?$/.exec(str(info.duration));
  if (m) return m[3] ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
  return undefined;
}

/** get_vod_info -> plot, cast, year, runtime, artwork, trailer. */
export function parseMovieInfo(json: unknown): VodDetails {
  const info = obj(obj(json).info);
  const yt = str(info.youtube_trailer);
  return {
    plot: str(info.plot) || str(info.description) || undefined,
    genre: str(info.genre) || undefined,
    cast: str(info.cast) || str(info.actors) || undefined,
    director: str(info.director) || undefined,
    year: yearOf(info.releasedate, info.release_date, info.year),
    durationSec: durationSec(info),
    rating: num(info.rating),
    poster: url(info.movie_image) ?? url(info.cover_big),
    backdrop: url(info.backdrop_path),
    trailer: yt ? (/^https?:/.test(yt) ? yt : `https://www.youtube.com/watch?v=${yt}`) : undefined,
    height: num(obj(info.video).height) ?? num(obj(obj(json).movie_data).height),
  };
}

/** get_series_info -> details plus episodes by season (seasons in order, episodes in order). */
export function parseSeriesInfo(json: unknown): { details: VodDetails; seasons: { season: number; episodes: VodEpisode[] }[] } {
  const root = obj(json);
  const info = obj(root.info);
  const bySeason = new Map<number, VodEpisode[]>();
  const eps = root.episodes;
  const lists: unknown[][] = Array.isArray(eps) ? [eps] : Object.values(obj(eps)).map((v) => arr(v));
  for (const list of lists) for (const x of list) {
    const e = obj(x);
    const ei = obj(e.info);
    const season = Number(str(e.season)) || 1;
    const ep: VodEpisode = {
      id: str(e.id),
      season,
      episode: Number(str(e.episode_num)) || 0,
      title: str(e.title) || `Episode ${str(e.episode_num)}`,
      ext: str(e.container_extension) || 'mp4',
      plot: str(ei.plot) || undefined,
      image: url(ei.movie_image),
      durationSec: durationSec(ei),
    };
    if (!ep.id) continue;
    const a = bySeason.get(season);
    if (a) a.push(ep);
    else bySeason.set(season, [ep]);
  }
  const seasons = [...bySeason.entries()].sort((a, b) => a[0] - b[0]).map(([season, episodes]) => ({ season, episodes: episodes.sort((a, b) => a.episode - b.episode) }));
  return {
    details: {
      plot: str(info.plot) || undefined,
      genre: str(info.genre) || undefined,
      cast: str(info.cast) || undefined,
      director: str(info.director) || undefined,
      year: yearOf(info.releaseDate, info.release_date),
      rating: num(info.rating),
      poster: url(info.cover),
      backdrop: url(info.backdrop_path),
      trailer: str(info.youtube_trailer) ? `https://www.youtube.com/watch?v=${str(info.youtube_trailer)}` : undefined,
    },
    seasons,
  };
}

const enc = encodeURIComponent;

export function movieUrl(l: XtreamLogin, m: Pick<VodMovie, 'id' | 'ext' | 'url'>): string {
  return m.url ?? `${normalizeServer(l.server)}/movie/${enc(l.username.trim())}/${enc(l.password.trim())}/${m.id}.${m.ext}`;
}

export function episodeUrl(l: XtreamLogin, e: Pick<VodEpisode, 'id' | 'ext' | 'url'>): string {
  return e.url ?? `${normalizeServer(l.server)}/series/${enc(l.username.trim())}/${enc(l.password.trim())}/${e.id}.${e.ext}`;
}

/** "Breaking Bad S02 E05" / "Show.Name.S2E5" -> show, season, episode. */
export function episodeOf(name: string): { show: string; season: number; episode: number } | undefined {
  const m = /^(.*?)[\s._-]*S(\d{1,2})[\s._-]*E(\d{1,3})\b/i.exec(name);
  if (!m) return undefined;
  return { show: m[1].replace(/[._]+/g, ' ').trim(), season: Number(m[2]), episode: Number(m[3]) };
}

/** Movie / episode entries of a plain M3U playlist (URLs with /movie/, /series/ or a video file). */
export function m3uVod(entries: { name: string; url: string; logo?: string; group?: string }[]): { movies: VodMovie[]; series: { series: VodSeries; episodes: VodEpisode[] }[]; categories: VodCategory[]; seriesCategories: VodCategory[] } {
  const cats = new Map<string, string>();
  const scats = new Map<string, string>();
  const catId = (m: Map<string, string>, g: string) => {
    if (!m.has(g)) m.set(g, String(m.size + 1));
    return m.get(g)!;
  };
  const movies: VodMovie[] = [];
  const shows = new Map<string, { series: VodSeries; episodes: VodEpisode[] }>();
  entries.forEach((e, i) => {
    const ext = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(e.url)?.[1]?.toLowerCase() ?? 'mp4';
    const ep = /\/series\//i.test(e.url) || episodeOf(e.name) ? episodeOf(e.name) : undefined;
    const group = e.group || (ep ? 'Shows' : 'Movies');
    if (ep) {
      const key = `${group}|${ep.show.toLowerCase()}`;
      let s = shows.get(key);
      if (!s) {
        s = { series: { id: `m3u-s${shows.size + 1}`, name: ep.show, poster: e.logo, categoryId: catId(scats, group) }, episodes: [] };
        shows.set(key, s);
      }
      s.episodes.push({ id: `m3u-e${i}`, season: ep.season, episode: ep.episode, title: e.name, ext, url: e.url });
    } else {
      movies.push({ id: `m3u-m${i}`, name: e.name, poster: e.logo, categoryId: catId(cats, group), ext, url: e.url, year: yearOf(e.name) });
    }
  });
  const toList = (m: Map<string, string>) => [...m.entries()].map(([name, id]) => ({ id, name }));
  return { movies, series: [...shows.values()], categories: toList(cats), seriesCategories: toList(scats) };
}

export function formatDuration(sec: number | undefined): string {
  if (!sec || !Number.isFinite(sec)) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

// ---------------- Home page: English categories, genres, trending ----------------

const ENGLISH_CODES = new Set(['EN', 'ENG', 'US', 'USA', 'UK', 'GB', 'CA', 'CAN', 'AU', 'AUS', 'NZ', 'IE']);
const FOREIGN_WORDS = /\b(arab|arabic|french|fran[cç]ais|german|deutsch|ital|spanish|espa[nñ]ol|latino|latin|portug|brasil|brazil|turk|t[uü]rk|hindi|bollywood|tamil|telugu|malayalam|punjabi|bangla|urdu|pakistan|persian|farsi|iran|kurd|polish|polska|dutch|nederland|greek|russian|ukrain|albania|romania|bulgar|serbia|croatia|bosnia|ex-?yu|hungar|czech|swed|norw|danish|finn|nordic|korean|k-?drama|chinese|japanese|anime|thai|vietnam|filipino|pinoy|indones|malay|african|nollywood|somali|ethiopia|amharic|hebrew|israel)\b/i;
const NON_LATIN = /[^\u0000-ɏḀ-ỿ -⯿︀-️\u{1F000}-\u{1FAFF}\s]/u;

/** Whether a provider category is English (EN|, US:, UK -, or no foreign language / code at all). */
export function isEnglishCategory(name: string): boolean {
  const n = name.normalize('NFKC');
  if (NON_LATIN.test(n)) return false;
  const m = /^\s*[[(|]?\s*([A-Za-z]{2,4})\s*(?:[\])|:»•·\/]|\s[-–—]\s|\s*[-–—]\s)/.exec(n);
  if (m) {
    const code = m[1].toUpperCase();
    if (ENGLISH_CODES.has(code)) return !FOREIGN_WORDS.test(n);
    // Short codes that are other countries / languages (FR|, AR:, DE -, ES |…)
    if (/^[A-Z]{2,3}$/.test(code) && code === m[1] && !/^(TOP|NEW|HOT|ALL|THE|VOD|HD|FHD|UHD|4K|KID|ACT)$/.test(code)) return false;
  }
  return !FOREIGN_WORDS.test(n);
}

export type VodGenre = 'hulu' | 'action' | 'comedy' | 'drama' | 'thriller' | 'horror' | 'scifi' | 'family' | 'documentary' | 'crime' | 'romance' | 'war' | 'netflix' | 'disney' | 'hbo' | 'prime' | 'apple' | 'hulu' | 'paramount' | 'peacock';

export const GENRE_ROWS: { id: VodGenre; label: string; re: RegExp }[] = [
  { id: 'action', label: 'Action & Adventure', re: /action|adventure|martial/i },
  { id: 'comedy', label: 'Comedies', re: /comed|funny|stand.?up|sitcom/i },
  { id: 'drama', label: 'Dramas', re: /drama/i },
  { id: 'thriller', label: 'Thrillers & Mysteries', re: /thriller|suspense|myster/i },
  { id: 'crime', label: 'Crime', re: /crime|gangster|mafia/i },
  { id: 'horror', label: 'Horror', re: /horror|scary|slasher/i },
  { id: 'scifi', label: 'Sci-Fi & Fantasy', re: /sci.?fi|science.?fiction|fantasy|superhero|marvel|\bdc\b/i },
  { id: 'family', label: 'Kids & Family', re: /\bkids?\b|family|animat|cartoon|children|pixar/i },
  { id: 'romance', label: 'Romance', re: /romance|romantic|rom.?com|\blove\b/i },
  { id: 'documentary', label: 'Documentaries', re: /docu/i },
  { id: 'war', label: 'War, History & Westerns', re: /\bwar\b|western|histor/i },
  { id: 'hulu', label: 'Hulu', re: /hulu/i },
  { id: 'netflix', label: 'Netflix', re: /netflix/i },
  { id: 'disney', label: 'Disney+', re: /disney/i },
  { id: 'hbo', label: 'HBO & Max', re: /\bhbo\b|\bmax\b/i },
  { id: 'prime', label: 'Prime Video', re: /amazon|prime/i },
  { id: 'apple', label: 'Apple TV+', re: /apple/i },
  { id: 'paramount', label: 'Paramount+', re: /paramount/i },
  { id: 'peacock', label: 'Peacock', re: /peacock/i },
];

export function genreOf(category: string): VodGenre | undefined {
  return GENRE_ROWS.find((g) => g.re.test(category))?.id;
}

/** Provider categories that are themselves a "what's popular" list. */
export function isTrendingCategory(category: string): boolean {
  return /trend|popular|top\s?10|top\s?20|box\s?office|\bhot\b|most\s?watched|in\s?cinema|in\s?theat/i.test(category);
}

/** Title for matching across sources: no "EN - " prefix, year, quality tags or punctuation. */
export function normTitle(name: string): string {
  return name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/^\s*[[(|]?\s*[A-Za-z]{2,4}\s*[\])|:»•·]\s*/, '')
    .replace(/^\s*[A-Za-z]{2,4}\s+[-–—]\s+/, '')
    .replace(/[([]\s*(19|20)\d\d\s*[)\]]/g, ' ')
    .replace(/\b(4k|uhd|fhd|hd|sd|hevc|x265|multi|sub(s|bed)?|dubbed|1080p|720p)\b/gi, ' ')
    .replace(/,?\s*season\s*\d+.*$/i, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

/** Apple's public iTunes top-movies / top-TV-seasons chart (JSON) -> titles in chart order. */
export function parseItunesChart(json: unknown): string[] {
  const entries = arr(obj(obj(json).feed).entry);
  return entries.map((e) => str(obj(obj(e)['im:name']).label)).filter(Boolean);
}

// ---------------- Quality ----------------

export interface Quality {
  /** Higher is preferred: 1080p first, then 4K, 720p, unknown, SD. */
  rank: number;
  label: string;
}

/** Quality from the title / category tags ("4K", "FHD", "1080p", "HD", "SD") or the file's video height. */
export function qualityOf(text: string, height?: number): Quality {
  const h = height ?? 0;
  if (h >= 2000 || /\b(4k|uhd|2160p?)\b/i.test(text)) return { rank: 4, label: '4K' };
  if (h >= 1000 || /\b(fhd|1080p?|full\s?hd)\b/i.test(text)) return { rank: 5, label: '1080p' };
  if (h >= 700 || /\b(hd|720p?)\b/i.test(text)) return { rank: 3, label: '720p' };
  if ((h > 0 && h < 700) || /\b(sd|480p?|576p?|cam|ts)\b/i.test(text)) return { rank: 1, label: 'SD' };
  return { rank: 2, label: '' };
}

/** The search name of a title: no language prefix, year or quality tags ("EN - The Batman (2022) 4K" -> "The Batman"). */
export function cleanTitle(name: string): string {
  return name
    .replace(/^\s*[[(|]?\s*[A-Za-z]{2,4}\s*[\])|:»•·]\s*/, '')
    .replace(/^\s*[A-Za-z]{2,4}\s+[-–—]\s+/, '')
    .replace(/[([]\s*(19|20)\d\d\s*[)\]]/g, ' ')
    .replace(/[([][^)\]]*[)\]]/g, (m) => (/\b(4k|uhd|fhd|hd|sd|multi|sub|dub|1080|720)\b/i.test(m) ? ' ' : m))
    .replace(/\b(4k|uhd|fhd|hd|sd|hevc|x265|h265|multi|1080p|720p|2160p)\b/gi, ' ')
    .replace(/\s+(19|20)\d\d\s*$/, ' ')
    .replace(/\s*[-–|]+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function titleYear(name: string): string | undefined {
  return yearOf(name);
}

// ---------------- Artwork and descriptions (TVmaze for shows, iTunes for movies) ----------------

export interface ArtInfo {
  poster?: string;
  plot?: string;
  year?: string;
  genre?: string;
  rating?: number;
  imdb?: string;
  /** Episodes by "season:episode". */
  episodes?: Record<string, { title?: string; plot?: string; image?: string; runtime?: number }>;
  source: 'tvmaze' | 'itunes' | 'wikipedia';
}

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s{2,}/g, ' ').trim();
const near = (a?: string, b?: string) => !a || !b || Math.abs(Number(a) - Number(b)) <= 1;

/** TVmaze "singlesearch/shows?embed=episodes" -> poster, summary and every episode (only when the name — and year, if known — match). */
export function parseTvmazeShow(json: unknown, name: string, year?: string): ArtInfo | undefined {
  const s = obj(json);
  if (!str(s.name) || normTitle(str(s.name)) !== normTitle(cleanTitle(name))) return undefined;
  const premiered = yearOf(s.premiered);
  if (!near(premiered, year ?? yearOf(name))) return undefined;
  const episodes: NonNullable<ArtInfo['episodes']> = {};
  for (const x of arr(obj(s._embedded).episodes)) {
    const e = obj(x);
    const k = `${str(e.season)}:${str(e.number)}`;
    episodes[k] = { title: str(e.name) || undefined, plot: strip(str(e.summary)) || undefined, image: url(obj(e.image).original) ?? url(obj(e.image).medium), runtime: num(e.runtime) };
  }
  return {
    poster: url(obj(s.image).original) ?? url(obj(s.image).medium),
    plot: strip(str(s.summary)) || undefined,
    year: premiered,
    genre: arr(s.genres).map(str).filter(Boolean).join(', ') || undefined,
    rating: num(obj(s.rating).average),
    imdb: str(obj(s.externals).imdb) || undefined,
    episodes,
    source: 'tvmaze',
  };
}

/** iTunes Search (movies) -> the matching movie's large poster and description. */
export function parseItunesMovie(json: unknown, name: string, year?: string): ArtInfo | undefined {
  const want = normTitle(cleanTitle(name));
  for (const x of arr(obj(json).results)) {
    const r = obj(x);
    if (normTitle(str(r.trackName)) !== want) continue;
    const y = yearOf(r.releaseDate);
    if (!near(y, year ?? yearOf(name))) continue;
    const art = str(r.artworkUrl100);
    return {
      poster: art ? art.replace(/\/\d+x\d+(bb)?\.(jpg|png)$/i, '/600x900bb.jpg') : undefined,
      plot: str(r.longDescription) || str(r.shortDescription) || undefined,
      year: y,
      genre: str(r.primaryGenreName) || undefined,
      source: 'itunes',
    };
  }
  return undefined;
}

// ---------------- Continue watching ----------------

export interface SeriesRef {
  id: string;
  name: string;
  poster?: string;
  season: number;
  episode: number;
  episodeId: string;
  year?: string;
}

export interface ResumeEntry {
  key: string;
  title: string;
  subtitle?: string;
  poster?: string;
  pos: number;
  dur: number;
  at: number;
  /** What's needed to play it again from "Continue watching". */
  url: string;
  playlistId: string;
  series?: SeriesRef;
  /** Watched to the end (kept for shows, so the next episode is picked). */
  done?: boolean;
  /** Another episode follows this one. */
  hasNext?: boolean;
}

/** Continue watching: unfinished movies, and one card per show — the episode watched last. */
export function continueList(all: ResumeEntry[]): ResumeEntry[] {
  const seen = new Set<string>();
  const out: ResumeEntry[] = [];
  for (const e of [...all].sort((a, b) => b.at - a.at)) {
    if (e.series || e.key.startsWith('e:')) {
      // Older entries have no show id: the show's name groups them.
      // One card per show: by its name, so copies (4K / HD), other playlists and older entries collapse too.
      const k = `show:${normTitle(cleanTitle(e.series?.name ?? e.title))}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (e.done && !e.hasNext) continue; // finished the last episode
      out.push(e);
    } else if (!e.done) out.push(e);
  }
  return out;
}


/** TVmaze schedule (network: [{show}], streaming: [{_embedded: {show}}]) -> show names that had a new episode. */
export function parseTvmazeSchedule(json: unknown): string[] {
  const out: string[] = [];
  for (const x of arr(json)) {
    const e = obj(x);
    const show = obj(e.show ?? obj(e._embedded).show);
    const n = str(show.name);
    if (n && str(show.language || 'English') === 'English' && !out.includes(n)) out.push(n);
  }
  return out;
}
