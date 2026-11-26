// Is a channel's stream actually on the air? Reads the first few KB through the local helper (desktop server or
// the Fire TV host), then hangs up. Used to leave dead channels out of a game's stream list.
import type { LineupChannel } from '../core/types';
import { openRemote, serverCaps } from './platform';
import { getState, player } from './state';
import { judgeStreamStart as judge, judgePicture } from '../core/liveness';

export type { Liveness } from '../core/liveness';
import type { Liveness } from '../core/liveness';

const cache = new Map<string, { v: Liveness; at: number }>();
/** How long a result is trusted (a dead event channel often comes alive at game time). */
const LIVE_MS = 10 * 60_000;
const DEAD_MS = 3 * 60_000;
/** No bytes within this long = dead (a working IPTV channel starts sending within a couple of seconds). */
const TIMEOUT_MS = 7000;
/** A provider that refused a check (401/403) isn't checked again for a while: extra knocking can extend a ban. */
const refusedUntil = new Map<string, number>();
const REFUSED_PAUSE_MS = 15 * 60_000;
/** Answers that mean "you're over your limit / blocked", not "this channel is off". */
const REFUSALS = new Set([401, 403, 429, 456, 458, 509]);
/** Spacing between checks of one provider, and a cap per 10 minutes: each check is a connection to them, and too
 *  many in a row can get the account limited (HTTP 456). */
const GAP_MS = 4000;
const MAX_PER_10_MIN = 25;
const recent = new Map<string, number[]>();

/** Stop checking this provider for a while (it refused, or the player was refused). */
export function pauseChecks(playlistId: string, ms = REFUSED_PAUSE_MS) {
  refusedUntil.set(playlistId, Math.max(refusedUntil.get(playlistId) ?? 0, Date.now() + ms));
}

/** An error the player showed: a refusal pauses checks of that provider. */
export function noteRefusal(playlistId: string | undefined, error: string | undefined) {
  if (playlistId && error && /\b(401|403|429|456|458|509)\b|refusing streams|Access denied/i.test(error)) pauseChecks(playlistId);
}

/** What actually happened when a stream was played (it played / it failed): the best check there is. */
export function markLiveness(key: string, v: Liveness) {
  cache.set(key, { v, at: Date.now() });
}

export function cachedLiveness(key: string): Liveness | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  if (Date.now() - e.at > (e.v === 'live' ? LIVE_MS : DEAD_MS)) {
    cache.delete(key);
    return undefined;
  }
  return e.v;
}

/**
 * Checking opens one more connection to the provider. It only runs when that can't knock out something playing:
 * fewer streams of that provider in use (main player + Multiview games) than the plan allows; with an unknown
 * limit, only when nothing of theirs is playing.
 */
export function canCheck(ch: LineupChannel): boolean {
  if ((refusedUntil.get(ch.playlistId) ?? 0) > Date.now()) return false;
  const times = (recent.get(ch.playlistId) ?? []).filter((t) => Date.now() - t < 10 * 60_000);
  recent.set(ch.playlistId, times);
  if (times.length >= MAX_PER_10_MIN || (times.length && Date.now() - times[times.length - 1] < GAP_MS)) return false;
  const s = getState();
  const playlistOf = (key: string | undefined) => (key ? s.lineup.find((c) => c.key === key)?.playlistId : undefined);
  let inUse = playlistOf(player.currentKey) === ch.playlistId ? 1 : 0;
  for (const t of s.multiview?.tiles ?? []) if (t && playlistOf(t.key) === ch.playlistId) inUse++;
  const max = s.playlists.find((p) => p.id === ch.playlistId)?.maxConnections;
  return max ? inUse < max : inUse === 0;
}

/** 'live' / 'dead', or undefined when it can't be told here (no local helper, or the check was cancelled). */
export async function checkStream(ch: LineupChannel, signal?: AbortSignal): Promise<Liveness | undefined> {
  const hit = cachedLiveness(ch.key);
  if (hit) return hit;
  if (!(await serverCaps()).proxy || !/^https?:\/\//i.test(ch.url)) return undefined;
  if (!canCheck(ch)) return undefined;
  recent.set(ch.playlistId, [...(recent.get(ch.playlistId) ?? []), Date.now()]);
  const ctl = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  let v: Liveness | undefined;
  try {
    const { stream } = await openRemote(ch.url, ctl.signal, ch.headers);
    v = await sniff(stream);
  } catch (e) {
    // An error answer (403/404/5xx…), no answer, or nothing sent before the timeout. A cancel isn't a verdict.
    const st = (e as { status?: number }).status;
    if (st && REFUSALS.has(st)) {
      // Refused: that says nothing about the channel, and the provider shouldn't be asked again for a while.
      refusedUntil.set(ch.playlistId, Date.now() + REFUSED_PAUSE_MS);
      v = undefined;
    } else v = signal?.aborted && !timedOut ? undefined : 'dead';
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    ctl.abort();
  }
  if (v) cache.set(ch.key, { v, at: Date.now() });
  return v;
}

/**
 * Looks at the start of the response: MPEG-TS packets or an HLS playlist with media = live. For MPEG-TS it then
 * keeps reading a couple of seconds to see a real picture: off-air channels often send a stream that's black, a
 * still slate or sound only — those used to count as live and played as a black screen.
 */
async function sniff(stream: ReadableStream<Uint8Array>): Promise<Liveness> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  const merge = (max: number) => {
    const out = new Uint8Array(Math.min(got, max));
    let o = 0;
    for (const c of chunks) {
      if (o >= out.length) break;
      out.set(c.subarray(0, Math.min(c.length, out.length - o)), o);
      o += c.length;
    }
    return out;
  };
  const read = async (until: number, deadline: number) => {
    while (got < until && Date.now() < deadline) {
      const r = await Promise.race([reader.read(), new Promise<null>((res) => setTimeout(() => res(null), Math.max(0, deadline - Date.now())))]);
      if (!r || r.done) return false;
      if (r.value?.length) {
        chunks.push(r.value);
        got += r.value.length;
      }
    }
    return true;
  };
  try {
    await read(8192, Date.now() + TIMEOUT_MS);
    if (!got) return 'dead';
    const head = merge(8192);
    const first = judge(head, got);
    if (first === 'dead') return 'dead';
    const sync = head.indexOf(0x47);
    const isTs = sync >= 0 && sync < 188 && head[sync + 188] === 0x47;
    if (!isTs) return first; // HLS / other: the first look decides
    // MPEG-TS: ~2.5 seconds more (at most 1.5 MB) to look at the picture itself.
    await read(1_500_000, Date.now() + 2500);
    return judgePicture(merge(1_500_000)) ?? first;
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}
