import { watchingSports } from '../app/livesports';
import { ChannelName } from './ChannelName';
import { h, Fragment } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp, setState, tune, zapList, toggleFavorite, updateSettings, player, getState, navigate } from '../app/state';
import { adjacentChannel } from '../core/organize';
import { isUsableMatch } from '../core/match';
import { onBack, onAppKey, focusFirst } from '../app/nav';
import { ChannelLogo, Progress, Icon, Button, VirtualList, useRemPx } from './common';
import { VideoSlot } from './VideoSlot';
import { openMultiview } from '../app/multiview';
import { usePlayerStatus, PlayerBadge, ChannelRowBody } from './Home';
import type { LiveInfo } from '../app/player';
import { ProgDesc } from './ProgDesc';
import { clock, range, remaining, progress, UNAVAILABLE } from './fmt';

type Panel = 'none' | 'strip' | 'menu' | 'info' | 'controls';

export function PlayerOverlay() {
  const currentKey = useApp((s) => s.currentKey);
  const lineup = useApp((s) => s.lineup);
  const guide = useApp((s) => s.guide);
  useApp((s) => s.guideVersion);
  const now = useApp((s) => s.now);
  const settings = useApp((s) => s.settings);
  const matches = useApp((s) => s.matches);
  const recents = useApp((s) => s.recents);
  const status = usePlayerStatus();
  const [osd, setOsd] = useState(true);
  const [panel, setPanel] = useState<Panel>('none');
  const [digits, setDigits] = useState('');
  const hideTimer = useRef<number>();
  const digitTimer = useRef<number>();
  const rootRef = useRef<HTMLDivElement>(null);
  const rem = useRemPx();

  const ch = lineup.find((c) => c.key === currentKey);
  const usable = ch ? isUsableMatch(matches.get(ch.key)) : false;
  const cur = ch && usable ? guide.current(ch.epgChannelId, now) : undefined;
  const nxt = ch && usable ? guide.next(ch.epgChannelId, now) : undefined;

  const poke = () => {
    setOsd(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setOsd(false);
      setPanel((p) => (p === 'controls' ? 'none' : p));
    }, Math.max(settings.osdTimeoutSec, 4) * 1000 * (panelRef.current === 'controls' ? 2 : 1));
  };
  const panelRef = useRef<Panel>('none');
  panelRef.current = panel;

  // Rewind / fast forward: repeated presses skip further (10 s, then 30 s, then 1 min).
  const skipRef = useRef({ dir: 0, at: 0, n: 0 });
  const skip = (dir: 1 | -1) => {
    const k = skipRef.current;
    const t = Date.now();
    k.n = k.dir === dir && t - k.at < 1500 ? k.n + 1 : 0;
    k.dir = dir;
    k.at = t;
    const step = k.n >= 6 ? 60 : k.n >= 3 ? 30 : 10;
    player.seekBy(dir * step);
    poke();
  };
  const goLive = () => {
    player.goLive();
    poke();
  };

  const zap = (dir: 1 | -1) => {
    const next = adjacentChannel(zapList(), getState().currentKey, dir);
    if (next) void tune(next.key);
    poke();
  };

  useEffect(() => {
    poke();
    return () => window.clearTimeout(hideTimer.current);
  }, [currentKey]);

  // Keep the OSD visible while something needs attention.
  useEffect(() => {
    if (status.state === 'error' || status.state === 'loading' || status.state === 'retrying') setOsd(true);
  }, [status.state]);

  // Restore focus to where the viewer was (e.g. the channel row) when leaving full screen.
  useLayoutEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    return () => {
      requestAnimationFrame(() => {
        if (prev && prev.isConnected && prev !== document.body) prev.focus({ preventScroll: true });
        else focusFirst(document.querySelector<HTMLElement>('[data-group="content"]'));
      });
    };
  }, []);

  useLayoutEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
    const offBack = onBack(() => {
      if (panel !== 'none') {
        setPanel('none');
        return true;
      }
      setState({ fullscreen: false });
      return true;
    });
    const offKeys = onAppKey((k) => {
      if (k === 'menu') {
        setPanel((p) => (p === 'menu' ? 'none' : 'menu'));
        return true;
      }
      if (k === 'info') {
        setPanel((p) => (p === 'info' ? 'none' : 'info'));
        return true;
      }
      if (k === 'chup' || k === 'chdown') {
        zap(k === 'chup' ? -1 : 1);
        return true;
      }
      if (k === 'rewind' || k === 'ffwd') {
        skip(k === 'rewind' ? -1 : 1);
        return true;
      }
      if (k === 'playpause' || k === 'play' || k === 'pause') {
        const paused = player.status.state === 'paused';
        if (k === 'playpause' || (k === 'play') === paused) player.togglePause();
        poke();
        return true;
      }
      return false;
    });
    return () => {
      offBack();
      offKeys();
    };
  }, [panel]);

  useEffect(() => {
    if (panel === 'none') rootRef.current?.focus({ preventScroll: true });
    else if (panel === 'controls') requestAnimationFrame(() => focusFirst(rootRef.current?.querySelector('.osd-controls') as HTMLElement));
    else requestAnimationFrame(() => focusFirst(rootRef.current?.querySelector('.player-panel') as HTMLElement));
  }, [panel]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (panel !== 'none') {
      if (panel === 'controls') {
        poke();
        // Up/Down leave the control bar and change channel, like without it.
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          setPanel('none');
          zap(e.key === 'ArrowUp' ? -1 : 1);
        }
        return;
      }
      if (panel === 'strip' && e.key === 'ArrowRight') {
        e.preventDefault();
        setPanel('none');
      }
      return; // panels handle their own navigation
    }
    poke();
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        zap(-1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        zap(1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        setPanel('strip');
        break;
      case 'ArrowRight':
        e.preventDefault();
        setPanel('info');
        break;
      case 'Enter':
        e.preventDefault();
        if (status.state === 'error') player.reload();
        else setPanel('controls'); // rewind, fast forward, live…
        break;
      default:
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          const d = (digits + e.key).slice(-5);
          setDigits(d);
          window.clearTimeout(digitTimer.current);
          digitTimer.current = window.setTimeout(() => {
            const target = getState().lineup.find((c) => !c.hidden && c.number === Number(d));
            if (target) void tune(target.key);
            setDigits('');
          }, 1400);
        }
    }
  };

  const stripList = useMemo(() => zapList(), [lineup, settings.zapFavoritesOnly]);
  const stripIndex = Math.max(0, stripList.findIndex((c) => c.key === currentKey));

  return (
    <div
      class={`player ${osd && (panel === 'none' || panel === 'controls') ? 'osd-on' : 'osd-off'} ${panel !== 'none' && panel !== 'controls' ? 'panel-open' : ''}`}
      data-scope
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseMove={poke}
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('video-slot-overlay')) setOsd((v) => !v);
      }}
      role="region"
      aria-label="Player"
    >
      <VideoSlot priority={100} class="player-video">
        <PlayerBadge status={status} />
      </VideoSlot>

      {digits && <div class="digits">{digits}</div>}

      {ch && (
        <div class="osd-top">
          <span class="osd-clock">{clock(now)}</span>
        </div>
      )}

      {ch && (
        <div class="osd" aria-live="polite">
          <div class="osd-row">
            <ChannelLogo ch={ch} src={ch.logo} name={ch.name} size="lg" />
            <div class="osd-ch">
              <div class="osd-chnum">{ch.number}</div>
              <div class="osd-chname">
                <ChannelName ch={ch} />
                {ch.favorite && <Icon name="star" class="fav-star" size="0.9em" />}
              </div>
            </div>
            <div class="osd-prog">
              {cur ? (
                <>
                  <div class="osd-title">{cur.title}{cur.episode ? <span class="muted"> · {cur.episode}</span> : null}</div>
                  <div class="osd-times">
                    <span>{range(cur)}</span>
                    <Progress value={progress(cur, now)} class="progress-lg" />
                    <span class="muted">{remaining(cur, now)}</span>
                  </div>
                  <ProgDesc p={cur} ch={ch} short class="osd-desc" />
                  {nxt && <div class="osd-next"><span class="muted">Next {clock(nxt.start)}</span> {nxt.title}</div>}
                </>
              ) : (
                <div class="osd-title muted">{UNAVAILABLE}</div>
              )}
            </div>
          </div>
          <LiveBar />
          <div class="osd-controls" data-group="osd-controls" data-nav-skip={panel === 'controls' ? undefined : ''}>
            <Button small icon="rewind" onClick={() => skip(-1)} aria-label="Rewind 10 seconds">10s</Button>
            <Button small data-autofocus icon={status.state === 'paused' ? 'play' : 'pause'} onClick={() => { player.togglePause(); poke(); }} aria-label="Play/pause" />
            <Button small icon="ffwd" onClick={() => skip(1)} aria-label="Fast forward 10 seconds">10s</Button>
            {watchingSports() && <Button small icon="multiview" class="mv-btn" onClick={() => openMultiview()}>Multiview</Button>}
            {status.textTracks ? (
              <Button small class={`cc-btn ${settings.captions ? 'cc-on' : ''}`} aria-pressed={!!settings.captions} onClick={() => { const on = !settings.captions; void updateSettings({ captions: on }); player.setCaptions(on); poke(); }}>CC {settings.captions ? 'On' : 'Off'}</Button>
            ) : null}
            <Button small icon="live" class="live-btn" onClick={goLive}>Live</Button>
            <span class="osd-sep" />
            <Button small icon="channels" onClick={() => setPanel('strip')}>Channels</Button>
            <Button small icon="info" onClick={() => setPanel('info')}>Info</Button>
            <Button small icon="menu" onClick={() => setPanel('menu')}>Options</Button>
            <Button small icon="back" onClick={() => setState({ fullscreen: false })}>Exit</Button>
          </div>
          <div class="osd-hints muted">
            {panel === 'controls'
              ? '◀ ▶ choose · OK select · ▲▼ change channel · Back: hide'
              : 'OK: controls (rewind · live) · ⏪ ⏩ skip · ▲▼ channel · ◀ list · ▶ info · Back: exit'}
            {status.via && status.via !== 'native' && <span> · {status.via}</span>}
          </div>
        </div>
      )}

      {panel === 'strip' && (
        <div class="player-panel strip">
          <h3>{settings.zapFavoritesOnly ? 'Favorites' : 'Channels'}</h3>
          <VirtualList
            items={stripList}
            rowHeight={5 * rem}
            initialIndex={stripIndex}
            keyOf={(c) => c.key}
            render={(c, i) => (
              <div class={`f channel-row compact ${c.key === currentKey ? 'playing' : ''}`} tabIndex={0} data-index={i} data-autofocus={c.key === currentKey ? '' : undefined}
                onClick={() => { void tune(c.key); setPanel('none'); }}>
                <ChannelRowBody ch={c} playing={c.key === currentKey} />
              </div>
            )}
          />
        </div>
      )}

      {panel === 'info' && ch && (
        <div class="player-panel info-panel">
          <h3>{cur?.title ?? ch.name}</h3>
          {cur ? (
            <>
              <p class="muted">{range(cur)} {cur.episode ? `· ${cur.episode}` : ''} {cur.subTitle ? `· ${cur.subTitle}` : ''}</p>
              <ProgDesc p={cur} ch={ch} />
              {cur.categories?.length ? <p class="tags">{cur.categories.map((c) => <span class="tag">{c}</span>)}</p> : null}
              <h4>Later on {ch.name}</h4>
              <ul class="later">
                {guide.upcoming(ch.epgChannelId, now, 5).map((p) => <li><span class="muted">{clock(p.start)}</span> {p.title}</li>)}
              </ul>
            </>
          ) : (
            <p class="muted">{UNAVAILABLE}</p>
          )}
          <div class="row gap-sm">
            <Button data-autofocus onClick={() => setPanel('none')}>Close</Button>
          </div>
        </div>
      )}

      {panel === 'menu' && ch && (
        <div class="player-panel menu-panel">
          <h3>Options</h3>
          <Button data-autofocus icon={ch.favorite ? 'star' : 'starOutline'} onClick={() => void toggleFavorite(ch.key)}>{ch.favorite ? 'Remove from favorites' : 'Add to favorites'}</Button>
          <Button icon="channels" onClick={() => void updateSettings({ zapFavoritesOnly: !settings.zapFavoritesOnly })}>
            Channel up/down: {settings.zapFavoritesOnly ? 'favorites only' : 'all channels'}
          </Button>
          <Button icon="refresh" onClick={() => { player.reload(); setPanel('none'); }}>Reload stream</Button>
          <Button icon="guide" onClick={() => { setState({ fullscreen: false }); navigate('guide'); }}>Open guide</Button>
          {recents.filter((r) => r.key !== ch.key).slice(0, 5).map((r) => {
            const rc = lineup.find((c) => c.key === r.key);
            return rc ? <Button icon="now" onClick={() => { void tune(rc.key); setPanel('none'); }}>Recent: {rc.number} {rc.name}</Button> : null;
          })}
          <Button icon="back" onClick={() => setState({ fullscreen: false })}>Exit full screen</Button>
        </div>
      )}
    </div>
  );
}

