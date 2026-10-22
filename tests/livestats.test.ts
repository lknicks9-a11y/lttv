import { test } from 'node:test';
import assert from 'node:assert/strict';
import { betLabel, betProgress, diffNotices, fantasyPoints, parseRoster, parseSummary, type Bet } from '../src/core/livestats';

// Shaped like ESPN's summary feed (site.api.espn.com/.../summary?event=…).
function nflSummary(o: { state: string; sea: number; sf: number; recYds: string; rec: string; recTD: string; rushYds: string; plays: string[] }) {
  return {
    header: { id: '401', competitions: [{ id: '401', status: { type: { state: o.state, shortDetail: o.state === 'post' ? 'Final' : '2nd 4:12' } }, competitors: [
      { homeAway: 'home', score: String(o.sea), team: { id: '26', abbreviation: 'SEA', displayName: 'Seattle Seahawks', logos: [{ href: 'https://x/sea.png' }] } },
      { homeAway: 'away', score: String(o.sf), team: { id: '25', abbreviation: 'SF', displayName: 'San Francisco 49ers', logos: [{ href: 'https://x/sf.png' }] } },
    ] }] },
    boxscore: {
      teams: [
        { team: { id: '26' }, statistics: [{ name: 'totalYards', displayValue: '312', label: 'Total Yards' }, { name: 'firstDowns', displayValue: '18' }, { name: 'turnovers', displayValue: '1' }] },
        { team: { id: '25' }, statistics: [{ name: 'totalYards', displayValue: '280' }] },
      ],
      players: [{
        team: { id: '26', abbreviation: 'SEA' },
        statistics: [
          { name: 'passing', keys: ['completions/passingAttempts', 'passingYards', 'yardsPerPassAttempt', 'passingTouchdowns', 'interceptions', 'sacks-sackYardsLost', 'adjQBR', 'QBRating'],
            labels: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACKS', 'QBR', 'RTG'],
            athletes: [{ athlete: { id: '100', displayName: 'Sam Darnold', headshot: { href: 'https://x/100.png' } }, stats: ['20/30', '250', '8.3', '2', '1', '2-14', '60', '100'] }] },
          { name: 'rushing', keys: ['rushingAttempts', 'rushingYards', 'yardsPerRushAttempt', 'rushingTouchdowns', 'longRushing'],
            athletes: [{ athlete: { id: '200', displayName: 'Kenneth Walker III' }, stats: ['15', o.rushYds, '4.2', '0', '12'] }] },
          { name: 'receiving', keys: ['receptions', 'receivingYards', 'yardsPerReception', 'receivingTouchdowns', 'longReception', 'receivingTargets'],
            athletes: [{ athlete: { id: '300', displayName: 'Jaxon Smith-Njigba' }, stats: [o.rec, o.recYds, '10', o.recTD, '30', '9'] }] },
          { name: 'interceptions', keys: ['interceptions', 'interceptionYards', 'interceptionTouchdowns'], athletes: [] },
        ],
      }],
    },
    drives: { previous: [{ plays: o.plays.map((t, i) => ({ id: String(i), text: t, scoringPlay: /touchdown/i.test(t) })) }] },
  };
}

test('NFL summary: players, team stats, score and plays are read', () => {
  const g = parseSummary(nflSummary({ state: 'in', sea: 14, sf: 10, recYds: '61', rec: '5', recTD: '1', rushYds: '63', plays: ['S.Darnold pass short right to J.Smith-Njigba for 12 yards'] }), 'football');
  assert.equal(g.state, 'in');
  assert.equal(g.teams.find((t) => t.id === '26')?.score, 14);
  assert.equal(g.teams.find((t) => t.id === '26')?.stats.totalYds, 312);
  const qb = g.players.get('100')!;
  assert.deepEqual([qb.stats.completions, qb.stats.passAtt, qb.stats.passYds, qb.stats.passTD, qb.stats.int, qb.stats.sacked], [20, 30, 250, 2, 1, 2]);
  assert.equal(g.players.get('300')!.stats.recYds, 61);
  assert.equal(g.plays.length, 1);
  // PPR: 250/25 + 2*4 - 2 = 16 for the QB; WR: 5 + 6.1 + 6 = 17.1
  assert.equal(fantasyPoints(qb.stats, 'football'), 16);
  assert.equal(fantasyPoints(g.players.get('300')!.stats, 'football', 'ppr'), 17.1);
  assert.equal(fantasyPoints(g.players.get('300')!.stats, 'football', 'standard'), 12.1);
});

