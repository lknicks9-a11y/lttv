import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEAMS, LEAGUES, allTeams, customToTeam } from '../src/core/teams';
import { buildMatchers, teamMention, sportsText, findTeamListings, teamChannels, isGameListing } from '../src/core/sports';
import { GuideIndex } from '../src/core/guide';
import type { LineupChannel } from '../src/core/types';

const T = (id: string) => TEAMS.find((t) => t.id === id)!;
const m1 = (id: string) => buildMatchers([T(id)])[0];
const mention = (id: string, title: string, ctx = '') => teamMention(m1(id), sportsText(title), sportsText(ctx));

test('catalog is complete and ids are unique', () => {
  const count = (l: string) => TEAMS.filter((t) => t.league === l).length;
  assert.equal(count('nfl'), 32);
  assert.equal(count('nba'), 30);
  assert.equal(count('mlb'), 30);
  assert.equal(count('nhl'), 32);
  assert.equal(count('mls'), 30);
  assert.equal(new Set(TEAMS.map((t) => t.id)).size, TEAMS.length);
  assert.ok(TEAMS.every((t) => LEAGUES.some((l) => l.id === t.league)));
});

test('full team names match on their own', () => {
  assert.equal(mention('nfl:nyg', 'NFL Football: New York Giants at Philadelphia Eagles'), 2);
  assert.equal(mention('epl:mun', 'Premier League: Man Utd v Arsenal'), 2);
  assert.equal(mention('nba:lal', 'Los Angeles Lakers at Boston Celtics'), 2);
});

test('ambiguous nicknames need league context or a same-league opponent', () => {
  // "Giants" is both an NFL and an MLB team
  assert.equal(mention('nfl:nyg', 'Giants Postgame'), 0);
  assert.equal(mention('nfl:nyg', 'Giants vs Eagles'), 1, 'Eagles is an NFL opponent');
  assert.equal(mention('mlb:sf', 'Giants vs Eagles'), 0, 'not an MLB game');
  assert.equal(mention('mlb:sf', 'Giants at Dodgers'), 1);
  assert.equal(mention('nfl:nyg', 'Giants Pregame', 'NFL Football'), 1);
});

test('everyday-word nicknames do not match ordinary programmes', () => {
  assert.equal(mention('nba:mia', 'The Heat of the Night'), 0);
  assert.equal(mention('wnba:chi', 'Sky Sports News'), 0);
  assert.equal(mention('nba:mia', 'Heat vs Knicks'), 1);
  assert.equal(mention('nba:mia', 'Heat Live', 'NBA Basketball'), 1);
  assert.equal(mention('nhl:min', 'Wild Kingdom'), 0);
});

test('custom teams match their own keywords', () => {
  const c = customToTeam({ id: 'custom:state-u', name: 'State University', aliases: ['State U'] });
  const m = buildMatchers([c], allTeams([]))[0];
  assert.equal(teamMention(m, sportsText('College Football: State U at Tech'), ' '), 2);
  assert.equal(c.abbr, 'SU');
});

test('game detection', () => {
  assert.equal(isGameListing({ title: 'Lakers @ Celtics' }), true);
  assert.equal(isGameListing({ title: 'NBA Today' }), false);
  assert.equal(isGameListing({ title: 'Premier League', subTitle: 'Arsenal v Chelsea' }), true);
  assert.equal(isGameListing({ title: 'Big Match', live: true }), true);
});

function ch(key: string, name: string, number: number, extra: Partial<LineupChannel> = {}): LineupChannel {
  return {
    key, playlistId: 'p', index: number, number, name, originalName: name, cleanedName: name, url: 'http://x/' + key,
    category: 'sports', categoryEvidence: 'group', favorite: false, hidden: false, order: number,
    epgChannelId: 'e|' + key, matchStatus: 'auto', matchMethod: 'tvg-id', matchConfidence: 1, ...extra,
  };
}

test('finds live and upcoming games in the guide, grouped across channels', () => {
  const now = Date.parse('2026-10-18T17:30:00Z');
  const h = 3600_000;
  const lineup = [ch('a', 'Sports One', 10), ch('b', 'Sports One HD', 11, { favorite: true }), ch('c', 'News 24', 20, { category: 'news' }), ch('d', 'Movies', 30, { matchStatus: 'pending' })];
  const g = new GuideIndex();
  const game = { ch: 'a', start: now - h, stop: now + 2 * h, title: 'NFL Football', subTitle: 'New York Giants at Dallas Cowboys', categories: ['Sports', 'Football'] };
  g.set('e|a', [game, { ch: 'a', start: now + 2 * h, stop: now + 3 * h, title: 'Giants Postgame', categories: ['Sports', 'Football'] }, { ch: 'a', start: now + 3 * h, stop: now + 4 * h, title: 'Giants Talk', categories: ['Sports'] }]);
  g.set('e|b', [{ ...game, ch: 'b' }]);
  g.set('e|c', [{ ch: 'c', start: now, stop: now + h, title: 'Evening News', desc: 'Including the New York Giants injury report.' }]);
  g.set('e|d', [{ ch: 'd', start: now, stop: now + h, title: 'Giants vs Cowboys' }]); // unapproved match: ignored
  const listings = findTeamListings(buildMatchers([T('nfl:nyg')]), lineup, g, { now });
  assert.equal(listings[0].live, true);
  assert.equal(listings[0].kind, 'game');
  assert.deepEqual(listings[0].channels.map((c) => c.number), [11, 10], 'favorite channel first');
  assert.ok(listings.some((l) => l.programme.title === 'Giants Postgame'), 'football category confirms the NFL Giants');
  assert.ok(!listings.some((l) => l.programme.title === 'Giants Talk'), 'could be the baseball Giants: not claimed');
  assert.ok(listings.some((l) => l.programme.title === 'Evening News' && l.kind === 'show'), 'full name in description');
  assert.ok(!listings.some((l) => l.channels.some((c) => c.key === 'd')));
  assert.equal(findTeamListings(buildMatchers([T('nfl:nyg')]), lineup, g, { now, includeShows: false }).every((l) => l.kind === 'game'), true);
});

test('team channels require a full name or nickname with the league', () => {
  const lineup = [ch('a', 'NBA League Pass: Lakers', 1), ch('b', 'Lakers Fan TV', 2, { group: 'Entertainment', category: 'entertainment' }), ch('c', 'Los Angeles Lakers Network', 3), ch('d', 'Sky Sports Main Event', 4)];
  assert.deepEqual(teamChannels(m1('nba:lal'), lineup).map((c) => c.key), ['a', 'c']);
  assert.deepEqual(teamChannels(m1('wnba:chi'), lineup), []);
});