function fmtBehind(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `-${h}:${String(m).padStart(2, '0')}:${r}` : `-${m}:${r}`;
}

/** Where playback is in the live rewind window: a bar, "LIVE" or how far behind. */
export function LiveBar() {
  const [info, setInfo] = useState<LiveInfo | null>(() => player.liveInfo());
  useEffect(() => {
    const t = window.setInterval(() => setInfo(player.liveInfo()), 500);
    return () => window.clearInterval(t);
  }, []);
  if (!info || !info.seekable) {
    return (
      <div class="livebar">
        <span class="live-pill on">LIVE</span>
        <span class="muted livebar-note">{info ? 'Rewind is building up…' : ''}</span>
      </div>
    );
  }
  const atLive = info.behind < 1;
  const pos = info.window > 0 ? Math.max(0, Math.min(1, 1 - info.behind / info.window)) : 1;
  return (
    <div class="livebar">
      <span class={`live-pill ${atLive ? 'on' : ''}`}>{atLive ? 'LIVE' : fmtBehind(info.behind)}</span>
      <div class="livebar-track" aria-hidden="true">
        <div class="livebar-fill" style={{ width: `${pos * 100}%` }} />
        <div class="livebar-head" style={{ left: `${pos * 100}%` }} />
      </div>
      <span class="muted livebar-note">{Math.round(info.window / 60) >= 1 ? `${Math.round(info.window / 60)} min kept` : `${Math.round(info.window)} s kept`}</span>
    </div>
  );
}
