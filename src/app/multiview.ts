// Sports Multiview: up to four games at once, each in its own player (Fire TV: native tiles 0–3).
// Sound follows the selected tile; leaving goes full screen on that game.
import { PlayerController } from './player';
import { channelByKey, getState, player, playRequest, setState, tune } from './state';

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
    return n === 2 || n === 3 || n === 4 ? n : 2;
  } catch {
    return 2;
  }
}
const players: PlayerController[] = [];

export function tilePlayer(i: number): PlayerController {
  return (players[i] ??= new PlayerController(() => getState().settings, { slot: i }));
}

function apply(mv: MultiviewState) {
  setState({ multiview: mv });
  mv.tiles.forEach((t, i) => tilePlayer(i).setMuted(!t || i !== mv.active));
}

function start(i: number, t: MvTile | null) {
  const p = tilePlayer(i);
  if (!t) {
    p.stop();
    return;
  }
  const ch = channelByKey(t.key);
  if (ch) p.play({ ...playRequest(ch), key: `mv${i}:${ch.key}` });
}

/** Open Multiview; the channel playing now (if any) goes in the first tile. */
export function openMultiview(first?: MvTile) {
  const cur = getState().currentKey;
  const ch = channelByKey(cur);
  const t0 = first ?? (ch ? { key: ch.key, title: ch.name } : null);
  // The main player stops: most providers allow only a few streams at once.
  player.stop();
  const mv: MultiviewState = { tiles: [t0, null, null, null], active: 0, layout: lastLayout() };
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
  const active = t && !mv.tiles[mv.active] ? i : !t && i === mv.active ? Math.max(0, tiles.findIndex(Boolean)) : mv.active;
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

/** Streams the provider of these channels allows at once (when known). */
export function connectionLimit(keys: string[]): number | undefined {
  const s = getState();
  const limits = keys
    .map((k) => s.lineup.find((c) => c.key === k)?.playlistId)
    .map((id) => s.playlists.find((p) => p.id === id)?.maxConnections)
    .filter((n): n is number => typeof n === 'number' && n > 0);
  return limits.length ? Math.min(...limits) : undefined;
}
