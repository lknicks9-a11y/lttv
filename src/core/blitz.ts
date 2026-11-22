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

/** Which team's market a channel is in: the team's city (or state) in its name or group. */
export function marketOf(ch: LineupChannel, g: Game): 'home' | 'away' | undefined {
  const f = fold(`${ch.originalName} ${ch.group ?? ''}`);
  for (const side of ['away', 'home'] as const) {
    const t = side === 'home' ? g.home : g.away;
    const places = [t.location, ...(t.location ? [t.location.replace(/^(new york|los angeles)\b.*$/i, '$1')] : [])].filter(Boolean) as string[];
    if (places.some((p) => f.includes(fold(p)))) return side;
  }
  return undefined;
}

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
 * The game's streams for Blitz: candidates from the stream finder plus every channel on the game's network in either
 * team's market, kept only when they're on the game's network, in a team's market, or confirmed by the guide.
 * Order: in-market + on the network + guide, then on the network + guide, then other guide matches, then in-market
 * on the network, then the network elsewhere.
 */
export function blitzStreams(g: Game, candidates: LineupChannel[], lineup: LineupChannel[], guide: GuideIndex): BlitzStream[] {
  const nets = gameNetworks(g);
  const seen = new Map<string, LineupChannel>();
  for (const c of candidates) seen.set(c.key, c);
  // Every station on the game's network in either team's market ("CBS 2 Chicago", "WBBM CBS Chicago").
  for (const ch of lineup) if (!ch.hidden && !seen.has(ch.key) && onGameNetwork(ch, nets) && marketOf(ch, g)) seen.set(ch.key, ch);
  const out: (BlitzStream & { rank: number })[] = [];
  for (const ch of seen.values()) {
    if (NOT_A_GAME.test(ch.originalName)) continue;
    const net = onGameNetwork(ch, nets);
    const market = net ? marketOf(ch, g) : undefined;
    const guideOk = guideShowsGame(ch, g, guide);
    if (!net && !market && !guideOk) continue;
    const rank = market && guideOk ? 0 : net && guideOk ? 1 : guideOk ? 2 : market ? 3 : 4;
    out.push({ ch, guide: guideOk, network: net ? nets.find((n) => fold(ch.originalName).includes(` ${n} `))?.toUpperCase() : undefined, market, rank });
  }
  out.sort((a, b) => a.rank - b.rank || a.ch.number - b.ch.number);
  return out.map(({ rank: _r, ...rest }) => rest);
}
