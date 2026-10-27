// Each NBA team's channels, exactly as the user's playlist names them (picked with the Team Channel Picker), and
// which of them carries tonight's game according to Sports Media Watch's NBA TV schedule.
//   - A team's local channel is the main stream only when tonight's listing says the team is on it.
//   - Otherwise (or for a team with no local channel) its NBA team channel ("NBA: … [US| NBA TEAM PPV]") is.
import type { LineupChannel } from './types';
import { foldText, type Game, type GameTeam } from './schedule';

type Pick = { name: string; group: string };
const P = (name: string, group: string): Pick => ({ name, group });
const TV_RAW = 'US| TV ᴿᴬᵂ ⁶⁰ᶠᵖˢ';
const CITY = 'US| TV ᶜᶦᵗʸ ᴿᴬᵂ ⁶⁰ᶠᵖˢ';
const SPORT = 'US| SPORT ᴴᴰ/ᴿᴬᵂ ⁶⁰ᶠᵖˢ';
const NBC = 'US| NBC ᴴᴰ/ᴿᴬᵂ ⁶⁰ᶠᵖˢ';
const ENT = 'US| ENTERTAINMENT ᴴᴰ/ᴿᴬᵂ ⁶⁰ᶠᵖˢ';
const PPV = 'US| NBA TEAM PPV';

/** Team (full name) → its channels, usual one first. */
export const NBA_TEAM_CHANNELS: Record<string, Pick[]> = {
  'Atlanta Hawks': [P('TV: ATLANTA, GA WANF IND 46 A3 HD ATLANTA ᶜᶦᵗʸ ᴿᴬᵂ', CITY)],
  'Boston Celtics': [P('TV: NBC SPORTS BOSTON ᴿᴬᵂ', TV_RAW)],
  'Brooklyn Nets': [P('US: YES NETWORK HD', SPORT), P('US: (GT) Yes Network Overflow ᴴᴰ', SPORT)],
  'Charlotte Hornets': [P('PRIME: WSOC CHARLOTTE (ABC) ᴿᴬᵂ', 'US| PRIME ᴿᴬᵂ ⁶⁰ᶠᵖˢ')],
  'Chicago Bulls': [P('TV: CHICAGO SPORTS NETWORK ᴿᴬᵂ', TV_RAW), P('TV: CHICAGO SPORTS NETWORK PLUS ᴿᴬᵂ', TV_RAW)],
  'Cleveland Cavaliers': [P('US:CBS 19 CLEVELAND OH (WOIO)', 'US| CBS ᴴᴰ/ᴿᴬᵂ ⁶⁰ᶠᵖˢ'), P('NBA: CLEVELAND CAVALIERS ᴴᴰ', PPV)],
  'Dallas Mavericks': [P('TV: DALLAS, TX KFAA IND 29 A3 HD MIAMI ᶜᶦᵗʸ ᴿᴬᵂ', CITY), P('US: ABC 8 (WFAA) DALLAS HD', 'US| ABC ᴴᴰ/ᴿᴬᵂ ⁶⁰ᶠᵖˢ')],
  'Denver Nuggets': [P('TV: ALTITUDE SPORTS ᴿᴬᵂ', TV_RAW), P('US: ALTITUDE SPORTS 2 HD', SPORT)],
  'Detroit Pistons': [P('NBA: DETROIT PISTONS ᴴᴰ', PPV)],
  'Golden State Warriors': [P('TV: NBC SPORTS BAY AREA ᴿᴬᵂ', TV_RAW), P('US: NBC SPORTS BAY AREA PLUS (A) ᴿᴬᵂ', NBC)],
  'Houston Rockets': [P('US: SPACE CITY HD', SPORT)],
  'Indiana Pacers': [P('NBA: INDIANA PACERS ᴴᴰ', PPV)],
  'LA Clippers': [P('US: KTLA LOS ANGELES HD', ENT), P('NBA: LOS ANGELES CLIPPERS ᴴᴰ', PPV)],
  'Los Angeles Lakers': [P('TV: SPECTRUM SPORTSNET ᴿᴬᵂ', TV_RAW)],
  'Memphis Grizzlies': [P('NBA: MEMPHIS GRIZZLIES ᴴᴰ', PPV)],
  'Miami Heat': [P('US: ABC (WPLG) Miami (D) HD', 'US| MIAMI ᴴᴰ/ᴿᴬᵂ ⁶⁰ᶠᵖˢ')],
  'Milwaukee Bucks': [P('NBA: MILWAUKEE BUCKS ᴴᴰ', PPV)],
  'Minnesota Timberwolves': [P('US: NBC 11 (KARE) MINNEAPOLIS (H) ᴿᴬᵂ', NBC), P('NBA: MINNESOTA TIMBERWOLVES ᴴᴰ', PPV)],
  'New Orleans Pelicans': [P('NBA: NEW ORLEANS PELICANS ᴴᴰ', PPV)],
  'New York Knicks': [P('US: MSG HD', ENT)],
  'Oklahoma City Thunder': [P('NBA: OKLAHOMA CITY THUNDER ᴴᴰ', PPV)],
  'Orlando Magic': [P('NBA: ORLANDO MAGIC ᴴᴰ', PPV)],
  'Philadelphia 76ers': [P('US: NBC SPORTS PHILADELPHIA (D) ᴿᴬᵂ', NBC)],
  'Phoenix Suns': [P("RK: ARIZONA'S FAMILY ᴿᴬᵂ", 'US| ROKU ᴿᴬᵂ ⁶⁰ᶠᵖˢ')],
  'Portland Trail Blazers': [P('NBA: PORTLAND TRAIL BLAZERS ᴴᴰ', PPV)],
  'Sacramento Kings': [P('US: NBC SPORTS CALIFORNIA (D) ᴿᴬᵂ', NBC)],
  'San Antonio Spurs': [P('NBA: SAN ANTONIO SPURS ᴴᴰ', PPV)],
  'Toronto Raptors': [P('CA EN: SPORTSNET ONTARIO', 'CA| SPORTS EN'), P('CA EN: TSN 1', 'CA| SPORTS EN')],
  'Utah Jazz': [P('TV: SALT LAKE CITY, UT KJZZ IND 14 A3 HD PHILADELPHIA ᶜᶦᵗʸ ᴿᴬᵂ', CITY)],
  'Washington Wizards': [P('US: MONUMENTAL SPORTS NETWORK HD', SPORT), P('TV: MONUMENTAL SPORTS NETWORK ALTERNATE ᴿᴬᵂ', TV_RAW)],
};

