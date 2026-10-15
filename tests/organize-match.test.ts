import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidyName, cleanChannelNames, normalizeForMatch, categorize, normalizeGroupTitle } from '../src/core/normalize';
import { matchChannels, nameSimilarity, isUsableMatch, epgRef } from '../src/core/match';
import { buildLineup, detectDuplicates, sortLineup, filterLineup, reorder, adjacentChannel } from '../src/core/organize';
import { searchChannels, searchProgrammes } from '../src/core/search';
import { GuideIndex } from '../src/core/guide';
import { redactUrl } from '../src/core/util';
import type { EpgChannel, MatchDecision, ParsedChannel } from '../src/core/types';

let n = 0;
function ch(name: string, extra: Partial<ParsedChannel> = {}): ParsedChannel {
  const i = n++;
  return { key: 'k' + i, playlistId: 'p', index: i, originalName: name, url: `http://s/${i}`, ...extra };
}
const epg = (id: string, ...names: string[]): EpgChannel => ({ id, sourceId: 'e', displayNames: names });

test('tidyName normalises spacing and decorations but keeps meaningful identifiers', () => {
  assert.equal(tidyName('  ★ Demo   Sports  ᴴᴰ  | '), 'Demo Sports HD');
  assert.equal(tidyName('Demo_News_fhd'), 'Demo News FHD');
  assert.equal(tidyName('Demo Movies 4k (East)'), 'Demo Movies 4K (East)');
  assert.equal(tidyName('Demo +1'), 'Demo +1');
  assert.equal(tidyName('##### SPORTS #####'), 'SPORTS');
});

test('redundant prefixes are removed only when redundant and never cause collisions', () => {
  const list = [
    ch('US: Alpha', { groupTitle: 'USA' }), ch('US: Beta', { groupTitle: 'USA' }), ch('US: Gamma HD', { groupTitle: 'USA' }),
    ch('UK: Alpha', { groupTitle: 'United Kingdom' }), ch('Delta'),
  ];
  const m = cleanChannelNames(list);
  assert.equal(m.get(list[1].key), 'Beta');
  assert.equal(m.get(list[2].key), 'Gamma HD');
  // "US: Alpha" and "UK: Alpha" would both become "Alpha" -> keep prefixes
  assert.equal(m.get(list[0].key), 'US: Alpha');
  assert.equal(m.get(list[3].key), 'UK: Alpha');
  assert.equal(m.get(list[4].key), 'Delta');
});

test('normalisation for matching keeps numbers, +1 and regions distinct', () => {
  assert.equal(normalizeForMatch('US: Demo Sports 1 HD'), 'demo sports 1');
  assert.equal(normalizeForMatch('Demo +1'), 'demo plus1');
  assert.equal(normalizeForMatch('Démo & Friends [Geo-blocked]'), 'demo and friends');
  assert.equal(nameSimilarity('Demo Sports 1', 'Demo Sports 2'), 0);
  assert.equal(nameSimilarity('Demo One', 'Demo One +1'), 0);
  assert.equal(nameSimilarity('Demo East', 'Demo West'), 0);
  assert.ok(nameSimilarity('Demo Cinema Premiere', 'Demo Cinema Premier') > 0.8);
});

test('categories come from evidence only', () => {
  assert.deepEqual(categorize('USA | SPORTS', 'Whatever'), { category: 'sports', evidence: 'group' });
  assert.deepEqual(categorize('Noticias', 'X'), { category: 'news', evidence: 'group' });
  assert.deepEqual(categorize('France', 'X'), { category: 'international', evidence: 'group' });
  assert.deepEqual(categorize(undefined, 'Demo News 24'), { category: 'news', evidence: 'name' });
  assert.deepEqual(categorize(undefined, 'Demo Channel'), { category: 'other', evidence: 'none' });
  assert.deepEqual(categorize('Kids & Family', 'X'), { category: 'kids', evidence: 'group' });
  assert.equal(normalizeGroupTitle('  USA  |  ENTERTAINMENT '), 'USA · Entertainment');
  assert.equal(normalizeGroupTitle('undefined'), undefined);
});

