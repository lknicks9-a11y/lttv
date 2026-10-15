import { test } from 'node:test';
import assert from 'node:assert/strict';
import { episodeNumbers, gameDescription, searchTitle, shorten, stripHtml, titleKey, tvmazeShowMatches, wikiMatches } from '../src/core/progdesc';
import type { Game } from '../src/core/schedule';

test('titles are cleaned before looking them up', () => {
  assert.equal(searchTitle('New: The Late Show (2024) [HD]'), 'The Late Show');
  assert.equal(searchTitle('SportsCenter (Live)'), 'SportsCenter');
  assert.equal(searchTitle('Seinfeld - S04E11'), 'Seinfeld');
  assert.equal(searchTitle('Law & Order S12 E5 The Trial'), 'Law & Order');
  assert.equal(titleKey('The Office'), titleKey('Office'));
  assert.deepEqual(episodeNumbers('S2 E5'), { season: 2, number: 5 });
  assert.equal(episodeNumbers(undefined), undefined);
  assert.equal(stripHtml('<p>A <b>late-night</b> talk show &amp; more.</p>'), 'A late-night talk show & more.');
  assert.ok(shorten('One. '.repeat(200)).length <= 421);
});

test('only an exact title match is accepted from TVmaze and Wikipedia', () => {
  assert.ok(tvmazeShowMatches({ id: 1, name: 'The Late Show with Stephen Colbert' }, 'Late Show with Stephen Colbert'));
  assert.ok(!tvmazeShowMatches({ id: 1, name: 'The Late Late Show' }, 'The Late Show'));
  assert.ok(!tvmazeShowMatches(null, 'x'));
  const film = { type: 'standard', title: 'Heat (1995 film)', description: '1995 film by Michael Mann', extract: 'Heat is a 1995 American crime film written and directed by Michael Mann, starring Al Pacino and Robert De Niro.' };
  assert.ok(wikiMatches(film, 'Heat', 'film'));
  assert.ok(!wikiMatches({ ...film, type: 'disambiguation' }, 'Heat', 'film'));
  assert.ok(!wikiMatches({ ...film, title: 'Miami Heat', description: 'NBA team', extract: 'The Miami Heat are an American professional basketball team based in Miami, Florida.' }, 'Heat', 'film'));
  assert.ok(!wikiMatches(film, 'Heat', 'tv'));
});

test('game descriptions come from the schedule', () => {
  const g: Game = {
    id: '1', league: 'mlb', start: Date.UTC(2026, 9, 15, 23, 8), state: 'in', detail: 'Top 3rd', name: 'Boston Red Sox at New York Yankees',
    home: { id: '10', name: 'New York Yankees', short: 'Yankees', location: 'New York', abbr: 'NYY', record: '94-68', score: '3', side: 'home' },
    away: { id: '2', name: 'Boston Red Sox', short: 'Red Sox', location: 'Boston', abbr: 'BOS', record: '90-72', score: '1', side: 'away' },
    broadcasts: [{ name: 'YES', market: 'home', kind: 'tv' }, { name: 'NESN', market: 'away', kind: 'tv' }],
    venue: 'Yankee Stadium', note: 'ALCS - Game 3',
  };
  const text = gameDescription(g, 'baseball', 'MLB', () => '7:08 PM');
  assert.equal(text, 'MLB: Boston Red Sox (90-72) at New York Yankees (94-68). ALCS - Game 3. At Yankee Stadium. Live now: BOS 1, NYY 3 (Top 3rd). TV: YES (NYY) · NESN (BOS).');
  assert.match(gameDescription({ ...g, state: 'pre', note: undefined }, 'baseball', 'MLB', () => '7:08 PM'), /First pitch 7:08 PM\./);
  assert.match(gameDescription({ ...g, state: 'post' }, 'baseball', 'MLB', () => ''), /Final: BOS 1, NYY 3\./);
});
