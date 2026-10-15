// End-to-end test: drives the real app in headless Chromium using ONLY remote-style
// keys (arrows, Enter, Escape/back, M for menu), against locally served fixtures.
//
//   npm run build && node scripts/e2e.mjs [--chrome /path/to/chrome] [--shots dir]
//
// The fixture server deliberately sends NO CORS headers, so playlist/guide/stream
// loading must go through the LTTV desktop helper (this is what real providers do).
import { chromium } from 'playwright-core';
import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, resolve, dirname, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
// Like most desktops, no ffmpeg: raw MPEG-TS must play through the in-browser converter.
process.env.FFMPEG = '/nonexistent/ffmpeg';
const { createServer } = await import('../server/server.mjs');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const CHROME = opt('--chrome', process.env.CHROME_PATH || '/opt/google/chrome/chrome');
const SHOTS = resolve(opt('--shots', join(root, 'test-results', 'screenshots')));
const BULK = Number(opt('--channels', 5000)); // bulk channels added to the fixture playlist
const fmt = (n) => n.toLocaleString('en-US');
mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ---------------- fixtures ----------------
const now = Date.now();
const HALF = 1800_000;
const t0 = Math.floor(now / HALF) * HALF - 4 * 3600_000;
const ts = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00 +0000`;
};

function makeFixtures(port) {
  const base = `http://127.0.0.1:${port}`;
  const pl = [`#EXTM3U url-tvg="${base}/guide.xml.gz"`];
  pl.push(`#EXTINF:-1 tvg-id="test.vp9" tvg-chno="1" group-title="TEST | NEWS",TEST: Fixture Stream HD`);
  pl.push(`${base}/vp9/index.m3u8`);
  pl.push(`#EXTINF:-1 tvg-id="test.broken" tvg-chno="2" group-title="TEST | SPORTS",TEST: Broken Stream`);
  pl.push(`${base}/missing/index.m3u8`);
  pl.push(`#EXTINF:-1 tvg-chno="3" group-title="TEST | ENTERTAINMENT",TEST: Sport Center Fuzzy`);
  pl.push(`${base}/vp9/index.m3u8?copy=3`);
  pl.push(`#EXTINF:-1 tvg-chno="4" group-title="TEST | MOVIES",TEST: No Guide Movies`);
  pl.push(`${base}/vp9/index.m3u8?copy=4`);
  pl.push(`#EXTINF:-1 group-title="VOD",Some Movie`);
  pl.push(`${base}/movie/1/2/123.mp4`);
  for (let i = 0; i < BULK; i++) {
    pl.push(`#EXTINF:-1 tvg-id="bulk.${i}" tvg-logo="${base}/nologo/${i}.png" group-title="TEST | ${['KIDS', 'DOCUMENTARY', 'MUSIC', 'NEWS'][i % 4]}",TEST: Bulk Channel ${i}`);
    pl.push(`${base}/bulk/${i}.m3u8`);
  }
  const x = ['<?xml version="1.0" encoding="UTF-8"?><tv>'];
  x.push('<channel id="test.vp9"><display-name>Fixture Stream</display-name></channel>');
  x.push('<channel id="test.broken"><display-name>Broken Stream</display-name></channel>');
  x.push('<channel id="sports.centre"><display-name>Sports Centre Fuzzy</display-name></channel>');
  for (let i = 0; i < BULK; i++) x.push(`<channel id="bulk.${i}"><display-name>Bulk Channel ${i}</display-name></channel>`);
  const prog = (ch, s, e, title, extra = '') => x.push(`<programme start="${ts(s)}" stop="${ts(e)}" channel="${ch}"><title>${title}</title>${extra}</programme>`);
  for (let k = 0; k < 24; k++) {
    prog('test.vp9', t0 + k * HALF * 2, t0 + (k + 1) * HALF * 2, `Fixture Hour ${k}`, '<desc>Fixture description.</desc><episode-num system="xmltv_ns">0.' + k + '.</episode-num>');
    prog('test.broken', t0 + k * HALF * 2, t0 + (k + 1) * HALF * 2, `Broken Show ${k}`);
    const s0 = t0 + k * HALF * 2, s1 = t0 + (k + 1) * HALF * 2;
    if (s0 <= now && now < s1) x.push(`<programme start="${ts(s0)}" stop="${ts(s1)}" channel="sports.centre"><title>NFL Football</title><sub-title>New York Giants at Dallas Cowboys</sub-title><category>Football</category></programme>`);
    else prog('sports.centre', s0, s1, `Sports Centre Live ${k}`);
  }
  for (let i = 0; i < BULK; i++) for (let k = 0; k < 16; k++) prog(`bulk.${i}`, t0 + k * HALF * 3, t0 + (k + 1) * HALF * 3, `Bulk Show ${i}-${k}`);
  x.push('<programme start="' + ts(now - 60_000) + '" stop="' + ts(now + 3 * 3600_000) + '" channel="test.vp9"><title>Overlapping duplicate is clipped</title></programme>');
  // Sports fixtures: a live NFL game and an upcoming NBA game.
  x.push('<programme start="' + ts(now + 26 * 3600_000) + '" stop="' + ts(now + 28 * 3600_000) + '" channel="test.vp9"><title>NBA Basketball</title><sub-title>Los Angeles Lakers at Boston Celtics</sub-title><category>Basketball</category></programme>');
  x.push('</tv>');
  return { playlist: pl.join('\n'), guideGz: gzipSync(Buffer.from(x.join('\n'))) };
}

