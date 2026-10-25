// Multiview mixes (like DIRECTV's): ready-made sets of up to 4 that load in one go.
//  - Game mixes, built live from today's schedule: every live game, each league, your teams. Each game gets its best
//    English stream from your lineup (the same pick as Sports).
//  - Channel mixes: sports networks, news, business… matched to the channels in your lineup.
//  - Your own mixes: save what's on screen and load it again later.
import { getState } from './state';
import { loadGames } from './schedule';
import { allTeams } from '../core/teams';
import { scheduleDay, scheduleLeague, type Game, type GameTeam, type ScheduleLeagueId } from '../core/schedule';
import { bestStreams, buildGameIndexAsync } from '../core/streamfinder';
import { channelsForBroadcast } from '../core/networks';
import { qualityRank } from '../core/mytv';
import { isEnglishChannel } from '../core/lang';
import type { LineupChannel } from '../core/types';
import type { MvTile } from './multiview';

export interface Mix {
  id: string;
  name: string;
  /** Short line under the name ("3 live · 1 at 8:15 PM"). */
  sub?: string;
  kind: 'games' | 'channels' | 'mine';
  tiles: MvTile[];
}

const GAME_LEAGUES: ScheduleLeagueId[] = ['nfl', 'nba', 'nhl', 'mlb', 'cfb', 'cbb', 'epl', 'ucl', 'mls'];

/** Channel mixes: each slot is a list of names to try (first one found in the lineup wins). */
const CHANNEL_MIXES: { id: string; name: string; slots: string[][] }[] = [
  { id: 'ch-sports', name: 'Sports networks', slots: [['ESPN'], ['ESPN2'], ['FS1', 'Fox Sports 1'], ['NFL Network', 'NBA TV', 'MLB Network']] },
  { id: 'ch-espn', name: 'ESPN family', slots: [['ESPN'], ['ESPN2'], ['ESPNU'], ['ESPNews', 'SEC Network', 'ACC Network']] },
  { id: 'ch-college', name: 'College sports', slots: [['SEC Network'], ['ACC Network'], ['Big Ten Network'], ['ESPNU']] },
  { id: 'ch-leagues', name: 'League channels', slots: [['NFL Network'], ['NBA TV'], ['NHL Network'], ['MLB Network']] },
  { id: 'ch-redzone', name: 'Sunday football', slots: [['NFL RedZone', 'RedZone'], ['CBS'], ['FOX'], ['NFL Network']] },
  { id: 'ch-news', name: 'News', slots: [['CNN'], ['Fox News'], ['MSNBC'], ['CNBC', 'NewsNation']] },
  { id: 'ch-business', name: 'Business', slots: [['CNBC'], ['Fox Business'], ['Bloomberg'], ['Yahoo Finance', 'CNN']] },
  { id: 'ch-broadcast', name: 'Broadcast networks', slots: [['ABC'], ['CBS'], ['NBC'], ['FOX']] },
  { id: 'ch-kids', name: 'Kids', slots: [['Disney Channel', 'Disney'], ['Nickelodeon', 'Nick'], ['Cartoon Network'], ['Disney Junior', 'Nick Jr']] },
];

/** The best channel in the lineup for a network name: English, highest quality. */
function channelFor(names: string[], lineup: LineupChannel[], used: Set<string>): LineupChannel | undefined {
  for (const n of names) {
    const found = channelsForBroadcast(n, lineup)
      .filter((x) => x.fit !== 'affiliate' && isEnglishChannel(x.ch) && !used.has(x.ch.key))
      .sort((a, b) => Number(b.fit === 'mytv') - Number(a.fit === 'mytv') || qualityRank(b.ch.originalName) - qualityRank(a.ch.originalName) || a.ch.number - b.ch.number);
    if (found[0]) return found[0].ch;
  }
  return undefined;
}

export function channelMixes(): Mix[] {
  const lineup = getState().lineup;
  const out: Mix[] = [];
  for (const m of CHANNEL_MIXES) {
    const used = new Set<string>();
    const tiles: MvTile[] = [];
    for (const slot of m.slots) {
      const ch = channelFor(slot, lineup, used);
      if (!ch) continue;
      used.add(ch.key);
      tiles.push({ key: ch.key, title: ch.name });
    }
    // Only offer a mix that fills at least 2 games from this lineup.
    if (tiles.length >= 2) out.push({ id: m.id, name: m.name, kind: 'channels', tiles, sub: tiles.map((t) => t.title).join(' · ') });
  }
  return out;
}

// ---------------- Game mixes ----------------

interface PlayableGame {
  game: Game;
  league: ScheduleLeagueId;
  tile: MvTile;
}