const isPass = (p: Pick) => /nba team ppv/i.test(p.group) || /^nba:/i.test(p.name);

/** What tonight's listing calls each channel, as words to find in the playlist channel's name. */
const LISTING_WORDS: Record<string, string[]> = {
  NBCSB: ['nbc sports boston'], NBCSBA: ['nbc sports bay area'], NBCSCA: ['nbc sports california'], NBCSP: ['nbc sports philadelphia'],
  SPECSN: ['spectrum sportsnet'], MNMT: ['monumental'], MNMT2: ['monumental'], ALT: ['altitude'], ALT2: ['altitude sports 2', 'altitude'],
  SCHN: ['space city'], CHSN: ['chicago sports network'], YES: ['yes network'], MSG: ['msg'], WPCH: ['peachtree'], KTVK: ['arizona s family', 'ktvk'],
  KPHE: ['arizona s family', 'kphe'], SN: ['sportsnet'], SNO: ['sportsnet ontario'], TSN: ['tsn'],
};
function listingWords(code: string): string[] {
  const c = code.trim().toUpperCase().replace(/\.\d+$/, '');
  const station = c.split('-')[0];
  const tsn = /^TSN\s*(\d(?:\s*\/\s*\d)*)$/.exec(c);
  if (tsn) return tsn[1].split('/').map((n) => `tsn ${n.trim()}`);
  return LISTING_WORDS[c] ?? LISTING_WORDS[station] ?? [foldText(station)];
}
const hasWords = (name: string, w: string) => ` ${foldText(name)} `.includes(` ${w} `);

/** The playlist's channel for a pick: exact name first, then the same name ignoring case and symbols. */
function findChannel(p: Pick, lineup: LineupChannel[]): LineupChannel | undefined {
  const exact = lineup.find((c) => !c.hidden && c.originalName === p.name && (!p.group || !c.group || c.group === p.group));
  if (exact) return exact;
  const f = foldText(p.name);
  return lineup.find((c) => !c.hidden && foldText(c.originalName) === f);
}

/** Tonight's channels for a game from the NBA TV schedule: away, home and national names as listed. */
export interface NbaTonight {
  away: string[];
  home: string[];
  national: string[];
}

