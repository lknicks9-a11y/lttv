// Movies and Shows from the user's own playlists: Xtream providers' movie and series lists
// (loaded on demand, cached briefly) and movie/episode entries of plain M3U playlists.
// Also: what to play, resume positions and "Continue watching".
import { resumeKey, touchProfile } from './profiles';
import { isAdult } from '../core/adult';
import { useEffect, useState } from 'preact/hooks';
import { loginFor, xtreamApiUrl, type XtreamLogin } from '../core/xtream';
import {
  GENRE_ROWS, cleanTitle, genreOf, parseTvmazeSchedule, isEnglishCategory, qualityOf, type Quality, isTrendingCategory, normTitle, parseItunesChart,
  episodeUrl, m3uVod, movieUrl, parseCategories, parseMovieInfo, parseMovies, parseSeriesInfo, parseSeriesList,
  type VodCategory, type VodDetails, type VodEpisode, type VodMovie, type VodSeries,
} from '../core/vod';
import { freeRows } from './freelists';
import { openRemote } from './platform';
import { parseVodList } from './importer';
import { continueList, type ResumeEntry, type SeriesRef, type VodGenre } from '../core/vod';
export { continueList, type ResumeEntry, type SeriesRef };
import { getState, repo, setState, subscribe } from './state';
import { serviceRows, watchmodeKey, watchmodeRows, type WmRow, type WmTitle } from './watchmode';
import type { PlaylistSource } from '../core/types';

export interface VodSource {
  playlistId: string;
  name: string;
  login?: XtreamLogin;
  userAgent?: string;
}

export interface VodCat extends VodCategory {
  /** "playlistId:categoryId" */
  key: string;
  playlistId: string;
}

function sources(): VodSource[] {
  return getState().playlists.filter((p) => p.enabled).map((p: PlaylistSource) => ({ playlistId: p.id, name: p.name, login: loginFor(p) ?? undefined, userAgent: p.userAgent }));
}

const mem = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

async function api(src: VodSource, action: string, extra = ''): Promise<unknown> {
  const k = `${src.playlistId}|${action}|${extra}`;
  if (mem.has(k)) return mem.get(k);
  const running = inflight.get(k);
  if (running) return running;
  const job = (async () => {
    const { stream } = await openRemote(xtreamApiUrl(src.login!, action) + extra, AbortSignal.timeout?.(45_000), src.userAgent ? { 'User-Agent': src.userAgent } : undefined);
    const json = JSON.parse(await new Response(stream).text());
    mem.set(k, json);
    if (mem.size > 80) mem.delete(mem.keys().next().value!);
    return json;
  })();
  inflight.set(k, job);
  try {
    return await job;
  } finally {
    inflight.delete(k);
  }
}

/** Whole movie / show lists: parsed in the background worker and kept for the session. */
const allCache = new Map<string, Promise<unknown[]>>();
function allViaWorker<T>(src: VodSource, action: string, kind: 'movies' | 'series'): Promise<T[]> {
  const k = `${src.playlistId}|${action}`;
  let job = allCache.get(k) as Promise<T[]> | undefined;
  if (!job) {
    job = parseVodList<T>(xtreamApiUrl(src.login!, action), src.userAgent ? { 'User-Agent': src.userAgent } : undefined, kind);
    allCache.set(k, job as Promise<unknown[]>);
    job.catch(() => allCache.delete(k));
  }
  return job;
}

const m3uCache = new Map<string, ReturnType<typeof m3uVod>>();
async function m3u(src: VodSource) {
  const hit = m3uCache.get(src.playlistId);
  if (hit) return hit;
  const entries = (await repo.getKv<{ name: string; url: string; logo?: string; group?: string }[]>(`m3uVod:${src.playlistId}`).catch(() => undefined)) ?? [];
  const v = m3uVod(entries);
  m3uCache.set(src.playlistId, v);
  return v;
}

export type VodKind = 'movies' | 'shows';

/** Categories of movies or shows across all playlists (provider order). */
export async function loadCategories(kind: VodKind): Promise<VodCat[]> {
  const out: VodCat[] = [];
  const many = sources().length > 1;
  for (const src of sources()) {
    try {
      const cats = src.login ? parseCategories(await api(src, kind === 'movies' ? 'get_vod_categories' : 'get_series_categories')) : (kind === 'movies' ? (await m3u(src)).categories : (await m3u(src)).seriesCategories);
      for (const c of cats) if (!isAdult(c.name)) out.push({ ...c, key: `${src.playlistId}:${c.id}`, playlistId: src.playlistId, name: many ? `${c.name} · ${src.name}` : c.name });
    } catch {
      /* this playlist has none, or its server didn't answer */
    }
  }
  return out;
}

function srcOf(playlistId: string): VodSource | undefined {
  return sources().find((s) => s.playlistId === playlistId);
}

export async function loadMovies(cat: VodCat): Promise<VodMovie[]> {
  const src = srcOf(cat.playlistId);
  if (!src) return [];
  const list = src.login ? parseMovies(await api(src, 'get_vod_streams', `&category_id=${encodeURIComponent(cat.id)}`)) : (await m3u(src)).movies.filter((m) => m.categoryId === cat.id);
  return list.sort((a, b) => (b.added ?? 0) - (a.added ?? 0));
}

export async function loadSeries(cat: VodCat): Promise<VodSeries[]> {
  const src = srcOf(cat.playlistId);
  if (!src) return [];
  if (src.login) return parseSeriesList(await api(src, 'get_series', `&category_id=${encodeURIComponent(cat.id)}`));
  return (await m3u(src)).series.filter((s) => s.series.categoryId === cat.id).map((s) => s.series);
}

/** A playlist's adult movie / show categories (left out of search and every row). */
async function adultCategoryIds(src: VodSource, kind: VodKind): Promise<Set<string>> {
  try {
    const cats = src.login ? parseCategories(await api(src, kind === 'movies' ? 'get_vod_categories' : 'get_series_categories')) : (kind === 'movies' ? (await m3u(src)).categories : (await m3u(src)).seriesCategories);
    return new Set(cats.filter((c) => isAdult(c.name)).map((c) => String(c.id)));
  } catch {
    return new Set();
  }
}

/** Every movie of a playlist (for searching across categories; big lists, so only on request). */
export async function loadAllMovies(): Promise<(VodMovie & { playlistId: string })[]> {
  const out: (VodMovie & { playlistId: string })[] = [];
  for (const src of sources()) {
    try {
      const list = src.login ? await allViaWorker<VodMovie>(src, 'get_vod_streams', 'movies') : (await m3u(src)).movies;
      const adult = await adultCategoryIds(src, 'movies');
      for (const m of list) if (!adult.has(String(m.categoryId)) && !isAdult(m.name)) out.push({ ...m, playlistId: src.playlistId });
    } catch {
      /* skip */
    }
  }
  return out;
}

