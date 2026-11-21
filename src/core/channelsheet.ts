/**
 * The day's channel sheet: for every game of the sports day (all leagues), the channels that carry it for each team,
 * worked out once (at 3:00 AM, when the sports day starts, or whenever the channels or guide change) and saved.
 *
 * For each game:
 *   1. Candidates: everything the stream finder finds (event channels named after the game, guide listings, the
 *      networks, each team's own channel), plus each team's broadcast that night searched by every form of its name
 *      (network, abbreviation, call sign, city + network).
 *   2. Each candidate is checked against the guide: CONFIRMED when the channel's guide shows this game (both teams)
 *      around the start time. Anything not confirmed is kept, but marked so, and ranked below what is.
 *   3. Order: confirmed channels for each team, then other confirmed channels, then unconfirmed team channels,
 *      channels named after the game, and the rest.
 *
 * Nothing here can be 100% when the sources leave gaps (ESPN not listing a team's channel, a channel with no guide),
 * which is why every channel says whether it was confirmed.
 */
import type { GuideIndex } from './guide';
import type { LineupChannel } from './types';
import { channelKeys, networkForBroadcast } from './networks';
import { textMatchesGame, type Game, type ScheduleLeague } from './schedule';
import { bestStreams, teamOfSide, type GameIndexEntry, type StreamPick } from './streamfinder';

export type SheetStatus = 'confirmed' | 'unconfirmed';

export interface SheetPick {
  key: string;
  name: string;
  side?: 'home' | 'away';
  status: SheetStatus;
  reason: string;
}

export interface ChannelSheet {
  /** Sports day ("20261121"): starts at 3:00 AM Eastern. */
  day: string;
  builtAt: number;
  /** What it was built from: rebuilt when the channels or the guide change. */
  basis: string;
  games: Record<string, SheetPick[]>;
}

/** Never a game's channel, whatever its name shares with a network (kids, news, radio…). */
const NOT_A_GAME_CHANNEL = /\b(kids?|junior|cartoon|disney|nick|news|radio|music|movies?|cinema|weather|shopping|religio|church)\b/i;

function fold(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9+]+/g, ' ').trim();
}

/** Does this channel's guide show the game (both teams) around its start? */
export function confirmedByGuide(ch: LineupChannel, game: Game, sport: ScheduleLeague['sport'], guide: GuideIndex): boolean {
  if (!ch.epgChannelId || !(ch.matchStatus === 'auto' || ch.matchStatus === 'approved')) return false;
  for (const p of guide.range(ch.epgChannelId, game.start - 45 * 60_000, game.start + 3 * 3600_000)) {
    // The listing must be on around the game's start (not a replay later that night).
    if (p.start > game.start + 90 * 60_000 || p.stop < game.start - 15 * 60_000) continue;
    const text = [p.title, p.subTitle, p.desc?.slice(0, 200)].filter(Boolean).join(' ');
    if (textMatchesGame(text, game, sport)) return true;
  }
  return false;
}

/**
 * A team's broadcast that night searched by every form of its name: the network's names ("CHSN", "Chicago Sports
 * Network"), a call sign ("WBBM"), and for over-the-air networks the network with the team's city ("CBS Chicago").
 */
