import { options } from 'preact';
import { sinceInput } from './core/yield';
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
import { preloadProfiles } from './app/profiles';
import './styles.css';

const OPENABLE: Screen[] = ['home', 'guide', 'sports', 'movies', 'shows', 'channels', 'search', 'settings'];

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
  if (APP_MODE === 'lttv') preloadProfiles();
  // League Pass / Blitz: the pass is the whole app, shown from the first moment (it fills in as your provider loads).
  if (isPassApp) setState({ leaguePass: true, passLeague: APP_MODE === 'leaguepass' ? 'nba' : 'nfl' });
  // A redraw that lands while you're pressing buttons waits for the next frame, so the move you just made is
  // drawn first (a redraw from background work used to hold the highlight back on slow TVs).
  options.debounceRendering = (cb) => {
    if (sinceInput() < 250) requestAnimationFrame(() => setTimeout(cb, 0));
    else void Promise.resolve().then(cb);
  };
  render(<App />, document.getElementById('app')!);
  document.getElementById('boot')?.remove();

  // Movies & Shows / League Pass / Blitz: take the provider you set up in LTTV first, so they open straight
  // into their own screen with your channels (no "set up LTTV" flash, no second load).
  let pulled = false;
  if (APP_MODE !== 'lttv') {
    try {
      pulled = await pullFromLttv();
    } catch (e) {
      console.warn('Couldn\'t take the provider from LTTV', e);
    }
  }
  try {
    await reloadAll();
  } catch (e) {
    console.error(e);
    setState({ ready: true });
    toast('Could not open local storage: ' + (e as Error).message, 'error', 10000);
    return;
  }
  // Quietly (no pop-ups): only playlists this app hasn't read yet.
  if (pulled) setTimeout(() => void refreshAll({ onlyStale: true }), 300);
  const s = getState().settings;
  applyTheme(s);
  // First launch: mandatory onboarding (sign in → profile → playlist).
  // Returning users who already signed in just sync.
  markFreshDevice(!getState().playlists.length);
  const hasPlaylists = getState().playlists.length > 0;
  if (APP_MODE === 'lttv' && !isOnboarded() && !hasPlaylists) {
    // Brand-new device / first time: the full onboarding flow.
    if (cloudConfig() && currentSession()) void startCloudSync();
    setState({ onboarding: true });
  } else if (cloudConfig() && APP_MODE === 'lttv') {
    if (currentSession()) void startCloudSync();
    else if (!signInSkipped()) setState({ signIn: true });
  }
  startSharing();
  // League Pass / Blitz / Movies & Shows: coming back to the app (it stayed open while you changed the provider in
  // LTTV) takes LTTV's provider again — nothing is read again unless it really changed.
  if (APP_MODE !== 'lttv') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      void pullFromLttv().then(async (changed) => { if (changed) { await reloadAll(); void refreshAll({ onlyStale: true }); } }).catch(() => undefined);
    });
  }
  // League Pass / Blitz start with only what they need (faster): no live-sports alerts, update checks or movie
  // library checks — LTTV and LTTV Home do those.
  if (APP_MODE === 'lttv') void startLiveSports();
  if (!isPassApp) {
    startUpdateChecks();
    startVodDetection();
  }
  // Movies & Shows lives in its own app now: LTTV doesn't read the movie library in the background (that lagged
  // live TV); Movies & Shows gets its pages ready right away instead.
  if (APP_MODE === 'movies') prefetchVodHomes(1_500);
  // A section asked for by LTTV Home (?screen=home|sports|search|settings) opens there and skips autoplay.
  const wanted = new URLSearchParams(location.search).get('screen');
  const opened = wanted && OPENABLE.includes(wanted as Screen) && !getState().onboarding ? (wanted as Screen) : null;
  if (opened) setState({ screen: opened });
  // Each app opens on its own part.
  if (!opened && APP_MODE === 'movies' && !getState().onboarding) setState({ screen: 'movies' });
  if (isPassApp) {
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