export async function loadAllSeries(): Promise<(VodSeries & { playlistId: string })[]> {
  const out: (VodSeries & { playlistId: string })[] = [];
  for (const src of sources()) {
    try {
      const list = src.login ? await allViaWorker<VodSeries>(src, 'get_series', 'series') : (await m3u(src)).series.map((s) => s.series);
      const adult = await adultCategoryIds(src, 'shows');
      for (const s of list) if (!adult.has(String(s.categoryId)) && !isAdult(s.name)) out.push({ ...s, playlistId: src.playlistId });
    } catch {
      /* skip */
    }
  }
  return out;
}

export async function loadMovieDetails(playlistId: string, m: VodMovie): Promise<VodDetails> {
  const src = srcOf(playlistId);
  if (!src?.login || m.url) return {};
  try {
    return parseMovieInfo(await api(src, 'get_vod_info', `&vod_id=${encodeURIComponent(m.id)}`));
  } catch {
    return {};
  }
}

export async function loadSeriesDetails(playlistId: string, s: VodSeries): Promise<ReturnType<typeof parseSeriesInfo>> {
  const src = srcOf(playlistId);
  if (src && !src.login) {
    const found = (await m3u(src)).series.find((x) => x.series.id === s.id);
    const bySeason = new Map<number, VodEpisode[]>();
    for (const e of found?.episodes ?? []) bySeason.set(e.season, [...(bySeason.get(e.season) ?? []), e]);
    return { details: {}, seasons: [...bySeason.entries()].sort((a, b) => a[0] - b[0]).map(([season, episodes]) => ({ season, episodes: episodes.sort((a, b) => a.episode - b.episode) })) };
  }
  if (!src?.login) return { details: {}, seasons: [] };
  return parseSeriesInfo(await api(src, 'get_series_info', `&series_id=${encodeURIComponent(s.id)}`));
}

// ---- Which screens to show ----

/** Look (quietly) whether any playlist has movies / shows, so the menu only offers what exists. */
export async function detectVod(): Promise<void> {
  let movies = false;
  let shows = false;
  for (const src of sources()) {
    try {
      if (src.login) {
        if (!movies) movies = parseCategories(await api(src, 'get_vod_categories')).length > 0;
        if (!shows) shows = parseCategories(await api(src, 'get_series_categories')).length > 0;
      } else {
        const v = await m3u(src);
        movies ||= v.movies.length > 0;
        shows ||= v.series.length > 0;
      }
    } catch {
      /* not available from this playlist */
    }
  }
  setState({ vodAvail: { movies, shows } });
}

/** Forget cached lists (after playlists change). */
/** Rebuild the Movies / Shows home pages next time (e.g. a Watchmode key was added). */
export function resetVodHome() {
  homeCache.clear();
}

export function resetVod() {
  mem.clear();
  allCache.clear();
  m3uCache.clear();
  homeCache.clear();
  void detectVod();
}

/** Detect at startup and again whenever a playlist is added, removed, switched or re-imported. */
export function startVodDetection() {
  const sig = () => getState().playlists.map((p) => `${p.id}:${p.enabled ? 1 : 0}:${p.lastImportAt ?? 0}`).join('|');
  let last = sig();
  resetVod();
  subscribe(() => {
    const now = sig();
    if (now === last) return;
    last = now;
    resetVod();
  });
}

// ---- Playing, resume, continue watching ----

export interface VodPlay {
  key: string;
  title: string;
  subtitle?: string;
  poster?: string;
  url: string;
  headers?: Record<string, string>;
  startSec?: number;
  playlistId: string;
  /** For an episode: its show (Continue watching shows one card per show). */
  series?: SeriesRef;
  /** Following episodes (played automatically when one ends). */
  queue?: VodPlay[];
  /** Small label over the title in the player ("MOVIES · ACTION"). */
  kicker?: string;
  /** The line under the title ("2026 · 2h 25m · Science Fiction · PG-13"). */
  meta?: string;
}



/** Continue watching belongs to the profile watching (profiles.ts). */
let resume: Record<string, ResumeEntry> | null = null;
/** Another device's progress for this profile arrived: read it again. */
export function resetResumeCache() {
  resume = null;
  resumeListeners.forEach((l) => l());
}
const resumeListeners = new Set<() => void>();

async function resumeStore(): Promise<Record<string, ResumeEntry>> {
  if (!resume) resume = (await repo.getKv<Record<string, ResumeEntry>>(resumeKey()).catch(() => undefined)) ?? {};
  return resume;
}

export async function resumePosition(key: string): Promise<ResumeEntry | undefined> {
  return (await resumeStore())[key];
}

const titleKey = (n: string) => normTitle(cleanTitle(n));

/**
 * Where you left off in a movie — also when it was watched on another provider (or another copy):
 * matched by the movie's title and year, so switching providers keeps your progress.
 */
export async function movieResume(playlistId: string, m: VodMovie): Promise<ResumeEntry | undefined> {
  const store = await resumeStore();
  const exact = store[`m:${playlistId}:${m.id}`];
  if (exact) return exact;
  const want = titleKey(m.name);
  return Object.values(store)
    .filter((e) => e.key.startsWith('m:') && !e.done && titleKey(e.title) === want && (!m.year || !e.subtitle || e.subtitle === m.year))
    .sort((a, b) => b.at - a.at)[0];
}

/** Progress entries for a show on any provider (matched by the show's name). */
export function showEntries(all: ResumeEntry[], name: string): ResumeEntry[] {
  const want = titleKey(name);
  return all.filter((e) => (e.series ? titleKey(e.series.name) === want : e.key.startsWith('e:') && titleKey(e.title) === want));
}

/** Is this provider still in your sources? (Continue-watching entries from a provider you replaced aren't.) */
export function providerPresent(playlistId: string): boolean {
  return getState().playlists.some((p) => p.id === playlistId);
}

/** A movie on your current providers by title (and year), for progress saved on a provider you no longer have. */
export async function findMovieByName(title: string, year?: string): Promise<(VodMovie & { playlistId: string }) | undefined> {
  const want = titleKey(title);
  const list = await loadAllMovies().catch(() => []);
  const same = list.filter((m) => titleKey(m.name) === want && (!year || !m.year || m.year === year));
  return same.sort((a, b) => qualityOf(b.name).rank - qualityOf(a.name).rank)[0];
}

