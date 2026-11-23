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
// Speed: a lineup has tens of thousands of channels. Each channel's cleaned-up name is worked out once, and the
// channels of each network (CBS, FOX, NBC, ESPN…) are found once per lineup, not again for every game.
const foldedName = new WeakMap<LineupChannel, string>();
const foldName = (ch: LineupChannel) => {
  let f = foldedName.get(ch);
  if (f === undefined) foldedName.set(ch, (f = fold(ch.originalName)));
  return f;
};
const byNetwork = new WeakMap<LineupChannel[], Map<string, LineupChannel[]>>();
/** The lineup's channels whose name has this network in it (found once per lineup). */
export function channelsOnNetwork(lineup: LineupChannel[], net: string): LineupChannel[] {
  let m = byNetwork.get(lineup);
  if (!m) byNetwork.set(lineup, (m = new Map()));
  let list = m.get(net);
  if (!list) m.set(net, (list = lineup.filter((c) => !c.hidden && onGameNetwork(c, [net]))));
  return list;
}

export function onGameNetwork(ch: LineupChannel, nets: string[]): boolean {
  const f = foldName(ch);
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
  for (const n of nets) for (const ch of channelsOnNetwork(lineup, n)) if (!seen.has(ch.key) && marketOf(ch, g)) seen.set(ch.key, ch);
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

/** Which kind of NFL broadcast a game is, from its networks. */
export type BlitzWindow = 'prime' | 'nbc' | 'espn' | 'cbs' | 'fox' | 'other';

export function blitzWindow(g: Game): BlitzWindow {
  const nets = g.broadcasts.map((b) => b.name.toLowerCase());
  const has = (re: RegExp) => nets.some((n) => re.test(n));
  // Streaming-only games (Thursday night and Black Friday on Prime, Netflix on Christmas): the game's own streams only.
  if (has(/prime|amazon|netflix|youtube/) && !has(/^(cbs|fox|nbc|abc)\b/)) return 'prime';
  if (has(/^nbc\b/)) return 'nbc';
  if (has(/^espn\b|^abc\b/) && !has(/^(cbs|fox)\b/)) return 'espn';
  if (has(/^cbs\b/)) return 'cbs';
  if (has(/^fox\b/)) return 'fox';
  return 'other';
}

export interface BlitzFeed {
  ch: LineupChannel;
  label: string;
  market?: 'home' | 'away';
}

/** ESPN itself (not ESPN2, ESPNU, ESPNews, ESPN Deportes, ESPN+…). */
const isEspn = (ch: LineupChannel) => {
  const f = sameName(ch.originalName);
  return /^espn( east| west| usa| us)?( \d)?$/.test(f) || /^espn (hd|fhd)$/.test(f) || / espn$/.test(f) && !/espn ?(2|u|news|deportes|plus|\+|classic|8)/.test(f);
};
const hdFirst = (a: LineupChannel, b: LineupChannel) => Number(/\b(f?hd|1080)\b/i.test(b.originalName)) - Number(/\b(f?hd|1080)\b/i.test(a.originalName)) || a.number - b.number;

/**
 * Blitz's streams for a game, by the kind of game:
 *   Prime (Thursday night, Black Friday) → only the game's own streams (no local stations);
 *   NBC (Sunday night) → each team's local NBC station, then the game's streams;
 *   ESPN (Monday night) → ESPN HD and ESPN backups, then the game's streams;
 *   CBS / FOX (Sunday afternoon) → one local station for each team on that network, then the game's streams.
 * "The game's streams": channels named after the game and channels whose guide shows it (guide-confirmed first).
 */
export function blitzPlan(g: Game, picks: { ch: LineupChannel; kind: string }[], lineup: LineupChannel[], guide: GuideIndex): BlitzFeed[] {
  const win = blitzWindow(g);
  const out: BlitzFeed[] = [];
  const names = new Set<string>();
  const keys = new Set<string>();
  // `backup`: the same channel again is fine (ESPN's backups usually have ESPN's exact name).
  const add = (ch: LineupChannel, label: string, market?: 'home' | 'away', backup = false) => {
    const n = sameName(ch.originalName);
    if (keys.has(ch.key) || (!backup && names.has(n)) || NOT_A_GAME.test(ch.originalName)) return false;
    keys.add(ch.key);
    names.add(n);
    out.push({ ch, label, market });
    return true;
  };
  const abbr = (side: 'home' | 'away') => (side === 'home' ? g.home : g.away).abbr;

  // Each team's local station on the network (one each, away then home): guide-confirmed and HD first.
  if (win === 'nbc' || win === 'cbs' || win === 'fox') {
    const word = win;
    const onNet = channelsOnNetwork(lineup, word);
    for (const side of ['away', 'home'] as const) {
      const mine = onNet.filter((c) => marketOf(c, g) === side).sort((a, b) => Number(guideShowsGame(b, g, guide)) - Number(guideShowsGame(a, g, guide)) || hdFirst(a, b));
      for (const c of mine) if (add(c, `${abbr(side)} local · ${word.toUpperCase()}`, side)) break;
    }
  }
  // Monday night: ESPN in HD first, then its backups.
  if (win === 'espn') {
    const espn = channelsOnNetwork(lineup, 'espn').filter(isEspn).sort(hdFirst);
    let n = 0;
    for (const c of espn) if (n < 3 && add(c, n === 0 ? 'ESPN' : `ESPN backup ${n}`, undefined, true)) n++;
  }
  // The game's own streams: channels named after it and channels whose guide shows it (guide-confirmed first). For
  // games with local stations, another city's station never counts as a game stream.
  const game = picks
    .filter((p) => p.kind === 'event' || p.kind === 'guide' || guideShowsGame(p.ch, g, guide))
    .filter((p) => !(win !== 'prime' && LOCAL_NETWORKS.some((n) => onGameNetwork(p.ch, [n])) && !marketOf(p.ch, g) && p.kind !== 'event'))
    .map((p) => ({ ...p, guide: p.kind === 'guide' || guideShowsGame(p.ch, g, guide) }))
    .sort((a, b) => Number(b.guide) - Number(a.guide));
  let n = 0;
  for (const p of game) if (n < 6 && add(p.ch, p.guide ? 'Game stream · in the guide' : 'Game stream')) n++;
  // Any other kind of game: the earlier rules (guide matches, each team's market station, a national network).
  if (win === 'other') for (const s of blitzStreams(g, picks.map((p) => p.ch), lineup, guide)) add(s.ch, s.guide ? 'In the guide' : s.market ? `${abbr(s.market)} market` : 'National', s.market);
  return out;
}
