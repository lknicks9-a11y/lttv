// LTTV League Pass (NBA) and LTTV Blitz (NFL): the league's games in one place. Opened from Sports, or from anywhere
// with Up, Up, Left, Right (League Pass) / Up ×5, Down ×2, Right (Blitz).
// The game you pick plays in the big window with its box score beside it; add games to watch several at once.
import { h, Fragment } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getState, player, setState, tune, useApp } from '../app/state';
import { focusFirst, onBack } from '../app/nav';
import { openRemote } from '../app/platform';
import { scheduleBase, useGames } from '../app/schedule';
import { scheduleDay, type Game } from '../core/schedule';
import { bestStreams, buildGameIndexAsync, type GameIndexEntry } from '../core/streamfinder';
import { parseBoxScore, parseNflBox, summaryUrl, type BoxTeam, type StatTeam } from '../core/boxscore';
import type { LineupChannel } from '../core/types';
import type { ScheduleLeagueId } from '../core/schedule';
import { MULTI, closeMultiview, openMultiview, restartTile, setActiveTile, setLayout, setTile, tilePlayer, type MvLayout, type MvTile } from '../app/multiview';
import { Button, Icon, Modal } from './common';
import { TeamLogo } from './Games';
import { VideoSlot } from './VideoSlot';
import { PlayerProfile } from './PlayerProfile';
import { TimeoutShow, musicOn, setMusicOn, useTimeoutMedia } from './Timeout';
import { clock } from './fmt';

const MAX_PICKS = MULTI ? 4 : 2;

/** League Pass (NBA) and Blitz (NFL) are the same place with different leagues. */
interface PassCfg {
  league: 'nba' | 'nfl';
  sport: 'basketball' | 'football';
  path: string;
  name: string;
  accent: string;
  /** Days of games shown from today (the NFL plays Thursday to Monday). */
  days: number;
  /** Channels that are always worth having at hand, whatever the game. */
  extras: { label: string; re: RegExp }[];
}
const PASSES: Record<'nba' | 'nfl', PassCfg> = {
  nba: { league: 'nba', sport: 'basketball', path: 'basketball/nba', name: 'League Pass', accent: '#ffa04d', days: 1, extras: [] },
  nfl: { league: 'nfl', sport: 'football', path: 'football/nfl', name: 'Blitz', accent: '#3ddc84', days: 6, extras: [{ label: 'NFL RedZone', re: /\bred\s?zone\b/i }, { label: 'NFL Network', re: /\bnfl\s?(network|net|nw)\b/i }] },
};
/** The playlist's best channel(s) for an always-on network: English / US and HD first. */
function extraChannels(lineup: LineupChannel[], re: RegExp): LineupChannel[] {
  const score = (c: LineupChannel) => {
    const t = `${c.group ?? ''} ${c.name}`;
    return (/\b(US|USA|EN)\b/i.test(t) ? 4 : 0) + (/\b(F?HD|RAW)\b|ᴴᴰ|ᴿᴬᵂ/i.test(t) ? 2 : 0) - (/\b(4K|UHD|SD|ES|LAT|FR|DE|IT|PT|AR|MX|ESPA\w*)\b/i.test(t) ? 3 : 0);
  };
  return lineup.filter((c) => !c.hidden && re.test(c.name)).sort((a, b) => score(b) - score(a) || a.number - b.number).slice(0, 2);
}

