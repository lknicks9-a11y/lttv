import type { LineupChannel, Programme } from './types';
import type { GuideIndex } from './guide';
import { leagueOf, TEAMS, type Team } from './teams';

/** Lower-case, strip accents and punctuation, pad with spaces for whole-word matching. */
export function sportsText(s: string | undefined): string {
  if (!s) return ' ';
  const t = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}@]+/gu, ' ')
    .trim();
  return ` ${t} `;
}

const SPORT_WORDS = ['sport', 'sports', 'live sports', 'game', 'match', 'matchday', 'playoffs', 'playoff', 'final', 'finals', 'derby', 'kickoff', 'tip off', 'tipoff', 'face off', 'first pitch', 'preseason', 'postseason', 'regular season', 'league', 'cup', 'football', 'basketball', 'baseball', 'hockey', 'soccer', 'futbol'];
const GAME_PATTERN = / (vs|v|versus|at|@) /;

/** Nicknames that are everyday words: they only count with league context or a recognised opponent. */
const COMMON_WORDS = new Set(('sky sun storm fire dream wings liberty mercury fever aces sparks lynx tempo heat magic thunder jazz wild lightning ' +
  'stars kings union galaxy dynamo inter forest wolves blues devils reds twins angels rays royals pirates saints bears lions eagles titans ' +
  'giants jets sharks ducks rangers guardians nationals nets bulls rockets suns bills chiefs rams colts cardinals panthers tigers celtic ' +
  'flames hurricanes avalanche predators senators penguins capitals mammoth kraken spurs bucks hawks nuggets clippers warriors pacers ' +
  'grizzlies pelicans knicks raptors wizards hornets cavaliers mavericks pistons kings browns broncos texans jaguars raiders chargers ' +
  'dolphins vikings patriots steelers seahawks buccaneers commanders falcons ravens bengals cowboys packers braves orioles cubs astros ' +
  'dodgers marlins brewers mets yankees phillies padres mariners athletics nats canes habs leafs pens caps sens preds quakes sixers wolves ' +
  'blazers mavs cavs bucs niners revolution sounders timbers whitecaps rapids crew earthquakes').split(' '));

export interface TeamMatcher {
  team: Team;
  strong: string[]; // phrases that identify the team on their own
  weak: string[]; // phrases that need sport context (and league context if ambiguous)
  ambiguous: boolean;
  leagueContext: string[];
  /** Names of the other teams in the same league, used to recognise "X vs Y" games. */
  opponents: string[];
}

/** Build matchers once per team selection. Ambiguity is judged against the whole catalog plus custom teams. */
export function buildMatchers(teams: Team[], catalog: Team[] = TEAMS): TeamMatcher[] {
  const all = [...catalog, ...teams.filter((t) => !catalog.some((c) => c.id === t.id))];
  const count = new Map<string, number>();
  for (const t of all) {
    for (const p of new Set([t.name, t.short, ...(t.aliases ?? [])].map((x) => sportsText(x).trim()))) count.set(p, (count.get(p) ?? 0) + 1);
  }
  return teams.map((team) => {
    const phrases = [...new Set([team.name, team.short, ...(team.aliases ?? [])].map((x) => sportsText(x).trim()).filter((x) => x.length >= 2))];
    const strong: string[] = [];
    const weak: string[] = [];
    let ambiguous = false;
    for (const p of phrases) {
      const unique = (count.get(p) ?? 0) <= 1;
      if (!unique) ambiguous = true;
      // Multi-word, unique names ("new york giants", "man utd") are reliable by themselves.
      if (unique && p.includes(' ')) strong.push(p);
      else weak.push(p);
    }
    const league = leagueOf(team.league);
    const opponents = team.league === 'custom' ? [] : all
      .filter((t) => t.league === team.league && t.id !== team.id)
      .flatMap((t) => [t.name, t.short, ...(t.aliases ?? [])].map((x) => sportsText(x).trim()))
      .filter((x) => x.length >= 2);
    return { team, strong, weak, ambiguous, opponents: [...new Set(opponents)], leagueContext: [team.league === 'custom' ? '' : league.name.toLowerCase(), ...league.context].filter(Boolean) };
  });
}

function has(hay: string, phrase: string): boolean {
  return hay.includes(` ${phrase} `);
}

/**
 * Does a listing mention the team? Returns 0 (no), 1 (likely) or 2 (certain).
 * `text` is the programme title+subtitle(+description); `context` adds categories and channel name.
 */
