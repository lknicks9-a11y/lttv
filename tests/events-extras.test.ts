import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelHeadline, isEventChannel, parseEventName, splitSlot } from '../src/core/events';
import { applyGuideExtras, providerRef, shortEpgUrl, needsProviderGuide } from '../src/core/extras';
import { GuideIndex } from '../src/core/guide';
import { parseShortEpg, xtreamAlternates, xtreamStreamRef } from '../src/core/xtream';
import { matchChannels, countryOf, stripCountry } from '../src/core/match';
import type { LineupChannel, MatchResult } from '../src/core/types';

const NOW = Date.UTC(2026, 9, 14, 22, 0); // 6:00 pm New York

function ch(name: string, group: string, extra: Partial<LineupChannel> = {}): LineupChannel {
  return {
    key: 'k-' + name, playlistId: 'p', index: 0, number: 1, name, originalName: name, cleanedName: name, url: 'http://line.example:8080/live/u/p/101.ts',
    group, category: 'sports', categoryEvidence: 'group', favorite: false, hidden: false, order: 0, matchStatus: 'unmatched', matchMethod: 'none', matchConfidence: 0,
    ...extra,
  };
}

test('event channels are told apart from linear channels', () => {
  assert.equal(isEventChannel(ch('NBA 05: Lakers vs Celtics @ 7:30 PM ET', 'USA NBA')), true);
  assert.equal(isEventChannel(ch('PPV 2', 'PPV')), true);
  assert.equal(isEventChannel(ch('ESPN+ 14', 'ESPN+')), true);
  assert.equal(isEventChannel(ch('DAZN 23', 'DAZN Events')), true);
  assert.equal(isEventChannel(ch('ESPN 2 HD', 'USA Sports')), false);
  assert.equal(isEventChannel(ch('Sky Sports 1 HD', 'UK Sports')), false);
  assert.equal(isEventChannel(ch('TSN 4', 'Canada Sports')), false);
});

test('the game and start time are read from the channel name', () => {
  const a = parseEventName('USA | NFL 03 | Bills vs Jets | 8:15PM ET', NOW, 'America/New_York');
  assert.equal(a.label, 'NFL 03');
  assert.equal(a.title, 'Bills vs Jets');
  assert.equal(a.start, Date.UTC(2026, 9, 15, 0, 15));
  const b = parseEventName('US: MLB 07 Yankees @ Red Sox Oct 14 7:05pm', NOW, 'America/New_York');
  assert.equal(b.title, 'Yankees @ Red Sox');
  assert.equal(b.start, Date.UTC(2026, 9, 14, 23, 5));
  assert.equal(parseEventName('NFL 01 - No Event', NOW).title, '');
  assert.equal(parseEventName('PPV 2', NOW).title, '');
  assert.equal(splitSlot('NHL 12 ᴴᴰ').label, 'NHL 12');
});

test('event channels show the game on now; others keep their name', () => {
  const g = new GuideIndex();
  const lineup = [ch('NBA 05: Lakers vs Celtics @ 5:30 PM ET', 'USA NBA'), ch('NFL 01', 'NFL Game Pass'), ch('ESPN 2 HD', 'USA Sports')];
  const v = applyGuideExtras(lineup, new Map(), g, { now: NOW, timeZone: 'America/New_York', eventNames: true, providerGuide: true });
  const [nba, nfl, espn] = v.lineup;
  assert.equal(nba.matchMethod, 'event');
  assert.equal(v.matches.get(nba.key)?.status, 'auto');
  const h1 = channelHeadline(nba, g, NOW);
  assert.deepEqual([h1.title, h1.slot, h1.live], ['Lakers vs Celtics', 'NBA 05', true]);
  // Nothing on: the slot name, without the clutter.
  assert.equal(channelHeadline(nfl, g, NOW).title, 'NFL 01');
  assert.equal(channelHeadline(espn, g, NOW).title, 'ESPN 2 HD');
  assert.equal(channelHeadline(espn, g, NOW).slot, undefined);
  // Turned off in settings.
  assert.equal(channelHeadline(nba, g, NOW, false).title, nba.name);
});

