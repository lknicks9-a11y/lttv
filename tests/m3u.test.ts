import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseM3U, parseAttributes, splitExtinf, splitPipeHeaders } from '../src/core/m3u';

const P = { playlistId: 'p1' };

test('parses standard extended M3U with attributes', () => {
  const text = `#EXTM3U url-tvg="http://epg.example/guide.xml.gz"
#EXTINF:-1 tvg-id="demo.one" tvg-name="Demo One" tvg-logo="http://logo/1.png" group-title="Demo News",Demo One HD
http://stream.example/1.m3u8
#EXTINF:-1 tvg-id="demo.two" group-title="Demo Sports",Demo Two
http://stream.example/2.ts
`;
  const r = parseM3U(text, P);
  assert.equal(r.channels.length, 2);
  assert.equal(r.hadHeader, true);
  assert.deepEqual(r.epgUrls, ['http://epg.example/guide.xml.gz']);
  const c = r.channels[0];
  assert.equal(c.originalName, 'Demo One HD');
  assert.equal(c.tvgId, 'demo.one');
  assert.equal(c.tvgName, 'Demo One');
  assert.equal(c.tvgLogo, 'http://logo/1.png');
  assert.equal(c.groupTitle, 'Demo News');
  assert.equal(c.url, 'http://stream.example/1.m3u8');
  assert.equal(r.channels[1].tvgLogo, undefined);
});

test('handles commas inside quoted attributes and title commas', () => {
  const r = parseM3U(`#EXTM3U\n#EXTINF:-1 group-title="News, Weather" tvg-name="A, B",Channel, With Comma\nhttp://x/1\n`, P);
  assert.equal(r.channels[0].groupTitle, 'News, Weather');
  assert.equal(r.channels[0].tvgName, 'A, B');
  assert.equal(r.channels[0].originalName, 'Channel, With Comma');
});

test('single quotes, unquoted values, uppercase keys, extra spaces', () => {
  const a = parseAttributes(` TVG-ID='x.y'  tvg-logo = http://l/a.png group-title="G"`);
  assert.equal(a['tvg-id'], 'x.y');
  assert.equal(a['tvg-logo'], 'http://l/a.png');
  assert.equal(a['group-title'], 'G');
  assert.deepEqual(splitExtinf('-1 tvg-id="a",Name'), { params: '-1 tvg-id="a"', title: 'Name' });
});

test('CRLF, BOM, blank lines and missing #EXTM3U header', () => {
  const r = parseM3U('﻿#EXTINF:-1,One\r\n\r\nhttp://a/1\r\n#EXTINF:0,Two\rhttp://a/2', P);
  assert.equal(r.channels.length, 2);
  assert.equal(r.hadHeader, false);
  assert.ok(r.warnings.some((w) => /no #EXTM3U/i.test(w.message)));
});

test('malformed entries: EXTINF without URL, junk lines, bare URLs', () => {
  const r = parseM3U(`#EXTM3U
#EXTINF:-1,No URL Here
#EXTINF:-1,Good
http://a/good.m3u8
this is garbage
http://a/bare/stream_name.m3u8
#EXTINF:-1,Dangling at end
`, P);
  assert.deepEqual(r.channels.map((c) => c.originalName), ['Good', 'stream_name']);
  assert.equal(r.stats.skipped, 2);
  assert.ok(r.warnings.some((w) => /garbage/.test(w.message)));
});

test('Unicode names and URL-encoded values', () => {
  const r = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Caf%C3%A9%20TV" group-title="Fran%C3%A7ais",Télé Québec ★ ᴴᴰ
http://a/1
#EXTINF:-1,日本テレビ
http://a/2
#EXTINF:-1,Bad %ZZ encoding
http://a/3`, P);
  assert.equal(r.channels[0].tvgName, 'Café TV');
  assert.equal(r.channels[0].groupTitle, 'Français');
  assert.equal(r.channels[0].originalName, 'Télé Québec ★ ᴴᴰ');
  assert.equal(r.channels[1].originalName, '日本テレビ');
  assert.equal(r.channels[2].originalName, 'Bad %ZZ encoding');
});

test('stream headers from EXTVLCOPT and Kodi pipe syntax', () => {
  const r = parseM3U(`#EXTM3U
#EXTINF:-1,A
#EXTVLCOPT:http-user-agent=MyAgent/1.0
#EXTVLCOPT:http-referrer=http://ref/
http://a/1
#EXTINF:-1,B
http://a/2|User-Agent=Foo%20Bar&Referer=http://r/`, P);
  assert.deepEqual(r.channels[0].headers, { 'User-Agent': 'MyAgent/1.0', Referer: 'http://ref/' });
  assert.equal(r.channels[1].url, 'http://a/2');
  assert.deepEqual(r.channels[1].headers, { 'User-Agent': 'Foo Bar', Referer: 'http://r/' });
  assert.deepEqual(splitPipeHeaders('http://x'), { url: 'http://x' });
});

test('EXTGRP group and tvg-chno', () => {
  const r = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-chno="105",A\n#EXTGRP:Movies\nhttp://a/1\n`, P);
  assert.equal(r.channels[0].groupTitle, 'Movies');
  assert.equal(r.channels[0].tvgChno, 105);
});

test('stable keys survive URL/token changes and disambiguate duplicates', () => {
  const a = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-id="x",Dup\nhttp://a/1?token=1\n#EXTINF:-1 tvg-id="x",Dup\nhttp://a/2?token=1\n`, P);
  const b = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-id="x",Dup\nhttp://a/1?token=999\n#EXTINF:-1 tvg-id="x",Dup\nhttp://a/2?token=999\n`, P);
  assert.notEqual(a.channels[0].key, a.channels[1].key);
  assert.equal(a.channels[0].key, b.channels[0].key);
  assert.equal(a.channels[1].key, b.channels[1].key);
});

test('rejects non-playlists with clear errors', () => {
  assert.throws(() => parseM3U('<?xml version="1.0"?><tv></tv>', P), /XMLTV/);
  assert.throws(() => parseM3U('<!DOCTYPE html><html><body>Login</body></html>', P), /web page/);
  assert.throws(() => parseM3U('#EXTM3U\n', P), /no channels/);
  assert.throws(() => parseM3U('hello world', P), /No channels/);
});

test('handles large playlists (20,000 channels) quickly', () => {
  const lines = ['#EXTM3U'];
  for (let i = 0; i < 20000; i++) {
    lines.push(`#EXTINF:-1 tvg-id="ch${i}.demo" tvg-logo="http://logo/${i}.png" group-title="Group ${i % 40}",Demo Channel ${i}`);
    lines.push(`http://stream.example/live/${i}.m3u8`);
  }
  const t0 = performance.now();
  const r = parseM3U(lines.join('\n'), P);
  const ms = performance.now() - t0;
  assert.equal(r.channels.length, 20000);
  assert.equal(new Set(r.channels.map((c) => c.key)).size, 20000);
  assert.ok(ms < 3000, `took ${ms}ms`);
});
