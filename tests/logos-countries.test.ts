import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineup, filterLineup, subProviderLabel, subProviders } from '../src/core/organize';
import { bestLogo, setLogoIndex, slugKey } from '../src/core/logos';
import { parseLeagueLogo, scheduleLeague } from '../src/core/schedule';
import type { ParsedChannel } from '../src/core/types';

function lineupOf(rows: [string, string?][]) {
  const chans: ParsedChannel[] = rows.map(([n, g], i) => ({ key: 'k' + i, playlistId: 'p', index: i, originalName: n, groupTitle: g, url: `http://h/live/u/p/${i}.ts` }));
  return buildLineup({ channels: chans, customizations: new Map(), matches: new Map() });
}

test('country menu: My TV and each provider group, with the country word removed', () => {
  assert.equal(subProviderLabel('USA · AT&T', 'us'), 'AT&T');
  assert.equal(subProviderLabel('US · DIRECTV', 'us'), 'DIRECTV');
  assert.equal(subProviderLabel('USA Sports', 'us'), 'Sports');
  assert.equal(subProviderLabel('USA', 'us'), 'General');
  assert.equal(subProviderLabel('UK · Sky', 'uk'), 'Sky');
  const L = lineupOf([
    ['US: ESPN', 'USA | AT&T'], ['US: CNN', 'USA | AT&T'], ['US: YES Network', 'US | DIRECTV'], ['US: Local Thing', 'USA | DIRECTV'], ['UK: BBC One', 'UK | Sky'],
    ['US: NFL 01', 'NFL Sunday Ticket'], ['NFL 02', 'NFL Sunday Ticket'], ['US: NFL 03', 'NFL Sunday Ticket'], ['US: Fox 5', 'USA | Locals'],
  ]);
  const subs = subProviders(L, 'us');
  // Every original group is its own entry, in the provider's order; same-looking labels keep the full group name.
  assert.deepEqual(subs.map((s) => `${s.label}:${s.count}`), ['My TV:3', 'AT&T:2', 'US · DIRECTV:1', 'USA · DIRECTV:1', 'NFL Sunday Ticket:3', 'Locals:1']);
  // "NFL 02" has no country of its own; it follows its group.
  assert.equal(L[6].country, 'us');
  const att = subs.find((s) => s.label === 'AT&T')!;
  assert.deepEqual(filterLineup(L, `country:us|${att.id}` as never).map((c) => c.originalName), ['US: ESPN', 'US: CNN']);
  assert.deepEqual(filterLineup(L, 'country:us|mytv' as never).map((c) => c.myTv), [202, 206, 631]);
  assert.equal(filterLineup(L, 'country:uk' as never).length, 1);
});

test('high-quality logos match the channel exactly, within its country', () => {
  assert.deepEqual(slugKey('espn-2-us'), { key: 'espn2', rank: 0 });
  assert.deepEqual(slugKey('a-and-e-us'), { key: 'aande', rank: 0 });
  assert.equal(slugKey('abc-logo-1962-us'), null);
  assert.equal(slugKey('cbs-logo-white-us')!.key, 'cbs');
  setLogoIndex({ sha: 'abc', folders: {
    'united-states': ['espn-us', 'espn-light-us', 'espn-2-us', 'fox-sports-1-us', 'yes-network-us', 'cbs-logo-white-us', 'nbcsn-philadelphia-us', 'discovery-channel-us', 'hd/hbo-2-hd-us'],
    'united-kingdom': ['sky-sports-main-event-uk', 'discovery-channel-uk'],
    international: ['cnn-international-int'],
  } });
  const L = lineupOf([['US: ESPN FHD', 'USA Sports'], ['USA FS1'], ['US: YES Network'], ['US: CBS 2 New York (WCBS)'], ['US: NBC Sports Philadelphia'], ['UK: Discovery Channel', 'UK'], ['US: Discovery'], ['US: Mystery Local'], ['NFL 03: Bills vs Jets', 'NFL Game Pass'], ['CNN International']]);
  const get = (i: number) => bestLogo(L[i])?.replace('https://raw.githubusercontent.com/tv-logo/tv-logos/abc/countries/', '');
  assert.equal(get(0), 'united-states/espn-us.png'); // plain design preferred
  assert.equal(get(1), 'united-states/fox-sports-1-us.png'); // via My TV alias
  assert.equal(get(2), 'united-states/yes-network-us.png');
  assert.equal(get(3), 'united-states/cbs-logo-white-us.png'); // local -> network logo
  assert.equal(get(4), 'united-states/nbcsn-philadelphia-us.png');
  assert.equal(get(5), 'united-kingdom/discovery-channel-uk.png'); // UK channel gets the UK logo
  assert.equal(get(6), 'united-states/discovery-channel-us.png');
  assert.equal(get(7), undefined); // no guessing
  assert.equal(get(8), undefined);
  assert.equal(get(9), 'international/cnn-international-int.png');
});

test('Champions League is a league; league logo read from the scoreboard', () => {
  assert.equal(scheduleLeague('ucl')?.path, 'soccer/uefa.champions');
  assert.equal(parseLeagueLogo({ leagues: [{ logos: [{ href: 'https://x/light.png', rel: ['full', 'default'] }, { href: 'https://x/dark.png', rel: ['full', 'dark'] }] }] }), 'https://x/dark.png');
  assert.equal(parseLeagueLogo({}), undefined);
});

test('country tabs follow the provider\'s code on each group; a whole group goes under one country', () => {
  const L = lineupOf([
    ['US: ESPN', 'CA| SPORTS'], ['TSN 1', 'CA| SPORTS'], ['Sky Sports Main Event', 'UK: SPORTS'], ['DAZN 1', 'ES| DEPORTES'],
    ['Movistar LaLiga', 'ES| DEPORTES'], ['CNN', 'US| NEWS'], ['BBC News', 'US| NEWS'], ['beIN 1', '|AR| SPORTS'], ['US: HBO', 'PREMIUM'], ['US: Starz', 'PREMIUM'], ['Cinemax', 'PREMIUM'],
  ]);
  const of = (n: string) => { const c = L.find((x) => x.originalName === n)!; return `${c.country}:${c.countryCode}`; };
  assert.equal(of('US: ESPN'), 'ca:CA'); // the group's code wins over the name
  assert.equal(of('TSN 1'), 'ca:CA');
  assert.equal(of('Sky Sports Main Event'), 'uk:UK');
  assert.equal(of('DAZN 1'), 'es:ES');
  assert.equal(of('BBC News'), 'us:US');
  assert.equal(of('beIN 1'), 'ar:AR');
  assert.equal(of('Cinemax'), 'us:US'); // no code on the group: most of its channels say US
});
