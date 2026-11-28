import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LinkRpc, RealtimeLink, linkTopic, phoneStreamUrls, socketUrl, type WebSocketLike } from '../src/core/realtime';

// A tiny stand-in for Supabase Realtime: relays broadcasts on a topic and keeps presence (Phoenix JSON v1).
class Hub {
  sockets = new Set<FakeWs>();
  presence = new Map<string, { ws: FakeWs; key: string; meta: Record<string, unknown>; ref: string }>();
  n = 0;
  urls: string[] = [];
  deliver(from: FakeWs, raw: string) {
    const m = JSON.parse(raw);
    if (m.topic === 'phoenix') return from.recv({ topic: 'phoenix', event: 'phx_reply', payload: { status: 'ok' }, ref: m.ref });
    if (m.event === 'phx_join') {
      from.topic = m.topic;
      from.key = m.payload.config.presence.key;
      assert.equal(m.payload.config.private, false);
      from.recv({ topic: m.topic, event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: m.ref });
      const state: Record<string, unknown> = {};
      for (const p of this.presence.values()) if (p.ws.topic === m.topic) state[p.key] = { metas: [{ ...p.meta, phx_ref: p.ref }] };
      from.recv({ topic: m.topic, event: 'presence_state', payload: state, ref: null });
      return;
    }
    if (m.event === 'presence' && m.payload.event === 'track') {
      const ref = `r${++this.n}`;
      const old = this.presence.get(from.key!);
      this.presence.set(from.key!, { ws: from, key: from.key!, meta: m.payload.payload, ref });
      for (const s of this.sockets)
        if (s.topic === m.topic)
          s.recv({ topic: m.topic, event: 'presence_diff', payload: { joins: { [from.key!]: { metas: [{ ...m.payload.payload, phx_ref: ref }] } }, leaves: old ? { [from.key!]: { metas: [{ ...old.meta, phx_ref: old.ref }] } } : {} }, ref: null });
      return;
    }
    if (m.event === 'broadcast') {
      for (const s of this.sockets) if (s !== from && s.topic === m.topic) s.recv({ topic: m.topic, event: 'broadcast', payload: m.payload, ref: null });
    }
  }
  drop(ws: FakeWs) {
    this.sockets.delete(ws);
    const p = ws.key ? this.presence.get(ws.key) : undefined;
    if (p && p.ws === ws) {
      this.presence.delete(ws.key!);
      for (const s of this.sockets) if (s.topic === ws.topic) s.recv({ topic: ws.topic, event: 'presence_diff', payload: { joins: {}, leaves: { [ws.key!]: { metas: [{ ...p.meta, phx_ref: p.ref }] } } }, ref: null });
    }
  }
}

let hub: Hub;
class FakeWs implements WebSocketLike {
  readyState = 0;
  topic?: string;
  key?: string;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(url: string) {
    hub.urls.push(url);
    hub.sockets.add(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.({});
    });
  }
  send(d: string) {
    queueMicrotask(() => hub.deliver(this, d));
  }
  recv(m: unknown) {
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(m) }));
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    hub.drop(this);
  }
  /** The server hangs up. */
  kill() {
    this.close();
    this.onclose?.({});
  }
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const fastTimers = { set: (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, 20)), clear: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>) };

function pair() {
  const topic = linkTopic('secret123');
  const tvRpcHolder: { rpc?: LinkRpc } = {};
  const tv = new RealtimeLink({ url: 'https://x.supabase.co', apiKey: 'anon', topic, presenceKey: 'tv1', WebSocket: FakeWs, timers: fastTimers, onBroadcast: (e, p) => tvRpcHolder.rpc?.onBroadcast(e, p) });
  tvRpcHolder.rpc = new LinkRpc(tv, 'tv1');
  let seen: { key: string; meta: Record<string, unknown> }[] = [];
  const phoneHolder: { rpc?: LinkRpc } = {};
  const phone = new RealtimeLink({ url: 'https://x.supabase.co', apiKey: 'anon', topic, presenceKey: 'phone1', WebSocket: FakeWs, timers: fastTimers, onBroadcast: (e, p) => phoneHolder.rpc?.onBroadcast(e, p), onPresence: (m) => (seen = m) });
  phoneHolder.rpc = new LinkRpc(phone, 'phone1');
  return { tv, phone, tvRpc: tvRpcHolder.rpc, phoneRpc: phoneHolder.rpc, seen: () => seen };
}

