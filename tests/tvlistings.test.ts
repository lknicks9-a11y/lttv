import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listingFor, parseMlbListings, parseNbaListings, parseNhlListings } from '../src/core/tvlistings';

const T = Date.parse('2026-10-26T02:00:00Z');
const team = (name: string, short: string, location: string, abbr: string, side: string) => ({ id: abbr, name, short, location, abbr, side });
const game = (league: string, home: ReturnType<typeof team>, away: ReturnType<typeof team>) => ({ id: 'g', league, start: T, state: 'pre', detail: '', name: '', home, away, broadcasts: [] }) as never;

test('NHL official feed: home/away/national channels, abbreviations as channel names', () => {
  const json = { gameWeek: [{ date: '2026-10-25', games: [{ startTimeUTC: '2026-10-26T02:00:00Z', homeTeam: { abbrev: 'SJS', placeName: { default: 'San Jose' }, commonName: { default: 'Sharks' } }, awayTeam: { abbrev: 'PIT', placeName: { default: 'Pittsburgh' }, commonName: { default: 'Penguins' } },
    tvBroadcasts: [{ id: 1, market: 'H', countryCode: 'US', network: 'NBCSCA' }, { id: 2, market: 'A', countryCode: 'US', network: 'SNP' }, { id: 3, market: 'N', countryCode: 'CA', network: 'SN' }] }] }] };
  const l = parseNhlListings(json);
  const hit = listingFor(game('nhl', team('San Jose Sharks', 'Sharks', 'San Jose', 'SJ', 'home'), team('Pittsburgh Penguins', 'Penguins', 'Pittsburgh', 'PIT', 'away')), l);
  assert.deepEqual(hit?.broadcasts.map((b) => `${b.market}:${b.name}`), ['home:NBC Sports California', 'away:SportsNet Pittsburgh']);
});

test('NBA official feed: national, home and away TV only', () => {
  const json = { leagueSchedule: { gameDates: [{ games: [{ gameDateTimeUTC: '2026-10-26T02:00:00Z', homeTeam: { teamName: 'Kings', teamCity: 'Sacramento', teamTricode: 'SAC' }, awayTeam: { teamName: 'Jazz', teamCity: 'Utah', teamTricode: 'UTA' },
    broadcasters: { nationalTvBroadcasters: [], homeTvBroadcasters: [{ broadcasterDisplay: 'NBCS-CA', broadcasterMedia: 'tv' }], awayTvBroadcasters: [{ broadcasterDisplay: 'KJZZ', broadcasterMedia: 'tv' }], homeRadioBroadcasters: [{ broadcasterDisplay: 'KHTK', broadcasterMedia: 'radio' }] } },
    { gameDateTimeUTC: '2027-01-01T00:00:00Z', homeTeam: { teamName: 'Kings' }, awayTeam: { teamName: 'Jazz' }, broadcasters: {} }] }] } };
  const l = parseNbaListings(json, T - 6 * 3600_000, T + 6 * 3600_000);
  assert.equal(l.length, 1);
  const hit = listingFor(game('nba', team('Sacramento Kings', 'Kings', 'Sacramento', 'SAC', 'home'), team('Utah Jazz', 'Jazz', 'Utah', 'UTAH', 'away')), l);
  assert.deepEqual(hit?.broadcasts.map((b) => `${b.market}:${b.name}`), ['home:NBCS-CA', 'away:KJZZ']);
});

test('MLB official feed: TV in English, national flagged', () => {
  const json = { dates: [{ games: [{ gameDate: '2026-10-26T02:00:00Z', teams: { home: { team: { name: 'Los Angeles Dodgers', teamName: 'Dodgers' } }, away: { team: { name: 'New York Yankees', teamName: 'Yankees' } } },
    broadcasts: [{ type: 'TV', name: 'FOX', isNational: true, language: 'en' }, { type: 'TV', name: 'FOX Deportes', isNational: true, language: 'es' }, { type: 'AM', name: 'KLAC', homeAway: 'home' }] }] }] };
  const hit = listingFor(game('mlb', team('Los Angeles Dodgers', 'Dodgers', 'Los Angeles', 'LAD', 'home'), team('New York Yankees', 'Yankees', 'New York', 'NYY', 'away')), parseMlbListings(json));
  assert.deepEqual(hit?.broadcasts.map((b) => `${b.market}:${b.name}`), ['national:FOX']);
});

