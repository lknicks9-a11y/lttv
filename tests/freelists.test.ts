import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeShows, parseItunesChartTitles, parseScheduleShows, SHOW_GENRES, SHOW_SERVICES } from '../src/core/freelists';

test('iTunes chart titles with years; TV seasons become the show', () => {
  const j = { feed: { entry: [{ 'im:name': { label: 'Wicked: For Good' }, 'im:releaseDate': { label: '2025-11-21T00:00:00-07:00' } }, { 'im:name': { label: 'Wicked: For Good' } }] } };
  assert.deepEqual(parseItunesChartTitles(j), [{ title: 'Wicked: For Good', year: 2025 }]);
  const tv = { feed: { entry: [{ 'im:name': { label: 'The Bear, Season 4' } }, { 'im:name': { label: 'Severance, Season 2' } }] } };
  assert.deepEqual(parseItunesChartTitles(tv, true).map((t) => t.title), ['The Bear', 'Severance']);
});

test('TVmaze schedule: English shows with service, genres and popularity', () => {
  const day = [
    { airdate: '2026-11-10', show: { name: 'Pluribus', language: 'English', premiered: '2025-11-07', weight: 98, webChannel: { name: 'Apple TV' }, genres: ['Drama', 'Science-Fiction'], type: 'Scripted' } },
    { airdate: '2026-11-10', show: { name: 'Bigg Boss', language: 'Hindi', weight: 90, network: { name: 'Colors' }, genres: [], type: 'Reality' } },
    { airdate: '2026-11-11', _embedded: { show: { name: 'Survivor', language: 'English', weight: 95, network: { name: 'CBS' }, genres: [], type: 'Reality' } } },
  ];
  const shows = mergeShows([parseScheduleShows(day), parseScheduleShows([{ ...day[0], airdate: '2026-11-12' }])]);
  assert.deepEqual(shows.map((s) => s.name), ['Pluribus', 'Survivor']);
  assert.equal(shows[0].aired, '2026-11-12');
  assert.ok(SHOW_SERVICES.find((s) => s.label === 'Apple TV+')!.re.test(shows[0].channel));
  assert.ok(SHOW_GENRES.find((g) => g.label === 'Reality')!.test(shows[1]));
});

import { sizedImage } from '../src/core/vod';
test('pictures are asked for at the size they are shown', () => {
  assert.equal(sizedImage('https://image.tmdb.org/t/p/original/abc.jpg', 'poster', true), 'https://image.tmdb.org/t/p/w342/abc.jpg');
  assert.equal(sizedImage('https://image.tmdb.org/t/p/w600_and_h900_bestv2/abc.jpg', 'backdrop', false), 'https://image.tmdb.org/t/p/w1280/abc.jpg');
  assert.equal(sizedImage('https://is1-ssl.mzstatic.com/image/thumb/Video/v4/x/600x900bb.jpg', 'poster', true), 'https://is1-ssl.mzstatic.com/image/thumb/Video/v4/x/300x450bb.jpg');
  assert.equal(sizedImage('https://static.tvmaze.com/uploads/images/original_untouched/1/4600.jpg', 'poster', true), 'https://static.tvmaze.com/uploads/images/medium_portrait/1/4600.jpg');
  assert.equal(sizedImage('http://provider.example/p.jpg', 'poster', true), 'http://provider.example/p.jpg');
});

