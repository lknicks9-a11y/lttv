// Pictures and details for Movies & Shows from TMDB (the movie database most apps use): sharp posters and wide
// backdrops for every title Watchmode lists. Optional: your own free TMDB API key (Settings → Movies & Shows);
// without it, pictures come from TVmaze / iTunes as before. Cached on the device for 30 days.
import { useEffect, useState } from 'preact/hooks';
import { openRemote } from './platform';
import { getState, repo } from './state';

export interface TmdbInfo {
  poster?: string;
  backdrop?: string;
  plot?: string;
  genre?: string;
  year?: string;
  rating?: number;
  runtime?: number;
  seasons?: number;
}

const TTL = 30 * 86400_000;
const mem = new Map<string, TmdbInfo | null>();
const pending = new Map<string, Promise<TmdbInfo | null>>();
const IMG = 'https://image.tmdb.org/t/p/';

export function tmdbKey(): string {
  return (getState().settings.tmdbKey ?? '').trim();
}

async function get(path: string, key = tmdbKey()): Promise<unknown> {
  const sep = path.includes('?') ? '&' : '?';
  const { stream } = await openRemote(`https://api.themoviedb.org/3${path}${sep}api_key=${encodeURIComponent(key)}&language=en-US`, AbortSignal.timeout?.(15_000), { Accept: 'application/json' });
  const j = JSON.parse(await new Response(stream).text()) as { success?: boolean; status_message?: string };
  if (j && j.success === false) throw new Error(j.status_message || 'TMDB refused the request');
  return j;
}

/** Settings "Save & test". */
export async function testTmdbKey(key: string): Promise<void> {
  await get('/configuration', key.trim());
}

// A few at a time, so a page of 100 posters doesn't flood the TV's connection.
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(job: () => Promise<T>): Promise<T> {
  if (running >= 6) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

export function getTmdb(kind: 'movie' | 'show', id: number): Promise<TmdbInfo | null> {
  const k = `${kind}:${id}`;
  if (mem.has(k)) return Promise.resolve(mem.get(k)!);
  const p = pending.get(k);
  if (p) return p;
  const job = (async () => {
    const hit = await repo.getKv<{ at: number; v: TmdbInfo | null }>(`tmdb:${k}`).catch(() => undefined);
    if (hit && Date.now() - hit.at < TTL) return hit.v;
    if (!tmdbKey()) return null;
    try {
      const j = (await slot(() => get(`/${kind === 'movie' ? 'movie' : 'tv'}/${id}`))) as {
        poster_path?: string; backdrop_path?: string; overview?: string; genres?: { name: string }[];
        release_date?: string; first_air_date?: string; vote_average?: number; runtime?: number; number_of_seasons?: number;
      };
      const v: TmdbInfo = {
        poster: j.poster_path ? `${IMG}w500${j.poster_path}` : undefined,
        backdrop: j.backdrop_path ? `${IMG}w1280${j.backdrop_path}` : undefined,
        plot: j.overview || undefined,
        genre: j.genres?.[0]?.name,
        year: (j.release_date || j.first_air_date || '').slice(0, 4) || undefined,
        rating: j.vote_average || undefined,
        runtime: j.runtime || undefined,
        seasons: j.number_of_seasons || undefined,
      };
      await repo.setKv(`tmdb:${k}`, { at: Date.now(), v }).catch(() => undefined);
      return v;
    } catch {
      return null;
    }
  })().then((v) => {
    mem.set(k, v);
    pending.delete(k);
    return v;
  });
  pending.set(k, job);
  return job;
}

/** TMDB pictures for a title (undefined while loading, null when there's no key or no match). */
export function useTmdb(kind: 'movie' | 'show' | undefined, id: number | undefined): TmdbInfo | null | undefined {
  const k = kind && id ? `${kind}:${id}` : '';
  const [v, setV] = useState<TmdbInfo | null | undefined>(() => (k ? mem.get(k) : null));
  useEffect(() => {
    if (!k) return setV(null);
    if (mem.has(k)) return setV(mem.get(k));
    let alive = true;
    setV(undefined);
    void getTmdb(kind!, id!).then((x) => alive && setV(x));
    return () => {
      alive = false;
    };
  }, [k]);
  return v;
}