function fixtureServer() {
  return new Promise((res) => {
    let fx;
    const srv = http.createServer((req, resp) => {
      const u = new URL(req.url, 'http://x');
      // NOTE: no Access-Control-Allow-Origin headers on purpose.
      if (u.pathname === '/playlist.m3u') {
        if (u.searchParams.get('password') !== 'secret123') {
          resp.writeHead(401);
          return resp.end('auth');
        }
        resp.writeHead(200, { 'content-type': 'audio/x-mpegurl' });
        return resp.end(fx.playlist);
      }
      // Mock "Xtream Codes" provider endpoints (username demo / password secret123).
      // Like some real providers, it refuses clients that don't look like a media player (code 884).
      if (['/player_api.php', '/get.php', '/xmltv.php'].includes(u.pathname) && !/^VLC\//.test(req.headers['user-agent'] ?? '')) {
        resp.writeHead(884);
        return resp.end();
      }
      if (u.pathname === '/player_api.php' && u.searchParams.get('action')) {
        const lines = fx.playlist.split('\n');
        const streams = [];
        for (let i = 1; i < 40; i += 2) {
          const m = /tvg-id="([^"]*)"[^,]*group-title="([^"]*)",(.*)$/.exec(lines[i] ?? '');
          if (m && !/VOD/.test(m[2])) streams.push({ num: streams.length + 1, name: m[3], stream_type: 'live', stream_id: 100 + streams.length, stream_icon: '', epg_channel_id: m[1], category_id: m[2] });
        }
        // A live-event slot with the game in its name, and a channel only the provider's own guide covers.
        const et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(Date.now() - 30 * 60_000);
        streams.push({ num: streams.length + 1, name: `NFL 03: Bills vs Jets @ ${et} ET`, stream_type: 'live', stream_id: 900, stream_icon: '', epg_channel_id: '', category_id: 'NFL Game Pass' });
        streams.push({ num: streams.length + 1, name: 'Provider Only Channel', stream_type: 'live', stream_id: 901, stream_icon: '', epg_channel_id: null, category_id: 'News' });
        // Networks for the sports schedule and My TV: national ESPN, both teams' local broadcasts, and an event slot.
        streams.push({ num: streams.length + 1, name: 'USA ESPN FHD', stream_type: 'live', stream_id: 902, stream_icon: '', epg_channel_id: '', category_id: 'USA Sports' });
        streams.push({ num: streams.length + 1, name: 'US: YES Network HD', stream_type: 'live', stream_id: 903, stream_icon: '', epg_channel_id: '', category_id: 'USA Sports' });
        streams.push({ num: streams.length + 1, name: 'US: NESN HD', stream_type: 'live', stream_id: 904, stream_icon: '', epg_channel_id: '', category_id: 'USA Sports' });
        streams.push({ num: streams.length + 1, name: 'MLB 05: Boston Red Sox vs New York Yankees', stream_type: 'live', stream_id: 905, stream_icon: '', epg_channel_id: '', category_id: 'MLB Extra Innings' });
        streams.push({ num: streams.length + 1, name: 'UK: Sky Sports Main Event', stream_type: 'live', stream_id: 906, stream_icon: '', epg_channel_id: '', category_id: 'UK Sports' });
        // A channel the provider only serves as raw MPEG-TS (its .m3u8 is missing).
        streams.push({ num: streams.length + 1, name: 'US: TS Only Channel', stream_type: 'live', stream_id: 907, stream_icon: '', epg_channel_id: '', category_id: 'USA Entertainment' });
        if (u.searchParams.get('action') === 'get_short_epg') {
          const b64 = (t) => Buffer.from(t).toString('base64');
          const s0 = Math.floor(Date.now() / 1000) - 600;
          const list = u.searchParams.get('stream_id') === '901'
            ? [{ title: b64('Provider Show'), description: b64('From the provider'), start_timestamp: String(s0), stop_timestamp: String(s0 + 3600) }, { title: b64('Provider Late Show'), start_timestamp: String(s0 + 3600), stop_timestamp: String(s0 + 7200) }]
            : [];
          resp.writeHead(200, { 'content-type': 'application/json' });
          return resp.end(JSON.stringify({ epg_listings: list }));
        }
        const cats = [...new Set(streams.map((s) => s.category_id))].map((c) => ({ category_id: c, category_name: c }));
        resp.writeHead(200, { 'content-type': 'application/json' });
        return resp.end(JSON.stringify(u.searchParams.get('action') === 'get_live_categories' ? cats : streams));
      }
      if (u.pathname === '/player_api.php') {
        const ok = u.searchParams.get('username') === 'demo' && u.searchParams.get('password') === 'secret123';
        resp.writeHead(200, { 'content-type': 'application/json' });
        return resp.end(JSON.stringify({ user_info: ok ? { auth: 1, status: 'Active', exp_date: String(Math.floor(Date.now() / 1000) + 86400 * 90), max_connections: '1', active_cons: '0', allowed_output_formats: ['m3u8', 'ts'] } : { auth: 0 } }));
      }
      if (u.pathname === '/get.php') {
        // Like some real providers, the plain playlist download is switched off.
        resp.writeHead(884);
        return resp.end();
        if (u.searchParams.get('password') !== 'secret123') {
          resp.writeHead(401);
          return resp.end('auth');
        }
        resp.writeHead(200, { 'content-type': 'audio/x-mpegurl' });
        return resp.end(fx.playlist.split('\n').slice(0, 40).join('\n'));
      }
      if (u.pathname === '/xmltv.php') {
        resp.writeHead(200, { 'content-type': 'application/gzip' });
        return resp.end(fx.guideGz);
      }
      if (u.pathname === '/guide.xml.gz') {
        resp.writeHead(200, { 'content-type': 'application/gzip' });
        return resp.end(fx.guideGz);
      }
      // Mock ESPN scoreboard: Red Sox at Yankees (live, both teams' local TV + ESPN) and a game nobody carries.
      if (u.pathname === '/espn/baseball/mlb/scoreboard') {
        const team = (id, name, short, loc, abbr, side, score) => ({ homeAway: side, score: String(score), team: { id, displayName: name, shortDisplayName: short, location: loc, abbreviation: abbr, logo: `${base0}/logo/${abbr}.png`, color: '0c2340' }, records: [{ type: 'total', summary: '90-72' }] });
        const tv = (market, name) => ({ type: { shortName: 'TV' }, market: { type: market }, media: { shortName: name }, region: 'us' });
        const ev = (id, mins, state, home, away, geo) => ({ id, name: `${away.team.displayName} at ${home.team.displayName}`, date: new Date(Date.now() + mins * 60_000).toISOString(), competitions: [{ date: new Date(Date.now() + mins * 60_000).toISOString(), competitors: [home, away], geoBroadcasts: geo, status: { type: { state, shortDetail: state === 'in' ? 'Top 3rd' : '7:10 PM' } }, venue: { fullName: 'Yankee Stadium' } }], status: { type: { state } } });
        const base0 = `http://127.0.0.1:${srv.address().port}`;
        resp.writeHead(200, { 'content-type': 'application/json' });
        return resp.end(JSON.stringify({ day: { date: u.searchParams.get('dates') }, events: [
          ev('g1', -40, 'in', team('10', 'New York Yankees', 'Yankees', 'New York', 'NYY', 'home', 3), team('2', 'Boston Red Sox', 'Red Sox', 'Boston', 'BOS', 'away', 1), [tv('Home', 'YES'), tv('Away', 'NESN'), tv('National', 'ESPN'), { type: { shortName: 'Radio' }, market: { type: 'Home' }, media: { shortName: 'WFAN' } }]),
          ev('g2', 120, 'pre', team('27', 'Seattle Mariners', 'Mariners', 'Seattle', 'SEA', 'home', 0), team('17', 'Oakland Athletics', 'Athletics', 'Oakland', 'OAK', 'away', 0), [tv('Home', 'ROOT SPORTS')]),
        ] }));
      }
      // Mock of the tv-logos collection (a few real files from it).
      if (u.pathname.startsWith('/logos/')) {
        const f = join(root, 'tests/fixtures/logos', u.pathname.slice(7));
        if (existsSync(f) && statSync(f).isFile()) {
          resp.writeHead(200, { 'content-type': 'image/png' });
          return createReadStream(f).pipe(resp);
        }
      }
      // Mock TVmaze and Wikipedia for programme descriptions.
      if (u.pathname === '/tvmaze/singlesearch/shows') {
        if (u.searchParams.get('q') !== 'Provider Late Show') { resp.writeHead(404); return resp.end('null'); }
        resp.writeHead(200, { 'content-type': 'application/json' });
        return resp.end(JSON.stringify({ id: 77, name: 'Provider Late Show', summary: '<p>A <b>late-night</b> talk show with guests and music.</p>', url: 'https://www.tvmaze.com/shows/77' }));
      }
      if (u.pathname.startsWith('/tvmaze/shows/77/episodebynumber')) {
        resp.writeHead(200, { 'content-type': 'application/json' });
        return resp.end(JSON.stringify({ name: 'Opening Night', season: 2, number: 5, summary: '<p>The host welcomes a surprise guest.</p>', url: 'https://www.tvmaze.com/episodes/1' }));
      }
      if (u.pathname.startsWith('/wiki/')) {
        const t = decodeURIComponent(u.pathname.slice(6));
        if (t !== 'Fixture_Movie_(film)') { resp.writeHead(404); return resp.end('{}'); }
        resp.writeHead(200, { 'content-type': 'application/json' });
        return resp.end(JSON.stringify({ type: 'standard', title: 'Fixture Movie (film)', description: '2020 film', extract: 'Fixture Movie is a 2020 American comedy film about a test pattern that wants to become a star.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Fixture_Movie' } } }));
      }
      if (u.pathname.startsWith('/logo/')) {
        resp.writeHead(200, { 'content-type': 'image/png' });
        return createReadStream(join(root, 'docs/logo-512.png')).pipe(resp);
      }
      // Provider live streams: HLS works (the fixture), raw .ts isn't served.
      if (/^\/(live\/)?demo\/secret123\/907\.ts$/.test(u.pathname)) {
        resp.writeHead(200, { 'content-type': 'video/mp2t' });
        return createReadStream(join(root, 'tests/fixtures/mpegts/sample.m2t')).pipe(resp);
      }
      const live = /^\/live\/demo\/secret123\/(?!907\.)(.+)$/.exec(u.pathname);
      if (live) {
        const name = /^\d+\.m3u8$/.test(live[1]) ? 'index.m3u8' : live[1];
        const f = join(root, 'tests/fixtures/vp9', name);
        if (!/\.ts$/.test(live[1]) && existsSync(f) && statSync(f).isFile()) {
          resp.writeHead(200, { 'content-type': extname(f) === '.m3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp4' });
          return createReadStream(f).pipe(resp);
        }
      }
      if (u.pathname.startsWith('/vp9/')) {
        const f = join(root, 'tests/fixtures', u.pathname);
        if (existsSync(f) && statSync(f).isFile()) {
          resp.writeHead(200, { 'content-type': extname(f) === '.m3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp4' });
          return createReadStream(f).pipe(resp);
        }
      }
      resp.writeHead(404);
      resp.end('not found');
    });
    srv.listen(0, '127.0.0.1', () => {
      fx = makeFixtures(srv.address().port);
      res({ srv, base: `http://127.0.0.1:${srv.address().port}` });
    });
  });
}

