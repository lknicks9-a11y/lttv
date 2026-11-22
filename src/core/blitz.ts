/**
 * Blitz (NFL): each game's streams must be the game's own channel (CBS, FOX, NBC, ESPN…), in a team's market (that
 * network's station for the team's city: "CBS Chicago", "FOX 32 Chicago"), or listed in the guide for the game.
 * Streams whose guide shows the game come first; anything that's none of these isn't offered.
 */
import type { GuideIndex } from './guide';
import type { LineupChannel } from './types';
import { textMatchesGame, type Game } from './schedule';

const fold = (s: string) => ` ${s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
const NOT_A_GAME = /\b(kids?|junior|cartoon|disney|nick|news|radio|music|movies?|weather|shopping|religio|church|espanol|deportes|latino)\b/i;

/** The game's TV networks, as words to find in a channel name ("CBS", "FOX", "NBC", "ESPN", "Prime Video" → "prime"). */
export function gameNetworks(g: Game): string[] {
  const out = new Set<string>();
  for (const b of g.broadcasts) {
    const n = fold(b.name).trim();
    if (!n) continue;
    out.add(n.replace(/\s+(hd|tv)$/, ''));
    if (/prime/.test(n)) out.add('prime');
    if (/nfl ?network|nfln/.test(n)) out.add('nfl network');
  }
  return [...out];
}

/** Is this channel one of the game's networks (by name)? */
export function onGameNetwork(ch: LineupChannel, nets: string[]): boolean {
  const f = fold(ch.originalName);
  return !NOT_A_GAME.test(ch.originalName) && nets.some((n) => f.includes(` ${n} `) || f.includes(` ${n.replace(/ /g, '')} `));
}

/** Where each team's local stations are named after (teams named after a state or region use their city). */
const MARKETS: Record<string, string[]> = {
  arizona: ['phoenix', 'arizona'], carolina: ['charlotte', 'carolina'], 'new england': ['boston', 'new england'],
  'green bay': ['green bay', 'milwaukee'], minnesota: ['minneapolis', 'minnesota', 'twin cities'], tennessee: ['nashville', 'tennessee'],
  'tampa bay': ['tampa'], 'san francisco': ['san francisco', 'bay area', 'oakland', 'san jose'], washington: ['washington', 'dc'],
  dallas: ['dallas', 'fort worth', 'dfw'], 'las vegas': ['las vegas', 'vegas'], 'new york': ['new york', 'nyc'], 'los angeles': ['los angeles'],
};
const placesOf = (location: string | undefined) => (location ? MARKETS[location.toLowerCase()] ?? [location] : []);

/** Which team's market a channel is in: the team's city (or state) in its name or group. */
export function marketOf(ch: LineupChannel, g: Game): 'home' | 'away' | undefined {
  const f = fold(`${ch.originalName} ${ch.group ?? ''}`);
  for (const side of ['away', 'home'] as const) {
    const t = side === 'home' ? g.home : g.away;
    if (placesOf(t.location).some((p) => f.includes(fold(p)))) return side;
  }
  return undefined;
}

/** Networks shown by local stations: another city's station isn't the game's channel for these. */
const LOCAL_NETWORKS = ['cbs', 'fox', 'nbc', 'abc'];

/** A channel name without provider / country tags, for spotting the same channel twice. */
const sameName = (name: string) => fold(name.replace(/^\s*([a-z0-9&]{1,6}\s*[:|]\s*)+/i, '')).replace(/\b(hd|fhd|uhd|4k|sd|raw|backup)\b/g, ' ').replace(/\s+/g, ' ').trim();

/** Does the channel's guide show this game around its start? */
export function guideShowsGame(ch: LineupChannel, g: Game, guide: GuideIndex): boolean {
  if (!ch.epgChannelId || !(ch.matchStatus === 'auto' || ch.matchStatus === 'approved')) return false;
  for (const p of guide.range(ch.epgChannelId, g.start - 45 * 60_000, g.start + 3 * 3600_000)) {
    if (p.start > g.start + 90 * 60_000 || p.stop < g.start - 15 * 60_000) continue;
    if (textMatchesGame([p.title, p.subTitle, p.desc?.slice(0, 200)].filter(Boolean).join(' '), g, 'football')) return true;
  }
  return false;
}

export interface BlitzStream {
  ch: LineupChannel;
  guide: boolean;
  network?: string;
  market?: 'home' | 'away';
}

/**
 * The game's streams for Blitz, in this order, each channel once:
 *   1. channels whose guide shows the game (each team's market ones first),
 *   2. the away team's market station(s) for the game's network, then the home team's,
 *   3. a national network carrying it (ESPN, Prime, NFL Network…).
 * Another city's CBS / FOX / NBC / ABC station is only offered when its guide shows the game.
 */
export function blitzStreams(g: Game, candidates: LineupChannel[], lineup: LineupChannel[], guide: GuideIndex): BlitzStream[] {
  const nets = gameNetworks(g);
  const seen = new Map<string, LineupChannel>();
  for (const c of candidates) seen.set(c.key, c);
  // Every station on the game's network in either team's market ("CBS 5 Kansas City", "FOX 10 Phoenix").
  for (const ch of lineup) if (!ch.hidden && !seen.has(ch.key) && onGameNetwork(ch, nets) && marketOf(ch, g)) seen.set(ch.key, ch);
  const all: BlitzStream[] = [];
  for (const ch of seen.values()) {
    if (NOT_A_GAME.test(ch.originalName)) continue;
    const net = onGameNetwork(ch, nets);
    const market = net ? marketOf(ch, g) : undefined;
    const guideOk = guideShowsGame(ch, g, guide);
    const netName = net ? nets.find((n) => fold(ch.originalName).includes(` ${n} `)) : undefined;
    // Another city's local station: only when its guide shows the game.
    if (!guideOk && !market && (!net || LOCAL_NETWORKS.includes(netName ?? ''))) continue;
    all.push({ ch, guide: guideOk, network: netName?.toUpperCase(), market });
  }
  const order = (s: BlitzStream) => (s.guide ? (s.market ? 0 : 1) : s.market === 'away' ? 2 : s.market === 'home' ? 3 : 4);
  all.sort((a, b) => order(a) - order(b) || a.ch.number - b.ch.number);
  // Each channel once (the same station from another provider or a backup copy isn't listed again), a few of each kind.
  const names = new Set<string>();
  const per = new Map<number, number>();
  const cap = [3, 3, 2, 2, 2];
  const out: BlitzStream[] = [];
  for (const s of all) {
    const n = sameName(s.ch.originalName);
    if (names.has(n)) continue;
    const k = order(s);
    if ((per.get(k) ?? 0) >= cap[k]) continue;
    names.add(n);
    per.set(k, (per.get(k) ?? 0) + 1);
    out.push(s);
  }
  return out;
}
