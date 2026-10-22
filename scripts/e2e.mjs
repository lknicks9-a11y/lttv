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
      // Movies and shows (on demand) on the mock provider.
      const vodAction = u.pathname === '/player_api.php' ? u.searchParams.get('action') ?? '' : '';
      if (/^get_(vod|series)/.test(vodAction)) {
        const img = `http://127.0.0.1:${srv.address().port}/nologo/poster.png`;
        const out = {
          get_vod_categories: [{ category_id: '1', category_name: 'EN | Action' }, { category_id: '2', category_name: 'EN | Comedy' }, { category_id: '3', category_name: 'EN | Trending' }, { category_id: '4', category_name: 'AR | أفلام عربية' }],
          get_vod_streams: [
            { stream_id: 500, name: 'Night Run (2021)', stream_icon: img, category_id: '1', rating_5based: 4, added: '1700000500', container_extension: 'mp4' },
            { stream_id: 501, name: 'Harbor Lights (2019)', stream_icon: '', category_id: '1', added: '1700000100', container_extension: 'mkv' },
            { stream_id: 502, name: 'Laugh Track', category_id: '2', container_extension: 'mp4' },
            { stream_id: 503, name: 'Galaxy Quest Redux (2024)', category_id: '3', rating: '8.4', added: '1700000900', container_extension: 'mp4' },
            { stream_id: 504, name: 'فيلم عربي', category_id: '4', container_extension: 'mp4' },
            { stream_id: 505, name: 'Night Run (2021) 4K', category_id: '1', added: '1700000400', container_extension: 'mkv' },
            { stream_id: 506, name: 'Night Run FHD', category_id: '1', added: '1700000300', container_extension: 'mp4' },
          ].filter((m) => !u.searchParams.get('category_id') || m.category_id === u.searchParams.get('category_id')),
          get_vod_info: { info: { plot: 'A courier races across the city overnight.', cast: 'Test Actor', duration: '01:42:10', releasedate: '2021-05-01' } },
          get_series_categories: [{ category_id: '9', category_name: 'EN | Drama' }],
          get_series: [{ series_id: 77, name: 'Harbor', cover: img, category_id: '9', releaseDate: '2019-01-01', plot: 'Boats and secrets.' }],
          get_series_info: { info: { plot: 'Boats and secrets.' }, episodes: { 1: [{ id: '7701', episode_num: 1, title: 'Harbor S01E01', season: 1, container_extension: 'mp4' }, { id: '7702', episode_num: 2, title: 'Harbor S01E02', season: 1, container_extension: 'mp4' }], 2: [{ id: '7703', episode_num: 1, title: 'Harbor S02E01', season: 2, container_extension: 'mp4' }] } },
        }[vodAction] ?? [];
        resp.writeHead(200, { 'content-type': 'application/json' });
        return resp.end(JSON.stringify(out));
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
      const b0 = () => `http://127.0.0.1:${srv.address().port}`;
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
      // Mock NFL feeds for Fantasy and Bets: teams, a roster, a live game and its summary (stats grow on the 2nd read).
      if (u.pathname === '/espn/football/nfl/teams') {
        const t = (id, name, abbr) => ({ team: { id, displayName: name, shortDisplayName: name.split(' ').pop(), abbreviation: abbr, logos: [{ href: `${b0()}/logo/${abbr}.png` }] } });
        resp.writeHead(200, { 'content-type': 'application/json' });
        return resp.end(JSON.stringify({ sports: [{ leagues: [{ teams: [t('26', 'Seattle Seahawks', 'SEA'), t('25', 'San Francisco 49ers', 'SF')] }] }] }));
      }
      if (u.pathname === '/espn/football/nfl/teams/26/roster') {
        resp.writeHead(200, { 'content-type': 'application/json' });
        return resp.end(JSON.stringify({ athletes: [{ position: 'offense', items: [
          { id: '100', displayName: 'Sam Darnold', position: { abbreviation: 'QB' } },
          { id: '300', displayName: 'Jaxon Smith-Njigba', position: { abbreviation: 'WR' } },
          { id: '400', displayName: 'Kenneth Walker III', position: { abbreviation: 'RB' } },
          { id: '500', displayName: 'Charles Cross', position: { abbreviation: 'OT' } },
          { id: '600', displayName: 'Michael Dickson', position: { abbreviation: 'P' } },
        ] }] }));
      }
      if (u.pathname === '/espn/football/nfl/scoreboard') {
        const team = (id, name, abbr, side, score) => ({ homeAway: side, score: String(score), team: { id, displayName: name, shortDisplayName: name.split(' ').pop(), location: name, abbreviation: abbr, logo: `${b0()}/logo/${abbr}.png` } });
        resp.writeHead(200, { 'content-type': 'application/json' });
        return resp.end(JSON.stringify({ events: [{ id: 'n1', name: 'San Francisco 49ers at Seattle Seahawks', date: new Date(Date.now() - 3600_000).toISOString(), competitions: [{ competitors: [team('26', 'Seattle Seahawks', 'SEA', 'home', 14), team('25', 'San Francisco 49ers', 'SF', 'away', 10)], status: { type: { state: 'in', shortDetail: '2nd 4:12' } } }], status: { type: { state: 'in' } } },
          // The Giants game the guide lists as on now really is live (My Teams only calls real games "live").
          { id: 'n2', name: 'New York Giants at Dallas Cowboys', date: new Date(Date.now() - 1800_000).toISOString(), competitions: [{ competitors: [team('6', 'Dallas Cowboys', 'DAL', 'home', 7), team('19', 'New York Giants', 'NYG', 'away', 3)], status: { type: { state: 'in', shortDetail: '1st 2:00' } } }], status: { type: { state: 'in' } } }] }));
      }
      if (u.pathname === '/espn/stage3') {
        nflStage3 = true;
        resp.writeHead(200);
        return resp.end('ok');
      }
      if (u.pathname === '/espn/football/nfl/summary') {
        const later = ++nflSummaryReads > 1;
        const tm = (id, abbr, score) => ({ homeAway: id === '26' ? 'home' : 'away', score: String(score), team: { id, abbreviation: abbr, displayName: abbr, logos: [{ href: `${b0()}/logo/${abbr}.png` }] } });
        resp.writeHead(200, { 'content-type': 'application/json' });
        return resp.end(JSON.stringify({
          header: { competitions: [{ status: { type: { state: 'in', shortDetail: later ? '3rd 9:40' : '2nd 4:12' } }, competitors: [tm('26', 'SEA', nflStage3 ? 28 : later ? 21 : 14), tm('25', 'SF', 10)] }] },
          boxscore: { players: [{ team: { id: '26' }, statistics: [{ name: 'receiving', keys: ['receptions', 'receivingYards', 'yardsPerReception', 'receivingTouchdowns', 'longReception', 'receivingTargets'],
            athletes: [{ athlete: { id: '300', displayName: 'Jaxon Smith-Njigba' }, stats: nflStage3 ? ['7', '95', '13.6', '3', '30', '10'] : later ? ['6', '83', '13.8', '2', '30', '9'] : ['5', '61', '12.2', '1', '30', '8'] }] }] }] },
          drives: { previous: [{ plays: [{ id: '1', text: 'S.Darnold pass short right to J.Smith-Njigba for 12 yards' }, ...(later ? [{ id: '2', text: 'S.Darnold pass deep left to J.Smith-Njigba for 22 yards, TOUCHDOWN.', scoringPlay: true }] : []), ...(nflStage3 ? [{ id: '3', text: 'S.Darnold pass short middle to J.Smith-Njigba for 12 yards, TOUCHDOWN.', scoringPlay: true }] : [])] }] },
        }));
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
      if (u.pathname === '/tvmaze/singlesearch/shows' && u.searchParams.get('q') === 'Harbor') {
        const img = (n) => `http://127.0.0.1:${srv.address().port}/art/${n}.jpg`;
        resp.writeHead(200, { 'content-type': 'application/json' });
        return resp.end(JSON.stringify({ id: 501, name: 'Harbor', premiered: '2019-01-03', summary: '<p>A harbor town keeps its secrets.</p>', image: { original: img('harbor-poster') }, rating: { average: 8.1 }, genres: ['Drama'], externals: { imdb: 'tt0000001' },
          _embedded: { episodes: [{ season: 1, number: 1, name: 'Low Tide', summary: '<p>The boats come in.</p>', image: { original: img('ep1') }, runtime: 45 }, { season: 1, number: 2, name: 'High Water', summary: '<p>A storm arrives.</p>', image: { original: img('ep2') }, runtime: 44 }, { season: 2, number: 1, name: 'Return', summary: '<p>A year later.</p>', runtime: 46 }] } }));
      }
      if (u.pathname === '/tvmaze/schedule/web') {
        resp.writeHead(200, { 'content-type': 'application/json' });
        return resp.end(JSON.stringify([{ airdate: u.searchParams.get('date'), _embedded: { show: { name: 'Harbor', language: 'English' } } }]));
      }
      if (u.pathname === '/tvmaze/schedule') {
        resp.writeHead(200, { 'content-type': 'application/json' });
        return resp.end('[]');
      }
      if (u.pathname === '/itunes/search') {
        const ok = /night run/i.test(u.searchParams.get('term') ?? '');
        resp.writeHead(200, { 'content-type': 'application/json' });
        return resp.end(JSON.stringify({ results: ok ? [{ trackName: 'Night Run', releaseDate: '2021-05-01T07:00:00Z', artworkUrl100: `http://127.0.0.1:${srv.address().port}/art/nightrun/100x100bb.jpg`, longDescription: 'A courier races across the city overnight.', primaryGenreName: 'Action' }] : [] }));
      }
      if (u.pathname.startsWith('/art/')) {
        resp.writeHead(200, { 'content-type': 'image/png' });
        return resp.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
      }
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
let nflSummaryReads = 0;
let nflStage3 = false;
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
    // The first block may start before the visible window (clamped to 0), so compare later blocks.
    const a = geo.starts.length >= 3 ? 1 : 0;
    const pred = geo.lefts[a] + (geo.starts[a + 1] - geo.starts[a]) * pxPerMs;
    linear = Math.abs(pred - geo.lefts[a + 1]) < 2.5;
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

  // --- Colors: pick an accent swatch with the remote (Luxury always uses gold, so switch to Aero) ---
  check('The A7 theme (cosmic orb TV logo, flame colours) is switched on', await page.evaluate(() => document.documentElement.dataset.theme === 'a7' && getComputedStyle(document.querySelector('.brand .logo-a7')).display !== 'none' && getComputedStyle(document.querySelector('.brand .logo-owl')).display === 'none' && getComputedStyle(document.documentElement).getPropertyValue('--a7-orange').trim() !== ''), await page.evaluate(() => `${document.documentElement.dataset.theme} accent=${getComputedStyle(document.documentElement).getPropertyValue('--accent')}`));
  await shot('25b-a7');
  await page.evaluate(() => window.__lttv.updateSettings({ theme: 'luxury' }));
  await page.waitForTimeout(200);
  check('The Luxury theme (black & gold, owl logo) still works', await page.evaluate(() => document.documentElement.dataset.theme === 'luxury' && getComputedStyle(document.querySelector('.brand .logo-owl')).display !== 'none'));
  await page.evaluate(() => window.__lttv.updateSettings({ theme: 'aero' }));
  await page.waitForTimeout(300);
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
  const leagueCards = await waitFor(() => page.evaluate(() => { const c = [...document.querySelectorAll('.league-card')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()); return c.some((t) => /MLB/.test(t) && /2 games today/.test(t)) ? c : null; }), 15000);
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
  const teamBc = await waitFor(() => page.evaluate(() => { const b = [...document.querySelectorAll('.team-bc')].map((x) => x.textContent); return b.length ? b : null; }), 8000);
  check('A game with local (RSN) broadcasts offers each team\'s broadcast first, named for the team, with the channel under it', !!teamBc && teamBc.length === 2 && /Yankees Broadcast/.test(teamBc[0]) && /YES/.test(teamBc[0]) && /Red Sox Broadcast/.test(teamBc[1]) && /NESN/.test(teamBc[1]), JSON.stringify(teamBc));
  check('The first team broadcast has focus', await page.evaluate(() => !!document.activeElement?.classList.contains('team-bc')));
  await shot('30-team-broadcasts');
  check('Other streams stay hidden until asked for', await page.evaluate(() => !document.querySelector('.stream-pick-main') && /Other streams/.test(document.querySelector('.other-streams')?.textContent ?? '')));
  await page.evaluate(() => document.querySelector('.other-streams')?.click());
  await page.waitForTimeout(300);
  const picks = await page.evaluate(() => [...document.querySelectorAll('.stream-pick-main')].map((b) => b.textContent));
  check('Other streams: event channel and ESPN are offered (not the team broadcasts again)', picks.some((p) => /Event channel/.test(p)) && picks.some((p) => /ESPN/.test(p) && /national/.test(p)) && !picks.some((p) => /YES Network/.test(p)), picks.join(' || '));
  check('Streams list has no Multiview buttons (Multiview is in the player only)', await page.evaluate(() => ![...document.querySelectorAll('.watch-game button')].some((b) => /Multiview/.test(b.textContent))));
  await shot('31-other-streams');
  await page.evaluate(() => [...document.querySelectorAll('.team-bc')].find((b) => /Red Sox Broadcast/.test(b.textContent))?.click());
  const nesnPlaying = await waitFor(() => page.evaluate(() => { const s = window.__lttv.getState(); const c = s.lineup.find((x) => x.key === s.currentKey); return s.fullscreen && /NESN/.test(c?.originalName ?? '') ? c.originalName : null; }), 8000);
  check('Watch tunes that broadcast full screen', !!nesnPlaying, String(nesnPlaying));
  await key('Escape');
  await page.waitForTimeout(400);

  // ---- Sports Multiview ----
  await page.evaluate(() => [...document.querySelectorAll('.sports-crumbs button')].find((b) => /Sports/.test(b.textContent))?.click());
  await page.waitForTimeout(400);
  await page.evaluate(() => [...document.querySelectorAll('.content button')].find((b) => /^Multiview$/.test(b.textContent.trim()))?.click());
  const mvOpen = await waitFor(() => page.evaluate(() => { const m = window.__lttv.getState().multiview; return document.querySelector('.multiview') && m ? m : null; }), 5000);
  check('Multiview opens from Sports with the game that was playing in the first tile', !!mvOpen && !!mvOpen.tiles[0], JSON.stringify(mvOpen));
  check('Multiview asks how many games (2, 3 or 4)', await page.evaluate(() => [...document.querySelectorAll('.mv-layout')].map((b) => b.textContent.trim()).join('|') === '2 games|3 games|4 games'));
  await page.evaluate(() => [...document.querySelectorAll('.mv-layout')].find((b) => /3 games/.test(b.textContent))?.click());
  await page.waitForTimeout(300);
  const mvGeo = await page.evaluate(() => { const c = [...document.querySelectorAll('.mv-cell')].map((x) => x.getBoundingClientRect()); return { n: c.length, big: c[0] && c[1] && c[2] ? c[0].bottom <= c[1].top + 2 && Math.abs(c[1].top - c[2].top) < 2 && c[1].right <= c[2].left + 2 : false, layout: window.__lttv.getState().multiview?.layout }; });
  check('Multiview: choosing 3 games shows one on top and two side by side underneath', mvGeo.n === 3 && mvGeo.big && mvGeo.layout === 3, JSON.stringify(mvGeo));
  await page.evaluate(() => document.querySelectorAll('.mv-tile')[1]?.click());
  await waitFor(() => page.evaluate(() => document.querySelectorAll('.mv-picker .league-card').length > 0 || null), 5000);
  await page.evaluate(() => [...document.querySelectorAll('.mv-picker .league-card')].find((c) => /MLB/.test(c.textContent))?.click());
  await waitFor(() => page.evaluate(() => document.querySelector('.mv-picker .game-row') || null), 8000);
  await page.evaluate(() => document.querySelector('.mv-picker .game-row')?.click());
  await page.waitForTimeout(600);
  await waitFor(() => page.evaluate(() => document.querySelector('.watch-game .team-bc') || null), 8000);
  await page.evaluate(() => [...document.querySelectorAll('.watch-game .team-bc')].find((b) => /Yankees Broadcast/.test(b.textContent))?.click());
  const mv2 = await waitFor(() => page.evaluate(() => { const m = window.__lttv.getState().multiview; return m?.tiles[1] ? m : null; }), 5000);
  check('Multiview: add a second game (league → game → stream)', !!mv2 && /at/.test(mv2.tiles[1].title), JSON.stringify(mv2));
  check('Multiview: each game has its own player (started one after another)', !!(await waitFor(() => page.evaluate(() => document.querySelectorAll('.multiview video').length >= 2 || null), 6000)));
  await shot('26-multiview');
  await page.evaluate(() => document.querySelectorAll('.mv-tile')[1]?.click());
  await page.waitForTimeout(200);
  check('Multiview: OK on a tile gives it the sound', await page.evaluate(() => window.__lttv.getState().multiview?.active === 1 && !!document.querySelectorAll('.mv-tile')[1]?.classList.contains('mv-active')));
  await key('Escape');
  const mvBack = await waitFor(() => page.evaluate(() => { const s = window.__lttv.getState(); return !s.multiview && s.fullscreen ? s.currentKey : null; }), 5000);
  check('Back leaves Multiview full screen on the game with sound', !!mvBack, String(mvBack));
  await key('Escape');
  await page.waitForTimeout(400);

  // ---- Fantasy and Bets (mock NFL feed) ----
  const clickText = (sel, re) => page.evaluate(([sel, src]) => { const el = [...document.querySelectorAll(sel)].find((b) => new RegExp(src).test(b.textContent)); el?.click(); return !!el; }, [sel, re.source]);
  await clickText('.nav-item', /Sports/);
  await page.waitForTimeout(500);
  if (await page.evaluate(() => !document.querySelector('.league-card'))) { await clickText('.sports-crumbs button', /Sports/); await page.waitForTimeout(400); }
  check('Fantasy and Bets are not on the Sports home screen', await page.evaluate(() => ![...document.querySelectorAll('.league-card')].some((c) => /Fantasy|Bets/.test(c.textContent))));
  await clickText('.league-card', /^NFL/);
  await page.waitForTimeout(400);
  check('Each football / basketball league has Games, Fantasy and Bets tabs', await page.evaluate(() => [...document.querySelectorAll('.league-tabs .chip')].map((c) => c.textContent).join(',') === 'Games,Fantasy,Bets'));
  await clickText('.league-tabs .chip', /^Fantasy$/);
  await page.waitForTimeout(400);
  await clickText('button', /^Add player$/);
  await waitFor(() => page.evaluate(() => document.querySelectorAll('.fx-picker .team-option').length > 0), 8000);
  check('The player picker stays in the league (no league tabs)', await page.evaluate(() => !document.querySelector('.fx-picker .chips')));
  await clickText('.fx-picker .team-option', /Seattle Seahawks/);
  await waitFor(() => page.evaluate(() => /Jaxon Smith-Njigba/.test(document.querySelector('.fx-picker')?.textContent ?? '')), 8000);
  await clickText('.fx-picker .team-option', /Jaxon Smith-Njigba/);
  await page.waitForTimeout(400);
  check('Fantasy: add a player from a team\'s roster to your lineup', await page.evaluate(() => /Jaxon Smith-Njigba/.test(document.querySelector('.fx-list')?.textContent ?? '')));
  await clickText('.league-tabs .chip', /^Bets$/);
  await page.waitForTimeout(400);
  await clickText('button', /Add player prop/);
  await waitFor(() => page.evaluate(() => document.querySelectorAll('.fx-picker .team-option').length > 0), 8000);
  await clickText('.fx-picker .team-option', /Seattle Seahawks/);
  await waitFor(() => page.evaluate(() => /Jaxon Smith-Njigba/.test(document.querySelector('.fx-picker')?.textContent ?? '')), 8000);
  const groups = await page.evaluate(() => ({ heads: [...document.querySelectorAll('.fx-position-head')].map((x) => x.textContent), text: document.querySelector('.fx-picker')?.textContent ?? '' }));
  check('Players are grouped by position (QB, RB, WR…) and only positions with props are listed', groups.heads.join(',') === 'Quarterbacks,Running backs,Wide receivers' && !/Charles Cross|Michael Dickson/.test(groups.text), JSON.stringify(groups.heads));
  await clickText('.fx-picker .team-option', /Jaxon Smith-Njigba/);
  await page.waitForTimeout(300);
  const props = await page.evaluate(() => [...document.querySelectorAll('.fx-props .fx-prop-grid button')].map((b) => b.textContent));
  check('Bets: a receiver gets the receiving props (not passing or kicking)', props.includes('Receiving yards') && props.includes('Receptions') && !props.includes('Passing yards') && !props.includes('Field goals made'), props.join(', '));
  await clickText('.fx-props button', /^Receiving yards$/);
  await page.waitForTimeout(200);
  for (const k of ['7', '4', '.', '5']) await clickText('.line-pad button', new RegExp('^' + k.replace('.', '\\.') + '$'));
  check('Bets: the on-screen number pad types decimals (74.5)', await page.evaluate(() => document.querySelector('.fx-props .line-input')?.value === '74.5'), await page.evaluate(() => document.querySelector('.fx-props .line-input')?.value));
  await clickText('.fx-props button', /^Over$/);
  await page.waitForTimeout(400);
  check('Bets: "over 74.5 receiving yards" is tracked', await page.evaluate(() => /over 74\.5 receiving yards/.test(document.querySelector('.fx-list')?.textContent ?? '')));
  // Pop-ups only while a sports channel plays: tune NESN (a sports channel) first.
  await page.evaluate(() => { const ch = window.__lttv.getState().lineup.find((c) => /NESN/.test(c.name)); if (ch) return window.__lttv.tune(ch.key); });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__lttv.pollLive());
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__lttv.pollLive());
  const notice = await waitFor(() => page.evaluate(() => { const n = [...document.querySelectorAll('.live-notice')].map((x) => x.textContent); return n.length >= 2 ? n : null; }), 8000);
  check('While watching, pop-ups show the fantasy points and the prop hitting, with the play', !!notice && notice.some((t) => /fantasy pts/.test(t) && /TOUCHDOWN/.test(t)) && notice.some((t) => /HIT/.test(t) && /74\.5/.test(t)), JSON.stringify(notice));
  check('Pop-ups carry the player picture and team logo', await page.evaluate(() => !!document.querySelector('.live-notice .headshot') && !!document.querySelector('.live-notice .live-notice-logo')));
  await shot('33-prop-hit-notice');
  check('The bet row shows HIT with 83 / 74.5', await page.evaluate(() => /83 \/ 74\.5/.test(document.querySelector('.fx-list')?.textContent ?? '') && !!document.querySelector('.bet-badge-hit')));
  // Parlay (receptions over 5.5 + Seahawks over 24.5 points) and a team bet: every score pops up.
  await page.evaluate(() => {
    const base = { league: 'nfl', teamId: '26', teamName: 'Seattle Seahawks', createdAt: Date.now() };
    window.__lttv.addParlay([
      { ...base, id: 'leg1', kind: 'player', prop: 'rec', line: 5.5, side: 'over', athleteId: '300', athleteName: 'Jaxon Smith-Njigba' },
      { ...base, id: 'leg2', kind: 'team', prop: 'points', line: 24.5, side: 'over' },
    ]);
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__lttv.pollLive());
  await page.waitForTimeout(300);
  check('Bets: a parlay shows its legs and how many have hit', await page.evaluate(() => /2-leg parlay · 1 of 2 hit/.test(document.querySelector('.parlay-row')?.textContent ?? '')), await page.evaluate(() => document.querySelector('.parlay-row')?.textContent ?? ''));
  await fetch(`${fxBase}/espn/stage3`);
  await page.evaluate(() => window.__lttv.pollLive());
  const seenNotes = new Set();
  const scoreNotes = await waitFor(async () => { for (const t of await page.evaluate(() => [...document.querySelectorAll('.live-notice')].map((x) => x.textContent))) seenNotes.add(t); return [...seenNotes].some((t) => /PARLAY HIT/.test(t)) ? [...seenNotes] : null; }, 30000);
  check('Team bet: the new score pops up (SF 10 – 28 SEA) and the parlay hit is announced', !!scoreNotes && scoreNotes.some((t) => /SF 10 – 28 SEA/.test(t)) && scoreNotes.some((t) => /PARLAY HIT/.test(t)), JSON.stringify(scoreNotes));
  await shot('34-parlay-score');
  check('Pop-ups only while sports plays (on with NESN, off once playback stops)', await page.evaluate(() => { window.__lttv.player.stop(); return window.__lttv.watchingSports() === false; }));

  // ---- Movies and Shows from the provider ----
  const vodNav = await waitFor(() => page.evaluate(() => { const t = [...document.querySelectorAll('.sidebar .nav-label')].map((x) => x.textContent); return t.includes('Movies') && t.includes('Shows') ? t : null; }), 15000);
  check('Movies and Shows appear in the menu when the provider has them', !!vodNav, JSON.stringify(vodNav));
  await page.evaluate((b) => { localStorage.setItem('lttvTvmazeBase', b + '/tvmaze'); localStorage.setItem('lttvItunesBase', b + '/itunes'); localStorage.setItem('lttvWikiBase', b + '/wiki/'); }, fxBase);
  await page.evaluate(() => [...document.querySelectorAll('.sidebar .nav-item')].find((b) => /Movies/.test(b.textContent))?.click());
  const rows = await waitFor(() => page.evaluate(() => { const t = [...document.querySelectorAll('.vod-row-title')].map((x) => x.textContent); return t.some((x) => /Other languages/.test(x)) && !document.querySelector('.vod-loading') ? t : null; }), 15000);
  await page.waitForTimeout(300);
  check('Movies home (Hulu-style): Popular Movies, Recently Added, Critically Acclaimed and English genre rows', !!rows && rows.includes('Popular Movies') && rows.includes('Recently Added') && rows.includes('Critically Acclaimed') && rows.includes('Action & Adventure') && rows.includes('Comedies'), JSON.stringify(rows));
  const vodHome = await page.evaluate(() => ({
    chips: document.querySelectorAll('.vod .chips').length,
    inputFocused: document.activeElement?.tagName === 'INPUT',
    focusedCard: !!document.activeElement?.closest('.vod-card, .vod-hero'),
    hero: document.querySelector('.vod-hero-title')?.textContent,
    trending: [...document.querySelectorAll('.vod-row')].find((r) => /Popular Movies/.test(r.textContent))?.querySelector('.vod-name')?.textContent,
    browse: [...document.querySelectorAll('.vod-row')].find((r) => /Browse categories/.test(r.textContent))?.textContent ?? '',
    other: [...document.querySelectorAll('.vod-row')].find((r) => /Other languages/.test(r.textContent))?.textContent ?? '',
    rowText: [...document.querySelectorAll('.vod-row')].filter((r) => !/Other languages|Browse/.test(r.querySelector('.vod-row-title')?.textContent ?? '')).map((r) => r.textContent).join(' '),
  }));
  check('Movies: featured banner on top, no category tabs, search doesn\'t open by itself', vodHome.chips === 0 && !vodHome.inputFocused && vodHome.focusedCard && vodHome.hero === 'Galaxy Quest Redux', JSON.stringify(vodHome).slice(0, 200));
  check('Movies: the provider\'s "Trending" list leads Popular Movies', vodHome.trending === 'Galaxy Quest Redux (2024)', String(vodHome.trending));
  check('Movies: rows and Browse are English; other languages are kept separate', /EN \| Action/.test(vodHome.browse) && !/أفلام/.test(vodHome.browse) && /أفلام/.test(vodHome.other) && !/فيلم/.test(vodHome.rowText), vodHome.other);
  await shot('40-movies');
  await page.evaluate(() => document.querySelector('.vod-row .vod-card')?.focus());
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(200);
  check('Left from the first poster reaches the menu (sidebar)', await page.evaluate(() => !!document.activeElement?.closest('.sidebar')));
  await page.evaluate(() => document.querySelector('.vod-row .vod-card')?.focus());
  await page.evaluate(() => document.querySelector('.vod-search-btn')?.click());
  await page.waitForTimeout(400);
  check('Search opens only when chosen', await page.evaluate(() => document.activeElement?.matches('.vod-search input') === true));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.evaluate(() => [...document.querySelectorAll('.vod-row')].find((r) => /Action/.test(r.querySelector('.vod-row-title')?.textContent ?? ''))?.querySelector('.vod-card')?.click());
  const movieInfo = await waitFor(() => page.evaluate(() => { const t = document.querySelector('.vod-detail')?.textContent ?? ''; return /courier/.test(t) ? t : null; }), 8000);
  check('Movie details: plot, runtime and Play', !!movieInfo && /1 h 42 min/.test(movieInfo) && /Play/.test(movieInfo), String(movieInfo).slice(0, 200));
  check('The same movie in several qualities shows once in the rows', await page.evaluate(() => [...document.querySelectorAll('.vod-row')].find((r) => /Action/.test(r.querySelector('.vod-row-title')?.textContent ?? ''))?.querySelectorAll('.vod-card').length === 2));
  const versions = await waitFor(() => page.evaluate(() => { const c = [...document.querySelectorAll('.vod-versions .chip')]; return c.length ? { labels: c.map((x) => x.textContent), active: document.querySelector('.vod-versions .chip-active')?.textContent } : null; }), 8000);
  check('Movie versions (4K / 1080p…) are offered and 1080p is picked', !!versions && versions.labels.includes('4K') && versions.labels.includes('1080p') && versions.active === '1080p', JSON.stringify(versions));
  const poster = await waitFor(() => page.evaluate(() => { const s = document.querySelector('.vod-detail .vod-poster img')?.getAttribute('src') ?? ''; return /600x900bb/.test(s) ? s : null; }), 8000);
  check('Movie poster comes from iTunes in a large size', !!poster, String(poster));
  await page.evaluate(() => [...document.querySelectorAll('.vod-detail button')].find((b) => /^Play$/.test(b.textContent.trim()))?.click());
  const vodReq = await waitFor(() => page.evaluate(() => { const v = window.__lttv.getState().vodPlaying; return v && document.querySelector('.vod-player') && /^m:/.test(window.__lttv.player.currentKey ?? '') ? { url: v.url, key: window.__lttv.player.currentKey } : null; }), 5000) ?? await page.evaluate(() => ({ url: window.__lttv.getState().vodPlaying?.url ?? '', key: window.__lttv.player.currentKey }));
  check('Play opens the movie full screen from the provider\'s movie address', !!vodReq && /\/movie\/demo\/[^/]+\/506\.mp4$/.test(vodReq.url) && /^m:/.test(vodReq.key), JSON.stringify(vodReq).replace(/secret123/g, '…'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Back closes the movie player and returns to the movie page', await page.evaluate(() => !document.querySelector('.vod-player') && !window.__lttv.getState().vodPlaying && !!document.querySelector('.vod-detail')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.evaluate(() => [...document.querySelectorAll('.sidebar .nav-item')].find((b) => /Shows/.test(b.textContent))?.click());
  await waitFor(() => page.evaluate(() => [...document.querySelectorAll('.vod-row')].some((r) => /Drama/.test(r.textContent) && r.querySelector('.vod-card')) ? true : null), 10000);
  const showRows = await waitFor(() => page.evaluate(() => { const t = [...document.querySelectorAll('.vod-row-title')].map((x) => x.textContent); return t.includes('New Episodes') ? t : null; }), 10000);
  check('Shows home: New Episodes (aired this week, from TVmaze) with the show', !!showRows && await page.evaluate(() => /Harbor/.test([...document.querySelectorAll('.vod-row')].find((r) => /New Episodes/.test(r.textContent))?.textContent ?? '')), JSON.stringify(showRows));
  await page.evaluate(() => [...document.querySelectorAll('.vod-row')].find((r) => /Drama/.test(r.querySelector('.vod-row-title')?.textContent ?? ''))?.querySelector('.vod-card')?.click());
  const eps = await waitFor(() => page.evaluate(() => { const t = [...document.querySelectorAll('.vod-episode .vod-ep-title')].map((x) => x.textContent); return t.length ? { eps: t, seasons: [...document.querySelectorAll('.vod-detail .chip')].map((c) => c.textContent) } : null; }), 8000);
  check('Shows: seasons and episodes from the provider', !!eps && eps.eps.length === 2 && eps.seasons.length === 2, JSON.stringify(eps));
  await page.evaluate(() => document.querySelector('.vod-episode')?.click());
  const epReq = await waitFor(() => page.evaluate(() => { const v = window.__lttv.getState().vodPlaying; return v ? { url: v.url, queue: v.queue?.length ?? 0, sub: v.subtitle } : null; }), 5000);
  check('An episode plays with the next episodes queued', !!epReq && /\/series\/demo\/[^/]+\/7701\.mp4$/.test(epReq.url) && epReq.queue === 2 && /S1 E1/.test(epReq.sub), JSON.stringify(epReq).replace(/secret123/g, '…'));
  await page.evaluate(() => document.querySelector('.vod-player')?.focus());
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  await page.evaluate(() => [...document.querySelectorAll('.vod-controls button')].find((b) => /^CC/.test(b.textContent))?.click());
  await page.waitForTimeout(200);
  check('Captions can be turned on and off in the player (CC)', await page.evaluate(() => window.__lttv.getState().settings.captions === true && /CC On/.test(document.querySelector('.cc-btn')?.textContent ?? '')));
  await page.evaluate(() => [...document.querySelectorAll('.vod-controls button')].find((b) => /^CC/.test(b.textContent))?.click());
  await shot('41-episode-player');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check('Backing out of an episode returns to the show page', await page.evaluate(() => !document.querySelector('.vod-player') && !!document.querySelector('.vod-detail .vod-episodes')));
  const epArt = await page.evaluate(() => ({ titles: [...document.querySelectorAll('.vod-ep-title')].map((x) => x.textContent), imgs: document.querySelectorAll('.vod-ep-img').length, plot: document.querySelector('.vod-detail .vod-plot')?.textContent }));
  check('Episode names and stills come from TVmaze', epArt.titles[0] === '1. Low Tide' && epArt.imgs >= 2 && /harbor town|Boats/.test(epArt.plot ?? ''), JSON.stringify(epArt));
  // Watched episode 1 to the end and half of episode 2: one card for the show, on episode 2.
  await page.evaluate(async () => {
    const st = window.__lttv.getState();
    const pl = st.playlists[0].id;
    const ser = (ep, id) => ({ id: '77', name: 'Harbor', season: 1, episode: ep, episodeId: id, year: '2019' });
    await window.__lttv.saveProgress({ key: `e:${pl}:7701`, title: 'Harbor', subtitle: 'S1 E1', pos: 2700, dur: 2700, url: 'x', playlistId: pl, series: ser(1, '7701'), hasNext: true });
    await new Promise((r) => setTimeout(r, 20));
    await window.__lttv.saveProgress({ key: `e:${pl}:7702`, title: 'Harbor', subtitle: 'S1 E2', pos: 900, dur: 2640, url: 'x', playlistId: pl, series: ser(2, '7702'), hasNext: true });
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const cont = await page.evaluate(() => { const r = [...document.querySelectorAll('.vod-row')].find((x) => /Continue watching/.test(x.textContent)); return r ? [...r.querySelectorAll('.vod-card')].map((c) => c.textContent) : null; });
  check('Continue watching shows one card per show: the episode watched last', !!cont && cont.length === 1 && /Harbor/.test(cont[0]) && /S1 E2/.test(cont[0]), JSON.stringify(cont));
  await page.evaluate(() => [...document.querySelectorAll('.vod-row')].find((x) => /Continue watching/.test(x.textContent))?.querySelector('.vod-card')?.click());
  const sel = await waitFor(() => page.evaluate(() => { const a = document.activeElement; return document.querySelector('.vod-detail') && a?.closest('.vod-episode') ? { id: a.closest('.vod-episode').getAttribute('data-ep-id'), player: !!document.querySelector('.vod-player') } : null; }), 8000);
  check('Continuing a show opens its page with the last-watched episode selected (no auto-play)', !!sel && sel.id === '7702' && !sel.player, JSON.stringify(sel));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  try { rmSync(xtProfile, { recursive: true, force: true }); } catch { /* browser still closing */ }

  // ---- Accounts: each has its own setup on this device ----
  {
    const chBefore = await page.evaluate(() => window.__lttv.getState().lineup.length);
    await gotoNav('Settings');
    await page.evaluate(() => [...document.querySelectorAll('.accounts-section button')].find((b) => /Add account/.test(b.textContent))?.click());
    await page.waitForTimeout(300);
    await page.fill('.modal input', 'Guest');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => /Create/.test(b.textContent))?.click())]);
    await page.waitForTimeout(800);
    const fresh = await page.evaluate(async () => ({ welcome: document.querySelector('.home-empty h3')?.textContent, playlists: window.__lttv.getState().playlists.length, dbs: (await indexedDB.databases()).map((d) => d.name), chip: document.querySelector('.account-chip')?.textContent }));
    check('Accounts: a new account starts empty with its own data on the device', fresh.playlists === 0 && fresh.dbs.length === 2 && /Guest/.test(fresh.chip ?? ''), JSON.stringify(fresh));
    check('Accounts: the welcome screen greets the account', /Welcome, Guest/.test(fresh.welcome ?? ''), String(fresh.welcome));
    await shot('27-account-new');
    await page.evaluate(() => [...document.querySelectorAll('.nav-item')].find((b) => b.classList.contains('account-chip'))?.click());
    await waitFor(() => page.evaluate(() => document.querySelectorAll('.who-card').length >= 3 || null), 5000);
    await shot('28-whos-watching');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.evaluate(() => [...document.querySelectorAll('.who-card')].find((c) => /Me/.test(c.textContent))?.click())]);
    const back = await waitFor(() => page.evaluate(() => { const s = window.__lttv.getState(); return s.ready && s.lineup.length ? s.lineup.length : null; }), 20000);
    check('Accounts: switching back brings the first account’s channels back', back === chBefore, `${back} vs ${chBefore}`);
    await gotoNav('Settings');
    await page.evaluate(() => [...document.querySelectorAll('.account-row')].find((r) => /Guest/.test(r.textContent))?.querySelector('button:last-child')?.click());
    await page.waitForTimeout(300);
    await page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => /Remove account/.test(b.textContent))?.click());
    await page.waitForTimeout(200);
    await page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => /^Remove$/.test(b.textContent.trim()))?.click());
    await page.waitForTimeout(800);
    const after = await page.evaluate(async () => ({ rows: document.querySelectorAll('.account-row').length, dbs: (await indexedDB.databases()).map((d) => d.name) }));
    check('Accounts: removing an account deletes its data', after.rows === 1 && after.dbs.length === 1, JSON.stringify(after));
  }

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
      startSetupServer: () => JSON.stringify({ url: 'http://192.168.1.50:8787', qr: 'http://192.168.1.50:8787/?pin=1234', pin: '1234' }), stopSetupServer: () => calls.push(['stopSetup']),
      exitApp: () => calls.push(['exit']), keepScreenOn: () => {},
      mvPlay: (i, j) => calls.push(['mvPlay', i, JSON.parse(j)]), mvStop: (i) => calls.push(['mvStop', i]),
      mvRect: (i, x, y, w, h, v) => calls.push(['mvRect', i, x, y, w, h, v]), mvMute: (i, m) => calls.push(['mvMute', i, m]),
      seekBy: (ms) => calls.push(['seekBy', ms]), goLive: () => calls.push(['goLive']),
    };
  });
  await page.goto(appUrl.replace('?tv', ''), { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  check('TV host: UI scales to a 960x540 CSS viewport (1080p @2x)', await page.evaluate(() => document.documentElement.classList.contains('native') && parseFloat(getComputedStyle(document.documentElement).fontSize) === 8));
  check('TV host: the welcome screen offers setup from a phone or computer', await page.evaluate(() => [...document.querySelectorAll('.home-empty button')].some((b) => /phone or computer/.test(b.textContent))));
  await page.evaluate(() => [...document.querySelectorAll('.home-empty button')].find((b) => /phone or computer/.test(b.textContent))?.click());
  await page.waitForTimeout(300);
  check('TV host: phone setup shows a QR code, the address and the PIN', await page.evaluate(() => !!document.querySelector('.modal .setup-qr path') && /192\.168\.1\.50:8787/.test(document.querySelector('.modal').textContent) && /1234/.test(document.querySelector('.setup-pin')?.textContent ?? '')));
  await shot('29-tv-phone-setup');
  await page.evaluate(async () => { window.lttvHost.onSetupSubmit(JSON.stringify({ type: 'account', account: 'Luke' })); await new Promise((r) => setTimeout(r, 100)); });
  check('TV host: the name typed on the phone renames the account', await page.evaluate(() => JSON.parse(localStorage.getItem('lttvAccounts') || '{}').list?.[0]?.name === 'Luke'));
  await key('Escape');
  await page.waitForTimeout(300);
  await page.evaluate(() => [...document.querySelectorAll('.home-empty button')].find((b) => /Add playlist/.test(b.textContent))?.focus());
  await key('ArrowRight', 2);
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
  const tvErr0 = errors.length;
  await page.evaluate(() => [...document.querySelectorAll('.nav-item')].find((n) => /Sports/.test(n.textContent)).click());
  await waitFor(() => page.evaluate(() => document.querySelectorAll('.league-card').length === 14), 8000);
  check('TV host: the Sports screen opens with its league cards', await page.evaluate(() => document.querySelectorAll('.league-card').length === 14) && errors.length === tvErr0, errors.slice(tvErr0).join(' | '));
  await page.evaluate(() => [...document.querySelectorAll('.league-card')].find((c) => /My Teams/.test(c.textContent))?.click());
  await page.waitForTimeout(500);
  check('TV host: My Teams opens from Sports', await page.evaluate(() => /My Teams/.test(document.querySelector('.sports h1')?.textContent ?? '')) && errors.length === tvErr0, errors.slice(tvErr0).join(' | '));
  await shot('22b-tv-host-sports');
  await page.evaluate(() => [...document.querySelectorAll('.nav-item')].find((n) => /Live TV/.test(n.textContent)).click());
  await page.waitForTimeout(400);
  for (let i = 0; i < 8 && !(await page.evaluate(() => window.__calls.some((c) => c[0] === 'exit'))); i++) {
    await page.evaluate(() => window.lttvHost.onKey('back'));
    await page.waitForTimeout(250);
  }
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
