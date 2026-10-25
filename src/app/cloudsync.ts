// Keeps the open account's data with its cloud sign-in: on a new device the playlists, guides,
// favorites, teams, bets, Continue watching and settings come down and the channels load; changes
// made on any device go up a few seconds later.
import { cloudConfig, currentSession, loadProfile, saveProfile } from './cloud';
import { getState, refreshAll, reloadAll, repo, showTask, finishTask, subscribe, toast } from './state';
import type { ExportedSettings } from '../core/storage';
import { exportProfiles, mergeProfiles, onProfilesChanged, type ProfilesBundle } from './profiles';
import { resetResumeCache } from './vod';

/** Per-account values outside the settings export that should follow the account (profiles travel separately). */
const KV_KEYS = ['liveSports', 'reminders'];

export type SyncStatus = { state: 'off' | 'syncing' | 'ok' | 'error'; at?: number; message?: string };
let status: SyncStatus = { state: 'off' };
const statusListeners = new Set<(s: SyncStatus) => void>();
function setStatus(s: SyncStatus) {
  status = s;
  statusListeners.forEach((l) => l(s));
}
export function syncStatus(): SyncStatus {
  return status;
}
export function onSyncStatus(l: (s: SyncStatus) => void): () => void {
  statusListeners.add(l);
  return () => statusListeners.delete(l);
}

async function snapshot(): Promise<Record<string, unknown>> {
  const exp = await repo.exportSettings();
  const kv: Record<string, unknown> = {};
  for (const k of KV_KEYS) {
    const v = await repo.getKv(k).catch(() => undefined);
    if (v !== undefined) kv[k] = v;
  }
  return { export: exp, kv, profiles: await exportProfiles(), savedFrom: navigator.userAgent.includes('LTTV') || /Android/.test(navigator.userAgent) ? 'tv' : 'browser' };
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pushing = false;
let lastPushed = '';

export async function pushNow(): Promise<void> {
  if (!currentSession() || pushing) return;
  pushing = true;
  try {
    const data = await snapshot();
    // exportedAt changes every time; compare without it.
    const key = JSON.stringify({ ...data, export: { ...(data.export as ExportedSettings), exportedAt: '' } });
    if (key === lastPushed) return;
    setStatus({ state: 'syncing' });
    await saveProfile(data);
    lastPushed = key;
    setStatus({ state: 'ok', at: Date.now() });
  } catch (e) {
    setStatus({ state: 'error', message: (e as Error).message });
  } finally {
    pushing = false;
  }
}

function schedulePush(ms = 5000) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void pushNow(), ms);
}

/** Bring down what the account has that this device doesn't (sources are added by id / address). */
async function pull(): Promise<boolean> {
  const prof = await loadProfile();
  // Profiles (favorites, Continue watching, recents for each one) merge on every start, deletions included.
  const m = await mergeProfiles(prof?.data.profiles as ProfilesBundle | undefined);
  if (m.currentChanged) resetResumeCache();
  const profilesChanged = m.currentChanged;
  const exp = prof?.data.export as ExportedSettings | undefined;
  if (!exp || exp.app !== 'lttv') return false;
  const localPl = await repo.listPlaylists();
  const localEpg = await repo.listEpgSources();
  const fresh = !localPl.length;
  const same = (a: { id: string; url?: string }, b: { id: string; url?: string }) => a.id === b.id || (!!a.url && a.url === b.url);
  const newPl = (exp.playlists ?? []).filter((p) => p.kind !== 'file' && !localPl.some((l) => same(l, p)));
  const newEpg = (exp.epgSources ?? []).filter((e) => e.kind !== 'file' && !localEpg.some((l) => same(l, e)));
  if (!fresh && !newPl.length && !newEpg.length) return profilesChanged;
  await repo.importSettings({
    ...exp,
    // On a device that already has channels, only add the missing sources; keep its own settings.
    settings: fresh ? exp.settings : (await repo.getSettings()),
    playlists: newPl,
    epgSources: newEpg,
    customizations: fresh ? exp.customizations : [],
    decisions: fresh ? exp.decisions : [],
  });
  if (fresh) {
    const kv = (prof?.data.kv ?? {}) as Record<string, unknown>;
    for (const k of KV_KEYS) if (kv[k] !== undefined) await repo.setKv(k, kv[k]);
  }
  return newPl.length + newEpg.length > 0 || fresh;
}

let started = false;
/** Startup (when the open account is signed in): bring the account's data down, then keep it up to date. */
export async function startCloudSync(): Promise<void> {
  if (started || !cloudConfig() || !currentSession()) return;
  started = true;
  const id = 'cloud-sync';
  setStatus({ state: 'syncing' });
  try {
    const changed = await pull();
    if (changed) {
      showTask({ id, label: 'Loading your channels from your account…' });
      await reloadAll();
      await refreshAll();
      await reloadAll();
      showTask({ id, label: 'Your channels are ready', done: true });
      finishTask(id, 4000);
    }
    setStatus({ state: 'ok', at: Date.now() });
  } catch (e) {
    setStatus({ state: 'error', message: (e as Error).message });
    toast(`Couldn’t load your account: ${(e as Error).message}`, 'error', 8000);
  }
  // Upload when sources, settings or channel names/favorites change, and every few minutes (bets, progress).
  let prev = getState();
  onProfilesChanged(() => schedulePush(3000));
  subscribe(() => {
    const s = getState();
    if (s.playlists !== prev.playlists || s.epgSources !== prev.epgSources || s.settings !== prev.settings || s.lineup !== prev.lineup || s.recents !== prev.recents) schedulePush();
    prev = s;
  });
  setInterval(() => void pushNow(), 5 * 60_000);
  schedulePush(2000);
}
