import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXmltv, XmltvParser, formatEpisode, normalizeSchedule, decodeEntities } from '../src/core/xmltv';
import { parseXmltvTime, zonedTimeToUtc, programmeProgress, formatClock, floorToHalfHour, tzOffsetMs } from '../src/core/time';
import { GuideIndex, layoutRow, halfHourTicks } from '../src/core/guide';

const iso = (t: number) => new Date(t).toISOString();

test('XMLTV timestamps with offsets, Z, compact offsets and colon offsets', () => {
  assert.equal(iso(parseXmltvTime('20240101120000 +0000')), '2024-01-01T12:00:00.000Z');
  assert.equal(iso(parseXmltvTime('20240101120000 +0100')), '2024-01-01T11:00:00.000Z');
  assert.equal(iso(parseXmltvTime('20240101120000-0500')), '2024-01-01T17:00:00.000Z');
  assert.equal(iso(parseXmltvTime('20240101120000 +05:45')), '2024-01-01T06:15:00.000Z');
  assert.equal(iso(parseXmltvTime('20240101120000 Z')), '2024-01-01T12:00:00.000Z');
  assert.equal(iso(parseXmltvTime('202401011200 +0000')), '2024-01-01T12:00:00.000Z');
  assert.equal(iso(parseXmltvTime('20240101')), '2024-01-01T00:00:00.000Z');
  assert.ok(Number.isNaN(parseXmltvTime('garbage')));
  assert.ok(Number.isNaN(parseXmltvTime('20241301120000')));
});

test('timestamps without offset follow the configured policy', () => {
  // default: UTC per XMLTV convention
  assert.equal(iso(parseXmltvTime('20240701120000')), '2024-07-01T12:00:00.000Z');
  // a specific zone, including DST
  assert.equal(iso(parseXmltvTime('20240701120000', { mode: 'zone', zone: 'America/New_York' })), '2024-07-01T16:00:00.000Z');
  assert.equal(iso(parseXmltvTime('20240115120000', { mode: 'zone', zone: 'America/New_York' })), '2024-01-15T17:00:00.000Z');
  assert.equal(iso(parseXmltvTime('20240115120000', { mode: 'zone', zone: 'Europe/London' })), '2024-01-15T12:00:00.000Z');
  assert.equal(iso(parseXmltvTime('20240715120000', { mode: 'zone', zone: 'Europe/London' })), '2024-07-15T11:00:00.000Z');
});

test('DST gaps and overlaps resolve deterministically', () => {
  // US spring forward 2024-03-10 02:30 does not exist -> moves forward to 03:30 EDT (07:30Z)
  assert.equal(iso(zonedTimeToUtc(2024, 3, 10, 2, 30, 0, 'America/New_York')), '2024-03-10T07:30:00.000Z');
  // US fall back 2024-11-03 01:30 happens twice -> earlier (EDT, 05:30Z)
  assert.equal(iso(zonedTimeToUtc(2024, 11, 3, 1, 30, 0, 'America/New_York')), '2024-11-03T05:30:00.000Z');
  assert.equal(tzOffsetMs(Date.parse('2024-07-01T00:00:00Z'), 'America/New_York'), -4 * 3600_000);
});

test('guide layout is linear across a DST change (fall back has 25 hours)', () => {
  const start = zonedTimeToUtc(2024, 11, 3, 0, 0, 0, 'America/New_York');
  const end = zonedTimeToUtc(2024, 11, 4, 0, 0, 0, 'America/New_York');
  assert.equal((end - start) / 3600_000, 25);
  const ticks = halfHourTicks(start, start + 3 * 3600_000, (t) => floorToHalfHour(t, 'America/New_York'));
  const labels = ticks.map((t) => formatClock(t, { timeZone: 'America/New_York', hour12: false, locale: 'en-GB' }));
  // 01:00 and 01:30 appear twice, positions still strictly increasing
  assert.deepEqual(labels, ['0:00', '0:30', '1:00', '1:30', '1:00', '1:30', '2:00']);
});

