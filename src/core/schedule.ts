// Today's games per league, from ESPN's public scoreboard feed (the same JSON the
// espn.com scoreboards use; no key needed). It gives teams, logos, start times,
// live scores and — importantly — which TV networks carry each game, including the
// home and away local broadcasts (RSNs). LTTV only uses it as a schedule; the
// streams always come from the user's own playlist.

export type ScheduleLeagueId = 'nba' | 'nfl' | 'mlb' | 'nhl' | 'ucl' | 'epl' | 'bundesliga' | 'seriea' | 'ligue1' | 'laliga' | 'mls' | 'cbb' | 'cfb';

export interface ScheduleLeague {
  id: ScheduleLeagueId;
  /** Tab label. */
  tab: string;
  name: string;
  path: string;
  query?: string;
  sport: 'basketball' | 'football' | 'baseball' | 'hockey' | 'soccer';
  /** Words that identify the league in channel names / guide text. */
  words: RegExp;
}

export const SCHEDULE_LEAGUES: ScheduleLeague[] = [
  { id: 'nba', tab: 'NBA', name: 'NBA', path: 'basketball/nba', sport: 'basketball', words: /\bnba\b|basketball/i },
  { id: 'nfl', tab: 'NFL', name: 'NFL', path: 'football/nfl', sport: 'football', words: /\bnfl\b|football/i },
  { id: 'mlb', tab: 'MLB', name: 'MLB', path: 'baseball/mlb', sport: 'baseball', words: /\bmlb\b|baseball/i },
  { id: 'nhl', tab: 'NHL', name: 'NHL', path: 'hockey/nhl', sport: 'hockey', words: /\bnhl\b|hockey/i },
  { id: 'ucl', tab: 'UCL', name: 'UEFA Champions League', path: 'soccer/uefa.champions', sport: 'soccer', words: /\b(ucl|champions league|uefa)\b/i },
  { id: 'epl', tab: 'EPL', name: 'Premier League', path: 'soccer/eng.1', sport: 'soccer', words: /\b(epl|premier league)\b/i },
  { id: 'bundesliga', tab: 'Bundesliga', name: 'Bundesliga', path: 'soccer/ger.1', sport: 'soccer', words: /\bbundesliga\b/i },
  { id: 'seriea', tab: 'Serie A', name: 'Serie A', path: 'soccer/ita.1', sport: 'soccer', words: /\bserie a\b/i },
  { id: 'ligue1', tab: 'Ligue 1', name: 'Ligue 1', path: 'soccer/fra.1', sport: 'soccer', words: /\bligue 1\b/i },
  { id: 'laliga', tab: 'LaLiga', name: 'LaLiga', path: 'soccer/esp.1', sport: 'soccer', words: /\bla ?liga\b/i },
  { id: 'mls', tab: 'MLS', name: 'MLS', path: 'soccer/usa.1', sport: 'soccer', words: /\bmls\b/i },
  { id: 'cbb', tab: 'CBB', name: 'College Basketball', path: 'basketball/mens-college-basketball', query: 'groups=50&limit=400', sport: 'basketball', words: /\b(ncaa|college basketball|cbb)\b/i },
  { id: 'cfb', tab: 'CFB', name: 'College Football', path: 'football/college-football', query: 'groups=80&limit=400', sport: 'football', words: /\b(ncaa|college football|cfb)\b/i },
];

export function scheduleLeague(id: string): ScheduleLeague | undefined {
  return SCHEDULE_LEAGUES.find((l) => l.id === id);
}

export const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

/** Scoreboard URL for a league and a day ("20261015"). */
export function scoreboardUrl(league: ScheduleLeague, day: string, base = ESPN_BASE): string {
  return `${base}/${league.path}/scoreboard?dates=${day}${league.query ? '&' + league.query : ''}`;
}

export interface GameTeam {
  id: string;
  name: string; // "New York Yankees"
  short: string; // "Yankees"
  location: string; // "New York"
  abbr: string; // "NYY"
  logo?: string;
  color?: string;
  score?: string;
  record?: string;
  side: 'home' | 'away';
  winner?: boolean;
}