export interface TeamMain {
  side: 'home' | 'away';
  team: GameTeam;
  ch: LineupChannel;
  why: 'tonight' | 'pass' | 'usual';
}

/**
 * Each team's main stream for the game: its local channel if tonight's listing has the team on it, otherwise its
 * NBA team channel. Without a listing for the game, the team's channels in the order picked.
 */
export function nbaMainChannels(game: Game, tonight: NbaTonight | undefined, lineup: LineupChannel[]): TeamMain[] {
  const out: TeamMain[] = [];
  for (const side of ['home', 'away'] as const) {
    const team = side === 'home' ? game.home : game.away;
    const picks = NBA_TEAM_CHANNELS[team.name] ?? Object.entries(NBA_TEAM_CHANNELS).find(([n]) => foldText(n).endsWith(foldText(team.short)))?.[1];
    if (!picks) continue;
    const found = picks.map((p) => ({ p, ch: findChannel(p, lineup) })).filter((x): x is { p: Pick; ch: LineupChannel } => !!x.ch);
    const locals = found.filter((x) => !isPass(x.p));
    const passes = found.filter((x) => isPass(x.p));
    if (!tonight) {
      for (const x of found) out.push({ side, team, ch: x.ch, why: isPass(x.p) ? 'pass' : 'usual' });
      continue;
    }
    const listed = (side === 'home' ? tonight.home : tonight.away).flatMap(listingWords);
    const onTonight = locals.filter((x) => listed.some((w) => w.length >= 2 && hasWords(x.p.name, w)));
    if (onTonight.length) for (const x of onTonight) out.push({ side, team, ch: x.ch, why: 'tonight' });
    else for (const x of passes) out.push({ side, team, ch: x.ch, why: 'pass' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sports Media Watch's NBA TV schedule page: one card per game with its start time, the two teams and channel
// pills marked A (away) or H (home); unmarked pills are national.
export const NBA_TV_SCHEDULE_URL = 'https://www.sportsmediawatch.com/tv-schedules/nba-tv-schedule/';

export interface NbaListing extends NbaTonight {
  start: number;
  awayTeam: string;
  homeTeam: string;
}

export function parseNbaTvSchedule(html: string): NbaListing[] {
  const strip = (x: string) => x.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;/g, "'").replace(/\s+/g, ' ').trim();
  const out: NbaListing[] = [];
  const seen = new Set<string>();
  for (const c of html.split('smw-cards-daycard-item"').slice(1)) {
    const start = Date.parse(/data-timestamp="([^"]+)"/.exec(c)?.[1] ?? '');
    const team = (cls: string) => {
      const i = c.indexOf(cls);
      if (i < 0) return '';
      const seg = c.slice(i, c.indexOf('</div>', i));
      return [...seg.matchAll(/class="(?:smwcards-team-text|smw-cards-team-nick)"[^>]*>([^<]*)/g)].map((m) => strip(m[1])).join(' ').trim();
    };
    const awayTeam = team('smw-cards-team-away');
    const homeTeam = team('smw-cards-team-home');
    if (!Number.isFinite(start) || !awayTeam || !homeTeam || seen.has(`${start}|${awayTeam}`)) continue;
    seen.add(`${start}|${awayTeam}`);
    const g: NbaListing = { start, awayTeam, homeTeam, away: [], home: [], national: [] };
    for (const m of c.matchAll(/<span[^>]*class="smw-cards-net-item[^"]*"[^>]*>([\s\S]*?)<\/span><\/span>/g)) {
      const raw = m[1];
      const name = strip(raw.replace(/<span class="(?:away|home)-box">[AH]<\/span>/, ''));
      if (!name) continue;
      (/class="away-box"/.test(raw) ? g.away : /class="home-box"/.test(raw) ? g.home : g.national).push(name);
    }
    out.push(g);
  }
  return out;
}

/** Tonight's listing for a game: same teams (by nickname), starting within three hours. */
export function nbaTonightFor(game: Game, listings: NbaListing[]): NbaTonight | undefined {
  const nick = (t: GameTeam) => foldText(t.short);
  const has = (full: string, t: GameTeam) => ` ${foldText(full)} `.includes(` ${nick(t)} `);
  return listings.find((l) => Math.abs(l.start - game.start) < 3 * 3600_000 && has(l.homeTeam, game.home) && has(l.awayTeam, game.away));
}
