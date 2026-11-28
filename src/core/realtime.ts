// A small client for Supabase Realtime (the Phoenix channel protocol, JSON v1): one channel with presence (who's
// here) and broadcast messages. Used to link the LTTV phone page with your TVs through your own account's project.
// No library: the protocol is a handful of JSON messages over one WebSocket, and this runs on old Fire TV engines.

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}
export type WebSocketCtor = new (url: string) => WebSocketLike;

export interface PresenceMember {
  /** The presence key (one per device / phone). */
  key: string;
  meta: Record<string, unknown>;
}

export type LinkStatus = 'connecting' | 'joined' | 'offline';

export interface RealtimeOptions {
  /** The Supabase project URL (https://xyz.supabase.co). */
  url: string;
  apiKey: string;
  /** The channel's name (both sides use the same). */
  topic: string;
  /** This end's presence key. */
  presenceKey: string;
  onBroadcast?: (event: string, payload: Record<string, unknown>) => void;
  onPresence?: (members: PresenceMember[]) => void;
  onStatus?: (s: LinkStatus) => void;
  /** For tests. */
  WebSocket?: WebSocketCtor;
  /** For tests: setTimeout / clearTimeout stand-ins. */
  timers?: { set(fn: () => void, ms: number): unknown; clear(t: unknown): void };
}

interface Msg {
  topic: string;
  event: string;
  payload: Record<string, unknown>;
  ref: string | null;
  join_ref?: string | null;
}

type Metas = { phx_ref?: string; [k: string]: unknown }[];

const HEARTBEAT_MS = 25_000;
const BACKOFF = [1000, 2000, 5000, 10_000, 20_000];

export function socketUrl(projectUrl: string, apiKey: string): string {
  return `${projectUrl.replace(/\/+$/, '').replace(/^http/i, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(apiKey)}&vsn=1.0.0`;
}

export class RealtimeLink {
  private ws: WebSocketLike | null = null;
  private refN = 0;
  private joinRef: string | null = null;
  private joined = false;
  private stopped = true;
  private tries = 0;
  private hb: unknown;
  private retry: unknown;
  private meta: Record<string, unknown> | null = null;
  private presence = new Map<string, Metas>();
  private readonly t: NonNullable<RealtimeOptions['timers']>;
  private readonly topic: string;
  private readonly o: RealtimeOptions;

  constructor(o: RealtimeOptions) {
    this.o = o;
    this.t = o.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (x) => clearTimeout(x as ReturnType<typeof setTimeout>) };
    this.topic = `realtime:${o.topic}`;
  }

  get isJoined(): boolean {
    return this.joined;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.t.clear(this.hb);
    this.t.clear(this.retry);
    this.joined = false;
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
    this.o.onStatus?.('offline');
  }

  /** Send a broadcast to everyone else on the channel. False when not connected right now. */
  send(event: string, payload: Record<string, unknown>): boolean {
    if (!this.joined) return false;
    return this.push('broadcast', { type: 'broadcast', event, payload });
  }

  /** What this end tells the others about itself (kept up after a reconnect). */
  track(meta: Record<string, unknown>): void {
    this.meta = meta;
    if (this.joined) this.push('presence', { type: 'presence', event: 'track', payload: meta });
  }

  members(): PresenceMember[] {
    const out: PresenceMember[] = [];
    for (const [key, metas] of this.presence) {
      const last = metas[metas.length - 1];
      if (last) {
        const { phx_ref: _r, ...meta } = last;
        out.push({ key, meta });
      }
    }
    return out;
  }

  private ref(): string {
    this.refN += 1;
    return String(this.refN);
  }

  private push(event: string, payload: Record<string, unknown>, topic = this.topic): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    const msg: Msg = { topic, event, payload, ref: this.ref(), join_ref: topic === this.topic ? this.joinRef : null };
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  private open() {
    if (this.stopped) return;
    this.o.onStatus?.('connecting');
    const Ctor = this.o.WebSocket ?? (globalThis as unknown as { WebSocket: WebSocketCtor }).WebSocket;
    let ws: WebSocketLike;
    try {
      ws = new Ctor(socketUrl(this.o.url, this.o.apiKey));
    } catch {
      this.later();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.joinRef = this.ref();
      const join: Msg = {
        topic: this.topic,
        event: 'phx_join',
        payload: { config: { broadcast: { self: false, ack: false }, presence: { key: this.o.presenceKey }, private: false }, access_token: this.o.apiKey },
        ref: this.joinRef,
        join_ref: this.joinRef,
      };
      ws.send(JSON.stringify(join));
      this.beat();
    };
    ws.onmessage = (ev) => this.onMessage(String(ev.data));
    ws.onclose = () => this.dropped(ws);
    ws.onerror = () => this.dropped(ws);
  }

  private beat() {
    this.t.clear(this.hb);
    this.hb = this.t.set(() => {
      this.push('heartbeat', {}, 'phoenix');
      this.beat();
    }, HEARTBEAT_MS);
  }

  private dropped(ws: WebSocketLike) {
    if (ws !== this.ws) return;
    this.ws = null;
    this.joined = false;
    this.t.clear(this.hb);
    this.presence.clear();
    this.o.onPresence?.([]);
    try {
      ws.close();
    } catch {
      /* closed */
    }
    this.later();
  }

  private later() {
    if (this.stopped) return;
    this.o.onStatus?.('offline');
    const ms = BACKOFF[Math.min(this.tries, BACKOFF.length - 1)];
    this.tries += 1;
    this.t.clear(this.retry);
    this.retry = this.t.set(() => this.open(), ms);
  }

  private onMessage(raw: string) {
    let m: Msg;
    try {
      m = JSON.parse(raw) as Msg;
    } catch {
      return;
    }
    if (m.topic !== this.topic) return;
    const p = m.payload ?? {};
    switch (m.event) {
      case 'phx_reply':
        if (m.ref === this.joinRef) {
          if ((p as { status?: string }).status === 'ok') {
            this.joined = true;
            this.tries = 0;
            this.o.onStatus?.('joined');
            if (this.meta) this.track(this.meta);
          } else if (this.ws) {
            this.dropped(this.ws);
          }
        }
        return;
      case 'phx_error':
      case 'phx_close':
        if (this.ws) this.dropped(this.ws);
        return;
      case 'broadcast': {
        const b = p as { event?: string; payload?: Record<string, unknown> };
        if (b.event) this.o.onBroadcast?.(b.event, b.payload ?? {});
        return;
      }
      case 'presence_state':
        this.presence.clear();
        for (const [key, v] of Object.entries(p)) this.presence.set(key, [...(((v as { metas?: Metas }).metas) ?? [])]);
        this.o.onPresence?.(this.members());
        return;
      case 'presence_diff': {
        const d = p as { joins?: Record<string, { metas?: Metas }>; leaves?: Record<string, { metas?: Metas }> };
        for (const [key, v] of Object.entries(d.leaves ?? {})) {
          const gone = new Set((v.metas ?? []).map((x) => x.phx_ref));
          const left = (this.presence.get(key) ?? []).filter((x) => !gone.has(x.phx_ref));
          if (left.length) this.presence.set(key, left);
          else this.presence.delete(key);
        }
        for (const [key, v] of Object.entries(d.joins ?? {})) this.presence.set(key, [...(this.presence.get(key) ?? []), ...(v.metas ?? [])]);
        this.o.onPresence?.(this.members());
        return;
      }
    }
  }
}