import { teamLocalChannels } from '../src/core/teamnetworks';
import { inTeamGroupForTest } from '../src/core/streamfinder';

test('Pacers and Bucks stations; combined listings split; NHL team groups', () => {
  const ch = (n: string, i: number, group = 'USA Locals') => ({ key: `k${i}`, originalName: n, name: n, group, number: i }) as never;
  const l = [ch('US: CBS 4 Indianapolis HD', 1), ch('US: FOX 59 WXIN Indianapolis', 2), ch('US: MY 24 Milwaukee', 3)];
  assert.deepEqual(teamLocalChannels('nba', { name: 'Indiana Pacers', short: 'Pacers' }, l).map((x) => x.ch.originalName), ['US: CBS 4 Indianapolis HD', 'US: FOX 59 WXIN Indianapolis']);
  assert.deepEqual(teamLocalChannels('nba', { name: 'Milwaukee Bucks', short: 'Bucks' }, l).map((x) => x.ch.originalName), ['US: MY 24 Milwaukee']);
  const json = { leagueSchedule: { gameDates: [{ games: [{ gameDateTimeUTC: '2026-10-26T02:00:00Z', homeTeam: { teamName: 'Pacers', teamCity: 'Indiana' }, awayTeam: { teamName: 'Bucks', teamCity: 'Milwaukee' }, broadcasters: { homeTvBroadcasters: [{ broadcasterDisplay: 'WTTV/WXIN', broadcasterMedia: 'tv' }], awayTvBroadcasters: [{ broadcasterDisplay: 'Gulf Coast Sports & Entertainment Network' }] } }] }] } };
  assert.deepEqual(parseNbaListings(json, T - 1e8, T + 1e8)[0].broadcasts.map((b) => b.name), ['WTTV', 'WXIN', 'Gulf Coast Sports & Entertainment Network']);
  assert.ok(inTeamGroupForTest(ch('Boston Bruins', 9, 'USA | NHL TEAMS'), 'nhl'));
  assert.ok(!inTeamGroupForTest(ch('Utah Jazz', 9, 'WNBA Team PPV'), 'nba'));
});

import { bestStreams, capStreams } from '../src/core/streamfinder';

test('NHL with the real feed codes: both teams local channels on top', () => {
  const g = (startTimeUTC: string, away: [string, string, string], home: [string, string, string], tv: [string, string, string][]) => ({ startTimeUTC, awayTeam: { abbrev: away[0], placeName: { default: away[1] }, commonName: { default: away[2] } }, homeTeam: { abbrev: home[0], placeName: { default: home[1] }, commonName: { default: home[2] } }, tvBroadcasts: tv.map(([market, countryCode, network], id) => ({ id, market, countryCode, network })) });
  const json = { gameWeek: [{ date: '2026-10-25', games: [
    g('2026-10-25T19:00:00Z', ['FLA', 'Florida', 'Panthers'], ['CHI', 'Chicago', 'Blackhawks'], [['N', 'CA', 'SN'], ['N', 'CA', 'TVAS'], ['H', 'US', 'CHSN'], ['A', 'US', 'SCRIPPS']]),
    g('2026-10-26T02:00:00Z', ['MIN', 'Minnesota', 'Wild'], ['VAN', 'Vancouver', 'Canucks'], [['A', 'US', 'MINNHL'], ['A', 'US', 'Wild+'], ['N', 'CA', 'SN']]),
  ] }] };
  const l = parseNhlListings(json);
  const ch = (n: string, i: number, group = 'USA Sports') => ({ key: `k${i}`, originalName: n, name: n, group, number: i, hidden: false }) as never;
  const lineup = [ch('US: Chicago Sports Network HD', 1), ch('US: WSFL 39 Miami', 2), ch('Florida Panthers', 3, 'NHL'), ch('Minnesota Wild', 4, 'USA | NHL'), ch('Vancouver Canucks', 5, 'NHL Teams'), ch('CA: Sportsnet Pacific', 6, 'Canada Sports'), ch('US: ESPN', 7)];
  const team = (name: string, short: string, location: string, abbr: string, side: string) => ({ id: abbr, name, short, location, abbr, side });
  const game = (start: string, home: ReturnType<typeof team>, away: ReturnType<typeof team>) => {
    const x = { id: 'x', league: 'nhl', start: Date.parse(start), state: 'pre', detail: '', name: '', home, away, broadcasts: [] as unknown[] };
    x.broadcasts = listingFor(x as never, l)!.broadcasts;
    return x as never;
  };
  const show = (gm: never) => capStreams(bestStreams(gm, lineup, 'hockey', [])).map((p) => `${p.side ?? '-'}:${p.ch.originalName}`);
  const a = show(game('2026-10-25T19:00:00Z', team('Chicago Blackhawks', 'Blackhawks', 'Chicago', 'CHI', 'home'), team('Florida Panthers', 'Panthers', 'Florida', 'FLA', 'away')));
  assert.deepEqual(a.slice(0, 2).sort(), ['away:US: WSFL 39 Miami', 'home:US: Chicago Sports Network HD'].sort(), a.join(' | '));
  assert.ok(a.includes('away:Florida Panthers'), a.join(' | '));
  const b = show(game('2026-10-26T02:00:00Z', team('Vancouver Canucks', 'Canucks', 'Vancouver', 'VAN', 'home'), team('Minnesota Wild', 'Wild', 'Minnesota', 'MIN', 'away')));
  assert.deepEqual(b, ['away:Minnesota Wild', 'home:CA: Sportsnet Pacific']);
});