test('a game listed in the guide names an event channel too', () => {
  const g = new GuideIndex();
  g.set('src|nfl1', [
    { ch: 'src|nfl1', start: NOW - 3600_000, stop: NOW + 7200_000, title: 'Chiefs at Raiders' },
  ]);
  const c = ch('NFL 01', 'NFL Game Pass', { epgChannelId: 'src|nfl1', matchStatus: 'auto', matchMethod: 'tvg-id' });
  const hl = channelHeadline(c, g, NOW);
  assert.equal(hl.title, 'Chiefs at Raiders');
  assert.equal(hl.live, true);
  // A guide entry that just repeats the slot name is not a game.
  g.set('src|nfl1', [{ ch: 'src|nfl1', start: NOW - 3600_000, stop: NOW + 7200_000, title: 'NFL 01' }]);
  assert.equal(channelHeadline(c, g, NOW).title, 'NFL 01');
});

test('a user rename always wins', () => {
  const g = new GuideIndex();
  const c = ch('NBA 05: Lakers vs Celtics @ 5:30 PM ET', 'USA NBA');
  const v = applyGuideExtras([{ ...c, name: 'My game' }], new Map(), g, { now: NOW, eventNames: true, providerGuide: true });
  assert.equal(channelHeadline(v.lineup[0], g, NOW).title, 'My game');
});

test('provider guide fills channels the guide file misses, never overriding a real match', () => {
  const url = 'http://line.example:8080/live/u/p/101.ts';
  const ref = providerRef(url)!;
  assert.equal(ref, 'xt|line.example:8080|101');
  assert.equal(providerRef('http://cdn.example/hls/news/index.m3u8'), undefined);
  assert.equal(providerRef('http://line.example:8080/movie/u/p/55.mp4'), undefined);
  // Classic get.php?output=ts links have no "/live/".
  assert.equal(providerRef('http://line.example:8080/u/p/101.ts'), 'xt|line.example:8080|101');
  assert.equal(shortEpgUrl(url), 'http://line.example:8080/player_api.php?username=u&password=p&action=get_short_epg&stream_id=101&limit=12');

  const g = new GuideIndex();
  g.set(ref, [{ ch: ref, start: NOW - 600_000, stop: NOW + 3000_000, title: 'SportsCenter' }]);
  const plain = ch('ESPN', 'USA Sports', { url, category: 'sports' });
  const v = applyGuideExtras([plain], new Map(), g, { now: NOW, eventNames: true, providerGuide: true });
  assert.equal(v.lineup[0].matchMethod, 'provider');
  assert.equal(v.lineup[0].epgChannelId, ref);
  assert.equal(g.current(v.lineup[0].epgChannelId, NOW)?.title, 'SportsCenter');

  // Real guide-file data wins.
  g.set('src|espn', [{ ch: 'src|espn', start: NOW - 600_000, stop: NOW + 3000_000, title: 'NFL Live' }]);
  const raw = new Map<string, MatchResult>([[plain.key, { key: plain.key, epgChannelId: 'src|espn', method: 'tvg-id', confidence: 1, status: 'auto' }]]);
  const matched = { ...plain, epgChannelId: 'src|espn', matchStatus: 'auto' as const, matchMethod: 'tvg-id' as const };
  const v2 = applyGuideExtras([matched], raw, g, { now: NOW, eventNames: true, providerGuide: true });
  assert.equal(v2.lineup[0].epgChannelId, 'src|espn');
  assert.equal(needsProviderGuide(v2.lineup[0], g), false);
  // Off in settings.
  const v3 = applyGuideExtras([plain], new Map(), g, { now: NOW, eventNames: true, providerGuide: false });
  assert.equal(v3.lineup[0].matchMethod, 'none');
});

