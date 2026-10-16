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
