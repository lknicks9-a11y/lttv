// Better artwork and descriptions for movies and shows: TVmaze (shows: poster, summary, every
// episode's still and summary) and Apple's iTunes search (movies: large poster, description),
// with Wikipedia as a fallback for movie descriptions. Only exact title (and year) matches are used.
// Results are kept on the device, so each title is looked up once.
import { useEffect, useState } from 'preact/hooks';
import { cleanTitle, normTitle, parseItunesMovie, parseTvmazeShow, titleYear, type ArtInfo } from '../core/vod';
import { openRemote } from './platform';
import { repo } from './state';

const override = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) || d;
  } catch {
    return d;
  }
};
const TVMAZE = () => override('lttvTvmazeBase', 'https://api.tvmaze.com');
const ITUNES = () => override('lttvItunesBase', 'https://itunes.apple.com');
const WIKI = () => override('lttvWikiBase', 'https://en.wikipedia.org/api/rest_v1/page/summary/');

type Kind = 'movie' | 'series';
const KV = 'vodArt';
const cache = new Map<string, ArtInfo | null>();
const inflight = new Map<string, Promise<ArtInfo | null>>();
const listeners = new Map<string, Set<(a: ArtInfo | null) => void>>();
let loaded: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function load() {
  loaded ??= (async () => {
    try {
      const saved = (await repo.getKv<Record<string, ArtInfo | null>>(KV)) ?? {};
      for (const [k, v] of Object.entries(saved)) if (!cache.has(k)) cache.set(k, v);
    } catch {
      /* start empty */
    }
  })();
  return loaded;
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out: Record<string, ArtInfo | null> = {};
    let n = 0;
    for (const [k, v] of [...cache.entries()].reverse()) {
      // Episode lists are big: keep them only for the 60 most recent shows.
      out[k] = v && v.episodes && n > 60 ? { ...v, episodes: undefined } : v;
      if (++n >= 2500) break;
    }
    void repo.setKv(KV, out).catch(() => undefined);
  }, 2500);
}

async function getJson(url: string): Promise<unknown> {
  const { stream } = await openRemote(url, AbortSignal.timeout?.(15_000));
  return JSON.parse(await new Response(stream).text());
}

// Polite pacing: TVmaze allows ~20 calls / 10 s, iTunes ~20 / minute.
const queues: Record<'tvmaze' | 'itunes', { gap: number; last: number; chain: Promise<unknown> }> = {
  tvmaze: { gap: 600, last: 0, chain: Promise.resolve() },
  itunes: { gap: 3200, last: 0, chain: Promise.resolve() },
};
function paced<T>(q: 'tvmaze' | 'itunes', job: () => Promise<T>, urgent: boolean): Promise<T> {
  if (urgent) return job();
  const s = queues[q];
  const run = s.chain.then(async () => {
    const wait = s.last + s.gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    s.last = Date.now();
    return job();
  });
  s.chain = run.catch(() => undefined);
  return run;
}

const keyOf = (kind: Kind, name: string) => `${kind}:${normTitle(cleanTitle(name))}:${titleYear(name) ?? ''}`;

async function lookup(kind: Kind, name: string, year: string | undefined, urgent: boolean): Promise<ArtInfo | null> {
  const title = cleanTitle(name);
  if (!title) return null;
  try {
    if (kind === 'series') {
      const json = await paced('tvmaze', () => getJson(`${TVMAZE()}/singlesearch/shows?q=${encodeURIComponent(title)}&embed=episodes`), urgent);
      return parseTvmazeShow(json, name, year) ?? null;
    }
    const json = await paced('itunes', () => getJson(`${ITUNES()}/search?term=${encodeURIComponent(title)}&media=movie&entity=movie&limit=8&country=us`), urgent);
    const hit = parseItunesMovie(json, name, year);
    if (hit) return hit;
  } catch {
    /* not found / offline */
  }
  if (kind === 'movie' && urgent) {
    // Description only, from Wikipedia ("Title (film)").
    for (const t of [...(year ? [`${title} (${year} film)`] : []), `${title} (film)`, title]) {
      try {
        const p = (await getJson(WIKI() + encodeURIComponent(t.replace(/\s/g, '_')))) as { type?: string; title?: string; extract?: string; description?: string; originalimage?: { source?: string } };
        if (p?.type !== 'disambiguation' && p?.extract && /film/i.test(p.description ?? '') && normTitle(p.title ?? '').startsWith(normTitle(title))) {
          return { plot: p.extract, poster: p.originalimage?.source, source: 'wikipedia' };
        }
      } catch {
        /* try the next form */
      }
    }
  }
  return null;
}

/** Artwork / description for a title (cached). `urgent` skips the queue (details page). */
export async function getArt(kind: Kind, name: string, year?: string, urgent = false): Promise<ArtInfo | null> {
  await load();
  const k = keyOf(kind, name);
  const hit = cache.get(k);
  // A cached series without its episode list (trimmed) is looked up again when the details page needs it.
  if (hit !== undefined && !(urgent && kind === 'series' && hit && !hit.episodes)) return hit;
  // A details page doesn't wait behind cards queued for the same title.
  const ik = urgent ? `!${k}` : k;
  const running = inflight.get(ik) ?? (urgent ? undefined : inflight.get(`!${k}`));
  if (running) return running;
  const job = lookup(kind, name, year ?? titleYear(name), urgent).then((a) => {
    cache.set(k, a);
    persist();
    listeners.get(k)?.forEach((l) => l(a));
    return a;
  });
  inflight.set(ik, job);
  try {
    return await job;
  } finally {
    inflight.delete(ik);
  }
}

/** Artwork for a card or details page. Cards pass `enabled` only once they're on screen. */
export function useArt(kind: Kind, name: string, year: string | undefined, enabled = true, urgent = false): ArtInfo | null | undefined {
  const k = keyOf(kind, name);
  const [art, setArt] = useState<ArtInfo | null | undefined>(() => cache.get(k));
  useEffect(() => {
    setArt(cache.get(k));
    if (!enabled) return;
    let alive = true;
    const l = (a: ArtInfo | null) => alive && setArt(a);
    const set = listeners.get(k) ?? new Set();
    set.add(l);
    listeners.set(k, set);
    void getArt(kind, name, year, urgent).then(l);
    return () => {
      alive = false;
      set.delete(l);
    };
  }, [k, enabled]);
  return art;
}
