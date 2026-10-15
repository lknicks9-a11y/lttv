/**
 * Platform abstraction. The same UI bundle runs:
 *  - on desktop, served by the local Node server (server/server.mjs) which provides /api/*;
 *  - on Fire TV / Android TV inside a WebView, where the Kotlin host provides the same
 *    /api/fetch endpoint (intercepted natively) plus a JavaScript bridge `LTTVNative`
 *    for native ExoPlayer playback and remote-control keys.
 */

export interface NativeBridge {
  platform(): string;
  deviceInfo(): string;
  appVersion(): string;
  play(json: string): void;
  stop(): void;
  pause(): void;
  resume(): void;
  setVideoRect(x: number, y: number, w: number, h: number, visible: boolean): void;
  setPlayerConfig(json: string): void;
  startSetupServer(): string;
  stopSetupServer(): void;
  exitApp(): void;
  keepScreenOn(on: boolean): void;
  /** Multiview tiles (0–3). */
  mvPlay(slot: number, json: string): void;
  mvStop(slot: number): void;
  mvRect(slot: number, x: number, y: number, w: number, h: number, visible: boolean): void;
  mvMute(slot: number, muted: boolean): void;
  /** Live rewind / fast forward (ms, negative = back) and back to live. Optional: older app builds lack them. */
  seekBy?(ms: number): void;
  goLive?(): void;
}

declare global {
  interface Window {
    LTTVNative?: NativeBridge;
    /** Native -> JS callbacks are dispatched through this object. */
    lttvHost?: {
      onPlayerEvent(json: string): void;
      onMultiviewEvent?(slot: number, json: string): void;
      onKey(key: string): void;
      onSetupSubmit(json: string): void;
    };
  }
}

import { undefer } from './undefer';

export const native: NativeBridge | undefined = typeof window !== 'undefined' ? window.LTTVNative : undefined;
export const isNative = !!native;
export const isTV = isNative || /\b(AFT[A-Z0-9]*|AmazonWebAppPlatform|Android TV|GoogleTV|SMART-TV|SmartTV|Tizen|Web0S)\b/i.test(navigator.userAgent) || new URLSearchParams(location.search).has('tv');

export type ServerCaps = { proxy: boolean; ffmpeg: boolean; version: string; platform: string };
let caps: ServerCaps | null = null;

/** Capabilities of the local helper (desktop server or native host). */
export async function serverCaps(): Promise<ServerCaps> {
  if (caps) return caps;
  try {
    const r = await fetch('api/caps', { cache: 'no-store' });
    if (r.ok) caps = (await r.json()) as ServerCaps;
  } catch {
    /* no helper (e.g. opened as a static file) */
  }
  caps ??= { proxy: false, ffmpeg: false, version: '', platform: 'browser' };
  return caps;
}

/** URL of the local CORS-free fetch endpoint for a remote resource. */
export function proxiedUrl(url: string, headers?: Record<string, string>, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({ url, ...extra });
  if (headers && Object.keys(headers).length) p.set('h', JSON.stringify(headers));
  return 'api/fetch?' + p.toString();
}

export class FetchError extends Error {
  constructor(message: string, public status?: number, public hint?: string) {
    super(message);
  }
}

function describeStatus(status: number): string {
  if (status >= 600 || status === 458) return `The provider refused the connection (code ${status}). This usually means it only accepts certain player apps, limits connections, or blocks your network/VPN.`;
  if (status === 401 || status === 403) return 'Access denied by the server (check your username/password or subscription).';
  if (status === 404) return 'Not found (404). Check that the URL is correct.';
  if (status === 429) return 'Too many requests (429). Wait a few minutes and retry.';
  if (status === 502) return 'Could not reach the source server (bad gateway).';
  if (status === 504) return 'The source server timed out.';
  if (status >= 500) return `The source server had an error (${status}).`;
  return `Request failed (${status}).`;
}

/**
 * Open a remote URL as a byte stream. Tries the local helper first (no CORS
 * restrictions, gzip handled server-side), and only falls back to a direct
 * browser fetch when no helper exists; a CORS failure is reported honestly.
 */
export async function openRemote(url: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<{ stream: ReadableStream<Uint8Array>; size?: number }> {
  if (!/^https?:\/\//i.test(url)) throw new FetchError('Only http:// and https:// URLs are supported.');
  const c = await serverCaps();
  let res: Response;
  try {
    res = c.proxy
      ? await fetch(proxiedUrl(url, headers, { gunzip: 'auto' }), { signal, cache: 'no-store' })
      : await fetch(url, { signal, cache: 'no-store', headers });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    if (!c.proxy) {
      throw new FetchError(
        'The browser blocked this request (CORS) or the server is unreachable.',
        undefined,
        'Run LTTV through its desktop launcher (npm start) so requests go through the local helper, or import the file instead.',
      );
    }
    throw new FetchError('Could not reach the local helper. Is the LTTV desktop server still running?');
  }
  if (res.ok && res.headers.get('x-deferred') === '1' && res.body) res = await undefer(res.body);
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.clone().json();
      detail = j?.error ?? '';
    } catch {
      /* not json */
    }
    const st = Number((detail && /answered (\d+)/.exec(detail)?.[1]) || res.status);
    throw new FetchError(st >= 600 || /answered \d+/.test(detail) ? describeStatus(st) : detail || describeStatus(res.status), st);
  }
  if (!res.body) throw new FetchError('Empty response.');
  const len = Number(res.headers.get('x-upstream-length') || res.headers.get('content-length'));
  return { stream: res.body, size: Number.isFinite(len) && len > 0 ? len : undefined };
}

/** Byte stream from a local File, transparently gunzipping .gz files where supported. */
export function openFile(file: File): { stream: ReadableStream<Uint8Array>; size: number } {
  return { stream: file.stream() as ReadableStream<Uint8Array>, size: file.size };
}
