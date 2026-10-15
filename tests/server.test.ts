import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error -- plain ESM module without types
import { createServer, rewriteM3u8 } from '../server/server.mjs';

let upstream: http.Server;
let app: http.Server;
let up = '';
let base = '';

before(async () => {
  upstream = http.createServer((req, res) => {
    const u = new URL(req.url!, 'http://x');
    if (u.pathname === '/redirect') {
      res.writeHead(302, { location: '/plain.m3u' });
      return res.end();
    }
    if (u.pathname === '/plain.m3u') {
      res.writeHead(200, { 'content-type': 'audio/x-mpegurl' });
      return res.end('#EXTM3U\n#EXTINF:-1,A\nhttp://a/1\n');
    }
    if (u.pathname === '/guide.xml.gz') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(gzipSync(Buffer.from('<tv><channel id="a"/></tv>')));
    }
    if (u.pathname === '/echo-headers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(req.headers));
    }
    if (u.pathname === '/needs-ua') {
      res.writeHead(req.headers['user-agent'] === 'SpecialAgent/1' ? 200 : 403);
      return res.end('ok');
    }
    if (u.pathname === '/live/index.m3u8') {
      res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      return res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nseg1.ts\n#EXTINF:4,\nhttps://cdn.example/seg2.ts\n');
    }
    if (u.pathname === '/stream.ts') {
      res.writeHead(200, { 'content-type': 'video/mp2t' });
      return res.end(readFileSync(join(import.meta.dirname, '../public/demo/bars/seg000.ts')));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  up = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  app = createServer();
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
});

after(() => {
  upstream.close();
  app.close();
});

const api = (path: string, init: RequestInit = {}) => fetch(base + path, init);
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

test('caps endpoint', async () => {
  const j = await (await api('/api/caps')).json();
  assert.equal(j.proxy, true);
});

test('fetch follows redirects and passes content through', async () => {
  const r = await api('/api/fetch?' + q({ url: `${up}/redirect` }));
  assert.equal(r.status, 200);
  assert.match(await r.text(), /#EXTM3U/);
});

test('gunzip=auto decompresses gzipped guides by magic bytes', async () => {
  const r = await api('/api/fetch?' + q({ url: `${up}/guide.xml.gz`, gunzip: 'auto' }));
  assert.equal(await r.text(), '<tv><channel id="a"/></tv>');
});

test('custom headers from the playlist are forwarded', async () => {
  assert.equal((await api('/api/fetch?' + q({ url: `${up}/needs-ua` }))).status, 403);
  const ok = await api('/api/fetch?' + q({ url: `${up}/needs-ua`, h: JSON.stringify({ 'User-Agent': 'SpecialAgent/1' }) }));
  assert.equal(ok.status, 200);
});

test('upstream errors become clear JSON errors', async () => {
  const r = await api('/api/fetch?' + q({ url: `${up}/nope` }));
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /404/);
  const dns = await api('/api/fetch?' + q({ url: 'http://no-such-host.invalid/x.m3u' }));
  assert.equal(dns.status, 502);
  assert.match((await dns.json()).error, /DNS|reach/);
  const bad = await api('/api/fetch?' + q({ url: 'file:///etc/passwd' }));
  assert.equal(bad.status, 400);
});

test('HLS playlists are rewritten so segments and keys go through the helper', async () => {
  const r = await api('/api/fetch?' + q({ url: `${up}/live/index.m3u8`, mode: 'hls' }));
  const text = await r.text();
  const lines = text.split('\n');
  assert.ok(lines.some((l) => l.startsWith('/api/fetch?') && l.includes(encodeURIComponent(`${up}/live/seg1.ts`))));
  assert.ok(lines.some((l) => l.includes(encodeURIComponent('https://cdn.example/seg2.ts'))));
  assert.match(text, /URI="\/api\/fetch\?url=/);
  assert.equal(rewriteM3u8('#EXTM3U\n\n', 'http://h/', {}), '#EXTM3U\n\n');
});

test('cross-site requests to the helper are refused', async () => {
  const r = await api('/api/caps', { headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(r.status, 403);
});

test('probe detects HLS and MPEG-TS', async () => {
  assert.equal((await (await api('/api/probe?' + q({ url: `${up}/plain.m3u` }))).json()).kind, 'hls');
  assert.equal((await (await api('/api/probe?' + q({ url: `${up}/stream.ts` }))).json()).kind, 'ts');
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
test('remux converts a raw MPEG-TS stream into fragmented MP4 (ffmpeg)', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const r = await api('/api/remux?' + q({ url: `${up}/stream.ts` }));
  assert.equal(r.headers.get('content-type'), 'video/mp4');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(4, 8).toString('latin1'), 'ftyp');
  assert.ok(buf.includes(Buffer.from('moof')), 'fragmented');
});

test('upstream requests look like a media player, not a browser', async () => {
  const h = await (await api('/api/fetch?' + q({ url: `${up}/echo-headers`, h: JSON.stringify({ 'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20' }) }))).json();
  assert.equal(h['user-agent'], 'VLC/3.0.20 LibVLC/3.0.20');
  assert.ok(!Object.keys(h).some((k) => k.startsWith('sec-') || k === 'origin' || k === 'referer' || k === 'accept-language'), Object.keys(h).join(','));
});
