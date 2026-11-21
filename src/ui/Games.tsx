import { h, Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp, tune } from '../app/state';
import { focusEl, sinceLastMove, whenStill } from '../app/nav';
import { sheetFor, useChannelSheet } from '../app/channelsheet';
import { applySheet } from '../core/channelsheet';
import { useGames, logoFor } from '../app/schedule';
import { sportsDay, scheduleLeague, type Game, type GameTeam, type ScheduleLeagueId } from '../core/schedule';
import { buildGameIndexAsync, broadcastSummary, bestStreams, rememberWatched, type GameIndexEntry, type StreamPick } from '../core/streamfinder';
import { Button, ChannelLogo, Chip, Empty, Icon, Modal } from './common';
import { ChannelName } from './ChannelName';
import { clock } from './fmt';
import { allTeams } from '../core/teams';
import { canCheck, cachedLiveness, checkStream, type Liveness } from '../app/streamcheck';

/** Team logo (transparent PNG from the schedule), falling back to the abbreviation. */
/**
 * ESPN's team logos are 500 px; a list of a hundred of them (a college football Saturday) made scrolling lag on a
 * Fire TV Stick. ESPN serves the same picture at the size it's shown.
 */
export function smallLogo(url: string | undefined, px: number): string | undefined {
  const m = url && /^https:\/\/a\.espncdn\.com(\/i\/teamlogos\/[^?]+)$/.exec(url);
  return m ? `https://a.espncdn.com/combiner/i?img=${m[1]}&w=${px}&h=${px}` : url;
}