/** Box score for a game, refreshed every 30 seconds while it's live. */
function useBox<T>(game: Game | undefined, path: string, parse: (j: unknown) => T): T | null {
  const [box, setBox] = useState<T | null>(null);
  useEffect(() => {
    setBox(null);
    if (!game || game.state === 'pre') return;
    let alive = true;
    const load = async () => {
      try {
        const { stream } = await openRemote(summaryUrl(scheduleBase(), game.id, path), AbortSignal.timeout?.(15_000));
        const teams = parse(JSON.parse(await new Response(stream).text()));
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
  const [who, setWho] = useState<{ id: string; name: string; headshot?: string } | null>(null);
  if (game.state === 'pre') return <div class="lp-box"><p class="muted">Box score starts at tip-off ({clock(game.start)}).</p></div>;
  if (!box) return <div class="lp-box"><p class="muted">Loading the box score…</p></div>;
  const team = box[side] ?? box[0];
  return (
    <div class="lp-box" data-group="lp-box" data-enter-top>
      <div class="lp-box-tabs">
        {box.map((t, i) => (
          <button type="button" class={`f lp-tab ${i === side ? 'on' : ''}`} key={t.abbr} data-default-focus={i === side ? '' : undefined} onClick={() => setSide(i)}>{t.name}</button>
        ))}
      </div>
      <div class="lp-box-head"><span>{team?.players.some((p) => p.starter) ? 'STARTERS' : 'PLAYERS'}</span><span>PTS</span><span>REB</span><span>AST</span><span>BLK</span></div>
      <div class="lp-box-rows">
        {team?.players.map((p, i) => (
          <Fragment key={p.name + i}>
            {i > 0 && p.starter !== team.players[i - 1].starter && <div class="lp-sub">BENCH</div>}
            <button type="button" class={`f lp-row ${p.dnp ? 'dnp' : ''}`} disabled={!p.id} onClick={() => p.id && setWho({ id: p.id, name: p.name, headshot: p.headshot })} aria-label={`${p.name}: stats and recent games`}>
              <span class="lp-num">{p.jersey}</span>
              {p.headshot ? <img class="lp-face" src={p.headshot} alt="" loading="lazy" /> : <span class="lp-face" />}
              <span class="lp-name">{p.name}</span>
              <span>{p.pts}</span><span>{p.reb}</span><span>{p.ast}</span><span>{p.blk}</span>
            </button>
          </Fragment>
        ))}
      </div>
      {who && <PlayerProfile id={who.id} name={who.name} headshot={who.headshot} onClose={() => setWho(null)} />}
    </div>
  );
}

function gameLine(g: Game, now: number) {
  if (g.state === 'in') return g.detail || 'Live';
  if (g.state === 'post') return 'Final';
  if (g.start < now) return 'Starting';
  // Another day (Blitz lists the week): say which.
  return new Date(g.start).toDateString() === new Date(now).toDateString() ? clock(g.start) : `${new Date(g.start).toLocaleDateString(undefined, { weekday: 'short' })} ${clock(g.start)}`;
}

/** Blitz: each team's passing, rushing and receiving lines. Rows take the remote so the list scrolls. */
function NflBox({ game, box }: { game: Game; box: StatTeam[] | null }) {
  const [side, setSide] = useState(0);
  const [who, setWho] = useState<{ id: string; name: string; headshot?: string } | null>(null);
  if (game.state === 'pre') return <div class="lp-box"><p class="muted">Stats start at kickoff ({new Date(game.start).toLocaleDateString(undefined, { weekday: 'short' })} {clock(game.start)}).</p></div>;
  if (!box) return <div class="lp-box"><p class="muted">Loading the stats…</p></div>;
  const team = box[side] ?? box[0];
  return (
    <div class="lp-box" data-group="lp-box" data-enter-top>
      <div class="lp-box-tabs">
        {box.map((t, i) => <button type="button" class={`f lp-tab ${i === side ? 'on' : ''}`} key={t.abbr} data-default-focus={i === side ? '' : undefined} onClick={() => setSide(i)}>{t.name}</button>)}
      </div>
      <div class="lp-box-rows">
        {team?.groups.map((g) => (
          <Fragment key={g.title}>
            <div class="lp-box-head lp-nfl" style={{ '--n': g.head.length }}><span>{g.title.toUpperCase()}</span>{g.head.map((x) => <span key={x}>{x}</span>)}</div>
            {g.rows.map((r, i) => (
              <button type="button" class="f lp-row lp-nfl" key={r.name + i} style={{ '--n': g.head.length }} disabled={!r.id} onClick={() => r.id && setWho({ id: r.id, name: r.name, headshot: r.headshot })} aria-label={`${r.name}: stats and recent games`}>
                <span class="lp-num">{r.jersey}</span>
                {r.headshot ? <img class="lp-face" src={r.headshot} alt="" loading="lazy" /> : <span class="lp-face" />}
                <span class="lp-name">{r.name}</span>
                {r.cells.map((c, k) => <span key={k}>{c}</span>)}
              </button>
            ))}
          </Fragment>
        ))}
        {!team?.groups.length && <p class="muted">No stats yet.</p>}
      </div>
      {who && <PlayerProfile league="nfl" id={who.id} name={who.name} headshot={who.headshot} onClose={() => setWho(null)} />}
    </div>
  );
}

/** The marks: League Pass is a ball whose seams frame a play button; Blitz is a bolt on a field. LTTV's own artwork. */
export function LpLogo({ size = '2.2rem', kind = 'nba' }: { size?: string; kind?: 'nba' | 'nfl' }) {
  if (kind === 'nfl') {
    return (
      <svg class="lp-logo" viewBox="0 0 48 48" style={{ width: size, height: size }} aria-hidden="true">
        <defs>
          <linearGradient id="lp-field" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#4fe39a" />
            <stop offset="1" stop-color="#0f8a4d" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="44" height="44" rx="13" fill="url(#lp-field)" />
        <g stroke="#063d22" stroke-width="1.6" opacity="0.5"><path d="M2 16h44M2 32h44" /></g>
        <path d="M27.500 6 13 27h9.500l-3 15L35 20h-9.500z" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg class="lp-logo" viewBox="0 0 48 48" style={{ width: size, height: size }} aria-hidden="true">
      <defs>
        <linearGradient id="lp-ball" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffa04d" />
          <stop offset="1" stop-color="#e2451c" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="url(#lp-ball)" />
      <g fill="none" stroke="#2a1206" stroke-width="1.7" stroke-linecap="round" opacity="0.6">
        <path d="M2.5 24h43" />
        <path d="M9 8.2c6.6 7 6.6 24.600 0 31.600" />
        <path d="M39 8.200c-6.600 7-6.600 24.600 0 31.600" />
      </g>
      <path d="M19.500 14.800v18.400l15-9.200z" fill="#fff" />
    </svg>
  );
}

function TileVideo({ i }: { i: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => tilePlayer(i).registerSlot(ref.current!, 50), [i]);
  return <div class="video-slot lpm-video" ref={ref} />;
}

/** One game in League Pass's Multiview. Sound follows the tile you are on. */
function LpTile({ i, tile, label, active, onOpen }: { i: number; tile: MvTile | null; label?: string; active: boolean; onOpen: () => void }) {
  const ctl = tilePlayer(i);
  const [st, setSt] = useState(ctl.status);
  useEffect(() => ctl.subscribe(setSt), [ctl]);
  const busy = st.state === 'loading' || st.state === 'buffering' || st.state === 'retrying';
  return (
    <div class="lpm-cell" data-tile={i}>
      <button
        type="button"
        class={`f lpm-tile ${tile ? '' : 'empty'} ${active ? 'sound' : ''}`}
        data-autofocus={i === 0 ? '' : undefined}
        onFocus={() => tile && setActiveTile(i)}
        onClick={() => (tile && st.state === 'error' ? restartTile(i) : onOpen())}
        aria-label={tile ? `${tile.title}${active ? ', sound on' : ''}` : 'Add a game'}
      >
        {tile ? <TileVideo i={i} /> : <span class="lpm-add"><Icon name="add" size="2.6rem" />Add a game</span>}
        {tile && busy && <span class="spinner lpm-spin" />}
        {tile && st.state === 'error' && <span class="lpm-err">This broadcast didn’t play. Press OK to try again, or pick another broadcast.</span>}
        {tile && (
          <span class="lpm-label">
            {active && <Icon name="volume" size="1.1em" />}
            <b>{tile.title}</b>
            {label && <small>{label}</small>}
            {st.drops ? <small>· reconnected {st.drops}×</small> : null}
          </span>
        )}
      </button>
    </div>
  );
}

/** A way to watch a game: one team's own broadcast, or another channel carrying it. */
interface Feed { key: string; label: string; sub: string; /** A team's own channel: only on the air around its game. */ team?: 'home' | 'away' }

/**
 * A team's own channel only carries something around its game. League Pass shows its own timeout screen until
 * the game's listed start time (7:00 game: until 7:00), then goes to the broadcast by itself; it stays on the
 * air until about an hour and a half after the final (a game runs about two and a half hours).
 */
const ON_AIR_BEFORE = 0;
const ON_AIR_AFTER_START = 4 * 3600_000;
function offAir(g: Game, now: number): boolean {
  if (g.state === 'in') return false;
  if (g.state === 'pre') return g.start - now > ON_AIR_BEFORE;
  return now - g.start > ON_AIR_AFTER_START;
}
function untilText(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m >= 24 * 60) {
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    return `${d} day${d === 1 ? '' : 's'}${h ? ` ${h} h` : ''}`;
  }
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
}

export function LeaguePass() {
  const tz = useApp((s) => s.settings.timeZone);
  const now = useApp((s) => Math.floor(s.now / 60_000) * 60_000);
  const lineup = useApp((s) => s.lineup);
  const guide = useApp((s) => s.guide);
  const guideVersion = useApp((s) => s.guideVersion);
  const playing = useApp((s) => s.currentKey);
  const cfg = PASSES[useApp((s) => s.passLeague) ?? 'nba'];
  // The day's games stay up until 7:00 the next morning: late games run past midnight.
  const today = scheduleDay(now - 7 * 3600_000, tz);
  // The NFL's games come by the week (Thursday to Monday), so Blitz lists the next days too.
  const day = cfg.league === 'nfl' ? 'week' : today;
  const { games: raw, loading } = useGames(cfg.league as ScheduleLeagueId, day, today);
  const extras = useMemo(() => cfg.extras.flatMap((x) => extraChannels(lineup, x.re).map((ch, i): Feed => ({ key: ch.key, label: i ? `${x.label} ${i + 1}` : x.label, sub: ch.name }))), [lineup, cfg]);
  const games = useMemo(() => {
    const rank = (g: Game) => (g.state === 'in' ? 0 : g.state === 'pre' ? 1 : 2);
    // Small logos: the source's are 500 px, shown here at 30 to 140 px (dozens of full-size ones slow a Fire TV Stick).
    const small = (t: Game['home']) => {
      const m = /^https:\/\/a\.espncdn\.com(\/i\/teamlogos\/[^?]+)$/.exec(t.logo ?? '');
      return m ? { ...t, logo: `https://a.espncdn.com/combiner/i?img=${m[1]}&w=160&h=160` } : t;
    };
    return [...raw].sort((a, b) => rank(a) - rank(b) || a.start - b.start).map((g) => ({ ...g, home: small(g.home), away: small(g.away) }));
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
      const picks = bestStreams(g, lineup, cfg.sport, index);
      const list: Feed[] = [];
      const abbr = (side?: 'home' | 'away') => (side === 'away' ? g.away : g.home).abbr;
      // 1. Each team's own channel from the playlist (the one named after the team), away then home.
      for (const side of ['away', 'home'] as const) {
        for (const p of picks.filter((x) => x.main && x.team && x.side === side)) list.push({ key: p.ch.key, label: `${abbr(side)} broadcast`, sub: p.ch.name, team: side });
      }
      // 2. The local stations picked for the teams, when the game is on them tonight.
      for (const p of picks.filter((x) => x.main && !x.team)) list.push({ key: p.ch.key, label: `${abbr(p.side)} local`, sub: p.ch.name });
      // Blitz: the game's networks by name (CBS, FOX, ESPN…), the teams' local stations and the game channels.
      if (cfg.league === 'nfl') {
        const net = (name: string) => g.broadcasts.find((b) => b.kind !== 'streaming' && new RegExp(`(^|[^a-z0-9])${b.name.replace(/[^a-z0-9]+/gi, '\\W*')}([^a-z0-9]|$)`, 'i').test(name))?.name;
        // Like League Pass: each team's own channel first (away, home), then the networks, the locals and game channels.
        const isTeam = (x: typeof picks[number]) => /team channel/.test(x.reason ?? '') && !!x.side;
        const rest = picks.filter((x) => !extras.some((e) => e.key === x.ch.key));
        const ordered = [...rest.filter((x) => isTeam(x) && x.side === 'away'), ...rest.filter((x) => isTeam(x) && x.side === 'home'), ...rest.filter((x) => !isTeam(x))];
        for (const p of ordered.slice(0, 8)) {
          const n = p.broadcast ?? net(p.ch.name);
          const label = isTeam(p) ? `${abbr(p.side)} broadcast` : p.kind === 'event' ? 'Game channel' : p.kind === 'local' && p.side ? `${abbr(p.side)} local${n ? ` · ${n}` : ''}` : n ?? (p.kind === 'national' ? 'National' : 'Other');
          list.push({ key: p.ch.key, label, sub: p.ch.name, team: isTeam(p) ? p.side : undefined });
        }
        m.set(g.id, list);
        continue;
      }
      // 3. A few other good streams, just in case.
      for (const p of picks.filter((x) => !x.main && !extras.some((e) => e.key === x.ch.key)).slice(0, cfg.league === 'nba' ? 3 : 5)) list.push({ key: p.ch.key, label: p.kind === 'national' ? 'National' : p.kind === 'event' ? 'Game channel' : p.kind === 'local' ? 'Local' : 'Other', sub: p.ch.name });
      m.set(g.id, list);
    }
    return m;
  }, [games, index, lineup, extras]);
  const feedsOf = (g: Game | undefined) => (g ? feeds.get(g.id) ?? [] : []);

  const [selected, setSelected] = useState<string | undefined>();
  const [picks, setPicks] = useState<string[]>([]);
  // Coming back from full screen in Multiview: stay in League Pass, on that game, full screen.
  const [full, setFull] = useState(() => getState().fullscreen && !!getState().currentKey);
  const [boxOpen, setBoxOpen] = useState(false);
  // No spoilers: hide the score of the game you're watching (remembered).
  const [hideScore, setHideScore] = useState(() => { try { return localStorage.getItem('lttvLpHideScore') === '1'; } catch { return false; } });
  const toggleScore = () => setHideScore((v) => { try { localStorage.setItem('lttvLpHideScore', v ? '0' : '1'); } catch { /* not remembered */ } return !v; });
  const mv = useApp((s) => s.multiview);
  /** Multiview: the tile whose options are open, and whether its game list is showing. */
  const [sheet, setSheet] = useState<{ i: number; games: boolean } | null>(null);
  const [bar, setBar] = useState(true);
  const game = games.find((g) => g.id === selected) ?? games.find((g) => feedsOf(g).some((f) => f.key === playing)) ?? games[0];
  const gameFeeds = feedsOf(game);
  const extraOn = extras.find((f) => f.key === playing);
  // "On" covers the always-on networks too (RedZone has no game of its own).
  const onThisGame = gameFeeds.some((f) => f.key === playing) || !!extraOn;
  const nbaBox = useBox(cfg.league === 'nba' ? game : undefined, cfg.path, parseBoxScore);
  const nflBox = useBox(cfg.league === 'nfl' ? game : undefined, cfg.path, parseNflBox);
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    setState({ fullscreen: false }); // League Pass has its own full screen, not LTTV's player
    requestAnimationFrame(() => focusFirst(ref.current));
  }, []);
  useEffect(() => onBack(() => {
    if (mv) closeMultiview(-1); // Multiview → back to League Pass
    else if (full) setFull(false);
    else setState({ leaguePass: false });
    return true;
  }), [full, !!mv]);
  useLayoutEffect(() => {
    setSheet(null);
    requestAnimationFrame(() => focusFirst(ref.current));
  }, [!!mv]);
  // The remote starts on tonight's games (they arrive a moment after the screen opens), not on the top buttons.
  const hasGames = games.length > 0;
  useEffect(() => {
    if (!hasGames || full || mv) return;
    requestAnimationFrame(() => {
      const strip = ref.current?.querySelector<HTMLElement>('.lp-strip');
      if (strip && !strip.contains(document.activeElement)) (strip.querySelector<HTMLElement>('.lp-card.current') ?? strip.querySelector<HTMLElement>('.lp-card'))?.focus();
    });
  }, [hasGames]);
  // Up from the broadcasts (the row under the picture) is "just show me the game": full screen, controls hidden.
  const quietEntry = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || full || mv) return;
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' || !(getState().currentKey || el.querySelector('.lp-timeout'))) return;
      const a = document.activeElement as HTMLElement | null;
      // From the broadcasts; or from the games when there are no broadcast buttons to pass through.
      if (!a?.closest('.lp-feeds') && !(a?.classList.contains('lp-card') && !el.querySelector('.lp-feeds'))) return;
      e.preventDefault();
      e.stopPropagation();
      quietEntry.current = true;
      setFull(true);
    };
    el.addEventListener('keydown', up, true);
    return () => el.removeEventListener('keydown', up, true);
  }, [full, !!mv]);
  // Watching on the League Pass page: after 10 seconds without a press, the games and broadcasts tuck away and
  // the picture grows. Any button (Up, OK, Back…) brings them back; that press does nothing else.
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || full || mv || !playing) {
      setTucked(false);
      return;
    }
    let t = window.setTimeout(() => setTucked(true), 10_000);
    const poke = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setTucked(true), 10_000);
    };
    const key = (e: KeyboardEvent) => {
      if (tuckedRef.current) {
        e.preventDefault();
        e.stopPropagation();
        setTucked(false);
      }
      poke();
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointermove', poke, true);
    window.addEventListener('pointerdown', poke, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('pointermove', poke, true);
      window.removeEventListener('pointerdown', poke, true);
    };
  }, [full, !!mv, !!playing]);
  const tuckedRef = useRef(false);
  tuckedRef.current = tucked;
  useLayoutEffect(() => {
    player.updateRect();
    if (!tucked && ref.current && !full) requestAnimationFrame(() => {
      const row = ref.current?.querySelector<HTMLElement>('.lp-feeds') ?? ref.current?.querySelector<HTMLElement>('.lp-strip');
      if (row && !row.contains(document.activeElement)) (row.querySelector<HTMLElement>('.lp-feed.on, .lp-card.current') ?? row.querySelector<HTMLElement>('.f'))?.focus();
    });
  }, [tucked]);
  // Full screen: the video fills the screen; focus moves to (or back from) the broadcast controls.
  useLayoutEffect(() => {
    player.updateRect();
    setBar(!(full && quietEntry.current));
    requestAnimationFrame(() => focusFirst(ref.current?.querySelector<HTMLElement>(full ? '.lp-bc-feeds' : '.lp-strip') ?? ref.current));
  }, [full]);
  // The broadcast controls get out of the way after a few seconds; any key or mouse move brings them back.
  useEffect(() => {
    if (!full) {
      quietEntry.current = false;
      return;
    }
    let t = window.setTimeout(() => setBar(false), 6000);
    const wake = (e: Event) => {
      setBar((on) => {
        if (!on) {
          // The press that brings the controls back does nothing else (it used to press a hidden button).
          if (e.type === 'keydown' && !/^(Escape|Backspace|GoBack|BrowserBack)$/.test((e as KeyboardEvent).key)) {
            e.preventDefault();
            e.stopPropagation();
          }
          requestAnimationFrame(() => focusFirst(ref.current?.querySelector<HTMLElement>('.lp-bc-feeds') ?? ref.current?.querySelector<HTMLElement>('.lp-bc') ?? null));
        }
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

  /** A team broadcast picked while it's off the air: League Pass's own screen shows instead of the provider's slide. */
  const [off, setOff] = useState<{ gameId: string; key: string } | null>(null);
  const watch = (g: Game, key?: string) => {
    setSelected(g.id);
    const f = feedsOf(g);
    const k = key ?? (f.some((x) => x.key === playing) ? playing : f[0]?.key);
    const feed = f.find((x) => x.key === k);
    // An off-air game: the timeout screen (NBA: a team's own channel; Blitz: any of the game's channels, which
    // show other programmes until the game).
    if ((feed?.team || cfg.league === 'nfl') && offAir(g, Date.now())) {
      player.stop();
      setState({ currentKey: undefined });
      setOff({ gameId: g.id, key: feed?.key ?? '' });
      return;
    }
    setOff(null);
    if (k && k !== playing) void tune(k, { fullscreen: false });
  };
  const tmedia = useTimeoutMedia();
  const [music, setMusic] = useState(musicOn);
  const offGame = off ? games.find((g) => g.id === off.gameId) : undefined;
  const offFeed = offGame && feedsOf(offGame).find((f) => f.key === off!.key);
  // Is any game on the air right now (live, or inside its broadcast window)?
  const anyOnAir = games.some((g) => !offAir(g, now));
  // The timeout screen only comes up once you pick a broadcast that's off the air (never by itself on the League Pass
  // page, where it kept showing pictures from earlier).
  const timeoutUp = !playing && !mv && !!offGame && (!!offFeed || cfg.league === 'nfl');
  // The broadcast opens (an hour before tip-off): go to it without being asked.
  useEffect(() => {
    if (!off || !offGame || offAir(offGame, now)) return;
    setOff(null);
    const k = off.key || feedsOf(offGame)[0]?.key;
    if (k) void tune(k, { fullscreen: false });
  }, [now, off, offGame?.state]);
  const step = (d: number) => {
    const withStream = games.filter((g) => feedsOf(g).length);
    const i = withStream.findIndex((g) => g.id === game?.id);
    const next = withStream[(i + d + withStream.length) % withStream.length];
    if (next) watch(next);
  };
  const tileOf = (g: Game, f: Feed): MvTile => ({ key: f.key, title: `${g.away.abbr} @ ${g.home.abbr}`, sub: f.label });
  const togglePick = (g: Game) => setPicks((p) => (p.includes(g.id) ? p.filter((x) => x !== g.id) : p.length >= MAX_PICKS ? p : [...p, g.id]));
  const startMultiview = () => {
    const tiles = picks.map((id) => games.find((g) => g.id === id)).filter((g): g is Game => !!g && feedsOf(g).length > 0).map((g) => tileOf(g, feedsOf(g)[0]));
    if (!tiles.length) return;
    setFull(false);
    openMultiview(tiles[0]);
    setLayout(Math.min(4, Math.max(2, tiles.length)) as MvLayout);
    tiles.slice(1).forEach((t, i) => setTile(i + 1, t)); // they start one after another (the engine spaces them)
  };
  /** The game and broadcast a Multiview tile is showing. */
  const tileGame = (t: MvTile | null | undefined) => (t ? games.find((g) => feedsOf(g).some((f) => f.key === t.key)) : undefined);
  const tileFeed = (t: MvTile | null | undefined) => feedsOf(tileGame(t)).find((f) => f.key === t?.key);
  const feedButtons = (cls: string) => [...extras.map((f) => ({ f, extra: true })), ...gameFeeds.map((f) => ({ f, extra: false }))].map(({ f, extra }) => (
    <button type="button" class={`f ${cls} ${extra ? 'extra' : ''} ${f.key === playing || (off?.key === f.key && off.gameId === game?.id) ? 'on' : ''}`} key={f.key} onClick={() => (extra ? (setOff(null), f.key !== playing && void tune(f.key, { fullscreen: false })) : game && watch(game, f.key))} title={f.sub}>
      <b>{f.label}</b>
      <small>{f.sub}</small>
    </button>
  ));
  const scoreBug = extraOn ? <div class="lp-score"><b>{extraOn.label}</b></div> : game && (
    <div class="lp-score">
      <TeamLogo team={game.away} size="sm" /><b>{game.away.abbr}</b>{!hideScore && <span class="lp-pts">{game.away.score ?? ''}</span>}
      <span class="lp-clock">{hideScore ? (game.state === 'pre' ? clock(game.start) : game.state === 'in' ? 'Live' : 'Final') : gameLine(game, now)}</span>
      {!hideScore && <span class="lp-pts">{game.home.score ?? ''}</span>}<b>{game.home.abbr}</b><TeamLogo team={game.home} size="sm" />
    </div>
  );

  if (mv) {
    const sheetTile = sheet ? mv.tiles[sheet.i] : null;
    const sheetGame = tileGame(sheetTile);
    const usedKeys = new Set(mv.tiles.filter((t, i) => t && i !== sheet?.i).map((t) => t!.key));
    const inOther = (g: Game) => mv.tiles.some((t, i) => i !== sheet?.i && tileGame(t)?.id === g.id);
    const choose = (g: Game, f: Feed) => {
      if (sheet) setTile(sheet.i, tileOf(g, f));
      setSheet(null);
    };
    const active = mv.tiles[mv.active];
    return (
      <section class={`league-pass lpm lpm-${mv.layout}`} data-scope ref={ref} aria-label={`LTTV ${cfg.name} Multiview`} style={{ '--lp-accent': cfg.accent }}>
        <div class="lp-bg"><i /><i /><i /><i /></div>
        <div class="lpm-grid" data-group="lpm-grid">
          {Array.from({ length: mv.layout }, (_, i) => (
            <LpTile key={i} i={i} tile={mv.tiles[i]} label={tileFeed(mv.tiles[i])?.label} active={mv.active === i && !!mv.tiles[i]} onOpen={() => setSheet({ i, games: !mv.tiles[i] })} />
          ))}
        </div>
        <footer class="lpm-bar">
          <span class="lpm-brand"><LpLogo size="1.8rem" kind={cfg.league} /> {cfg.name}</span>
          <span class="lpm-now">{active ? <span><Icon name="volume" size="1.1em" /> {active.title}</span> : 'Pick a game'}</span>
          <span class="lpm-hint">OK: broadcast and options · Back: {cfg.name}</span>
        </footer>
        {sheet && (
          <Modal title={sheet.games || !sheetTile ? 'Games' : sheetGame ? `${sheetGame.away.name} at ${sheetGame.home.name}` : sheetTile.title} onClose={() => setSheet(null)} class={`lpm-sheet lp-modal ${cfg.league}`}>
            {sheet.games || !sheetTile ? (
              <div class="lpm-games">
                {extras.filter((f) => !usedKeys.has(f.key)).map((f) => (
                  <button type="button" class="f lpm-game" key={f.key} onClick={() => { setTile(sheet.i, { key: f.key, title: f.label, sub: f.sub }); setSheet(null); }}><b>{f.label}</b></button>
                ))}
                {games.filter((g) => feedsOf(g).length > 0 && !inOther(g)).map((g) => (
                  <button type="button" class="f lpm-game" key={g.id} onClick={() => choose(g, feedsOf(g)[0])}>
                    <TeamLogo team={g.away} size="sm" /><b>{g.away.abbr}</b><span>{g.away.score ?? ''}</span>
                    <span class="lp-clock">{gameLine(g, now)}</span>
                    <span>{g.home.score ?? ''}</span><b>{g.home.abbr}</b><TeamLogo team={g.home} size="sm" />
                  </button>
                ))}
                {!games.some((g) => feedsOf(g).length > 0 && !inOther(g)) && !extras.some((f) => !usedKeys.has(f.key)) && <p class="muted">No other game with a stream right now.</p>}
              </div>
            ) : (
              <div class="lpm-opts">
                {sheetGame && <div class="lpm-sub">Broadcast</div>}
                {sheetGame && (
                  <div class="lp-feeds">
                    {feedsOf(sheetGame).map((f) => (
                      <button type="button" class={`f lp-feed ${f.key === sheetTile?.key ? 'on' : ''}`} key={f.key} onClick={() => choose(sheetGame, f)}>
                        <b>{f.label}</b>
                        <small>{f.sub}</small>
                      </button>
                    ))}
                  </div>
                )}
                <div class="lpm-actions">
                  <Button icon="fullscreen" data-autofocus={sheetGame ? undefined : ''} onClick={() => {
                    const k = sheetTile.key;
                    closeMultiview(-1);
                    if (sheetGame) setSelected(sheetGame.id);
                    void tune(k, { fullscreen: false });
                    setFull(true);
                  }}>Full screen</Button>
                  <Button onClick={() => setSheet({ i: sheet.i, games: true })}>Switch game</Button>
                  <Button variant="ghost" icon="close" onClick={() => { setTile(sheet.i, null); setSheet(null); }}>Remove</Button>
                </div>
              </div>
            )}
          </Modal>
        )}
      </section>
    );
  }

  return (
    <section class={`league-pass ${full ? 'lp-full' : ''} ${full && !bar ? 'lp-quiet' : ''} ${tucked ? 'lp-tucked' : ''}`} data-scope ref={ref} aria-label={`LTTV ${cfg.name}`} style={{ '--lp-accent': cfg.accent }}>
      <div class="lp-bg"><i /><i /><i /><i /></div>
      <header class="lp-top">
        <h1><LpLogo kind={cfg.league} /> <span class="lp-mark">LTTV</span> {cfg.name}</h1>
        <span class="muted">{new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        <span class="lp-spacer" />
        {picks.length > 0 && <Button variant="primary" icon="multiview" onClick={startMultiview}>Watch {picks.length} game{picks.length === 1 ? '' : 's'} together</Button>}
        {timeoutUp && cfg.league !== 'nfl' && <Button onClick={() => { setMusicOn(!music); setMusic(!music); }}>{music ? 'Music off' : 'Music on'}</Button>}
        <Button onClick={toggleScore}>{hideScore ? 'Show score' : 'Hide score'}</Button>
        {(onThisGame || timeoutUp) && <Button icon="fullscreen" onClick={() => setFull(true)}>Full screen</Button>}
        <Button variant="ghost" icon="close" onClick={() => setState({ leaguePass: false })}>Close</Button>
      </header>

      <div class="lp-main">
        <div class="lp-stage">
          <VideoSlot priority={150} class="lp-video">
            {timeoutUp && (() => {
              // A team broadcast picked while it's off the air, or nothing on at all.
              const team = !offGame ? undefined : cfg.league === 'nfl' ? (offFeed?.team === 'away' ? offGame.away : offGame.home) : offFeed?.team ? (offFeed.team === 'away' ? offGame.away : offGame.home) : undefined;
              const pre = offGame?.state === 'pre';
              const next = games.filter((g) => g.state === 'pre').sort((x, y) => x.start - y.start)[0];
              const lines = (
                <>
                  <div class="lp-off-kicker"><LpLogo size="1.6rem" kind={cfg.league} /> LTTV {cfg.name}</div>
                  <div class="lp-off-title">LTTV {cfg.name} took a timeout</div>
                  <div class="lp-off-line">{cfg.league === 'nfl' && offGame ? `${offGame.away.name} at ${offGame.home.name}` : team && anyOnAir ? `The ${team.name} broadcast is off the air` : 'No games on at this time'}</div>
                  {team && offGame ? (
                    pre ? <div class="lp-off-count">{cfg.league === 'nfl' ? `${offFeed?.label ?? 'The game'} · on the air in` : `${team.name} broadcast on the air in`} <b>{untilText(offGame.start - ON_AIR_BEFORE - now)}</b> · {clock(offGame.start)}</div>
                      : <div class="lp-off-count">{hideScore ? `Final · ${offGame.away.abbr} at ${offGame.home.abbr}` : `Final · ${offGame.away.abbr} ${offGame.away.score ?? ''} – ${offGame.home.score ?? ''} ${offGame.home.abbr}`}</div>
                  ) : next ? <div class="lp-off-count">Next: {next.away.abbr} at {next.home.abbr} · {gameLine(next, now)}</div> : null}
                </>
              );
              return <TimeoutShow media={tmedia} team={cfg.league === 'nfl' ? undefined : team} plain={cfg.league === 'nfl'}>{lines}</TimeoutShow>;
            })()}
            {!onThisGame && !full && !timeoutUp && <div class="lp-hint">{!loading && games.length && !anyOnAir ? 'No games on at this time · pick a game below to see when it comes on' : game ? (gameFeeds.length ? 'Pick a game or a channel below to watch it here' : index ? 'No stream found for this game in your playlist' : 'Finding streams…') : loading ? 'Loading the games…' : cfg.league === 'nfl' ? 'No NFL games in the next few days' : 'No NBA games today'}</div>}
            {full && (
              <div class="lp-bc" data-group="lp-bc">
                <div class="lp-bc-top">
                  <button type="button" class="f lp-bc-btn" onClick={() => setFull(false)}><Icon name="chevronLeft" size="1.2em" /> <LpLogo size="1.5rem" kind={cfg.league} /> {cfg.name}</button>
                  {scoreBug}
                  <span class="lp-bc-live">{game?.state === 'in' ? 'LIVE' : ''}</span>
                </div>
                <div class="lp-bc-bottom">
                  <button type="button" class="f lp-bc-btn" onClick={() => step(-1)} aria-label="Previous game"><Icon name="chevronLeft" size="1.2em" /></button>
                  <div class="lp-bc-feeds">{feedButtons('lp-bc-feed')}</div>
                  {!hideScore && <button type="button" class={`f lp-bc-btn ${boxOpen ? 'on' : ''}`} onClick={() => setBoxOpen((v) => !v)}>Box score</button>}
                  <button type="button" class="f lp-bc-btn" onClick={toggleScore}>{hideScore ? 'Show score' : 'Hide score'}</button>
                  <button type="button" class="f lp-bc-btn" onClick={() => step(1)} aria-label="Next game"><Icon name="chevronRight" size="1.2em" /></button>
                </div>
              </div>
            )}
          </VideoSlot>
          {scoreBug}
          {gameFeeds.length + extras.length > 0 && <div class="lp-feeds" data-group="lp-feeds">{feedButtons('lp-feed')}</div>}
        </div>
        {game && (!full || boxOpen) && (hideScore ? (full ? null : <div class="lp-box"><p class="muted">Score and box score are hidden for this game. Choose “Show score” to see them.</p></div>) : cfg.league === 'nfl' ? <NflBox game={game} box={nflBox} /> : <BoxScore game={game} box={nbaBox} />)}
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
                {hideScore && g.id === game?.id ? (
                  <><span class="lp-line">{g.away.abbr} · {g.home.abbr}</span><span class="lp-when">{g.state === 'pre' ? clock(g.start) : g.state === 'in' ? 'Live' : 'Final'}</span></>
                ) : (
                  <><span class="lp-line">{g.away.abbr} {g.away.score ?? ''} · {g.home.abbr} {g.home.score ?? ''}</span><span class="lp-when">{gameLine(g, now)}</span></>
                )}
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

// ---------------- Up, Up, Left, Right opens League Pass; Up ×5, Down ×2, Right opens Blitz ----------------
export function openPass(league: 'nba' | 'nfl') {
  if (getState().multiview) closeMultiview(-1);
  setState({ leaguePass: true, passLeague: league, fullscreen: false });
}
const U = 'ArrowUp';
const SEQS: ['nba' | 'nfl', string[]][] = [['nba', [U, U, 'ArrowLeft', 'ArrowRight']], ['nfl', [U, U, U, U, U, 'ArrowDown', 'ArrowDown', 'ArrowRight']]];
let recent: { key: string; at: number }[] = [];
export function watchLeaguePassKeys(): () => void {
  const on = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const now = Date.now();
    // Presses count while they keep coming (no more than 2.5 s apart).
    if (recent.length && now - recent[recent.length - 1].at > 2500) recent = [];
    recent = [...recent, { key: e.key, at: now }].slice(-8);
    const hit = SEQS.find(([, seq]) => recent.length >= seq.length && seq.every((k, i) => recent[recent.length - seq.length + i].key === k));
    if (hit) {
      recent = [];
      if (getState().leaguePass) return;
      openPass(hit[0]);
    }
  };
  window.addEventListener('keydown', on, true);
  return () => window.removeEventListener('keydown', on, true);
}
