// Is a channel's stream actually on the air? Reads the first few KB through the local helper (desktop server or
// the Fire TV host), then hangs up. Used to leave dead channels out of a game's stream list.
import type { LineupChannel } from '../core/types';
import { openRemote, serverCaps } from './platform';
import { getState, player } from './state';
import { judgeStreamStart as judge } from '../core/liveness';

export type { Liveness } from '../core/liveness';
import type { Liveness } from '../core/liveness';

const cache = new Map<string, { v: Liveness; at: number }>();
/** How long a result is trusted (a dead event channel often comes alive at game time). */
const LIVE_MS = 10 * 60_000;
const DEAD_MS = 3 * 60_000;
/** No bytes within this long = dead (a working IPTV channel starts sending within a couple of seconds). */
const TIMEOUT_MS = 7000;

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
 * Checking opens one more connection to the provider. With a one-connection plan that would knock out what's playing,
 * so channels from that provider aren't checked while something of theirs is on.
 */
export function canCheck(ch: LineupChannel): boolean {
  const s = getState();
  const max = s.playlists.find((p) => p.id === ch.playlistId)?.maxConnections;
  if (!max || max > 1) return true;
  const playing = player.currentKey && s.lineup.find((c) => c.key === player.currentKey);
  return !playing || playing.playlistId !== ch.playlistId;
}

/** 'live' / 'dead', or undefined when it can't be told here (no local helper, or the check was cancelled). */
export async function checkStream(ch: LineupChannel, signal?: AbortSignal): Promise<Liveness | undefined> {
  const hit = cachedLiveness(ch.key);
  if (hit) return hit;
  if (!(await serverCaps()).proxy || !/^https?:\/\//i.test(ch.url)) return undefined;
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
  } catch {
    // An error answer (403/404/5xx…), no answer, or nothing sent before the timeout. A cancel isn't a verdict.
    v = signal?.aborted && !timedOut ? undefined : 'dead';
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    ctl.abort();
  }
  if (v) cache.set(ch.key, { v, at: Date.now() });
  return v;
}

/** Looks at the start of the response: MPEG-TS packets or an HLS playlist with media = live. */
async function sniff(stream: ReadableStream<Uint8Array>): Promise<Liveness> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  try {
    while (got < 8192) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value?.length) {
        chunks.push(value);
        got += value.length;
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  if (!got) return 'dead';
  const head = new Uint8Array(Math.min(got, 8192));
  let o = 0;
  for (const c of chunks) {
    head.set(c.subarray(0, Math.min(c.length, head.length - o)), o);
    o += c.length;
    if (o >= head.length) break;
  }
  return judge(head, got);
}