import { parseSmwListings } from '../src/core/tvlistings';

test('NBA from Sports Media Watch: national plus each team\'s locals, list and table layouts', () => {
  const html = `<html><body><script>var x = "Monday, October 1";</script>
  <h3>Today <span>9 games</span></h3>
  <div class="g"><div class="t">8:00 pm</div><div class="m">Golden State Warriors vs Denver Nuggets</div><div class="w">Watch on: <a>NBCSN</a>, <a>Peacock</a></div></div>
  <h3>Wednesday, October 28 <span>12 games</span></h3>
  <div class="g"><div class="t">7:00 pm</div><div class="m">Philadelphia 76ers vs Indiana Pacers</div><div class="w">ESPN, ESPN Deportes, ESPN Unlimited; A: NBCSP, Peacock; H: DAZN</div></div>
  <table><tr><th>Time</th><th>Game / TV</th></tr>
  <tr><td colspan=2>Wednesday, October 28</td></tr>
  <tr><td>7:00 pm</td><td>Philadelphia 76ers vs Indiana Pacers<br>ESPN, ESPN Deportes, ESPN Unlimited; A: NBCSP, Peacock; H: DAZN</td></tr>
  <tr><td>8:00 pm</td><td>Houston Rockets vs Milwaukee Bucks<br>NBA League Pass; A: SCHN, SCHN+; H: WCGV-My24, Bucks+</td></tr>
  <tr><td>8:00 pm</td><td>Charlotte Hornets vs Detroit Pistons<br>NBA League Pass; A: WAXN-TV64, DAZN; H: WMYD-IND, DAZN</td></tr>
  <tr><td>7:30 pm</td><td>Orlando Magic vs Toronto Raptors<br>NBA League Pass; A: WRDQ-IND, DAZN; TSN1/4, TSN Premium</td></tr>
  </table></body></html>`;
  const now = Date.parse('2026-10-26T22:00:00Z');
  const l = parseSmwListings(html, now);
  const f = (away: string) => l.find((x) => x.away[0] === away);
  assert.equal(l.length, 5);
  assert.deepEqual(f('Golden State Warriors')!.broadcasts.map((b) => `${b.market}:${b.name}`), ['national:NBCSN']);
  assert.equal(new Date(f('Golden State Warriors')!.start).toISOString(), '2026-10-27T00:00:00.000Z');
  assert.deepEqual(f('Philadelphia 76ers')!.broadcasts.map((b) => `${b.market}:${b.name}`), ['national:ESPN', 'away:NBC Sports Philadelphia']);
  assert.deepEqual(f('Houston Rockets')!.broadcasts.map((b) => `${b.market}:${b.name}`), ['away:Space City Home Network', 'home:WCGV', 'home:My24']);
  assert.deepEqual(f('Charlotte Hornets')!.broadcasts.map((b) => `${b.market}:${b.name}`), ['away:WAXN', 'away:TV64', 'home:WMYD']);
  assert.deepEqual(f('Orlando Magic')!.broadcasts.map((b) => `${b.market}:${b.name}`), ['away:WRDQ', 'national:TSN1', 'national:TSN4']);
  // Matched to the schedule's game.
  const team = (name: string, short: string, location: string, abbr: string, side: string) => ({ id: abbr, name, short, location, abbr, side });
  const g = { id: 'x', league: 'nba', start: Date.parse('2026-10-29T00:05:00Z'), state: 'pre', detail: '', name: '', home: team('Milwaukee Bucks', 'Bucks', 'Milwaukee', 'MIL', 'home'), away: team('Houston Rockets', 'Rockets', 'Houston', 'HOU', 'away'), broadcasts: [] } as never;
  assert.ok(listingFor(g, l));
});

