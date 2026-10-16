// Movies and Shows from the user's own playlists: Xtream providers' movie and series lists
// (loaded on demand, cached briefly) and movie/episode entries of plain M3U playlists.
// Also: what to play, resume positions and "Continue watching".
import { useEffect, useState } from 'preact/hooks';
import { loginFor, xtreamApiUrl, type XtreamLogin } from '../core/xtream';
import {
  GENRE_ROWS, cleanTitle, genreOf, parseTvmazeSchedule, isEnglishCategory, qualityOf, type Quality, isTrendingCategory, normTitle, parseItunesChart,
  episodeUrl, m3uVod, movieUrl, parseCategories, parseMovieInfo, parseMovies, parseSeriesInfo, parseSeriesList,
  type VodCategory, type VodDetails, type VodEpisode, type VodMovie, type VodSeries,
} from '../core/vod';
import { openRemote } from './platform';
import { continueList, type ResumeEntry, type SeriesRef } from '../core/vod';
export { continueList, type ResumeEntry, type SeriesRef };
import { getState, repo, setState, subscribe } from './state';
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
      for (const c of cats) out.push({ ...c, key: `${src.playlistId}:${c.id}`, playlistId: src.playlistId, name: many ? `${c.name} · ${src.name}` : c.name });
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

/** Every movie of a playlist (for searching across categories; big lists, so only on request). */
export async function loadAllMovies(): Promise<(VodMovie & { playlistId: string })[]> {
  const out: (VodMovie & { playlistId: string })[] = [];
  for (const src of sources()) {
    try {
      const list = src.login ? parseMovies(await api(src, 'get_vod_streams')) : (await m3u(src)).movies;
      for (const m of list) out.push({ ...m, playlistId: src.playlistId });
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
      const list = src.login ? parseSeriesList(await api(src, 'get_series')) : (await m3u(src)).series.map((s) => s.series);
      for (const s of list) out.push({ ...s, playlistId: src.playlistId });
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
export function resetVod() {
  mem.clear();
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
}



const RESUME_KV = 'vodResume';
let resume: Record<string, ResumeEntry> | null = null;
const resumeListeners = new Set<() => void>();

async function resumeStore(): Promise<Record<string, ResumeEntry>> {
  if (!resume) resume = (await repo.getKv<Record<string, ResumeEntry>>(RESUME_KV).catch(() => undefined)) ?? {};
  return resume;
}

export async function resumePosition(key: string): Promise<ResumeEntry | undefined> {
  return (await resumeStore())[key];
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
  await repo.setKv(RESUME_KV, store).catch(() => undefined);
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

/** Apple's public charts of what people are watching (titles only), to find those in your provider's list. */
async function chartTitles(kind: VodKind): Promise<string[]> {
  const k = `chart|${kind}`;
  if (mem.has(k)) return mem.get(k) as string[];
  try {
    const url = kind === 'movies' ? 'https://itunes.apple.com/us/rss/topmovies/limit=100/json' : 'https://itunes.apple.com/us/rss/toptvseasons/limit=100/json';
    const { stream } = await openRemote(url, AbortSignal.timeout?.(15_000));
    const titles = parseItunesChart(JSON.parse(await new Response(stream).text()));
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
export async function loadHome(kind: VodKind, onUpdate: (h: VodHome) => void): Promise<VodHome> {
  const hit = homeCache.get(kind);
  if (hit && !hit.loading) {
    onUpdate(hit);
    return hit;
  }
  const cats = await loadCategories(kind);
  const english = cats.filter((c) => isEnglishCategory(c.name));
  const otherLanguages = cats.filter((c) => !isEnglishCategory(c.name));
  // Which categories feed which row; trending and genre lists first, then the rest (for Recently added / Top rated).
  const trendingCats = english.filter((c) => isTrendingCategory(c.name));
  const genreCats = english.filter((c) => !isTrendingCategory(c.name) && genreOf(c.name));
  const rest = english.filter((c) => !isTrendingCategory(c.name) && !genreOf(c.name));
  const order = [...trendingCats, ...genreCats, ...rest].slice(0, MAX_CATS);
  const loaded = new Map<string, VodItem[]>();
  let chart: string[] = [];

  const build = (loading: boolean): VodHome => {
    const all = dedupe([...loaded.values()].flat());
    const rows: VodRow[] = [];
    // Trending: the provider's own "Trending / Popular / Top 10" lists, then chart titles found in your list.
    const trending: VodItem[] = trendingCats.flatMap((c) => loaded.get(c.key) ?? []);
    if (chart.length) {
      const byTitle = new Map(all.map((it) => [normTitle(itemName(it)), it]));
      for (const t of chart) {
        const it = byTitle.get(normTitle(t));
        if (it) trending.push(it);
      }
    }
    const tr = dedupe(trending).slice(0, ROW_MAX);
    if (tr.length) rows.push({ id: 'trending', title: kind === 'movies' ? 'Popular Movies' : 'Popular Shows', items: tr });
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
    for (const g of GENRE_ROWS) {
      const items = dedupe(genreCats.filter((c) => genreOf(c.name) === g.id).flatMap((c) => loaded.get(c.key) ?? [])).slice(0, ROW_MAX);
      if (items.length) rows.push({ id: `genre:${g.id}`, title: g.label, items });
    }
    return { rows, categories: english, otherLanguages, loading };
  };

  void chartTitles(kind).then((t) => {
    chart = t;
    if (loaded.size) onUpdate(build(loaded.size < order.length));
  });
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
