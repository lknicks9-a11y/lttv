import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listingFor, parseMlbListings, parseNbaListings, parseNhlListings } from '../src/core/tvlistings';

const T = Date.parse('2026-10-26T02:00:00Z');
const team = (name: string, short: string, location: string, abbr: string, side: string) => ({ id: abbr, name, short, location, abbr, side });
const game = (league: string, home: ReturnType<typeof team>, away: ReturnType<typeof team>) => ({ id: 'g', league, start: T, state: 'pre', detail: '', name: '', home, away, broadcasts: [] }) as never;

test('NHL official feed: home/away/national channels, abbreviations as channel names', () => {
  const json = { gameWeek: [{ date: '2026-10-25', games: [{ startTimeUTC: '2026-10-26T02:00:00Z', homeTeam: { abbrev: 'SJS', placeName: { default: 'San Jose' }, commonName: { default: 'Sharks' } }, awayTeam: { abbrev: 'PIT', placeName: { default: 'Pittsburgh' }, commonName: { default: 'Penguins' } },
    tvBroadcasts: [{ id: 1, market: 'H', countryCode: 'US', network: 'NBCSCA' }, { id: 2, market: 'A', countryCode: 'US', network: 'SNP' }, { id: 3, market: 'N', countryCode: 'CA', network: 'SN' }] }] }] };
  const l = parseNhlListings(json);
  const hit = listingFor(game('nhl', team('San Jose Sharks', 'Sharks', 'San Jose', 'SJ', 'home'), team('Pittsburgh Penguins', 'Penguins', 'Pittsburgh', 'PIT', 'away')), l);
  assert.deepEqual(hit?.broadcasts.map((b) => `${b.market}:${b.name}`), ['home:NBC Sports California', 'away:SportsNet Pittsburgh', 'national:Sportsnet']);
});

test('NBA official feed: national, home and away TV only', () => {
  const json = { leagueSchedule: { gameDates: [{ games: [{ gameDateTimeUTC: '2026-10-26T02:00:00Z', homeTeam: { teamName: 'Kings', teamCity: 'Sacramento', teamTricode: 'SAC' }, awayTeam: { teamName: 'Jazz', teamCity: 'Utah', teamTricode: 'UTA' },
    broadcasters: { nationalTvBroadcasters: [], homeTvBroadcasters: [{ broadcasterDisplay: 'NBCS-CA', broadcasterMedia: 'tv' }], awayTvBroadcasters: [{ broadcasterDisplay: 'KJZZ', broadcasterMedia: 'tv' }], homeRadioBroadcasters: [{ broadcasterDisplay: 'KHTK', broadcasterMedia: 'radio' }] } },
    { gameDateTimeUTC: '2027-01-01T00:00:00Z', homeTeam: { teamName: 'Kings' }, awayTeam: { teamName: 'Jazz' }, broadcasters: {} }] }] } };
  const l = parseNbaListings(json, T - 6 * 3600_000, T + 6 * 3600_000);
  assert.equal(l.length, 1);
  const hit = listingFor(game('nba', team('Sacramento Kings', 'Kings', 'Sacramento', 'SAC', 'home'), team('Utah Jazz', 'Jazz', 'Utah', 'UTAH', 'away')), l);
  assert.deepEqual(hit?.broadcasts.map((b) => `${b.market}:${b.name}`), ['home:NBCS-CA', 'away:KJZZ']);
});

test('MLB official feed: TV in English, national flagged', () => {
  const json = { dates: [{ games: [{ gameDate: '2026-10-26T02:00:00Z', teams: { home: { team: { name: 'Los Angeles Dodgers', teamName: 'Dodgers' } }, away: { team: { name: 'New York Yankees', teamName: 'Yankees' } } },
    broadcasts: [{ type: 'TV', name: 'FOX', isNational: true, language: 'en' }, { type: 'TV', name: 'FOX Deportes', isNational: true, language: 'es' }, { type: 'AM', name: 'KLAC', homeAway: 'home' }] }] }] };
  const hit = listingFor(game('mlb', team('Los Angeles Dodgers', 'Dodgers', 'Los Angeles', 'LAD', 'home'), team('New York Yankees', 'Yankees', 'New York', 'NYY', 'away')), parseMlbListings(json));
  assert.deepEqual(hit?.broadcasts.map((b) => `${b.market}:${b.name}`), ['national:FOX']);
});
