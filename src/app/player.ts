/**
 * Playback controller shared by desktop and Fire TV.
 *  - Desktop: <video> + hls.js for HLS; MP4/WebM natively; raw MPEG-TS via the local
 *    helper's ffmpeg remux (if ffmpeg is installed). CORS/headers handled via local proxy.
 *  - Fire TV / Android: native Media3 ExoPlayer through the LTTVNative bridge; the
 *    video surface sits under the transparent WebView at the rect we report.
 * Retries with backoff, stall detection and network-recovery live here for both.
 */
import type Hls from 'hls.js';
import type { MpegtsPlayer } from 'mpegts.js';
import type { Settings } from '../core/types';
import { native, proxiedUrl, serverCaps } from './platform';

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'retrying' | 'error' | 'ended';

export interface PlayerStatus {
  state: PlayerState;
  key?: string;
  error?: string;
  attempt?: number;
  maxAttempts?: number;
  videoWidth?: number;
  videoHeight?: number;
  via?: string; // 'direct' | 'proxy' | 'remux' | 'native'
  /** Errors that retrying cannot fix (unsupported format). */
  noRetry?: boolean;
  /** Internal: retry the same URL right away (e.g. switching to the local helper after a CORS block). */
  retrySame?: boolean;
}

export interface PlayRequest {
  key: string;
  url: string;
  headers?: Record<string, string>;
  /** Other URLs for the same channel (e.g. .m3u8 vs .ts on Xtream servers), tried when one fails. */
  alternates?: string[];
  /** Called with the URL that actually played (to prefer that format next time). */
  onWorking?: (url: string) => void;
  /** A movie or episode (not live): seekable, ends, no live rewind recording. */
  vod?: boolean;
  /** Start here (seconds) — resume where it was left. */
  startSec?: number;
}

type Listener = (s: PlayerStatus) => void;

/** Where playback is inside the part of a live channel kept for rewinding. */
export interface LiveInfo {
  /** Rewind / fast forward are possible. */
  seekable: boolean;
  /** Seconds behind the live edge (0 = live). */
  behind: number;
  /** Seconds that can be rewound in total. */
  window: number;
  /** Live channel (false for movies / episodes: then window = length, behind = time left). */
  live?: boolean;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Backend {
  load(req: PlayRequest, attempt: number): void;
  stop(): void;
  pause(): void;
  resume(): void;
  setRect(r: Rect | null, slot: HTMLElement | null): void;
  /** current playback position, used for stall detection (web only) */
  position(): number | null;
  setMuted(muted: boolean): void;
  /** Move within the rewind window (seconds, negative = back). */
  seekBy(sec: number): void;
  /** Jump back to the live edge. */
  goLive(): void;
  liveInfo(): LiveInfo | null;
  /** Playback was paused on purpose: don't chase the live edge. */
  setShifted(on: boolean): void;
  /** A still of the current picture (browser only), as a data URL. */
  snapshot?(): string | undefined;
}

type StreamKind = 'hls' | 'ts' | 'progressive' | 'unknown';

export function guessKind(url: string): StreamKind {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (/\.m3u8?$/.test(path) || /[?&](type|output|format)=(m3u8|hls)/i.test(url)) return 'hls';
  if (/\.ts$/.test(path) || /[?&](type|output|format)=(ts|mpegts)/i.test(url)) return 'ts';
  if (/\.(mp4|m4v|webm|mov|mp3|aac|m4a|ogg)$/.test(path)) return 'progressive';
  return 'unknown';
}

// ---------------------------------------------------------------------------

/** Hosts whose streams failed directly (usually CORS); later channels on them go straight to the helper. */
const proxyHosts = new Set<string>();
const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return '';
  }
};

export class WebBackend implements Backend {
  readonly video: HTMLVideoElement;
  private hls: Hls | null = null;
  private HlsCtor: typeof Hls | null = null;
  private ts: MpegtsPlayer | null = null;
  private mpegts: typeof import('mpegts.js').default | null | undefined;
  private current: PlayRequest | null = null;
  private forceProxy = false;
  /** Watching behind live on purpose (rewound or paused): don't jump to the live edge. */
  private shifted = false;