export async function saveProgress(e: Omit<ResumeEntry, 'at'>) {
  const store = await resumeStore();
  const done = e.dur > 0 && e.pos / e.dur > 0.93;
  if (e.series) {
    // Shows: remember the last episode watched, also when finished (then the next one is offered).
    if (e.pos < 20 && !done && !store[e.key]) return;
    store[e.key] = { ...e, done: done || undefined, at: Date.now() };
  } else if (done || e.pos < 20) delete store[e.key];
  else store[e.key] = { ...e, at: Date.now() };
  const keys = Object.keys(store).sort((a, b) => store[b].at - store[a].at);
  for (const k of keys.slice(150)) delete store[k];
  await repo.setKv(resumeKey(), store).catch(() => undefined);
  void touchProfile().catch(() => undefined);
  resumeListeners.forEach((l) => l());
}

/** The episode to select on a show's page: the last one watched, or the next one if it was finished. */
export function lastWatched(all: ResumeEntry[], playlistId: string, seriesId: string): ResumeEntry | undefined {
  return [...all].filter((e) => e.series?.id === seriesId && e.playlistId === playlistId).sort((a, b) => b.at - a.at)[0];
}

export function useContinueWatching(): ResumeEntry[] {
  const [list, setList] = useState<ResumeEntry[]>([]);
  useEffect(() => {
    const load = () => void resumeStore().then((s) => setList(Object.values(s).sort((a, b) => b.at - a.at)));
    load();
    resumeListeners.add(load);
    return () => {
      resumeListeners.delete(load);
    };
  }, []);
  return list;
}

function headersFor(playlistId: string): Record<string, string> | undefined {
  const ua = getState().playlists.find((p) => p.id === playlistId)?.userAgent;
  return ua ? { 'User-Agent': ua } : undefined;
}

export function moviePlay(playlistId: string, m: VodMovie, startSec?: number): VodPlay | null {
  const src = srcOf(playlistId);
  if (!src) return null;
  if (!src.login && !m.url) return null;
  return { key: `m:${playlistId}:${m.id}`, title: m.name, subtitle: m.year, poster: m.poster, url: m.url ?? movieUrl(src.login!, m), headers: headersFor(playlistId), startSec, playlistId };
}

/** An episode's own name without the show name and "S01E02" ('' when that's all it has). */
export function episodeName(show: string, e: VodEpisode): string {
  return e.title.replace(show, '').replace(/\bS\d{1,2}\s*E\d{1,3}\b/i, '').replace(/^[\s·:|-]+|[\s·:|-]+$/g, '').trim();
}

export function episodePlay(playlistId: string, s: VodSeries, e: VodEpisode, startSec?: number): VodPlay | null {
  const src = srcOf(playlistId);
  if (!src) return null;
  if (!src.login && !e.url) return null;
  return {
    key: `e:${playlistId}:${e.id}`, title: s.name, subtitle: `S${e.season} E${e.episode}${episodeName(s.name, e) ? ' · ' + episodeName(s.name, e) : ''}`, poster: s.poster ?? e.image,
    url: e.url ?? episodeUrl(src.login!, e), headers: headersFor(playlistId), startSec, playlistId,
    series: { id: s.id, name: s.name, poster: s.poster, season: e.season, episode: e.episode, episodeId: e.id, year: s.year },
  };
}

/** Play again from "Continue watching". */
export function resumePlay(e: ResumeEntry, fromStart = false): VodPlay {
  return { key: e.key, title: e.title, subtitle: e.subtitle, poster: e.poster, url: e.url, headers: headersFor(e.playlistId), startSec: fromStart ? 0 : Math.max(0, e.pos - 5), playlistId: e.playlistId, series: e.series };
}

/** Start playing a movie / episode full screen. */
export function playVod(v: VodPlay) {
  setState({ vodPlaying: v });
}

// ---- Home page rows ----

export type VodItem = { kind: 'movie'; playlistId: string; m: VodMovie } | { kind: 'series'; playlistId: string; s: VodSeries };

export interface VodRow {
  id: string;
  title: string;
  items: VodItem[];
  /** Where the row comes from, shown small next to the title. */
  note?: string;
}

export interface VodHome {
  rows: VodRow[];
  /** English categories to browse, then the others. */
  categories: VodCat[];
  otherLanguages: VodCat[];
  loading: boolean;
}

export const itemName = (it: VodItem) => (it.kind === 'movie' ? it.m.name : it.s.name);
const itemId = (it: VodItem) => `${it.playlistId}:${it.kind === 'movie' ? it.m.id : it.s.id}`;
const itemAdded = (it: VodItem) => (it.kind === 'movie' ? it.m.added : it.s.added) ?? 0;
const itemRating = (it: VodItem) => (it.kind === 'movie' ? it.m.rating : it.s.rating) ?? 0;

const ROW_MAX = 30;
const MAX_CATS = 40;

const homeCache = new Map<VodKind, VodHome>();

/** Apple's US genre charts for movies (the trusted source for the genre rows). */
const MOVIE_CHART_GENRES: { id: VodGenre; label: string; genre: number }[] = [
  { id: 'action', label: 'Action & Adventure', genre: 4401 },
  { id: 'comedy', label: 'Comedies', genre: 4404 },
  { id: 'drama', label: 'Dramas', genre: 4406 },
  { id: 'thriller', label: 'Thrillers', genre: 4416 },
  { id: 'horror', label: 'Horror', genre: 4408 },
  { id: 'scifi', label: 'Sci-Fi & Fantasy', genre: 4413 },
  { id: 'family', label: 'Kids & Family', genre: 4410 },
  { id: 'romance', label: 'Romance', genre: 4412 },
  { id: 'documentary', label: 'Documentaries', genre: 4405 },
];

/** Apple's public US charts of what people are watching (titles only), to find those in your provider's list. */
async function chartTitles(kind: VodKind, genre?: number): Promise<string[]> {
  const k = `chart|${kind}|${genre ?? ''}`;
  if (mem.has(k)) return mem.get(k) as string[];
  try {
    const g = genre ? `/genre=${genre}` : '';
    let base = 'https://itunes.apple.com';
    try {
      base = localStorage.getItem('lttvItunesBase') || base;
    } catch {
      /* default */
    }
    const url = kind === 'movies' ? `${base}/us/rss/topmovies/limit=100${g}/json` : `${base}/us/rss/toptvseasons/limit=100/json`;
    const { stream } = await openRemote(url, AbortSignal.timeout?.(15_000));
    // TV charts list seasons ("The Bear, Season 3"): the show is what matters.
    const titles = [...new Set(parseItunesChart(JSON.parse(await new Response(stream).text())).map((t) => t.replace(/,?\s*(season|series|vol\.?|volume)\s*\d+.*$/i, '').trim()))];
    mem.set(k, titles);
    return titles;
  } catch {
    return [];
  }
}

