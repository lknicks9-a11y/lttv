#!/usr/bin/env node
// LTTV desktop helper: serves the app and provides CORS-free access to the user's
// playlist/guide/stream URLs. Zero dependencies (Node 20+). Binds to 127.0.0.1 only.
//
//   node server/server.mjs [--port 8787] [--open] [--host 127.0.0.1]
//
// Endpoints (same contract as the Fire TV host):
//   GET /api/caps                         -> { proxy, ffmpeg, version, platform }
//   GET /api/fetch?url=&h=&gunzip=auto&mode=hls
//   GET /api/probe?url=&h=                -> { kind: 'hls'|'ts'|'progressive'|'unknown' }
//   GET /api/remux?url=&h=                -> fragmented MP4 via ffmpeg (raw MPEG-TS channels)
//   GET /api/remote/info | /api/remote/events (SSE) | POST /api/remote/reply   (phone remote, this computer only)
//
// Phone remote: a second, separate server on the home network (port + 1, --no-remote to turn off) serves only the
// remote page and /rapi/* (paired with a code shown in LTTV). It can't use the fetch helper: that stays 127.0.0.1.
import http from 'node:http';
import https from 'node:https';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PORT = Number(arg('--port', process.env.PORT || 8787));
const HOST = arg('--host', process.env.HOST || '127.0.0.1');
const OPEN = args.includes('--open');
const UPSTREAM_TIMEOUT = 20000;
const REMOTE = !args.includes('--no-remote');
const REMOTE_PORT = Number(arg('--remote-port', process.env.REMOTE_PORT || PORT + 1));

const hasFfmpeg = (() => {
  try {
    return spawnSync(process.env.FFMPEG || 'ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
})();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.mp4': 'video/mp4', '.woff2': 'font/woff2',
};

/** Hide credentials, tokens and paths in logs. */
function redact(u) {
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.host}/…`;
  } catch {
    return '…';
  }
}

function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

/** Only accept requests initiated by the LTTV page itself (blocks other websites from using the proxy). */
function sameOriginOnly(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      const o = new URL(origin);
      if (o.host !== req.headers.host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function parseTarget(q) {
  const url = q.get('url');
  if (!url) throw Object.assign(new Error('Missing url'), { status: 400 });
  let u;
  try {
    u = new URL(url);
  } catch {
    throw Object.assign(new Error('Invalid URL'), { status: 400 });
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw Object.assign(new Error('Only http(s) URLs are supported'), { status: 400 });
  let headers = {};
  if (q.get('h')) {
    try {
      headers = JSON.parse(q.get('h'));
    } catch {
      /* ignore */
    }
  }
  return { url: u.href, headers };
}

const DEFAULT_UA = `Mozilla/5.0 (LTTV/${pkg.version}) AppleWebKit/537.36 (KHTML, like Gecko)`;

/**
 * Plain HTTP(S) request that sends ONLY the headers a media player would
 * (Node's fetch adds browser-style Sec-Fetch-* headers that some IPTV panels block).
 * Follows up to 6 redirects. Resolves with a small response wrapper; the body is a Node stream.
 */
function upstream(url, headers, signal, range, hops = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      reject(e);
      return;
    }
    const h = { 'User-Agent': DEFAULT_UA, Accept: '*/*', Connection: 'close' };
    for (const [k, v] of Object.entries(headers || {})) {
      if (typeof v !== 'string') continue;
      for (const existing of Object.keys(h)) if (existing.toLowerCase() === k.toLowerCase()) delete h[existing];
      h[k] = v;
    }
    if (range) h.Range = range;
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method: 'GET', headers: h, timeout: UPSTREAM_TIMEOUT }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && hops < 6) {
        res.resume();
        resolve(upstream(new URL(res.headers.location, u).href, headers, signal, range, hops + 1));
        return;
      }
      resolve({
        status,
        ok: status >= 200 && status < 300,
        url: u.href,
        headers: { get: (k) => { const v = res.headers[k.toLowerCase()]; return Array.isArray(v) ? v.join(', ') : v ?? null; } },
        body: res,
        text: () => new Promise((ok, fail) => { const parts = []; res.on('data', (c) => parts.push(c)); res.on('end', () => ok(Buffer.concat(parts).toString('utf8'))); res.on('error', fail); }),
        cancel: () => res.destroy(),
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    signal?.addEventListener('abort', () => req.destroy(new Error('aborted')));
    req.end();
  });
}

function lowerKeys(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) if (typeof v === 'string') out[k.toLowerCase()] = v;
  return out;
}

function proxyUrlFor(abs, headers, mode) {
  const p = new URLSearchParams({ url: abs });
  if (headers && Object.keys(headers).length) p.set('h', JSON.stringify(headers));
  if (mode) p.set('mode', mode);
  return '/api/fetch?' + p.toString();
}

/** Rewrite every URI in an HLS playlist to go back through this proxy. */
export function rewriteM3u8(text, baseUrl, headers) {
  const abs = (u) => {
    try {
      return new URL(u, baseUrl).href;
    } catch {
      return u;
    }
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${proxyUrlFor(abs(u), headers, 'hls')}"`);
      return proxyUrlFor(abs(t), headers, 'hls');
    })
    .join('\n');
}

