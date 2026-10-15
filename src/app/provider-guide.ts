// Per-channel guide straight from the IPTV provider (Xtream "get_short_epg"), for
// channels the guide file doesn't cover. Fetched only for channels that are on
// screen, a couple at a time, and cached for a few hours, so the provider sees a
// handful of light API calls rather than a flood.
import type { LineupChannel, Programme } from '../core/types';
import type { GuideIndex } from '../core/guide';
import { needsProviderGuide, providerRef, shortEpgUrl } from '../core/extras';
import { parseShortEpg } from '../core/xtream';
import { openRemote } from './platform';
import type { Repo } from '../core/storage';

const FRESH_MS = 2 * 3600_000;
const EMPTY_RETRY_MS = 3 * 3600_000;
const FAIL_RETRY_MS = 20 * 60_000;
const KEEP_MS = 8 * 3600_000;
const CONCURRENCY = 2;
const KV = 'providerGuide';

interface Entry {
  at: number;
  list: Programme[];
  failed?: boolean;
}

const cache = new Map<string, Entry>();
const queued = new Map<string, { url: string; ua?: string }>();
const inflight = new Set<string>();
let running = 0;
let onUpdate: (() => void) | null = null;
let updateTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let repoRef: Repo | null = null;
/** Consecutive failures across channels: back off if the provider doesn't support the call. */
let failStreak = 0;
let pausedUntil = 0;

export async function initProviderGuide(repo: Repo, update: () => void) {
  repoRef = repo;
  onUpdate = update;
  try {
    const saved = (await repo.getKv<Record<string, Entry>>(KV)) ?? {};
    const now = Date.now();
    for (const [ref, e] of Object.entries(saved)) if (now - e.at < KEEP_MS) cache.set(ref, e);
  } catch {
    /* start empty */
  }
}

/** Put cached provider programmes into the guide index. */
export function addProviderProgrammes(guide: GuideIndex, now = Date.now()) {
  for (const [ref, e] of cache) {
    const list = e.list.filter((p) => p.stop > now - 3 * 3600_000);
    if (list.length) guide.set(ref, list);
    else guide.delete(ref);
  }
}

/** Ask for a channel's provider guide if it needs one and we don't have a fresh copy. */
export function wantProviderGuide(ch: LineupChannel, guide: GuideIndex, ua?: string) {
  const ref = providerRef(ch.url);
  if (!ref || inflight.has(ref) || queued.has(ref)) return;
  const e = cache.get(ref);
  const now = Date.now();
  if (e) {
    const age = now - e.at;
    if (e.failed ? age < FAIL_RETRY_MS : e.list.length ? age < FRESH_MS && e.list.some((p) => p.stop > now + 3600_000) : age < EMPTY_RETRY_MS) return;
  }
  if (!needsProviderGuide(ch, guide)) return;
  const url = shortEpgUrl(ch.url);
  if (!url) return;
  queued.set(ref, { url, ua });
  pump();
}

function pump() {
  if (Date.now() < pausedUntil) {
    setTimeout(pump, pausedUntil - Date.now() + 50);
    return;
  }
  while (running < CONCURRENCY && queued.size) {
    const [ref, job] = queued.entries().next().value as [string, { url: string; ua?: string }];
    queued.delete(ref);
    inflight.add(ref);
    running++;
    void fetchOne(ref, job).finally(() => {
      inflight.delete(ref);
      running--;
      setTimeout(pump, 150);
    });
  }
}

async function fetchOne(ref: string, job: { url: string; ua?: string }) {
  try {
    const { stream } = await openRemote(job.url, AbortSignal.timeout?.(20_000), job.ua ? { 'User-Agent': job.ua } : undefined);
    const text = await new Response(stream).text();
    const list = parseShortEpg(JSON.parse(text), ref);
    cache.set(ref, { at: Date.now(), list });
    failStreak = 0;
  } catch {
    cache.set(ref, { at: Date.now(), list: cache.get(ref)?.list ?? [], failed: true });
    // The provider may not support the call or may be throttling: slow down.
    if (++failStreak >= 6) {
      pausedUntil = Date.now() + 10 * 60_000;
      failStreak = 0;
    }
  }
  scheduleUpdate();
}

function scheduleUpdate() {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => onUpdate?.(), 400);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const now = Date.now();
    const obj: Record<string, Entry> = {};
    for (const [ref, e] of cache) if (now - e.at < KEEP_MS && e.list.length) obj[ref] = { at: e.at, list: e.list };
    void repoRef?.setKv(KV, obj).catch(() => undefined);
  }, 3000);
}

/** For tests/diagnostics. */
export function providerGuideStats() {
  let withData = 0;
  for (const e of cache.values()) if (e.list.length) withData++;
  return { cached: cache.size, withData, queued: queued.size, inflight: inflight.size };
}
