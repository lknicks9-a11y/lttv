import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServer, parseXtreamUrl, xtreamUrls, parseAccount, chooseOutput } from '../src/core/xtream';

test('server addresses are normalized from whatever the provider sent', () => {
  assert.equal(normalizeServer('line.example.com:8080'), 'http://line.example.com:8080');
  assert.equal(normalizeServer(' http://line.example.com:8080/ '), 'http://line.example.com:8080');
  assert.equal(normalizeServer('https://x.example/get.php?username=a&password=b'), 'https://x.example');
  assert.equal(normalizeServer('http://x.example/sub/player_api.php'), 'http://x.example/sub');
  assert.throws(() => normalizeServer(''), /server address/);
});

test('builds playlist, guide and account URLs with encoded credentials', () => {
  const u = xtreamUrls({ server: 'line.example.com:8080', username: 'me', password: 'p&ss word', output: 'ts' });
  assert.equal(u.playlist, 'http://line.example.com:8080/get.php?username=me&password=p%26ss%20word&type=m3u_plus&output=ts');
  assert.equal(u.epg, 'http://line.example.com:8080/xmltv.php?username=me&password=p%26ss%20word');
  assert.equal(u.account, 'http://line.example.com:8080/player_api.php?username=me&password=p%26ss%20word');
});

test('extracts a login from a pasted playlist link', () => {
  assert.deepEqual(parseXtreamUrl('http://h.example:80/get.php?username=u1&password=p1&type=m3u_plus&output=ts'), { server: 'http://h.example', username: 'u1', password: 'p1', output: 'ts' });
  assert.equal(parseXtreamUrl('http://h.example/list.m3u'), null);
});

test('account status: success, wrong password, expired, banned', () => {
  const future = Math.floor(Date.now() / 1000) + 86400 * 30;
  const ok = parseAccount({ user_info: { auth: 1, status: 'Active', exp_date: String(future), max_connections: '2', active_cons: '0', allowed_output_formats: ['m3u8', 'ts'] } });
  assert.equal(ok.ok, true);
  assert.equal(ok.maxConnections, 2);
  assert.equal(ok.expires, future * 1000);
  assert.match(parseAccount({ user_info: { auth: 0 } }).message!, /username or password/);
  assert.match(parseAccount({ user_info: { auth: 1, status: 'Active', exp_date: '1000' } }).message!, /expired/);
  assert.match(parseAccount({ user_info: { auth: 1, status: 'Banned' } }).message!, /banned/);
  assert.match(parseAccount({ hello: 1 }).message!, /IPTV provider/);
});

test('output format follows what the account allows', () => {
  assert.equal(chooseOutput('m3u8', ['ts']), 'ts');
  assert.equal(chooseOutput('ts', ['m3u8', 'ts']), 'ts');
  assert.equal(chooseOutput('m3u8', undefined), 'm3u8');
});

import { xtreamToM3U, xtreamStreamUrl } from '../src/core/xtream';
import { parseM3U } from '../src/core/m3u';

test('app-API channel list becomes a playlist with groups, logos, numbers and guide ids', () => {
  const login = { server: 'http://line.example.com:8080', username: 'me', password: 'pw', output: 'ts' as const };
  const text = xtreamToM3U(login, [{ category_id: '1', category_name: 'USA | Sports' }], [
    { num: 5, name: 'ESPN "HD"', stream_type: 'live', stream_id: 123, stream_icon: 'http://logo/espn.png', epg_channel_id: 'espn.us', category_id: '1' },
    { num: 6, name: 'Some Movie', stream_type: 'movie', stream_id: 9 },
  ]);
  const r = parseM3U(text, { playlistId: 'p' });
  assert.equal(r.channels.length, 1);
  const c = r.channels[0];
  assert.equal(c.url, 'http://line.example.com:8080/live/me/pw/123.ts');
  assert.equal(c.groupTitle, 'USA | Sports');
  assert.equal(c.tvgId, 'espn.us');
  assert.equal(c.tvgChno, 5);
  assert.equal(c.tvgLogo, 'http://logo/espn.png');
  assert.equal(c.originalName, "ESPN 'HD'");
  assert.deepEqual(r.epgUrls, ['http://line.example.com:8080/xmltv.php?username=me&password=pw']);
  assert.equal(xtreamStreamUrl({ ...login, output: 'm3u8' }, 7), 'http://line.example.com:8080/live/me/pw/7.m3u8');
});