function upstreamError(e) {
  const msg = String(e?.cause?.code || e?.message || e);
  if (/timeout|aborted/i.test(msg)) return { status: 504, error: 'The source server did not respond in time.' };
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return { status: 502, error: 'The server name could not be found (DNS). Check the URL and your internet connection.' };
  if (/ECONNREFUSED/.test(msg)) return { status: 502, error: 'The source server refused the connection.' };
  if (/CERT|SSL|TLS/i.test(msg)) return { status: 502, error: 'Secure connection failed (certificate problem on the source server).' };
  return { status: 502, error: 'Could not reach the source server.' };
}

async function handleFetch(req, res, q) {
  const { url, headers } = parseTarget(q);
  const mode = q.get('mode');
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  let r;
  try {
    r = await upstream(url, headers, ac.signal, req.headers.range);
  } catch (e) {
    const er = upstreamError(e);
    log('fetch failed', redact(url), er.error);
    return sendJson(res, er.status, er);
  }
  if (!r.ok && r.status !== 206) {
    log('upstream', r.status, redact(url));
    r.cancel();
    return sendJson(res, r.status === 404 ? 404 : r.status === 401 || r.status === 403 ? r.status : 502, { error: `The source server answered ${r.status}`, status: r.status });
  }
  const ctype = r.headers.get('content-type') || '';
  const len = r.headers.get('content-length');
  const outHeaders = { 'cache-control': 'no-store', 'access-control-allow-origin': 'null' };
  if (len) outHeaders['x-upstream-length'] = len;

  // HLS playlists: rewrite so every request stays on this proxy (CORS + headers).
  const looksM3u8 = /mpegurl/i.test(ctype) || /\.m3u8?(\?|$)/i.test(new URL(r.url || url).pathname);
  if (mode === 'hls' && looksM3u8) {
    const text = await r.text();
    if (text.trimStart().startsWith('#EXTM3U')) {
      res.writeHead(200, { ...outHeaders, 'content-type': 'application/vnd.apple.mpegurl' });
      return res.end(rewriteM3u8(text, r.url || url, headers));
    }
    res.writeHead(200, { ...outHeaders, 'content-type': ctype || 'application/octet-stream' });
    return res.end(text);
  }

  const body = r.body;
  if (q.get('gunzip') === 'auto') {
    // Peek at the first bytes: decompress .gz guide files transparently.
    const first = await new Promise((resolveFirst) => {
      body.once('readable', () => resolveFirst(body.read(2)));
      body.once('end', () => resolveFirst(null));
      body.once('error', () => resolveFirst(null));
    });
    if (first) body.unshift(first);
    if (first && first[0] === 0x1f && first[1] === 0x8b) {
      res.writeHead(200, { ...outHeaders, 'content-type': 'text/plain; charset=utf-8', 'x-lttv-gunzipped': '1' });
      const gz = createGunzip();
      gz.on('error', () => res.destroy());
      body.pipe(gz).pipe(res);
      return;
    }
  }
  const pass = { ...outHeaders, 'content-type': ctype || 'application/octet-stream' };
  if (r.status === 206) {
    pass['content-range'] = r.headers.get('content-range') || '';
    if (len) pass['content-length'] = len;
  } else if (len && !r.headers.get('content-encoding')) {
    pass['content-length'] = len;
  }
  res.writeHead(r.status, pass);
  body.on('error', () => res.destroy());
  body.pipe(res);
}