/** Shows that aired a new episode in the last 5 days in the US (network TV and streaming), newest first. */
async function newEpisodeTitles(): Promise<string[]> {
  if (mem.has('fresh')) return mem.get('fresh') as string[];
  const base = (() => {
    try {
      return localStorage.getItem('lttvTvmazeBase') || 'https://api.tvmaze.com';
    } catch {
      return 'https://api.tvmaze.com';
    }
  })();
  const out: string[] = [];
  for (let d = 0; d < 5; d++) {
    const day = new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10);
    for (const path of [`/schedule/web?date=${day}&country=US`, `/schedule?country=US&date=${day}`]) {
      try {
        const { stream } = await openRemote(base + path, AbortSignal.timeout?.(15_000));
        for (const n of parseTvmazeSchedule(JSON.parse(await new Response(stream).text()))) if (!out.includes(n)) out.push(n);
      } catch {
        /* skip that day */
      }
    }
  }
  mem.set('fresh', out);
  return out;
}

async function catItems(kind: VodKind, cat: VodCat): Promise<VodItem[]> {
  return kind === 'movies'
    ? (await loadMovies(cat)).map((m): VodItem => ({ kind: 'movie', playlistId: cat.playlistId, m }))
    : (await loadSeries(cat)).map((s): VodItem => ({ kind: 'series', playlistId: cat.playlistId, s }));
}

/** Which copy of a title to show: the English one first, then the best quality (1080p first). */
function preference(it: VodItem): number {
  const n = itemName(it);
  return (isEnglishCategory(n) ? 20 : 0) + (/\b(multi|dub(bed)?|vost|vostfr|subbed|latino)\b/i.test(n) ? 0 : 5) + qualityOf(n).rank;
}

/** One card per title: copies of the same movie / show (4K, FHD, other languages) collapse into the preferred one. */
export function dedupe(list: VodItem[]): VodItem[] {
  const at = new Map<string, number>();
  const out: VodItem[] = [];
  for (const it of list) {
    const k = normTitle(cleanTitle(itemName(it))) || itemId(it);
    const i = at.get(k);
    if (i === undefined) {
      at.set(k, out.length);
      out.push(it);
    } else if (preference(it) > preference(out[i])) out[i] = it;
  }
  return out;
}

/** A show by its name (for Continue watching entries saved by older versions). */
export async function findSeriesByName(playlistId: string, name: string): Promise<VodSeries | undefined> {
  const want = normTitle(cleanTitle(name));
  const list = await loadAllSeries().catch(() => []);
  const same = list.filter((x) => normTitle(cleanTitle(x.name)) === want);
  return (same.find((x) => x.playlistId === playlistId) ?? same[0]);
}

/**
 * The Movies / Shows home page: Trending now, Recently added, Top rated and English genre rows
 * (Action, Comedy, Netflix…) from the provider's English categories. Calls onUpdate as rows fill in.
 */
/** Saved Movies / Shows pages: shown right away next time, and rebuilt quietly when older than 6 hours. */
const SAVED_TTL = 6 * 3600_000;
/** Tags that mark a copy in another language (dubbed or subtitled). */
const FOREIGN_TAG = /\b(vostfr|vost|vf|vff|truefrench|french|latino|castellano|español|espanol|dublado|legendado|deutsch|german|ita|italiano|türkçe|turkce|arabic|hindi|dubbed)\b/i;
const savedKey = (kind: VodKind) => `vodHome5:${kind}:${sources().map((x) => x.playlistId).sort().join(',')}`;

export async function loadHome(kind: VodKind, onUpdate: (h: VodHome) => void): Promise<VodHome> {
  const hit = homeCache.get(kind);
  if (hit && !hit.loading) {
    onUpdate(hit);
    return hit;
  }
  const saved = await repo.getKv<{ at: number; home: VodHome }>(savedKey(kind)).catch(() => undefined);
  if (saved?.home?.rows?.length) {
    const home = { ...saved.home, loading: false };
    homeCache.set(kind, home);
    onUpdate(home);
    if (Date.now() - saved.at < SAVED_TTL) return home;
    // Old: build a fresh one in the background and swap it in once it's complete (no half-built page).
    void buildHome(kind, () => undefined).then((h) => h.rows.length && onUpdate(h)).catch(() => undefined);
    return home;
  }
  return buildHome(kind, onUpdate);
}

