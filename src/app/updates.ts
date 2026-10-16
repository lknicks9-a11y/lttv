// In-app updates for the Fire TV / Android app: checks the GitHub release the build pipeline
// publishes ("LTTV for Fire TV — build N"), and when it is newer offers to install it. The app
// downloads the APK itself and opens the system installer, so no Downloader and no uninstalling.
import { useEffect, useState } from 'preact/hooks';
import { native, openRemote } from './platform';
import { toast } from './state';

/** GitHub repository whose latest release carries lttv.apk. */
export const UPDATE_REPO = 'lknicks9-a11y/lttv';

export interface UpdateInfo {
  build: number;
  current: number;
  url: string;
}

let available: UpdateInfo | null = null;
let dismissedBuild = 0;
let dismissedAt = 0;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function canUpdateInApp(): boolean {
  return !!native?.installUpdate && !!native.appBuild;
}

/** Version shown to people: 1.0.0 was build 19 (the launch), each later build adds 1 (build 20 = 1.0.1). */
export function versionOf(build: number): string {
  return `1.0.${Math.max(0, build - 19)}`;
}

export function currentBuild(): number {
  try {
    return native?.appBuild?.() ?? 0;
  } catch {
    return 0;
  }
}

/** Ask GitHub for the latest build; resolves to the update if it is newer than this app. */
export async function checkForUpdate(opts: { quiet?: boolean } = {}): Promise<UpdateInfo | null> {
  if (!canUpdateInApp()) return null;
  try {
    const { stream } = await openRemote(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, AbortSignal.timeout?.(20_000), { Accept: 'application/vnd.github+json' });
    const rel = JSON.parse(await new Response(stream).text()) as { name?: string; body?: string; assets?: { name?: string; browser_download_url?: string }[] };
    const build = Number(/build\s*(\d+)/i.exec(`${rel.name ?? ''} ${rel.body ?? ''}`)?.[1] ?? 0);
    const url = rel.assets?.find((a) => /\.apk$/i.test(a.name ?? ''))?.browser_download_url ?? `https://github.com/${UPDATE_REPO}/releases/latest/download/lttv.apk`;
    const current = currentBuild();
    if (build > current) {
      const isNew = available?.build !== build;
      available = { build, current, url };
      changed();
      // A short notice too, so it's seen even while watching full screen (the pop-up waits until you leave it).
      if (isNew && opts.quiet) toast(`LTTV ${versionOf(build)} is available — it installs over this one.`, 'info', 6000);
      return available;
    }
    if (!opts.quiet) toast(`LTTV is up to date (${versionOf(current)}).`, 'success', 3500);
    return null;
  } catch (e) {
    if (!opts.quiet) toast('Couldn’t check for updates: ' + (e as Error).message, 'error');
    return null;
  }
}

export function installUpdate(u: UpdateInfo) {
  toast('Downloading the update…', 'info', 4000);
  native?.installUpdate?.(u.url);
}

/** "Later": asks again in 3 hours (or right away when an even newer build is pushed). */
export function dismissUpdate() {
  if (available) {
    dismissedBuild = available.build;
    dismissedAt = Date.now();
  }
  changed();
}

/** The update to offer (null when none, or when "Later" was chosen for that build). */
export function useAvailableUpdate(): UpdateInfo | null {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  if (available && available.build === dismissedBuild && Date.now() - dismissedAt > 3 * 3600_000) dismissedBuild = 0;
  return available && available.build !== dismissedBuild ? available : null;
}

/** Check at startup, every 20 minutes and whenever the app comes back to the screen; show download / install progress. */
export function startUpdateChecks() {
  if (!canUpdateInApp()) return;
  window.lttvHost = window.lttvHost ?? ({} as NonNullable<Window['lttvHost']>);
  window.lttvHost.onUpdateEvent = (json: string) => {
    try {
      const ev = JSON.parse(json) as { state: string; percent?: number; error?: string };
      if (ev.state === 'downloading' && ev.percent !== undefined && ev.percent >= 0 && ev.percent % 25 === 0 && ev.percent < 100) toast(`Downloading the update… ${ev.percent}%`, 'info', 2500);
      else if (ev.state === 'permission') toast('Allow LTTV to install apps (switch it on), then press Back and choose “Update now” again.', 'info', 12000);
      else if (ev.state === 'installing') toast('Press “Install” to update LTTV. Your playlists and settings are kept.', 'success', 10000);
      else if (ev.state === 'error') toast('Update failed: ' + (ev.error ?? 'unknown error'), 'error', 8000);
    } catch {
      /* ignore */
    }
  };
  setTimeout(() => void checkForUpdate({ quiet: true }), 8_000);
  setInterval(() => void checkForUpdate({ quiet: true }), 20 * 60_000);
  let lastResume = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastResume > 60_000) {
      lastResume = Date.now();
      void checkForUpdate({ quiet: true });
    }
  });
}
