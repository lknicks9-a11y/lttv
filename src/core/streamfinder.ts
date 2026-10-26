// For a game on the schedule, find the best channels in the user's own lineup:
//  1. event channels whose name or guide entry names both teams ("NFL 03: Bills vs Jets"),
//  2. channels whose guide lists the game,
//  3. the networks carrying it (national), and the home/away local broadcasts (RSNs).
// Ranked by how sure we are it's the game, which broadcast the user picked, and quality.
import type { LineupChannel } from './types';
import type { GuideIndex } from './guide';
import { isEventChannel } from './events';
import { qualityRank } from './mytv';
import { isEnglishChannel } from './lang';
import { teamLocalChannels } from './teamnetworks';
import { channelsForBroadcast, networkForBroadcast } from './networks';
import { feedSide, foldText, gameText, mentionsFolded, preparedMatchesGame, teamNames, type Broadcast, type Game, type GameText, type GameTeam, type ScheduleLeague } from './schedule';

export type FeedChoice = 'home' | 'away' | 'national';

export interface StreamPick {
  ch: LineupChannel;
  score: number;
  kind: 'event' | 'guide' | 'national' | 'local';
  /** Short explanation shown next to the channel. */
  reason: string;
  side?: 'home' | 'away';
  broadcast?: string;
  /** 0 = a channel the schedule lists for this game, 1 = event channel / guide listing, 2 = a team's usual channel, 3 = streaming service. */
  tier?: number;
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
      tier: 1,
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
        add({ ch, score: (feed && feed !== 'national' ? 70 : 85) + fitAdj, kind: 'national', tier: fit === 'affiliate' ? 1 : 0, broadcast: b.name, reason: fit === 'affiliate' ? `${b.name} affiliate (another city)` : `${b.name} · national` });
      } else {
        const side = b.market;
        const team = teamOfSide(game, side);
        const chosen = !feed || feed === side;
        add({ ch, score: (feed === side ? 95 : chosen ? 82 : 55) + fitAdj, kind: 'local', tier: 0, side, broadcast: b.name, reason: `${b.name} · ${team.short} broadcast` });
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
      for (const ch of chans) add({ ch, score: 40, kind: 'national', tier: 3, broadcast: b.name, reason: game.state === 'pre' ? `${svc.label} channel · the game's own channel usually appears on game day` : `${svc.label} channel` });
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

// ---------------------------------------------------------------------------
// Team channels: the provider's "NBA Team PPV", "WNBA Team PPV", "MLB Team PPV" and "NHL Team PPV"
// groups have one channel per team ("Charlotte Hornets", "NBA: Hornets HD") carrying that team's own
// broadcast. Only those groups are used; other sports get national broadcasts / other streams.

/** Leagues with a team-broadcast group, and that group's name. */
export const TEAM_PPV_GROUPS: Record<string, string> = { nba: 'nba team ppv', wnba: 'wnba team ppv', mlb: 'mlb team ppv' };
const teamFeedCache = new WeakMap<LineupChannel[], Map<string, LineupChannel[]>>();

/** Names good enough to pick out a team's own channel (full name, nickname; not the city alone). */
function feedNames(t: GameTeam): string[] {
  const out = new Set<string>();
  const add = (x: string | undefined) => {
    const f = foldText(x ?? '');
    if (f.length >= 3) out.add(f);
  };
  add(t.name);
  add(t.short);
  if (t.location && t.name.toLowerCase().startsWith(t.location.toLowerCase())) add(t.name.slice(t.location.length));
  return [...out].sort((a, b) => b.length - a.length);
}

function inTeamGroup(ch: LineupChannel, league: string): boolean {
  const want = TEAM_PPV_GROUPS[league];
  if (!want) return false;
  const g = foldText(ch.group ?? '');
  // "NBA Team PPV", "USA | NBA TEAM PPV", "NBA Team PPV (HD)"; not "WNBA Team PPV" for NBA.
  return ` ${g} `.includes(` ${want} `);
}

/** The lineup's channels for one team's own broadcast (from the league's Team PPV group), best quality first. */
export function teamChannels(t: GameTeam, other: GameTeam, league: string, lineup: LineupChannel[]): LineupChannel[] {
  if (!TEAM_PPV_GROUPS[league]) return [];
  const m = teamFeedCache.get(lineup) ?? new Map<string, LineupChannel[]>();
  teamFeedCache.set(lineup, m);
  const key = `${league}|${t.name}|${other.name}`;
  const hit = m.get(key);
  if (hit) return hit;
  const mine = feedNames(t);
  const theirs = feedNames(other);
  const out: LineupChannel[] = [];
  for (const ch of lineup) {
    if (ch.hidden || !inTeamGroup(ch, league)) continue;
    const name = ` ${foldText(ch.originalName)} `;
    if (!mentionsFolded(name, mine)) continue;
    if (mentionsFolded(name, theirs)) continue; // a channel for this one game, not the team's channel
    out.push(ch);
  }
  out.sort((a, b) => qualityRank(b.originalName) - qualityRank(a.originalName) || a.number - b.number);
  if (m.size > 200) m.clear();
  m.set(key, out);
  return out;
}

/** Each team's own broadcast for a game, from the league's Team PPV channels (NBA, WNBA, MLB, NHL only). */
export function teamBroadcasts(game: Game, lineup: LineupChannel[]): { side: 'home' | 'away'; team: GameTeam; ch: LineupChannel }[] {
  const out: { side: 'home' | 'away'; team: GameTeam; ch: LineupChannel }[] = [];
  for (const side of ['home', 'away'] as const) {
    const team = teamOfSide(game, side);
    const other = teamOfSide(game, side === 'home' ? 'away' : 'home');
    const own = teamChannels(team, other, game.league, lineup)[0];
    if (own) out.push({ side, team, ch: own });
  }
  return out;
}

/**
 * The streams to offer for a game, best first: one list with no "which broadcast?" question. Event channels and
 * guide listings for the game, each team's own channel, then the networks; ties go to the user's own team's feed.
 * English-commentary channels only (Spanish-language feeds like ESPN Deportes / TUDN are left out).
 */
export function bestStreams(game: Game, lineup: LineupChannel[], sport: ScheduleLeague['sport'], index: GameIndexEntry[], isFav: (t: GameTeam) => boolean = () => false): StreamPick[] {
  const picks = new Map<string, StreamPick>();
  const put = (p: StreamPick) => {
    const cur = picks.get(p.ch.key);
    if (!cur || (p.tier ?? 9) < (cur.tier ?? 9) || ((p.tier ?? 9) === (cur.tier ?? 9) && p.score > cur.score)) picks.set(p.ch.key, p);
  };
  for (const p of findStreams(game, lineup, { sport, index })) put({ ...p });
  // Each team's own channel from the provider's Team PPV group.
  for (const t of teamBroadcasts(game, lineup)) {
    put({ ch: t.ch, score: 88 + qualityRank(t.ch.originalName) + (t.ch.favorite ? 1 : 0), kind: 'local', tier: 2, side: t.side, reason: `${t.team.short} team channel` });
  }
  // Each team's usual local channels (regional sports network / local station, NBA and NHL), so both teams have
  // their channels even when the schedule doesn't name one or names one the playlist doesn't have.
  for (const side of ['home', 'away'] as const) {
    const team = teamOfSide(game, side);
    for (const l of teamLocalChannels(game.league, team, lineup)) {
      put({ ch: l.ch, score: 86 - l.rank * 2 + qualityRank(l.ch.originalName) + (l.ch.favorite ? 1 : 0), kind: 'local', tier: 2, side, broadcast: l.label, reason: `${l.label} · ${team.short} local channel` });
    }
  }
  for (const p of picks.values()) {
    p.tier ??= 1;
    if (p.side && isFav(teamOfSide(game, p.side))) p.score += 5;
  }
  // The channels the game is actually on first, then event channels and guide listings, then teams' usual channels.
  const all = [...picks.values()].sort((a, b) => a.tier! - b.tier! || b.score - a.score || a.ch.number - b.ch.number);
  // English commentary only; other languages are offered (and labelled) only when there's no English stream at all.
  const en = all.filter((p) => isEnglishChannel(p.ch));
  return en.length ? en : all.map((p) => ({ ...p, reason: `Not in English · ${p.reason}` }));
}

/** Most streams shown for one team, one network, the game's own event channels, and streaming services. */
export const PER_TEAM = 2;

/**
 * The list to show: at most two streams per team (both teams always get theirs), two per network, three event /
 * guide channels and two streaming-service channels; channels found dead are skipped so the next one fills in.
 */
export function capStreams(ranked: StreamPick[], isDead: (key: string) => boolean = () => false): StreamPick[] {
  const count = new Map<string, number>();
  const out: StreamPick[] = [];
  for (const p of ranked) {
    if (isDead(p.ch.key)) continue;
    const bucket = p.side ? `side:${p.side}` : p.tier === 3 ? 'svc' : p.broadcast ? `net:${p.broadcast.toLowerCase()}` : 'event';
    const max = bucket === 'event' ? 3 : PER_TEAM;
    const n = count.get(bucket) ?? 0;
    if (n >= max) continue;
    count.set(bucket, n + 1);
    out.push(p);
  }
  return out;
}
