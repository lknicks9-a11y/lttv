import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamLocalChannels, teamStations } from '../src/core/teamnetworks';

const ch = (originalName: string, n: number) => ({ key: `k${n}`, originalName, name: originalName, group: 'USA Sports', number: n }) as never;
const lineup = [
  ch('US: NBC Sports Boston HD', 1), ch('US: YES Network', 2), ch('US: MSG', 3), ch('US: MSG 2', 4), ch('US: MSG Buffalo', 5),
  ch('US: KTLA 5 Los Angeles', 6), ch('US: King of Queens', 7), ch('US: KING 5 Seattle NBC', 8), ch('CA: TSN 3', 9), ch('US: NESN', 10),
  ch('US: Altitude Sports', 11), ch('US: WFAA ABC 8 Dallas', 12), ch('US: Yes TV', 13),
];
const names = (league: string, name: string, short: string) => teamLocalChannels(league, { name, short }, lineup).map((x) => x.ch.originalName);

test('team local networks: each team finds its own channels', () => {
  assert.deepEqual(names('nba', 'Boston Celtics', 'Celtics'), ['US: NBC Sports Boston HD']);
  assert.deepEqual(names('nba', 'Brooklyn Nets', 'Nets'), ['US: YES Network']);
  assert.deepEqual(names('nba', 'New York Knicks', 'Knicks'), ['US: MSG']);
  assert.deepEqual(names('nhl', 'New Jersey Devils', 'Devils'), ['US: MSG 2', 'US: MSG']);
  assert.deepEqual(names('nhl', 'Buffalo Sabres', 'Sabres'), ['US: MSG Buffalo']);
  assert.deepEqual(names('nba', 'LA Clippers', 'Clippers'), ['US: KTLA 5 Los Angeles']);
  assert.deepEqual(names('nhl', 'Seattle Kraken', 'Kraken'), ['US: KING 5 Seattle NBC']);
  assert.deepEqual(names('nhl', 'Winnipeg Jets', 'Jets'), ['CA: TSN 3']);
  assert.deepEqual(names('nhl', 'Colorado Avalanche', 'Avalanche'), ['US: Altitude Sports']);
  assert.deepEqual(names('nba', 'Dallas Mavericks', 'Mavericks'), ['US: WFAA ABC 8 Dallas']);
  assert.equal(teamStations('nfl', { name: 'New York Jets', short: 'Jets' }).length, 0);
  assert.equal(teamStations('nba', { name: 'Portland Trail Blazers', short: 'Trail Blazers' })[0].label, 'KUNP');
});

import { channelsForBroadcast } from '../src/core/networks';

test('a local station the schedule names is found by its call sign', () => {
  const l = [ch('US: KTLA 5 Los Angeles HD', 1), ch('US: Peachtree Sports Network', 2), ch('US: KTLAX Movies', 3)];
  assert.deepEqual(channelsForBroadcast('KTLA', l).map((x) => x.ch.originalName), ['US: KTLA 5 Los Angeles HD']);
  assert.deepEqual(channelsForBroadcast('Peachtree Sports Network', l).map((x) => x.ch.originalName), ['US: Peachtree Sports Network']);
  assert.equal(channelsForBroadcast('Local TV', l).length, 0);
});

import { capStreams, type StreamPick } from '../src/core/streamfinder';

test('stream list: listed channels first, two per team, dead ones replaced by the next', () => {
  const p = (n: number, tier: number, side?: 'home' | 'away', broadcast?: string): StreamPick => ({ ch: ch(`C${n}`, n), score: 100 - n, kind: side ? 'local' : 'national', tier, side, broadcast, reason: '' });
  const ranked = [p(1, 0, undefined, 'ESPN'), p(2, 0, undefined, 'ESPN'), p(3, 0, undefined, 'ESPN'), p(4, 0, 'home', 'NESN'), p(5, 1), p(6, 2, 'home'), p(7, 2, 'home'), p(8, 2, 'away'), p(9, 2, 'away'), p(10, 2, 'away')];
  assert.deepEqual(capStreams(ranked).map((x) => x.ch.number), [1, 2, 4, 5, 6, 8, 9]);
  assert.deepEqual(capStreams(ranked, (k) => k === 'k8').map((x) => x.ch.number), [1, 2, 4, 5, 6, 9, 10]);
});

import { bestStreams } from '../src/core/streamfinder';

test('both teams get their channels: RSN, the network\'s station in each team\'s city', () => {
  const team = (name: string, short: string, location: string, abbr: string, side: string) => ({ id: abbr, name, short, location, abbr, side });
  const nhl = { id: 'g1', league: 'nhl', start: Date.now(), state: 'pre', detail: '', name: '', home: team('Boston Bruins', 'Bruins', 'Boston', 'BOS', 'home'), away: team('New York Rangers', 'Rangers', 'New York', 'NYR', 'away'), broadcasts: [] } as never;
  const l1 = [ch('US: NESN HD', 1), ch('US: MSG HD', 2), ch('US: ESPN', 3)];
  const sides1 = bestStreams(nhl, l1, 'hockey', []).map((p) => `${p.side}:${p.ch.originalName}`);
  assert.ok(sides1.includes('home:US: NESN HD') && sides1.includes('away:US: MSG HD'), sides1.join(','));
  const nfl = { id: 'g2', league: 'nfl', start: Date.now(), state: 'pre', detail: '', name: '', home: team('New England Patriots', 'Patriots', 'New England', 'NE', 'home'), away: team('Buffalo Bills', 'Bills', 'Buffalo', 'BUF', 'away'), broadcasts: [{ name: 'CBS', market: 'national', kind: 'tv' }] } as never;
  const l2 = [ch('US: CBS 4 Boston WBZ', 1), ch('US: CBS 4 Buffalo WIVB', 2), ch('US: CBS 2 Chicago', 3)];
  const sides2 = bestStreams(nfl, l2, 'football', []).map((p) => `${p.side ?? '-'}:${p.ch.originalName}`);
  assert.ok(sides2.includes('home:US: CBS 4 Boston WBZ') && sides2.includes('away:US: CBS 4 Buffalo WIVB'), sides2.join(','));
});

test('Kings game: NBC Sports California at the top, kept even if the check says dead', () => {
  const team = (name: string, short: string, location: string, abbr: string, side: string) => ({ id: abbr, name, short, location, abbr, side });
  const g = { id: 'g3', league: 'nba', start: Date.now(), state: 'pre', detail: '', name: '', home: team('Sacramento Kings', 'Kings', 'Sacramento', 'SAC', 'home'), away: team('Utah Jazz', 'Jazz', 'Utah', 'UTA', 'away'), broadcasts: [{ name: 'NBCS-CA', market: 'home', kind: 'tv' }, { name: 'KJZZ', market: 'away', kind: 'tv' }] } as never;
  const l = [ch('NBA 04: Jazz @ Kings', 1), ch('US: NBC Sports California HD', 2), ch('US: KJZZ 14', 3)];
  const idx = [{ ch: l[0], text: 'NBA 04: Jazz @ Kings', start: 0, stop: Infinity, event: true }];
  const ranked = bestStreams(g, l, 'basketball', idx as never);
  const shown = capStreams(ranked, (k) => k === 'k2').map((p) => p.ch.originalName);
  assert.deepEqual(shown.slice(0, 2), ['US: NBC Sports California HD', 'US: KJZZ 14']);
  assert.ok(shown.includes('NBA 04: Jazz @ Kings'));
});
