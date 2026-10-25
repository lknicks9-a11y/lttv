// Is a channel's stream actually on the air with a picture? Samples a couple of seconds through the local helper
// (desktop server or the Fire TV host), then hangs up: dead (error / nothing), blank (a black or still picture,
// judged by bitrate on the stream's own clock) or live. Used to leave dead and blank channels out of game lists.
import type { LineupChannel } from '../core/types';
import { openRemote, serverCaps } from './platform';
import { getState, player } from './state';
import { isTs, judgeBitrate, judgeStreamStart as judge, pickHlsSegment, pickHlsVariant, tsBitrate } from '../core/liveness';

export type { Liveness } from '../core/liveness';
import type { Liveness } from '../core/liveness';

const cache = new Map<string, { v: Liveness; at: number }>();
/** How long a result is trusted (a dead event channel often comes alive at game time). */
const LIVE_MS = 10 * 60_000;
const DEAD_MS = 3 * 60_000;
/** No bytes within this long = dead (a working IPTV channel starts sending within a couple of seconds). */
const TIMEOUT_MS = 7000;
/** How much of a raw stream is sampled to judge the picture (stream-clock seconds / bytes / wall time). */
const SAMPLE_BYTES = 3 * 1024 * 1024;
const SAMPLE_MS = 5000;
/** A provider that refused a check (401/403) isn't checked again for a while: extra knocking can extend a ban. */
const refusedUntil = new Map<string, number>();
const REFUSED_PAUSE_MS = 15 * 60_000;

export function cachedLiveness(key: string): Liveness | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  if (Date.now() - e.at > (e.v === 'live' ? LIVE_MS : DEAD_MS)) { // blank like dead: rechecked soon (a slate before a game)
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
    window.clearTimeout(timer); // it answered: now sample it (bounded by SAMPLE_MS)
    v = await sniff(stream, ch, ctl.signal);
  } catch (e) {
    // An error answer (403/404/5xx…), no answer, or nothing sent before the timeout. A cancel isn't a verdict.
    const st = (e as { status?: number }).status;
    if (st === 401 || st === 403) {
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
 * Looks at what came: MPEG-TS → sample ~2–3 s and judge the picture by bitrate; an HLS playlist → measure one recent
 * segment; anything else → judged by its start.
 */
async function sniff(stream: ReadableStream<Uint8Array>, ch: LineupChannel, signal: AbortSignal): Promise<Liveness> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  let kind: 'ts' | 'hls' | 'other' | undefined;
  let nextLook = 400 * 1024;
  const until = Date.now() + SAMPLE_MS;
  try {
    while (got < SAMPLE_BYTES && Date.now() < until) {
      const r = await Promise.race([reader.read(), new Promise<null>((ok) => setTimeout(() => ok(null), Math.max(0, until - Date.now())))]);
      if (!r || r.done) break;
      if (r.value?.length) {
        chunks.push(r.value);
        got += r.value.length;
      }
      if (!kind && got >= 1024) {
        const head = join(chunks, 8192);
        if (judge(head, got) === 'dead') return 'dead';
        kind = new TextDecoder().decode(head.subarray(0, 32)).trimStart().startsWith('#EXTM3U') ? 'hls' : isTs(head) ? 'ts' : 'other';
        if (kind !== 'ts') break; // a playlist is short; other formats: the start is enough
      }
      // A raw stream: stop once ~2 s of its own clock is in (checked every few hundred KB).
      if (kind === 'ts' && got >= nextLook) {
        nextLook = got + 256 * 1024;
        const bps = tsBitrate(join(chunks, got));
        if (bps !== undefined && got > 400 * 1024) break;
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  if (!got) return 'dead';
  const all = join(chunks, got);
  if (kind === 'hls' || new TextDecoder().decode(all.subarray(0, 16)).trimStart().startsWith('#EXTM3U')) return hlsPicture(new TextDecoder().decode(all), ch, signal);
  const start = judge(all.subarray(0, 8192), got);
  if (start !== 'live') return start;
  // Raw MPEG-TS: judge the picture; too little stream clock to tell → it's sending, call it live.
  return judgeBitrate(tsBitrate(all)) ?? 'live';
}

function join(chunks: Uint8Array[], max: number): Uint8Array {
  const total = Math.min(max, chunks.reduce((n, c) => n + c.length, 0));
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    if (o >= total) break;
    const part = c.subarray(0, Math.min(c.length, total - o));
    out.set(part, o);
    o += part.length;
  }
  return out;
}

/** HLS: follow a master playlist to a variant, fetch one recent segment, and judge its bitrate. */
async function hlsPicture(text: string, ch: LineupChannel, signal: AbortSignal): Promise<Liveness> {
  try {
    let base = ch.url;
    let media = text;
    const variant = pickHlsVariant(text);
    if (variant) {
      base = new URL(variant, base).href;
      media = await fetchText(base, ch, signal);
    }
    const seg = pickHlsSegment(media);
    if (!seg) return /#EXTINF/.test(media) ? 'live' : 'dead';
    const { stream } = await openRemote(new URL(seg.uri, base).href, signal, ch.headers);
    const reader = stream.getReader();
    let bytes = 0;
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        bytes += r.value?.length ?? 0;
        if (bytes > 12 * 1024 * 1024) break;
      }
    } finally {
      void reader.cancel().catch(() => undefined);
    }
    if (!bytes) return 'dead';
    return judgeBitrate((bytes * 8) / seg.dur) ?? 'live';
  } catch {
    // The playlist answered; a segment that won't load is a broken channel.
    return signal.aborted ? 'live' : 'dead';
  }
}

async function fetchText(url: string, ch: LineupChannel, signal: AbortSignal): Promise<string> {
  const { stream } = await openRemote(url, signal, ch.headers);
  return new Response(stream).text();
}
