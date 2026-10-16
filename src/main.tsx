import { h, Fragment } from 'preact';
import { startUpdateChecks } from './app/updates';
import { pollLive, startLiveSports } from './app/livesports';
import { render } from 'preact';
import { App } from './ui/App';
import { installNavigation, dispatchAppKey, goBack, type AppKey } from './app/nav';
import { reloadAll, applyTheme, getState, setState, repo, tune, startClock, refreshAll, toast, player, playRequest, updateSettings } from './app/state';
import { isTV, isNative } from './app/platform';
import { describeProgramme } from './app/describe';
import './styles.css';

async function boot() {
  document.documentElement.classList.toggle('tv', isTV);
  document.documentElement.classList.toggle('native', isNative);
  installNavigation();

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
  (window as unknown as { __lttv: unknown }).__lttv = { player, getState, repo, playRequest, tune, updateSettings, describe: describeProgramme, pollLive };
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
  void startLiveSports();
  startUpdateChecks();
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