async function buildHome(kind: VodKind, onUpdate: (h: VodHome) => void): Promise<VodHome> {
  const cats = await loadCategories(kind);
  const english = cats.filter((c) => isEnglishCategory(c.name));
  const otherLanguages = cats.filter((c) => !isEnglishCategory(c.name));
  if (watchmodeKey()) {
    try {
      return await loadWatchmodeHome(kind, english, onUpdate);
    } catch (e) {
      console.warn('Watchmode rows unavailable, using charts:', (e as Error).message);
    }
  }
  // No Watchmode key: the same kind of rows from free US lists (Apple's charts, TVmaze's US schedule), so only
  // titles popular in the US show up — not whatever the provider files under "new" or "top".
  try {
    return await loadWatchmodeHome(kind, english, onUpdate, (onRow) => freeRows(kind, onRow));
  } catch (e) {
    console.warn('Free US lists unavailable, using the provider\'s categories:', (e as Error).message);
  }
  // Which categories feed which row; trending and genre lists first, then the rest (for Recently added / Top rated).
  const trendingCats = english.filter((c) => isTrendingCategory(c.name));
  const genreCats = english.filter((c) => !isTrendingCategory(c.name) && genreOf(c.name));
  const rest = english.filter((c) => !isTrendingCategory(c.name) && !genreOf(c.name));
  const order = [...trendingCats, ...genreCats, ...rest].slice(0, MAX_CATS);
  const loaded = new Map<string, VodItem[]>();
  let chart: string[] = [];
  const genreCharts = new Map<VodGenre, string[]>();

  const build = (loading: boolean): VodHome => {
    const all = dedupe([...loaded.values()].flat());
    const rows: VodRow[] = [];
    // Rows come from trusted US charts (Apple's top movies / TV in the US, TVmaze's US schedule),
    // showing the titles your provider has — not from the provider's own (often foreign) category names.
    const byTitle = new Map<string, VodItem>();
    for (const it of all) {
      const k = normTitle(cleanTitle(itemName(it)));
      if (!byTitle.has(k)) byTitle.set(k, it);
    }
    const fromChart = (titles: string[]) => dedupe(titles.map((t) => byTitle.get(normTitle(cleanTitle(t)))).filter((x): x is VodItem => !!x)).slice(0, ROW_MAX);
    const tr = fromChart(chart);
    if (tr.length) rows.push({ id: 'trending', title: kind === 'movies' ? 'Top Movies in the US' : 'Top Shows in the US', items: tr });
    // Shows with a new episode on TV or streaming this week (TVmaze schedule) that your provider has.
    if (kind === 'shows' && fresh.length) {
      const byTitle = new Map(all.map((it) => [normTitle(cleanTitle(itemName(it))), it]));
      const items = dedupe(fresh.map((t) => byTitle.get(normTitle(t))).filter((x): x is VodItem => !!x)).slice(0, ROW_MAX);
      if (items.length) rows.push({ id: 'new-episodes', title: 'New Episodes', items });
    }
    const recent = dedupe([...all].filter((it) => itemAdded(it) > 0).sort((a, b) => itemAdded(b) - itemAdded(a))).slice(0, ROW_MAX);
    if (recent.length) rows.push({ id: 'recent', title: 'Recently Added', items: recent });
    const top = dedupe(all.filter((it) => itemRating(it) >= 7).sort((a, b) => itemRating(b) - itemRating(a) || itemAdded(b) - itemAdded(a))).slice(0, ROW_MAX);
    if (top.length) rows.push({ id: 'top', title: 'Critically Acclaimed', items: top });
    if (kind === 'movies') {
      // Genre rows: Apple's US genre charts (what's popular in that genre), titles your provider has.
      for (const g of MOVIE_CHART_GENRES) {
        // Chart order first, then the rest of your provider's English category for that genre.
        const extra = genreCats.filter((c) => genreOf(c.name) === g.id).flatMap((c) => loaded.get(c.key) ?? []);
        const items = dedupe([...fromChart(genreCharts.get(g.id) ?? []), ...extra]).slice(0, ROW_MAX);
        if (items.length) rows.push({ id: `genre:${g.id}`, title: g.label, items });
      }
    } else {
      // Shows: the US streaming services' and genre categories of your provider (English only).
      for (const g of GENRE_ROWS) {
        const items = dedupe(genreCats.filter((c) => genreOf(c.name) === g.id).flatMap((c) => loaded.get(c.key) ?? [])).slice(0, ROW_MAX);
        if (items.length) rows.push({ id: `genre:${g.id}`, title: g.label, items });
      }
    }
    return { rows, categories: english, otherLanguages, loading };
  };

  void chartTitles(kind).then((t) => {
    chart = t;
    if (loaded.size) onUpdate(build(loaded.size < order.length));
  });
  if (kind === 'movies') {
    void (async () => {
      for (const g of MOVIE_CHART_GENRES) {
        genreCharts.set(g.id, await chartTitles('movies', g.genre));
        if (loaded.size) onUpdate(build(loaded.size < order.length));
      }
    })();
  }
  let fresh: string[] = [];
  if (kind === 'shows') void newEpisodeTitles().then((t) => {
    fresh = t;
    if (loaded.size) onUpdate(build(loaded.size < order.length));
  });
  let next = 0;
  let lastEmit = 0;
  const worker = async () => {
    while (next < order.length) {
      const c = order[next++];
      try {
        loaded.set(c.key, await catItems(kind, c));
      } catch {
        loaded.set(c.key, []);
      }
      if (Date.now() - lastEmit > 700) {
        lastEmit = Date.now();
        onUpdate(build(true));
      }
    }
  };
  onUpdate(build(true));
  await Promise.all([worker(), worker(), worker()]);
  const done = build(false);
  homeCache.set(kind, done);
  if (done.rows.length) void repo.setKv(savedKey(kind), { at: Date.now(), home: done }).catch(() => undefined);
  onUpdate(done);
  return done;
}

/**
 * Home rows from Watchmode (Settings → Movies & Shows key): US, English-language lists — Popular, New,
 * Popular on Netflix / Hulu / Max…, then genres — showing the titles your provider has (best copy:
 * English, 1080p first). Rows with fewer than 4 of your titles are left out.
 */
async function loadWatchmodeHome(kind: VodKind, english: VodCat[], onUpdate: (h: VodHome) => void, source: (onRow: (rows: WmRow[]) => void) => Promise<WmRow[]> = (onRow) => watchmodeRows(kind, onRow)): Promise<VodHome> {
  const { match, lib } = await libraryMatcher(kind, english);
  const build = (wm: WmRow[], loading: boolean): VodHome => {
    const rows: VodRow[] = [];
    // Cards show the US English title from the list ("The Office"), not the provider's label ("EN| The Office (US) 4K").
    const usName = (it: VodItem, title: string): VodItem => (it.kind === 'movie' ? { ...it, m: { ...it.m, name: title } } : { ...it, s: { ...it.s, name: title } });
    for (const r of wm) {
      const items = dedupe(r.titles.map((t) => { const it = match(t); return it && usName(it, t.title); }).filter((x): x is VodItem => !!x)).slice(0, ROW_MAX);
      if (items.length >= (r.id === "popular" ? 1 : 4)) rows.push({ id: r.id, title: r.title, items });
    }
    // Lists only find the titles your provider has; Shows (and a thin Movies page) are filled out with
    // rows from your provider's own library: recently added, best rated, each genre and each service.
    // Only titles the US lists know (the US English shows / movies), like before — not every copy your provider has.
    if (!loading && (kind === 'shows' || rows.length < 10)) {
      const us = new Map(wm.flatMap((r) => r.titles.map((t) => [normTitle(cleanTitle(t.title)), t.title] as const)));
      const usLib = lib.flatMap((it) => { const t = us.get(normTitle(cleanTitle(itemName(it)))); return t ? [usName(it, t)] : []; });
      rows.push(...libraryRows(kind, usLib, english, rows));
    }
    return { rows, categories: english, otherLanguages: [], loading };
  };
  // While lists arrive, the page is updated at most about once a second.
  let lastEmit = 0;
  const wm = await source((partial) => {
    if (Date.now() - lastEmit < 1000) return;
    lastEmit = Date.now();
    onUpdate(build(partial, true));
  });
  if (!wm.length) throw new Error('no lists');
  const done = build(wm, false);
  homeCache.set(kind, done);
  if (done.rows.length) void repo.setKv(savedKey(kind), { at: Date.now(), home: done }).catch(() => undefined);
  onUpdate(done);
  return done;
}

