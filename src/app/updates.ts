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

/** The newest release on GitHub (also when it's the one installed), for the Update Center. */
export interface LatestRelease {
  build: number;
  url: string;
  publishedAt?: string;
  /** What's new: the change notes of that build. */
  notes: string[];
  checkedAt: number;
}

export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'installing' | 'permission' | 'browser' | 'error';
export interface UpdateStatus {
  phase: UpdatePhase;
  percent?: number;
  error?: string;
}
let latest: LatestRelease | null = null;
let status: UpdateStatus = { phase: 'idle' };
function setStatus(st: UpdateStatus) {
  status = st;
  changed();
}
export function updateStatus(): UpdateStatus {
  return status;
}
export function latestRelease(): LatestRelease | null {
  return latest;
}

/** The change notes of a build: the commit it was made from ("- " lines of its message). */
async function releaseNotes(body: string): Promise<string[]> {
  const sha = /\(([0-9a-f]{7,40})\)/.exec(body)?.[1];
  if (!sha) return [];
  try {
    const { stream } = await openRemote(`https://api.github.com/repos/${UPDATE_REPO}/commits/${sha}`, AbortSignal.timeout?.(15_000), { Accept: 'application/vnd.github+json' });
    const msg = String((JSON.parse(await new Response(stream).text()) as { commit?: { message?: string } }).commit?.message ?? '');
    const lines = msg.split('\n').filter((l) => !/^(co-authored-by|claude-session):/i.test(l.trim()));
    const title = lines[0]?.trim();
    // Bullet lines, joined with their wrapped continuation lines.
    const bullets: string[] = [];
    for (const l of lines.slice(1)) {
      if (/^\s*-\s+/.test(l)) bullets.push(l.replace(/^\s*-\s+/, '').trim());
      else if (l.trim() && bullets.length) bullets[bullets.length - 1] += ' ' + l.trim();
    }
    return bullets.length ? bullets : title ? [title] : [];
  } catch {
    return [];
  }
}

let available: UpdateInfo | null = null;
let dismissedBuild = 0;
let dismissedAt = 0;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function canUpdateInApp(): boolean {
  return !!native?.installUpdate && !!native.appBuild;
}

/** Version shown to people: 1.0.0 is build 34 (numbering restarted), each later build adds 1 (build 35 = 1.0.1). */
/** 1.0.x counted from build 34; from build 61 it's 1.1.0, and every tenth build moves the middle number (1.1.9 -> 1.2.0). */
export function versionOf(build: number): string {
  if (build < 61) return `1.0.${Math.max(0, build - 34)}`;
  const n = build - 61;
  return `1.${1 + Math.floor(n / 10)}.${n % 10}`;
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
    const rel = JSON.parse(await new Response(stream).text()) as { name?: string; body?: string; published_at?: string; assets?: { name?: string; browser_download_url?: string }[] };
    const build = Number(/build\s*(\d+)/i.exec(`${rel.name ?? ''} ${rel.body ?? ''}`)?.[1] ?? 0);
    const url = rel.assets?.find((a) => /\.apk$/i.test(a.name ?? ''))?.browser_download_url ?? `https://github.com/${UPDATE_REPO}/releases/latest/download/lttv.apk`;
    const current = currentBuild();
    const notes = latest?.build === build && latest.notes.length ? latest.notes : await releaseNotes(rel.body ?? '');
    latest = { build, url, publishedAt: rel.published_at, notes, checkedAt: Date.now() };
    changed();
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

export function installUpdate(u: { url: string }) {
  setStatus({ phase: 'downloading', percent: 0 });
  toast('Downloading the update…', 'info', 4000);
  native?.installUpdate?.(u.url);
}

/** Open the downloaded update's install screen again. */
export function reopenInstaller() {
  native?.resumeUpdate?.();
}

/** The update's download page in a browser (always works, even if the installer won't open). */
export function openDownloadPage(url = latest?.url ?? `https://github.com/${UPDATE_REPO}/releases/latest/download/lttv.apk`) {
  native?.openDownloadPage?.(url);
}

/** Check now from the Update Center (shows checking / result there). */
export async function checkNow(): Promise<void> {
  setStatus({ phase: 'checking' });
  await checkForUpdate({ quiet: true });
  if (status.phase === 'checking') setStatus({ phase: 'idle' });
}

/** Re-render when the update state changes. */
export function useUpdateState(): { status: UpdateStatus; latest: LatestRelease | null; available: UpdateInfo | null } {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { status, latest, available };
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
      if (ev.state === 'downloading') {
        setStatus({ phase: 'downloading', percent: ev.percent !== undefined && ev.percent >= 0 ? ev.percent : status.percent });
        if (ev.percent !== undefined && ev.percent >= 0 && ev.percent % 25 === 0 && ev.percent < 100) toast(`Downloading the update… ${ev.percent}%`, 'info', 2500);
      } else if (ev.state === 'permission') {
        setStatus({ phase: 'permission' });
        toast('Switch on “Allow from this source” for LTTV, then press Back — the install opens by itself.', 'info', 12000);
      } else if (ev.state === 'permission-needed') {
        setStatus({ phase: 'permission' });
        toast('Installing still isn’t allowed for LTTV. Open the Update Center in Settings to try again.', 'error', 8000);
      } else if (ev.state === 'installing') {
        setStatus({ phase: 'installing' });
        toast('Press “Install” to update LTTV. Your playlists and settings are kept.', 'success', 10000);
      } else if (ev.state === 'browser') {
        setStatus({ phase: 'browser' });
        toast('The installer didn’t open, so the download page opened instead — install the file from there.', 'info', 10000);
      } else if (ev.state === 'error') {
        setStatus({ phase: 'error', error: ev.error ?? 'unknown error' });
        toast('Update failed: ' + (ev.error ?? 'unknown error'), 'error', 8000);
      }
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