test('provider short EPG is decoded (base64 titles, unix times)', () => {
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
  const list = parseShortEpg({ epg_listings: [
    { title: b64('Late Show'), description: b64('Talk'), start_timestamp: String(NOW / 1000 + 3600), stop_timestamp: String(NOW / 1000 + 7200) },
    { title: b64('Évening News'), start_timestamp: String(NOW / 1000), stop_timestamp: String(NOW / 1000 + 3600) },
    { title: '', start_timestamp: '1', stop_timestamp: '2' },
  ] }, 'xt|h|1');
  assert.deepEqual(list.map((p) => p.title), ['Évening News', 'Late Show']);
  assert.equal(list[1].desc, 'Talk');
  assert.deepEqual(parseShortEpg({ epg_listings: [] }, 'x'), []);
  assert.deepEqual(parseShortEpg(null, 'x'), []);
});

test('stream format alternates for Xtream channels', () => {
  const ts = 'http://line.example:8080/live/u%40x/p/101.ts';
  assert.deepEqual(xtreamStreamRef(ts), { base: 'http://line.example:8080', user: 'u@x', pass: 'p', id: '101', ext: 'ts' });
  assert.deepEqual(xtreamAlternates(ts, true), ['http://line.example:8080/live/u%40x/p/101.m3u8', 'http://line.example:8080/u%40x/p/101.ts']);
  assert.deepEqual(xtreamAlternates('http://line.example:8080/live/u/p/101.m3u8', false), ['http://line.example:8080/u/p/101.ts', 'http://line.example:8080/live/u/p/101.ts']);
  // Classic link from get.php?output=ts: HLS is tried first in browsers.
  assert.deepEqual(xtreamAlternates('http://line.example:8080/u/p/101.ts', true), ['http://line.example:8080/live/u/p/101.m3u8', 'http://line.example:8080/live/u/p/101.ts']);
  assert.deepEqual(xtreamAlternates('http://line.example:8080/movie/u/p/55.mp4', true), []);
  assert.deepEqual(xtreamAlternates('http://cdn.example/hls/news.m3u8', true), []);
});

test('guide matching handles country prefixes and duplicate guide entries', () => {
  assert.equal(countryOf('USA ESPN HD'), 'us');
  assert.equal(countryOf('UK: Sky Sports'), 'uk');
  assert.equal(countryOf('CNN International'), undefined);
  assert.equal(stripCountry('USA ESPN HD'), 'ESPN HD');
  assert.equal(stripCountry('AT&T SportsNet'), undefined);
  const epg = [
    { id: 'ESPN.us', sourceId: 'a', displayNames: ['ESPN'] },
    { id: 'ESPN.ca', sourceId: 'a', displayNames: ['ESPN'] },
    { id: 'CNN.us', sourceId: 'a', displayNames: ['CNN'] },
    { id: 'CNN.us', sourceId: 'b', displayNames: ['CNN'] },
    { id: 'TSN1.ca', sourceId: 'a', displayNames: ['TSN 1'] },
  ];
  const names = ['USA ESPN HD', 'CA: ESPN', 'CNN HD', 'USA TSN 1', 'ESPN'];
  const chans = names.map((n, i) => ({ key: 'k' + i, playlistId: 'p', index: i, originalName: n, url: 'http://x/' + i }));
  const m = matchChannels(chans, epg);
  assert.equal(m.get('k0')?.epgChannelId, 'a|ESPN.us');
  assert.equal(m.get('k1')?.epgChannelId, 'a|ESPN.ca');
  assert.equal(m.get('k2')?.epgChannelId, 'a|CNN.us');
  assert.equal(m.get('k3')?.epgChannelId, 'a|TSN1.ca');
  // No country to go on: two different ESPNs stay a question for the user.
  assert.notEqual(m.get('k4')?.status, 'auto');
});