  constructor(private emit: (s: Partial<PlayerStatus>) => void, private getSettings: () => Settings) {
    const v = document.createElement('video');
    v.className = 'video-layer';
    v.playsInline = true;
    v.autoplay = true;
    v.controls = false;
    v.setAttribute('tabindex', '-1');
    v.style.display = 'none';
    document.body.appendChild(v);
    this.video = v;
    v.addEventListener('playing', () => this.emit({ state: 'playing', videoWidth: v.videoWidth, videoHeight: v.videoHeight }));
    v.addEventListener('waiting', () => this.emit({ state: 'buffering' }));
    v.addEventListener('pause', () => {
      if (this.current && !v.ended) this.emit({ state: 'paused' });
    });
    v.addEventListener('error', () => {
      if (!this.current || this.hls || this.ts) return; // hls.js / mpegts.js report their own errors
      const code = v.error?.code;
      const msg = code === 4 ? 'This stream format is not supported by the browser.' : code === 2 ? 'Network error while playing.' : 'Playback failed.';
      this.emit({ state: 'error', error: msg });
    });
    v.addEventListener('ended', () => this.emit(this.current?.vod ? { state: 'ended' } : { state: 'error', error: 'The stream ended.' }));
    // Resume a movie where it was left.
    v.addEventListener('loadedmetadata', () => {
      const start = this.current?.startSec;
      if (start && start > 5 && Number.isFinite(v.duration) && start < v.duration - 10) v.currentTime = start;
    });
    // Stay near the live edge unless the viewer rewound or paused (we chase it ourselves so rewinding works).
    window.setInterval(() => this.chaseLive(), 2000);
  }

  private rewindSec() {
    return Math.min(10, Math.max(0, this.getSettings().rewindMin ?? 0)) * 60;
  }

  /** Seekable span of the stream: [earliest, live edge] in media time. */
  private span(): { start: number; edge: number; live: boolean } | null {
    const v = this.video;
    if (!this.current || v.readyState < 1) return null;
    if (Number.isFinite(v.duration) && v.duration > 0 && !this.ts && !(this.hls?.liveSyncPosition != null)) {
      return { start: 0, edge: v.duration, live: false }; // a recording / test clip
    }
    let start = Infinity;
    let end = -Infinity;
    for (const r of [v.seekable, v.buffered]) {
      for (let i = 0; i < r.length; i++) {
        start = Math.min(start, r.start(i));
        end = Math.max(end, r.end(i));
      }
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    let edge = end;
    const sync = this.hls?.liveSyncPosition;
    if (sync != null && Number.isFinite(sync)) edge = Math.max(start, sync);
    else if (this.ts) edge = Math.max(start, end - Math.max(1.5, Math.min(4, this.getSettings().bufferSec / 2)));
    return { start, edge, live: true };
  }

  liveInfo(): LiveInfo | null {
    const sp = this.span();
    if (!sp) return null;
    const t = this.video.currentTime;
    const behind = Math.max(0, sp.edge - t);
    if (!sp.live) return { seekable: true, behind: Math.max(0, sp.edge - t), window: sp.edge, live: false };
    return { seekable: sp.edge - sp.start > 3, behind: behind < 1.5 && !this.video.paused ? 0 : behind, window: Math.max(0, sp.edge - sp.start), live: true };
  }

  seekBy(sec: number) {
    const sp = this.span();
    if (!sp) return;
    const v = this.video;
    const target = v.currentTime + sec;
    if (sp.live && target >= sp.edge - 1) return this.goLive();
    this.shifted = sp.live;
    v.currentTime = Math.max(sp.start + 0.5, Math.min(sp.edge, target));
    if (v.paused) void v.play().catch(() => undefined);
  }

  goLive() {
    const sp = this.span();
    this.shifted = false;
    if (sp) this.video.currentTime = sp.live ? sp.edge : Math.max(0, sp.edge - 0.5);
    if (this.video.paused) void this.video.play().catch(() => undefined);
  }

  setShifted(on: boolean) {
    if (on) this.shifted = true;
  }

  snapshot(): string | undefined {
    const v = this.video;
    if (!this.current || v.readyState < 2 || !v.videoWidth) return undefined;
    try {
      const c = document.createElement('canvas');
      c.width = 480;
      c.height = Math.round((480 * v.videoHeight) / v.videoWidth) || 270;
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.7);
    } catch {
      return undefined; // cross-origin picture: no still
    }
  }