test('Sports Media Watch: TV pieces on separate lines still land on the right team', () => {
  const html = `<h3>Wednesday, October 28</h3><div>7:00 pm</div><div>Philadelphia 76ers vs Indiana Pacers</div><div>Watch on:</div><div><a>ESPN</a></div><div>A:</div><div><a>NBCSP</a></div><div>H:</div><div>WTTV</div>`;
  const l = parseSmwListings(html, Date.parse('2026-10-26T22:00:00Z'));
  assert.deepEqual(l[0].broadcasts.map((b) => `${b.market}:${b.name}`), ['national:ESPN', 'away:NBC Sports Philadelphia', 'home:WTTV']);
});

test('Sports Media Watch game cards (the page\'s real markup)', () => {
  const pill = (box: string, text: string) => `<span class="smw-cards-net-item smw-cards-net-local"><span class="smwcards-net-pill smwcards-net-pill-local smwcards-net-pill-tc" style="--x:1">${box ? `<span class="${box}-box">${box === 'away' ? 'A' : 'H'}</span> ` : ''}${text}</span></span>`;
  const card = (ts: string, ac: string, an: string, hc: string, hn: string, pills: string) => `<div class="smw-cards-daycard-item"><div class="smw-cards-row"><div class="smw-cards-time"><span class="smwcards-local-time" data-timestamp="${ts}">7:00 pm</span></div><div class="smw-cards-matchcol"><div class="smw-cards-matchup"><div class="smw-cards-team-away" style="--a:1"><a class="smwcards-team-link" href="#"><span class="smwcards-team-text">${ac}</span></a><span class="smw-cards-team-nick" style="font-size:18px">${an}</span></div><span class="smw-cards-vs">vs</span><div class="smw-cards-team-home" style="--a:1"><a class="smwcards-team-link" href="#"><span class="smwcards-team-text">${hc}</span></a><span class="smw-cards-team-nick" style="font-size:18px">${hn}</span></div></div></div></div><div class="smw-cards-foot"><div class="smw-cards-nets">${pills}</div></div></div>`;
  const html = card('2026-10-26T23:00:00+00:00', 'Washington', 'Wizards', 'Charlotte', 'Hornets', `<span class="smw-cards-net-item"><span class="smwcards-net-pill"><a href="#">NBA League Pass</a></span></span>${pill('away', 'MNMT')}${pill('away', 'Monumental+')}${pill('home', 'WAXN-TV64')}${pill('home', '<a href="#">DAZN</a>')}`)
    + card('2026-10-27T02:00:00+00:00', 'Golden State', 'Warriors', 'Denver', 'Nuggets', `${pill('', 'Peacock')}${pill('', 'NBCSN')}${pill('home', 'ALT')}${pill('', 'SN1')}`);
  const l = parseSmwListings(html);
  assert.deepEqual(l.map((g) => `${new Date(g.start).toISOString()} ${g.away[0]} @ ${g.home[0]} :: ${g.broadcasts.map((b) => `${b.market}:${b.name}`).join(', ')}`), [
    '2026-10-26T23:00:00.000Z Washington Wizards @ Charlotte Hornets :: away:Monumental Sports Network, home:WAXN, home:TV64',
    '2026-10-27T02:00:00.000Z Golden State Warriors @ Denver Nuggets :: national:NBCSN, home:Altitude',
  ]);
});