test('Props: over 74.5 receiving yards moves, then hits; under loses; spread and game total', () => {
  const bet: Bet = { id: 'b1', kind: 'player', league: 'nfl', prop: 'recYds', line: 74.5, side: 'over', teamId: '26', teamName: 'Seattle Seahawks', athleteId: '300', athleteName: 'Jaxon Smith-Njigba', createdAt: 0 };
  const under: Bet = { ...bet, id: 'b2', side: 'under' };
  const spread: Bet = { id: 'b3', kind: 'team', league: 'nfl', prop: 'spread', line: -3.5, side: 'over', teamId: '26', teamName: 'Seattle Seahawks', createdAt: 0 };
  const total: Bet = { id: 'b4', kind: 'team', league: 'nfl', prop: 'gameTotal', line: 44.5, side: 'over', teamId: '26', teamName: 'Seattle Seahawks', createdAt: 0 };
  const g1 = parseSummary(nflSummary({ state: 'in', sea: 14, sf: 10, recYds: '61', rec: '5', recTD: '1', rushYds: '63', plays: ['a'] }), 'football');
  const g2 = parseSummary(nflSummary({ state: 'in', sea: 21, sf: 10, recYds: '83', rec: '6', recTD: '2', rushYds: '63', plays: ['a', 'S.Darnold pass deep left to J.Smith-Njigba for 22 yards, TOUCHDOWN.'] }), 'football');
  assert.deepEqual(betProgress(bet, g1, 'football'), { value: 61, status: 'live' });
  assert.deepEqual(betProgress(bet, g2, 'football'), { value: 83, status: 'hit' });
  assert.equal(betProgress(under, g2, 'football').status, 'lost');
  assert.equal(betProgress(spread, g2, 'football').status, 'live');
  const fin = parseSummary(nflSummary({ state: 'post', sea: 24, sf: 23, recYds: '83', rec: '6', recTD: '2', rushYds: '63', plays: ['x'] }), 'football');
  assert.equal(betProgress(spread, fin, 'football').status, 'lost'); // won by 1, needed 4
  assert.equal(betProgress(total, fin, 'football').status, 'hit'); // 47 > 44.5
  // Pop-ups: fantasy points (with the play that did it and his picture / team logo)…
  const fant = diffNotices(g1, g2, 'football', { roster: [{ athleteId: '300', name: 'Jaxon Smith-Njigba' }], bets: [], leagueHeadshot: 'nfl' });
  assert.equal(fant.length, 1);
  assert.match(fant[0].title, /Jaxon Smith-Njigba \+9\.2 fantasy pts/);
  assert.match(fant[0].play ?? '', /TOUCHDOWN/);
  assert.equal(fant[0].logo, 'https://x/sea.png');
  assert.equal(fant[0].headshot, 'https://a.espncdn.com/i/headshots/nfl/players/full/300.png');
  // …but a player you also bet on gets only the bet's pop-ups (no doubled fantasy ones).
  const notes = diffNotices(g1, g2, 'football', { roster: [{ athleteId: '300', name: 'Jaxon Smith-Njigba' }], bets: [bet], leagueHeadshot: 'nfl' });
  assert.equal(notes.length, 1);
  assert.match(notes[0].title, /^BET HIT: Jaxon Smith-Njigba over 74\.5 receiving yards/);
  assert.equal(diffNotices(undefined, g2, 'football', { roster: [], bets: [bet] }).length, 0);
});

test('NBA points bet: the pop-up shows the basket, not the player\'s turnover; a stat corrected down stays quiet', () => {
  const box = (pts: string, to: string, plays: string[]) => ({
    header: { competitions: [{ status: { type: { state: 'in' } }, competitors: [{ score: '55', team: { id: '18', abbreviation: 'NY' } }, { score: '50', team: { id: '2', abbreviation: 'BOS' } }] }] },
    boxscore: { players: [{ team: { id: '18' }, statistics: [{ keys: ['minutes', 'points', 'turnovers'], athletes: [{ athlete: { id: '9', displayName: 'Jalen Brunson' }, stats: ['20', pts, to] }] }] }] },
    plays: plays.map((t, i) => ({ id: String(i), text: t, scoringPlay: /makes/.test(t), participants: [{ athlete: { id: '9' } }] })),
  });
  const bet: Bet = { id: 'p', kind: 'player', league: 'nba', prop: 'pts', line: 25.5, side: 'over', teamId: '18', teamName: 'Knicks', athleteId: '9', athleteName: 'Jalen Brunson', createdAt: 0 };
  const a = parseSummary(box('18', '1', ['x']), 'basketball');
  const b = parseSummary(box('20', '2', ['Jalen Brunson makes 12-foot jumper', 'Jalen Brunson bad pass (turnover)']), 'basketball');
  const n = diffNotices(a, b, 'basketball', { roster: [{ athleteId: '9', name: 'Jalen Brunson' }], bets: [bet] });
  assert.equal(n.length, 1);
  assert.match(n[0].title, /Jalen Brunson: 20 pts/);
  assert.match(n[0].play ?? '', /makes 12-foot jumper/);
  const down = parseSummary(box('19', '2', ['y']), 'basketball');
  assert.equal(diffNotices(b, down, 'basketball', { roster: [], bets: [bet] }).length, 0);
});