  private chaseLive() {
    const v = this.video;
    if (!this.current || v.paused || v.seeking) return;
    const info = this.liveInfo();
    const sp = info && this.span();
    if (!info || !sp || !sp.live) return;
    if (this.shifted) {
      if (info.behind < 1.5) this.shifted = false; // caught up (fast forward reached live)
      return;
    }
    const target = this.hls?.targetLatency;
    const maxBehind = this.ts ? Math.max(6, this.getSettings().bufferSec + 4) : Math.max(20, (target ?? 10) * 3);
    if (info.behind > maxBehind) v.currentTime = sp.edge;
  }

  position() {
    return this.current ? this.video.currentTime : null;
  }

  setMuted(muted: boolean) {
    this.video.muted = muted;
  }

  setRect(r: Rect | null, slot: HTMLElement | null) {
    const v = this.video;
    if (!r || !slot) {
      v.style.display = 'none';
      if (v.parentElement !== document.body) document.body.appendChild(v);
      return;
    }
    // Live inside the slot so overlays (spinner, errors, OSD) stack above the video naturally.
    if (v.parentElement !== slot) slot.prepend(v);
    v.style.display = 'block';
  }

  private teardown() {
    this.video.loop = false;
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.ts) {
      const t = this.ts;
      this.ts = null;
      try {
        t.pause();
        t.unload();
        t.detachMediaElement();
        t.destroy();
      } catch {
        /* already gone */
      }
    }
    this.video.removeAttribute('src');
    this.video.load();
  }

  stop() {
    this.current = null;
    this.shifted = false;
    this.teardown();
  }
  pause() {
    this.shifted = true;
    this.video.pause();
  }
  resume() {
    void this.video.play().catch(() => undefined);
  }

  load(req: PlayRequest, attempt: number) {
    const sameChannel = this.current?.key === req.key;
    this.current = req;
    this.shifted = false;
    if (!sameChannel) this.forceProxy = false;
    void this.start(req, attempt);
  }

  private async start(req: PlayRequest, attempt: number) {
    this.teardown();
    const caps = await serverCaps();
    const s = this.getSettings();
    const needHeaders = !!req.headers && Object.keys(req.headers).length > 0;
    const useProxy = caps.proxy && s.streamProxy !== 'never' &&
      (s.streamProxy === 'always' || needHeaders || this.forceProxy || proxyHosts.has(hostOf(req.url)) || (s.streamProxy === 'auto' && attempt > 0));
    let kind = guessKind(req.url);
    if (kind === 'unknown' && caps.proxy) {
      try {
        const r = await fetch('api/probe?' + new URLSearchParams({ url: req.url, ...(needHeaders ? { h: JSON.stringify(req.headers) } : {}) }));
        if (r.ok) kind = ((await r.json()) as { kind: StreamKind }).kind;
      } catch {
        /* keep unknown */
      }
    }
    if (this.current !== req) return; // superseded
    const v = this.video;

    if (kind === 'ts') {
      if (caps.ffmpeg) {
        this.emit({ via: 'remux' });
        v.src = 'api/remux?' + new URLSearchParams({ url: req.url, ...(needHeaders ? { h: JSON.stringify(req.headers) } : {}) });
        void v.play().catch(() => undefined);
        return;
      }
      // No ffmpeg: convert MPEG-TS to fragmented MP4 in the browser (mpegts.js + Media Source Extensions).
      if (this.mpegts === undefined) {
        try {
          const m = (await import('mpegts.js')).default;
          m.LoggingControl.enableAll = false;
          m.LoggingControl.enableError = true;
          // Only Media Source Extensions are required; if a codec is missing, mpegts.js reports it and we say so.
          this.mpegts = typeof MediaSource !== 'undefined' || typeof (window as unknown as { ManagedMediaSource?: unknown }).ManagedMediaSource !== 'undefined' ? m : null;
        } catch {
          this.mpegts = null;
        }
      }
      if (this.current !== req) return;
      const M = this.mpegts;
      if (M) {
        // Providers don't send CORS headers for raw streams, so go through the local helper when there is one.
        const src = caps.proxy && s.streamProxy !== 'never' ? new URL(proxiedUrl(req.url, req.headers), location.href).href : req.url;
        const p = M.createPlayer({ type: 'mpegts', isLive: true, url: src }, {
          enableWorker: false,
          lazyLoad: false,
          enableStashBuffer: true,
          stashInitialSize: 512 * 1024,
          autoCleanupSourceBuffer: true,
          // Keep what was watched for live rewind; the live edge is chased in chaseLive() instead
          // of by mpegts.js, so rewinding isn't undone.
          autoCleanupMaxBackwardDuration: Math.max(60, this.rewindSec() + 30),
          autoCleanupMinBackwardDuration: Math.max(30, this.rewindSec()),
          liveBufferLatencyChasing: false,
          fixAudioTimestampGap: true,
        });
        this.ts = p;
        this.emit({ via: caps.proxy ? 'mpegts+proxy' : 'mpegts' });
        p.on(M.Events.ERROR, (...args: unknown[]) => {
          if (this.ts !== p) return;
          const [type, detail, info] = args as [string, string, { msg?: string; code?: number } | undefined];
          const text = `${detail ?? ''} ${info?.msg ?? ''}`;
          if (type === M.ErrorTypes.MEDIA_ERROR || /codec|unsupported|not supported|MSE/i.test(text)) {
            this.emit({ state: 'error', noRetry: true, error: "This browser can't decode this channel's video or audio format (common with HEVC or AC-3 audio). Try another stream format, Chrome/Edge, or the Fire TV app." });
          } else if (info?.code === 401 || info?.code === 403) {
            this.emit({ state: 'error', error: `Access denied by the stream server (${info.code}). Your subscription or connection limit may be the cause.` });
          } else if (info?.code === 404) {
            this.emit({ state: 'error', error: 'Stream not found (404). The channel may be offline.' });
          } else {
            this.emit({ state: 'error', error: 'The stream connection dropped.' });
          }
        });
        p.attachMediaElement(v);
        p.load();
        void Promise.resolve(p.play()).catch(() => undefined);
        return;
      }
      this.emit({
        state: 'error',
        noRetry: true,
        error: 'This channel is a raw MPEG-TS stream and this browser can’t convert it (no Media Source Extensions). Use Chrome, Edge or Firefox, install ffmpeg for the desktop helper, or watch on Fire TV.',
      });
      return;
    }

    const hlsUrl = useProxy ? proxiedUrl(req.url, req.headers, { mode: 'hls' }) : req.url;
    const nativeHls = v.canPlayType('application/vnd.apple.mpegurl') !== '';
    if (kind === 'hls' || kind === 'unknown') {
      if (!this.HlsCtor) {
        try {
          this.HlsCtor = (await import('hls.js')).default;
        } catch {
          this.HlsCtor = null;
        }
      }
      const H = this.HlsCtor;
      if (H && H.isSupported()) {
        this.emit({ via: useProxy ? 'proxy' : 'direct' });
        const hls = new H({
          enableWorker: false,
          lowLatencyMode: false,
          // Keep what was watched so it can be rewound (live rewind); trimmed if memory runs short.
          backBufferLength: Math.max(30, this.rewindSec()),
          // A deeper buffer and patient segment retries ride out the hiccups IPTV servers have.
          maxBufferLength: Math.max(15, s.bufferSec * 2),
          maxMaxBufferLength: 60,
          maxBufferHole: 1,
          liveSyncDurationCount: 3,
          // Never jump to live by itself: chaseLive() does that unless the viewer rewound.
          liveMaxLatencyDurationCount: Infinity,
          startFragPrefetch: true,
          nudgeMaxRetry: 8,
          manifestLoadingTimeOut: s.stallTimeoutSec * 1000,
          manifestLoadingMaxRetry: 2,
          levelLoadingTimeOut: s.stallTimeoutSec * 1000,
          levelLoadingMaxRetry: 4,
          fragLoadingTimeOut: Math.max(20000, s.stallTimeoutSec * 1000),
          fragLoadingMaxRetry: 6,
          fragLoadingRetryDelay: 1000,
        });
        let recoveredAt = 0;
        this.hls = hls;
        hls.on(H.Events.ERROR, (_e, data) => {
          if (this.hls !== hls) return;
          if (/bufferAddCodecError|bufferIncompatibleCodecsError|manifestIncompatibleCodecsError/.test(data.details)) {
            this.emit({ state: 'error', noRetry: true, error: "This browser can't decode this channel's video format (often H.264/HEVC in Chromium builds without proprietary codecs). Try Chrome, Edge, Safari or the Fire TV app." });
            hls.destroy();
            this.hls = null;
            return;
          }
          if (data.details === 'bufferFullError') {
            // Out of memory for video: keep less for rewinding.
            const v0 = this.video;
            const back = v0.buffered.length ? v0.currentTime - v0.buffered.start(0) : 0;
            hls.config.backBufferLength = Math.max(20, Math.floor(back * 0.6));
          }
          if (!data.fatal) return;
          if (data.type === H.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
            return;
          }
          // A segment or playlist refresh failed mid-stream: resume loading once before giving up.
          const status0 = (data.response as { code?: number } | undefined)?.code;
          if (data.type === H.ErrorTypes.NETWORK_ERROR && !/manifest/i.test(data.details) && status0 !== 401 && status0 !== 403 && Date.now() - recoveredAt > 30_000) {
            recoveredAt = Date.now();
            hls.startLoad();
            return;
          }
          const status = (data.response as { code?: number } | undefined)?.code;
          let msg = 'Could not load the stream.';
          if (data.details === 'manifestParsingError') msg = kind === 'unknown' ? 'This stream is not HLS and the browser cannot play it.' : 'The stream returned invalid data.';
          else if (status === 401 || status === 403) msg = 'Access denied by the stream server (403). Your subscription or token may have expired.';
          else if (status === 404) msg = 'Stream not found (404). The channel may be offline.';
          else if (!status && !useProxy && caps.proxy) {
            // Probably CORS: retry through the local helper.
            this.forceProxy = true;
            proxyHosts.add(hostOf(req.url));
            msg = 'Direct connection blocked; retrying through the local helper.';
            this.emit({ state: 'error', error: msg, retrySame: true });
            return;
          } else if (!status) msg = 'Network error: the stream server could not be reached.';
          this.emit({ state: 'error', error: msg });
        });
        hls.on(H.Events.MANIFEST_PARSED, () => void v.play().catch(() => undefined));
        // Non-live playlists (e.g. the bundled demo) loop instead of "ending" like a dead channel.
        hls.on(H.Events.LEVEL_LOADED, (_e, data) => {
          v.loop = !data.details.live;
        });
        hls.loadSource(hlsUrl);
        hls.attachMedia(v);
        return;
      }
      if (nativeHls) {
        this.emit({ via: useProxy ? 'proxy' : 'direct' });
        v.src = hlsUrl;
        void v.play().catch(() => undefined);
        return;
      }
      if (kind === 'hls') {
        this.emit({ state: 'error', noRetry: true, error: 'This browser cannot play HLS streams.' });
        return;
      }
    }
    // progressive
    this.emit({ via: useProxy ? 'proxy' : 'direct' });
    v.src = useProxy ? proxiedUrl(req.url, req.headers) : req.url;
    void v.play().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------

/** Multiview tile event handlers, by slot. */
const tileHandlers = new Map<number, (json: string) => void>();

class NativeBackend implements Backend {
  private live: LiveInfo | null = null;
  /** slot = Multiview tile (0–3); undefined = the main player. */
  constructor(private emit: (s: Partial<PlayerStatus>) => void, getSettings: () => Settings, private slot?: number) {
    window.lttvHost = window.lttvHost ?? ({} as NonNullable<Window['lttvHost']>);
    const handle = (json: string) => {
      try {
        const ev = JSON.parse(json) as { type?: string; state: PlayerState; error?: string; width?: number; height?: number; fatal?: boolean; behind?: number; window?: number; seekable?: boolean; live?: boolean };
        if (ev.type === 'live') {
          this.live = { seekable: !!ev.seekable, behind: Math.max(0, (ev.behind ?? 0) / 1000), window: Math.max(0, (ev.window ?? 0) / 1000), live: ev.live !== false };
          return;
        }
        this.emit({ state: ev.state, error: ev.error, videoWidth: ev.width, videoHeight: ev.height, via: 'native', noRetry: ev.fatal });
      } catch {
        /* ignore */
      }
    };
    if (slot === undefined) {
      window.lttvHost.onPlayerEvent = handle;
      const s = getSettings();
      native!.setPlayerConfig(JSON.stringify({ bufferSec: s.bufferSec, timeoutSec: s.stallTimeoutSec, rewindMin: s.rewindMin ?? 30 }));
    } else {
      tileHandlers.set(slot, handle);
      window.lttvHost.onMultiviewEvent = (i: number, json: string) => tileHandlers.get(i)?.(json);
    }
  }
  position() {
    return null;
  }
  liveInfo() {
    return this.slot === undefined ? this.live : null;
  }
  seekBy(sec: number) {
    if (this.slot === undefined) native!.seekBy?.(Math.round(sec * 1000));
  }
  goLive() {
    if (this.slot === undefined) native!.goLive?.();
  }
  setShifted() {
    /* the native player keeps its place when paused */
  }
  load(req: PlayRequest) {
    this.live = null;
    const json = JSON.stringify({ url: req.url, headers: req.headers ?? {}, key: req.key, vod: !!req.vod, startMs: Math.round((req.startSec ?? 0) * 1000) });
    if (this.slot === undefined) native!.play(json);
    else native!.mvPlay(this.slot, json);
  }
  stop() {
    if (this.slot === undefined) native!.stop();
    else native!.mvStop(this.slot);
  }
  pause() {
    if (this.slot === undefined) native!.pause();
    else native!.mvMute(this.slot, true);
  }
  resume() {
    if (this.slot === undefined) native!.resume();
  }
  setMuted(muted: boolean) {
    if (this.slot !== undefined) native!.mvMute(this.slot, muted);
  }
  setRect(r: Rect | null) {
    const [x, y, w, h, v] = r ? [Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h), true] : [0, 0, 0, 0, false];
    if (this.slot === undefined) native!.setVideoRect(x, y, w, h, v);
    else native!.mvRect(this.slot, x, y, w, h, v);
  }
}

