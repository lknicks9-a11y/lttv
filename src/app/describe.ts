// Fills in descriptions for programmes the guide lists without one:
//  - games: from the sports schedule (teams, records, stakes, venue, score, TV);
//  - shows / episodes: from TVmaze (free TV database, CC BY-SA);
//  - movies: from Wikipedia (CC BY-SA).
// Looked up only for the programme on screen, cached, and always labelled with its source.
import { useEffect, useState } from 'preact/hooks';
import type { LineupChannel, Programme } from '../core/types';
import { SCHEDULE_LEAGUES, scheduleDay, textMatchesGame, type Game, type ScheduleLeague } from '../core/schedule';
import { isEventChannel } from '../core/events';
import { episodeNumbers, gameDescription, searchTitle, shorten, stripHtml, tvmazeShowMatches, wikiMatches, type ProgDescription } from '../core/progdesc';
import { loadGames } from './schedule';
import { openRemote } from './platform';
import { getState, repo } from './state';
import { expectsEnglish, isForeignScript, scriptName } from '../core/lang';

const TVMAZE = 'https://api.tvmaze.com';
const WIKI = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const override = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) || d;
  } catch {
    return d;
  }
};

const cache = new Map<string, ProgDescription | null>();
const inflight = new Map<string, Promise<ProgDescription | null>>();
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const KV = 'progDescriptions';

async function loadCache() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = (await repo.getKv<Record<string, ProgDescription>>(KV)) ?? {};
    for (const [k, v] of Object.entries(saved)) if (!cache.has(k)) cache.set(k, v);
  } catch {
    /* start empty */
  }
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // Keep show/movie lookups (they don't change); games are re-made from the live schedule.
    const out: Record<string, ProgDescription> = {};
    let n = 0;
    for (const [k, v] of [...cache.entries()].reverse()) {
      if (!v || v.source === 'schedule' || v.source === 'guide' || v.source === 'note') continue;
      out[k] = v;
      if (++n >= 1500) break;
    }
    void repo.setKv(KV, out).catch(() => undefined);
  }, 2000);
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const { stream } = await openRemote(url, AbortSignal.timeout?.(15_000));
    return JSON.parse(await new Response(stream).text());
  } catch {
    return null; // not found / offline: no description
  }
}

const GAMEY = /\s(vs\.?|v\.?|versus|at|@)\s/i;
const SPORT_CATEGORY = /sport|football|basketball|baseball|hockey|soccer|futbol/i;

function looksLikeGame(p: Programme, ch?: LineupChannel): boolean {
  const text = ` ${p.title} ${p.subTitle ?? ''} `;
  return GAMEY.test(text) || !!p.categories?.some((c) => SPORT_CATEGORY.test(c)) || (!!ch && (ch.category === 'sports' || isEventChannel(ch)) && GAMEY.test(text));
}

function leaguesFor(p: Programme, ch?: LineupChannel): ScheduleLeague[] {
  const text = `${p.title} ${p.subTitle ?? ''} ${(p.categories ?? []).join(' ')} ${ch?.originalName ?? ''} ${ch?.group ?? ''}`;
  const named = SCHEDULE_LEAGUES.filter((l) => l.words.test(text));
  return named.length ? named : SCHEDULE_LEAGUES;
}

async function fromSchedule(p: Programme, ch?: LineupChannel): Promise<ProgDescription | null> {
  const tz = getState().settings.timeZone;
  const today = scheduleDay(Date.now(), tz);
  const day = scheduleDay(p.start, tz);
  const text = `${p.title} ${p.subTitle ?? ''}`;
  for (const l of leaguesFor(p, ch)) {
    let games: Game[] = [];
    try {
      games = await loadGames(l.id, day, today);
    } catch {
      continue;
    }
    const g = games.find((x) => textMatchesGame(text, x, l.sport) && Math.abs(x.start - p.start) < 6 * 3600_000);
    if (g) {
      const clock = (t: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz || undefined }).format(new Date(t));
      return { text: gameDescription(g, l.sport, l.name, clock), source: 'schedule' };
    }
  }
  return null;
}

async function fromTvmaze(title: string, episode?: string): Promise<ProgDescription | null> {
  const base = override('lttvTvmazeBase', TVMAZE);
  const show = await getJson(`${base}/singlesearch/shows?q=${encodeURIComponent(title)}`);
  if (!tvmazeShowMatches(show, title)) return null;
  const ep = episodeNumbers(episode);
  if (ep) {
    const e = (await getJson(`${base}/shows/${show.id}/episodebynumber?season=${ep.season}&number=${ep.number}`)) as { name?: string; summary?: string; url?: string } | null;
    const s = stripHtml(e?.summary);
    if (s) return { text: shorten(`${e?.name ? `“${e.name}”: ` : ''}${s}`), source: 'tvmaze', url: e?.url };
  }
  const s = stripHtml(show.summary);
  return s ? { text: shorten(s), source: 'tvmaze', url: show.url } : null;
}