test('NBA summary: points, rebounds, assists and PRA; roster parsing (grouped and flat)', () => {
  const g = parseSummary({
    header: { competitions: [{ status: { type: { state: 'in' } }, competitors: [{ score: '55', team: { id: '18', abbreviation: 'NY' } }, { score: '50', team: { id: '2', abbreviation: 'BOS' } }] }] },
    boxscore: { players: [{ team: { id: '18' }, statistics: [{ keys: ['minutes', 'points', 'fieldGoalsMade-fieldGoalsAttempted', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'freeThrowsMade-freeThrowsAttempted', 'rebounds', 'assists', 'turnovers', 'steals', 'blocks'],
      athletes: [{ athlete: { id: '9', displayName: 'Jalen Brunson' }, stats: ['20', '18', '7-12', '2-5', '2-2', '3', '6', '2', '1', '0'] }] }] }] },
    plays: [{ id: '1', text: 'Jalen Brunson makes 25-foot three point jumper', participants: [{ athlete: { id: '9' } }] }],
  }, 'basketball');
  const p = g.players.get('9')!.stats;
  assert.deepEqual([p.pts, p.reb, p.ast, p.tpm, p.fga], [18, 3, 6, 2, 12]);
  assert.equal(fantasyPoints(p, 'basketball'), 18 + 3.6 + 9 + 3 - 2);
  const bet: Bet = { id: 'n', kind: 'player', league: 'nba', prop: 'pra', line: 25.5, side: 'over', teamId: '18', teamName: 'Knicks', athleteId: '9', athleteName: 'Jalen Brunson', createdAt: 0 };
  assert.deepEqual(betProgress(bet, g, 'basketball'), { value: 27, status: 'hit' });
  assert.equal(parseRoster({ athletes: [{ position: 'offense', items: [{ id: '1', displayName: 'A B', position: { abbreviation: 'WR' } }] }] })[0].position, 'WR');
  assert.equal(parseRoster({ athletes: [{ id: '2', displayName: 'C D', position: { abbreviation: 'G' } }] })[0].name, 'C D');
});

import { parlayStatus, diffNotices as diffNotices2 } from '../src/core/livestats';

test('parlay status: all legs must hit, one loss loses, pushes drop out', () => {
  assert.equal(parlayStatus(['hit', 'hit']).status, 'hit');
  assert.equal(parlayStatus(['hit', 'live']).status, 'live');
  assert.equal(parlayStatus(['hit', 'lost', 'live']).status, 'lost');
  assert.equal(parlayStatus(['hit', 'push']).status, 'hit');
  assert.equal(parlayStatus(['push', 'push']).status, 'push');
  assert.equal(parlayStatus(['pending', 'pending']).status, 'pending');
  assert.equal(parlayStatus(['hit', 'pending', 'live']).hit, 1);
});

test('team bets: every score change becomes a pop-up with the score line', () => {
  const team = (id: string, abbr: string, score: number, homeAway: 'home' | 'away') => ({ id, abbr, name: abbr, score, stats: {}, homeAway, logo: `${abbr}.png` });
  const g = (sea: number) => ({ id: 'g', state: 'in' as const, detail: '3rd 9:40', teams: [team('26', 'SEA', sea, 'home'), team('25', 'SF', 10, 'away')], players: new Map(), plays: [{ id: '1', text: 'TD pass', teamId: '26', athleteIds: [], scoring: true }] });
  const bet = { id: 'b', kind: 'team' as const, league: 'nfl' as const, prop: 'points', line: 24.5, side: 'over' as const, teamId: '26', teamName: 'Seahawks', createdAt: 0 };
  const n = diffNotices2(g(14), g(21), 'football', { roster: [], bets: [bet] });
  const score = n.find((x) => x.kind === 'score');
  assert.equal(score?.title, 'SF 10 – 21 SEA');
  assert.match(score?.detail ?? '', /SEA \+7/);
  assert.equal(score?.logo, 'SEA.png');
  assert.equal(diffNotices2(g(14), g(21), 'football', { roster: [], bets: [{ ...bet, kind: 'player', athleteId: '1' }] }).some((x) => x.kind === 'score'), false);
});