export function TeamLogo({ team, size = 'md' }: { team: { name: string; abbr: string; logo?: string; color?: string }; size?: 'sm' | 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  const src = smallLogo(team.logo ?? logoFor(team.name), size === 'lg' ? 200 : size === 'md' ? 140 : 100);
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
      <span class="game-team-name">{t.rank ? <b class="team-rank">#{t.rank} </b> : null}{t.name}</span>
      {t.record && g.state === 'pre' && <small class="muted">{t.record}</small>}
      {showScore && <span class="game-score">{t.score}</span>}
    </span>
  );
}

/** onPick: choose a stream for something else (Multiview) instead of watching it full screen. */
export type StreamPickHandler = (key: string, game: Game) => void;

export function LeagueGames({ leagueId, onPick }: { leagueId: ScheduleLeagueId; onPick?: StreamPickHandler }) {
  // Minute resolution: the list doesn't need to redraw on every 15-second clock tick.
  const now = useApp((s) => Math.floor(s.now / 60_000) * 60_000);
  const lineup = useApp((s) => s.lineup);
  const guide = useApp((s) => s.guide);
  const guideVersion = useApp((s) => s.guideVersion);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<Game | null>(null);
  // The sports day changes at 3:00 AM Eastern.
  const today = sportsDay(now);
  const day = sportsDay(dayOffset(now, offset));
  const league = scheduleLeague(leagueId)!;
  // College: one conference (or the Top 25) instead of every game in the country.
  const [conf, setConf] = useState<string | undefined>(undefined);
  useEffect(() => setConf(undefined), [leagueId]);
  const { games: all, loading, error, reload } = useGames(leagueId, day, today, league.conferences ? conf : undefined);
  // Top 25: every game today with a ranked team in it.
  const raw = useMemo(() => (league.conferences && conf === '' ? all.filter((g) => g.home.rank || g.away.rank) : all), [all, conf, league.conferences]);
  // Leaving a game you were watching comes back to that game's streams, not the whole list.
  const fullscreen = useApp((s) => s.fullscreen);
  const watching = useRef<string | null>(null);
  useEffect(() => {
    if (fullscreen || !watching.current) return;
    const g = raw.find((x) => x.id === watching.current);
    watching.current = null;
    if (g) setOpen(g);
  }, [fullscreen]);
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
  // Only when the games themselves change (not every score update, which during live games came every minute and
  // restarted this whole search, making up/down slow while it ran).
  const gamesKey = games.map((g) => `${g.id}:${g.start}:${g.state === 'post' ? 'f' : ''}`).join('|');
  const gamesRef = useRef(games);
  gamesRef.current = games;
  useEffect(() => {
    let alive = true;
    const list = gamesRef.current;
    // Keep what's already shown while channels are re-checked (no "Finding channels…" flashing on refresh).
    if (!list.length) return;
    void (async () => {
      const from = Math.min(...list.map((g) => g.start)) - 3600_000;
      const to = Math.max(...list.map((g) => g.start)) + 5 * 3600_000;
      const idx = await buildGameIndexAsync(lineup, guide, from, to, guideVersion);
      if (!alive) return;
      setIndex(idx);
      const m = new Map<string, StreamPick | undefined>(latest.current);
      let shownAt = performance.now();
      for (let i = 0; i < list.length; i++) {
        // One game at a time, and only while the remote is still: a press is never stuck behind this work.
        await whenStill();
        if (!alive) return;
        const g = list[i];
        m.set(g.id, applySheet(bestStreams(g, lineup, league.sport, idx), sheetFor(g.id), lineup)[0]);
        latest.current = m;
        // The list is redrawn at most about once a second (not every few games), and never mid-move.
        if (performance.now() - shownAt > 1000 && !openRef.current && sinceLastMove() > 450) {
          setBest(new Map(m));
          shownAt = performance.now();
        }
        await new Promise((r) => setTimeout(r, 0));
      }
      latest.current = m;
      if (!openRef.current && alive) setBest(new Map(m));
    })();
    return () => {
      alive = false;
    };
  }, [gamesKey, lineup, guide, guideVersion, league.sport]);

  const live = games.filter((g) => g.state === 'in').length;

  // Backing out of a game's channels lands on that game in the list, not back at the top of all the scores.
  const backTo = useRef<string | null>(null);
  const closeGame = (id: string) => {
    backTo.current = id;
    setOpen(null);
  };
  useEffect(() => {
    if (open || !backTo.current) return;
    const id = backTo.current;
    backTo.current = null;
    const put = () => {
      const row = document.querySelector<HTMLElement>(`.game-row[data-game-id="${CSS.escape(id)}"]`);
      if (row) focusEl(row);
    };
    // After the pop-up has gone (and again a moment later, in case anything else grabbed the focus).
    requestAnimationFrame(put);
    setTimeout(() => {
      if (!(document.activeElement as HTMLElement | null)?.closest?.(`[data-game-id="${CSS.escape(id)}"]`)) put();
    }, 120);
  }, [open]);

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
      {league.conferences && (
        <div class="chips compact conf-chips" data-group="game-confs" data-hlock>
          <Chip active={conf === undefined} onClick={() => setConf(undefined)}>{leagueId === 'cfb' ? 'FBS' : 'All'}</Chip>
          {league.conferences.map((c) => <Chip key={c.id} active={conf === c.id} onClick={() => setConf(c.id)}>{c.name}</Chip>)}
        </div>
      )}
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
              <button type="button" class={`f game-row ${st.live ? 'is-live' : ''} ${g.state === 'post' ? 'is-final' : ''}`} data-game-id={g.id} onClick={() => setOpen(g)}>
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
      {open && <WatchGame game={open} index={index} onClose={() => closeGame(open.id)} onPick={onPick} onWatch={(g) => (watching.current = g.id)} />}
    </div>
  );
}

/** The best streams for a game, best first (event channels, team channels, networks), from the user's lineup. */
/** How many of a game's top streams are checked for being on the air. */
const CHECK_TOP = 4;

