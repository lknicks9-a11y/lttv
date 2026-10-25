// Sports Multiview: up to four games at once, each in its own player (Fire TV: native tiles 0–3).
// Sound follows the selected tile; leaving goes full screen on that game.
import { PlayerController } from './player';
import { channelByKey, getState, player, playRequest, setState, tune } from './state';
import { checkXtreamLogin } from './xtream-login';
import { loginFor } from '../core/xtream';

export interface MvTile {
  /** Channel key */
  key: string;
  title: string;
  sub?: string;
}

export type MvLayout = 2 | 3 | 4;
export interface MultiviewState {
  tiles: (MvTile | null)[];
  /** Tile whose sound is on. */
  active: number;
  /** How many games are on screen. */
  layout: MvLayout;
}

export const TILE_COUNT = 4;
const LAYOUT_KEY = 'lttvMvLayout';
/** The layout used last time (asked again each time Multiview opens, with this one selected). */
export function lastLayout(): MvLayout {
  try {
    const n = Number(localStorage.getItem(LAYOUT_KEY));
    const lim = decoderLimit();
    const want = n === 2 || n === 3 || n === 4 ? n : 2;
    return (lim && lim >= 2 && want > lim ? lim : want) as MvLayout;
  } catch {
    return 2;
  }
}
const players: PlayerController[] = [];

// ---- How many games this TV can decode at once (learned the first time a game is refused a decoder) ----
// v2: limits learned before 1.0.11 could come from stream glitches misread as "no free decoder".
const LIMIT_KEY = 'lttvMvDecoderLimit2';
export function decoderLimit(): number | undefined {
  try {
    const n = Number(localStorage.getItem(LIMIT_KEY));
    return n >= 1 && n <= 4 ? n : undefined;
  } catch {
    return undefined;
  }
}
/** A game was refused a hardware decoder: the games playing right now are this TV's limit. */
export function noteDecoderLimit(): number {
  const mv = getState().multiview;
  const playing = mv ? mv.tiles.filter((t, i) => t && players[i] && players[i].status.state !== 'error' && players[i].status.state !== 'idle').length : 1;
  const n = Math.max(1, Math.min(playing, decoderLimit() ?? 4));
  try {
    localStorage.setItem(LIMIT_KEY, String(n));
  } catch {
    /* not remembered */
  }
  return n;
}
/** Forget the learned limit (e.g. after an app update that frees more decoders). */
export function resetDecoderLimit() {
  try {
    localStorage.removeItem(LIMIT_KEY);
  } catch {
    /* ignore */
  }
}

export function tilePlayer(i: number): PlayerController {
  return (players[i] ??= new PlayerController(() => getState().settings, { slot: i }));
}

function apply(mv: MultiviewState) {
  setState({ multiview: mv });
  mv.tiles.forEach((t, i) => tilePlayer(i).setMuted(!t || i !== mv.active));
}

// Streams start one after another (1.5 s apart): opening several provider connections at the same
// instant is what IPTV servers most often refuse or throttle.
let nextStartAt = 0;
function start(i: number, t: MvTile | null) {
  const p = tilePlayer(i);
  if (!t) {
    p.stop();
    return;
  }
  const ch = channelByKey(t.key);
  if (!ch) return;
  const wait = Math.max(0, nextStartAt - Date.now());
  nextStartAt = Date.now() + wait + 1500;
  window.setTimeout(() => {
    // Still the same game in this tile?
    if (getState().multiview?.tiles[i]?.key !== t.key) return;
    p.play({ ...playRequest(ch), key: `mv${i}:${ch.key}:${Date.now()}` });
  }, wait);
}

/** Start a tile's stream again (after an error). */
export function restartTile(i: number) {
  const t = getState().multiview?.tiles[i];
  if (t) start(i, t);
}