export type BroadcastMarket = 'national' | 'home' | 'away';

export interface Broadcast {
  name: string;
  market: BroadcastMarket;
  kind: 'tv' | 'streaming';
}

export interface Game {
  id: string;
  league: ScheduleLeagueId;
  start: number;
  state: 'pre' | 'in' | 'post';
  /** "7:05 PM", "Top 3rd", "Final", "Postponed"… */
  detail: string;
  name: string;
  home: GameTeam;
  away: GameTeam;
  broadcasts: Broadcast[];
  venue?: string;
  note?: string;
  neutral?: boolean;
}

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === 'object' ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

function parseTeam(raw: unknown): GameTeam | null {
  const c = obj(raw);
  const t = obj(c.team);
  const name = str(t.displayName) || str(t.name);
  if (!name) return null;
  const logos = arr(t.logos).map(obj);
  // Dark-background variant first (LTTV is dark); all of these are transparent PNGs.
  const logo = str(t.logoDark) || str(logos.find((l) => arr(l.rel).includes('dark'))?.href) || str(t.logo) || str(logos[0]?.href) || undefined;
  const rec = arr(c.records).map(obj).find((r) => str(r.type) === 'total' || str(r.name) === 'overall') ?? obj(arr(c.records)[0]);
  return {
    id: str(t.id) || name,
    name,
    short: str(t.shortDisplayName) || str(t.name) || name,
    location: str(t.location),
    abbr: str(t.abbreviation) || name.slice(0, 3).toUpperCase(),
    logo,
    color: str(t.color) || undefined,
    score: c.score !== undefined ? str(obj(c.score).displayValue ?? c.score) || str(c.score) : undefined,
    record: str(rec.summary) || undefined,
    side: str(c.homeAway) === 'home' ? 'home' : 'away',
    winner: c.winner === true ? true : undefined,
  };
}

function marketOf(v: unknown): BroadcastMarket {
  const m = str(obj(v).type ?? v).toLowerCase();
  return m === 'home' ? 'home' : m === 'away' ? 'away' : 'national';
}

function parseBroadcasts(comp: J): Broadcast[] {
  const out: Broadcast[] = [];
  const seen = new Set<string>();
  const add = (name: string, market: BroadcastMarket, kind: 'tv' | 'streaming') => {
    const n = name.trim();
    const k = `${n.toLowerCase()}|${market}`;
    if (!n || seen.has(k)) return;
    seen.add(k);
    out.push({ name: n, market, kind });
  };
  for (const g of arr(comp.geoBroadcasts).map(obj)) {
    const type = str(obj(g.type).shortName).toLowerCase();
    if (type === 'radio') continue;
    const region = str(g.region).toLowerCase();
    if (region && region !== 'us') continue;
    add(str(obj(g.media).shortName) || str(obj(g.media).name), marketOf(g.market), type === 'streaming' ? 'streaming' : 'tv');
  }
  if (!out.length) {
    for (const b of arr(comp.broadcasts).map(obj)) for (const n of arr(b.names)) add(str(n), marketOf(b.market), /\+|peacock|prime|apple|netflix|paramount|stream|pass|app/i.test(str(n)) ? 'streaming' : 'tv');
  }
  return out;
}

/** The league's logo from a scoreboard response (dark-background variant if offered). */
export function parseLeagueLogo(json: unknown): string | undefined {
  const lg = obj(arr(obj(json).leagues)[0]);
  const logos = arr(lg.logos).map(obj);
  return str(logos.find((l) => arr(l.rel).includes('dark'))?.href) || str(logos[0]?.href) || undefined;
}