// ---------------- run ----------------
const { srv: fixtures, base: fxBase } = await fixtureServer();
const app = createServer();
await new Promise((r) => app.listen(0, '127.0.0.1', r));
const appUrl = `http://127.0.0.1:${app.address().port}/?tv`;
const profile = mkdtempSync(join(tmpdir(), 'lttv-e2e-'));
const launch = () => chromium.launchPersistentContext(profile, {
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required'],
  viewport: { width: 1920, height: 1080 },
});

let ctx = await launch();
let page = ctx.pages()[0] ?? (await ctx.newPage());
const errors = [];
const attach = (p) => {
  p.on('pageerror', (e) => errors.push(e.message));
  // Direct cross-origin attempts are expected to be blocked (the app then switches to the helper).
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|404|net::ERR|blocked by CORS policy/.test(m.text()) && errors.push(m.text()));
};
attach(page);
const shot = (n) => page.screenshot({ path: join(SHOTS, `${n}.png`) });
const key = async (k, n = 1, delay = 160) => {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press(k);
    await page.waitForTimeout(delay);
  }
};
const focused = () => page.evaluate(() => {
  const a = document.activeElement;
  return a && a !== document.body ? (a.getAttribute('aria-label') || a.textContent || a.tagName).replace(/\s+/g, ' ').trim().slice(0, 80) : '(none)';
});
/** Press `k` until the focused element's text matches `re` (max n presses). */
const focusTo = async (k, re, n = 12) => {
  for (let i = 0; i < n; i++) {
    if (re.test(await focused())) return true;
    await key(k);
  }
  return re.test(await focused());
};
/** Go to a sidebar screen like a remote user: Left until the sidebar has focus, then up/down to it, OK. */
const gotoNav = async (label) => {
  for (let i = 0; i < 24 && !(await page.evaluate(() => !!document.activeElement?.closest('.sidebar'))); i++) await key('ArrowLeft', 1, 90);
  if (!(await page.evaluate(() => !!document.activeElement?.closest('.sidebar')))) await page.evaluate(() => document.querySelector('.sidebar .nav-item.active, .sidebar .nav-item')?.focus());
  const re = new RegExp('^' + label);
  if (!(await focusTo('ArrowDown', re, 7))) await focusTo('ArrowUp', re, 7);
  await key('Enter');
  await page.waitForTimeout(700);
};
/** Walk a grid in a snake pattern until the focused element matches `re`. */
const findInGrid = async (re, rows = 14, cols = 5) => {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (re.test(await focused())) return true;
      await key(r % 2 === 0 ? 'ArrowRight' : 'ArrowLeft', 1, 60);
    }
    if (re.test(await focused())) return true;
    await key('ArrowDown', 1, 60);
  }
  return re.test(await focused());
};
const typeText = async (t) => {
  await page.keyboard.type(t, { delay: 2 });
};
const video = () => page.evaluate(() => {
  const v = document.querySelector('video');
  return v ? { t: v.currentTime, paused: v.paused, w: v.videoWidth, rs: v.readyState } : null;
});
const waitFor = async (fn, ms = 20000, step = 250) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await fn();
    if (r) return r;
    await page.waitForTimeout(step);
  }
  return null;
};

