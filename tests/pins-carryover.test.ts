import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineup } from '../src/core/organize';
import { DEFAULT_SETTINGS, type ChannelCustomization, type ParsedChannel } from '../src/core/types';
import { portableName } from '../src/core/mytv';

const pc = (playlistId: string, rows: [string, string?, string?][]): ParsedChannel[] =>
  rows.map(([n, g, id], i) => ({ key: `${playlistId}-${i}`, playlistId, index: i, originalName: n, groupTitle: g, url: `http://line.example/live/u/p/${id ?? 9000 + i}.ts` }));

test('My TV pins: your chosen New York streams win their numbers', () => {
  const chans = pc('p', [
    ['US: ABC 7 New York (WABC) FHD', 'USA Locals'], ['A3 NEW YORK 07 WABC ABC NEW YORK ᶜᶦᵗʸ RAW', 'A3 NEW YORK', '2356'],
    ['US: CBS 2 New York HD', 'USA Locals'], ['A3 NEW YORK 02 WCBS CBS NEW YORK ᶜᶦᵗʸ RAW', 'A3 NEW YORK', '2353'],
    ['A3 NEW YORK 04 WNBC NBC NEW YORK ᶜᶦᵗʸ RAW', 'A3 NEW YORK', '2354'], ['A3 NEW YORK 05 WNYW FOX NEW YORK ᶜᶦᵗʸ RAW', 'A3 NEW YORK', '2355'],
  ]);
  const plain = buildLineup({ channels: chans, customizations: new Map(), matches: new Map() });
  assert.equal(plain.find((c) => c.myTv === 7)?.originalName, 'US: ABC 7 New York (WABC) FHD'); // without pins the FHD copy wins
  const L = buildLineup({ channels: chans, customizations: new Map(), matches: new Map(), myTvPins: DEFAULT_SETTINGS.myTvPins });
  const at = (n: number) => L.find((c) => c.myTv === n)?.originalName;
  assert.equal(at(2), 'A3 NEW YORK 02 WCBS CBS NEW YORK ᶜᶦᵗʸ RAW');
  assert.equal(at(4), 'A3 NEW YORK 04 WNBC NBC NEW YORK ᶜᶦᵗʸ RAW');
  assert.equal(at(5), 'A3 NEW YORK 05 WNYW FOX NEW YORK ᶜᶦᵗʸ RAW');
  assert.equal(at(7), 'A3 NEW YORK 07 WABC ABC NEW YORK ᶜᶦᵗʸ RAW');
  assert.equal(L.filter((c) => c.myTv === 7).length, 1);
  assert.equal(L[1].country, 'us'); // "A3 NEW YORK" channels belong to the United States
});

test('Pins and your edits follow you to another provider with different names', () => {
  const other = pc('q', [['USA: WABC ABC 7 NEW YORK HD', 'US Locals'], ['US: ESPN HD', 'US Sports'], ['USA: WNBC NBC 4 NY', 'US Locals'], ['US| FOX 5 NEW YORK WNYW RAW', 'US Locals']]);
  const L = buildLineup({ channels: other, customizations: new Map(), matches: new Map(), myTvPins: DEFAULT_SETTINGS.myTvPins });
  assert.equal(L.find((c) => c.myTv === 7)?.originalName, 'USA: WABC ABC 7 NEW YORK HD');
  assert.equal(L.find((c) => c.myTv === 4)?.originalName, 'USA: WNBC NBC 4 NY');
  assert.equal(L.find((c) => c.myTv === 5)?.originalName, 'US| FOX 5 NEW YORK WNYW RAW');
  // Old provider's favorite/rename (channel no longer exists) moves to the same channel on the new one.
  const custom = new Map<string, ChannelCustomization>([
    ['old-espn', { key: 'old-espn', favorite: true, name: 'ESPN', ident: { name: 'US: ESPN FHD' } }],
    ['old-gone', { key: 'old-gone', hidden: true, ident: { name: 'Some Channel That Is Gone' } }],
  ]);
  const L2 = buildLineup({ channels: other, customizations: custom, matches: new Map() });
  const espn = L2.find((c) => c.originalName === 'US: ESPN HD')!;
  assert.equal(espn.favorite, true);
  assert.equal(espn.name, 'ESPN');
  assert.equal(L2.filter((c) => c.hidden).length, 0);
  assert.equal(portableName('A3 NEW YORK 07 WABC ABC NEW YORK ᶜᶦᵗʸ RAW'), 'new york 07 wabc abc new york city');
});
