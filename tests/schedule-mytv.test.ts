import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScoreboard, scoreboardUrl, scheduleLeague, textMatchesGame, SCHEDULE_LEAGUES, type Game } from '../src/core/schedule';
import { channelsForBroadcast, networkForBroadcast } from '../src/core/networks';
import { bestStreams, findStreams, needsFeedChoice, broadcastSummary } from '../src/core/streamfinder';
import { lighterVariant } from '../src/core/variants';
import { assignMyTv, myTvEntryFor, MYTV_LINEUP, qualityRank } from '../src/core/mytv';
import { buildLineup, filterLineup, sortLineup } from '../src/core/organize';
import type { ParsedChannel } from '../src/core/types';

const T0 = Date.UTC(2026, 9, 15, 23, 5);

function scoreboard() {
  const team = (id: string, name: string, short: string, loc: string, abbr: string, side: string, score: string) => ({
    homeAway: side, score, winner: side === 'home',
    team: { id, displayName: name, shortDisplayName: short, location: loc, abbreviation: abbr, logo: `https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/${abbr}.png`, logoDark: `https://a.espncdn.com/i/teamlogos/mlb/500-dark/scoreboard/${abbr}.png`, color: '0c2340' },
    records: [{ name: 'overall', type: 'total', summary: '94-68' }],
  });
  const geo = (type: string, market: string, name: string) => ({ type: { shortName: type }, market: { type: market }, media: { shortName: name }, lang: 'en', region: 'us' });
  return {
    day: { date: '2026-10-15' },
    events: [
      {
        id: '401', name: 'Boston Red Sox at New York Yankees', date: new Date(T0).toISOString(),
        competitions: [{
          date: new Date(T0).toISOString(),
          competitors: [team('10', 'New York Yankees', 'Yankees', 'New York', 'NYY', 'home', '3'), team('2', 'Boston Red Sox', 'Red Sox', 'Boston', 'BOS', 'away', '1')],
          geoBroadcasts: [geo('TV', 'Home', 'YES'), geo('TV', 'Away', 'NESN'), geo('Radio', 'Home', 'WFAN'), geo('Streaming', 'National', 'MLB.tv')],
          broadcasts: [{ market: 'home', names: ['YES'] }],
          status: { type: { state: 'in', shortDetail: 'Top 3rd' } },
          venue: { fullName: 'Yankee Stadium' },
        }],
      },
      {
        id: '402', name: 'Philadelphia Flyers at Tampa Bay Lightning', date: new Date(T0 + 3600_000).toISOString(),
        competitions: [{
          competitors: [team('20', 'Tampa Bay Lightning', 'Lightning', 'Tampa Bay', 'TB', 'home', '0'), team('15', 'Philadelphia Flyers', 'Flyers', 'Philadelphia', 'PHI', 'away', '0')],
          broadcasts: [{ market: 'national', names: ['NHL Net'] }, { market: 'away', names: ['NBC Sports Phil'] }],
          status: { type: { state: 'pre', shortDetail: '8:05 PM' } },
        }],
      },
      { id: 'bad', competitions: [{}] },
    ],
  };
}

test('ESPN scoreboard parsed into games with logos, scores and broadcasts', () => {
  const games = parseScoreboard(scoreboard(), 'mlb');
  assert.equal(games.length, 2);
  const g = games[0];
  assert.equal(g.home.name, 'New York Yankees');
  assert.equal(g.away.short, 'Red Sox');
  assert.equal(g.home.logo, 'https://a.espncdn.com/i/teamlogos/mlb/500-dark/scoreboard/NYY.png');
  assert.equal(g.home.score, '3');
  assert.equal(g.state, 'in');
  assert.equal(g.detail, 'Top 3rd');
  assert.deepEqual(g.broadcasts.map((b) => `${b.market}:${b.name}:${b.kind}`), ['home:YES:tv', 'away:NESN:tv', 'national:MLB.tv:streaming']);
  // Falls back to "broadcasts" when there are no geoBroadcasts.
  assert.deepEqual(games[1].broadcasts.map((b) => `${b.market}:${b.name}`), ['national:NHL Net', 'away:NBC Sports Phil']);
  assert.equal(parseScoreboard({}, 'mlb').length, 0);
  assert.equal(parseScoreboard(null, 'mlb').length, 0);
});

