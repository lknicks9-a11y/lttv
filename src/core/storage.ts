import type {
  ChannelCustomization, EpgChannel, EpgSource, MatchDecision, ParsedChannel, PlaylistSource, Programme, RecentEntry, Settings,
} from './types';
import { DEFAULT_SETTINGS } from './types';

export const STORES = ['kv', 'playlists', 'channels', 'epgSources', 'epgChannels', 'programmes', 'custom', 'decisions'] as const;
export type StoreName = (typeof STORES)[number];

/** Minimal async key-value interface with named stores. Implemented by IndexedDB (app) and memory/file (tests). */
export interface StorageBackend {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  getMany<T>(store: StoreName, keys: string[]): Promise<(T | undefined)[]>;
  getAll<T>(store: StoreName): Promise<T[]>;
  keys(store: StoreName): Promise<string[]>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  putMany(store: StoreName, entries: [string, unknown][]): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  deleteMany(store: StoreName, keys: string[]): Promise<void>;
  clear(store: StoreName): Promise<void>;
}

export class MemoryBackend implements StorageBackend {
  data = new Map<StoreName, Map<string, unknown>>();
  private s(store: StoreName) {
    let m = this.data.get(store);
    if (!m) this.data.set(store, (m = new Map()));
    return m;
  }
  private clone<T>(v: T): T {
    return v === undefined ? v : structuredClone(v);
  }
  async get<T>(store: StoreName, key: string) {
    return this.clone(this.s(store).get(key) as T | undefined);
  }
  async getMany<T>(store: StoreName, keys: string[]) {
    return keys.map((k) => this.clone(this.s(store).get(k) as T | undefined));
  }
  async getAll<T>(store: StoreName) {
    return [...this.s(store).values()].map((v) => this.clone(v as T));
  }
  async keys(store: StoreName) {
    return [...this.s(store).keys()];
  }
  async put(store: StoreName, key: string, value: unknown) {
    this.s(store).set(key, this.clone(value));
  }
  async putMany(store: StoreName, entries: [string, unknown][]) {
    for (const [k, v] of entries) this.s(store).set(k, this.clone(v));
  }
  async delete(store: StoreName, key: string) {
    this.s(store).delete(key);
  }
  async deleteMany(store: StoreName, keys: string[]) {
    for (const k of keys) this.s(store).delete(k);
  }
  async clear(store: StoreName) {
    this.s(store).clear();
  }
}

/** Per-channel programme record in the 'programmes' store, keyed by EPG ref. */
export interface ProgrammeRecord {
  ref: string;
  sourceId: string;
  list: Programme[];
}

export interface ChannelsRecord {
  playlistId: string;
  channels: ParsedChannel[];
  warnings?: { line?: number; message: string }[];
  importedAt: number;
}

export interface EpgChannelsRecord {
  sourceId: string;
  channels: EpgChannel[];
}

export interface ExportedSettings {
  app: 'lttv';
  version: 1;
  exportedAt: string;
  settings: Settings;
  playlists: PlaylistSource[];
  epgSources: EpgSource[];
  customizations: ChannelCustomization[];
  decisions: MatchDecision[];
  favorites: string[];
}

/** Typed repository over a StorageBackend. All persistence goes through here. */
export class Repo {
  constructor(public backend: StorageBackend) {}

  // ----- settings & kv -----
  async getSettings(): Promise<Settings> {
    const s = await this.backend.get<Partial<Settings>>('kv', 'settings');
    return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  }
  async saveSettings(s: Settings) {
    await this.backend.put('kv', 'settings', s);
  }
  async getKv<T>(key: string): Promise<T | undefined> {
    return this.backend.get<T>('kv', key);
  }
  async setKv(key: string, v: unknown) {
    await this.backend.put('kv', key, v);
  }

  async getRecents(): Promise<RecentEntry[]> {
    return (await this.backend.get<RecentEntry[]>('kv', 'recents')) ?? [];
  }
  async addRecent(key: string, max = 30): Promise<RecentEntry[]> {
    const list = (await this.getRecents()).filter((r) => r.key !== key);
    list.unshift({ key, at: Date.now() });
    const trimmed = list.slice(0, max);
    await this.backend.put('kv', 'recents', trimmed);
    return trimmed;
  }

  // ----- playlists -----
  async listPlaylists(): Promise<PlaylistSource[]> {
    return (await this.backend.getAll<PlaylistSource>('playlists')).sort((a, b) => a.createdAt - b.createdAt);
  }
  async savePlaylist(p: PlaylistSource) {
    await this.backend.put('playlists', p.id, p);
  }
  async deletePlaylist(id: string) {
    await this.backend.delete('playlists', id);
    await this.backend.delete('channels', id);
  }
  async saveChannels(rec: ChannelsRecord) {
    await this.backend.put('channels', rec.playlistId, rec);
  }
  async getChannels(playlistId: string) {
    return this.backend.get<ChannelsRecord>('channels', playlistId);
  }

