import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rsnChannels, teamForGame, TEAM_RSN } from '../src/core/rsn';
import { bestStreams } from '../src/core/streamfinder';
import { buildLineup } from '../src/core/organize';
import { allTeams } from '../src/core/teams';
import type { Game } from '../src/core/schedule';
import type { ParsedChannel } from '../src/core/types';

function lineupOf(names: string[]) {
  const chans: ParsedChannel[] = names.map((n, i) => ({ key: 'k' + i, playlistId: 'p', index: i, originalName: n, groupTitle: 'USA Sports', url: `http://h/live/u/p/${i}.ts` }));
  return buildLineup({ channels: chans, customizations: new Map(), matches: new Map() });
}
const LINEUP = lineupOf([
  'US: FanDuel Sports Network Detroit HD', 'US: Bally Sports Ohio', 'US: MSG', 'US: MSG SportsNet', 'US: Marquee Sports Network',
  'US: YES Network FHD', 'US: SNY', 'US: Space City Home Network', 'US: ESPN', 'US: ESPN Deportes', 'US: NBC Sports Philadelphia',
  'US: FanDuel Sports Network Detroit SD', 'US: Altitude Sports',
]);
const names = (team: string) => rsnChannels(team, LINEUP).map((x) => x.ch.originalName);

test('every MLB, NBA, NHL and WNBA team has a local TV entry', () => {
  const teams = allTeams().filter((t) => ['mlb', 'nba', 'nhl', 'wnba'].includes(t.league));
  assert.equal(teams.length, 107);
  for (const t of teams) assert.ok(TEAM_RSN[t.id]?.length, t.id);
});

test('team regional networks are found under playlist names (FanDuel / Bally, MSG vs MSG SportsNet)', () => {
  assert.equal(names('mlb:det')[0], 'US: FanDuel Sports Network Detroit HD'); // HD before SD
  assert.deepEqual(names('nba:cle'), ['US: Bally Sports Ohio']);
  assert.deepEqual(names('nba:nyk'), ['US: MSG']);
  assert.deepEqual(names('nhl:njd'), ['US: MSG SportsNet']);
  assert.deepEqual(names('mlb:chc'), ['US: Marquee Sports Network']);
  assert.deepEqual(names('nba:hou'), ['US: Space City Home Network']);
  assert.deepEqual(names('nhl:col'), ['US: Altitude Sports']);
  assert.equal(teamForGame('nba', { abbr: 'NY', name: 'New York Knicks', short: 'Knicks' })?.id, 'nba:nyk');
});

const team = (name: string, short: string, abbr: string) => ({ id: abbr, name, short, abbr, score: '0' }) as unknown as Game['home'];
const game = (league: string, home: Game['home'], away: Game['away'], broadcasts: Game['broadcasts']): Game => ({ id: 'g', league, home, away, broadcasts, start: Date.now(), state: 'pre', detail: '' }) as unknown as Game;

test('regional networks go to the top of a game, filled in from the team list when ESPN lists none', () => {
  // ESPN lists no TV at all: both teams' regional networks from the built-in list, home first, above ESPN.
  const g = game('nba', team('Detroit Pistons', 'Pistons', 'DET'), team('Cleveland Cavaliers', 'Cavaliers', 'CLE'), []);
  const top = bestStreams(g, LINEUP, 'basketball', []).map((p) => p.ch.originalName);
  assert.deepEqual(top.slice(0, 2), ['US: FanDuel Sports Network Detroit HD', 'US: Bally Sports Ohio']);
  // National exclusive (ESPN only): the regional networks aren't showing the game, so they aren't pushed.
  const nat = game('nba', team('Detroit Pistons', 'Pistons', 'DET'), team('Cleveland Cavaliers', 'Cavaliers', 'CLE'), [{ name: 'ESPN', market: 'national', kind: 'tv' }]);
  const n = bestStreams(nat, LINEUP, 'basketball', []).map((p) => p.ch.originalName);
  assert.equal(n[0], 'US: ESPN');
  assert.ok(!n.includes('US: Bally Sports Ohio'));
  assert.ok(!n.includes('US: ESPN Deportes'));
});