// ---------------------------------------------------------------------------
// Transparent holes in the page backdrop (TV): one per visible native video.

const holes = new Map<number, Rect>();
let holeSeq = 0;
function applyHoles() {
  const root = document.documentElement;
  if (!holes.size) {
    root.style.removeProperty('--hole');
    root.classList.remove('has-hole');
    return;
  }
  const W = window.innerWidth;
  const H = window.innerHeight;
  const p = (x: number, y: number) => `${((x / W) * 100).toFixed(3)}% ${((y / H) * 100).toFixed(3)}%`;
  // Outer rectangle, then each hole traced from and back to the origin (evenodd cuts them out).
  let poly = 'polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%';
  for (const r of holes.values()) {
    const x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
    poly += `, ${p(x1, y1)}, ${p(x2, y1)}, ${p(x2, y2)}, ${p(x1, y2)}, ${p(x1, y1)}, 0% 0%`;
  }
  root.style.setProperty('--hole', poly + ')');
  root.classList.add('has-hole');
}

// ---------------------------------------------------------------------------

export class PlayerController {
  private backend: Backend;
  private listeners = new Set<Listener>();
  status: PlayerStatus = { state: 'idle' };
  private req: PlayRequest | null = null;
  private attempt = 0;
  /** Index into [req.url, ...req.alternates] currently playing. */
  private urlIndex = 0;
  private workingIndex: number | undefined;
  private retryTimer: number | undefined;
  private stallTimer: number | undefined;
  private lastPos = -1;
  private lastProgressAt = 0;
  private slots: { id: number; el: HTMLElement; priority: number }[] = [];
  private slotSeq = 0;
  private rectRaf = 0;
  private holeId = ++holeSeq;