test('programme progress', () => {
  assert.equal(programmeProgress(0, 100, -5), 0);
  assert.equal(programmeProgress(0, 100, 25), 0.25);
  assert.equal(programmeProgress(0, 100, 150), 1);
  assert.equal(programmeProgress(100, 100, 100), 0);
});

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv generator-info-name="test">
  <!-- a comment with <programme> inside should be ignored -->
  <channel id="demo.one"><display-name lang="en">Demo One</display-name><display-name>D1</display-name><icon src="http://i/1.png"/></channel>
  <channel id="demo.two"><display-name>Demo &amp; Two</display-name></channel>
  <programme start="20240101230000 +0000" stop="20240102010000 +0000" channel="demo.one">
    <title lang="fr">Le Film</title><title lang="en">The Late Movie</title>
    <sub-title>Part &lt;1&gt;</sub-title>
    <desc lang="en"><![CDATA[Crosses <midnight> & more]]></desc>
    <category>Movie</category><category>Drama</category>
    <episode-num system="xmltv_ns">1.4.0/1</episode-num>
    <rating system="MPAA"><value>PG</value></rating>
    <new/>
  </programme>
  <programme start="20240102010000 +0000" stop="20240102013000 +0000" channel="demo.one"><title>Short &#233;t&#xE9;</title></programme>
  <programme start="20240102010000 +0000" channel="demo.two"><title>No Stop</title></programme>
  <programme start="20240102020000 +0000" stop="20240102030000 +0000" channel="demo.two"><title>After</title></programme>
  <programme start="bad" stop="20240102030000 +0000" channel="demo.two"><title>Invalid</title></programme>
