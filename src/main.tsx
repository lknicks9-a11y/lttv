import { h, Fragment } from 'preact';
import { startUpdateChecks } from './app/updates';
import { prefetchVodHomes, startVodDetection, saveProgress } from './app/vod';
import { pollLive, startLiveSports, addBet, addParlay, watchingSports } from './app/livesports';
import { render } from 'preact';
import { App } from './ui/App';
import { installNavigation, dispatchAppKey, goBack, type AppKey } from './app/nav';
import { addPlaylist, addEpgSource, reloadAll, applyTheme, applySavedTheme, getState, setState, repo, tune, startClock, refreshAll, toast, player, playRequest, updateSettings, rematchAndReload, type Screen } from './app/state';
import { isTV, isNative } from './app/platform';
import { describeProgramme } from './app/describe';
import { cloudConfig, currentSession, markFreshDevice } from './app/cloud';
import { startCloudSync } from './app/cloudsync';
import { signInSkipped } from './ui/SignIn';
import { isOnboarded } from './ui/Onboarding';
import { APP_MODE, isPassApp } from './app/appmode';
import { pullFromLttv, startSharing } from './app/share';
import { openPass } from './ui/LeaguePass';
import './styles.css';

const OPENABLE: Screen[] = ['home', 'sports', 'movies', 'shows', 'channels', 'search', 'settings'];

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
  // LTTV Home opens a section of LTTV via its app tile / nav (extra "screen").
  window.lttvHost.openScreen = (name: string) => {
    if (OPENABLE.includes(name as Screen) && !getState().onboarding) {
      setState({ screen: name as Screen, fullscreen: false });
    }
  };

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
  // Movies & Shows / League Pass / Blitz: use the provider you set up in LTTV.
  if (APP_MODE !== 'lttv') {
    try {
      if (await pullFromLttv()) {
        await reloadAll();
        setTimeout(() => void refreshAll(), 300);
      }
    } catch (e) {
      console.warn('Couldn\'t take the provider from LTTV', e);
    }
  }
  const s = getState().settings;
  applyTheme(s);
  // First launch: mandatory onboarding (sign in → profile → playlist).
  // Returning users who already signed in just sync.
  markFreshDevice(!getState().playlists.length);
  const hasPlaylists = getState().playlists.length > 0;
  if (!isOnboarded() && !hasPlaylists) {
    // Brand-new device / first time: the full onboarding flow.
    if (cloudConfig() && currentSession()) void startCloudSync();
    setState({ onboarding: true });
  } else if (cloudConfig() && APP_MODE === 'lttv') {
    if (currentSession()) void startCloudSync();
    else if (!signInSkipped()) setState({ signIn: true });
  }
  startSharing();
  if (APP_MODE !== 'movies') void startLiveSports();
  startUpdateChecks();
  startVodDetection();
  // Movies & Shows lives in its own app now: LTTV doesn't read the movie library in the background (that lagged
  // live TV); Movies & Shows gets its pages ready right away instead.
  if (APP_MODE === 'movies') prefetchVodHomes(1_500);
  // A section asked for by LTTV Home (?screen=home|sports|search|settings) opens there and skips autoplay.
  const wanted = new URLSearchParams(location.search).get('screen');
  const opened = wanted && OPENABLE.includes(wanted as Screen) && !getState().onboarding ? (wanted as Screen) : null;
  if (opened) setState({ screen: opened });
  // Each app opens on its own part.
  if (!opened && APP_MODE === 'movies' && !getState().onboarding) setState({ screen: 'movies' });
  if (isPassApp && !getState().onboarding) {
    openPass(APP_MODE === 'leaguepass' ? 'nba' : 'nfl');
    // Closing League Pass / Blitz closes the app (there's nothing behind it).
    let wasOpen = true;
    setInterval(() => {
      const open = !!getState().leaguePass;
      if (wasOpen && !open) window.LTTVNative?.exitApp?.();
      wasOpen = open;
    }, 400);
  }
  const start = opened || APP_MODE !== 'lttv' ? undefined : s.startupScreen;
  if (!opened && (start === 'guide' || start === 'channels')) setState({ screen: start });
  const last = await repo.getKv<string>('lastChannel');
  if (APP_MODE === 'lttv' && last && getState().lineup.some((c) => c.key === last)) {
    if (opened) setState({ currentKey: undefined });
    else if (start === 'last-channel') void tune(last, { fullscreen: true });
    else if (s.autoplayLastChannel) void tune(last);
    else setState({ currentKey: undefined });
  }
  startClock();
  // Refresh sources that are older than the configured interval, in the background.
  if (s.epgRefreshHours > 0) setTimeout(() => void refreshAll({ onlyStale: true }), 3000);
}

void boot();