export function WatchGame({ game, index, onClose, onPick, onWatch }: { game: Game; index: GameIndexEntry[] | null; onClose: () => void; onPick?: StreamPickHandler; onWatch?: (g: Game) => void }) {
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

  // Today's channel sheet first (checked against the guide at 3:00 AM / when channels change), then the live picks.
  const daySheet = useChannelSheet();
  const ranked = useMemo(() => (index ? applySheet(bestStreams(game, lineup, league.sport, index, isFav), sheetFor(game.id), lineup) : []), [game, lineup, index, favNames, daySheet]);
  // Check the top streams are actually on the air, one at a time (one extra provider connection at most).
  const [live, setLive] = useState<Map<string, Liveness>>(() => new Map());
  const [checking, setChecking] = useState<string | undefined>();
  useEffect(() => {
    const ctl = new AbortController();
    const top = ranked.slice(0, CHECK_TOP);
    setLive(new Map(top.flatMap((p) => { const v = cachedLiveness(p.ch.key); return v ? [[p.ch.key, v] as const] : []; })));
    void (async () => {
      for (const p of top) {
        if (ctl.signal.aborted) return;
        if (cachedLiveness(p.ch.key) || !canCheck(p.ch)) continue;
        setChecking(p.ch.key);
        const v = await checkStream(p.ch, ctl.signal);
        if (ctl.signal.aborted) return;
        if (v) setLive((m) => new Map(m).set(p.ch.key, v));
      }
      setChecking(undefined);
    })();
    return () => ctl.abort();
  }, [ranked]);
  // Every channel stays in the list (a quick check can be wrong, and a channel may come on any moment): ones that
  // answered go first, ones that didn't go last with a note; the ranking otherwise stays.
  const dead = ranked.filter((p) => live.get(p.ch.key) === 'dead');
  const rank = (p: (typeof ranked)[number]) => (live.get(p.ch.key) === 'live' ? 0 : live.get(p.ch.key) === 'dead' ? 2 : 1);
  const picks = [...ranked].sort((a, b) => rank(a) - rank(b));
  const allDead = dead.length > 0 && dead.length === Math.min(ranked.length, CHECK_TOP) && !ranked.some((p) => live.get(p.ch.key) === 'live');
  const watch = (key: string) => {
    // Remembered by name for this team / network, so it's found again first (even after switching providers).
    const p = ranked.find((x) => x.ch.key === key);
    if (p) rememberWatched(game, p);
    onClose();
    if (onPick) onPick(key, game);
    else {
      onWatch?.(game);
      void tune(key, { fullscreen: true });
    }
  };

  return (
    <Modal title={`${game.away.short} at ${game.home.short}`} onClose={onClose} wide class="watch-game">
      <div class="watch-head">
        <span class="watch-team"><TeamLogo team={game.away} size="lg" /><span>{game.away.rank ? `#${game.away.rank} ` : ''}{game.away.name}</span>{game.state !== 'pre' && <b>{game.away.score}</b>}</span>
        <span class="watch-mid">
          {game.state === 'in' ? <span class="badge-live">LIVE</span> : null}
          <span>{game.state === 'pre' ? clock(game.start) : game.detail}</span>
          {game.note && <small class="muted">{game.note}</small>}
          {broadcastSummary(game) && <small class="muted watch-tv">TV: {broadcastSummary(game)}</small>}
        </span>
        <span class="watch-team"><TeamLogo team={game.home} size="lg" /><span>{game.home.rank ? `#${game.home.rank} ` : ''}{game.home.name}</span>{game.state !== 'pre' && <b>{game.home.score}</b>}</span>
      </div>

      <>
          {!index ? (
            <p class="muted row gap"><span class="spinner" /> Finding channels for this game…</p>
          ) : picks.length ? (
            <div class="stream-picks" data-group="picks">
              {picks.slice(0, 10).map((p, i) => (
                <div class={`stream-pick ${i === 0 ? 'best' : ''}`} key={p.ch.key}>
                  <button type="button" class="f stream-pick-main" data-autofocus={i === 0 ? '' : undefined} onClick={() => watch(p.ch.key)}>
                    <span class="ch-num">{p.ch.number}</span>
                    <ChannelLogo ch={p.ch} src={p.ch.logo} name={p.ch.name} size="sm" />
                    <span class="stream-pick-text">
                      <ChannelName ch={p.ch} />
                      <small class="muted">
                        {i === 0 ? 'Best stream · ' : ''}
                        {live.get(p.ch.key) === 'live' ? 'Working · ' : live.get(p.ch.key) === 'dead' ? 'No picture in a quick check · ' : checking === p.ch.key ? 'Checking… · ' : ''}
                        {p.reason}
                      </small>
                    </span>
                    <span class="stream-pick-cta"><Icon name={onPick ? 'multiview' : 'play'} size="1em" /> {onPick ? 'Add' : 'Watch'}</span>
                  </button>
                </div>
              ))}
              {allDead && (
                <p class="hint">None of these showed a picture in a quick check — event channels often come on shortly before the game. You can still try any of them.</p>
              )}
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