</tv>`;

test('parses XMLTV channels and programmes with entities, CDATA, languages, episodes', () => {
  const { channels, programmes, stats } = parseXmltv(SAMPLE, 's1', { lang: 'en' });
  assert.equal(channels.length, 2);
  assert.deepEqual(channels[0].displayNames, ['Demo One', 'D1']);
  assert.equal(channels[0].icon, 'http://i/1.png');
  assert.equal(channels[1].displayNames[0], 'Demo & Two');
  assert.equal(programmes.length, 4);
  assert.equal(stats.invalid, 1);
  const p = programmes[0];
  assert.equal(p.title, 'The Late Movie');
  assert.equal(p.subTitle, 'Part <1>');
  assert.equal(p.desc, 'Crosses <midnight> & more');
  assert.deepEqual(p.categories, ['Movie', 'Drama']);
  assert.equal(p.episode, 'S2 E5');
  assert.equal(p.rating, 'PG');
  assert.equal(p.isNew, true);
  assert.equal(programmes[1].title, 'Short été');
  assert.ok(Number.isNaN(programmes[2].stop));
});

test('streaming parser gives identical results for any chunk size', () => {
  const whole = parseXmltv(SAMPLE, 's1');
  for (const size of [1, 7, 33, 128]) {
    const progs: string[] = [];
    const chans: string[] = [];
    const parser = new XmltvParser('s1', { onChannel: (c) => chans.push(c.id), onProgramme: (p) => progs.push(p.title + p.start) });
    for (let i = 0; i < SAMPLE.length; i += size) parser.push(SAMPLE.slice(i, i + size));
    parser.end();
    assert.deepEqual(chans, whole.channels.map((c) => c.id), `chunk ${size}`);
    assert.deepEqual(progs, whole.programmes.map((p) => p.title + p.start), `chunk ${size}`);
  }
});

test('rejects non-XMLTV input', () => {
  assert.throws(() => parseXmltv('#EXTM3U\n#EXTINF:-1,a\nhttp://x\n'.repeat(60), 's'), /M3U/);
  assert.throws(() => parseXmltv('<html><body>nope</body></html>', 's'), /web page|XMLTV/);
  assert.throws(() => parseXmltv('{"json": true}', 's'), /XMLTV/);
});

test('time window filtering drops expired and far-future programmes', () => {
  const { programmes, stats } = parseXmltv(SAMPLE, 's', { minStop: Date.parse('2024-01-02T01:15:00Z'), maxStart: Date.parse('2024-01-02T01:30:00Z') });
  assert.deepEqual(programmes.map((p) => p.title), ['Short été', 'No Stop']);
  assert.equal(stats.droppedOutOfWindow, 2);
});

test('normalizeSchedule fills missing stops, clips overlaps, removes duplicates', () => {
  const base = Date.parse('2024-01-01T00:00:00Z');
  const m = 60_000;
  const out = normalizeSchedule([
    { ch: 'a', start: base + 60 * m, stop: base + 120 * m, title: 'B' },
    { ch: 'a', start: base, stop: base + 90 * m, title: 'A' }, // overlaps B
    { ch: 'a', start: base + 60 * m, stop: base + 120 * m, title: 'B' }, // duplicate
    { ch: 'a', start: base + 120 * m, stop: NaN, title: 'C' },
    { ch: 'a', start: base + 150 * m, stop: base + 180 * m, title: 'D' },
  ]);
  assert.deepEqual(out.map((p) => [p.title, (p.start - base) / m, (p.stop - base) / m]), [
    ['A', 0, 60], ['B', 60, 120], ['C', 120, 150], ['D', 150, 180],
  ]);
});

test('guide index lookups: current, next, range, prune, programme crossing midnight', () => {
  const g = new GuideIndex();
  const { programmes } = parseXmltv(SAMPLE, 's1', { lang: 'en' });
  g.set('s1|demo.one', programmes.filter((p) => p.ch === 'demo.one'));
  const atMidnight = Date.parse('2024-01-02T00:00:00Z');
  assert.equal(g.current('s1|demo.one', atMidnight)?.title, 'The Late Movie');
  assert.equal(g.next('s1|demo.one', atMidnight)?.title, 'Short été');
  assert.equal(programmeProgress(g.current('s1|demo.one', atMidnight)!.start, g.current('s1|demo.one', atMidnight)!.stop, atMidnight), 0.5);
  assert.equal(g.range('s1|demo.one', atMidnight, atMidnight + 3600_000 + 1).length, 2);
  assert.equal(g.current('s1|missing', atMidnight), undefined);
  // layout across midnight: 2h block starting 1h before window -> clipped
  const blocks = layoutRow(g.get('s1|demo.one'), atMidnight, atMidnight + 2 * 3600_000, 5);
  assert.equal(blocks[0].left, 0);
  assert.equal(blocks[0].width, 60 * 5);
  assert.equal(blocks[0].clippedStart, true);
  assert.equal(blocks[1].left, 60 * 5);
  assert.equal(g.prune(atMidnight + 3600_000), 1);
  assert.equal(g.get('s1|demo.one')[0].title, 'Short été');
});

test('episode formatting', () => {
  assert.equal(formatEpisode('xmltv_ns', '0.0.'), 'S1 E1');
  assert.equal(formatEpisode('xmltv_ns', '.9.'), 'E10');
  assert.equal(formatEpisode('xmltv_ns', '2.3.0/2'), 'S3 E4 Part 1/2');
  assert.equal(formatEpisode('onscreen', 'S03E07'), 'S3 E7');
  assert.equal(formatEpisode('dd_progid', 'EP012345'), undefined);
  assert.equal(decodeEntities('&#x1F4FA; &amp;amp;'), '📺 &amp;');
});

test('large XMLTV (2,000 channels x 48 programmes) parses quickly in chunks', () => {
  const parts: string[] = ['<?xml version="1.0"?><tv>'];
  for (let c = 0; c < 2000; c++) parts.push(`<channel id="c${c}"><display-name>Chan ${c}</display-name></channel>`);
  const t0 = Date.parse('2024-01-01T00:00:00Z');
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00 +0000`; };
  for (let c = 0; c < 2000; c++) for (let i = 0; i < 48; i++) parts.push(`<programme start="${ts(t0 + i * 1800_000)}" stop="${ts(t0 + (i + 1) * 1800_000)}" channel="c${c}"><title>Show ${i}</title><desc>Description for show ${i} on channel ${c}.</desc></programme>`);
  parts.push('</tv>');
  const xml = parts.join('\n');
  let n = 0;
  const start = performance.now();
  const parser = new XmltvParser('s', { onProgramme: () => n++ });
  for (let i = 0; i < xml.length; i += 65536) parser.push(xml.slice(i, i + 65536));
  parser.end();
  const ms = performance.now() - start;
  assert.equal(n, 96000);
  assert.ok(ms < 8000, `took ${ms}ms for ${(xml.length / 1e6).toFixed(1)}MB`);
});
