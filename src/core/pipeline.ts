import type { EpgChannel, EpgSource, ImportWarning, MatchResult, ParsedChannel, PlaylistSource, Programme, Settings } from './types';
import type { ProgrammeRecord, Repo } from './storage';
import { parseM3U } from './m3u';
import { XmltvParser, normalizeSchedule } from './xmltv';
import { epgRef, matchChannels } from './match';
import { cleanChannelNames } from './normalize';
import { yieldToLoop } from './util';

export type Progress = (p: { phase: string; bytes?: number; items?: number; detail?: string }) => void;

const VOD_URL = /\/(movie|movies|series|vod)\/|\.(mp4|mkv|avi|mov|wmv|flv|m4v)(\?|$)/i;

export interface PlaylistImportSummary {
  playlistId: string;
  channels: number;
  skippedVod: number;
  warnings: ImportWarning[];
  groups: { name: string; count: number }[];
  epgUrls: string[];
  missingLogos: number;
  withTvgId: number;
}

export interface IngestPlaylistOptions {
  skipVod?: boolean;
  onProgress?: Progress;
}

/** Parse playlist text and persist the channel list for `playlist`. */
export async function ingestPlaylist(repo: Repo, playlist: PlaylistSource, text: string, opts: IngestPlaylistOptions = {}): Promise<PlaylistImportSummary> {
  opts.onProgress?.({ phase: 'Parsing playlist', bytes: text.length });
  const res = parseM3U(text, {
    playlistId: playlist.id,
    onProgress: (n) => opts.onProgress?.({ phase: 'Parsing playlist', items: n }),
  });
  let channels = res.channels;
  let skippedVod = 0;
  if (opts.skipVod !== false) {
    const live = channels.filter((c) => !VOD_URL.test(c.url));
    skippedVod = channels.length - live.length;
    if (!live.length && channels.length) {
      // A VOD-only playlist: keep everything rather than importing nothing.
      skippedVod = 0;
    } else {
      channels = live.map((c, i) => ({ ...c, index: i }));
    }
  }
  const warnings = res.warnings.slice(0, 200);
  if (res.warnings.length > 200) warnings.push({ message: `…and ${res.warnings.length - 200} more warnings.` });
  if (skippedVod) warnings.unshift({ message: `${skippedVod} movie/series entries are in Movies and Shows (not the channel list).` });

  await repo.saveChannels({ playlistId: playlist.id, channels, warnings, importedAt: Date.now() });
  // Movies and shows in the playlist go to the Movies / Shows screens instead of the channel list.
  if (skippedVod) {
    const vod = res.channels.filter((c) => VOD_URL.test(c.url)).slice(0, 60_000).map((c) => ({ name: c.originalName, url: c.url, logo: c.tvgLogo, group: c.groupTitle }));
    await repo.setKv(`m3uVod:${playlist.id}`, vod).catch(() => undefined);
  } else {
    await repo.setKv(`m3uVod:${playlist.id}`, []).catch(() => undefined);
  }
  const groups = new Map<string, number>();
  for (const c of channels) groups.set(c.groupTitle || '(no group)', (groups.get(c.groupTitle || '(no group)') ?? 0) + 1);
  await repo.savePlaylist({
    ...playlist,
    lastImportAt: Date.now(),
    lastImportError: undefined,
    channelCount: channels.length,
    headerEpgUrl: res.epgUrls[0],
  });
  return {
    playlistId: playlist.id,
    channels: channels.length,
    skippedVod,
    warnings,
    groups: [...groups].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    epgUrls: res.epgUrls,
    missingLogos: channels.filter((c) => !c.tvgLogo).length,
    withTvgId: channels.filter((c) => c.tvgId).length,
  };
}

export interface EpgImportSummary {
  sourceId: string;
  channels: number;
  programmes: number;
  droppedOutOfWindow: number;
  invalid: number;
  coverageStart?: number;
  coverageEnd?: number;
}

export interface IngestEpgOptions {
  settings: Pick<Settings, 'naiveTimeMode' | 'naiveTimeZone' | 'epgKeepPastHours'>;
  /** Days of future guide data to keep (default 8). */
  futureDays?: number;
  now?: number;
  onProgress?: Progress;
  /** Flush buffered programmes to storage after this many (memory bound). */
  flushEvery?: number;
}

/**
 * Stream-parse XMLTV text chunks and persist channels + programmes for `source`.
 * Existing data for the source is replaced only for channels present in the new
 * file; stale channels are removed at the end, so a failed refresh keeps the cache.
 */
