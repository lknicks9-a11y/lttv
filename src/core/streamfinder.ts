// For a game on the schedule, find the best channels in the user's own lineup:
//  1. event channels whose name or guide entry names both teams ("NFL 03: Bills vs Jets"),
//  2. channels whose guide lists the game,
//  3. the networks carrying it (national), and the home/away local broadcasts (RSNs).
// Ranked by how sure we are it's the game, which broadcast the user picked, and quality.
import type { LineupChannel } from './types';
import type { GuideIndex } from './guide';
import { isEventChannel } from './events';
import { qualityRank } from './mytv';
import { channelsForBroadcast, networkForBroadcast } from './networks';
import { feedSide, textMatchesGame, type Broadcast, type Game, type GameTeam, type ScheduleLeague } from './schedule';

export type FeedChoice = 'home' | 'away' | 'national';

export interface StreamPick {
  ch: LineupChannel;
  score: number;
  kind: 'event' | 'guide' | 'national' | 'local';
  /** Short explanation shown next to the channel. */
  reason: string;
  side?: 'home' | 'away';
  broadcast?: string;
}

/** Text entries worth checking for games: programme titles around the day, and event channel names. */
export interface GameIndexEntry {
  ch: LineupChannel;
  text: string;
  start: number;
  stop: number;
  event: boolean;
}

const GAMEY = /\s(vs\.?|v\.?|versus|at|@|x)\s|\b(nfl|nba|mlb|nhl|mls|ncaa|epl|premier league|bundesliga|serie a|ligue 1|la ?liga|football|basketball|baseball|hockey|soccer|f[uú]tbol)\b/i;

/** Collect the guide entries in [from, to) that could be games (fast to scan per game). */
export function buildGameIndex(lineup: LineupChannel[], guide: GuideIndex, from: number, to: number): GameIndexEntry[] {
  const out: GameIndexEntry[] = [];
  for (const ch of lineup) {
    if (ch.hidden) continue;
    const event = isEventChannel(ch);
    if (event && GAMEY.test(` ${ch.originalName} `)) out.push({ ch, text: ch.originalName, start: from, stop: to, event: true });
    const usable = ch.epgChannelId && (ch.matchStatus === 'auto' || ch.matchStatus === 'approved');
    if (!usable) continue;
    const sporty = event || ch.category === 'sports';
    for (const p of guide.range(ch.epgChannelId, from, to)) {
      const text = p.subTitle ? `${p.title} ${p.subTitle}` : p.title;
      if (!sporty && !GAMEY.test(` ${text} `) && !p.categories?.some((c) => /sport|football|basketball|baseball|hockey|soccer/i.test(c))) continue;
      out.push({ ch, text, start: p.start, stop: p.stop, event });
    }
  }
  return out;
}

/** The game's local TV broadcasts by side (for the "which broadcast?" question). */
export function localBroadcasts(game: Game): { home: Broadcast[]; away: Broadcast[]; national: Broadcast[] } {
  const tv = game.broadcasts;
  return {
    home: tv.filter((b) => b.market === 'home'),
    away: tv.filter((b) => b.market === 'away'),
    national: tv.filter((b) => b.market === 'national'),
  };
}

/** Ask which team's broadcast to watch when both teams have their own local TV broadcast. */
export function needsFeedChoice(game: Game): boolean {
  const l = localBroadcasts(game);
  return l.home.some((b) => b.kind === 'tv') && l.away.some((b) => b.kind === 'tv');
}

export function teamOfSide(game: Game, side: 'home' | 'away'): GameTeam {
  return side === 'home' ? game.home : game.away;
}

export interface FindOptions {
  sport: ScheduleLeague['sport'];
  /** Which broadcast the user wants (when there are home/away local broadcasts). */
  feed?: FeedChoice;
  index?: GameIndexEntry[];
  guide?: GuideIndex;
}

export function findStreams(game: Game, lineup: LineupChannel[], opts: FindOptions): StreamPick[] {
  const picks = new Map<string, StreamPick>();
  const add = (p: StreamPick) => {
    p.score += qualityRank(p.ch.originalName) + (p.ch.favorite ? 1 : 0);
    const cur = picks.get(p.ch.key);
    if (!cur || p.score > cur.score) picks.set(p.ch.key, p);
  };
  const feed = opts.feed;
  const locals = localBroadcasts(game);
  const sideNames = {
    home: locals.home.map((b) => networkForBroadcast(b.name)),
    away: locals.away.map((b) => networkForBroadcast(b.name)),
  };
  const sideOfText = (text: string): 'home' | 'away' | undefined => {
    const s = feedSide(text, game, opts.sport);
    if (s) return s;
    const low = text.toLowerCase().replace(/[^a-z0-9+]+/g, '');
    for (const side of ['home', 'away'] as const) {
      if (sideNames[side].some((n) => n.keys.some((k) => k.length >= 3 && low.includes(k)))) return side;
    }
    return undefined;
  };

  // 1–2. Event channels and guide listings that name both teams.
  const index = opts.index ?? (opts.guide ? buildGameIndex(lineup, opts.guide, game.start - 3600_000, game.start + 5 * 3600_000) : []);
  for (const e of index) {
    if (e.stop < game.start - 30 * 60_000 || e.start > game.start + 4 * 3600_000) continue;
    if (!textMatchesGame(e.text, game, opts.sport)) continue;
    const side = sideOfText(e.text);
    let score = e.event ? 100 : 90;
    if (feed && feed !== 'national' && side) score += side === feed ? 8 : -30;
    add({
      ch: e.ch,
      score,
      kind: e.event ? 'event' : 'guide',
      side,
      reason: e.event ? (side ? `Event channel · ${teamOfSide(game, side).short} broadcast` : 'Event channel for this game') : `Guide: ${e.text}`,
    });
  }

  // 3. Networks carrying the game.
  for (const b of game.broadcasts) {
    const found = channelsForBroadcast(b.name, lineup);
    for (const { ch, fit } of found) {
      const fitAdj = fit === 'mytv' ? 4 : fit === 'exact' ? 2 : -15;
      if (b.market === 'national') {
        add({ ch, score: (feed && feed !== 'national' ? 70 : 85) + fitAdj, kind: 'national', broadcast: b.name, reason: fit === 'affiliate' ? `${b.name} affiliate (another city)` : `${b.name} · national` });
      } else {
        const side = b.market;
        const team = teamOfSide(game, side);
        const chosen = !feed || feed === side;
        add({ ch, score: (feed === side ? 95 : chosen ? 82 : 55) + fitAdj, kind: 'local', side, broadcast: b.name, reason: `${b.name} · ${team.short} broadcast` });
      }
    }
  }
  return [...picks.values()].sort((a, b) => b.score - a.score || a.ch.number - b.ch.number);
}

/** One-line summary of where a game is on TV ("ESPN · YES (NYY) · NESN (BOS)"). */
export function broadcastSummary(game: Game): string {
  return game.broadcasts
    .filter((b) => b.kind === 'tv' || /espn\+|peacock|prime|apple|paramount|netflix|max/i.test(b.name))
    .map((b) => (b.market === 'national' ? b.name : `${b.name} (${(b.market === 'home' ? game.home : game.away).abbr})`))
    .join(' · ');
}