  /** opts.slot: a Multiview tile (0–3). */
  constructor(private getSettings: () => Settings, opts: { slot?: number } = {}) {
    const emit = (s: Partial<PlayerStatus>) => this.onBackendStatus(s);
    this.backend = native ? new NativeBackend(emit, getSettings, opts.slot) : new WebBackend(emit, getSettings);
    window.addEventListener('online', () => {
      if (this.req && (this.status.state === 'error' || this.status.state === 'retrying')) this.reload();
    });
    window.addEventListener('resize', () => this.updateRect());
    this.stallTimer = window.setInterval(() => this.checkStall(), 2000);
  }

  get isNative() {
    return !!native;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.status);
    return () => this.listeners.delete(l);
  }

  private set(s: Partial<PlayerStatus>) {
    this.status = { ...this.status, ...s };
    for (const l of this.listeners) l(this.status);
  }

  private urls(req: PlayRequest): string[] {
    return [req.url, ...(req.alternates ?? [])];
  }

  /** The request for the URL variant currently being tried (same key, so the backend treats it as one channel). */
  private variant(req: PlayRequest): PlayRequest {
    const list = this.urls(req);
    return { ...req, url: list[this.urlIndex % list.length] };
  }

  private onBackendStatus(s: Partial<PlayerStatus>) {
    if (!this.req) return;
    // A failed stream also fires "pause"/"waiting" on the way down; keep showing the error.
    if ((s.state === 'paused' || s.state === 'buffering') && this.status.state === 'error') return;
    if (s.state === 'error' && s.retrySame) {
      const req = this.req;
      this.set({ state: 'retrying', error: s.error });
      window.clearTimeout(this.retryTimer);
      this.retryTimer = window.setTimeout(() => this.req === req && this.backend.load(this.variant(req), this.attempt), 100);
      return;
    }
    if (s.state === 'error') {
      const req = this.req;
      const list = this.urls(req);
      // First try the channel's other formats straight away (also for "unsupported format").
      if (this.urlIndex < list.length - 1) {
        this.urlIndex++;
        this.set({ ...s, state: 'retrying', error: 'Trying another stream format…', attempt: this.attempt, maxAttempts: this.getSettings().playbackRetries });
        window.clearTimeout(this.retryTimer);
        this.retryTimer = window.setTimeout(() => this.req === req && this.backend.load(this.variant(req), this.attempt), 300);
        return;
      }
      const max = this.getSettings().playbackRetries;
      if (this.attempt < max && !s.noRetry) {
        this.attempt++;
        if (list.length > 1) this.urlIndex = this.workingIndex ?? 0;
        const delay = Math.min(8000, 1000 * 2 ** (this.attempt - 1));
        this.set({ ...s, state: 'retrying', attempt: this.attempt, maxAttempts: max });
        window.clearTimeout(this.retryTimer);
        this.retryTimer = window.setTimeout(() => this.req === req && this.backend.load(this.variant(req), this.attempt), delay);
        return;
      }
      this.set({ ...s, state: 'error' });
      return;
    }
    if (s.state === 'playing') {
      if (this.workingIndex !== this.urlIndex) {
        this.workingIndex = this.urlIndex;
        this.req.onWorking?.(this.variant(this.req).url);
      }
      this.attempt = 0;
      this.lastProgressAt = Date.now();
      this.set({ ...s, error: undefined, attempt: undefined, noRetry: undefined });
      return;
    }
    this.set(s);
  }

  private checkStall() {
    if (!this.req || this.status.state === 'paused' || this.status.state === 'error' || this.status.state === 'retrying' || this.status.state === 'ended') return;
    const pos = this.backend.position();
    if (pos === null) return; // native handles its own stalls
    if (pos !== this.lastPos) {
      this.lastPos = pos;
      this.lastProgressAt = Date.now();
      return;
    }
    const limit = this.getSettings().stallTimeoutSec * 1000;
    if (Date.now() - this.lastProgressAt > limit) {
      this.lastProgressAt = Date.now();
      this.onBackendStatus({ state: 'error', error: 'The stream stopped responding.' });
    }
  }

  play(req: PlayRequest) {
    window.clearTimeout(this.retryTimer);
    this.req = req;
    this.attempt = 0;
    this.urlIndex = 0;
    this.workingIndex = undefined;
    this.lastPos = -1;
    this.lastProgressAt = Date.now();
    this.set({ state: 'loading', key: req.key, error: undefined, attempt: undefined, noRetry: undefined, videoWidth: undefined, videoHeight: undefined });
    this.backend.load(this.variant(req), 0);
    this.updateRect();
  }

  /** Manual retry (user pressed Retry). */
  reload() {
    if (!this.req) return;
    this.play(this.req);
  }

  stop() {
    window.clearTimeout(this.retryTimer);
    this.req = null;
    this.backend.stop();
    this.set({ state: 'idle', key: undefined, error: undefined });
    this.updateRect();
  }

  /** Live rewind / fast forward by `sec` seconds (negative = back). */
  seekBy(sec: number) {
    if (!this.req) return;
    this.lastProgressAt = Date.now();
    this.backend.seekBy(sec);
    if (this.status.state === 'paused') this.set({ state: 'playing' });
  }

  /** Back to the live edge. */
  goLive() {
    if (!this.req) return;
    this.lastProgressAt = Date.now();
    this.backend.goLive();
    if (this.status.state === 'paused') this.set({ state: 'playing' });
  }

  liveInfo(): LiveInfo | null {
    return this.req ? this.backend.liveInfo() : null;
  }

  /** Still of the current picture (browser only). */
  snapshot(): string | undefined {
    return this.req ? this.backend.snapshot?.() : undefined;
  }

  togglePause() {
    if (!this.req) return;
    if (this.status.state === 'paused') {
      this.backend.resume();
      this.set({ state: 'playing' });
    } else {
      this.backend.pause();
      this.set({ state: 'paused' });
    }
  }

  get currentKey() {
    return this.req?.key;
  }

  setMuted(muted: boolean) {
    this.backend.setMuted(muted);
  }

  // ---- video placement ----
  /** Register an element whose box the video should occupy. Highest priority (then newest) wins. */
  registerSlot(el: HTMLElement, priority = 0): () => void {
    const id = ++this.slotSeq;
    this.slots.push({ id, el, priority });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.updateRect()) : null;
    ro?.observe(el);
    this.updateRect();
    return () => {
      ro?.disconnect();
      this.slots = this.slots.filter((s) => s.id !== id);
      this.updateRect();
    };
  }

  updateRect() {
    cancelAnimationFrame(this.rectRaf);
    this.rectRaf = requestAnimationFrame(() => {
      const live = this.slots.filter((s) => s.el.isConnected);
      live.sort((a, b) => a.priority - b.priority || a.id - b.id);
      const slot = live[live.length - 1];
      if (!slot || !this.req) {
        this.backend.setRect(null, null);
        if (holes.delete(this.holeId)) applyHoles();
        return;
      }
      const r = slot.el.getBoundingClientRect();
      const rect = { x: r.left, y: r.top, w: r.width, h: r.height };
      this.backend.setRect(rect, slot.el);
      if (native) {
        // Cut a transparent hole in the page backdrop so the native video shows through.
        holes.set(this.holeId, rect);
        applyHoles();
      }
    });
  }
}