export async function ingestEpg(repo: Repo, source: EpgSource, chunks: AsyncIterable<string>, opts: IngestEpgOptions): Promise<EpgImportSummary> {
  const now = opts.now ?? Date.now();
  const minStop = now - (opts.settings.epgKeepPastHours ?? 3) * 3600_000;
  const maxStart = now + (opts.futureDays ?? 8) * 86400_000;
  const channels = new Map<string, EpgChannel>();
  let buckets = new Map<string, Programme[]>();
  let buffered = 0;
  const written = new Set<string>();
  const flushEvery = opts.flushEvery ?? 25000;
  let cStart = Infinity;
  let cEnd = -Infinity;

  const parser = new XmltvParser(source.id, {
    policy: { mode: opts.settings.naiveTimeMode, zone: opts.settings.naiveTimeZone },
    minStop,
    maxStart,
    onChannel: (c) => {
      if (!channels.has(c.id)) channels.set(c.id, c);
      else {
        const prev = channels.get(c.id)!;
        prev.displayNames = [...new Set([...prev.displayNames, ...c.displayNames])];
        prev.icon = prev.icon ?? c.icon;
      }
    },
    onProgramme: (p) => {
      let b = buckets.get(p.ch);
      if (!b) buckets.set(p.ch, (b = []));
      b.push(p);
      buffered++;
    },
  });

  const flush = async () => {
    if (!buffered) return;
    const refs = [...buckets.keys()].map((id) => epgRef(source.id, id));
    const existing = await repo.getProgrammes(refs.filter((r) => written.has(r)));
    const recs: ProgrammeRecord[] = [];
    for (const [id, list] of buckets) {
      const ref = epgRef(source.id, id);
      const merged = normalizeSchedule([...(existing.get(ref) ?? []), ...list]);
      if (merged.length) {
        if (merged[0].start < cStart) cStart = merged[0].start;
        if (merged[merged.length - 1].stop > cEnd) cEnd = merged[merged.length - 1].stop;
      }
      recs.push({ ref, sourceId: source.id, list: merged });
      written.add(ref);
    }
    await repo.putProgrammes(recs);
    buckets = new Map();
    buffered = 0;
  };

  let bytes = 0;
  let lastReport = 0;
  for await (const chunk of chunks) {
    parser.push(chunk);
    bytes += chunk.length;
    if (buffered >= flushEvery) await flush();
    if (bytes - lastReport > 1_000_000) {
      lastReport = bytes;
      opts.onProgress?.({ phase: 'Reading guide', bytes, items: parser.stats.programmes });
      await yieldToLoop();
    }
  }
  const stats = parser.end();
  await flush();

  // Remove programme records of channels that disappeared from this source.
  const prefix = source.id + '|';
  const stale = (await repo.backend.keys('programmes')).filter((k) => k.startsWith(prefix) && !written.has(k));
  await repo.backend.deleteMany('programmes', stale);
  await repo.saveEpgChannels({ sourceId: source.id, channels: [...channels.values()] });

  const summary: EpgImportSummary = {
    sourceId: source.id,
    channels: channels.size,
    programmes: stats.programmes,
    droppedOutOfWindow: stats.droppedOutOfWindow,
    invalid: stats.invalid,
    coverageStart: Number.isFinite(cStart) ? cStart : undefined,
    coverageEnd: Number.isFinite(cEnd) ? cEnd : undefined,
  };
  await repo.saveEpgSource({
    ...source,
    lastRefreshAt: Date.now(),
    lastAttemptAt: Date.now(),
    lastError: undefined,
    channelCount: summary.channels,
    programmeCount: summary.programmes,
    coverageStart: summary.coverageStart,
    coverageEnd: summary.coverageEnd,
  });
  return summary;
}

export interface LoadedData {
  playlists: PlaylistSource[];
  epgSources: EpgSource[];
  channels: ParsedChannel[];
  epgChannels: EpgChannel[];
}

export async function loadSources(repo: Repo): Promise<LoadedData> {
  const playlists = await repo.listPlaylists();
  const epgSources = await repo.listEpgSources();
  const channels: ParsedChannel[] = [];
  for (const p of playlists) {
    if (!p.enabled) continue;
    const rec = await repo.getChannels(p.id);
    if (rec) channels.push(...rec.channels);
  }
  const epgChannels: EpgChannel[] = [];
  for (const s of epgSources) {
    if (!s.enabled) continue;
    const rec = await repo.getEpgChannels(s.id);
    if (rec) epgChannels.push(...rec.channels);
  }
  return { playlists, epgSources, channels, epgChannels };
}

export interface MatchSummary {
  total: number;
  byMethod: Record<string, number>;
  pending: number;
  unmatched: number;
}

/** Recompute EPG matches for all enabled channels and store them. */
export async function recomputeMatches(repo: Repo, settings: Pick<Settings, 'fuzzyAutoApprove'>, data?: LoadedData): Promise<{ matches: Map<string, MatchResult>; summary: MatchSummary }> {
  const d = data ?? (await loadSources(repo));
  const decisions = await repo.getDecisions();
  const displayNames = cleanChannelNames(d.channels);
  const matches = matchChannels(d.channels, d.epgChannels, decisions, { fuzzyAutoApprove: settings.fuzzyAutoApprove, displayNames });
  await repo.setKv('matches', [...matches.values()]);
  const byMethod: Record<string, number> = {};
  let pending = 0;
  let unmatched = 0;
  for (const m of matches.values()) {
    byMethod[m.method] = (byMethod[m.method] ?? 0) + 1;
    if (m.status === 'pending') pending++;
    if (m.status === 'unmatched' || m.status === 'rejected') unmatched++;
  }
  return { matches, summary: { total: matches.size, byMethod, pending, unmatched } };
}

export async function loadMatches(repo: Repo): Promise<Map<string, MatchResult>> {
  const list = (await repo.getKv<MatchResult[]>('matches')) ?? [];
  return new Map(list.map((m) => [m.key, m]));
}

/** Async iterable of string chunks from a ReadableStream of text. */
export async function* textChunks(stream: ReadableStream<string>): AsyncIterable<string> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
