import { test } from 'node:test';
import assert from 'node:assert/strict';
import { episodeOf, episodeUrl, formatDuration, m3uVod, movieUrl, parseCategories, parseMovieInfo, parseMovies, parseSeriesInfo, parseSeriesList } from '../src/core/vod';

const login = { server: 'line.example.com:8080', username: 'user', password: 'p@ss', output: 'ts' as const };

test('Xtream movie lists are parsed (posters, years, ratings, container)', () => {
  assert.deepEqual(parseCategories([{ category_id: '7', category_name: 'Action' }, { category_id: '', category_name: 'x' }, null]), [{ id: '7', name: 'Action' }]);
  const [m] = parseMovies([{ stream_id: 101, name: 'Night Run (2021)', stream_icon: 'http://img.example/1.jpg', category_id: '7', rating_5based: 3.5, added: '1700000000', container_extension: 'mkv' }, { name: 'no id' }]);
  assert.equal(m.id, '101');
  assert.equal(m.year, '2021');
  assert.equal(m.rating, 7);
  assert.equal(m.ext, 'mkv');
  assert.equal(m.poster, 'http://img.example/1.jpg');
  assert.equal(parseMovies([{ stream_id: 1, name: 'A', stream_icon: 'not a url' }])[0].poster, undefined);
});

test('movie and episode URLs use the provider login', () => {
  assert.equal(movieUrl(login, { id: '101', ext: 'mkv' }), 'http://line.example.com:8080/movie/user/p%40ss/101.mkv');
  assert.equal(episodeUrl(login, { id: '55', ext: 'mp4' }), 'http://line.example.com:8080/series/user/p%40ss/55.mp4');
  assert.equal(movieUrl(login, { id: '1', ext: 'mp4', url: 'http://direct.example/a.mp4' }), 'http://direct.example/a.mp4');
});

test('movie details and runtime', () => {
  const d = parseMovieInfo({ info: { plot: 'A chase.', cast: 'A, B', releasedate: '2021-05-01', duration: '01:42:10', youtube_trailer: 'abc' } });
  assert.equal(d.plot, 'A chase.');
  assert.equal(d.year, '2021');
  assert.equal(d.durationSec, 6130);
  assert.equal(d.trailer, 'https://www.youtube.com/watch?v=abc');
  assert.equal(formatDuration(6130), '1 h 42 min');
  assert.equal(formatDuration(undefined), '');
});

test('series and their episodes come out in season / episode order', () => {
  const [s] = parseSeriesList([{ series_id: 9, name: 'Harbor', cover: 'https://img.example/h.jpg', category_id: '3', releaseDate: '2019-01-01' }]);
  assert.equal(s.id, '9');
  assert.equal(s.year, '2019');
  const info = parseSeriesInfo({
    info: { plot: 'Boats.' },
    episodes: {
      '2': [{ id: '22', episode_num: 1, title: 'Harbor S02E01', season: 2, container_extension: 'mkv' }],
      '1': [
        { id: '12', episode_num: 2, title: 'Harbor S01E02', season: 1, info: { duration_secs: 2700 } },
        { id: '11', episode_num: 1, title: 'Harbor S01E01', season: 1 },
      ],
    },
  });
  assert.equal(info.details.plot, 'Boats.');
  assert.deepEqual(info.seasons.map((x) => x.season), [1, 2]);
  assert.deepEqual(info.seasons[0].episodes.map((e) => e.id), ['11', '12']);
  assert.equal(info.seasons[0].episodes[1].durationSec, 2700);
  assert.equal(info.seasons[1].episodes[0].ext, 'mkv');
  // Some providers send episodes as a plain list.
  assert.equal(parseSeriesInfo({ episodes: [{ id: '1', season: 1, episode_num: 1 }] }).seasons[0].episodes.length, 1);
});

test('plain M3U playlists: movies and episodes are told apart and shows are grouped', () => {
  assert.deepEqual(episodeOf('Harbor S01 E02'), { show: 'Harbor', season: 1, episode: 2 });
  assert.deepEqual(episodeOf('The.Show.s2e10.720p'), { show: 'The Show', season: 2, episode: 10 });
  assert.equal(episodeOf('Night Run (2021)'), undefined);
  const v = m3uVod([
    { name: 'Night Run (2021)', url: 'http://x.example/movie/u/p/1.mp4', group: 'Movies | Action' },
    { name: 'Harbor S01 E01', url: 'http://x.example/series/u/p/11.mkv', group: 'Series | Drama' },
    { name: 'Harbor S01 E02', url: 'http://x.example/series/u/p/12.mkv', group: 'Series | Drama' },
  ]);
  assert.equal(v.movies.length, 1);
  assert.equal(v.movies[0].year, '2021');
  assert.equal(v.movies[0].url, 'http://x.example/movie/u/p/1.mp4');
  assert.deepEqual(v.categories, [{ id: '1', name: 'Movies | Action' }]);
  assert.equal(v.series.length, 1);
  assert.equal(v.series[0].series.name, 'Harbor');
  assert.equal(v.series[0].episodes.length, 2);
  assert.equal(v.series[0].episodes[1].ext, 'mkv');
  assert.deepEqual(m3uVod([]), { movies: [], series: [], categories: [], seriesCategories: [] });
});