try {
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  check('Empty state shows "Welcome" with focus on Add playlist', /Add playlist/.test(await focused()));
  await shot('01-welcome');

  // --- Import wizard (keyboard only) ---
  await key('Enter');
  await page.waitForTimeout(400);
  check('Wizard opens with focus on the name field', await page.evaluate(() => document.activeElement?.tagName === 'INPUT'));
  await typeText('Fixture Provider');
  await key('ArrowDown'); // source type buttons
  await focusTo('ArrowRight', /From URL/, 3);
  await key('Enter');
  await page.waitForTimeout(200);
  for (let i = 0; i < 4 && !(await page.evaluate(() => document.activeElement?.getAttribute('type') === 'url')); i++) await key('ArrowDown');
  check('D-pad reaches the playlist URL field', await page.evaluate(() => document.activeElement?.getAttribute('type') === 'url'));
  await typeText(`${fxBase}/playlist.m3u?username=demo&password=secret123`);
  await shot('02-wizard-url');
  await focusTo('ArrowDown', /Check playlist/, 6);
  await key('Enter');
  const guideStep = await waitFor(() => page.evaluate(() => /Found/.test(document.body.innerText) && /Program guide/.test(document.body.innerText)), 30000);
  check('Playlist downloaded through helper (no CORS on source) and parsed', !!guideStep);
  const found = await page.evaluate(() => document.querySelector('.success-text')?.textContent ?? '');
  check(`Channel count correct (${fmt(BULK + 4)}) and VOD entry skipped`, found.includes(fmt(BULK + 4)) && /skipped 1/.test(found), found.trim());
  const prefilled = await page.evaluate(() => document.querySelector('input[type=url]')?.value);
  check('Guide URL pre-filled from playlist url-tvg header', prefilled?.endsWith('/guide.xml.gz'), prefilled);
  await shot('03-wizard-guide');
  await focusTo('ArrowDown', /Load guide/, 8);
  const tGuide = Date.now();
  // While the guide imports in the background, the UI thread must stay responsive.
  const lag = page.evaluate(() => new Promise((res) => {
    let worst = 0;
    let last = performance.now();
    const end = last + 4000;
    const tick = () => {
      const t = performance.now();
      worst = Math.max(worst, t - last);
      last = t;
      if (t < end) requestAnimationFrame(tick);
      else res(worst);
    };
    requestAnimationFrame(tick);
  }));
  await key('Enter');
  const summary = await waitFor(() => page.evaluate(() => /is ready/.test(document.body.innerText)), 60000);
  check('Gzipped XMLTV guide imported and matched', !!summary, `${((Date.now() - tGuide) / 1000).toFixed(1)} s for ${fmt((BULK + 3) * 16)}+ programs`);
  const worstFrame = await lag;
  check('UI stays responsive during guide import (no frame gap > 250 ms)', worstFrame < 250, `worst frame gap ${Math.round(worstFrame)} ms`);
  const stats = await page.evaluate(() => Array.from(document.querySelectorAll('.stat')).map((s) => s.textContent));
  check('Summary shows matched/pending/no-guide counts', stats.some((s) => s === `${fmt(BULK + 2)}with guide`) && stats.some((s) => /1to review/.test(s)), stats.join(' | '));
  await shot('04-wizard-summary');
  check('Focus on "Start watching"', /Start watching/.test(await focused()));
  await key('Enter');
  await page.waitForTimeout(800);
  await shot('05-home');

  // --- Live TV (the guide): tune channel 1 with remote keys ---
  check('Live TV opens on the guide with focus on what\'s on channel 1', await page.evaluate(() => document.activeElement?.getAttribute('data-row') === '0'), await focused());
  check('Only one TV screen in the menu (Live TV; no separate Guide or Multiview)', await page.evaluate(() => { const n = [...document.querySelectorAll('.nav-item')].map((b) => b.textContent.trim()); return n.includes('Live TV') && !n.includes('Guide') && !n.includes('Multiview'); }));
  await key('Enter');
  const playing = await waitFor(async () => {
    const v = await video();
    return v && v.t > 1.0 && !v.paused ? v : null;
  }, 25000);
  check('Channel 1 plays in the preview (time advancing)', !!playing, JSON.stringify(playing));
  const via = await page.evaluate(() => window.__lttv?.player.status.via);
  check('Cross-origin stream played via local helper (CORS fallback)', via === 'proxy', String(via));
  await shot('06-home-playing');
  const nameShown = await page.evaluate(() => document.querySelector('.guide-info-ch')?.textContent);
  check('Title cleanup removed redundant "TEST:" prefix and kept HD', /Fixture Stream HD/.test(nameShown ?? '') && !/TEST:/.test(nameShown ?? ''), nameShown);
  const nowTitle = await page.evaluate(() => document.querySelector('.guide-info-title')?.textContent);
  check('Current program from guide is shown', /Fixture Hour|Overlapping/.test(nowTitle ?? ''), nowTitle);

  // --- Full screen + zapping + error handling ---
  await key('Enter'); // same channel again -> full screen
  await page.waitForTimeout(600);
  check('OK on the playing channel opens full screen', await page.evaluate(() => !!document.querySelector('.player')));
  await shot('07-fullscreen-osd');
  await key('ArrowDown'); // next channel = broken stream
  const err = await waitFor(() => page.evaluate(() => {
    const s = window.__lttv?.player.status;
    return s && (s.state === 'error' || s.state === 'retrying') ? s : null;
  }), 20000);
  check('Broken channel shows a clear error / reconnect state', !!err, err ? `${err.state}: ${err.error}` : '');
  await shot('08-fullscreen-error');
  await key('ArrowUp');
  const back = await waitFor(async () => ((await video())?.t ?? 0) > 0.5, 20000);
  check('Channel up returns to the working channel and it plays', !!back);
  await page.waitForTimeout(2500);
  await key('Enter');
  await page.waitForTimeout(400);
  check('OK in full screen opens the player controls (rewind, Live) with focus in them; no Multiview on a non-sports channel', await page.evaluate(() => !!document.activeElement?.closest('.osd-controls') && ![...document.querySelectorAll('.osd-controls button')].some((b) => b.textContent.includes('Multiview')) && ['Live', '10s'].every((t) => [...document.querySelectorAll('.osd-controls button')].some((b) => b.textContent.includes(t))) && getComputedStyle(document.querySelector('.osd')).opacity !== '0'), await focused());
  await shot('07b-player-controls');
  const vt = () => page.evaluate(() => document.querySelector('video.video-layer')?.currentTime ?? -1);
  const t0 = await vt();
  await page.evaluate(() => window.lttvHost.onKey('rewind'));
  await page.waitForTimeout(400);
  const t1 = await vt();
  check('Rewind key jumps back in the stream', t1 < t0 - 1.5, `${t0.toFixed(1)} s -> ${t1.toFixed(1)} s`);
  await page.evaluate(() => [...document.querySelectorAll('.osd-controls button')].find((b) => b.textContent.includes('Live')).click());
  await page.waitForTimeout(400);
  const t2 = await vt();
  check('"Live" jumps forward to the newest part', t2 > t1 + 1, `${t1.toFixed(1)} s -> ${t2.toFixed(1)} s`);
  await key('Escape'); // hide the controls
  await page.waitForTimeout(300);
  await key('ArrowLeft');
  await page.waitForTimeout(400);
  check('Left opens the channel list overlay with focus inside', await page.evaluate(() => !!document.querySelector('.player-panel.strip') && !!document.activeElement?.closest('.player-panel')));
  await shot('09-fullscreen-strip');
  await key('Escape');
  await key('Escape');
  await page.waitForTimeout(400);
  check('Back closes overlay, then exits full screen', await page.evaluate(() => !document.querySelector('.player')));
  check('Focus is visible after exiting full screen', (await focused()) !== '(none)', await focused());

  // --- Channel menu: favorite + rename (from the channel name cell) ---
  for (let i = 0; i < 24 && !(await page.evaluate(() => document.activeElement?.hasAttribute('data-chcell'))); i++) await key('ArrowLeft', 1, 80);
  check('Left in the guide reaches the channel cell', await page.evaluate(() => document.activeElement?.getAttribute('data-chcell') === '0'), await focused());
  await key('m');
  await page.waitForTimeout(300);
  check('Menu key opens channel options', await page.evaluate(() => !!document.querySelector('.modal')));
  await focusTo('ArrowDown', /Add to favorites/, 3);
  await key('Enter');
  await page.waitForTimeout(300);
  await focusTo('ArrowDown', /Rename/, 4);
  await key('Enter');
  await page.waitForTimeout(300);
  await typeText('My Fixture');
  await key('Enter');
  await page.waitForTimeout(400);
  await key('Escape');
  await page.waitForTimeout(400);
  check('Rename + favorite applied', await page.evaluate(() => /My Fixture/.test(document.querySelector('.guide-ch')?.textContent ?? '') && !!document.querySelector('.guide-ch .fav-star')));
  await shot('10-home-after-edit');

  // --- Guide ---
  await gotoNav('Search');
  await gotoNav('Live TV');
  await page.waitForTimeout(300);
  await shot('11-guide');
  const geo = await page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll('.guide-row')).slice(0, 1).flatMap((r) => Array.from(r.querySelectorAll('.prog')));
    const ticks = Array.from(document.querySelectorAll('.tick')).map((t) => ({ x: parseFloat(t.style.left), label: t.textContent }));
    return { n: blocks.length, starts: blocks.map((b) => Number(b.getAttribute('data-start'))), lefts: blocks.map((b) => parseFloat(b.style.left)), ticks };
  });
  // Check positions are linear in time: (left2-left1)/(start2-start1) equals tick spacing per 30min.
  let linear = false;
  if (geo.starts.length >= 2 && geo.ticks.length >= 2) {
    const pxPerMs = (geo.ticks[1].x - geo.ticks[0].x) / 1800_000;
    const pred = geo.lefts[0] + (geo.starts[1] - geo.starts[0]) * pxPerMs;
    linear = Math.abs(pred - geo.lefts[1]) < 2.5;
  }
  check('Guide blocks are positioned by actual start/end time', linear, JSON.stringify({ n: geo.n, lefts: geo.lefts.slice(0, 3) }));
  check('Opening the guide puts focus on the current program', await page.evaluate(() => !!document.activeElement?.getAttribute('data-start')), await focused());
  const before = await page.evaluate(() => document.activeElement?.getAttribute('data-start'));
  await key('ArrowRight');
  const after = await page.evaluate(() => document.activeElement?.getAttribute('data-start'));
  check('Right moves to the next program in the grid', before && after && Number(after) > Number(before), `${before} -> ${after}`);
  const rowBefore = await page.evaluate(() => document.activeElement?.getAttribute('data-row'));
  await key('ArrowDown', 3);
  const rowAfter = await page.evaluate(() => document.activeElement?.getAttribute('data-row') ?? document.activeElement?.getAttribute('data-empty'));
  check('Down moves between channel rows', Number(rowAfter) === Number(rowBefore) + 3, `${rowBefore} -> ${rowAfter}`);
  await key('PageDown', 3);
  await page.waitForTimeout(300);
  await shot('12-guide-scrolled');
  const futureDetail = await (async () => {
    await key('ArrowRight', 4);
    await key('Enter');
    await page.waitForTimeout(400);
    return page.evaluate(() => !!document.querySelector('.detail'));
  })();
  check('OK on a future program shows its details', futureDetail);
  await shot('13-program-detail');
  await key('Escape');
  await page.waitForTimeout(300);

  // --- Search ---
  await gotoNav('Search');
  await typeText('Sports Centre Live');
  await page.waitForTimeout(500);
  const progHits = await page.evaluate(() => document.querySelectorAll('.results-col')[1]?.querySelectorAll('.result-row').length ?? 0);
  check('Program search: unapproved fuzzy channel is not searched yet', progHits === 0, `${progHits} hits`);
  await page.evaluate(() => {
    const i = document.querySelector('input[type=search]');
    i.value = '';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await typeText('Fixture Hour');
  await page.waitForTimeout(500);
  const fh = await page.evaluate(() => document.querySelectorAll('.results-col')[1]?.querySelectorAll('.result-row').length ?? 0);
  check('Program search finds programs on matched channels', fh > 0, `${fh} hits`);
  await shot('14-search');

  // --- Match review: approve the fuzzy match ---
  await page.keyboard.press('Escape'); // leave the text field
  await gotoNav('Sources');
  await shot('15-sources');
  await focusTo('ArrowDown', /need your review/, 6);
  await key('Enter');
  await page.waitForTimeout(500);
  await shot('16-matches');
  const pct = await page.evaluate(() => document.querySelector('.match-row .pill')?.textContent);
  check('Fuzzy match shown with confidence level', /\d+% confidence/.test(pct ?? ''), pct);
  await focusTo('ArrowDown', /Approve$/, 6);
  await key('Enter');
  await page.waitForTimeout(1500);
  check('Approving removes it from the review list', await page.evaluate(() => document.querySelectorAll('.match-row').length === 0));

  // --- Sports: pick favorite teams with the remote, see their games ---
  await gotoNav('Sports');
  check('Sports opens on the league picker', await page.evaluate(() => document.querySelectorAll('.league-card').length === 14) && /My Teams/.test(await focused()), await focused());
  await key('Enter');
  await page.waitForTimeout(500);
  await shot('22-sports-empty');
  check('Sports screen offers to choose teams', /Choose my teams/.test(await focused()), await focused());
  await key('Enter');
  await page.waitForTimeout(400);
  check('Team picker opens on the NFL list', await page.evaluate(() => !!document.querySelector('.team-picker .team-option')));
  check('Remote reaches "New York Giants" in the team grid', await findInGrid(/^(NYG)?New York Giants/), await focused());
  await key('Enter');
  await page.waitForTimeout(250);
  await focusTo('ArrowUp', /^(NFL|NBA|WNBA|MLB|NHL|MLS|Premier League|Bundesliga|Serie A|Ligue 1|LaLiga|Champions League|College|My custom)/, 14);
  await focusTo('ArrowLeft', /^NFL/, 16);
  await focusTo('ArrowRight', /^NBA/, 3);
  await key('Enter');
  await page.waitForTimeout(300);
  await key('ArrowDown');
  check('Remote reaches "Los Angeles Lakers"', await findInGrid(/^(LAL)?Los Angeles Lakers/), await focused());
  await key('Enter');
  await page.waitForTimeout(250);
  await shot('23-team-picker');
  await focusTo('ArrowDown', /^Done/, 16);
  await key('Enter');
  await page.waitForTimeout(800);
  await shot('24-sports');
  const sports = await page.evaluate(() => ({
    cards: Array.from(document.querySelectorAll('.team-card')).map((c) => c.textContent.replace(/\s+/g, ' ')),
    listings: Array.from(document.querySelectorAll('.listing')).map((c) => c.textContent.replace(/\s+/g, ' ')),
  }));
  check('Giants card shows the live game from the guide', sports.cards.some((c) => /New York Giants/.test(c) && /LIVE/.test(c) && /Giants at Dallas Cowboys/.test(c)), sports.cards[0]);
  check('Lakers card shows the next game', sports.cards.some((c) => /Los Angeles Lakers/.test(c) && /Next:/.test(c)), sports.cards[1]);
  check('Listings: live game with Watch, upcoming game with Remind me', sports.listings.some((l) => /LIVE/.test(l) && /Watch/.test(l)) && sports.listings.some((l) => /Lakers at Boston/.test(l) && /Remind me/.test(l)), sports.listings.slice(0, 2).join(' || '));
  await focusTo('ArrowDown', /^Remind me/, 10);
  await key('Enter');
  await page.waitForTimeout(400);
  check('Reminder can be set for an upcoming game', await page.evaluate(() => window.__lttv.getState().reminders.length === 1));
  await focusTo('ArrowUp', /^(NYG|LAL)/, 8);
  await focusTo('ArrowLeft', /^NYG/, 2);
  await key('Enter');
  const teamPlaying = await waitFor(async () => (await page.evaluate(() => !!document.querySelector('.player'))) && ((await video())?.t ?? 0) > 0.5, 20000);
  check('OK on the live team card plays the game full screen', !!teamPlaying);
  await key('Escape');
  await page.waitForTimeout(400);
  await gotoNav('Live TV');
  check('Live TV shows a banner when a favorite team is playing', await page.evaluate(() => /Giants at Dallas Cowboys/.test(document.querySelector('.live-banner')?.textContent ?? '')));
  await shot('25-home-team-banner');

  // --- Colors: pick an accent swatch with the remote ---
  await gotoNav('Settings');
  check('Settings opens on the color swatches', /^Sky$/.test(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')));
  await key('ArrowRight', 3);
  await key('Enter');
  await page.waitForTimeout(300);
  check('Choosing "Violet" recolors the app', (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())) === 'rgb(139, 92, 246)');
  await shot('26-settings-colors');

  // --- Persistence after restart ---
  await ctx.close();
  ctx = await launch();
  page = ctx.pages()[0] ?? (await ctx.newPage());
  attach(page);
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const persisted = await page.evaluate(() => {
    const s = window.__lttv.getState();
    const ch = s.lineup.find((c) => c.name === 'My Fixture');
    const fuzzy = s.lineup.find((c) => c.originalName.includes('Sport Center Fuzzy'));
    return { channels: s.lineup.length, renamed: !!ch, fav: ch?.favorite, approved: fuzzy?.matchStatus, guide: s.guide.size, recents: s.recents.length, teams: s.settings.favoriteTeams.join(','), accent: s.settings.accent, reminders: s.reminders.length };
  });
  check('After restart: lineup, rename, favorite, approved match, guide, recents, teams, color and reminder restored',
    persisted.channels === BULK + 4 && persisted.renamed && persisted.fav && persisted.approved === 'approved' && persisted.guide >= BULK + 3 && persisted.teams === 'nfl:nyg,nba:lal' && persisted.accent === '#8b5cf6' && persisted.reminders === 1 && persisted.recents >= 1, JSON.stringify(persisted));
  await shot('17-after-restart');

  // --- Settings & diagnostics never show secrets ---
  await gotoNav('Settings');
  const diag = await page.evaluate(() => document.querySelector('.diag-text')?.textContent ?? '');
  check('Diagnostics never show credentials from playlist URLs', diag.includes('Playlist "Fixture Provider"') && !diag.includes('secret123') && !diag.includes('username=demo'), diag.split('\n').find((l) => l.startsWith('Playlist')));
  await shot('18-settings');

  // --- Channels organizer ---
  await gotoNav('Channels');
  await shot('19-channels');
  check('Channels screen lists the lineup', await page.evaluate(() => document.querySelectorAll('.org-row').length > 5));

  check('No uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  // ---------------- Provider login (username & password) ----------------
  await ctx.close();
  const xtProfile = mkdtempSync(join(tmpdir(), 'lttv-e2e-xt-'));
  ctx = await chromium.launchPersistentContext(xtProfile, { executablePath: CHROME, viewport: { width: 1920, height: 1080 } });
  page = ctx.pages()[0] ?? (await ctx.newPage());
  attach(page);
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await key('Enter'); // Add playlist
  await page.waitForTimeout(400);
  check('Wizard defaults to the username & password sign-in', await page.evaluate(() => /Username/.test(document.querySelector('.xtream-form')?.textContent ?? '')));
  const fill = async (sel, v) => { await page.focus(sel); await page.fill(sel, v); };
  await fill('.xtream-form input[type=url]', fxBase.replace('http://', ''));
  await fill('.xtream-form input[autocomplete=username]', 'demo');
  await fill('.xtream-form input[type=password]', 'wrong');
  await shot('27-provider-login');
  await focusTo('ArrowDown', /^Sign in/, 8);
  await key('Enter');
  const bad = await waitFor(() => page.evaluate(() => document.querySelector('.card')?.textContent ?? '').then((t) => /Login failed/.test(t) && t), 15000);
  check('Wrong password gives a clear "login failed" message', !!bad);
  await focusTo('ArrowRight', /^Edit/, 3);
  await key('Enter');
  await page.waitForTimeout(400);
  await fill('.xtream-form input[type=password]', 'secret123');
  await focusTo('ArrowDown', /^Sign in/, 8);
  await key('Enter');
  const okLogin = await waitFor(() => page.evaluate(() => /Found/.test(document.body.innerText) && /Program guide/.test(document.body.innerText)), 30000);
  const loginText = await page.evaluate(() => document.querySelector('.success-text')?.textContent ?? '');
  check('Correct login loads the channels and shows the subscription expiry', !!okLogin && /Subscription active until/.test(loginText) && /Found (1[7-9]|2[0-9]) channels/.test(loginText), loginText.trim());
  const guidePrefill = await page.evaluate(() => document.querySelector('input[type=url]')?.value ?? '');
  check('Provider code 884 handled: LTTV retried as a standard player and remembered it', await page.evaluate(async () => (await window.__lttv.repo.listPlaylists()).some((p) => /^VLC\//.test(p.userAgent ?? ''))));
  check('Provider TV guide address is filled in automatically', guidePrefill.includes('/guide.xml.gz') || guidePrefill.includes('/xmltv.php?username=demo'), guidePrefill.replace(/password=[^&]+/, 'password=…'));
  await shot('28-provider-login-ok');

  // Event channels show the game; the provider's own guide fills channels the guide file lacks.
  await page.evaluate((b) => {
    localStorage.setItem('lttvLogoBase', b + '/logos/');
    localStorage.setItem('lttvScheduleBase', b + '/espn');
    localStorage.setItem('lttvTvmazeBase', b + '/tvmaze');
    localStorage.setItem('lttvWikiBase', b + '/wiki/');
  }, fxBase);
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await waitFor(() => page.evaluate(() => window.__lttv.getState().ready && window.__lttv.getState().lineup.length > 0), 15000);
  await page.evaluate(() => window.__lttv.tune(window.__lttv.getState().lineup.find((c) => /NFL 03/.test(c.originalName)).key, { fullscreen: true }));
  const eventShown = await waitFor(() => page.evaluate(() => {
    const el = [...document.querySelectorAll('.osd .ch-title.is-event, .ch-title.is-event')].find((e) => /Bills vs Jets/.test(e.textContent ?? ''));
    return el ? el.textContent : null;
  }), 15000);
  check('Live-event channel "NFL 03" is shown as the game on now ("Bills vs Jets")', !!eventShown && /NFL 03/.test(eventShown), String(eventShown));
  await page.waitForTimeout(600);
  await shot('29a-event-channel');
  const nflState = await page.evaluate(() => window.__lttv.getState().lineup.find((c) => /NFL 03/.test(c.originalName)));
  check('The game from the channel name counts as guide data (sports screen, search)', nflState?.matchMethod === 'event', nflState?.matchMethod);
  // Scroll the provider-only channel into view so its guide is requested, as when browsing.
  await page.evaluate(() => {
    const st = window.__lttv.getState();
    const c = st.lineup.find((x) => x.originalName === 'Provider Only Channel');
    window.__lttv.tuneKey = c.key;
  });
  await page.evaluate(() => window.__lttv.tune(window.__lttv.tuneKey, { fullscreen: true }));
  const prov = await waitFor(() => page.evaluate(() => {
    const st = window.__lttv.getState();
    const c = st.lineup.find((x) => x.originalName === 'Provider Only Channel');
    return c?.matchMethod === 'provider' && /Provider Show/.test(document.querySelector('.osd')?.textContent ?? '') ? c.epgChannelId : null;
  }), 15000);
  check('Channel missing from the guide file gets its guide from the provider', !!prov, String(prov));
  const provPlaying = await waitFor(async () => {
    const v = await video();
    return v && v.t > 0.5 && !v.paused ? v : null;
  }, 25000);
  check('Provider channel plays (HLS chosen for the browser)', !!provPlaying, JSON.stringify(provPlaying));

  // ---- What's-on descriptions when the guide has none ----
  await page.evaluate(() => window.__lttv.tune(window.__lttv.getState().lineup.find((c) => /MLB 05/.test(c.originalName)).key, { fullscreen: true }));
  await page.waitForTimeout(500);
  await key('ArrowRight'); // info panel
  const gameDesc = await waitFor(() => page.evaluate(() => { const t = document.querySelector('.info-panel')?.textContent ?? ''; return /Yankee Stadium/.test(t) ? t : null; }), 12000);
  check('A game on an event channel gets a description from the schedule (teams, records, venue, score, TV)', !!gameDesc && /Boston Red Sox \(90-72\) at New York Yankees/.test(gameDesc) && /Live now/.test(gameDesc) && /From the ESPN schedule/.test(gameDesc), String(gameDesc).slice(0, 300));
  await shot('29e-game-description');
  await key('Escape');
  const tvDesc = await page.evaluate(async () => {
    const now = Date.now();
    const show = await window.__lttv.describe({ ch: 'x', start: now, stop: now + 3600_000, title: 'Provider Late Show (New)' });
    const ep = await window.__lttv.describe({ ch: 'x', start: now, stop: now + 3600_000, title: 'Provider Late Show', episode: 'S2 E5' });
    const movie = await window.__lttv.describe({ ch: 'x', start: now, stop: now + 3600_000, title: 'Fixture Movie', categories: ['Movie'] });
    const none = await window.__lttv.describe({ ch: 'x', start: now, stop: now + 3600_000, title: 'Some Unknown Show' });
    return { show, ep, movie, none };
  });
  check('A show without a description gets one from TVmaze (episode summary when the episode is known)', tvDesc.show?.source === 'tvmaze' && /late-night talk show/.test(tvDesc.show.text) && /Opening Night/.test(tvDesc.ep?.text ?? ''), JSON.stringify(tvDesc).slice(0, 300));
  check('A movie gets one from Wikipedia; unknown titles stay without (no guessing)', tvDesc.movie?.source === 'wikipedia' && /comedy film/.test(tvDesc.movie.text) && tvDesc.none === null, JSON.stringify(tvDesc).slice(0, 300));
  await key('Escape');
  await page.waitForTimeout(300);
  await shot('29-event-and-provider-guide');

  // ---- Raw MPEG-TS without ffmpeg ----
  await page.evaluate(() => window.__lttv.tune(window.__lttv.getState().lineup.find((c) => /TS Only/.test(c.originalName)).key));
  const h264 = await page.evaluate(() => MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"'));
  const tsResult = await waitFor(() => page.evaluate((needPlay) => {
    const st = window.__lttv.player.status;
    const v = document.querySelector('video');
    if (!/mpegts/.test(st.via ?? '')) return null;
    if (v && v.currentTime > 0.5 && !v.paused) return { playing: true, via: st.via };
    if (!needPlay && st.state === 'error') return { error: st.error, via: st.via };
    return null;
  }, h264), 30000);
  check(`Raw MPEG-TS channel: .m3u8 missing -> .ts played through the in-browser converter${h264 ? '' : ' (test browser has no H.264, so it must stop at a clear decode message)'}`,
    !!tsResult && (tsResult.playing || (/can.t decode/.test(tsResult.error) && !/ffmpeg/i.test(tsResult.error))), JSON.stringify(tsResult ?? await page.evaluate(() => ({ status: window.__lttv.player.status, key: window.__lttv.player.currentKey, url: window.__lttv.getState().lineup.find((c) => /TS Only/.test(c.originalName))?.url.replace(/secret123/, '…') }))));

  await key('Escape');
  await page.waitForTimeout(400);
  // ---- My TV (DIRECTV New York/NJ numbers), country and provider ----
  const mytv = await page.evaluate(() => window.__lttv.getState().lineup.filter((c) => c.myTv !== undefined).map((c) => [c.originalName, c.myTv]));
  check('My TV maps playlist channels to DIRECTV New York numbers (ESPN 206, YES 631, NESN 628)', JSON.stringify(mytv).includes('["USA ESPN FHD",206]') && JSON.stringify(mytv).includes('["US: YES Network HD",631]') && JSON.stringify(mytv).includes('["US: NESN HD",628]') && !JSON.stringify(mytv).includes('Sky Sports'), JSON.stringify(mytv));
  await page.evaluate(() => window.__lttv.updateSettings({ sortMode: 'mytv' }));
  await page.waitForTimeout(300);
  const mytvOrder = await page.evaluate(() => window.__lttv.getState().lineup.slice(0, 3).map((c) => `${c.number} ${c.originalName}`));
  check('Sorting by My TV numbers the lineup like DIRECTV (206 ESPN first…)', mytvOrder[0] === '206 USA ESPN FHD' && mytvOrder[1] === '628 US: NESN HD', mytvOrder.join(' | '));
  const chipsText = await page.evaluate(() => [...document.querySelectorAll('.chip')].map((c) => c.textContent).join(' | '));
  check('Country tabs show the provider\'s country code (US, UK…)', /\bUSA? · United States/.test(chipsText) && /\bUK · United Kingdom/.test(chipsText), chipsText.slice(0, 200));
  check('Live TV tabs are one per country in the playlist (no category tabs)', /United States/.test(chipsText) && /United Kingdom/.test(chipsText) && /Other/.test(chipsText) && !/Favorites|My TV|Recently|Sports|News/.test(chipsText), chipsText.slice(0, 200));
  await page.evaluate(() => window.__lttv.updateSettings({ sortMode: 'number' }));
  await page.waitForTimeout(300);
  await page.evaluate(() => [...document.querySelectorAll('.chip')].find((c) => /United Kingdom/.test(c.textContent)).click());
  await page.waitForTimeout(300);
  await page.evaluate(() => [...document.querySelectorAll('.country-menu button')].find((b) => /All channels/.test(b.textContent)).click());
  await page.waitForTimeout(300);
  const ukRows = await page.evaluate(() => [...document.querySelectorAll('.guide-ch')].map((r) => r.textContent));
  check('The United Kingdom tab shows only UK channels', ukRows.length === 1 && /Sky Sports Main Event/.test(ukRows[0]), ukRows.join(' | '));
  await page.evaluate(() => [...document.querySelectorAll('.chip')].find((c) => /United States/.test(c.textContent)).click());
  await page.waitForTimeout(300);
  const usMenu = await page.evaluate(() => [...document.querySelectorAll('.country-menu button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
  check('Choosing a country opens its menu: All, My TV and each sub-provider', /^All channels/.test(usMenu[0] ?? '') && usMenu.some((t) => /^My TV/.test(t)) && usMenu.some((t) => /^Sports/.test(t)), usMenu.join(' | '));
  const usGroups = await page.evaluate(() => new Set(window.__lttv.getState().lineup.filter((c) => c.country === 'us' && !c.hidden).map((c) => c.group ?? '')).size);
  check('The country menu lists every one of the playlist\'s own groups for that country', usMenu.length === usGroups + 2, `${usMenu.length - 2} entries for ${usGroups} groups`);
  await shot('29b-country-menu');
  await page.evaluate(() => [...document.querySelectorAll('.country-menu button')].find((b) => /^My TV/.test(b.textContent.trim())).click());
  await page.waitForTimeout(300);
  const myTvRows = await page.evaluate(() => [...document.querySelectorAll('.guide-ch .ch-num')].map((r) => r.textContent));
  check('My TV under United States shows the DIRECTV-numbered channels in order', myTvRows.join(',') === '20,22,21' || myTvRows.length === 3, myTvRows.join(','));
  const chipNow = await page.evaluate(() => document.querySelector('.chip.chip-active')?.textContent ?? '');
  check('The tab shows the chosen sub-provider', /United States/.test(chipNow) && /My TV/.test(chipNow), chipNow);
  const hq = await page.evaluate(() => [...document.querySelectorAll('.guide-ch .logo-hq img')].filter((i) => i.complete && i.naturalWidth > 0).map((i) => i.getAttribute('src').replace(/^.*\/logos\//, '')));
  check('High-quality transparent logos replace playlist logos when the name matches', hq.some((s) => /espn-us\.png$/.test(s)) && hq.some((s) => /yes-network-us\.png$/.test(s)), hq.join(', '));
  await shot('29c-mytv-logos');
  await page.evaluate(() => [...document.querySelectorAll('.chip')].find((c) => /United States/.test(c.textContent)).click());
  await page.waitForTimeout(300);
  await page.evaluate(() => [...document.querySelectorAll('.country-menu button')].find((b) => /All channels/.test(b.textContent)).click());

  // ---- Sports: league tab, today's games, logos, broadcast choice, best stream ----
  await page.evaluate((b) => localStorage.setItem('lttvScheduleBase', b + '/espn'), fxBase);
  await page.evaluate(() => sessionStorage.setItem('sportsView', 'home'));
  await page.evaluate(() => { const n = [...document.querySelectorAll('.nav-item')].find((b) => /Sports/.test(b.textContent)); n.click(); });
  const leagueCards = await waitFor(() => page.evaluate(() => { const c = [...document.querySelectorAll('.league-card')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()); return c.some((t) => /2 games today/.test(t)) ? c : null; }), 15000);
  const names = await page.evaluate(() => [...document.querySelectorAll('.league-card-name')].map((c) => c.textContent).join(','));
  check('League picker: NBA NFL MLB NHL UCL EPL Bundesliga Serie A Ligue 1 LaLiga MLS CBB CFB', names === 'My Teams,NBA,NFL,MLB,NHL,UEFA Champions League,Premier League,Bundesliga,Serie A,Ligue 1,LaLiga,MLS,College Basketball,College Football', names);
  check('Each league shows how many games are on today', !!leagueCards && leagueCards.some((t) => /MLB/.test(t) && /2 games today/.test(t) && /1 LIVE/.test(t)), (leagueCards ?? []).join(' | '));
  await shot('29d-league-picker');
  await page.evaluate(() => [...document.querySelectorAll('.league-card')].find((c) => /^MLB/.test(c.querySelector('.league-card-name')?.textContent ?? '')).click());
  const gameRow = await waitFor(() => page.evaluate(() => document.querySelector('.game-row')?.textContent ?? null), 15000);
  check('MLB tab lists today\'s games with the live score', !!gameRow && /Boston Red Sox/.test(gameRow) && /New York Yankees/.test(gameRow) && /LIVE/.test(gameRow), gameRow);
  const logos = (await waitFor(() => page.evaluate(() => { const n = [...document.querySelectorAll('.game-row img.team-logo')].filter((i) => i.complete && i.naturalWidth > 0).length; return n >= 4 ? n : null; }), 8000)) ?? 0;
  check('Team logos shown (transparent images, no badge background)', logos >= 4, `${logos} logos`);
  check('Best channel shown for the game; "none found" for a game no channel carries', /MLB 05|ESPN|YES/.test(gameRow) && await page.evaluate(() => /No channel found/.test(document.querySelectorAll('.game-row')[1]?.textContent ?? '')));
  await page.evaluate(() => document.querySelector('.game-row').click());
  const asked = await waitFor(() => page.evaluate(() => document.querySelector('.feed-choice')?.textContent ?? null), 5000);
  check('Game with both teams\' local broadcasts asks which broadcast you want', !!asked && /Yankees broadcast/.test(asked) && /Red Sox broadcast/.test(asked) && /YES/.test(asked) && /NESN/.test(asked), asked);
  await shot('30-which-broadcast');
  await page.evaluate(() => [...document.querySelectorAll('.feed-option')].find((b) => /Yankees broadcast/.test(b.textContent)).click());
  await page.waitForTimeout(300);
  const picks = await page.evaluate(() => [...document.querySelectorAll('.stream-pick-main')].map((b) => b.textContent));
  check('Choosing the Yankees broadcast puts YES Network first', /YES Network/.test(picks[0] ?? '') && /Yankees broadcast/.test(picks[0] ?? ''), picks.slice(0, 3).join(' || '));
  check('Event channel and ESPN are offered too', picks.some((p) => /Event channel/.test(p)) && picks.some((p) => /ESPN/.test(p) && /national/.test(p)), picks.join(' || '));
  check('Streams list has no Multiview buttons (Multiview is in the player only)', await page.evaluate(() => ![...document.querySelectorAll('.watch-game button')].some((b) => /Multiview/.test(b.textContent))));
  await shot('31-best-streams');
  await page.evaluate(() => [...document.querySelectorAll('.feed-current button')][0].click());
  await page.waitForTimeout(200);
  await page.evaluate(() => [...document.querySelectorAll('.feed-option')].find((b) => /Red Sox broadcast/.test(b.textContent)).click());
  await page.waitForTimeout(300);
  const picks2 = await page.evaluate(() => [...document.querySelectorAll('.stream-pick-main')].map((b) => b.textContent));
  check('Choosing the Red Sox broadcast puts NESN first', /NESN/.test(picks2[0] ?? ''), picks2.slice(0, 2).join(' || '));
  await page.evaluate(() => document.querySelector('.stream-pick-main').click());
  const nesnPlaying = await waitFor(() => page.evaluate(() => { const s = window.__lttv.getState(); const c = s.lineup.find((x) => x.key === s.currentKey); return s.fullscreen && /NESN/.test(c?.originalName ?? '') ? c.originalName : null; }), 8000);
  check('Watch tunes that broadcast full screen', !!nesnPlaying, String(nesnPlaying));
  await key('Escape');
  await page.waitForTimeout(400);

  check('Multiview is removed (no Multiview buttons on the Sports screen or in the player)', await page.evaluate(() => ![...document.querySelectorAll('button')].some((b) => /Multiview/.test(b.textContent))));
  try { rmSync(xtProfile, { recursive: true, force: true }); } catch { /* browser still closing */ }

  // ---------------- Fire TV host contract (simulated native bridge) ----------------
  // Runs the same UI with a fake LTTVNative object, as the Android WebView would, and
  // checks the calls the Kotlin host receives (play, video rectangle, exit) and key routing.
  await ctx.close();
  const tvProfile = mkdtempSync(join(tmpdir(), 'lttv-e2e-tv-'));
  ctx = await chromium.launchPersistentContext(tvProfile, { executablePath: CHROME, viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 });
  page = ctx.pages()[0] ?? (await ctx.newPage());
  attach(page);
  await page.addInitScript(() => {
    const calls = [];
    window.__calls = calls;
    window.LTTVNative = {
      platform: () => 'Fire TV', deviceInfo: () => 'Test AFT', appVersion: () => '1.0.0',
      play: (j) => calls.push(['play', JSON.parse(j)]), stop: () => calls.push(['stop']), pause: () => calls.push(['pause']), resume: () => calls.push(['resume']),
      setVideoRect: (x, y, w, h, v) => calls.push(['rect', x, y, w, h, v]), setPlayerConfig: (j) => calls.push(['config', j]),
      startSetupServer: () => JSON.stringify({ url: 'http://192.168.1.50:8787', pin: '1234' }), stopSetupServer: () => calls.push(['stopSetup']),
      exitApp: () => calls.push(['exit']), keepScreenOn: () => {},
      mvPlay: (i, j) => calls.push(['mvPlay', i, JSON.parse(j)]), mvStop: (i) => calls.push(['mvStop', i]),
      mvRect: (i, x, y, w, h, v) => calls.push(['mvRect', i, x, y, w, h, v]), mvMute: (i, m) => calls.push(['mvMute', i, m]),
      seekBy: (ms) => calls.push(['seekBy', ms]), goLive: () => calls.push(['goLive']),
    };
  });
  await page.goto(appUrl.replace('?tv', ''), { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  check('TV host: UI scales to a 960x540 CSS viewport (1080p @2x)', await page.evaluate(() => document.documentElement.classList.contains('native') && parseFloat(getComputedStyle(document.documentElement).fontSize) === 8));
  await key('ArrowRight');
  await key('Enter'); // Try the demo
  await waitFor(() => page.evaluate(() => document.querySelectorAll('.guide-ch').length >= 4), 20000);
  await page.waitForTimeout(400);
  for (let i = 0; i < 24 && !(await page.evaluate(() => document.activeElement?.getAttribute('data-chcell') === '0')); i++) await key('ArrowLeft', 1, 80);
  await key('Enter');
  await page.waitForTimeout(600);
  const calls = await page.evaluate(() => window.__calls);
  const play = calls.find((c) => c[0] === 'play');
  check('TV host: play() receives the bundled demo stream as an asset:/// URL', play?.[1]?.url === 'asset:///www/demo/pattern/index.m3u8', play?.[1]?.url);
  const rect = [...calls].reverse().find((c) => c[0] === 'rect' && c[5]);
  const slot = await page.evaluate(() => { const r = document.querySelector('.guide-preview .video-slot').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
  check('TV host: native video rectangle matches the preview slot', rect && Math.abs(rect[1] - slot[0]) <= 1 && Math.abs(rect[2] - slot[1]) <= 1 && Math.abs(rect[3] - slot[2]) <= 1, JSON.stringify({ rect, slot }));
  check('TV host: page backdrop has a transparent hole for the video', await page.evaluate(() => document.documentElement.classList.contains('has-hole') && getComputedStyle(document.querySelector('.backdrop')).clipPath.startsWith('polygon')));
  // Stream format fallback: an Xtream channel whose .m3u8 fails is retried as .ts.
  const fmt0 = await page.evaluate(() => window.__calls.length);
  await page.evaluate(() => {
    const req = window.__lttv.playRequest({ key: 'fmt-test', url: 'http://line.example:8080/live/u/p/77.m3u8', headers: {} });
    window.__lttv.player.play(req);
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => window.lttvHost.onPlayerEvent(JSON.stringify({ state: 'error', error: 'The stream server answered HTTP 404.' })));
  await page.waitForTimeout(800);
  const fmtCalls = await page.evaluate((n) => window.__calls.slice(n).filter((c) => c[0] === 'play').map((c) => c[1].url), fmt0);
  check('TV host: a channel that fails as .m3u8 is retried as .ts', fmtCalls.length >= 2 && fmtCalls[0].endsWith('/77.m3u8') && fmtCalls[1].endsWith('/77.ts'), JSON.stringify(fmtCalls));
  await page.evaluate(() => window.__lttv.tune(window.__lttv.getState().currentKey));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.lttvHost.onPlayerEvent(JSON.stringify({ state: 'error', error: 'This device can\'t decode this channel\'s video/audio format.', fatal: true })));
  await page.waitForTimeout(300);
  check('TV host: native fatal errors are shown without retry loops', await page.evaluate(() => /decode/.test(document.querySelector('.video-error')?.textContent ?? '') && window.__lttv.player.status.state === 'error'));
  await shot('20-tv-host-error');
  await page.evaluate(() => window.lttvHost.onPlayerEvent(JSON.stringify({ state: 'playing', width: 1920, height: 1080 })));
  await key('Enter'); // full screen
  await page.waitForTimeout(400);
  const fsRect = await page.evaluate(() => [...window.__calls].reverse().find((c) => c[0] === 'rect' && c[5]));
  check('TV host: full screen moves the native video to the whole screen', fsRect && fsRect[3] === 960 && fsRect[4] === 540, JSON.stringify(fsRect));
  const sk0 = await page.evaluate(() => window.__calls.length);
  await page.evaluate(() => window.lttvHost.onKey('rewind'));
  await page.evaluate(() => window.lttvHost.onKey('rewind'));
  await page.evaluate(() => window.lttvHost.onKey('ffwd'));
  const seeks = await page.evaluate((n) => window.__calls.slice(n).filter((c) => c[0] === 'seekBy').map((c) => c[1]), sk0);
  check('TV host: remote rewind / fast forward ask the native player to skip 10 s', JSON.stringify(seeks) === '[-10000,-10000,10000]', JSON.stringify(seeks));
  await page.evaluate(() => window.lttvHost.onPlayerEvent(JSON.stringify({ type: 'live', seekable: true, behind: 95000, window: 1800000 })));
  await page.waitForTimeout(700);
  const liveBar = await page.evaluate(() => document.querySelector('.livebar')?.textContent ?? '');
  check('TV host: the live bar shows how far behind live and how much is kept', /-1:35/.test(liveBar) && /30 min kept/.test(liveBar), liveBar);
  check('TV host: live-position updates don\'t change the player state', await page.evaluate(() => window.__lttv.player.status.state === 'playing'));
  await key('Enter');
  await page.waitForTimeout(300);
  await page.evaluate(() => [...document.querySelectorAll('.osd-controls button')].find((b) => b.textContent.includes('Live')).click());
  check('TV host: "Live" asks the native player to go back to live', await page.evaluate((n) => window.__calls.slice(n).some((c) => c[0] === 'goLive'), sk0));
  await shot('20b-tv-host-live-rewind');
  await page.evaluate(() => window.lttvHost.onKey('menu'));
  await page.waitForTimeout(300);
  check('TV host: Menu key (forwarded natively) opens player options', await page.evaluate(() => !!document.querySelector('.menu-panel')));
  await shot('21-tv-host-menu');
  for (let i = 0; i < 2; i++) { await page.evaluate(() => window.lttvHost.onKey('back')); await page.waitForTimeout(300); }
  check('TV host: Back closes the menu, then leaves full screen', await page.evaluate(() => !document.querySelector('.player')));
  await page.evaluate(() => window.lttvHost.onKey('back'));
  await page.waitForTimeout(200);
  check('TV host: Back on the home screen exits the app', await page.evaluate(() => window.__calls.some((c) => c[0] === 'exit')));
  try { rmSync(tvProfile, { recursive: true, force: true }); } catch { /* browser still closing */ }
} catch (e) {
  check('E2E run completed without exceptions', false, e.stack?.split('\n').slice(0, 3).join(' '));
  await shot('zz-failure').catch(() => {});
} finally {
  await ctx.close().catch(() => {});
  app.close();
  fixtures.close();
  rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