test('EPG matching follows priority: tvg-id, tvg-name, normalised name, fuzzy (pending)', () => {
  const chans = [
    ch('Whatever Name', { tvgId: 'ALPHA.us' }),
    ch('Other', { tvgName: 'Beta Channel' }),
    ch('US: Gamma HD'),
    ch('Delta Cinema Premier'),
    ch('Epsilon Sports 2'),
    ch('Totally Unknown'),
  ];
  const e = [epg('alpha.us', 'Alpha'), epg('beta', 'Beta Channel'), epg('gamma', 'Gamma'), epg('delta', 'Delta Cinema Premiere'), epg('eps1', 'Epsilon Sports 1')];
  const m = matchChannels(chans, e);
  assert.equal(m.get(chans[0].key)!.method, 'tvg-id');
  assert.equal(m.get(chans[0].key)!.epgChannelId, epgRef('e', 'alpha.us'));
  assert.equal(m.get(chans[1].key)!.method, 'tvg-name');
  assert.equal(m.get(chans[2].key)!.method, 'name');
  const fuzzy = m.get(chans[3].key)!;
  assert.equal(fuzzy.method, 'fuzzy');
  assert.equal(fuzzy.status, 'pending');
  assert.equal(isUsableMatch(fuzzy), false, 'fuzzy must not drive the guide until approved');
  assert.ok(fuzzy.confidence > 0.7 && fuzzy.confidence < 1);
  assert.equal(m.get(chans[4].key)!.status, 'unmatched', 'Sports 2 must never match Sports 1');
  assert.equal(m.get(chans[5].key)!.status, 'unmatched');
});

test('ambiguous normalised names are not auto-assigned', () => {
  const chans = [ch('Zeta')];
  const m = matchChannels(chans, [epg('zeta.us', 'Zeta'), epg('zeta.uk', 'Zeta')]);
  assert.notEqual(m.get(chans[0].key)!.status, 'auto');
});

test('user decisions override automatic matching and persist rejections', () => {
  const chans = [ch('Delta Cinema Premier'), ch('Alpha', { tvgId: 'alpha' })];
  const e = [epg('delta', 'Delta Cinema Premiere'), epg('alpha', 'Alpha'), epg('other', 'Other')];
  const decisions = new Map<string, MatchDecision>([
    [chans[0].key, { key: chans[0].key, epgChannelId: epgRef('e', 'delta'), status: 'approved', decidedAt: 1 }],
    [chans[1].key, { key: chans[1].key, status: 'rejected', decidedAt: 1 }],
  ]);
  const m = matchChannels(chans, e, decisions);
  assert.equal(m.get(chans[0].key)!.status, 'approved');
  assert.ok(isUsableMatch(m.get(chans[0].key)));
  assert.equal(m.get(chans[1].key)!.status, 'rejected');
  // Rejecting one specific candidate excludes only that candidate
  const d2 = new Map<string, MatchDecision>([[chans[0].key, { key: chans[0].key, epgChannelId: epgRef('e', 'delta'), status: 'rejected', decidedAt: 1 }]]);
  assert.notEqual(matchChannels(chans, e, d2).get(chans[0].key)!.epgChannelId, epgRef('e', 'delta'));
});

test('fuzzy auto-approve threshold is opt-in', () => {
  const chans = [ch('Delta Cinema Premier')];
  const e = [epg('delta', 'Delta Cinema Premiere')];
  assert.equal(matchChannels(chans, e, new Map(), { fuzzyAutoApprove: 0 }).get(chans[0].key)!.status, 'pending');
  assert.equal(matchChannels(chans, e, new Map(), { fuzzyAutoApprove: 0.5 }).get(chans[0].key)!.status, 'auto');
});

test('duplicate detection flags same URL and same name+id but never merges distinct feeds', () => {
  const a = ch('Demo News', { url: 'http://s/same' });
  const b = ch('Demo News Backup', { url: 'http://s/same/' });
  const c = ch('Demo One', { tvgId: 'one' });
  const d = ch('Demo One', { tvgId: 'one' });
  const e = ch('Demo One HD', { tvgId: 'one' });
  const f = ch('Demo One +1', { tvgId: 'one' });
  const dup = detectDuplicates([a, b, c, d, e, f]);
  assert.equal(dup.duplicateOf.get(b.key), a.key);
  assert.equal(dup.duplicateOf.get(d.key), c.key);
  assert.equal(dup.duplicateOf.has(e.key), false);
  assert.equal(dup.duplicateOf.has(f.key), false);
});

