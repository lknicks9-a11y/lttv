import { ChannelName } from './ChannelName';
import { h, Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp, tune, setState, navigate, player, getState } from '../app/state';
import { filterLineup, countryLabel, type CategoryFilter } from '../core/organize';
import { countryFlag } from '../core/countries';
import { isUsableMatch } from '../core/match';
import type { LineupChannel } from '../core/types';
import { ChannelLogo, Progress, Chip, VirtualList, Icon, Button, Empty, useRemPx } from './common';
import { VideoSlot } from './VideoSlot';
import { clock, range, remaining, progress, UNAVAILABLE, when } from './fmt';
import { loadDemo } from './demo';
import { LogoMark, Wordmark } from './Logo';
import { LiveTeamBanner } from './Sports';
import { SetupServerModal } from './PhoneSetup';
import { native } from '../app/platform';
import { currentAccount, listAccounts } from '../app/accounts';

/** Tabs: one per country in the playlists (most channels first, United States first), then "Other". */
export function useCategoryChips(lineup: LineupChannel[]) {
  return useMemo(() => {
    const visible = lineup.filter((c) => !c.hidden);
    const byCountry = new Map<string, number>();
    const codes = new Map<string, string>();
    for (const c of visible) {
      const k = c.country ?? 'none';
      byCountry.set(k, (byCountry.get(k) ?? 0) + 1);
      if (c.countryCode && !codes.has(k)) codes.set(k, c.countryCode);
    }
    const entries = [...byCountry.entries()].sort((a, b) => (a[0] === 'none' ? 1 : b[0] === 'none' ? -1 : a[0] === 'us' ? -1 : b[0] === 'us' ? 1 : b[1] - a[1] || countryLabel(a[0]).localeCompare(countryLabel(b[0]))));
    const chips: { id: CategoryFilter; label: string; count?: number }[] = entries.map(([code, n]) => ({
      id: `country:${code}` as CategoryFilter,
      label: code === 'none' ? (entries.length === 1 ? 'All channels' : 'Other') : `${countryFlag(code)} ${codes.get(code) ?? code.toUpperCase()} · ${countryLabel(code)}`.trim(),
      count: n,
    }));
    return chips;
  }, [lineup]);
}

/** The selected tab, falling back to the first tab when the saved one no longer exists. */
export function validFilter(filter: CategoryFilter, chips: { id: CategoryFilter }[]): CategoryFilter {
  return chips.some((c) => c.id === filter || filter.startsWith(`${c.id}|`)) ? filter : chips[0]?.id ?? 'all';
}

