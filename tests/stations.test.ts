import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelsForBroadcast } from '../src/core/networks';

const ch = (n: string, i: number) => ({ key: `k${i}`, originalName: n, name: n, group: 'USA Locals', number: i, hidden: false }) as never;
const names = (b: string, l: never[]) => channelsForBroadcast(b, l).map((x) => (x.ch as { originalName: string }).originalName);

test('local stations by affiliate and city, not only call sign', () => {
  const l = [ch('US: MyNetworkTV Oklahoma City', 1), ch('US: MY 52 OKC', 2), ch('US: MyNetworkTV Tulsa', 3), ch('US: CW 19 Tulsa', 4), ch('US: Charlotte 64', 5), ch('US: NBC 4 San Antonio', 6), ch('US: NBC 4 New York', 7), ch('US: KARE 11 NBC Minneapolis', 8), ch('US: My 24 Milwaukee', 9), ch('US: FOX 59 Indianapolis', 10), ch('US: FOX Sports 1', 11)];
  assert.deepEqual(names('KSBI-IND', l), ['US: MyNetworkTV Oklahoma City', 'US: MY 52 OKC']);
  assert.deepEqual(names('KQCW', l), ['US: CW 19 Tulsa']);
  assert.deepEqual(names('WAXN', l), ['US: Charlotte 64']);
  assert.deepEqual(names('WOAI', l), ['US: NBC 4 San Antonio']);
  assert.deepEqual(names('KARE', l), ['US: KARE 11 NBC Minneapolis']);
  assert.deepEqual(names('WCGV', l), ['US: My 24 Milwaukee']);
  assert.deepEqual(names('WXIN', l), ['US: FOX 59 Indianapolis']);
});