async function handleProbe(res, q) {
  const { url, headers } = parseTarget(q);
  let r;
  try {
    r = await upstream(url, headers, undefined, 'bytes=0-4095');
  } catch (e) {
    return sendJson(res, 200, { kind: 'unknown', error: upstreamError(e).error });
  }
  const ctype = r.headers.get('content-type') || '';
  let kind = 'unknown';
  try {
    const value = await new Promise((ok) => {
      r.body.once('data', ok);
      r.body.once('end', () => ok(null));
      r.body.once('error', () => ok(null));
    });
    r.cancel();
    const buf = Buffer.from(value || []);
    const head = buf.subarray(0, 16).toString('latin1');
    if (head.trimStart().startsWith('#EXTM3U') || /mpegurl/i.test(ctype)) kind = 'hls';
    else if (buf[0] === 0x47 && (buf.length < 189 || buf[188] === 0x47)) kind = 'ts';
    else if (/video\/mp2t/i.test(ctype)) kind = 'ts';
    else if (/video\/(mp4|webm)|audio\//i.test(ctype) || head.slice(4, 8) === 'ftyp') kind = 'progressive';
  } catch {
    /* unknown */
  }
  sendJson(res, 200, { kind, contentType: ctype, status: r.status });
}

function handleRemux(req, res, q) {
  if (!hasFfmpeg) return sendJson(res, 501, { error: 'ffmpeg is not installed on this computer.' });
  const { url, headers } = parseTarget(q);
  const h = lowerKeys(headers);
  const ffArgs = ['-hide_banner', '-loglevel', 'error', '-fflags', '+genpts+discardcorrupt', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-rw_timeout', String(UPSTREAM_TIMEOUT * 1000)];
  ffArgs.push('-user_agent', h['user-agent'] || DEFAULT_UA);
  const extra = Object.entries(h).filter(([k]) => k !== 'user-agent').map(([k, v]) => `${k}: ${v}\r\n`).join('');
  if (extra) ffArgs.push('-headers', extra);
  ffArgs.push('-i', url, '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1');
  const ff = spawn(process.env.FFMPEG || 'ffmpeg', ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  let started = false;
  let errText = '';
  ff.stderr.on('data', (d) => {
    errText = (errText + d.toString()).slice(-2000);
  });
  ff.stdout.once('data', () => {
    started = true;
  });
  res.writeHead(200, { 'content-type': 'video/mp4', 'cache-control': 'no-store' });
  ff.stdout.pipe(res);
  ff.on('close', (code) => {
    if (!started) log('remux failed', redact(url), code, errText.replace(/https?:\/\/\S+/g, '[url]').slice(0, 300));
    res.end();
  });
  res.on('close', () => ff.kill('SIGKILL'));
  log('remux', redact(url));
}

function serveStatic(req, res, pathname) {
  let p = decodeURIComponent(pathname);
  if (p === '/' || p === '') p = '/index.html';
  const file = normalize(join(dist, p));
  if (!file.startsWith(dist)) {
    res.writeHead(403);
    return res.end();
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  const ext = extname(file).toLowerCase();
  const headers = {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': ext === '.html' || ext === '.js' || ext === '.css' || ext === '.json' ? 'no-cache' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  };
  if (ext === '.html') headers['content-security-policy'] = "default-src 'self'; img-src * data: blob:; media-src * blob: data:; connect-src 'self' https: http: blob: data:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:";
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------------
// Phone remote: relay between the phone page (remote server) and the LTTV page open on this computer.

export const remote = {
  /** Long random key the phone keeps after pairing (in the QR code). */
  token: randomBytes(16).toString('hex'),
  /** 6-digit code for typing in by hand. */
  pin: String(randomInt(0, 1_000_000)).padStart(6, '0'),
  pinFails: 0,
  /** LTTV pages listening for commands (Server-Sent Events). */
  pages: new Set(),
  pending: new Map(),
  seq: 0,
};

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
  }
  // Home networks first (192.168.x, 10.x), then the rest.
  return out.sort((a, b) => Number(!/^(192\.168|10)\./.test(a)) - Number(!/^(192\.168|10)\./.test(b)));
}

function readJson(req, max = 64 * 1024) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        fail(Object.assign(new Error('Too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        fail(Object.assign(new Error('Bad JSON'), { status: 400 }));
      }
    });
    req.on('error', fail);
  });
}

/** Send a command to the LTTV page and wait for its answer. */
export function relay(cmd, cmdArgs, timeoutMs = 8000) {
  const page = [...remote.pages].pop();
  if (!page) return Promise.reject(Object.assign(new Error('LTTV isn’t open on the computer. Open it there (keep the window open), then try again.'), { status: 503 }));
  const id = ++remote.seq;
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => {
      remote.pending.delete(id);
      fail(Object.assign(new Error('LTTV on the computer didn’t answer.'), { status: 504 }));
    }, timeoutMs);
    remote.pending.set(id, { ok, fail, timer });
    page.write(`data: ${JSON.stringify({ id, cmd, args: cmdArgs ?? {} })}\n\n`);
  });
}