/** Info about what's on a channel, with the honest "unavailable" state. */
export function NowInfo({ ch, compact }: { ch: LineupChannel; compact?: boolean }) {
  const guide = useApp((s) => s.guide);
  useApp((s) => s.guideVersion);
  const now = useApp((s) => s.now);
  const match = useApp((s) => s.matches.get(ch.key));
  const usable = isUsableMatch(match);
  const cur = usable ? guide.current(ch.epgChannelId, now) : undefined;
  const upcoming = usable ? guide.upcoming(ch.epgChannelId, now, compact ? 1 : 2) : [];
  if (!cur && !upcoming.length) {
    return (
      <div class="now-info">
        <p class="muted">{UNAVAILABLE}</p>
        {match?.status === 'pending' && <p class="hint">A possible guide match is waiting for your approval in Sources → Review matches.</p>}
      </div>
    );
  }
  return (
    <div class="now-info">
      {cur ? (
        <>
          <div class="now-title-row">
            <span class="badge-live">NOW</span>
            <h2 class="now-title">{cur.title}</h2>
          </div>
          {(cur.subTitle || cur.episode) && <p class="now-sub">{[cur.episode, cur.subTitle].filter(Boolean).join(' · ')}</p>}
          <div class="now-times">
            <span>{range(cur)}</span>
            <Progress value={progress(cur, now)} class="progress-lg" />
            <span class="muted">{remaining(cur, now)}</span>
          </div>
          {!compact && cur.desc && <p class="now-desc">{cur.desc}</p>}
          {!compact && cur.categories?.length && <p class="tags">{cur.categories.slice(0, 3).map((c) => <span class="tag">{c}</span>)}</p>}
        </>
      ) : (
        <p class="muted">Nothing scheduled right now.</p>
      )}
      {upcoming.length > 0 && (
        <div class="upnext">
          <h4>Up next</h4>
          <ul>
            {upcoming.map((p) => (
              <li>
                <span class="upnext-time">{when(p.start, now)}</span>
                <span class="upnext-title">{p.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** First-run screen (no playlists yet). */
export function Welcome() {
  return (
    <section class="screen home-empty">
      <Empty title={listAccounts().length > 1 ? `Welcome, ${currentAccount().name}` : 'Welcome to LTTV'} art={<div class="welcome-logo"><LogoMark size="9rem" /><Wordmark /></div>}>
        <ImportBusy />
          <p>Add your own IPTV playlist (M3U) and, optionally, an XMLTV program guide. LTTV organizes the channels, matches them to the guide and plays them.</p>
        <div class="row gap">
          <Button variant="primary" icon="add" data-autofocus onClick={() => navigate('wizard')}>Add playlist</Button>
          {native && <PhoneSetupButton />}
            <Button icon="tv" onClick={() => void loadDemo()}>Try the demo</Button>
        </div>
        <p class="hint">The demo uses clearly labeled test streams and a generated test guide. You can delete it anytime in Sources.</p>
      </Empty>
    </section>
  );
}

export function HomeScreen() {
  const lineup = useApp((s) => s.lineup);
  const playlists = useApp((s) => s.playlists);
  const currentKey = useApp((s) => s.currentKey);
  const recents = useApp((s) => s.recents);
  const showHidden = false;
  const [savedFilter, setFilter] = useState<CategoryFilter>(() => (sessionStorage.getItem('homeFilter') as CategoryFilter) || 'country:us');
  const [focusedKey, setFocusedKey] = useState<string | undefined>(currentKey);
  const chips = useCategoryChips(lineup);
  const filter = validFilter(savedFilter, chips);
  const list = useMemo(() => filterLineup(lineup, filter, { showHidden, recents }), [lineup, filter, recents]);
  const rem = useRemPx();
  const status = usePlayerStatus();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem('homeFilter', String(filter));
    } catch {
      /* ignore */
    }
  }, [filter]);

  if (!playlists.length) {
    return (
      <section class="screen home-empty">
        <Empty title={listAccounts().length > 1 ? `Welcome, ${currentAccount().name}` : 'Welcome to LTTV'} art={<div class="welcome-logo"><LogoMark size="9rem" /><Wordmark /></div>}>
          <ImportBusy />
          <p>Add your own IPTV playlist (M3U) and, optionally, an XMLTV program guide. LTTV organizes the channels, matches them to the guide and plays them.</p>
          <div class="row gap">
            <Button variant="primary" icon="add" data-autofocus onClick={() => navigate('wizard')}>Add playlist</Button>
            {native && <PhoneSetupButton />}
            <Button icon="tv" onClick={() => void loadDemo()}>Try the demo</Button>
          </div>
          <p class="hint">The demo uses clearly labeled test streams and a generated test guide. You can delete it anytime in Sources.</p>
        </Empty>
      </section>
    );
  }

  const shown = lineup.find((c) => c.key === (focusedKey ?? currentKey)) ?? lineup.find((c) => c.key === currentKey) ?? list[0];
  const playing = lineup.find((c) => c.key === currentKey);
  const initialIndex = Math.max(0, list.findIndex((c) => c.key === (currentKey ?? focusedKey)));

  return (
    <section class="screen home">
      <div class="hero">
        <div class="hero-video">
          <VideoSlot>
            {!playing && (
              <div class="video-placeholder">
                <Icon name="tv" size="4rem" />
                <p>Select a channel to start watching</p>
              </div>
            )}
            {playing && <PlayerBadge status={status} />}
          </VideoSlot>
          {playing && (
            <button type="button" class="f hero-fullscreen" onClick={() => setState({ fullscreen: true })} aria-label="Watch full screen">
              <Icon name="play" /> Full screen
            </button>
          )}
        </div>
        <div class="hero-info">
          {shown ? (
            <>
              <div class="hero-channel">
                <ChannelLogo ch={shown} src={shown.logo} name={shown.name} size="lg" />
                <div>
                  <div class="hero-chnum">{shown.number}</div>
                  <div class="hero-chname">
                    <ChannelName ch={shown} />
                    {shown.key === currentKey && <span class="pill">Watching</span>}
                  </div>
                </div>
              </div>
              <NowInfo ch={shown} />
            </>
          ) : (
            <p class="muted">No channels in this category.</p>
          )}
        </div>
      </div>
      <LiveTeamBanner />
      <div class="chips" data-group="chips" role="toolbar" aria-label="Categories">
        {chips.map((c) => (
          <Chip active={filter === c.id} count={c.count} onClick={() => setFilter(c.id)}>
            {c.label}
          </Chip>
        ))}
      </div>
      <div class="home-list" ref={listRef}>
        {list.length ? (
          <VirtualList
            key={String(filter)}
            items={list}
            rowHeight={5.25 * rem}
            initialIndex={initialIndex}
            keyOf={(c) => c.key}
            groupName="home-list"
            onFocusIndex={(i) => setFocusedKey(list[i]?.key)}
            render={(c, i, focused) => (
                <ChannelRowFocusable
                  ch={c}
                  index={i}
                  autofocus={i === initialIndex}
                  focused={focused}
                  playing={c.key === currentKey}
                  onSelect={() => {
                    if (c.key === currentKey && getState().currentKey === c.key && player.status.state !== 'error') setState({ fullscreen: true });
                    else void tune(c.key);
                  }}
                  onMenu={() => setState({ channelMenu: c.key })}
                />
            )}
          />
        ) : (
          <Empty title={filter === 'favorites' ? 'No favorites yet' : filter === 'recent' ? 'Nothing watched yet' : 'No channels here'}>
            {filter === 'favorites' && <p>Press the menu button (☰) on a channel and choose “Add to favorites”.</p>}
          </Empty>
        )}
      </div>
    </section>
  );
}

/** Row whose focusable element carries data-index so VirtualList can move focus to it. */
export function ChannelRowFocusable(props: { ch: LineupChannel; index: number; focused: boolean; playing: boolean; onSelect: () => void; onMenu: () => void; autofocus?: boolean }) {
  return (
    <div
      class={`f channel-row ${props.playing ? 'playing' : ''} ${props.ch.hidden ? 'is-hidden' : ''}`}
      tabIndex={0}
      data-index={props.index}
      data-autofocus={props.autofocus ? '' : undefined}
      role="button"
      aria-label={`${props.ch.number} ${props.ch.name}`}
      onClick={props.onSelect}
      onKeyDown={(e) => {
        if (e.key === 'ContextMenu' || e.key === 'm' || e.key === 'M') {
          e.preventDefault();
          props.onMenu();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onMenu();
      }}
    >
      <ChannelRowBody ch={props.ch} playing={props.playing} />
    </div>
  );
}

export function ChannelRowBody({ ch, playing }: { ch: LineupChannel; playing: boolean }) {
  const guide = useApp((s) => s.guide);
  useApp((s) => s.guideVersion);
  const now = useApp((s) => s.now);
  const usable = ch.matchStatus === 'auto' || ch.matchStatus === 'approved';
  const cur = usable ? guide.current(ch.epgChannelId, now) : undefined;
  const nxt = usable ? guide.next(ch.epgChannelId, now) : undefined;
  return (
    <>
      <span class="ch-num">{ch.number}</span>
      <ChannelLogo ch={ch} src={ch.logo} name={ch.name} />
      <span class="ch-name">
        <ChannelName ch={ch} class="ch-name-text" />
        {ch.favorite && <Icon name="star" class="fav-star" size="1.1em" />}
        {ch.hidden && <Icon name="hidden" class="muted" size="1em" />}
        {playing && <span class="eq" aria-label="Playing"><i /><i /><i /></span>}
      </span>
      <span class="ch-now">
        {cur ? (
          <>
            <span class="ch-now-title">{cur.title}</span>
            <Progress value={progress(cur, now)} />
          </>
        ) : (
          <span class="muted small">{usable && nxt ? 'No programme right now' : UNAVAILABLE}</span>
        )}
      </span>
      <span class="ch-next">{nxt ? <><span class="muted">{clock(nxt.start)}</span> {nxt.title}</> : null}</span>
    </>
  );
}

export function usePlayerStatus() {
  const [s, setS] = useState(player.status);
  useEffect(() => player.subscribe(setS), []);
  return s;
}

export function PlayerBadge({ status }: { status: ReturnType<typeof usePlayerStatus> }) {
  if (status.state === 'loading' || status.state === 'buffering') {
    return (
      <div class="video-state">
        <span class="spinner big" />
        <span>{status.state === 'loading' ? 'Tuning…' : 'Buffering…'}</span>
      </div>
    );
  }
  if (status.state === 'retrying') {
    return (
      <div class="video-state">
        <span class="spinner big" />
        <span>Reconnecting ({status.attempt}/{status.maxAttempts})…</span>
        {status.error && <small>{status.error}</small>}
      </div>
    );
  }
  if (status.state === 'error') {
    return (
      <div class="video-state video-error">
        <Icon name="warn" size="2.5rem" />
        <span>Can’t play this channel</span>
        <small>{status.error}</small>
        <Button small icon="refresh" onClick={() => player.reload()}>Retry</Button>
      </div>
    );
  }
  if (status.state === 'paused') {
    return (
      <div class="video-state video-paused">
        <Icon name="pause" size="3rem" />
      </div>
    );
  }
  return null;
}

/** Opens the phone/computer setup page (Fire TV). */
function PhoneSetupButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon="phone" onClick={() => setOpen(true)}>Set up from phone or computer</Button>
      {open && <SetupServerModal onClose={() => setOpen(false)} />}
    </>
  );
}

/** On the welcome screen: what's loading right now (a playlist sent from a phone, a guide…). */
function ImportBusy() {
  const task = useApp((s) => s.tasks.find((t) => !t.done && !t.error));
  if (!task) return null;
  const p = task.progress;
  return (
    <div class="card busy welcome-busy" aria-live="polite">
      <span class="spinner big" />
      <h2>{task.label}</h2>
      {p && (p.items || p.bytes) ? (
        <p class="muted">
          {p.phase}
          {p.bytes ? ` · ${(p.bytes / 1048576).toFixed(1)} MB` : ''}
          {p.items ? ` · ${p.items.toLocaleString()} entries` : ''}
        </p>
      ) : null}
      <p class="hint">This can take a minute or two for a big provider. Keep the app open.</p>
    </div>
  );
}
