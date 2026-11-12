// LTTV League Pass: tonight's NBA games in one place. Opened from anywhere with Up, Up, Left, Right.
// The game you pick plays in the big window with its box score beside it; add games to watch several at once.
import { h } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getState, player, setState, tune, useApp } from '../app/state';
import { focusFirst, onBack } from '../app/nav';
import { openRemote } from '../app/platform';
import { scheduleBase, useGames } from '../app/schedule';
import { scheduleDay, type Game } from '../core/schedule';
import { bestStreams, buildGameIndexAsync, type GameIndexEntry } from '../core/streamfinder';
import { parseBoxScore, summaryUrl, type BoxTeam } from '../core/boxscore';
import { MULTI, closeMultiview, openMultiview, setTile, type MvTile } from '../app/multiview';
import { Button, Icon } from './common';
import { TeamLogo } from './Games';
import { VideoSlot } from './VideoSlot';
import { clock } from './fmt';

const MAX_PICKS = MULTI ? 4 : 2;

/** Box score for a game, refreshed every 30 seconds while it's live. */
function useBox(game: Game | undefined): BoxTeam[] | null {
  const [box, setBox] = useState<BoxTeam[] | null>(null);
  useEffect(() => {
    setBox(null);
    if (!game || game.state === 'pre') return;
    let alive = true;
    const load = async () => {
      try {
        const { stream } = await openRemote(summaryUrl(scheduleBase(), game.id), AbortSignal.timeout?.(15_000));
        const teams = parseBoxScore(JSON.parse(await new Response(stream).text()));
        if (alive) setBox(teams);
      } catch {
        /* keep what's shown */
      }
    };
    void load();
    const t = game.state === 'in' ? window.setInterval(() => void load(), 30_000) : 0;
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [game?.id, game?.state]);
  return box;
}

function BoxScore({ game, box }: { game: Game; box: BoxTeam[] | null }) {
  const [side, setSide] = useState(0);
  if (game.state === 'pre') return <div class="lp-box"><p class="muted">Box score starts at tip-off ({clock(game.start)}).</p></div>;
  if (!box) return <div class="lp-box"><p class="muted">Loading the box score…</p></div>;
  const team = box[side] ?? box[0];
  return (
    <div class="lp-box" data-group="lp-box">
      <div class="lp-box-tabs">
        {box.map((t, i) => (
          <button type="button" class={`f lp-tab ${i === side ? 'on' : ''}`} key={t.abbr} onClick={() => setSide(i)}>{t.name}</button>
        ))}
      </div>
      <div class="lp-box-head"><span>{team?.players.some((p) => p.starter) ? 'STARTERS' : 'PLAYERS'}</span><span>PTS</span><span>REB</span><span>AST</span><span>BLK</span></div>
      <div class="lp-box-rows">
        {team?.players.map((p, i) => (
          <div class={`lp-row ${p.dnp ? 'dnp' : ''}`} key={p.name + i}>
            {i > 0 && p.starter !== team.players[i - 1].starter && <div class="lp-sub">BENCH</div>}
            <span class="lp-num">{p.jersey}</span>
            {p.headshot ? <img class="lp-face" src={p.headshot} alt="" loading="lazy" /> : <span class="lp-face" />}
            <span class="lp-name">{p.name}</span>
            <span>{p.pts}</span><span>{p.reb}</span><span>{p.ast}</span><span>{p.blk}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function gameLine(g: Game, now: number) {
  if (g.state === 'in') return g.detail || 'Live';
  if (g.state === 'post') return 'Final';
  return g.start < now ? 'Starting' : clock(g.start);
}

/** A way to watch a game: one team's own broadcast, or another channel carrying it. */
interface Feed { key: string; label: string; sub: string }

export function LeaguePass() {
  const tz = useApp((s) => s.settings.timeZone);
  const now = useApp((s) => Math.floor(s.now / 60_000) * 60_000);
  const lineup = useApp((s) => s.lineup);
  const guide = useApp((s) => s.guide);
  const guideVersion = useApp((s) => s.guideVersion);
  const playing = useApp((s) => s.currentKey);
  const today = scheduleDay(now, tz);
  const { games: raw, loading } = useGames('nba', today, today);
  const games = useMemo(() => {
    const rank = (g: Game) => (g.state === 'in' ? 0 : g.state === 'pre' ? 1 : 2);
    return [...raw].sort((a, b) => rank(a) - rank(b) || a.start - b.start);
  }, [raw]);
  const [index, setIndex] = useState<GameIndexEntry[] | null>(null);
  useEffect(() => {
    if (!games.length) return;
    let alive = true;
    void buildGameIndexAsync(lineup, guide, Math.min(...games.map((g) => g.start)) - 3600_000, Math.max(...games.map((g) => g.start)) + 5 * 3600_000, guideVersion).then((i) => alive && setIndex(i));
    return () => {
      alive = false;
    };
  }, [games.length, lineup, guideVersion]);
  // Each game's broadcasts: the away team's, the home team's, then up to two other channels carrying it.
  const feeds = useMemo(() => {
    const m = new Map<string, Feed[]>();
    if (!index) return m;
    for (const g of games) {
      const picks = bestStreams(g, lineup, 'basketball', index);
      const list: Feed[] = [];
      for (const side of ['away', 'home'] as const) {
        const p = picks.find((x) => x.main && x.side === side);
        if (p) list.push({ key: p.ch.key, label: `${(side === 'away' ? g.away : g.home).abbr} broadcast`, sub: p.ch.name });
      }
      for (const p of picks.filter((x) => !list.some((f) => f.key === x.ch.key)).slice(0, 2)) list.push({ key: p.ch.key, label: p.kind === 'national' ? 'National' : 'Other', sub: p.ch.name });
      m.set(g.id, list);
    }
    return m;
  }, [games, index, lineup]);
  const feedsOf = (g: Game | undefined) => (g ? feeds.get(g.id) ?? [] : []);

  const [selected, setSelected] = useState<string | undefined>();
  const [picks, setPicks] = useState<string[]>([]);
  // Coming back from full screen in Multiview: stay in League Pass, on that game, full screen.
  const [full, setFull] = useState(() => getState().fullscreen && !!getState().currentKey);
  const [boxOpen, setBoxOpen] = useState(false);
  const [bar, setBar] = useState(true);
  const game = games.find((g) => g.id === selected) ?? games.find((g) => feedsOf(g).some((f) => f.key === playing)) ?? games[0];
  const gameFeeds = feedsOf(game);
  const onThisGame = gameFeeds.some((f) => f.key === playing);
  const box = useBox(game);
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    setState({ fullscreen: false }); // League Pass has its own full screen, not LTTV's player
    requestAnimationFrame(() => focusFirst(ref.current));
  }, []);
  useEffect(() => onBack(() => {
    if (full) setFull(false);
    else setState({ leaguePass: false });
    return true;
  }), [full]);
  // Full screen: the video fills the screen; focus moves to (or back from) the broadcast controls.
  useLayoutEffect(() => {
    player.updateRect();
    setBar(true);
    requestAnimationFrame(() => focusFirst(ref.current?.querySelector<HTMLElement>(full ? '.lp-bc' : '.lp-strip') ?? ref.current));
  }, [full]);
  // The broadcast controls get out of the way after a few seconds; any key or mouse move brings them back.
  useEffect(() => {
    if (!full) return;
    let t = window.setTimeout(() => setBar(false), 6000);
    const wake = () => {
      setBar((on) => {
        if (!on) requestAnimationFrame(() => focusFirst(ref.current?.querySelector<HTMLElement>('.lp-bc') ?? null));
        return true;
      });
      window.clearTimeout(t);
      t = window.setTimeout(() => setBar(false), 6000);
    };
    window.addEventListener('keydown', wake, true);
    window.addEventListener('mousemove', wake);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', wake, true);
      window.removeEventListener('mousemove', wake);
    };
  }, [full]);

  const watch = (g: Game, key?: string) => {
    setSelected(g.id);
    const f = feedsOf(g);
    const k = key ?? (f.some((x) => x.key === playing) ? playing : f[0]?.key);
    if (k && k !== playing) void tune(k, { fullscreen: false });
  };
  const step = (d: number) => {
    const withStream = games.filter((g) => feedsOf(g).length);
    const i = withStream.findIndex((g) => g.id === game?.id);
    const next = withStream[(i + d + withStream.length) % withStream.length];
    if (next) watch(next);
  };
  const tileFor = (g: Game): MvTile | null => {
    const f = feedsOf(g)[0];
    return f ? { key: f.key, title: `${g.away.short} @ ${g.home.short}`, sub: f.sub } : null;
  };
  const togglePick = (g: Game) => setPicks((p) => (p.includes(g.id) ? p.filter((x) => x !== g.id) : p.length >= MAX_PICKS ? p : [...p, g.id]));
  const startMultiview = () => {
    const tiles = picks.map((id) => games.find((g) => g.id === id)).filter((g): g is Game => !!g).map(tileFor).filter((t): t is MvTile => !!t);
    if (!tiles.length) return;
    // League Pass stays open underneath: leaving Multiview comes back here, not to LTTV.
    openMultiview(tiles[0]);
    tiles.slice(1).forEach((t, i) => setTimeout(() => setTile(i + 1, t), 1500 * (i + 1)));
  };
  const feedButtons = (cls: string) => gameFeeds.map((f) => (
    <button type="button" class={`f ${cls} ${f.key === playing ? 'on' : ''}`} key={f.key} onClick={() => game && watch(game, f.key)} title={f.sub}>
      <b>{f.label}</b>
      <small>{f.sub}</small>
    </button>
  ));
  const scoreBug = game && (
    <div class="lp-score">
      <TeamLogo team={game.away} size="sm" /><b>{game.away.abbr}</b><span class="lp-pts">{game.away.score ?? ''}</span>
      <span class="lp-clock">{gameLine(game, now)}</span>
      <span class="lp-pts">{game.home.score ?? ''}</span><b>{game.home.abbr}</b><TeamLogo team={game.home} size="sm" />
    </div>
  );

  return (
    <section class={`league-pass ${full ? 'lp-full' : ''} ${full && !bar ? 'lp-quiet' : ''}`} data-scope ref={ref} aria-label="LTTV League Pass">
      <div class="lp-bg" />
      <header class="lp-top">
        <h1><span class="lp-mark">LTTV</span> League Pass</h1>
        <span class="muted">{new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        <span class="lp-spacer" />
        {picks.length > 0 && <Button variant="primary" icon="multiview" onClick={startMultiview}>Watch {picks.length} game{picks.length === 1 ? '' : 's'} together</Button>}
        {onThisGame && <Button icon="fullscreen" onClick={() => setFull(true)}>Full screen</Button>}
        <Button variant="ghost" icon="close" onClick={() => setState({ leaguePass: false })}>Close</Button>
      </header>

      <div class="lp-main">
        <div class="lp-stage">
          <VideoSlot priority={150} class="lp-video">
            {!onThisGame && !full && <div class="lp-hint">{game ? (gameFeeds.length ? 'Pick a game or a broadcast below to watch it here' : index ? 'No stream found for this game in your playlist' : 'Finding streams…') : loading ? 'Loading tonight’s games…' : 'No NBA games today'}</div>}
            {full && (
              <div class="lp-bc" data-group="lp-bc">
                <div class="lp-bc-top">
                  <button type="button" class="f lp-bc-btn" onClick={() => setFull(false)}><Icon name="chevronLeft" size="1.2em" /> League Pass</button>
                  {scoreBug}
                  <span class="lp-bc-live">{game?.state === 'in' ? 'LIVE' : ''}</span>
                </div>
                <div class="lp-bc-bottom">
                  <button type="button" class="f lp-bc-btn" onClick={() => step(-1)} aria-label="Previous game"><Icon name="chevronLeft" size="1.2em" /></button>
                  <div class="lp-bc-feeds">{feedButtons('lp-bc-feed')}</div>
                  <button type="button" class={`f lp-bc-btn ${boxOpen ? 'on' : ''}`} onClick={() => setBoxOpen((v) => !v)}>Box score</button>
                  <button type="button" class="f lp-bc-btn" onClick={() => step(1)} aria-label="Next game"><Icon name="chevronRight" size="1.2em" /></button>
                </div>
              </div>
            )}
          </VideoSlot>
          {scoreBug}
          {gameFeeds.length > 0 && <div class="lp-feeds" data-group="lp-feeds">{feedButtons('lp-feed')}</div>}
        </div>
        {game && (!full || boxOpen) && <BoxScore game={game} box={box} />}
      </div>

      <div class="lp-strip" data-group="lp-strip">
        {games.map((g) => {
          const on = picks.includes(g.id);
          const has = feedsOf(g).length > 0;
          return (
            <div class="lp-card-wrap" key={g.id}>
              <button
                type="button"
                class={`f lp-card ${g.id === game?.id ? 'current' : ''} ${has ? '' : 'nostream'}`}
                style={{ '--a': g.away.color ? `#${g.away.color}` : '#333', '--h': g.home.color ? `#${g.home.color}` : '#555' }}
                data-autofocus={g.id === game?.id ? '' : undefined}
                onClick={() => watch(g)}
                aria-label={`${g.away.name} at ${g.home.name}, ${gameLine(g, now)}`}
              >
                {g.state === 'in' && <span class="lp-live">LIVE</span>}
                <span class="lp-teams"><TeamLogo team={g.away} size="sm" /><TeamLogo team={g.home} size="sm" /></span>
                <span class="lp-line">{g.away.abbr} {g.away.score ?? ''} · {g.home.abbr} {g.home.score ?? ''}</span>
                <span class="lp-when">{gameLine(g, now)}</span>
              </button>
              <button type="button" class={`f lp-pick ${on ? 'on' : ''}`} disabled={!has} onClick={() => togglePick(g)} aria-label={on ? 'Remove from games to watch together' : 'Add to games to watch together'}>
                {on ? '✓ Added' : '+ Add'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------- Up, Up, Left, Right opens it ----------------
const SEQ = ['ArrowUp', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];
let recent: { key: string; at: number }[] = [];
export function watchLeaguePassKeys(): () => void {
  const on = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const now = Date.now();
    recent = [...recent.filter((k) => now - k.at < 2500), { key: e.key, at: now }].slice(-SEQ.length);
    if (recent.length === SEQ.length && recent.every((k, i) => k.key === SEQ[i])) {
      recent = [];
      if (getState().leaguePass && !getState().multiview) return;
      if (getState().multiview) closeMultiview(-1);
      setState({ leaguePass: true, fullscreen: false });
    }
  };
  window.addEventListener('keydown', on, true);
  return () => window.removeEventListener('keydown', on, true);
}