async function fromWikipedia(title: string, kind: 'film' | 'tv'): Promise<ProgDescription | null> {
  const base = override('lttvWikiBase', WIKI);
  const tries = kind === 'film' ? [`${title} (film)`, title] : [`${title} (TV series)`, `${title} (American TV series)`, title];
  for (const t of tries) {
    const page = await getJson(base + encodeURIComponent(t.replace(/ /g, '_')));
    if (wikiMatches(page, title, kind)) return { text: shorten(page.extract), source: 'wikipedia', url: page.content_urls?.desktop?.page };
  }
  return null;
}

/** English is wanted for this channel, but the guide text isn't (Arabic on MeTV, say). */
function wantsEnglishFor(text: string | undefined, ch?: LineupChannel): boolean {
  return !!ch && getState().settings.preferEnglish !== false && expectsEnglish(ch) && isForeignScript(text);
}

/** The guide's own description, when it is usable as it is. */
export function ownDescription(p: Programme, ch?: LineupChannel): ProgDescription | undefined {
  const d = p.desc?.trim();
  if (!d || d.length <= 3 || /^from the channel name/i.test(d) || wantsEnglishFor(d, ch)) return undefined;
  return { text: d, source: 'guide' };
}

/** A description for a programme: its own, or one found for it (cached). */
export async function describeProgramme(p: Programme, ch?: LineupChannel): Promise<ProgDescription | null> {
  const own = ownDescription(p, ch);
  if (own) return own;
  await loadCache();
  const foreignTitle = wantsEnglishFor(p.title, ch);
  const foreignNote = (): ProgDescription | null =>
    wantsEnglishFor(p.desc, ch) || foreignTitle ? { text: `Your guide only lists this programme in ${scriptName(p.title + ' ' + (p.desc ?? ''))}, and no English version was found.`, source: 'note' } : null;
  const title = searchTitle(p.title);
  if (foreignTitle || !title || title.length < 2) return foreignNote();
  const game = looksLikeGame(p, ch);
  const key = game ? `game|${titleKeyLite(p.title + ' ' + (p.subTitle ?? ''))}|${scheduleDay(p.start)}` : `${titleKeyLite(title)}|${p.episode ?? ''}|${ch?.category === 'movies' ? 'm' : ''}`;
  if (cache.has(key) && !(game && cache.get(key) === null)) return cache.get(key)!;
  const running = inflight.get(key);
  if (running) return running;
  const job = (async () => {
    let d: ProgDescription | null = null;
    if (game) d = await fromSchedule(p, ch);
    if (!d && !game) {
      const movie = ch?.category === 'movies' || p.categories?.some((c) => /movie|film/i.test(c));
      d = movie ? (await fromWikipedia(title, 'film')) ?? (await fromTvmaze(title, p.episode)) : (await fromTvmaze(title, p.episode)) ?? (await fromWikipedia(title, 'tv'));
    }
    cache.set(key, d);
    if (cache.size > 5000) cache.delete(cache.keys().next().value!);
    persist();
    return d ?? foreignNote();
  })();
  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

function titleKeyLite(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Description for the programme on screen; looked up after a short pause so scrolling stays light. */
export function useProgrammeDescription(p: Programme | undefined, ch: LineupChannel | undefined): ProgDescription | null | undefined {
  const own = p ? ownDescription(p, ch) : undefined;
  const [found, setFound] = useState<{ id: string; d: ProgDescription | null } | null>(null);
  const id = p ? `${p.ch}|${p.start}|${p.title}` : '';
  useEffect(() => {
    if (!p || own) return;
    let alive = true;
    const t = setTimeout(() => {
      void describeProgramme(p, ch).then((d) => alive && setFound({ id, d }));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [id, !!own]);
  if (!p) return undefined;
  if (own) return own;
  return found?.id === id ? found.d : undefined;
}

// ---- background lookups for what's on now ----

const queue: { p: Programme; ch?: LineupChannel }[] = [];
const queued = new Set<string>();
let pumping = false;

/**
 * Look up descriptions for programmes on screen in the background (one at a time, a
 * little apart, so the free databases aren't flooded), so they're ready when focused.
 */
export function prefetchDescriptions(items: { p: Programme; ch?: LineupChannel }[]) {
  for (const it of items) {
    if (ownDescription(it.p, it.ch)) continue;
    const id = `${it.p.ch}|${it.p.start}|${it.p.title}`;
    if (queued.has(id)) continue;
    queued.add(id);
    if (queued.size > 4000) queued.clear();
    queue.push(it);
  }
  if (queue.length > 60) queue.splice(0, queue.length - 60); // newest screen wins
  if (!pumping) void pump();
}

async function pump() {
  pumping = true;
  try {
    while (queue.length) {
      const it = queue.pop()!;
      await describeProgramme(it.p, it.ch).catch(() => null);
      await new Promise((r) => setTimeout(r, 700));
    }
  } finally {
    pumping = false;
  }
}
