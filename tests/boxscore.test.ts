import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoxScore } from '../src/core/boxscore';
import { parseNflBox, smallHeadshot } from '../src/core/boxscore';

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

test('NFL box score: passing, rushing and receiving lines per team; small player photos', () => {
  const [cin] = parseNflBox({ boxscore: { players: [{ team: { abbreviation: 'CIN', shortDisplayName: 'Bengals' }, statistics: [
    { name: 'passing', labels: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACKS', 'QBR', 'RTG'], athletes: [{ athlete: { id: '3915511', displayName: 'Joe Burrow', jersey: '9', headshot: { href: 'https://a.espncdn.com/i/headshots/nfl/players/full/3915511.png' } }, stats: ['24/29', '271', '9.3', '3', '0', '2-6', '91.0', '140.1'] }] },
    { name: 'rushing', labels: ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], athletes: [{ athlete: { displayName: 'Chase Brown' }, stats: ['9', '57', '6.3', '0', '19'] }] },
    { name: 'fumbles', labels: ['FUM', 'LOST', 'REC'], athletes: [] },
  ] }] } });
  assert.equal(cin.name, 'Bengals');
  assert.deepEqual(cin.groups.map((g) => [g.title, g.head.join(' '), g.rows[0].name, g.rows[0].cells.join(' ')]), [['Passing', 'C/ATT YDS TD INT', 'Joe Burrow', '24/29 271 3 0'], ['Rushing', 'CAR YDS TD', 'Chase Brown', '9 57 0']]);
  assert.equal(cin.groups[0].rows[0].headshot, 'https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/3915511.png&w=96&h=70');
  assert.equal(smallHeadshot('https://elsewhere/x.png'), 'https://elsewhere/x.png');
});