/** Parse an ESPN scoreboard response. Unknown or partial events are skipped, never thrown on. */
export function parseScoreboard(json: unknown, league: ScheduleLeagueId): Game[] {
  const games: Game[] = [];
  for (const ev of arr(obj(json).events).map(obj)) {
    const comp = obj(arr(ev.competitions)[0]);
    const teams = arr(comp.competitors).map(parseTeam).filter((t): t is GameTeam => !!t);
    const home = teams.find((t) => t.side === 'home') ?? teams[1];
    const away = teams.find((t) => t.side === 'away' && t !== home) ?? teams.find((t) => t !== home);
    const start = Date.parse(str(comp.date) || str(ev.date));
    if (!home || !away || !Number.isFinite(start)) continue;
    const st = obj(obj(comp.status ?? ev.status).type);
    const state = (str(st.state) || 'pre') as Game['state'];
    const venue = obj(comp.venue);
    const notes = arr(comp.notes).map(obj);
    games.push({
      id: str(ev.id) || `${league}-${start}-${home.abbr}`,
      league,
      start,
      state: state === 'in' || state === 'post' ? state : 'pre',
      detail: str(st.shortDetail) || str(st.detail) || '',
      name: str(ev.name) || `${away.name} at ${home.name}`,
      home,
      away,
      broadcasts: parseBroadcasts(comp),
      venue: str(venue.fullName) || undefined,
      note: str(notes[0]?.headline) || undefined,
      neutral: comp.neutralSite === true || undefined,
    });
  }
  games.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
  return games;
}

// ---------------------------------------------------------------------------
// Recognising a game in channel names and guide text

function fold(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9&+]+/g, ' ').trim();
}

/** Words too generic to identify a team on their own. */
const GENERIC = new Set(['fc', 'cf', 'sc', 'ac', 'afc', 'united', 'city', 'state', 'real', 'club', 'sporting', 'athletic', 'new', 'the', 'of', 'de', 'la', 'st', 'saint', 'university', 'college']);

/** Names a team goes by, longest first ("new york yankees", "yankees", "nyy" only for pro teams). */
export function teamNames(t: GameTeam, sport: ScheduleLeague['sport']): string[] {
  const names = new Set<string>();
  const add = (s: string | undefined) => {
    const f = fold(s ?? '');
    if (f.length >= 3 && !GENERIC.has(f)) names.add(f);
  };
  add(t.name);
  add(t.short);
  if (sport === 'soccer') {
    // "Manchester City" / "Man City", "Bayern Munich" / "Bayern", "Paris Saint-Germain" / "PSG".
    add(t.name.replace(/\b(fc|cf|afc|sc|ac|ssc|as|sv|vfb|vfl|tsg|rb|rc|ud|cd|sd|ca|us|ogc|stade|club)\b/gi, ''));
    add(t.short.replace(/\b(fc|cf|afc|sc)\b/gi, ''));
    if (/^[A-Z]{3}$/.test(t.abbr)) add(t.abbr);
  } else {
    // Nickname = displayName minus location ("Yankees", "Crimson Tide").
    if (t.location && t.name.toLowerCase().startsWith(t.location.toLowerCase())) add(t.name.slice(t.location.length));
    if (sport === 'football' || sport === 'basketball') add(t.location); // college: "Michigan", "Ohio State"
  }
  return [...names].sort((a, b) => b.length - a.length);
}

function mentions(text: string, names: string[]): boolean {
  const f = ` ${fold(text)} `;
  return names.some((n) => f.includes(` ${n} `));
}

/** Does this text (channel name, programme title/subtitle) describe this game? Needs both teams. */
export function textMatchesGame(text: string, game: Game, sport: ScheduleLeague['sport']): boolean {
  if (!text) return false;
  return mentions(text, teamNames(game.home, sport)) && mentions(text, teamNames(game.away, sport));
}

/** Which team's broadcast a channel name/title refers to, e.g. "(Yankees feed)", "Home", "YES". */
export function feedSide(text: string, game: Game, sport: ScheduleLeague['sport']): 'home' | 'away' | undefined {
  const f = fold(text);
  if (/\bhome (feed|broadcast)\b|\(home\)/.test(f)) return 'home';
  if (/\baway (feed|broadcast)\b|\(away\)/.test(f)) return 'away';
  const m = /\b([a-z ]+?) (feed|broadcast)\b/.exec(f);
  if (m) {
    if (mentions(m[1], teamNames(game.home, sport))) return 'home';
    if (mentions(m[1], teamNames(game.away, sport))) return 'away';
  }
  return undefined;
}

