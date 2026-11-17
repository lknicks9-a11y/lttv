/**
 * Your provider, shared between the LTTV apps on the same TV.
 * LTTV (Live TV & Sports) hands its playlists, guides and settings to the Fire TV host, which keeps
 * them for the other LTTV apps (Movies & Shows, League Pass, Blitz) — only apps signed like LTTV can
 * read them. Those apps take them on start, so you set up your provider once, in LTTV.
 */
import { APP_MODE } from './appmode';
import { native } from './platform';
import { repo, getState } from './state';

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

/** The other apps: take LTTV's provider when it's new or changed. True when something was imported. */
export async function pullFromLttv(): Promise<boolean> {
  if (APP_MODE === 'lttv' || !native?.sharedSetup) return false;
  let raw = '';
  try { raw = native.sharedSetup() || ''; } catch { return false; }
  if (!raw) return false;
  const data = JSON.parse(raw) as { exportedAt?: string };
  const stamp = String(data.exportedAt ?? '');
  const prev = await repo.getKv<string>('lttvSharedAt');
  if (getState().playlists.length > 0 && prev === stamp) return false;
  await repo.importSettings(data);
  await repo.setKv('lttvSharedAt', stamp);
  return true;
}

/** Is LTTV's provider available to this app? */
export function lttvHasSetup(): boolean {
  try { return !!native?.sharedSetup?.(); } catch { return false; }
}