import { genreOf, isEnglishCategory, isTrendingCategory, normTitle, parseItunesChart } from '../src/core/vod';
import { groupRoster, parseLine, propsForPosition } from '../src/core/livestats';

test('home page: English categories, genres and trending lists', () => {
  for (const n of ['EN | Action', 'US: Comedy', 'UK - Drama', 'ENGLISH MOVIES', 'Netflix Movies', 'Kids | Disney', 'TOP 10 Movies', '4K | Movies']) assert.equal(isEnglishCategory(n), true, n);
  for (const n of ['AR | أفلام', 'FR | Films', 'DE - Filme', 'ES: Peliculas', 'EN | Arabic Movies', 'Bollywood', 'Latino Movies', 'TR | Diziler']) assert.equal(isEnglishCategory(n), false, n);
  assert.equal(genreOf('EN | ACTION MOVIES'), 'action');
  assert.equal(genreOf('EN | Sci-Fi'), 'scifi');
  assert.equal(genreOf('EN | NETFLIX SERIES'), 'netflix');
  assert.equal(genreOf('EN | 2024 Releases'), undefined);
  assert.equal(isTrendingCategory('EN | Trending Now'), true);
  assert.equal(isTrendingCategory('EN | Netflix Top 10'), true);
  assert.equal(isTrendingCategory('EN | Action'), false);
  assert.equal(normTitle('EN - The Batman (2022) 4K'), 'the batman');
  assert.equal(normTitle('The Bear, Season 3'), 'the bear');
  assert.equal(normTitle('Fast & Furious'), 'fast and furious');
  assert.deepEqual(parseItunesChart({ feed: { entry: [{ 'im:name': { label: 'The Batman' } }, { 'im:name': { label: 'Dune' } }] } }), ['The Batman', 'Dune']);
  assert.deepEqual(parseItunesChart({}), []);
});

test('players are grouped by position, only positions with props', () => {
  const roster = [
    { name: 'WR One', position: 'WR' }, { name: 'QB One', position: 'QB' }, { name: 'Tackle', position: 'OT' },
    { name: 'Punter', position: 'P' }, { name: 'Kicker', position: 'K' }, { name: 'LB One', position: 'LB' }, { name: 'TE One', position: 'TE' },
  ];
  assert.deepEqual(groupRoster('football', roster, 'bets').map((g) => `${g.group.label}:${g.players.map((p) => p.name).join('+')}`), ['Quarterbacks:QB One', 'Wide receivers:WR One', 'Tight ends:TE One', 'Kickers:Kicker', 'Defense:LB One']);
  assert.deepEqual(groupRoster('football', roster, 'fantasy').map((g) => g.group.id), ['qb', 'wr', 'te', 'k']);
  assert.deepEqual(groupRoster('basketball', [{ name: 'A', position: 'C' }, { name: 'B', position: 'PG' }], 'bets').map((g) => g.group.label), ['Guards', 'Centers']);
  const wr = propsForPosition('football', 'WR').map((p) => p.id);
  assert.ok(wr.includes('recYds') && !wr.includes('passYds') && !wr.includes('fgMade'));
  assert.deepEqual(propsForPosition('football', 'K').map((p) => p.id), ['fgMade', 'kickPts']);
});

test('lines typed on a TV keyboard', () => {
  assert.equal(parseLine('74.5'), 74.5);
  assert.equal(parseLine('74,5'), 74.5);
  assert.equal(parseLine('-3.5'), -3.5);
  assert.equal(parseLine('.5'), 0.5);
  assert.equal(parseLine(''), undefined);
  assert.equal(parseLine('abc'), undefined);
  assert.equal(parseLine('7.4.5'), undefined);
});

import { cleanTitle, parseItunesMovie, parseTvmazeShow, qualityOf } from '../src/core/vod';
import { continueList, type ResumeEntry } from '../src/core/vod';