test('MLB box score (by column label): hitter and pitcher props; NHL skater / goalie; soccer rosters', () => {
  const hdr = (s1: string, s2: string, state = 'in') => ({ competitions: [{ status: { type: { state } }, competitors: [{ score: s1, homeAway: 'home', team: { id: '10', abbreviation: 'NYY' } }, { score: s2, homeAway: 'away', team: { id: '2', abbreviation: 'BOS' } }] }] });
  const mlb = parseSummary({ header: hdr('5', '3'), boxscore: { players: [{ team: { id: '10' }, statistics: [
    { name: 'batting', labels: ['H-AB', 'AB', 'R', 'H', 'RBI', 'HR', 'BB', 'K'], athletes: [{ athlete: { id: '1', displayName: 'Aaron Judge' }, stats: ['2-4', '4', '1', '2', '3', '1', '0', '1'] }] },
    { name: 'pitching', labels: ['IP', 'H', 'R', 'ER', 'BB', 'K', 'HR'], athletes: [{ athlete: { id: '2', displayName: 'Gerrit Cole' }, stats: ['6.1', '4', '2', '2', '1', '9', '1'] }] },
  ] }] } }, 'baseball');
  const judge = mlb.players.get('1')!.stats;
  assert.equal(judge.hits, 2); assert.equal(judge.hr, 1); assert.equal(judge.rbi, 3); assert.equal(judge.kBat, 1);
  const cole = mlb.players.get('2')!.stats;
  assert.equal(cole.kPitch, 9); assert.equal(cole.outs, 19); assert.equal(cole.er, 2); assert.equal(cole.kBat, undefined);
  const nhl = parseSummary({ header: hdr('2', '1'), boxscore: { players: [{ team: { id: '10' }, statistics: [
    { name: 'forwards', labels: ['G', 'A', '+/-', 'S', 'BS', 'HT'], athletes: [{ athlete: { id: '8', displayName: 'Skater' }, stats: ['1', '1', '2', '5', '1', '3'] }] },
    { name: 'goalies', labels: ['GA', 'SA', 'SV'], athletes: [{ athlete: { id: '9', displayName: 'Goalie' }, stats: ['1', '30', '29'] }] },
  ] }] } }, 'hockey');
  assert.deepEqual([nhl.players.get('8')!.stats.goals, nhl.players.get('8')!.stats.shots, nhl.players.get('9')!.stats.saves], [1, 5, 29]);
  const soc = parseSummary({ header: hdr('2', '0'), rosters: [{ team: { id: '10' }, roster: [{ athlete: { id: '7', displayName: 'Striker' }, stats: [{ name: 'totalGoals', value: 1 }, { name: 'goalAssists', value: 1 }, { name: 'shotsOnTarget', value: 3 }] }] }],
    keyEvents: [{ id: 'k1', text: 'Goal! Striker scores.', scoringPlay: true, participants: [{ athlete: { id: '7' } }] }] }, 'soccer');
  assert.deepEqual([soc.players.get('7')!.stats.goals, soc.players.get('7')!.stats.sot], [1, 3]);
  assert.equal(soc.plays[0]?.scoring, true);
});

test('Moneyline: wins at the final whistle, a draw loses in soccer and pushes elsewhere', () => {
  const g = (a: number, b: number, state: string) => ({ id: 'x', state, detail: '', teams: [{ id: '10', abbr: 'A', name: 'A', score: a, stats: {}, homeAway: 'home' }, { id: '2', abbr: 'B', name: 'B', score: b, stats: {}, homeAway: 'away' }], players: new Map(), plays: [] }) as never;
  const ml = (league: string): Bet => ({ id: 'm', kind: 'team', league: league as never, prop: 'moneyline', line: 0, side: 'over', teamId: '10', teamName: 'A', createdAt: 0 });
  assert.equal(betProgress(ml('nba'), g(100, 98, 'in'), 'basketball').status, 'live');
  assert.equal(betProgress(ml('nba'), g(100, 98, 'post'), 'basketball').status, 'hit');
  assert.equal(betProgress(ml('nhl'), g(1, 3, 'post'), 'hockey').status, 'lost');
  assert.equal(betProgress(ml('epl'), g(1, 1, 'post'), 'soccer').status, 'lost');
  assert.equal(betProgress(ml('nfl'), g(20, 20, 'post'), 'football').status, 'push');
  assert.equal(betLabel(ml('nba'), 'basketball'), 'A moneyline (to win)');
});