test('lineup: customisations, numbering, sorting, filtering, reorder, zapping', () => {
  const chans = [ch('B Chan', { groupTitle: 'Sports', tvgChno: 5 }), ch('A Chan', { groupTitle: 'News' }), ch('C Chan', { groupTitle: 'Movies' })];
  const custom = new Map([
    [chans[2].key, { key: chans[2].key, name: 'My Movies', favorite: true, number: 1 }],
    [chans[1].key, { key: chans[1].key, hidden: true }],
  ]);
  const lineup = buildLineup({ channels: chans, customizations: custom, matches: new Map() });
  const byKey = new Map(lineup.map((c) => [c.key, c]));
  assert.equal(byKey.get(chans[2].key)!.name, 'My Movies');
  assert.equal(byKey.get(chans[2].key)!.originalName, 'C Chan', 'original name is retained');
  assert.equal(byKey.get(chans[0].key)!.number, 5);
  assert.equal(byKey.get(chans[1].key)!.number, 2, 'sequential numbers skip taken ones');
  assert.deepEqual(sortLineup(lineup, 'alpha').map((c) => c.name), ['A Chan', 'B Chan', 'My Movies']);
  assert.deepEqual(sortLineup(lineup, 'number').map((c) => c.number), [1, 2, 5]);
  assert.deepEqual(sortLineup(lineup, 'favorites')[0].name, 'My Movies');
  assert.deepEqual(filterLineup(lineup, 'all').map((c) => c.name).sort(), ['B Chan', 'My Movies']);
  assert.deepEqual(filterLineup(lineup, 'sports').map((c) => c.name), ['B Chan']);
  assert.equal(filterLineup(lineup, 'news').length, 0);
  assert.equal(filterLineup(lineup, 'news', { showHidden: true }).length, 1);
  const order = reorder(sortLineup(lineup, 'playlist'), chans[2].key, 0);
  assert.deepEqual([...order.entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0]), [chans[2].key, chans[0].key, chans[1].key]);
  const sorted = sortLineup(lineup, 'number');
  assert.equal(adjacentChannel(sorted, sorted[2].key, 1)!.key, sorted[0].key, 'wraps around');
  assert.equal(adjacentChannel(sorted, sorted[0].key, -1)!.key, sorted[2].key);
});

test('search: channels by name/number/category and programmes by title', () => {
  const chans = [ch('Demo News', { groupTitle: 'News', tvgId: 'dn' }), ch('Demo Sports', { groupTitle: 'Sports', tvgId: 'ds' })];
  const matches = matchChannels(chans, [epg('dn', 'Demo News'), epg('ds', 'Demo Sports')]);
  const lineup = buildLineup({ channels: chans, customizations: new Map(), matches });
  const g = new GuideIndex();
  const now = Date.parse('2024-05-01T12:00:00Z');
  g.set(epgRef('e', 'dn'), [{ ch: 'dn', start: now - 600_000, stop: now + 600_000, title: 'Morning Bulletin' }]);
  g.set(epgRef('e', 'ds'), [{ ch: 'ds', start: now + 3600_000, stop: now + 7200_000, title: 'Evening Match Live' }]);
  assert.equal(searchChannels(lineup, 'sports')[0].channel.name, 'Demo Sports');
  assert.equal(searchChannels(lineup, '2')[0].channel.number, 2);
  assert.equal(searchChannels(lineup, 'news', { category: 'sports' }).length, 0);
  const ph = searchProgrammes(lineup, g, 'match', now);
  assert.equal(ph.length, 1);
  assert.equal(ph[0].channel.name, 'Demo Sports');
  assert.equal(ph[0].airingNow, false);
  assert.equal(searchProgrammes(lineup, g, 'bulletin', now)[0].airingNow, true);
});

test('redactUrl hides credentials, tokens and query strings', () => {
  assert.equal(redactUrl('http://user:pass@host.example:8080/get.php?username=a&password=b'), 'http://host.example:8080/get.php?…');
  assert.equal(redactUrl('https://cdn.example/live/u123/p456/12345.ts'), 'https://cdn.example/…');
  assert.equal(redactUrl('https://epg.example/guide.xml.gz'), 'https://epg.example/guide.xml.gz');
});
