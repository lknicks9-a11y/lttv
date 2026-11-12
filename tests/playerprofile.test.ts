import { test } from 'node:test';
import assert from 'node:assert/strict';
import { athleteUrls, parseBio, parseGamelog, parseOverview, parseSeasons } from '../src/core/playerprofile';

// Shapes as the live service sent them (Nov 2026), cut down.
test('player page: bio, averages, awards, game log and seasons', () => {
  assert.equal(athleteUrls('3112335').gamelog, 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/3112335/gamelog');
  const bio = parseBio({ athlete: { displayName: 'Nikola Jokic', jersey: '15', position: { displayName: 'Center' }, team: { displayName: 'Denver Nuggets' }, headshot: { href: 'h.png' }, displayHeight: '6\' 11"', displayWeight: '284 lbs', displayDOB: '19/2/1995', age: 31, displayBirthPlace: 'Sombor, Serbia', displayDraft: '2014: Rd 2, Pk 41 (DEN)', displayExperience: '12th Season' } })!;
  assert.equal(bio.name, 'Nikola Jokic');
  assert.deepEqual(bio.facts.find(([k]) => k === 'Born'), ['Born', 'Feb 19, 1995 (age 31)']);
  assert.ok(!bio.facts.some(([k]) => k === 'College'));

  const ov = parseOverview({ statistics: { labels: ['GP', 'PTS'], splits: [{ displayName: 'Regular Season', stats: ['9', '23.1'] }, { displayName: 'Career', stats: ['819', '22.2'] }] }, awards: [{ name: 'MVP', displayCount: '3x' }] });
  assert.deepEqual(ov.lines.map((l) => [l.title, l.stats[1]]), [['Regular Season', '23.1'], ['Career', '22.2']]);
  assert.deepEqual(ov.awards, [{ name: 'MVP', count: '3x' }]);

  const gl = parseGamelog({
    labels: ['MIN', 'PTS'],
    events: { a: { gameDate: '2026-11-08T02:00:00.000+00:00', atVs: 'vs', gameResult: 'W', score: '120-110', opponent: { abbreviation: 'LAL' } }, b: { gameDate: '2026-10-31T02:00:00.000+00:00', atVs: '@', gameResult: 'L', score: '99-101', opponent: { abbreviation: 'PHX' } }, p: { gameDate: '2026-10-10T02:00:00.000+00:00', atVs: '@', gameResult: 'W', score: '1-0', opponent: { abbreviation: 'UTA' } } },
    seasonTypes: [{ displayName: '2026-27 Regular Season', categories: [{ events: [{ eventId: 'b', stats: ['30', '19'] }] }, { events: [{ eventId: 'a', stats: ['39', '25'] }] }] }, { displayName: '2026-27 Preseason', categories: [{ events: [{ eventId: 'p', stats: ['10', '4'] }] }] }],
  });
  assert.deepEqual(gl.games.map((g) => `${g.at ? '@' : 'vs'} ${g.opp} ${g.result} ${g.stats[1]}`), ['vs LAL W 25', '@ PHX L 19']);

  const se = parseSeasons({ teams: { 'denver-nuggets': { abbreviation: 'DEN' } }, categories: [{ name: 'averages', labels: ['GP', 'PTS'], statistics: [{ teamSlug: 'denver-nuggets', season: { displayName: '2015-16' }, stats: ['80', '10.0'] }], totals: ['819', '22.2'] }, { name: 'totals', labels: [], statistics: [] }] });
  assert.deepEqual(se.seasons, [{ season: '2015-16', team: 'DEN', stats: ['80', '10.0'] }]);
  assert.deepEqual(se.career, ['819', '22.2']);
});