export function teamMention(m: TeamMatcher, text: string, context: string): number {
  for (const p of m.strong) if (has(text, p)) return 2;
  const weakHit = m.weak.some((p) => has(text, p));
  if (!weakHit) return 0;
  if (m.team.league === 'custom') return 1; // user-defined: trust their keywords
  const all = text + context;
  const leagueCtx = m.leagueContext.some((w) => has(all, sportsText(w).trim()));
  if (leagueCtx) return 1;
  // "Lions vs Bears": a game against another team of the same league confirms it.
  const vsOpponent = GAME_PATTERN.test(text) && m.opponents.some((o) => has(text, o));
  if (m.ambiguous) return vsOpponent ? 1 : 0; // "Giants" alone could be NFL or MLB
  const everyday = m.weak.every((p) => !p.includes(' ') && COMMON_WORDS.has(p));
  if (everyday) return vsOpponent ? 1 : 0;
  const sportCtx = SPORT_WORDS.some((w) => has(all, w)) || GAME_PATTERN.test(text);
  return sportCtx ? 1 : 0;
}

export function isGameListing(p: Pick<Programme, 'title' | 'subTitle' | 'live'>): boolean {
  return !!p.live || GAME_PATTERN.test(sportsText(p.title)) || GAME_PATTERN.test(sportsText(p.subTitle));
}

export interface TeamListing {
  key: string;
  programme: Programme;
  teams: Team[];
  channels: LineupChannel[];
  live: boolean;
  kind: 'game' | 'show';
  certainty: number;
}

export interface FindOptions {
  now: number;
  /** How far ahead to look (ms). Default 7 days. */
  horizon?: number;
  /** Include listings that ended up to this long ago. Default 0. */
  lookBehind?: number;
  includeShows?: boolean;
}

/**
 * Find games and shows featuring the given teams in the user's own guide data.
 * Listings airing on several channels are grouped into one entry.
 */
export function findTeamListings(matchers: TeamMatcher[], lineup: LineupChannel[], guide: GuideIndex, opts: FindOptions): TeamListing[] {
  if (!matchers.length) return [];
  const from = opts.now - (opts.lookBehind ?? 0);
  const to = opts.now + (opts.horizon ?? 7 * 86400_000);
  const byKey = new Map<string, TeamListing>();
  for (const ch of lineup) {
    if (ch.hidden || !ch.epgChannelId || !(ch.matchStatus === 'auto' || ch.matchStatus === 'approved')) continue;
    const chCtx = sportsText(`${ch.name} ${ch.group ?? ''} ${ch.category === 'sports' ? 'sports' : ''}`);
    for (const p of guide.range(ch.epgChannelId, from, to)) {
      const text = sportsText(`${p.title} ${p.subTitle ?? ''}`);
      const textWithDesc = text + sportsText(p.desc);
      const ctx = sportsText((p.categories ?? []).join(' ')) + chCtx;
      const teams: Team[] = [];
      let certainty = 0;
      for (const m of matchers) {
        // Titles carry the strongest signal; descriptions only count for certain (strong) names.
        let c = teamMention(m, text, ctx + textWithDesc);
        if (!c && m.strong.some((s) => has(textWithDesc, s))) c = 1;
        if (c) {
          teams.push(m.team);
          certainty = Math.max(certainty, c);
        }
      }
      if (!teams.length) continue;
      const kind = isGameListing(p) ? 'game' : 'show';
      if (kind === 'show' && opts.includeShows === false) continue;
      const key = `${sportsText(p.title).trim()}|${p.start}`;
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.channels.includes(ch)) existing.channels.push(ch);
      } else {
        byKey.set(key, { key, programme: p, teams, channels: [ch], live: p.start <= opts.now && p.stop > opts.now, kind, certainty });
      }
    }
  }
  const list = [...byKey.values()];
  for (const l of list) l.channels.sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.number - b.number);
  return list.sort((a, b) => Number(b.live) - Number(a.live) || a.programme.start - b.programme.start || (a.kind === 'game' ? -1 : 1));
}

/** Channels in the user's lineup that are dedicated to a team (e.g. "NBA: Lakers feed"). */
export function teamChannels(m: TeamMatcher, lineup: LineupChannel[]): LineupChannel[] {
  return lineup.filter((ch) => {
    if (ch.hidden) return false;
    const name = sportsText(ch.name);
    // Channel names are short: require a full name, or a nickname plus the league (e.g. "NBA: Lakers").
    if (m.strong.some((s) => has(name, s))) return true;
    if (!m.weak.some((p) => has(name, p))) return false;
    const ctx = name + sportsText(`${ch.group ?? ''} ${ch.originalName}`);
    return m.team.league === 'custom' || m.leagueContext.some((w) => has(ctx, sportsText(w).trim()));
  });
}
