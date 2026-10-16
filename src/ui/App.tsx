import { h, Fragment } from 'preact';
import { LiveNotices } from './Fantasy';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useApp, navigate, screenBack, setState, getState, player, type Screen, tune, zapList, toggleFavorite } from '../app/state';
import { onAppKey, onBack, focusFirst } from '../app/nav';
import { adjacentChannel } from '../core/organize';
import { native, isNative } from '../app/platform';
import { Icon } from './common';
import { LogoMark, Wordmark } from './Logo';
import { clock } from './fmt';
import { GuideScreen } from './Guide';
import { ChannelsScreen, ChannelMenu } from './Channels';
import { SearchScreen } from './Search';
import { SourcesScreen } from './Sources';
import { ImportWizard } from './Wizard';
import { MatchesScreen } from './Matches';
import { SettingsScreen } from './Settings';
import { PlayerOverlay } from './Player';
import { ProgrammeDetail } from './Detail';
import { SportsScreen, ReminderPrompt } from './Sports';

const NAV: { id: Screen; label: string; icon: string }[] = [
  { id: 'home', label: 'Live TV', icon: 'guide' },
  { id: 'sports', label: 'Sports', icon: 'sports' },
  { id: 'channels', label: 'Channels', icon: 'channels' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'sources', label: 'Sources', icon: 'sources' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

function Sidebar() {
  const screen = useApp((s) => s.screen);
  const now = useApp((s) => s.now);
  const active = screen === 'matches' || screen === 'wizard' ? 'sources' : screen === 'guide' ? 'home' : screen;
  return (
    <nav class="sidebar" data-group="sidebar" data-zone aria-label="Main">
      <div class="brand" aria-label="LTTV">
        <LogoMark size="4.6rem" />
        <Wordmark class="brand-text" />
      </div>
      <div class="nav-items">
        {NAV.map((n) => (
          <button
            type="button"
            class={`f nav-item ${active === n.id ? 'active' : ''}`}
            data-default-focus={active === n.id ? '' : undefined}
            aria-current={active === n.id ? 'page' : undefined}
            onClick={() => navigate(n.id)}
          >
            <Icon name={n.icon} size="1.9rem" />
            <span class="nav-label">{n.label}</span>
          </button>
        ))}
      </div>
      <div class="sidebar-clock">{clock(now)}</div>
    </nav>
  );
}

function LoadingScreen() {
  const phase = useApp((s) => s.loadingPhase);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div class="loading-screen">
      <div class="row gap"><span class="spinner big" /> Loading your lineup…</div>
      {slow && (
        <div class="loading-slow">
          <p class="muted">Still working: {phase ?? 'starting'}. Large provider lineups can take a moment.</p>
          <div class="row gap">
            <button type="button" class="f btn" data-autofocus onClick={() => setState({ ready: true, screen: 'sources' })}>Open Sources</button>
            <button type="button" class="f btn" onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const tasks = useApp((s) => s.tasks);
  return (
    <div class="toasts" aria-live="polite">
      {tasks.map((t) => (
        <div class={`toast ${t.error ? 'toast-error' : t.done ? 'toast-success' : ''}`} key={t.id}>
          {!t.done && !t.error && <span class="spinner" />}
          <div>
            <div>{t.label}</div>
            {t.error && <small>{t.error}</small>}
            {t.progress && !t.done && !t.error && (
              <small>
                {t.progress.phase}
                {t.progress.bytes ? ` · ${(t.progress.bytes / 1048576).toFixed(1)} MB` : ''}
                {t.progress.items ? ` · ${t.progress.items.toLocaleString()} items` : ''}
              </small>
            )}
          </div>
        </div>
      ))}
      {toasts.map((t) => (
        <div class={`toast toast-${t.kind}`} key={t.id}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Screens() {
  const screen = useApp((s) => s.screen);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Move focus into the new screen (keeps remote navigation predictable).
    // Selecting a screen moves focus into it (like a native TV app); [data-autofocus] marks the best target.
    if (!getState().fullscreen) requestAnimationFrame(() => focusFirst(ref.current));
    player.updateRect();
  }, [screen]);
  return (
    <main class="content" ref={ref} data-group="content" data-zone>
      {(screen === 'home' || screen === 'guide') && <GuideScreen />}
      {screen === 'sports' && <SportsScreen />}
      {screen === 'channels' && <ChannelsScreen />}
      {screen === 'search' && <SearchScreen />}
      {screen === 'sources' && <SourcesScreen />}
      {screen === 'wizard' && <ImportWizard />}
      {screen === 'matches' && <MatchesScreen />}
      {screen === 'settings' && <SettingsScreen />}
    </main>
  );
}

export function App() {
  const fullscreen = useApp((s) => s.fullscreen);
  const detail = useApp((s) => s.detail);
  const menuKey = useApp((s) => s.channelMenu);
  const ready = useApp((s) => s.ready);

  useEffect(() => {
    const offBack = onBack(() => {
      if (screenBack()) return true;
      // At the root: on Fire TV, exit the app (like a native app's back at home).
      if (native) {
        native.exitApp();
        return true;
      }
      return false;
    });
    const offKeys = onAppKey((k) => {
      const s = getState();
      if (k === 'guide') {
        navigate('home');
        return true;
      }
      if (k === 'chup' || k === 'chdown') {
        const next = adjacentChannel(zapList(), s.currentKey, k === 'chup' ? -1 : 1);
        if (next) void tune(next.key);
        return true;
      }
      if (k === 'playpause' || k === 'play' || k === 'pause') {
        if (!player.currentKey) return false;
        player.togglePause();
        return true;
      }
      return false;
    });
    return () => {
      offBack();
      offKeys();
    };
  }, []);

  return (
    <div class={`app ${fullscreen ? 'is-fullscreen' : ''} ${isNative ? 'native' : ''}`}>
      <div class="backdrop" />
      <div class="shell" aria-hidden={fullscreen ? 'true' : undefined} data-nav-skip={fullscreen ? '' : undefined}>
        <Sidebar />
        {ready ? <Screens /> : <main class="content"><LoadingScreen /></main>}
      </div>
      {fullscreen && <PlayerOverlay />}
      <LiveNotices />
      {detail && <ProgrammeDetail />}
      <ReminderPrompt />
      {menuKey && <ChannelMenu channelKey={menuKey} onClose={() => setState({ channelMenu: undefined })} />}
      <Toasts />
    </div>
  );
}

export { toggleFavorite };
