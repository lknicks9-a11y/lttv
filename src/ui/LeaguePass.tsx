// LTTV League Pass: tonight's NBA games in one place. Opened from anywhere with Up, Up, Left, Right.
// The game you pick plays in the big window with its box score beside it; add games to watch several at once.
import { h } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getState, setState, tune, useApp } from '../app/state';
import { focusFirst, onBack } from '../app/nav';
import { openRemote } from '../app/platform';
import { scheduleBase, useGames } from '../app/schedule';
import { scheduleDay, type Game } from '../core/schedule';
import { bestStreams, buildGameIndexAsync, type GameIndexEntry } from '../core/streamfinder';
import { parseBoxScore, summaryUrl, type BoxTeam } from '../core/boxscore';
import { MULTI, closeMultiview, openMultiview, setTile, type MvTile } from '../app/multiview';
import { Button } from './common';
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

export function LeaguePass() {
  const tz = useApp((s) => s.settings.timeZone);
  const now = useApp((s) => Math.floor(s.now / 60_000) * 60_000);
  const lineup = useApp((s) => s.lineup);
  const guide = useApp((s) => s.guide);
  const guideVersion = useApp((s) => s.guideVersion);
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
  const streamFor = (g: Game) => (index ? bestStreams(g, lineup, 'basketball', index)[0] : undefined);

  const [selected, setSelected] = useState<string | undefined>();
  const [picks, setPicks] = useState<string[]>([]);
  const game = games.find((g) => g.id === selected) ?? games[0];
  const box = useBox(game);
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    requestAnimationFrame(() => focusFirst(ref.current));
  }, []);
  useEffect(() => onBack(() => (setState({ leaguePass: false }), true)), []);

  const watch = (g: Game) => {
    setSelected(g.id);
    const s = streamFor(g);
    if (s) void tune(s.ch.key, { fullscreen: false });
  };
  const tileFor = (g: Game): MvTile | null => {
    const s = streamFor(g);
    return s ? { key: s.ch.key, title: `${g.away.short} @ ${g.home.short}`, sub: s.ch.name } : null;
  };
  const togglePick = (g: Game) => setPicks((p) => (p.includes(g.id) ? p.filter((x) => x !== g.id) : p.length >= MAX_PICKS ? p : [...p, g.id]));
  const startMultiview = () => {
    const tiles = picks.map((id) => games.find((g) => g.id === id)).filter((g): g is Game => !!g).map(tileFor).filter((t): t is MvTile => !!t);
    if (!tiles.length) return;
    setState({ leaguePass: false });
    openMultiview(tiles[0]);
    tiles.slice(1).forEach((t, i) => setTimeout(() => setTile(i + 1, t), 1500 * (i + 1)));
  };
  const playing = useApp((s) => s.currentKey);
  const gameStream = game ? streamFor(game) : undefined;

  return (
    <section class="league-pass" data-scope ref={ref} aria-label="LTTV League Pass">
      <header class="lp-top">
        <h1><span class="lp-mark">LTTV</span> League Pass</h1>
        <span class="muted">{new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        <span class="lp-spacer" />
        {picks.length > 0 && <Button variant="primary" icon="multiview" onClick={startMultiview}>Watch {picks.length} game{picks.length === 1 ? '' : 's'} together</Button>}
        {playing && <Button icon="fullscreen" onClick={() => { setState({ leaguePass: false, fullscreen: true }); }}>Full screen</Button>}
        <Button variant="ghost" icon="close" onClick={() => setState({ leaguePass: false })}>Close</Button>
      </header>

      <div class="lp-main">
        <div class="lp-stage">
          <VideoSlot priority={150} class="lp-video">
            {!playing && <div class="lp-hint">{game ? (gameStream ? 'Pick a game below to watch it here' : index ? 'No stream found for this game in your playlist' : 'Finding streams…') : loading ? 'Loading tonight’s games…' : 'No NBA games today'}</div>}
          </VideoSlot>
          {game && (
            <div class="lp-score">
              <TeamLogo team={game.away} size="sm" /><b>{game.away.abbr}</b><span>{game.away.score ?? ''}</span>
              <span class="muted">{gameLine(game, now)}</span>
              <span>{game.home.score ?? ''}</span><b>{game.home.abbr}</b><TeamLogo team={game.home} size="sm" />
            </div>
          )}
        </div>
        {game && <BoxScore game={game} box={box} />}
      </div>

      <div class="lp-strip" data-group="lp-strip">
        {games.map((g) => {
          const on = picks.includes(g.id);
          const has = !!streamFor(g);
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
      if (getState().multiview) closeMultiview(-1);
      setState({ leaguePass: true, fullscreen: false });
    }
  };
  window.addEventListener('keydown', on, true);
  return () => window.removeEventListener('keydown', on, true);
}
