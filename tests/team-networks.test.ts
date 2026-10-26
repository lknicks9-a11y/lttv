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