/** Open Multiview; the channel playing now (if any) goes in the first tile. */
export function openMultiview(first?: MvTile) {
  const cur = getState().currentKey;
  const ch = channelByKey(cur);
  const t0 = first ?? (ch ? { key: ch.key, title: ch.name } : null);
  // The main player stops: most providers allow only a few streams at once.
  player.stop();
  // Opens straight into 4 games (2 or 3 from a tile's options → Layout).
  const mv: MultiviewState = { tiles: [t0, null, null, null], active: 0, layout: 4 };
  setState({ fullscreen: false, currentKey: undefined });
  apply(mv);
  start(0, t0);
}

export function setTile(i: number, t: MvTile | null) {
  const mv = getState().multiview;
  if (!mv) return;
  const tiles = mv.tiles.slice();
  tiles[i] = t;
  // A new game gets the sound when nothing else had it.
  // Sound stays with the highlighted tile (Multiview.tsx); a new game only gets it if its tile is highlighted.
  const focused = Number((document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-tile]')?.dataset.tile ?? -1);
  const active = t && focused === i ? i : mv.active;
  apply({ tiles, active, layout: mv.layout });
  start(i, t);
}

/** Show 2, 3 or 4 games; games beyond the new count stop. */
export function setLayout(layout: MvLayout) {
  const mv = getState().multiview;
  if (!mv) return;
  try {
    localStorage.setItem(LAYOUT_KEY, String(layout));
  } catch {
    /* not remembered */
  }
  const tiles = mv.tiles.map((t, i) => (i < layout ? t : null));
  for (let i = layout; i < TILE_COUNT; i++) if (mv.tiles[i]) start(i, null);
  const active = tiles[mv.active] ? mv.active : Math.max(0, tiles.findIndex(Boolean));
  apply({ tiles, active, layout });
}

export function setActiveTile(i: number) {
  const mv = getState().multiview;
  if (!mv || !mv.tiles[i]) return;
  apply({ ...mv, active: i });
}

/** Leave Multiview; `fullscreenTile` (default: the one with sound) continues full screen. */
export function closeMultiview(fullscreenTile?: number) {
  const mv = getState().multiview;
  if (!mv) return;
  for (let i = 0; i < TILE_COUNT; i++) players[i]?.stop();
  setState({ multiview: undefined });
  const t = mv.tiles[fullscreenTile ?? mv.active];
  if (t) void tune(t.key, { fullscreen: true });
}

/**
 * What the provider says right now about the channel's login: how many streams the plan allows and how many it
 * counts as in use (every device on that login counts — a Fire TV or phone left playing too). Cached ~20 s.
 */
const usageCache = new Map<string, { at: number; v: { max?: number; active?: number } | null }>();
export async function providerUsage(key: string): Promise<{ max?: number; active?: number } | null> {
  const s = getState();
  const pl = s.playlists.find((p) => p.id === s.lineup.find((c) => c.key === key)?.playlistId);
  const login = pl && loginFor(pl);
  if (!pl || !login) return null;
  const hit = usageCache.get(pl.id);
  if (hit && Date.now() - hit.at < 20_000) return hit.v;
  let v: { max?: number; active?: number } | null = null;
  try {
    const a = await checkXtreamLogin(login, pl.userAgent);
    v = a.maxConnections || a.activeConnections !== undefined ? { max: a.maxConnections || undefined, active: a.activeConnections } : null;
  } catch {
    v = null;
  }
  usageCache.set(pl.id, { at: Date.now(), v });
  return v;
}

/** An error that really is the provider turning a stream away for the connection limit (not a dropout). */
export function isLimitError(msg: string | undefined): boolean {
  return /\b(429|458|509)\b|max(imum)?\s*connections?|too many (connections|streams|users)|connection limit|limit reached|already in use/i.test(msg ?? '');
}

/** Streams the provider of these channels allows at once (when known). */
export function connectionLimit(keys: string[]): number | undefined {
  const s = getState();
  const limits = keys
    .map((k) => s.lineup.find((c) => c.key === k)?.playlistId)
    .map((id) => s.playlists.find((p) => p.id === id)?.maxConnections)
    .filter((n): n is number => typeof n === 'number' && n > 0);
  return limits.length ? Math.min(...limits) : undefined;
}
