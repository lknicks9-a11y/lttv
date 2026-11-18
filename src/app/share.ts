/**
 * Your provider, shared between the LTTV apps on the same TV.
 * LTTV (Live TV & Sports) hands its playlists, guides and settings to the Fire TV host, which keeps
 * them for the other LTTV apps (Movies & Shows, League Pass, Blitz) — only apps signed like LTTV can
 * read them. Those apps take them on start, so you set up your provider once, in LTTV.
 */
import { APP_MODE } from './appmode';
import { native } from './platform';
import { repo } from './state';

let lastShared = '';

export async function shareToApps(): Promise<void> {
  if (APP_MODE !== 'lttv' || !native?.shareSetup) return;
  const data = await repo.exportSettings();
  const sameAsBefore = JSON.stringify({ ...data, exportedAt: undefined });
  if (sameAsBefore === lastShared) return;
  lastShared = sameAsBefore;
  native.shareSetup(JSON.stringify(data));
}

export function startSharing(): void {
  if (APP_MODE !== 'lttv') return;
  void shareToApps().catch(() => undefined);
  setInterval(() => void shareToApps().catch(() => undefined), 60_000);
}

/** A short fingerprint of some JSON (to tell whether LTTV's setup really changed). */
function hash(v: unknown): string {
  const t = JSON.stringify(v ?? null);
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + ':' + t.length;
}

/**
 * The other apps: take LTTV's provider when it really changed. True when your playlists / guides changed (they
 * have to be read again); settings alone (the computer's address for League Pass photos and songs, colours…)
 * are applied right away without reading anything again. LTTV re-sharing the same setup changes nothing.
 */
export async function pullFromLttv(): Promise<boolean> {
  if (APP_MODE === 'lttv' || !native?.sharedSetup) return false;
  let raw = '';
  try { raw = native.sharedSetup() || ''; } catch { return false; }
  if (!raw) return false;
  const data = JSON.parse(raw) as { settings?: Record<string, unknown>; playlists?: { id: string; url?: string; enabled?: boolean }[]; epgSources?: { id: string; url?: string; enabled?: boolean }[]; exportedAt?: string };
  const sources = hash([(data.playlists ?? []).map((p) => [p.id, p.url, p.enabled]), (data.epgSources ?? []).map((e) => [e.id, e.url, e.enabled])]);
  const all = hash({ ...data, exportedAt: undefined });
  const [prevAll, prevSources] = await Promise.all([repo.getKv<string>('lttvSharedHash'), repo.getKv<string>('lttvSharedSources')]);
  const have = (await repo.listPlaylists().catch(() => [])).length;
  if (have > 0 && prevAll === all) return false;
  if (have > 0 && prevSources === sources) {
    // Same provider: only settings / customisations changed — apply them, read nothing again.
    if (data.settings) await repo.saveSettings({ ...(await repo.getSettings()), ...data.settings } as Awaited<ReturnType<typeof repo.getSettings>>);
    await repo.setKv('lttvSharedHash', all);
    return false;
  }
  await repo.importSettings(data);
  await repo.setKv('lttvSharedHash', all);
  await repo.setKv('lttvSharedSources', sources);
  return true;
}

/** Is LTTV's provider available to this app? */
export function lttvHasSetup(): boolean {
  try { return !!native?.sharedSetup?.(); } catch { return false; }
}
