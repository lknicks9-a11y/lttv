import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryBackend, Repo, type StorageBackend, type StoreName } from '../src/core/storage';
import { ingestPlaylist, ingestEpg, recomputeMatches, loadMatches, loadSources } from '../src/core/pipeline';
import { buildLineup } from '../src/core/organize';
import { GuideIndex } from '../src/core/guide';
import { isUsableMatch } from '../src/core/match';
import type { EpgSource, PlaylistSource } from '../src/core/types';

/** File-backed backend: simulates an app restart by re-reading a JSON file from disk. */
class JsonFileBackend extends MemoryBackend implements StorageBackend {
  constructor(private file: string) {
    super();
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, [string, unknown][]>;
      for (const [s, entries] of Object.entries(raw)) this.data.set(s as StoreName, new Map(entries));
    }
  }
  private save() {
    const out: Record<string, [string, unknown][]> = {};
    for (const [s, m] of this.data) out[s] = [...m];
    writeFileSync(this.file, JSON.stringify(out));
  }
  async put(s: StoreName, k: string, v: unknown) { await super.put(s, k, v); this.save(); }
  async putMany(s: StoreName, e: [string, unknown][]) { await super.putMany(s, e); this.save(); }
  async delete(s: StoreName, k: string) { await super.delete(s, k); this.save(); }
  async deleteMany(s: StoreName, k: string[]) { await super.deleteMany(s, k); this.save(); }
  async clear(s: StoreName) { await super.clear(s); this.save(); }
}

const NOW = Date.parse('2024-03-01T12:00:00Z');
const pl: PlaylistSource = { id: 'pl1', name: 'Test', kind: 'file', fileName: 'test.m3u', epgIds: ['ep1'], enabled: true, createdAt: 1 };
const src: EpgSource = { id: 'ep1', name: 'Guide', kind: 'file', fileName: 'g.xml', enabled: true, createdAt: 1 };

const M3U = `#EXTM3U
#EXTINF:-1 tvg-id="demo.news" group-title="News",DEMO: Demo News
http://s/news.m3u8
#EXTINF:-1 group-title="Sports",DEMO: Demo Sport Center
http://s/sport.m3u8
#EXTINF:-1 group-title="Movies",DEMO: No Guide Movies
http://s/movies.m3u8
#EXTINF:-1,Some Film
http://s/movie/123.mp4
`;

