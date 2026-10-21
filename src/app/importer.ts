import { currentDbName } from './accounts';
import type { EpgSource, PlaylistSource, Settings } from '../core/types';
import type { EpgImportSummary, MatchSummary, PlaylistImportSummary } from '../core/pipeline';
import { openFile, openRemote } from './platform';

export interface JobProgress {
  phase: string;
  bytes?: number;
  total?: number;
  items?: number;
}

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: (p: JobProgress) => void;
  acks: number;
  ackWaiters: (() => void)[];
  total?: number;
  dead?: boolean;
};

function finish(id: string, p: Pending) {
  pending.delete(id);
  p.dead = true;
  for (const w of p.ackWaiters.splice(0)) w();
}

let worker: Worker | null = null;
let lastSeen = Date.now();
const STALL_MS = 90_000;

/** If the worker stops answering (crash/out of memory), fail its jobs instead of waiting forever. */
setInterval(() => {
  if (!worker || !pending.size || Date.now() - lastSeen < STALL_MS) return;
  worker.terminate();
  worker = null;
  for (const [id, p] of pending) {
    finish(id, p);
    p.reject(new Error('The background worker stopped responding. The playlist or guide may be too large for this device’s memory — try again, or use a smaller guide (e.g. 3 days instead of 14).'));
  }
}, 10_000);
const pending = new Map<string, Pending>();
let seq = 0;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(`worker.js?db=${encodeURIComponent(currentDbName())}`);
  lastSeen = Date.now();
  worker.onmessage = (ev) => {
    lastSeen = Date.now();
    const m = ev.data as { type: string; id: string; [k: string]: unknown };
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'ack') {
      p.acks++;
      p.ackWaiters.shift()?.();
    } else if (m.type === 'progress') {
      p.onProgress?.({ phase: String(m.phase ?? ''), bytes: m.bytes as number, items: m.items as number, total: p.total });
    } else if (m.type === 'done') {
      finish(m.id, p);
      p.resolve(m.result);
    } else if (m.type === 'error') {
      finish(m.id, p);
      p.reject(new Error(String(m.message)));
    }
  };
  worker.onerror = (e) => {
    for (const [id, p] of pending) {
      finish(id, p);
      p.reject(new Error('Background worker failed: ' + (e.message || 'unknown error')));
    }
    worker = null;
  };
  return worker;
}

export type InputSource = { url: string; headers?: Record<string, string> } | { file: File };

async function pump(id: string, input: InputSource, p: Pending, signal?: AbortSignal) {
  const w = getWorker();
  const { stream, size } = 'file' in input ? openFile(input.file) : await openRemote(input.url, signal, input.headers);
  p.total = size;
  const reader = stream.getReader();
  let sent = 0;
  let bytes = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const { value, done } = await reader.read();
      if (done) break;
      // Flow control: at most 6 chunks in flight so huge downloads don't pile up in memory.
      while (!p.dead && sent - p.acks >= 6) await new Promise<void>((r) => p.ackWaiters.push(r));
      if (p.dead) {
        await reader.cancel().catch(() => undefined);
        return; // the worker already finished (usually with an error)
      }
      const copy = value.byteOffset === 0 && value.byteLength === value.buffer.byteLength ? value.buffer : value.slice().buffer;
      bytes += value.byteLength;
      w.postMessage({ type: 'chunk', id, buf: copy }, [copy as ArrayBuffer]);
      sent++;
      p.onProgress?.({ phase: 'Downloading', bytes, total: size });
    }
    w.postMessage({ type: 'end', id });
  } catch (e) {
    w.postMessage({ type: 'abort', id });
    throw e;
  }
}

function start<T>(msg: Record<string, unknown>, input: InputSource | null, onProgress?: (p: JobProgress) => void, signal?: AbortSignal): Promise<T> {
  const id = 'job' + ++seq;
  const w = getWorker();
  if (!pending.size) lastSeen = Date.now();
  return new Promise<T>((resolve, reject) => {
    const p: Pending = { resolve: resolve as (v: unknown) => void, reject, onProgress, acks: 0, ackWaiters: [] };
    pending.set(id, p);
    w.postMessage({ type: 'start', id, ...msg });
    if (input) {
      pump(id, input, p, signal).catch((e: Error) => {
        finish(id, p);
        reject(e);
      });
    }
  });
}

export function importPlaylist(playlist: PlaylistSource, input: InputSource, opts: { skipVod?: boolean; onProgress?: (p: JobProgress) => void; signal?: AbortSignal } = {}) {
  return start<PlaylistImportSummary>({ job: 'playlist', playlist, skipVod: opts.skipVod !== false }, input, opts.onProgress, opts.signal);
}

export function importEpg(source: EpgSource, settings: Settings, input: InputSource, opts: { onProgress?: (p: JobProgress) => void; signal?: AbortSignal } = {}) {
  return start<EpgImportSummary>({ job: 'epg', source, settings }, input, opts.onProgress, opts.signal);
}

export function rematch(settings: Settings) {
  return start<MatchSummary>({ job: 'match', settings }, null);
}

/** Match only channels that have no match yet (startup). */
export function matchMissingChannels(settings: Settings) {
  return start<{ matched: number }>({ job: 'matchMissing', settings } as never, null);
}

export function pruneGuide(before: number) {
  return start<{ removed: number }>({ job: 'prune', before }, null);
}
