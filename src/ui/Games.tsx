import { h, Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp, tune } from '../app/state';
import { useGames, logoFor } from '../app/schedule';
import { scheduleDay, scheduleLeague, type Game, type GameTeam, type ScheduleLeagueId } from '../core/schedule';
import { buildGameIndexAsync, broadcastSummary, bestStreams, capStreams, type GameIndexEntry, type StreamPick } from '../core/streamfinder';
import { Button, ChannelLogo, Chip, Empty, Icon, Modal } from './common';
import { ChannelName } from './ChannelName';
import { clock } from './fmt';
import { allTeams } from '../core/teams';
import { canCheck, cachedLiveness, checkStream, type Liveness } from '../app/streamcheck';

/** Team logo (transparent PNG from the schedule), falling back to the abbreviation. */
export function TeamLogo({ team, size = 'md' }: { team: { name: string; abbr: string; logo?: string; color?: string }; size?: 'sm' | 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  const src = team.logo ?? logoFor(team.name);
  if (src && !failed) return <img class={`team-logo team-logo-${size}`} src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  return <span class={`team-logo team-logo-${size} team-logo-text`} style={team.color ? { color: `#${team.color}` } : undefined}>{team.abbr}</span>;
}


function dayOffset(ts: number, days: number) {
  return ts + days * 86400_000;
}

function statusText(g: Game, now: number): { text: string; live: boolean } {
  if (g.state === 'in') return { text: g.detail || 'Live', live: true };
  if (g.state === 'post') return { text: g.detail || 'Final', live: false };
  if (/postpon|cancel|delay|suspend/i.test(g.detail)) return { text: g.detail, live: false };
  const mins = Math.round((g.start - now) / 60000);
  return { text: mins > 0 && mins < 60 ? `${clock(g.start)} · in ${mins} min` : clock(g.start), live: false };
}

function TeamLine({ t, g }: { t: GameTeam; g: Game }) {
  const showScore = g.state !== 'pre' && t.score !== undefined;
  return (
    <span class={`game-team ${t.winner ? 'winner' : ''}`}>
      <TeamLogo team={t} size="sm" />
      <span class="game-team-name">{t.name}</span>
      {t.record && g.state === 'pre' && <small class="muted">{t.record}</small>}
      {showScore && <span class="game-score">{t.score}</span>}
    </span>
  );
}

/** onPick: choose a stream for something else (Multiview) instead of watching it full screen. */
export type StreamPickHandler = (key: string, game: Game) => void;

export function LeagueGames({ leagueId, onPick }: { leagueId: ScheduleLeagueId; onPick?: StreamPickHandler }) {
  const tz = useApp((s) => s.settings.timeZone);
  // Minute resolution: the list doesn't need to redraw on every 15-second clock tick.
  const now = useApp((s) => Math.floor(s.now / 60_000) * 60_000);
  const lineup = useApp((s) => s.lineup);
  const guide = useApp((s) => s.guide);
  const guideVersion = useApp((s) => s.guideVersion);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<Game | null>(null);
  const today = scheduleDay(now, tz);
  const day = scheduleDay(dayOffset(now, offset), tz);
  const league = scheduleLeague(leagueId)!;
  const { games: raw, loading, error, reload } = useGames(leagueId, day, today);
  // Live games first, then upcoming (by start time), then finished.
  const games = useMemo(() => {
    const rank = (g: Game) => (g.state === 'in' ? 0 : g.state === 'pre' ? 1 : 2);
    return [...raw].sort((a, b) => rank(a) - rank(b) || a.start - b.start);
  }, [raw]);

  // Channels for each game are worked out in the background, a few games at a time (big college
  // slates and big lineups used to freeze the TV); rows fill in as they're found.
  const [index, setIndex] = useState<GameIndexEntry[] | null>(null);
  const [best, setBest] = useState<Map<string, StreamPick | undefined>>(new Map());
  // While a game's pop-up is open the list behind it isn't redrawn (that made moving up/down in it laggy).
  const openRef = useRef<Game | null>(null);
  openRef.current = open;
  const latest = useRef<Map<string, StreamPick | undefined>>(new Map());
  useEffect(() => {
    if (!open) setBest(new Map(latest.current));
  }, [open]);
  useEffect(() => {
    let alive = true;
    // Keep what's already shown while channels are re-checked (no "Finding channels…" flashing on refresh).
    if (!games.length) return;
    void (async () => {
      const from = Math.min(...games.map((g) => g.start)) - 3600_000;
      const to = Math.max(...games.map((g) => g.start)) + 5 * 3600_000;
      const idx = await buildGameIndexAsync(lineup, guide, from, to, guideVersion);
      if (!alive) return;
      setIndex(idx);
      const m = new Map<string, StreamPick | undefined>(latest.current);
      for (let i = 0; i < games.length; i++) {
        const g = games[i];
        {
          const list = bestStreams(g, lineup, league.sport, idx);
          m.set(g.id, capStreams(list, (k) => cachedLiveness(k) === 'dead')[0] ?? list[0]);
        }
        latest.current = m;
        if (i % 6 === 5) {
          if (!openRef.current) setBest(new Map(m));
          await new Promise((r) => setTimeout(r, 0));
          if (!alive) return;
        }
      }
      latest.current = m;
      if (!openRef.current) setBest(new Map(m));
    })();
    return () => {
      alive = false;
    };
  }, [games, lineup, guide, guideVersion, league.sport]);

  const live = games.filter((g) => g.state === 'in').length;

  return (
    <div class="league-games">
      <div class="row gap wrap" data-group="game-days">
        <div class="chips compact">
          <Chip active={offset === -1} onClick={() => setOffset(-1)}>Yesterday</Chip>
          <Chip active={offset === 0} onClick={() => setOffset(0)}>Today</Chip>
          <Chip active={offset === 1} onClick={() => setOffset(1)}>Tomorrow</Chip>
        </div>
        <span class="muted">
          {loading ? 'Loading…' : `${games.length} game${games.length === 1 ? '' : 's'}${live ? ` · ${live} live` : ''}`}
        </span>
        {error && <Button small icon="refresh" onClick={reload}>Retry</Button>}
      </div>
      {error && !games.length ? (
        <p class="muted">Couldn’t load the {league.name} schedule: {error}</p>
      ) : !loading && !games.length ? (
        <Empty icon="sports" title={`No ${league.name} games ${offset === 0 ? 'today' : offset < 0 ? 'yesterday' : 'tomorrow'}`}>
          <p>Try another day.</p>
        </Empty>
      ) : (
        <div class="games" data-group="games">
          {games.map((g) => {
            const st = statusText(g, now);
            const pick = best.get(g.id);
            const tv = broadcastSummary(g);
            return (
              <button type="button" class={`f game-row ${st.live ? 'is-live' : ''} ${g.state === 'post' ? 'is-final' : ''}`} onClick={() => setOpen(g)}>
                <span class="game-status">
                  {st.live ? <span class="badge-live">LIVE</span> : null}
                  <span>{st.text}</span>
                </span>
                <span class="game-teams">
                  <TeamLine t={g.away} g={g} />
                  <TeamLine t={g.home} g={g} />
                </span>
                <span class="game-tv">
                  {tv ? <span class="game-tv-list">{tv}</span> : <span class="muted">TV not listed</span>}
                  {pick ? (
                    <span class="game-best"><Icon name="play" size="0.9em" /> {pick.ch.number} {pick.ch.name}</span>
                  ) : !best.has(g.id) ? (
                    <span class="muted game-best">Finding channels…</span>
                  ) : (
                    <span class="muted game-best">{g.state === 'pre' && g.start - now > 6 * 3600_000 ? 'Channel usually listed on game day' : 'No channel found in your lineup'}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <p class="hint">Schedule, scores, logos and TV listings: ESPN. Streams are matched only from your own playlists.</p>
      {open && <WatchGame game={open} index={index} onClose={() => setOpen(null)} onPick={onPick} />}
    </div>
  );
}

/** The best streams for a game, best first (event channels, team channels, networks), from the user's lineup. */
/** How many of a game's top streams are checked for being on the air. */

export function WatchGame({ game, index, onClose, onPick }: { game: Game; index: GameIndexEntry[] | null; onClose: () => void; onPick?: StreamPickHandler }) {
  const lineup = useApp((s) => s.lineup);
  const favs = useApp((s) => s.settings.favoriteTeams);
  const custom = useApp((s) => s.settings.customTeams);
  const league = scheduleLeague(game.league)!;

  // Ties go to the user's own team's feed.
  const favNames = useMemo(() => {
    const all = allTeams(custom);
    return new Set(favs.map((id) => all.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t).flatMap((t) => [t.name, ...(t.aliases ?? [])].map((n) => n.toLowerCase())));
  }, [favs, custom]);
  const isFav = (t: GameTeam) => favNames.has(t.name.toLowerCase()) || favNames.has(t.short.toLowerCase());

  const ranked = useMemo(() => (index ? bestStreams(game, lineup, league.sport, index, isFav) : []), [game, lineup, index, favNames]);
  // What's shown: the game's own channels first, at most two per team; dead channels drop out and the next fills in.
  const [live, setLive] = useState<Map<string, Liveness>>(() => new Map());
  const [checking, setChecking] = useState<string | undefined>();
  const [showDead, setShowDead] = useState(false);
  const isDead = (k: string) => (live.get(k) ?? cachedLiveness(k)) === 'dead';
  const visible = capStreams(ranked, isDead);
  const visibleKeys = visible.map((p) => p.ch.key).join('|');
  // Check each shown stream is actually on the air, one at a time (one extra provider connection at most).
  useEffect(() => {
    const ctl = new AbortController();
    void (async () => {
      let checked = 0;
      for (const p of visible) {
        if (ctl.signal.aborted) return;
        if (checked >= 5) break; // a few at most: many quick connections get a provider to refuse them all
        const known = cachedLiveness(p.ch.key);
        if (known) {
          if (live.get(p.ch.key) !== known) setLive((m) => new Map(m).set(p.ch.key, known));
          continue;
        }
        if (!canCheck(p.ch)) continue;
        setChecking(p.ch.key);
        checked++;
        if (checked > 1) await new Promise((r) => setTimeout(r, 1500));
        if (ctl.signal.aborted) return;
        const v = await checkStream(p.ch, ctl.signal);
        if (ctl.signal.aborted) return;
        if (v) setLive((m) => new Map(m).set(p.ch.key, v)); // a dead one is replaced; its replacement is checked next round
      }
      setChecking(undefined);
    })();
    return () => ctl.abort();
  }, [visibleKeys]);
  const dead = ranked.filter((p) => isDead(p.ch.key));
  const picks = showDead ? capStreams(ranked) : visible;
  const watch = (key: string) => {
    onClose();
    if (onPick) onPick(key, game);
    else void tune(key, { fullscreen: true });
  };

  return (
    <Modal title={`${game.away.short} at ${game.home.short}`} onClose={onClose} wide class="watch-game">
      <div class="watch-head">
        <span class="watch-team"><TeamLogo team={game.away} size="lg" /><span>{game.away.name}</span>{game.state !== 'pre' && <b>{game.away.score}</b>}</span>
        <span class="watch-mid">
          {game.state === 'in' ? <span class="badge-live">LIVE</span> : null}
          <span>{game.state === 'pre' ? clock(game.start) : game.detail}</span>
          {game.note && <small class="muted">{game.note}</small>}
          {broadcastSummary(game) && <small class="muted watch-tv">TV: {broadcastSummary(game)}</small>}
        </span>
        <span class="watch-team"><TeamLogo team={game.home} size="lg" /><span>{game.home.name}</span>{game.state !== 'pre' && <b>{game.home.score}</b>}</span>
      </div>

      <>
          {!index ? (
            <p class="muted row gap"><span class="spinner" /> Finding channels for this game…</p>
          ) : picks.length ? (
            <div class="stream-picks" data-group="picks">
              {picks.slice(0, 12).map((p, i) => (
                <div class={`stream-pick ${i === 0 ? 'best' : ''}`} key={p.ch.key}>
                  <button type="button" class="f stream-pick-main" data-autofocus={i === 0 ? '' : undefined} onClick={() => watch(p.ch.key)}>
                    <span class="ch-num">{p.ch.number}</span>
                    <ChannelLogo ch={p.ch} src={p.ch.logo} name={p.ch.name} size="sm" />
                    <span class="stream-pick-text">
                      <ChannelName ch={p.ch} />
                      <small class="muted">
                        {i === 0 ? 'Best stream · ' : ''}
                        {live.get(p.ch.key) === 'live' ? 'Working · ' : live.get(p.ch.key) === 'dead' ? 'Not sending video · ' : checking === p.ch.key ? 'Checking… · ' : ''}
                        {p.reason}
                      </small>
                    </span>
                    <span class="stream-pick-cta"><Icon name={onPick ? 'multiview' : 'play'} size="1em" /> {onPick ? 'Add' : 'Watch'}</span>
                  </button>
                </div>
              ))}
              {dead.length > 0 && !showDead && (
                <p class="hint">{dead.length} channel{dead.length === 1 ? '' : 's'} for this game {dead.length === 1 ? 'isn’t' : 'aren’t'} sending video right now and {dead.length === 1 ? 'is' : 'are'} hidden.</p>
              )}
            </div>
          ) : dead.length ? (
            <div class="card">
              <p><b>None of the channels for this game are sending video right now.</b></p>
              <p class="muted">Event channels often only come on shortly before the game. Try again closer to start time.</p>
              <Button icon="channels" onClick={() => setShowDead(true)}>Show them anyway</Button>
            </div>
          ) : (
            <div class="card">
              <p><b>No channel in your lineup carries this game.</b></p>
              <p class="muted">
                {game.broadcasts.length ? `It’s on ${game.broadcasts.map((b) => b.name).join(', ')}. ` : ''}
                {game.state === 'pre' && game.start - Date.now() > 6 * 3600_000
                  ? 'Providers usually add the event channel for a game on game day, and guides often don’t list games that far ahead yet — check back closer to kickoff. '
                  : ''}
                LTTV looks for event channels and guide listings naming both teams, and for those networks in your playlists. If your provider adds an event channel for it later, it will show up here after the next playlist refresh.
              </p>
            </div>
          )}
      </>
    </Modal>
  );
}