function remoteInfo() {
  return { pin: remote.pin, token: remote.token, port: REMOTE_PORT, enabled: REMOTE, urls: lanAddresses().map((ip) => `http://${ip}:${REMOTE_PORT}/?k=${remote.token}`) };
}

/** The LTTV page's side (on the 127.0.0.1 server). */
async function handleRemotePage(req, res, u) {
  // Only the computer itself (the pairing key must never reach another device through --host 0.0.0.0).
  const from = req.socket.remoteAddress || '';
  if (!(from === '127.0.0.1' || from === '::1' || from === '::ffff:127.0.0.1')) return sendJson(res, 403, { error: 'Only on this computer.' });
  if (u.pathname === '/api/remote/info') return sendJson(res, 200, remoteInfo());
  if (u.pathname === '/api/remote/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': hello\n\n');
    remote.pages.add(res);
    const beat = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(beat);
      remote.pages.delete(res);
    });
    return;
  }
  if (u.pathname === '/api/remote/reply' && req.method === 'POST') {
    const b = await readJson(req, 4 * 1024 * 1024);
    const p = remote.pending.get(b.id);
    if (p) {
      remote.pending.delete(b.id);
      clearTimeout(p.timer);
      if (b.ok) p.ok(b.result);
      else p.fail(Object.assign(new Error(b.error || 'Failed'), { status: 400 }));
    }
    return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 404, { error: 'Unknown endpoint' });
}

