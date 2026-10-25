import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rsnChannels, teamForGame, TEAM_RSN } from '../src/core/rsn';
import { bestStreams, isDefunctNetwork } from '../src/core/streamfinder';
import { buildLineup } from '../src/core/organize';
import { allTeams } from '../src/core/teams';
import type { Game } from '../src/core/schedule';
import type { ParsedChannel } from '../src/core/types';

function lineupOf(names: string[]) {
  const chans: ParsedChannel[] = names.map((n, i) => ({ key: 'k' + i, playlistId: 'p', index: i, originalName: n, groupTitle: 'USA Sports', url: `http://h/live/u/p/${i}.ts` }));
  return buildLineup({ channels: chans, customizations: new Map(), matches: new Map() });
}
const LINEUP = lineupOf([
  'US: MSG', 'US: MSG SportsNet', 'US: Marquee Sports Network', 'US: YES Network FHD', 'US: YES Network SD', 'US: SNY',
  'US: Space City Home Network', 'US: ESPN', 'US: ESPN Deportes', 'US: NBC Sports Boston', 'US: Altitude Sports',
  'US: FanDuel Sports Network Detroit HD', 'US: Bally Sports Ohio',
]);
const names = (team: string) => rsnChannels(team, LINEUP).map((x) => x.ch.originalName);
const team = (name: string, short: string, abbr: string) => ({ id: abbr, name, short, abbr, score: '0' }) as unknown as Game['home'];
const game = (league: string, home: Game['home'], away: Game['away'], broadcasts: Game['broadcasts'], start = Date.now()): Game => ({ id: 'g', league, home, away, broadcasts, start, state: 'pre', detail: '' }) as unknown as Game;
const knicks = () => team('New York Knicks', 'Knicks', 'NY');
const celtics = () => team('Boston Celtics', 'Celtics', 'BOS');

test('the built-in team list covers every team that still has a regional network; none point at FanDuel / Bally', () => {
  const teams = allTeams().filter((t) => ['mlb', 'nba', 'nhl', 'wnba'].includes(t.league));
  assert.equal(teams.length, 107);
  for (const t of teams) assert.ok(Array.isArray(TEAM_RSN[t.id]), t.id);
  for (const list of Object.values(TEAM_RSN)) for (const n of list) assert.ok(!isDefunctNetwork(n), n);
  assert.ok(isDefunctNetwork('US: FanDuel Sports Network Detroit HD') && isDefunctNetwork('Bally Sports Ohio') && isDefunctNetwork('FDSN Detroit'));
  assert.ok(!isDefunctNetwork('US: ESPN') && !isDefunctNetwork('MSG'));
});

test('team regional networks are found under playlist names (MSG vs MSG SportsNet, best quality first)', () => {
  assert.deepEqual(names('nba:nyk'), ['US: MSG']);
  assert.deepEqual(names('nhl:njd'), ['US: MSG SportsNet']);
  assert.deepEqual(names('mlb:chc'), ['US: Marquee Sports Network']);
  assert.equal(names('mlb:nyy')[0], 'US: YES Network FHD');
  assert.deepEqual(names('nba:hou'), ['US: Space City Home Network']);
  assert.deepEqual(names('nhl:col'), ['US: Altitude Sports']);
  assert.deepEqual(names('nba:det'), []); // was FanDuel: no built-in entry any more
  assert.equal(teamForGame('nba', { abbr: 'NY', name: 'New York Knicks', short: 'Knicks' })?.id, 'nba:nyk');
});

test('regional networks go to the top of a game; national-only games don\'t push them; FanDuel / Bally never offered', () => {
  const g = game('nba', knicks(), celtics(), []);
  assert.deepEqual(bestStreams(g, LINEUP, 'basketball', []).map((p) => p.ch.originalName).slice(0, 2), ['US: MSG', 'US: NBC Sports Boston']);
  const nat = game('nba', knicks(), celtics(), [{ name: 'ESPN', market: 'national', kind: 'tv' }]);
  const n = bestStreams(nat, LINEUP, 'basketball', []).map((p) => p.ch.originalName);
  assert.equal(n[0], 'US: ESPN');
  assert.ok(!n.includes('US: MSG') && !n.includes('US: ESPN Deportes'));
  // ESPN still listing the old network for a game: its channels stay out.
  const old = game('nba', team('Detroit Pistons', 'Pistons', 'DET'), team('Cleveland Cavaliers', 'Cavaliers', 'CLE'), [{ name: 'FDSN Detroit', market: 'home', kind: 'tv' }, { name: 'FDSN Ohio', market: 'away', kind: 'tv' }]);
  assert.ok(!bestStreams(old, LINEUP, 'basketball', []).some((p) => isDefunctNetwork(p.ch.originalName)));
});

test('a team channel goes on top only when tonight\'s guide shows the game; otherwise the game is found elsewhere', () => {
  const lineup = lineupOf(['US: MSG', 'US: NBC Sports Boston', 'NBA 03: Celtics @ Knicks']);
  const [msg, nbcsb, evt] = lineup;
  const start = Date.UTC(2026, 10, 1, 23, 30);
  const g = game('nba', knicks(), celtics(), [{ name: 'MSG', market: 'home', kind: 'tv' }, { name: 'NBC Sports Boston', market: 'away', kind: 'tv' }], start);
  const index = [
    { ch: msg, text: 'NBA Basketball: Celtics at Knicks', start: start - 30 * 60_000, stop: start + 3 * 3600_000, event: false },
    { ch: nbcsb, text: 'Bruins Postgame Live', start: start - 3600_000, stop: start + 2 * 3600_000, event: false },
    { ch: evt, text: evt.originalName, start: start - 3600_000, stop: start + 5 * 3600_000, event: true },
  ];
  const list = bestStreams(g, lineup, 'basketball', index);
  assert.equal(list[0].ch.key, msg.key);
  assert.match(list[0].reason, /on tonight/);
  assert.ok(list.findIndex((p) => p.ch.key === evt.key) < list.findIndex((p) => p.ch.key === nbcsb.key));
  assert.match(list.find((p) => p.ch.key === nbcsb.key)!.reason, /not this game/);
});
