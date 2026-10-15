import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isForeignScript, expectsEnglish, mostlyForeign, scriptName } from '../src/core/lang';
import { parseXmltv } from '../src/core/xmltv';
import { applyGuideExtras, foreignNear, needsProviderGuide } from '../src/core/extras';
import { GuideIndex } from '../src/core/guide';
import type { LineupChannel, MatchResult, Programme } from '../src/core/types';

const NOW = Date.UTC(2026, 9, 14, 22, 0);

function ch(name: string, extra: Partial<LineupChannel> = {}): LineupChannel {
  return {
    key: 'k-' + name, playlistId: 'p', index: 0, number: 1, name, originalName: name, cleanedName: name, url: 'http://line.example:8080/live/u/p/101.ts',
    group: 'USA', category: 'entertainment', categoryEvidence: 'group', favorite: false, hidden: false, order: 0, matchStatus: 'auto', matchMethod: 'tvg-id', matchConfidence: 1,
    country: 'us', ...extra,
  };
}
const prog = (ref: string, title: string, h: number, desc?: string): Programme => ({ ch: ref, start: NOW + h * 3600_000, stop: NOW + (h + 1) * 3600_000, title, ...(desc ? { desc } : {}) });

test('foreign-script text is told apart from English (and accented Latin)', () => {
  assert.equal(isForeignScript('مسلسل الحلقة ٣'), true);
  assert.equal(isForeignScript('Новости'), true);
  assert.equal(isForeignScript('The Andy Griffith Show'), false);
  assert.equal(isForeignScript('Télé-Québec: Les Pêcheurs'), false);
  assert.equal(isForeignScript('Bonanza (برنامج)'), false); // mostly Latin
  assert.equal(scriptName('مسلسل'), 'Arabic');
  assert.equal(expectsEnglish({ country: 'us' }), true);
  assert.equal(expectsEnglish({ country: 'ar' }), false);
  assert.equal(mostlyForeign([prog('x', 'مسلسل', 0), prog('x', 'برنامج', 1), prog('x', 'Gunsmoke', 2)]), true);
});

test('XMLTV: the English title/description is chosen when there are several languages', () => {
  const xml = `<tv><channel id="metv.us"><display-name>MeTV</display-name></channel>
    <programme channel="metv.us" start="20261014220000 +0000" stop="20261014230000 +0000">
      <title lang="ar">برنامج</title><title lang="en">Gunsmoke</title>
      <desc lang="ar">وصف</desc><desc lang="en">Marshal Dillon keeps the peace.</desc>
      <category lang="ar">دراما</category><category lang="en">Western</category>
    </programme>
    <programme channel="metv.us" start="20261014230000 +0000" stop="20261015000000 +0000">
      <title>مسلسل</title><title>Bonanza</title>
    </programme></tv>`;
  const { programmes } = parseXmltv(xml, 's');
  assert.equal(programmes[0].title, 'Gunsmoke');
  assert.equal(programmes[0].desc, 'Marshal Dillon keeps the peace.');
  assert.deepEqual(programmes[0].categories, ['Western']);
  assert.equal(programmes[1].title, 'Bonanza'); // no lang tags: the Latin-script one
});

test('English channel with an Arabic guide switches to an English source when there is one', () => {
  const g = new GuideIndex();
  g.set('a|metv', [prog('a|metv', 'مسلسل', -0.5), prog('a|metv', 'برنامج', 0.5)]);
  g.set('b|metv.us', [prog('b|metv.us', 'Gunsmoke', -0.5), prog('b|metv.us', 'Bonanza', 0.5)]);
  const c = ch('MeTV', { epgChannelId: 'a|metv' });
  const raw = new Map<string, MatchResult>([[c.key, { key: c.key, epgChannelId: 'a|metv', method: 'tvg-id', confidence: 1, status: 'auto' }]]);
  assert.equal(foreignNear(g, 'a|metv', NOW), true);
  assert.equal(needsProviderGuide(c, g, NOW), true); // ask the provider for English text too
  const base = { now: NOW, eventNames: true, providerGuide: true };
  // Off: stays as it is.
  assert.equal(applyGuideExtras([c], raw, g, base).lineup[0].epgChannelId, 'a|metv');
  const on = applyGuideExtras([c], raw, g, { ...base, preferEnglish: true, englishAlt: new Map([[c.key, 'b|metv.us']]) });
  assert.equal(on.lineup[0].epgChannelId, 'b|metv.us');
  assert.equal(on.lineup[0].matchMethod, 'english');
  // An Arabic channel keeps its Arabic guide.
  const ar = ch('MBC 1', { country: 'ar', epgChannelId: 'a|metv', key: 'k-ar' });
  const raw2 = new Map<string, MatchResult>([[ar.key, { key: ar.key, epgChannelId: 'a|metv', method: 'tvg-id', confidence: 1, status: 'auto' }]]);
  assert.equal(applyGuideExtras([ar], raw2, g, { ...base, preferEnglish: true, englishAlt: new Map([[ar.key, 'b|metv.us']]) }).lineup[0].epgChannelId, 'a|metv');
});

test('My TV New York local matched to another city\'s guide uses the New York station\'s listings', () => {
  const g = new GuideIndex();
  g.set('a|KNBC.us', [prog('a|KNBC.us', 'NBC4 News Los Angeles', 0)]);
  g.set('a|WNBC.us', [prog('a|WNBC.us', 'News 4 New York', 0)]);
  const c = ch('US: NBC 4 New York', { epgChannelId: 'a|KNBC.us', myTv: 4 });
  const raw = new Map<string, MatchResult>([[c.key, { key: c.key, epgChannelId: 'a|KNBC.us', method: 'name', confidence: 1, status: 'auto' }]]);
  const out = applyGuideExtras([c], raw, g, { now: NOW, eventNames: true, providerGuide: true, stationAlt: new Map([[c.key, 'a|WNBC.us']]) });
  assert.equal(out.lineup[0].epgChannelId, 'a|WNBC.us');
  assert.equal(out.lineup[0].matchMethod, 'station');
});