function sameKey(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

const REMOTE_COMMANDS = new Set(['key', 'text', 'state', 'search', 'sportsNow', 'games', 'tune', 'stop', 'navigate', 'mvOpen', 'mvSet', 'mvSound', 'mvLayout', 'mvFull', 'mvClose']);

/** The phone-facing server: only the remote page and its commands. */
export function createRemoteServer() {
  const page = join(here, 'remote.html');
  return http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://remote');
    try {
      if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/remote')) {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src * data:; connect-src 'self'",
        });
        return createReadStream(page).pipe(res);
      }
      if (u.pathname === '/rapi/pair' && req.method === 'POST') {
        if (remote.pinFails >= 10) return sendJson(res, 429, { error: 'Too many wrong codes. Restart LTTV on the computer for a new code.' });
        const b = await readJson(req);
        if (!sameKey(String(b.pin || '').trim(), remote.pin)) {
          remote.pinFails++;
          return sendJson(res, 401, { error: 'That code isn’t right. It’s in LTTV on the computer: Settings → Phone remote.' });
        }
        return sendJson(res, 200, { token: remote.token });
      }
      if (u.pathname === '/rapi/cmd' && req.method === 'POST') {
        if (!sameKey(req.headers['x-lttv-key'], remote.token)) return sendJson(res, 401, { error: 'Not paired. Scan the code in LTTV on the computer again.' });
        const b = await readJson(req);
        if (!REMOTE_COMMANDS.has(b.cmd)) return sendJson(res, 400, { error: 'Unknown command' });
        return sendJson(res, 200, { result: await relay(b.cmd, b.args) });
      }
      sendJson(res, 404, { error: 'Not found' });
    } catch (e) {
      if (!res.headersSent) sendJson(res, e.status || 500, { error: e.message || 'Server error' });
      else res.destroy();
    }
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (u.pathname.startsWith('/api/')) {
        if (!sameOriginOnly(req)) return sendJson(res, 403, { error: 'Cross-site requests are not allowed.' });
        if (u.pathname === '/api/caps') return sendJson(res, 200, { proxy: true, ffmpeg: hasFfmpeg, version: pkg.version, platform: `desktop (${process.platform})`, remote: REMOTE });
        if (u.pathname.startsWith('/api/remote/')) return await handleRemotePage(req, res, u);
        if (u.pathname === '/api/fetch') return await handleFetch(req, res, u.searchParams);
        if (u.pathname === '/api/probe') return await handleProbe(res, u.searchParams);
        if (u.pathname === '/api/remux') return handleRemux(req, res, u.searchParams);
        return sendJson(res, 404, { error: 'Unknown endpoint' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405);
        return res.end();
      }
      serveStatic(req, res, u.pathname);
    } catch (e) {
      if (!res.headersSent) sendJson(res, e.status || 500, { error: e.message || 'Server error' });
      else res.destroy();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(join(dist, 'index.html'))) {
    console.error('dist/ is missing. Run "npm run build" first.');
    process.exit(1);
  }
  const server = createServer();
  server.listen(PORT, HOST, () => {
    const url = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`;
    console.log(`\n  LTTV ${pkg.version} is running at ${url}`);
    console.log(`  ffmpeg: ${hasFfmpeg ? 'found (raw MPEG-TS channels can play)' : 'not found (HLS channels only in the browser)'}`);
    if (REMOTE) {
      const r = createRemoteServer();
      r.listen(REMOTE_PORT, '0.0.0.0', () => {
        const ip = lanAddresses()[0];
        console.log(`  Phone remote: ${ip ? `http://${ip}:${REMOTE_PORT}/` : `port ${REMOTE_PORT}`}  (pairing code ${remote.pin}; QR in LTTV → Settings → Phone remote)`);
      });
      r.on('error', (e) => console.log(`  Phone remote not started: ${e.code === 'EADDRINUSE' ? `port ${REMOTE_PORT} is in use` : e.message}`));
    }
    console.log('  Press Ctrl+C to stop.\n');
    if (OPEN) {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
      const a = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
      spawn(cmd, a, { stdio: 'ignore', detached: true }).unref();
    }
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is in use. Try: npm start -- --port ${PORT + 1}` : e.message);
    process.exit(1);
  });
}