test('league tabs and scoreboard URLs', () => {
  assert.deepEqual(SCHEDULE_LEAGUES.map((l) => l.tab), ['NBA', 'NFL', 'MLB', 'NHL', 'UCL', 'EPL', 'Bundesliga', 'Serie A', 'Ligue 1', 'LaLiga', 'MLS', 'CBB', 'CFB']);
  assert.equal(scoreboardUrl(scheduleLeague('cbb')!, '20261115'), 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=20261115&groups=50&limit=400');
  assert.equal(scoreboardUrl(scheduleLeague('epl')!, '20261018'), 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20261018');
});

test('a game is recognised in event names and guide titles only when both teams are named', () => {
  const [g] = parseScoreboard(scoreboard(), 'mlb');
  assert.ok(textMatchesGame('MLB 05: Red Sox @ Yankees 7:05 PM ET', g, 'baseball'));
  assert.ok(textMatchesGame('MLB Baseball Boston Red Sox at New York Yankees', g, 'baseball'));
  assert.ok(!textMatchesGame('MLB 05: Yankees vs Blue Jays', g, 'baseball'));
  assert.ok(!textMatchesGame('Yankees Classics', g, 'baseball'));
});

test('schedule network names resolve to playlist channels', () => {
  assert.equal(networkForBroadcast('NBC Sports Phil').network?.id, 'nbcsphilly');
  assert.equal(networkForBroadcast('USA Net').network?.id, 'usa');
  assert.equal(networkForBroadcast('NHL Net').network?.id, 'nhlnet');
  assert.ok(networkForBroadcast('FDSN Detroit').keys.includes('ballysportsdetroit'));
  assert.ok(networkForBroadcast('FanDuel SN DET').keys.includes('fanduelsportsdetroit'));
});

function lineupOf(names: [string, string?][]) {
  const chans: ParsedChannel[] = names.map(([n, g], i) => ({ key: 'k' + i, playlistId: 'p', index: i, originalName: n, groupTitle: g, url: `http://h/live/u/p/${i}.ts` }));
  return buildLineup({ channels: chans, customizations: new Map(), matches: new Map() });
}

test('best streams: event channel, chosen team broadcast, national; other cities and countries excluded', () => {
  const [g, nhl] = parseScoreboard(scoreboard(), 'mlb');
  const lineup = lineupOf([
    ['US: YES Network HD', 'USA Sports'], ['US: YES Network SD', 'USA Sports'], ['US: NESN FHD', 'USA Sports'],
    ['MLB 05: Red Sox @ Yankees (YES)', 'MLB Extra Innings'], ['UK: Sky Sports Main Event', 'UK Sports'],
    ['US: NBC Sports Philadelphia', 'USA Sports'], ['US: NHL Network', 'USA Sports'], ['US: ESPN', 'USA Sports'],
  ]);
  assert.ok(needsFeedChoice(g));
  const yes = findStreams(g, lineup, { sport: 'baseball', feed: 'home', index: [{ ch: lineup[3], text: lineup[3].originalName, start: 0, stop: Infinity, event: true }] });
  assert.equal(yes[0].ch.originalName, 'MLB 05: Red Sox @ Yankees (YES)'); // event channel labelled with the YES feed
  assert.equal(yes[1].ch.originalName, 'US: YES Network HD'); // HD before SD
  assert.ok(yes.findIndex((p) => /NESN/.test(p.ch.originalName)) > yes.findIndex((p) => /YES Network SD/.test(p.ch.originalName)));
  const bos = findStreams(g, lineup, { sport: 'baseball', feed: 'away' });
  assert.equal(bos[0].ch.originalName, 'US: NESN FHD');
  assert.equal(bos[0].reason, 'NESN · Red Sox broadcast');
  assert.ok(!bos.some((p) => /Sky Sports/.test(p.ch.originalName)));
  // Hockey: national NHL Network and the Flyers' broadcast.
  const h = findStreams(nhl, lineup, { sport: 'hockey' });
  assert.deepEqual(h.map((p) => p.ch.originalName), ['US: NHL Network', 'US: NBC Sports Philadelphia']);
  assert.equal(needsFeedChoice(nhl), false);
  assert.equal(broadcastSummary(g), 'YES (NYY) · NESN (BOS)');
});

test('one best-first stream list for a game: no broadcast question, both teams\' feeds included', () => {
  const [g] = parseScoreboard(scoreboard(), 'mlb');
  const lineup = lineupOf([
    ['US: YES Network HD', 'USA Sports'], ['US: NESN FHD', 'USA Sports'],
    ['MLB 05: Red Sox @ Yankees', 'MLB Extra Innings'], ['UK: Sky Sports Main Event', 'UK Sports'],
  ]);
  const index = [{ ch: lineup[2], text: lineup[2].originalName, start: 0, stop: Infinity, event: true }];
  const all = bestStreams(g, lineup, 'baseball', index);
  assert.equal(all[0].ch.originalName, 'MLB 05: Red Sox @ Yankees'); // the game's own event channel first
  assert.ok(all.some((p) => /YES/.test(p.ch.originalName)) && all.some((p) => /NESN/.test(p.ch.originalName)));
  assert.ok(!all.some((p) => /Sky Sports/.test(p.ch.originalName)));
  // A Red Sox fan gets the NESN feed ahead of YES.
  const fan = bestStreams(g, lineup, 'baseball', index, (t) => t.short === 'Red Sox');
  assert.ok(fan.findIndex((p) => /NESN/.test(p.ch.originalName)) < fan.findIndex((p) => /YES/.test(p.ch.originalName)));
});

test('Multiview: a lighter copy of a full-HD channel from the same provider and country', () => {
  const lineup = lineupOf([
    ['US: ESPN FHD', 'USA Sports'], ['US: ESPN HD', 'USA Sports'], ['US: ESPN SD', 'USA Sports'], ['UK: ESPN HD', 'UK Sports'],
    ['US: FS1 FHD', 'USA Sports'], ['US: FS1 SD', 'USA Sports'], ['US: TNT', 'USA Sports'],
  ]);
  const by = (n: string) => lineup.find((c) => c.originalName === n)!;
  assert.equal(lighterVariant(by('US: ESPN FHD'), lineup)?.originalName, 'US: ESPN HD');
  assert.equal(lighterVariant(by('US: ESPN HD'), lineup), undefined); // already light
  assert.equal(lighterVariant(by('US: FS1 FHD'), lineup), undefined); // never down to SD
  assert.equal(lighterVariant(by('US: TNT'), lineup), undefined);
  // Quarter-screen tiles (4 games) may go down to SD when there's no HD copy.
  assert.equal(lighterVariant(by('US: FS1 FHD'), lineup, true)?.originalName, 'US: FS1 SD');
  assert.equal(lighterVariant(by('US: ESPN FHD'), lineup, true)?.originalName, 'US: ESPN HD'); // HD still preferred
  assert.equal(lighterVariant(by('US: ESPN HD'), lineup, true)?.originalName, 'US: ESPN SD');
});

test('My TV: DIRECTV New York/NJ numbers, best copy wins, filters and sorts', () => {
  const nums = new Set(MYTV_LINEUP.map((e) => e.n));
  assert.equal(nums.size, MYTV_LINEUP.length, 'no duplicate channel numbers');
  // From directv.com/channel-lineup (New York market): locals, packages, RSNs and MyFree DIRECTV.
  for (const [n, expected] of [[2, 'CBS'], [7, 'ABC'], [49, 'WEDW'], [206, 'ESPN'], [209, 'ESPN2'], [202, 'CNN'], [360, 'Fox News'], [631, 'YES'], [639, 'SportsNet New York'], [634, 'MSG'], [501, 'HBO'], [241, 'Paramount'], [4108, 'Ocho'], [4230, 'Court TV']] as const) {
    assert.ok(MYTV_LINEUP.find((e) => e.n === n)?.name.includes(expected), `${n} ${expected}`);
  }
  assert.ok(MYTV_LINEUP.length > 450);
  assert.ok(!MYTV_LINEUP.some((e) => /\bMix\b|4K Live|on Apple TV|League Pass|Overflow/.test(e.name)));
  for (const [n, alias] of [[219, 'FS1'], [356, 'MSNBC'], [639, 'SNY']] as const) {
    assert.ok(MYTV_LINEUP.find((e) => e.n === n)?.aliases?.includes(alias), `${n} alias ${alias}`);
  }
  const e = (n: string) => myTvEntryFor({ originalName: n, cleanedName: n, group: '' })?.n;
  assert.equal(e('US: CBS 2 New York (WCBS)'), 2);
  assert.equal(e('US: CBS News New York'), undefined);
  assert.equal(e('US: CBS Boston (WBZ)'), undefined);
  // New York stations only: a plain network feed isn't assumed to be New York's (it is often another city's station).
  assert.deepEqual(['US: CBS HD', 'US: NBC EAST', 'US: FOX', 'US: ABC ᴴᴰ'].map(e), [undefined, undefined, undefined, undefined]);
  assert.deepEqual(['US: FOX 5 Atlanta', 'US: ABC 7 Los Angeles (KABC)', 'US: NBC 4 New York (WNBC)', 'US: FOX 5 NEWYORK', 'US: ABC 7 N.Y. HD', 'US: WNYW FOX'].map(e), [undefined, undefined, 4, 5, 7, 5]);
  // ...unless its tvg-id or guide channel shows the New York station.
  const ei = (n: string, id: object) => myTvEntryFor({ originalName: n, cleanedName: n, group: '', ...id })?.n;
  assert.equal(ei('US: NBC HD', { tvgId: 'WNBC.us' }), 4);
  assert.equal(ei('US: FOX', { epgRef: 's|fox.us', epgNames: ['FOX 5 New York (WNYW)'] }), 5);
  assert.equal(ei('US: ABC', { tvgId: 'KABC.us' }), undefined); // Los Angeles
  assert.equal(ei('US: NBC', { epgRef: 's|WMAQ-DT.us', epgNames: ['NBC 5 Chicago'] }), undefined);
  // A channel named after the New York station wins over one placed by its guide id.
  const locals = assignMyTv(lineupOf([['US: CBS FHD', 'USA'], ['US: CBS 2 New York (WCBS) HD', 'USA Locals'], ['US: ABC', 'USA']]));
  assert.equal(locals.get('k1'), 2);
  assert.equal(locals.get('k0'), undefined);
  assert.equal(locals.get('k2'), undefined);
  assert.equal(e('USA Network HD'), 242);
  assert.equal(e('USA ESPN FHD'), 206);
  assert.equal(e('US: HBO West'), undefined); // DIRECTV's streaming lineup has only the East feed
  assert.equal(e('US: STARZ Encore West'), 536);
  assert.equal(e('US: SNY'), 639);
  assert.equal(e('US: Court TV'), 4230);
  assert.equal(e('UK: Discovery'), undefined);
  assert.equal(e('US: ESPN +1'), undefined);
  assert.ok(qualityRank('ESPN 4K') > qualityRank('ESPN FHD') && qualityRank('ESPN FHD') > qualityRank('ESPN HD') && qualityRank('ESPN HD') > qualityRank('ESPN SD'));

  const lineup = lineupOf([['US: ESPN HD', 'USA Sports'], ['US: ESPN FHD', 'USA Sports'], ['UK: Sky News', 'UK News'], ['US: CNN', 'USA News'], ['TEST: Local Thing']]);
  const mt = assignMyTv(lineup);
  assert.equal(mt.get('k1'), 206); // FHD copy
  assert.equal(mt.get('k0'), undefined);
  assert.equal(mt.get('k3'), 202);
  const numbered = buildLineup({ channels: lineup.map((c) => ({ key: c.key, playlistId: 'p', index: c.index, originalName: c.originalName, groupTitle: c.group, url: c.url })), customizations: new Map(), matches: new Map(), myTvNumbers: true });
  const sorted = sortLineup(numbered, 'mytv');
  assert.deepEqual(sorted.slice(0, 2).map((c) => `${c.number} ${c.originalName}`), ['202 US: CNN', '206 US: ESPN FHD']);
  assert.ok(sorted.slice(2).every((c) => c.number >= 1000));
  assert.deepEqual(filterLineup(numbered, 'mytv').map((c) => c.myTv), [202, 206]);
  assert.deepEqual(filterLineup(numbered, 'country:uk').map((c) => c.originalName), ['UK: Sky News']);
  assert.deepEqual(sortLineup(numbered, 'country').map((c) => c.country ?? '-'), ['us', 'us', 'us', 'uk', '-']);
  assert.equal(filterLineup(numbered, 'provider:p').length, 5);
});

test('country tabs: every country from name prefixes and groups', async () => {
  const { detectCountry, countryName, countryFlag } = await import('../src/core/countries');
  const cases: [string, string | undefined, string | undefined][] = [
    ['US: ESPN', undefined, 'us'], ['USA ESPN FHD', undefined, 'us'], ['|UK| Sky One', undefined, 'uk'], ['PK: Geo News', undefined, 'pk'],
    ['AR: MBC 1', undefined, 'ar'], ['EX-YU: RTS 1', undefined, 'exyu'], ['Geo News', 'Pakistan', 'pk'], ['Rai 1', 'ITALIA', 'it'],
    ['TF1', '|FR| France', 'fr'], ['Channel 1', 'PK Sports', 'pk'], ['Telefe', 'Argentina', 'ar_country'], ['GMA', 'Pinoy TV', 'ph'],
    ['NBA 05: Lakers vs Celtics', 'NBA League Pass', undefined], ['VIP: Movie 1', undefined, undefined], ['ESPN', 'Sports', undefined],
  ];
  for (const [n, g, want] of cases) assert.equal(detectCountry(n, g), want, `${n} | ${g}`);
  assert.equal(countryName('pk'), 'Pakistan');
  assert.equal(countryName('ar'), 'Arabic');
  assert.equal(countryName(undefined), 'Other');
  assert.equal(countryFlag('us'), '🇺🇸');
  assert.equal(countryFlag('uk'), '🇬🇧');
  assert.equal(countryFlag('ar'), '');
});