/** Matches titles from a US list (Watchmode, charts) to your provider's English copies. */
/** Rows from your provider's own English library, for titles the US lists didn't cover. */
function libraryRows(kind: VodKind, lib: VodItem[], english: VodCat[], have: VodRow[]): VodRow[] {
  const out: VodRow[] = [];
  const titles = new Set(have.map((r) => r.title.toLowerCase()));
  const used = new Set<string>();
  const add = (id: string, title: string, list: VodItem[], min = 6) => {
    if (titles.has(title.toLowerCase())) return;
    // Prefer titles not already shown in another row, so rows don't repeat the same posters.
    const all = dedupe(list);
    const items = [...all.filter((it) => !used.has(itemId(it))), ...all.filter((it) => used.has(itemId(it)))].slice(0, ROW_MAX);
    if (items.length < min) return;
    items.slice(0, 12).forEach((it) => used.add(itemId(it)));
    titles.add(title.toLowerCase());
    out.push({ id, title, items });
  };
  const year = new Date().getFullYear();
  const yearOf = (it: VodItem) => Number(it.kind === 'movie' ? it.m.year : it.s.year) || 0;
  add('lib:recent', 'Recently Added', [...lib].filter((it) => itemAdded(it) > 0).sort((a, b) => itemAdded(b) - itemAdded(a)));
  add('lib:top', 'Critically Acclaimed', lib.filter((it) => itemRating(it) >= 7.5).sort((a, b) => itemRating(b) - itemRating(a) || itemAdded(b) - itemAdded(a)));
  add('lib:new', kind === 'movies' ? 'New This Year' : 'New Seasons', lib.filter((it) => yearOf(it) >= year - 1).sort((a, b) => itemRating(b) - itemRating(a) || itemAdded(b) - itemAdded(a)));
  const catName = new Map(english.map((c) => [c.key, c.name]));
  const genreText = (it: VodItem) => `${(it.kind === 'movie' ? it.m.categoryId : it.s.categoryId) ? catName.get(`${it.playlistId}:${it.kind === 'movie' ? it.m.categoryId : it.s.categoryId}`) ?? '' : ''} ${(it.kind === 'series' ? it.s.genre : (it.m as { genre?: string }).genre) ?? ''}`;
  const byRating = (a: VodItem, b: VodItem) => itemRating(b) - itemRating(a) || itemAdded(b) - itemAdded(a);
  // Services first (Netflix, Hulu…), then genres.
  const services = GENRE_ROWS.filter((g) => ['netflix', 'hulu', 'disney', 'hbo', 'prime', 'apple', 'paramount', 'peacock'].includes(g.id));
  const genres = GENRE_ROWS.filter((g) => !services.includes(g));
  for (const g of services) add(`lib:svc:${g.id}`, `Popular on ${g.label}`, lib.filter((it) => g.re.test(genreText(it))).sort(byRating));
  for (const g of genres) add(`lib:genre:${g.id}`, g.label, lib.filter((it) => g.re.test(genreText(it))).sort(byRating));
  add('lib:classic', kind === 'movies' ? 'Classics' : 'Classic TV', lib.filter((it) => yearOf(it) > 1900 && yearOf(it) < 2000).sort(byRating));
  add('lib:binge', kind === 'movies' ? 'More to Watch' : 'Binge-Worthy', lib.filter((it) => itemRating(it) >= 6.5 && yearOf(it) >= 2005).sort(byRating), 10);
  return out;
}

async function libraryMatcher(kind: VodKind, english: VodCat[]): Promise<{ match: (t: WmTitle) => VodItem | undefined; lib: VodItem[] }> {
  // English copies only: titles from the provider's English categories, without a foreign language tag
  // ("FR - The Bear", "The Bear (VOSTFR)"), so a French or Spanish copy never stands in for the show.
  const englishCats = new Set(english.map((c) => c.key));
  const isEnglish = (it: VodItem) => {
    const cat = it.kind === 'movie' ? it.m.categoryId : it.s.categoryId;
    const n = itemName(it);
    return (!cat || englishCats.has(`${it.playlistId}:${cat}`)) && isEnglishCategory(n) && !FOREIGN_TAG.test(n);
  };
  const lib: VodItem[] = (kind === 'movies'
    ? (await loadAllMovies()).map((m): VodItem => ({ kind: 'movie', playlistId: m.playlistId, m }))
    : (await loadAllSeries()).map((x): VodItem => ({ kind: 'series', playlistId: x.playlistId, s: x }))).filter(isEnglish);
  const byTitle = new Map<string, VodItem[]>();
  for (const it of lib) {
    // tk: worked out by the background worker while it read the list (falls back for M3U libraries).
    const k = (it.kind === 'movie' ? (it.m as { tk?: string }).tk : (it.s as { tk?: string }).tk) ?? normTitle(cleanTitle(itemName(it)));
    if (!k) continue;
    const l = byTitle.get(k);
    if (l) l.push(it);
    else byTitle.set(k, [it]);
  }
  const yearOf = (it: VodItem) => Number(it.kind === 'movie' ? it.m.year : it.s.year) || Number(/\((\d{4})\)/.exec(itemName(it))?.[1]) || 0;
  const keyOf = new Map<string, string>();
  const match = (t: WmTitle): VodItem | undefined => {
    let k = keyOf.get(t.title);
    if (k === undefined) keyOf.set(t.title, (k = normTitle(cleanTitle(t.title))));
    const cands = byTitle.get(k);
    if (!cands) return undefined;
    const ok = cands.filter((c) => !t.year || !yearOf(c) || Math.abs(yearOf(c) - t.year) <= 1);
    return dedupe(ok)[0];
  };
  return { match, lib };
}

// ---- Streaming services (Movies & Shows: "pick a service") ----

export interface StreamingService {
  id: string;
  label: string;
  /** Tile colors (no logos: the name is written on the tile). */
  bg: string;
  fg: string;
  /** Your provider's categories for this service ("NETFLIX MOVIES", "EN | Disney+ Series"…). */
  cat: RegExp;
  /** The service's page: its colors and the card shape its app uses (tall posters or wide tiles). */
  page: { top: string; bottom: string; accent: string; cards: 'poster' | 'wide'; nav: 'rail' | 'top' | 'center'; hero: 'billboard' | 'carousel' };
}