  // ----- EPG -----
  async listEpgSources(): Promise<EpgSource[]> {
    return (await this.backend.getAll<EpgSource>('epgSources')).sort((a, b) => a.createdAt - b.createdAt);
  }
  async saveEpgSource(s: EpgSource) {
    await this.backend.put('epgSources', s.id, s);
  }
  async deleteEpgSource(id: string) {
    await this.backend.delete('epgSources', id);
    await this.backend.delete('epgChannels', id);
    await this.clearProgrammes(id);
  }
  async saveEpgChannels(rec: EpgChannelsRecord) {
    await this.backend.put('epgChannels', rec.sourceId, rec);
  }
  async getEpgChannels(sourceId: string) {
    return this.backend.get<EpgChannelsRecord>('epgChannels', sourceId);
  }
  async clearProgrammes(sourceId: string) {
    const prefix = sourceId + '|';
    const keys = (await this.backend.keys('programmes')).filter((k) => k.startsWith(prefix));
    await this.backend.deleteMany('programmes', keys);
  }
  async putProgrammes(records: ProgrammeRecord[]) {
    await this.backend.putMany('programmes', records.map((r) => [r.ref, r]));
  }
  async getProgrammes(refs: string[]): Promise<Map<string, Programme[]>> {
    const out = new Map<string, Programme[]>();
    const recs = await this.backend.getMany<ProgrammeRecord>('programmes', refs);
    recs.forEach((r, i) => {
      if (r) out.set(refs[i], r.list);
    });
    return out;
  }
  /** Remove programmes that ended before `before`; deletes empty records. */
  async pruneProgrammes(before: number): Promise<number> {
    let removed = 0;
    const all = await this.backend.getAll<ProgrammeRecord>('programmes');
    const updates: [string, unknown][] = [];
    const deletes: string[] = [];
    for (const r of all) {
      const kept = r.list.filter((p) => p.stop > before);
      if (kept.length === r.list.length) continue;
      removed += r.list.length - kept.length;
      if (kept.length) updates.push([r.ref, { ...r, list: kept }]);
      else deletes.push(r.ref);
    }
    if (updates.length) await this.backend.putMany('programmes', updates);
    if (deletes.length) await this.backend.deleteMany('programmes', deletes);
    return removed;
  }

  // ----- customisations & decisions -----
  async getCustomizations(): Promise<Map<string, ChannelCustomization>> {
    const all = await this.backend.getAll<ChannelCustomization>('custom');
    return new Map(all.map((c) => [c.key, c]));
  }
  async saveCustomization(c: ChannelCustomization) {
    const empty = !c.name && c.number === undefined && !c.hidden && !c.favorite && !c.category && c.order === undefined;
    if (empty) await this.backend.delete('custom', c.key);
    else await this.backend.put('custom', c.key, c);
  }
  async saveCustomizations(list: ChannelCustomization[]) {
    await this.backend.putMany('custom', list.map((c) => [c.key, c]));
  }
  async getDecisions(): Promise<Map<string, MatchDecision>> {
    const all = await this.backend.getAll<MatchDecision>('decisions');
    return new Map(all.map((d) => [d.key, d]));
  }
  async saveDecision(d: MatchDecision) {
    await this.backend.put('decisions', d.key, d);
  }
  async deleteDecision(key: string) {
    await this.backend.delete('decisions', key);
  }

  // ----- maintenance -----
  async clearGuideCache() {
    await this.backend.clear('programmes');
    for (const s of await this.listEpgSources()) {
      await this.saveEpgSource({ ...s, lastRefreshAt: undefined, programmeCount: 0, coverageStart: undefined, coverageEnd: undefined });
    }
  }
  async resetAll() {
    for (const s of ['kv', 'playlists', 'channels', 'epgSources', 'epgChannels', 'programmes', 'custom', 'decisions'] as StoreName[]) {
      await this.backend.clear(s);
    }
  }

  async exportSettings(): Promise<ExportedSettings> {
    const custom = [...(await this.getCustomizations()).values()];
    return {
      app: 'lttv',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: await this.getSettings(),
      playlists: await this.listPlaylists(),
      epgSources: await this.listEpgSources(),
      customizations: custom,
      decisions: [...(await this.getDecisions()).values()],
      favorites: custom.filter((c) => c.favorite).map((c) => c.key),
    };
  }

  /** Import an export; playlists/EPG sources are added (needing a refresh), customisations merged. */
  async importSettings(data: unknown): Promise<{ playlists: number; epg: number; customizations: number }> {
    const d = data as Partial<ExportedSettings>;
    if (!d || d.app !== 'lttv' || d.version !== 1) throw new Error('This is not an LTTV settings file.');
    if (d.settings) await this.saveSettings({ ...DEFAULT_SETTINGS, ...d.settings });
    for (const p of d.playlists ?? []) await this.savePlaylist({ ...p, lastImportAt: undefined });
    for (const e of d.epgSources ?? []) await this.saveEpgSource({ ...e, lastRefreshAt: undefined });
    if (d.customizations?.length) await this.saveCustomizations(d.customizations);
    for (const dec of d.decisions ?? []) await this.saveDecision(dec);
    return { playlists: d.playlists?.length ?? 0, epg: d.epgSources?.length ?? 0, customizations: d.customizations?.length ?? 0 };
  }
}