function ts(t: number) {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00 +0000`;
}
function xml() {
  const parts = ['<?xml version="1.0"?><tv>', '<channel id="demo.news"><display-name>Demo News</display-name></channel>',
    '<channel id="demo.sports"><display-name>Demo Sports Centre</display-name></channel>'];
  for (let i = -10; i < 30; i++) {
    parts.push(`<programme start="${ts(NOW + i * 3600_000)}" stop="${ts(NOW + (i + 1) * 3600_000)}" channel="demo.news"><title>News ${i}</title></programme>`);
    parts.push(`<programme start="${ts(NOW + i * 3600_000)}" stop="${ts(NOW + (i + 1) * 3600_000)}" channel="demo.sports"><title>Sport ${i}</title></programme>`);
  }
  parts.push('</tv>');
  return parts.join('\n');
}
async function* chunked(s: string, size = 500) {
  for (let i = 0; i < s.length; i += size) yield s.slice(i, i + size);
}

test('full import pipeline + restart restores lineup, guide, matches and customisations', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lttv-'));
  const file = join(dir, 'db.json');
  {
    const repo = new Repo(new JsonFileBackend(file));
    await repo.savePlaylist(pl);
    await repo.saveEpgSource(src);
    const sum = await ingestPlaylist(repo, pl, M3U);
    assert.equal(sum.channels, 3);
    assert.equal(sum.skippedVod, 1);
    const esum = await ingestEpg(repo, src, chunked(xml()), { settings: { naiveTimeMode: 'utc', naiveTimeZone: '', epgKeepPastHours: 3 }, now: NOW, flushEvery: 7 });
    assert.equal(esum.channels, 2);
    assert.equal(esum.droppedOutOfWindow, 12, '6 expired programmes per channel dropped');
    const { summary } = await recomputeMatches(repo, { fuzzyAutoApprove: 0 });
    assert.equal(summary.byMethod['tvg-id'], 1);
    assert.equal(summary.pending, 1, '"Sport Center" vs "Sports Centre" needs approval');
    assert.equal(summary.unmatched, 1);
    const settings = await repo.getSettings();
    await repo.saveSettings({ ...settings, sortMode: 'alpha' });
    const data = await loadSources(repo);
    const sport = data.channels.find((c) => /Sport/.test(c.originalName))!;
    await repo.saveCustomization({ key: sport.key, favorite: true, name: 'My Sport' });
    const m = await loadMatches(repo);
    await repo.saveDecision({ key: sport.key, epgChannelId: m.get(sport.key)!.epgChannelId, status: 'approved', decidedAt: NOW });
    await repo.addRecent(sport.key);
  }
  // ---- "restart": brand new objects reading from disk ----
  {
    const repo = new Repo(new JsonFileBackend(file));
    assert.equal((await repo.getSettings()).sortMode, 'alpha');
    const data = await loadSources(repo);
    const { matches } = await recomputeMatches(repo, { fuzzyAutoApprove: 0 }, data);
    const lineup = buildLineup({ channels: data.channels, customizations: await repo.getCustomizations(), matches });
    const sport = lineup.find((c) => c.originalName.includes('Sport'))!;
    assert.equal(sport.name, 'My Sport');
    assert.equal(sport.favorite, true);
    assert.equal(sport.matchStatus, 'approved');
    assert.equal(lineup.find((c) => c.originalName.includes('Demo News'))!.name, 'Demo News', 'redundant DEMO: prefix cleaned');
    const refs = lineup.filter((c) => isUsableMatch(matches.get(c.key))).map((c) => c.epgChannelId!);
    const progs = await repo.getProgrammes(refs);
    const g = new GuideIndex();
    for (const [r, l] of progs) g.setNormalized(r, l);
    assert.equal(g.current(sport.epgChannelId, NOW + 60_000)?.title, 'Sport 0');
    assert.equal((await repo.getRecents())[0].key, sport.key);
    assert.equal(g.current(lineup.find((c) => c.originalName.includes('No Guide'))!.epgChannelId, NOW), undefined);

    // Re-import with rotated tokens keeps customisations (stable keys)
    await ingestPlaylist(repo, pl, M3U.replace(/\.m3u8/g, '.m3u8?token=new'));
    const again = buildLineup({ channels: (await loadSources(repo)).channels, customizations: await repo.getCustomizations(), matches });
    assert.equal(again.find((c) => c.originalName.includes('Sport'))!.name, 'My Sport');

    // Pruning removes expired programmes
    const removed = await repo.pruneProgrammes(NOW + 5 * 3600_000);
    assert.ok(removed > 0);
    // Export / import of settings round-trips
    const exp = await repo.exportSettings();
    const repo2 = new Repo(new MemoryBackend());
    const res = await repo2.importSettings(JSON.parse(JSON.stringify(exp)));
    assert.equal(res.playlists, 1);
    assert.equal((await repo2.getSettings()).sortMode, 'alpha');
    await assert.rejects(repo2.importSettings({ foo: 1 }), /not an LTTV/);
  }
});

test('a failed guide refresh keeps the previous cache', async () => {
  const repo = new Repo(new MemoryBackend());
  await repo.saveEpgSource(src);
  const settings = { naiveTimeMode: 'utc' as const, naiveTimeZone: '', epgKeepPastHours: 3 };
  await ingestEpg(repo, src, chunked(xml()), { settings, now: NOW });
  const before = (await repo.backend.keys('programmes')).length;
  await assert.rejects(ingestEpg(repo, src, chunked('<html><body>502 Bad Gateway</body></html>'), { settings, now: NOW }));
  assert.equal((await repo.backend.keys('programmes')).length, before);
});

test('invalid playlist text produces a clear error and leaves storage untouched', async () => {
  const repo = new Repo(new MemoryBackend());
  await assert.rejects(ingestPlaylist(repo, pl, '<!DOCTYPE html><html>login</html>'), /web page/);
  assert.equal(await repo.getChannels(pl.id), undefined);
});
