// Movies and Shows from the user's own playlists: Xtream providers' movie and series lists
// (loaded on demand, cached briefly) and movie/episode entries of plain M3U playlists.
// Also: what to play, resume positions and "Continue watching".
import { useEffect, useState } from 'preact/hooks';
import { loginFor, xtreamApiUrl, type XtreamLogin } from '../core/xtream';
import {
  episodeUrl, m3uVod, movieUrl, parseCategories, parseMovieInfo, parseMovies, parseSeriesInfo, parseSeriesList,
  type VodCategory, type VodDetails, type VodEpisode, type VodMovie, type VodSeries,
} from '../core/vod';
import { openRemote } from './platform';
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
  /** Following episodes (played automatically when one ends). */
  queue?: VodPlay[];
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
  if (done || e.pos < 20) delete store[e.key];
  else store[e.key] = { ...e, at: Date.now() };
  const keys = Object.keys(store).sort((a, b) => store[b].at - store[a].at);
  for (const k of keys.slice(60)) delete store[k];
  await repo.setKv(RESUME_KV, store).catch(() => undefined);
  resumeListeners.forEach((l) => l());
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
  return { key: `e:${playlistId}:${e.id}`, title: s.name, subtitle: `S${e.season} E${e.episode}${episodeName(s.name, e) ? ' · ' + episodeName(s.name, e) : ''}`, poster: e.image ?? s.poster, url: e.url ?? episodeUrl(src.login!, e), headers: headersFor(playlistId), startSec, playlistId };
}

/** Play again from "Continue watching". */
export function resumePlay(e: ResumeEntry, fromStart = false): VodPlay {
  return { key: e.key, title: e.title, subtitle: e.subtitle, poster: e.poster, url: e.url, headers: headersFor(e.playlistId), startSec: fromStart ? 0 : Math.max(0, e.pos - 5), playlistId: e.playlistId };
}

/** Start playing a movie / episode full screen. */
export function playVod(v: VodPlay) {
  setState({ vodPlaying: v });
}
