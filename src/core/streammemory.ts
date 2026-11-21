/**
 * Stream memory: which channels carry each team and each network, remembered by the channel's NAME (not its key).
 *
 * A channel's key includes the playlist it came from, so switching providers made every finding vanish at once
 * (team channels, network channels), and the new provider's channels take a while to be matched to the guide.
 * Names survive: "US: NESN HD" and "NESN FHD" are the same channel in two providers. What was found (and above all
 * what you actually watched) is looked up again by name in whatever lineup is loaded now.
 */
import type { LineupChannel } from './types';

export interface StreamMemory {
  [key: string]: { names: string[]; watched?: string[]; at: number };
}

let mem: StreamMemory = {};
let save: ((m: StreamMemory) => void) | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Loads the saved memory; `persist` is called (at most every few seconds) when it changes. */
export function loadStreamMemory(m: StreamMemory | undefined, persist?: (m: StreamMemory) => void) {
  mem = m && typeof m === 'object' ? m : {};
  save = persist;
}

function changed() {
  if (!save || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    save?.(mem);
  }, 3000);
}

/** A channel's name boiled down: no country tag, picture quality or punctuation ("US: NESN FHD" → "nesn"). */
export function channelNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^\s*[[(]?[a-z]{2,3}[\])]?\s*[:|\-]\s*/, '')
    .replace(/\b(uhd|fhd|hd|sd|4k|8k|hevc|h\.?265|1080[pi]?|720p|60fps|50fps|backup|raw|vip|plus\s*\d*)\b/g, ' ')
    .replace(/[^a-z0-9+]+/g, '')
    .trim();
}

export const teamMemKey = (league: string, teamName: string) => `t:${league}:${teamName.toLowerCase()}`;
export const netMemKey = (broadcast: string) => `n:${broadcast.toLowerCase().replace(/\s+/g, ' ').trim()}`;

/** Remember a channel for a team or network; `watched`: you actually played it for a game (ranks first later). */
export function rememberChannel(key: string, ch: Pick<LineupChannel, 'originalName'>, watched = false) {
  const n = channelNameKey(ch.originalName);
  if (n.length < 2) return;
  const cur = mem[key] ?? { names: [], at: 0 };
  const before = JSON.stringify(cur);
  if (watched) cur.watched = [n, ...(cur.watched ?? []).filter((x) => x !== n)].slice(0, 4);
  else if (!cur.names.includes(n)) cur.names = [n, ...cur.names].slice(0, 6);
  if (JSON.stringify(cur) === before) return;
  cur.at = Date.now();
  mem[key] = cur;
  changed();
}

const byName = new WeakMap<LineupChannel[], Map<string, LineupChannel[]>>();
function nameIndex(lineup: LineupChannel[]): Map<string, LineupChannel[]> {
  let m = byName.get(lineup);
  if (!m) {
    m = new Map();
    for (const ch of lineup) {
      if (ch.hidden) continue;
      const k = channelNameKey(ch.originalName);
      const l = m.get(k);
      if (l) l.push(ch);
      else m.set(k, [ch]);
    }
    byName.set(lineup, m);
  }
  return m;
}

/** The current lineup's channels remembered for a team or network: watched ones first. */
export function recallChannels(key: string, lineup: LineupChannel[]): { ch: LineupChannel; watched: boolean }[] {
  const e = mem[key];
  if (!e) return [];
  const idx = nameIndex(lineup);
  const out: { ch: LineupChannel; watched: boolean }[] = [];
  const seen = new Set<string>();
  for (const [names, watched] of [[e.watched ?? [], true], [e.names, false]] as const) {
    for (const n of names) for (const ch of idx.get(n) ?? []) if (!seen.has(ch.key)) { seen.add(ch.key); out.push({ ch, watched }); }
  }
  return out;
}
