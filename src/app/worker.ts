/// <reference lib="webworker" />
// Background worker: decodes, decompresses and parses playlists/guides and writes
// them to IndexedDB so the UI thread never freezes, even with huge files.
import { IdbBackend } from '../core/idb';
import { Repo } from '../core/storage';
import { ingestEpg, ingestPlaylist, recomputeMatches } from '../core/pipeline';
import type { EpgSource, PlaylistSource, Settings } from '../core/types';

declare const self: DedicatedWorkerGlobalScope;

const repo = new Repo(new IdbBackend());

// Heartbeat so the page can tell a busy worker from a dead one (e.g. killed for using too much memory).
setInterval(() => self.postMessage({ type: 'alive' }), 5000);

type Start =
  | { type: 'start'; job: 'playlist'; id: string; playlist: PlaylistSource; skipVod: boolean }
  | { type: 'start'; job: 'epg'; id: string; source: EpgSource; settings: Settings }
  | { type: 'start'; job: 'match'; id: string; settings: Settings }
  | { type: 'start'; job: 'prune'; id: string; before: number };
type Msg = Start | { type: 'chunk'; id: string; buf: ArrayBuffer } | { type: 'end'; id: string } | { type: 'abort'; id: string };

interface Job {
  controller: ReadableStreamDefaultController<Uint8Array>;
  stream: ReadableStream<Uint8Array>;
}
const jobs = new Map<string, Job>();

function post(m: unknown) {
  self.postMessage(m);
}

/** Detect gzip by magic bytes and decompress, then decode UTF-8 into text chunks. */
async function* decode(bytes: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = bytes.getReader();
  const first = await reader.read();
  if (first.done) return;
  const head = first.value;
  const rest = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(head);
    },
    async pull(c) {
      const r = await reader.read();
      if (r.done) c.close();
      else c.enqueue(r.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  let src = rest;
  if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This device cannot decompress .gz files. Use an uncompressed guide URL.');
    src = rest.pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
  }
  // Honour an XML encoding declaration (e.g. ISO-8859-1) when the head is readable (not gzipped).
  let encoding = 'utf-8';
  const prolog = new TextDecoder('latin1').decode(head.subarray(0, 200));
  const enc = /<\?xml[^>]*encoding=["']([\w.-]+)["']/i.exec(prolog)?.[1];
  if (enc) {
    try {
      new TextDecoder(enc);
      encoding = enc;
    } catch {
      /* unsupported label: keep utf-8 */
    }
  }
  const text = src.pipeThrough(new TextDecoderStream(encoding) as unknown as TransformStream<Uint8Array, string>);
  const r = text.getReader();
  for (;;) {
    const { value, done } = await r.read();
    if (done) return;
    if (value) yield value;
  }
}

async function run(m: Start) {
  const progress = (p: object) => post({ type: 'progress', id: m.id, ...p });
  try {
    if (m.job === 'match') {
      const { summary } = await recomputeMatches(repo, m.settings);
      post({ type: 'done', id: m.id, result: summary });
      return;
    }
    if (m.job === 'prune') {
      const removed = await repo.pruneProgrammes(m.before);
      post({ type: 'done', id: m.id, result: { removed } });
      return;
    }
    const job = jobs.get(m.id)!;
    const text = decode(job.stream);
    if (m.job === 'playlist') {
      let all = '';
      let bytes = 0;
      for await (const s of text) {
        all += s;
        bytes += s.length;
        progress({ phase: 'Downloading playlist', bytes });
      }
      const summary = await ingestPlaylist(repo, m.playlist, all, { skipVod: m.skipVod, onProgress: progress });
      post({ type: 'done', id: m.id, result: summary });
    } else {
      const summary = await ingestEpg(repo, m.source, text, { settings: m.settings, onProgress: progress });
      post({ type: 'done', id: m.id, result: summary });
    }
  } catch (e) {
    post({ type: 'error', id: m.id, message: (e as Error)?.message || String(e) });
  } finally {
    jobs.delete(m.id);
  }
}

self.onmessage = (ev: MessageEvent<Msg>) => {
  const m = ev.data;
  if (m.type === 'start') {
    if (m.job === 'playlist' || m.job === 'epg') {
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) }, { highWaterMark: 8 });
      jobs.set(m.id, { controller, stream });
    }
    void run(m);
  } else if (m.type === 'chunk') {
    const j = jobs.get(m.id);
    if (j) {
      j.controller.enqueue(new Uint8Array(m.buf));
      post({ type: 'ack', id: m.id });
    }
  } else if (m.type === 'end') {
    jobs.get(m.id)?.controller.close();
  } else if (m.type === 'abort') {
    const j = jobs.get(m.id);
    if (j) {
      j.controller.error(new Error('Cancelled'));
      jobs.delete(m.id);
    }
  }
};
