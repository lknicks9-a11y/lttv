import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoxScore } from '../src/core/boxscore';

test('box score: players with PTS/REB/AST/BLK, starters first', () => {
  const json = { boxscore: { players: [{ team: { abbreviation: 'CLE', shortDisplayName: 'Cavaliers' }, statistics: [{ labels: ['MIN', 'PTS', 'FG', 'REB', 'AST', 'STL', 'BLK'], athletes: [
    { athlete: { shortName: 'K. Ellis', jersey: '14' }, starter: false, stats: ['8', '0', '0-1', '0', '0', '0', '0'] },
    { athlete: { shortName: 'J. Allen', jersey: '31', headshot: { href: 'https://x/a.png' } }, starter: true, stats: ['10', '2', '1-2', '6', '2', '0', '2'] },
    { athlete: { shortName: 'T. Bryant', jersey: '3' }, starter: false, didNotPlay: true, stats: [] },
  ] }] }] } };
  const [cle] = parseBoxScore(json);
  assert.equal(cle.name, 'Cavaliers');
  assert.deepEqual(cle.players.map((p) => `${p.name} ${p.pts}/${p.reb}/${p.ast}/${p.blk}${p.starter ? '*' : ''}`), ['J. Allen 2/6/2/2*', 'K. Ellis 0/0/0/0', 'T. Bryant 0/0/0/0']);
});