test('quality from names and video height, 1080p preferred', () => {
  assert.equal(qualityOf('Night Run (2021) 4K').label, '4K');
  assert.equal(qualityOf('Night Run FHD').label, '1080p');
  assert.equal(qualityOf('EN - Night Run HD').label, '720p');
  assert.equal(qualityOf('Night Run').label, '');
  assert.equal(qualityOf('Night Run', 1080).label, '1080p');
  assert.ok(qualityOf('x 1080p').rank > qualityOf('x 4K').rank && qualityOf('x 4K').rank > qualityOf('x HD').rank);
  assert.equal(cleanTitle('EN - The Batman (2022) 4K'), 'The Batman');
  assert.equal(cleanTitle('US: Night Run FHD'), 'Night Run');
});

test('TVmaze and iTunes artwork only for exact matches', () => {
  const show = { name: 'Harbor', premiered: '2019-01-03', summary: '<p>Secrets.</p>', image: { original: 'https://img.example/p.jpg' }, _embedded: { episodes: [{ season: 1, number: 2, name: 'High Water', image: { original: 'https://img.example/e.jpg' } }] } };
  const a = parseTvmazeShow(show, 'EN - Harbor (2019)');
  assert.equal(a?.poster, 'https://img.example/p.jpg');
  assert.equal(a?.plot, 'Secrets.');
  assert.equal(a?.episodes?.['1:2'].title, 'High Water');
  assert.equal(parseTvmazeShow(show, 'Harbor (2005)'), undefined);
  assert.equal(parseTvmazeShow(show, 'Harbor Lights'), undefined);
  const m = parseItunesMovie({ results: [{ trackName: 'Other' }, { trackName: 'Night Run', releaseDate: '2021-05-01', artworkUrl100: 'https://is1.example/abc/100x100bb.jpg', longDescription: 'A courier.' }] }, 'Night Run (2021) 4K');
  assert.equal(m?.poster, 'https://is1.example/abc/600x900bb.jpg');
  assert.equal(m?.plot, 'A courier.');
  assert.equal(parseItunesMovie({ results: [{ trackName: 'Night Run', releaseDate: '1990-01-01' }] }, 'Night Run (2021)'), undefined);
});

test('Continue watching: one card per show (last watched), finished movies and finales drop off', () => {
  const ser = (ep: number) => ({ id: 's1', name: 'Harbor', season: 1, episode: ep, episodeId: `e${ep}` });
  const base = { title: 'x', dur: 100, url: 'u', playlistId: 'p' };
  const list: ResumeEntry[] = [
    { ...base, key: 'e:p:e1', pos: 100, at: 1, series: ser(1), done: true, hasNext: true },
    { ...base, key: 'e:p:e2', pos: 40, at: 2, series: ser(2), hasNext: true },
    { ...base, key: 'm:p:1', pos: 50, at: 3 },
    { ...base, key: 'e:p:x9', pos: 100, at: 4, series: { ...ser(9), id: 's2', name: 'Other Show' }, done: true, hasNext: false },
  ];
  assert.deepEqual(continueList(list).map((e) => e.key), ['m:p:1', 'e:p:e2']);
});

test('Continue watching groups older show entries (no show id) by the show name', () => {
  const base = { dur: 100, url: 'u', playlistId: 'p' };
  const list: ResumeEntry[] = [
    { ...base, key: 'e:p:1', title: 'EN - Harbor', subtitle: 'S1 E1', pos: 30, at: 1 },
    { ...base, key: 'e:p:2', title: 'EN - Harbor', subtitle: 'S1 E2', pos: 40, at: 2 },
  ];
  assert.deepEqual(continueList(list).map((e) => e.key), ['e:p:2']);
});

import { parseTvmazeSchedule } from '../src/core/vod';

test('Continue watching: one South Park card even across copies / playlists (most recent wins)', () => {
  const base = { dur: 100, url: 'u', pos: 30 };
  const list: ResumeEntry[] = [
    { ...base, key: 'e:p1:1', title: 'South Park', playlistId: 'p1', at: 1, series: { id: '10', name: 'South Park', season: 26, episode: 1, episodeId: '1' } },
    { ...base, key: 'e:p1:9', title: 'EN - South Park (4K)', playlistId: 'p1', at: 5, series: { id: '99', name: 'EN - South Park (4K)', season: 27, episode: 3, episodeId: '9' } },
    { ...base, key: 'e:p2:5', title: 'South Park', playlistId: 'p2', at: 3 },
  ];
  assert.deepEqual(continueList(list).map((e) => e.key), ['e:p1:9']);
});

test('TVmaze schedules -> English show names (network and streaming)', () => {
  assert.deepEqual(parseTvmazeSchedule([{ show: { name: 'Harbor', language: 'English' } }, { _embedded: { show: { name: 'The Bear', language: 'English' } } }, { show: { name: 'Dark', language: 'German' } }, { show: { name: 'Harbor', language: 'English' } }]), ['Harbor', 'The Bear']);
});