export function broadcastChannels(broadcast: string, city: string | undefined, lineup: LineupChannel[]): LineupChannel[] {
  const { network, keys, key } = networkForBroadcast(broadcast);
  const names = new Set<string>([...keys, ...(key ? [key] : [])].filter((k) => k.length >= 2));
  const call = /^[KW][A-Z]{2,3}(-?(TV|DT|HD|CD))?$/.test(broadcast.trim()) ? broadcast.trim().slice(0, 4).toLowerCase() : undefined;
  const cityF = city ? fold(city) : '';
  const out: LineupChannel[] = [];
  for (const ch of lineup) {
    if (ch.hidden) continue;
    const raw = `${ch.originalName} ${ch.group ?? ''}`;
    if (NOT_A_GAME_CHANNEL.test(raw)) continue;
    const f = ` ${fold(ch.originalName)} `;
    // A call sign anywhere in the name ("WBBM CBS 2 Chicago", "CBS (WBBM) HD").
    if (call && f.includes(` ${call} `)) { out.push(ch); continue; }
    const ck = channelKeys(ch.cleanedName || ch.originalName);
    if (ck.some((c) => names.has(c))) { out.push(ch); continue; }
    // Regional sports channels with more in the name ("CHSN Chicago", "Sportsnet West 4K").
    if (network?.rsn && ck.some((c) => [...names].some((k) => k.length >= 4 && c.startsWith(k)))) { out.push(ch); continue; }
    // Over-the-air networks: the team's own city's station ("CBS 2 Chicago", "FOX 32 Chicago HD").
    if (network?.broadcast && cityF && f.includes(` ${cityF} `) && network.keys.some((k) => new RegExp(`(^| )${k}( |\\d|$)`).test(f.trim()))) out.push(ch);
  }
  return out;
}

const RANK = (p: { status: SheetStatus; side?: string; kind?: string }) =>
  p.status === 'confirmed' ? (p.side ? 0 : 1) : p.side ? 2 : p.kind === 'event' ? 3 : 4;

/** The channel sheet entry for one game. */
export function sheetForGame(game: Game, sport: ScheduleLeague['sport'], lineup: LineupChannel[], guide: GuideIndex, index: GameIndexEntry[]): SheetPick[] {
  const found = new Map<string, StreamPick>();
  for (const p of bestStreams(game, lineup, sport, index)) found.set(p.ch.key, p);
  // Each team's broadcast that night, by every form of its name.
  for (const b of game.broadcasts) {
    if (b.kind !== 'tv') continue;
    const side = b.market === 'national' ? undefined : b.market;
    const city = side ? teamOfSide(game, side).location : undefined;
    for (const ch of broadcastChannels(b.name, city, lineup)) {
      if (found.has(ch.key)) continue;
      found.set(ch.key, { ch, score: 70, kind: side ? 'local' : 'national', side, broadcast: b.name, reason: side ? `${b.name} · ${teamOfSide(game, side).short} broadcast` : `${b.name}` });
    }
  }
  const out: (SheetPick & { kind: string; score: number })[] = [];
  for (const p of found.values()) {
    if (/affiliate|another city/i.test(p.reason)) continue;
    const ok = p.kind === 'guide' || confirmedByGuide(p.ch, game, sport, guide);
    out.push({ key: p.ch.key, name: p.ch.originalName, side: p.side, status: ok ? 'confirmed' : 'unconfirmed', reason: p.reason, kind: p.kind, score: p.score });
  }
  out.sort((a, b) => RANK(a) - RANK(b) || b.score - a.score);
  return out.map(({ kind: _k, score: _s, ...rest }) => rest);
}

/** Puts the sheet's channels (in its order, with "confirmed" / "not confirmed" in the reason) ahead of live picks. */
export function applySheet(picks: StreamPick[], sheet: SheetPick[] | undefined, lineup: LineupChannel[]): StreamPick[] {
  if (!sheet?.length) return picks;
  const byKey = new Map(lineup.map((c) => [c.key, c] as const));
  const live = new Map(picks.map((p) => [p.ch.key, p] as const));
  const out: StreamPick[] = [];
  for (const s of sheet) {
    const ch = byKey.get(s.key);
    if (!ch || ch.hidden) continue;
    const base = live.get(s.key);
    const note = s.status === 'confirmed' ? 'Confirmed in the guide' : 'Not confirmed';
    out.push({ ...(base ?? { ch, score: 0, kind: s.side ? 'local' : 'national' }), ch, side: s.side ?? base?.side, reason: `${note} · ${base?.reason ?? s.reason}` });
    live.delete(s.key);
  }
  return [...out, ...live.values()];
}