test('phone link: the phone sees the TV, sends it a command and gets the answer', async () => {
  hub = new Hub();
  const p = pair();
  p.tvRpc.serve(async (cmd, args) => {
    if (cmd === 'tune') return { playing: args.key };
    throw new Error('Unknown command');
  });
  p.tv.track({ device: true, id: 'tv1', name: 'LTTV · Fire TV', playing: null });
  p.tv.start();
  await tick(20);
  p.phone.track({ phone: true });
  p.phone.start();
  await tick(20);
  assert.ok(hub.urls[0].startsWith('wss://x.supabase.co/realtime/v1/websocket?apikey=anon'));
  assert.deepEqual(p.seen().find((m) => m.key === 'tv1')?.meta.name, 'LTTV · Fire TV');
  assert.deepEqual(await p.phoneRpc.ask('tv1', 'tune', { key: 'espn' }), { playing: 'espn' });
  await assert.rejects(p.phoneRpc.ask('tv1', 'nope'), /Unknown command/);
  // What's playing changes → the phone's list updates (the old entry is replaced, not doubled).
  p.tv.track({ device: true, id: 'tv1', name: 'LTTV · Fire TV', playing: { name: 'ESPN' } });
  await tick(20);
  const tvs = p.seen().filter((m) => m.key === 'tv1');
  assert.equal(tvs.length, 1);
  assert.deepEqual(tvs[0].meta.playing, { name: 'ESPN' });
  p.tv.stop();
  p.phone.stop();
});

test('phone link: the TV comes back after the connection drops (and is listed again)', async () => {
  hub = new Hub();
  const p = pair();
  p.tvRpc.serve(async () => 'pong');
  p.tv.track({ device: true, id: 'tv1', name: 'TV' });
  p.tv.start();
  p.phone.start();
  await tick(30);
  assert.ok(p.seen().some((m) => m.key === 'tv1'));
  const tvSocket = [...hub.sockets].find((s) => s.key === 'tv1')!;
  tvSocket.kill();
  await tick(10);
  assert.ok(!p.seen().some((m) => m.key === 'tv1'));
  await tick(80); // reconnects (fast timers in the test)
  assert.ok(p.seen().some((m) => m.key === 'tv1'));
  assert.equal(await p.phoneRpc.ask('tv1', 'ping'), 'pong');
  p.tv.stop();
  p.phone.stop();
});

test('phone link: no answer → a clear message (not a hang)', async () => {
  hub = new Hub();
  const p = pair();
  p.phone.start();
  await tick(20);
  await assert.rejects(p.phoneRpc.ask('tv-gone', 'tune', {}, 30), /didn’t answer/);
  p.phone.stop();
});

test('phone link: Xtream channels get an HLS address phones can play', () => {
  assert.deepEqual(phoneStreamUrls('http://p.example:8080/live/u/pw/1234.ts'), { url: 'http://p.example:8080/live/u/pw/1234.ts', hls: 'http://p.example:8080/live/u/pw/1234.m3u8' });
  assert.deepEqual(phoneStreamUrls('https://cdn.example/x/index.m3u8'), { url: 'https://cdn.example/x/index.m3u8', hls: 'https://cdn.example/x/index.m3u8' });
  assert.deepEqual(phoneStreamUrls('http://p.example/abc'), { url: 'http://p.example/abc' });
  assert.equal(socketUrl('https://a.supabase.co/', 'k'), 'wss://a.supabase.co/realtime/v1/websocket?apikey=k&vsn=1.0.0');
});