/** Day key for the scoreboard ("20261015") in a time zone. */
export function scheduleDay(ts: number, timeZone?: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ts));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}${g('month')}${g('day')}`;
}

// ---- Team directory (all teams of a league, with logos) ----

export interface DirTeam {
  espnId: string;
  name: string;
  short: string;
  abbr: string;
  logo?: string;
  color?: string;
}

/** League -> ESPN path for its team list (the team picker's leagues). */
export const TEAM_DIRECTORY: { id: import('./teams').LeagueId; path: string }[] = [
  { id: 'nfl', path: 'football/nfl' }, { id: 'nba', path: 'basketball/nba' }, { id: 'wnba', path: 'basketball/wnba' },
  { id: 'mlb', path: 'baseball/mlb' }, { id: 'nhl', path: 'hockey/nhl' }, { id: 'mls', path: 'soccer/usa.1' },
  { id: 'epl', path: 'soccer/eng.1' }, { id: 'bundesliga', path: 'soccer/ger.1' }, { id: 'seriea', path: 'soccer/ita.1' },
  { id: 'ligue1', path: 'soccer/fra.1' }, { id: 'laliga', path: 'soccer/esp.1' }, { id: 'ucl', path: 'soccer/uefa.champions' },
  { id: 'cbb', path: 'basketball/mens-college-basketball' }, { id: 'cfb', path: 'football/college-football' },
];

export function teamsUrl(path: string, base = ESPN_BASE): string {
  return `${base.replace(/\/+$/, '')}/${path}/teams?limit=1000`;
}

/** ESPN's /teams response -> teams with their logos. */
export function parseTeams(json: unknown): DirTeam[] {
  const leagues = (json as { sports?: { leagues?: { teams?: { team?: Record<string, unknown> }[] }[] }[] })?.sports?.[0]?.leagues ?? [];
  const out: DirTeam[] = [];
  for (const l of leagues) for (const row of l.teams ?? []) {
    const t = row.team as { id?: string; displayName?: string; shortDisplayName?: string; nickname?: string; name?: string; abbreviation?: string; color?: string; isActive?: boolean; logos?: { href?: string; rel?: string[] }[] } | undefined;
    if (!t?.id || !t.displayName || t.isActive === false) continue;
    const logo = (t.logos ?? []).find((x) => x.href && !(x.rel ?? []).includes('dark'))?.href ?? t.logos?.[0]?.href;
    out.push({ espnId: String(t.id), name: t.displayName, short: t.shortDisplayName || t.nickname || t.name || t.displayName, abbr: (t.abbreviation || '').toUpperCase(), logo, color: t.color });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** League logos ESPN uses on its scoreboards (shown before a league's schedule has loaded). */
export const LEAGUE_LOGO_FALLBACK: Record<ScheduleLeagueId, string> = {
  nba: 'https://a.espncdn.com/i/teamlogos/leagues/500/nba.png',
  nfl: 'https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png',
  mlb: 'https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png',
  nhl: 'https://a.espncdn.com/i/teamlogos/leagues/500/nhl.png',
  ucl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/2.png',
  epl: 'https://a.espncdn.com/i/leaguelogos/soccer/500/23.png',
  bundesliga: 'https://a.espncdn.com/i/leaguelogos/soccer/500/10.png',
  seriea: 'https://a.espncdn.com/i/leaguelogos/soccer/500/12.png',
  ligue1: 'https://a.espncdn.com/i/leaguelogos/soccer/500/9.png',
  laliga: 'https://a.espncdn.com/i/leaguelogos/soccer/500/15.png',
  mls: 'https://a.espncdn.com/i/leaguelogos/soccer/500/19.png',
  cbb: 'https://a.espncdn.com/redesign/assets/img/icons/ESPN-icon-basketball.png',
  cfb: 'https://a.espncdn.com/redesign/assets/img/icons/ESPN-icon-football.png',
};

/** ESPN's logo address for a US pro team by abbreviation (used until the team list has loaded). */
export function proTeamLogo(league: string, abbr: string): string | undefined {
  return ['nfl', 'nba', 'mlb', 'nhl', 'wnba'].includes(league) && abbr ? `https://a.espncdn.com/i/teamlogos/${league}/500/${abbr.toLowerCase()}.png` : undefined;
}
