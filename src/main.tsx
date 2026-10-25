import { h, Fragment } from 'preact';
import { startUpdateChecks } from './app/updates';
import { prefetchVodHomes, startVodDetection, saveProgress } from './app/vod';
import { pollLive, startLiveSports, addBet, addParlay, watchingSports } from './app/livesports';
import { render } from 'preact';
import { App } from './ui/App';
import { installNavigation, dispatchAppKey, goBack, type AppKey } from './app/nav';
import { addPlaylist, addEpgSource, reloadAll, applyTheme, applySavedTheme, getState, setState, repo, tune, startClock, refreshAll, toast, player, playRequest, updateSettings, rematchAndReload } from './app/state';
import { isTV, isNative } from './app/platform';
import { describeProgramme } from './app/describe';
import { cloudConfig, currentSession, markFreshDevice } from './app/cloud';
import { startCloudSync } from './app/cloudsync';
import { signInSkipped } from './ui/SignIn';
import { isOnboarded } from './ui/Onboarding';
import './styles.css';

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

  // Debug/test handle (used by the automated end-to-end test and Diagnostics).
  (window as unknown as { __lttv: unknown }).__lttv = { player, getState, repo, playRequest, tune, updateSettings, describe: describeProgramme, pollLive, saveProgress, addBet, addParlay, watchingSports, addPlaylist, addEpgSource, rematchAndReload };
  applySavedTheme();
  render(<App />, document.getElementById('app')!);

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
  const start = s.startupScreen;
  if (start === 'guide' || start === 'channels') setState({ screen: start });
  const last = await repo.getKv<string>('lastChannel');
  if (last && getState().lineup.some((c) => c.key === last)) {
    if (start === 'last-channel') void tune(last, { fullscreen: true });
    else if (s.autoplayLastChannel) void tune(last);
    else setState({ currentKey: undefined });
  }
  startClock();
  // Refresh sources that are older than the configured interval, in the background.
  if (s.epgRefreshHours > 0) setTimeout(() => void refreshAll({ onlyStale: true }), 3000);
}

void boot();
