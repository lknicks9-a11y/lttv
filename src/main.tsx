import { h, Fragment } from 'preact';
import { startUpdateChecks } from './app/updates';
import { prefetchVodHomes, startVodDetection, saveProgress } from './app/vod';
import { pollLive, startLiveSports, addBet, addParlay, watchingSports } from './app/livesports';
import { render } from 'preact';
import { App } from './ui/App';
import { installNavigation, dispatchAppKey, goBack, type AppKey } from './app/nav';
import { addPlaylist, addEpgSource, reloadAll, applyTheme, applySavedTheme, getState, setState, repo, tune, startClock, refreshAll, toast, player, playRequest, updateSettings, rematchAndReload, navigate, type Screen } from './app/state';
import { isTV, isNative } from './app/platform';
import { describeProgramme } from './app/describe';
import { cloudConfig, currentSession, markFreshDevice } from './app/cloud';
import { startCloudSync } from './app/cloudsync';
import { signInSkipped } from './ui/SignIn';
import { isOnboarded } from './ui/Onboarding';
import { openPass } from './ui/LeaguePass';
import { serviceApp } from './app/services';
import './styles.css';

/** Sections of LTTV (Live TV + Sports) another app or tile may open. */
const OPENABLE: Screen[] = ['home', 'sports', 'channels', 'search', 'settings'];

/**
 * Open one of the LTTV apps on the Fire TV — they're all this one app:
 *  "tv" / "home" / "sports"… LTTV (Live TV + Sports) · "leaguepass" / "blitz" · "svc:<id>" a streaming
 *  service app ("LTTV Fresh"…). On the computer every section stays in one app. Returns whether it opened something.
 */
function openSection(name: string): boolean {
  const st = getState();
  if (st.onboarding) return false;
  const mode = st.appMode ?? 'all';
  const fresh = { screenStack: [] as Screen[], leaguePass: false, fullscreen: false };
  if (name.startsWith('svc:')) {
    const app = serviceApp(name.slice(4));
    if (!app) return false;
    setState({ ...fresh, appMode: isNative ? 'service' : 'all', serviceId: app.id, screen: 'service' });
    return true;
  }
  if (name === 'leaguepass' || name === 'blitz') {
    // Its own app: the Sports page sits behind it (never LTTV's Live TV).
    setState({ ...fresh, appMode: isNative ? 'pass' : mode, screen: isNative ? 'sports' : st.screen });
    openPass(name === 'blitz' ? 'nfl' : 'nba');
    return true;
  }
  // LTTV itself (Live TV + Sports).
  const wasOther = isNative && mode !== 'tv';
  if (isNative) setState({ appMode: 'tv' });
  if (name === 'tv') {
    if (wasOther) setState({ ...fresh, screen: 'home' });
    return wasOther;
  }
  if (OPENABLE.includes(name as Screen)) {
    setState({ leaguePass: false });
    if (wasOther) setState({ screenStack: [] });
    navigate(name as Screen, { replace: wasOther });
    return true;
  }
  return false;
}

async function boot() {
  document.documentElement.classList.toggle('tv', isTV);
  document.documentElement.classList.toggle('native', isNative);
  installNavigation();
  void import('./app/remote').then((m) => m.startRemoteBridge());

  // Keys forwarded by the Fire TV host (menu, media keys, back).
  window.lttvHost = window.lttvHost ?? ({} as NonNullable<Window['lttvHost']>);
  window.lttvHost.onKey = (key: string) => {
    if (key === 'back') {
      goBack();
      return;
    }
    dispatchAppKey(key as AppKey);
  };
  // The app tiles on the Fire TV (LTTV, LTTV Movies, LTTV Shows, the service apps, League Pass, Blitz)
  // and LTTV Home's buttons all open this one app on their part.
  window.lttvHost.openScreen = (name: string) => openSection(name);
  if (isNative) setState({ appMode: 'tv' });

  // Debug/test handle (used by the automated end-to-end test and Diagnostics).
  (window as unknown as { __lttv: unknown }).__lttv = { player, getState, repo, playRequest, tune, updateSettings, describe: describeProgramme, pollLive, saveProgress, addBet, addParlay, watchingSports, addPlaylist, addEpgSource, rematchAndReload };
  applySavedTheme();
  render(<App />, document.getElementById('app')!);
  document.getElementById('boot')?.remove();

  try {
    await reloadAll();
  } catch (e) {
    console.error(e);
    setState({ ready: true });
    toast('Could not open local storage: ' + (e as Error).message, 'error', 10000);
    return;
  }
  const s = getState().settings;
  applyTheme(s);
  const startScreen = new URLSearchParams(location.search).get('screen');
  // First launch: mandatory onboarding (sign in → profile → playlist).
  // Returning users who already signed in just sync.
  markFreshDevice(!getState().playlists.length);
  const hasPlaylists = getState().playlists.length > 0;
  if (!isOnboarded() && !hasPlaylists) {
    // Brand-new device / first time: the full onboarding flow.
    if (cloudConfig() && currentSession()) void startCloudSync();
    setState({ onboarding: true });
  } else if (cloudConfig()) {
    if (currentSession()) void startCloudSync();
    else if (!signInSkipped()) setState({ signIn: true });
  }
  void startLiveSports();
  startUpdateChecks();
  startVodDetection();
  prefetchVodHomes();
  const opened = startScreen && !getState().onboarding ? openSection(startScreen) : false;
  const start = opened ? undefined : s.startupScreen;
  if (!opened && (start === 'guide' || start === 'channels')) setState({ screen: start });
  const last = await repo.getKv<string>('lastChannel');
  if (last && getState().lineup.some((c) => c.key === last)) {
    if (start === 'last-channel') void tune(last, { fullscreen: true });
    else if (s.autoplayLastChannel && !opened) void tune(last);
    else setState({ currentKey: undefined });
  }
  startClock();
  // Refresh sources that are older than the configured interval, in the background.
  if (s.epgRefreshHours > 0) setTimeout(() => void refreshAll({ onlyStale: true }), 3000);
}

void boot();