export const STREAMING_SERVICES: StreamingService[] = [
  { id: 'Netflix', label: 'Netflix', bg: '#1a0a0b', fg: '#ff3b47', cat: /netflix/i, page: { top: '#141414', bottom: '#0b0b0b', accent: '#e50914', cards: 'wide', nav: 'rail', hero: 'billboard' } },
  { id: 'Prime Video', label: 'Prime Video', bg: '#0b1a2a', fg: '#4fb6ff', cat: /\b(amazon|prime)\b/i, page: { top: '#0f171e', bottom: '#0a1016', accent: '#1a98ff', cards: 'wide', nav: 'top', hero: 'carousel' } },
  { id: 'Disney+', label: 'Disney+', bg: '#0b1440', fg: '#9fc3ff', cat: /disney/i, page: { top: '#1a1d3a', bottom: '#090b1c', accent: '#3f8cff', cards: 'wide', nav: 'rail', hero: 'carousel' } },
  { id: 'Hulu', label: 'Hulu', bg: '#0b2215', fg: '#3ee07f', cat: /\bhulu\b/i, page: { top: '#101418', bottom: '#07090b', accent: '#1ce783', cards: 'wide', nav: 'top', hero: 'billboard' } },
  { id: 'HBO Max', label: 'HBO Max', bg: '#120d3a', fg: '#b2a4ff', cat: /\b(hbo|max)\b/i, page: { top: '#1b1347', bottom: '#07051a', accent: '#8b6bff', cards: 'wide', nav: 'top', hero: 'billboard' } },
  { id: 'Apple TV', label: 'Apple TV', bg: '#1b1b1f', fg: '#f2f2f2', cat: /\bapple\b/i, page: { top: '#1c1c1e', bottom: '#000000', accent: '#ffffff', cards: 'wide', nav: 'center', hero: 'billboard' } },
  { id: 'Paramount+', label: 'Paramount+', bg: '#0a1838', fg: '#5aa0ff', cat: /paramount/i, page: { top: '#0a2470', bottom: '#020a24', accent: '#0064ff', cards: 'poster', nav: 'top', hero: 'carousel' } },
  { id: 'Peacock', label: 'Peacock', bg: '#1c1406', fg: '#ffc94d', cat: /peacock/i, page: { top: '#141414', bottom: '#000000', accent: '#f5c518', cards: 'wide', nav: 'rail', hero: 'billboard' } },
];

/**
 * Everything on one streaming service that your provider has: the service's own categories in your provider,
 * plus (with a Watchmode key) what's popular on that service in the US, matched to your provider's copies.
 */
export async function loadServiceItems(kind: VodKind, id: string): Promise<VodItem[]> {
  const svc = STREAMING_SERVICES.find((x) => x.id === id);
  if (!svc) return [];
  const cats = await loadCategories(kind);
  const english = cats.filter((c) => isEnglishCategory(c.name));
  const out: VodItem[] = [];
  if (watchmodeKey()) {
    try {
      const rows = await watchmodeRows(kind);
      const row = rows.find((r) => r.id === `svc:${svc.id}`);
      if (row) {
        const { match } = await libraryMatcher(kind, english);
        out.push(...row.titles.map(match).filter((x): x is VodItem => !!x));
      }
    } catch (e) {
      console.warn('Watchmode list for', svc.id, 'unavailable:', (e as Error).message);
    }
  }
  const own = english.filter((c) => svc.cat.test(c.name)).slice(0, 12);
  const lists = await Promise.all(own.map((c) => catItems(kind, c).catch(() => [] as VodItem[])));
  for (const l of lists) out.push(...l);
  return dedupe(out);
}

/** A title on a streaming service (from Watchmode), and your provider's copy of it when it has one. */
export interface SvcItem {
  title: string;
  year?: number;
  kind: 'movie' | 'show';
  tmdb?: number;
  /** Your provider's copy: plays from here. Without it the title is shown but isn't playable. */
  match?: VodItem;
}
export interface ServiceRowOut {
  id: string;
  title: string;
  items: SvcItem[];
  ranked?: boolean;
}
export interface ServiceHome {
  rows: ServiceRowOut[];
  loading: boolean;
  /** Movies & Shows (all in one): your provider's categories, for "Browse". */
  categories?: { kind: VodKind; cat: VodCat }[];
  /** No Watchmode key: rows come from your provider's categories for this service only. */
  noKey: boolean;
}

const SVC_ROW_MAX = 40;
const fromVod = (it: VodItem): SvcItem => ({ title: cleanTitle(itemName(it)) || itemName(it), year: Number(it.kind === 'movie' ? it.m.year : it.s.year) || undefined, kind: it.kind === 'movie' ? 'movie' : 'show', match: it });

/**
 * A streaming service's home (Movies & Shows → Hulu…): everything Watchmode lists on that service in the US —
 * Top 10, Popular, New and genres — each title marked with your provider's copy when it has one (so it plays).
 * Without a Watchmode key, your provider's own categories for the service are shown instead.
 */
/** Movies & Shows' one home: everything, from every service (Netflix-style). */
export const ALL_SERVICES: StreamingService = {
  id: 'all', label: 'Movies & Shows', bg: '#141414', fg: '#e50914', cat: /$^/,
  page: { top: '#141414', bottom: '#0b0b0b', accent: '#e50914', cards: 'wide', nav: 'top', hero: 'billboard' },
};