/**
 * Ask and answer over a RealtimeLink: `ask(to, cmd, args)` sends a command to one device and waits for its reply.
 * Both ends use it; the TV answers with `serve`.
 */
export interface LinkCommand {
  to: string;
  from: string;
  id: string;
  cmd: string;
  args: Record<string, unknown>;
}
export interface LinkReply {
  to: string;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export class LinkRpc {
  private n = 0;
  private waiting = new Map<string, { ok: (v: unknown) => void; fail: (e: Error) => void; timer: unknown }>();
  private handler?: (cmd: string, args: Record<string, unknown>, from: string) => Promise<unknown>;
  private readonly link: Pick<RealtimeLink, 'send'>;
  private readonly me: string;
  private readonly timers: NonNullable<RealtimeOptions['timers']>;

  constructor(link: Pick<RealtimeLink, 'send'>, me: string, timers?: NonNullable<RealtimeOptions['timers']>) {
    this.link = link;
    this.me = me;
    this.timers = timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (x) => clearTimeout(x as ReturnType<typeof setTimeout>) };
  }

  /** Feed every broadcast here. */
  onBroadcast(event: string, payload: Record<string, unknown>): void {
    if (event === 'reply') {
      const r = payload as unknown as LinkReply;
      if (r.to !== this.me) return;
      const w = this.waiting.get(r.id);
      if (!w) return;
      this.waiting.delete(r.id);
      this.timers.clear(w.timer);
      if (r.ok) w.ok(r.result);
      else w.fail(new Error(r.error || 'The TV couldn’t do that.'));
    } else if (event === 'cmd' && this.handler) {
      const c = payload as unknown as LinkCommand;
      if (c.to !== this.me) return;
      const handler = this.handler;
      void (async () => {
        let reply: LinkReply;
        try {
          reply = { to: c.from, id: c.id, ok: true, result: await handler(c.cmd, c.args ?? {}, c.from) };
        } catch (e) {
          reply = { to: c.from, id: c.id, ok: false, error: (e as Error).message };
        }
        this.link.send('reply', reply as unknown as Record<string, unknown>);
      })();
    }
  }

  /** Answer commands sent to this end. */
  serve(handler: (cmd: string, args: Record<string, unknown>, from: string) => Promise<unknown>): void {
    this.handler = handler;
  }

  ask<T = unknown>(to: string, cmd: string, args: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
    this.n += 1;
    const id = `${this.me}-${this.n}`;
    return new Promise<T>((ok, fail) => {
      const timer = this.timers.set(() => {
        this.waiting.delete(id);
        fail(new Error('The TV didn’t answer. Is it on, with LTTV open?'));
      }, timeoutMs);
      this.waiting.set(id, { ok: ok as (v: unknown) => void, fail, timer });
      const sent = this.link.send('cmd', { to, from: this.me, id, cmd, args });
      if (!sent) {
        this.waiting.delete(id);
        this.timers.clear(timer);
        fail(new Error('Not connected right now — trying again…'));
      }
    });
  }
}

/** A random id (hex), long enough to be a secret when `bytes` is 16+. */
export function randomId(bytes = 16): string {
  const a = new Uint8Array(bytes);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(a);
  else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The channel two ends meet on, from the account's link secret. */
export function linkTopic(secret: string): string {
  return `lttv-link-${secret}`;
}

/** An address to watch a stream on a phone: Xtream live streams also come as HLS (.m3u8), which phones play. */
export function phoneStreamUrls(url: string): { url: string; hls?: string } {
  const m = /^(https?:\/\/[^?#]+\/live\/[^/]+\/[^/]+\/\d+)\.(ts|m3u8)(\?.*)?$/i.exec(url);
  if (m) return { url, hls: `${m[1]}.m3u8${m[3] ?? ''}` };
  if (/\.m3u8(\?|$)/i.test(url)) return { url, hls: url };
  return { url };
}