function clockOf(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Live games first, then the ones starting soonest; finished games never. */
function order(a: PlayableGame, b: PlayableGame): number {
  const r = (g: Game) => (g.state === 'in' ? 0 : g.state === 'pre' ? 1 : 2);
  return r(a.game) - r(b.game) || a.game.start - b.game.start;
}

function describe(list: PlayableGame[]): string {
  const live = list.filter((x) => x.game.state === 'in').length;
  const next = list.find((x) => x.game.state === 'pre');
  return [live ? `${live} live` : '', next ? `${live ? '+ ' : ''}next ${clockOf(next.game.start)}` : ''].filter(Boolean).join(' ') || `${list.length} games`;
}

/** Today's games that have a stream in the lineup, per league (fetched from the schedule, cached a few minutes). */
async function playableGames(): Promise<PlayableGame[]> {
  const s = getState();
  const today = scheduleDay(Date.now(), s.settings.timeZone);
  const perLeague = await Promise.all(GAME_LEAGUES.map((id) => loadGames(id, today, today).then((g) => ({ id, g }), () => ({ id, g: [] as Game[] }))));
  const games = perLeague.flatMap(({ id, g }) => g.filter((x) => x.state !== 'post').map((game) => ({ id, game })));
  if (!games.length) return [];
  const from = Math.min(...games.map((x) => x.game.start)) - 3600_000;
  const to = Math.max(...games.map((x) => x.game.start)) + 5 * 3600_000;
  const index = await buildGameIndexAsync(s.lineup, s.guide, from, to, s.guideVersion);
  const out: PlayableGame[] = [];
  for (const { id, game } of games) {
    const league = scheduleLeague(id);
    if (!league) continue;
    const best = bestStreams(game, s.lineup, league.sport, index)[0];
    if (!best) continue;
    out.push({ game, league: id, tile: { key: best.ch.key, title: `${game.away.short} at ${game.home.short}`, sub: game.state === 'in' ? 'Live' : undefined } });
  }
  return out.sort(order);
}

/** Up to 4 games on different channels (two games on one event channel would show the same picture twice). */
function pick4(list: PlayableGame[]): PlayableGame[] {
  const seen = new Set<string>();
  const out: PlayableGame[] = [];
  for (const x of list) {
    if (seen.has(x.tile.key)) continue;
    seen.add(x.tile.key);
    out.push(x);
    if (out.length === 4) break;
  }
  return out;
}

function favTest(): (t: GameTeam) => boolean {
  const s = getState().settings;
  const all = allTeams(s.customTeams);
  const names = new Set(s.favoriteTeams.map((id) => all.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t).flatMap((t) => [t.name, ...(t.aliases ?? [])].map((n) => n.toLowerCase())));
  return (t) => names.has(t.name.toLowerCase()) || names.has(t.short.toLowerCase());
}

export async function gameMixes(): Promise<Mix[]> {
  const all = await playableGames();
  const out: Mix[] = [];
  const add = (id: string, name: string, list: PlayableGame[], min = 2) => {
    const four = pick4(list);
    if (four.length >= min) out.push({ id, name, kind: 'games', tiles: four.map((x) => x.tile), sub: describe(four) });
  };
  const isFav = favTest();
  add('g-mine', 'Your teams', all.filter((x) => isFav(x.game.home) || isFav(x.game.away)), 1);
  add('g-live', 'Live now', all.filter((x) => x.game.state === 'in'));
  add('g-top', 'Best of today', all);
  for (const id of GAME_LEAGUES) {
    const l = scheduleLeague(id);
    if (l) add(`g-${id}`, `${l.tab} games`, all.filter((x) => x.league === id));
  }
  return out;
}

// ---------------- Your mixes ----------------

const MINE_KEY = 'lttvMvMixes';

export function myMixes(): Mix[] {
  try {
    const list = JSON.parse(localStorage.getItem(MINE_KEY) || '[]') as Mix[];
    const keys = new Set(getState().lineup.map((c) => c.key));
    // Channels that left the lineup drop out of a saved mix.
    return list.map((m) => ({ ...m, kind: 'mine' as const, tiles: m.tiles.filter((t) => keys.has(t.key)) })).filter((m) => m.tiles.length);
  } catch {
    return [];
  }
}

export function saveMix(name: string, tiles: MvTile[]): Mix {
  const m: Mix = { id: `mine-${Date.now().toString(36)}`, name: name.trim() || 'My mix', kind: 'mine', tiles: tiles.slice(0, 4), sub: tiles.map((t) => t.title).join(' · ') };
  try {
    const list = JSON.parse(localStorage.getItem(MINE_KEY) || '[]') as Mix[];
    localStorage.setItem(MINE_KEY, JSON.stringify([m, ...list].slice(0, 20)));
  } catch {
    /* not saved */
  }
  return m;
}

export function deleteMix(id: string) {
  try {
    const list = JSON.parse(localStorage.getItem(MINE_KEY) || '[]') as Mix[];
    localStorage.setItem(MINE_KEY, JSON.stringify(list.filter((m) => m.id !== id)));
  } catch {
    /* ignore */
  }
}