export async function loadServiceHome(id: string, onUpdate: (h: ServiceHome) => void): Promise<ServiceHome> {
  const svc = id === 'all' ? ALL_SERVICES : STREAMING_SERVICES.find((x) => x.id === id);
  if (!svc) return { rows: [], loading: false, noKey: !watchmodeKey() };
  const noKey = !watchmodeKey();
  const [mCats, sCats] = await Promise.all([loadCategories('movies').catch(() => [] as VodCat[]), loadCategories('shows').catch(() => [] as VodCat[])]);
  const mEng = mCats.filter((c) => isEnglishCategory(c.name));
  const sEng = sCats.filter((c) => isEnglishCategory(c.name));
  if (id === 'all') {
    // Movies & Shows, all in one: your provider's movies and shows like before (US charts / Watchmode lists matched
    // to your provider, Recently Added, genres…), shows and movies together, filling in as each loads.
    let sh: VodHome | null = null;
    let m: VodHome | null = null;
    const build = (loading: boolean): ServiceHome => {
      const rows: ServiceRowOut[] = [];
      const tag = (h: VodHome | null, kind: string) => (h?.rows ?? []).map((r) => {
        const ranked = r.id === 'trending' || r.id === 'popular';
        return { id: `${kind}:${r.id}`, title: r.title, items: r.items.slice(0, ranked ? 10 : SVC_ROW_MAX).map(fromVod), ranked: ranked || undefined };
      });
      const s1 = tag(sh, 'shows');
      const m1 = tag(m, 'movies');
      // Top 10s first, then shows and movies rows taking turns.
      rows.push(...s1.filter((r) => r.ranked), ...m1.filter((r) => r.ranked));
      const rs = s1.filter((r) => !r.ranked);
      const rm = m1.filter((r) => !r.ranked);
      for (let i = 0; i < Math.max(rs.length, rm.length); i++) {
        if (rs[i]) rows.push(rs[i]);
        if (rm[i]) rows.push(rm[i]);
      }
      const categories = [
        ...(sh?.categories ?? []).map((cat) => ({ kind: 'shows' as VodKind, cat })),
        ...(m?.categories ?? []).map((cat) => ({ kind: 'movies' as VodKind, cat })),
      ];
      return { rows, loading, noKey, categories };
    };
    const emit = () => onUpdate(build(true));
    await Promise.all([
      loadHome('shows', (h) => { sh = h; emit(); }).then((h) => { sh = h; }).catch(() => undefined),
      loadHome('movies', (h) => { m = h; emit(); }).then((h) => { m = h; }).catch(() => undefined),
    ]);
    // More to scroll through: your provider's own categories as rows too (a few of each, English).
    const done0 = build(true);
    onUpdate(done0);
    const shH = sh as VodHome | null;
    const mH = m as VodHome | null;
    const cats = [...(shH?.categories ?? []).slice(0, 8).map((c) => ['shows', c] as const), ...(mH?.categories ?? []).slice(0, 8).map((c) => ['movies', c] as const)];
    const extra: ServiceRowOut[] = [];
    const seen = new Set(done0.rows.map((r) => r.title.toLowerCase()));
    await Promise.all(cats.map(async ([k, c]) => {
      const items = await catItems(k, c).catch(() => [] as VodItem[]);
      const title = c.name.replace(/^[A-Z]{2,3}\s*[|:-]\s*/, '').trim();
      if (items.length >= 4 && !seen.has(title.toLowerCase())) extra.push({ id: `cat:${c.key}`, title: k === 'movies' && !/movie|film/i.test(title) ? `${title} Movies` : title, items: dedupe(items).slice(0, SVC_ROW_MAX).map(fromVod) });
    }));
    const done = build(false);
    done.rows.push(...extra);
    onUpdate(done);
    return done;
  }
  if (noKey) {
    const own = [...sEng.filter((c) => svc.cat.test(c.name)).map((c) => ['shows', c] as const), ...mEng.filter((c) => svc.cat.test(c.name)).map((c) => ['movies', c] as const)].slice(0, 10);
    const lists = await Promise.all(own.map(([k, c]) => catItems(k, c).catch(() => [] as VodItem[])));
    const rows = own
      .map(([, c], i) => ({ id: `cat:${c.key}`, title: c.name.replace(/^[A-Z]{2,3}\s*[|:-]\s*/, '').trim(), items: dedupe(lists[i]).slice(0, SVC_ROW_MAX).map(fromVod) }))
      .filter((r) => r.items.length > 0);
    const h = { rows, loading: false, noKey };
    onUpdate(h);
    return h;
  }
  // Show Watchmode's lists right away; your provider's copies are matched in as its library loads.
  let match: ((t: WmTitle) => VodItem | undefined) | null = null;
  let wm: Awaited<ReturnType<typeof serviceRows>> = [];
  const build = (loading: boolean): ServiceHome => {
    const rows: ServiceRowOut[] = [];
    const seenTop = new Set<string>();
    for (const r of wm) {
      const items: SvcItem[] = [];
      const seen = new Set<string>();
      for (const t of r.titles) {
        const k = `${t.kind}:${normTitle(t.title)}:${t.year ?? ''}`;
        if (seen.has(k)) continue;
        seen.add(k);
        items.push({ title: t.title, year: t.year, kind: t.kind ?? 'show', tmdb: t.tmdb, match: match?.(t) });
        if (items.length >= (r.ranked ? 10 : SVC_ROW_MAX)) break;
      }
      // Rows after the first few skip what the Top 10s already showed, so each row adds something new.
      const fresh = r.ranked || r.id === 'popular' ? items : items.filter((x) => !seenTop.has(`${x.kind}:${normTitle(x.title)}`));
      if (r.ranked) for (const x of items) seenTop.add(`${x.kind}:${normTitle(x.title)}`);
      if (fresh.length >= 4) rows.push({ id: r.id, title: r.title, items: fresh, ranked: r.ranked });
    }
    return { rows, loading, noKey };
  };
  let last = 0;
  try {
    wm = await serviceRows(id === 'all' ? 'all' : svc.id, (partial) => {
      wm = partial;
      if (Date.now() - last < 900) return;
      last = Date.now();
      onUpdate(build(true));
    });
  } catch (e) {
    console.warn('Watchmode lists for', svc.id, 'unavailable:', (e as Error).message);
  }
  onUpdate(build(true));
  try {
    const [matchMovie, matchShow] = await Promise.all([libraryMatcher('movies', mEng).then((x) => x.match), libraryMatcher('shows', sEng).then((x) => x.match)]);
    match = (t: WmTitle) => (t.kind === 'movie' ? matchMovie(t) : t.kind === 'show' ? matchShow(t) : matchShow(t) ?? matchMovie(t));
  } catch {
    /* no library: titles show, nothing plays */
  }
  const done = build(false);
  onUpdate(done);
  return done;
}

/** Items of one category (for "Browse"). */
export const loadCategoryItems = catItems;

// ---- Versions (the same title in 4K / 1080p / 720p) ----

export interface VodVersion {
  item: VodItem;
  quality: Quality;
}

/** Other copies of this movie / show in your provider's list (same title and year), best quality first. */
export async function findVersions(it: VodItem): Promise<VodVersion[]> {
  const name = itemName(it);
  const key = normTitle(cleanTitle(name));
  const year = it.kind === 'movie' ? it.m.year : it.s.year;
  let list: VodItem[] = [];
  try {
    list = it.kind === 'movie'
      ? (await loadAllMovies()).map((m): VodItem => ({ kind: 'movie', playlistId: m.playlistId, m }))
      : (await loadAllSeries()).map((s): VodItem => ({ kind: 'series', playlistId: s.playlistId, s }));
  } catch {
    /* only this one */
  }
  const same = list.filter((x) => {
    const y = x.kind === 'movie' ? x.m.year : x.s.year;
    return normTitle(cleanTitle(itemName(x))) === key && (!year || !y || y === year);
  });
  if (!same.some((x) => itemId(x) === itemId(it))) same.unshift(it);
  return same.map((x) => ({ item: x, quality: qualityOf(itemName(x)) })).sort((a, b) => b.quality.rank - a.quality.rank);
}

/** A while after start-up, get Movies & Shows ready in the background so opening them is instant. */
export function prefetchVodHomes(delayMs = 45_000) {
  setTimeout(() => {
    const st = getState();
    if (!st.vodAvail?.movies && !st.vodAvail?.shows) return;
    void (async () => {
      for (const kind of ['movies', 'shows'] as VodKind[]) {
        if (kind === 'movies' ? !st.vodAvail?.movies : !st.vodAvail?.shows) continue;
        if (getState().fullscreen || getState().multiview) continue; // don't compete with playback
        await loadHome(kind, () => undefined).catch(() => undefined);
      }
    })();
  }, delayMs);
}
