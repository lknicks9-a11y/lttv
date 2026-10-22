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
import { feedSide, gameText, preparedMatchesGame, teamNames, type Broadcast, type Game, type GameText, type GameTeam, type ScheduleLeague } from './schedule';

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

/**
 * The index prepared once for checking many games: each entry's text folded, plus a word → entries map,
 * so a game only looks at the entries that contain one of its team names (big lineups have tens of
 * thousands of listings; checking every one for every game froze Fire TVs for seconds).
 */
interface PreparedIndex {
  texts: GameText[];
  byWord: Map<string, number[]>;
}
const prepCache = new WeakMap<GameIndexEntry[], PreparedIndex>();
function prepare(index: GameIndexEntry[]): PreparedIndex {
  const hit = prepCache.get(index);
  if (hit) return hit;
  const p: PreparedIndex = { texts: new Array(index.length), byWord: new Map() };
  addPrepared(p, index, 0, index.length);
  prepCache.set(index, p);
  return p;
}
function addPrepared(p: PreparedIndex, index: GameIndexEntry[], from: number, to: number) {
  const { texts, byWord } = p;
  for (let i = from; i < to; i++) {
    const t = gameText(index[i].text);
    texts[i] = t;
    for (const w of new Set(t.f.split(' '))) {
      if (!w) continue;
      const l = byWord.get(w);
      if (l) l.push(i);
      else byWord.set(w, [i]);
    }
  }
}
/** prepare() in slices with breaks in between, so the TV stays responsive. */
async function prepareAsync(index: GameIndexEntry[]): Promise<void> {
  if (prepCache.has(index)) return;
  const p: PreparedIndex = { texts: new Array(index.length), byWord: new Map() };
  for (let i = 0; i < index.length; i += 400) {
    addPrepared(p, index, i, Math.min(index.length, i + 400));
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  prepCache.set(index, p);
}
/** Entries that could mention the team: they contain the first word of one of its names. */
function candidates(p: PreparedIndex, names: string[]): number[] {
  const seen = new Set<number>();
  for (const n of names) for (const i of p.byWord.get(n.split(' ')[0]) ?? []) seen.add(i);
  return [...seen].sort((a, b) => a - b);
}

const yieldNow = () => new Promise<void>((r) => setTimeout(r, 0));
const asyncCache = new WeakMap<object, Map<string, Promise<GameIndexEntry[]>>>();

/**
 * buildGameIndex in small slices (a few hundred channels at a time, yielding in between) so a big
 * lineup doesn't freeze a TV; results are reused for the same lineup, guide version and time window.
 */
export function buildGameIndexAsync(lineup: LineupChannel[], guide: GuideIndex, from: number, to: number, version: number | string = 0): Promise<GameIndexEntry[]> {
  const per = asyncCache.get(lineup) ?? new Map<string, Promise<GameIndexEntry[]>>();
  asyncCache.set(lineup, per);
  const key = `${Math.floor(from / 600_000)}|${Math.ceil(to / 600_000)}|${version}`;
  const hit = per.get(key);
  if (hit) return hit;
  const job = (async () => {
    const out: GameIndexEntry[] = [];
    for (let i = 0; i < lineup.length; i += 250) {
      out.push(...buildGameIndex(lineup.slice(i, i + 250), guide, from, to));
      await yieldNow();
    }
    await prepareAsync(out);
    return out;
  })();
  per.set(key, job);
  if (per.size > 6) per.delete(per.keys().next().value!);
  return job;
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
  const prep = prepare(index);
  for (const i of candidates(prep, teamNames(game.home, opts.sport))) {
    const e = index[i];
    if (e.stop < game.start - 30 * 60_000 || e.start > game.start + 4 * 3600_000) continue;
    if (!preparedMatchesGame(prep.texts[i], game, opts.sport)) continue;
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
  // 4. Streaming-only games (ESPN+, B1G+, Peacock…): providers name the exact event channel on game day,
  //    so before that offer their channels for that service.
  if (![...picks.values()].some((p) => p.kind === 'event' || p.kind === 'guide' || p.kind === 'national' || p.kind === 'local')) {
    for (const b of game.broadcasts) {
      const svc = STREAMING_SERVICES.find((x) => x.re.test(b.name));
      if (!svc) continue;
      const chans = serviceChannels(svc, lineup);
      for (const ch of chans) add({ ch, score: 40, kind: 'national', broadcast: b.name, reason: game.state === 'pre' ? `${svc.label} channel · the game's own channel usually appears on game day` : `${svc.label} channel` });
    }
  }
  return [...picks.values()].sort((a, b) => b.score - a.score || a.ch.number - b.ch.number);
}

const svcCache = new WeakMap<LineupChannel[], Map<string, LineupChannel[]>>();
/** A streaming service's first few channels in the lineup (worked out once per lineup). */
function serviceChannels(svc: { label: string; re: RegExp }, lineup: LineupChannel[]): LineupChannel[] {
  const m = svcCache.get(lineup) ?? new Map<string, LineupChannel[]>();
  svcCache.set(lineup, m);
  let v = m.get(svc.label);
  if (!v) {
    v = lineup.filter((c) => !c.hidden && svc.re.test(`${c.originalName} ${c.name}`)).sort((a, z) => a.number - z.number).slice(0, 3);
    m.set(svc.label, v);
  }
  return v;
}

/** Streaming services ESPN lists as a game's "broadcast", and how providers name their channels. */
export const STREAMING_SERVICES: { label: string; re: RegExp }[] = [
  { label: 'ESPN+', re: /\bespn\s*\+|\bespn\s*plus\b/i },
  { label: 'B1G+', re: /\b(b1g|btn|big\s*ten)\s*\+|\bbig ten plus\b/i },
  { label: 'ACC Network Extra', re: /\baccn\s*x\b|\bacc\s*(network)?\s*extra\b/i },
  { label: 'SEC Network+', re: /\bsec\s*(n|network)\s*\+/i },
  { label: 'Peacock', re: /\bpeacock\b/i },
  { label: 'Paramount+', re: /\bparamount\s*\+|\bparamount plus\b/i },
  { label: 'Prime Video', re: /\bprime\s*video\b|\bamazon\s*prime\b/i },
  { label: 'Apple TV', re: /\bapple\s*tv\b|\bmls\s*season\s*pass\b/i },
  { label: 'Netflix', re: /\bnetflix\b/i },
  { label: 'Max', re: /\b(hbo\s*)?max\b/i },
  { label: 'FloSports', re: /\bflo\s*(sports|football|hoops|college)\b/i },
  { label: 'DAZN', re: /\bdazn\b/i },
  { label: 'Fubo', re: /\bfubo\b/i },
];

/** One-line summary of where a game is on TV ("ESPN · YES (NYY) · NESN (BOS)"). */
export function broadcastSummary(game: Game): string {
  return game.broadcasts
    .filter((b) => b.kind === 'tv' || /espn\+|peacock|prime|apple|paramount|netflix|max/i.test(b.name))
    .map((b) => (b.market === 'national' ? b.name : `${b.name} (${(b.market === 'home' ? game.home : game.away).abbr})`))
    .join(' · ');
}
