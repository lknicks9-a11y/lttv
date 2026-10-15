// Team catalog for the Sports section. Only names are stored (no logos or
// trademarks); users can add any other team as a custom team.

export type LeagueId = 'nfl' | 'nba' | 'mlb' | 'nhl' | 'mls' | 'epl' | 'eur' | 'wnba' | 'ucl' | 'bundesliga' | 'seriea' | 'ligue1' | 'laliga' | 'cbb' | 'cfb' | 'custom';

export interface League {
  id: LeagueId;
  name: string;
  sport: 'football' | 'basketball' | 'baseball' | 'hockey' | 'soccer' | 'other';
  /** Words that, when present in a listing, confirm this league/sport context. */
  context: string[];
}

export interface Team {
  id: string;
  league: LeagueId;
  name: string; // full name, e.g. "New York Giants"
  short: string; // nickname, e.g. "Giants"
  abbr: string;
  /** Extra names used in listings (e.g. "Man Utd"). */
  aliases?: string[];
  /** Transparent logo (from ESPN's team directory). */
  logo?: string;
}

export const LEAGUES: League[] = [
  { id: 'nfl', name: 'NFL', sport: 'football', context: ['nfl', 'football', 'super bowl', 'thursday night football', 'sunday night football', 'monday night football'] },
  { id: 'nba', name: 'NBA', sport: 'basketball', context: ['nba', 'basketball'] },
  { id: 'wnba', name: 'WNBA', sport: 'basketball', context: ['wnba', 'basketball'] },
  { id: 'mlb', name: 'MLB', sport: 'baseball', context: ['mlb', 'baseball', 'world series'] },
  { id: 'nhl', name: 'NHL', sport: 'hockey', context: ['nhl', 'hockey', 'stanley cup'] },
  { id: 'mls', name: 'MLS', sport: 'soccer', context: ['mls', 'soccer', 'football', 'futbol', 'futbol'] },
  { id: 'epl', name: 'Premier League', sport: 'soccer', context: ['premier league', 'epl', 'soccer', 'football', 'fa cup', 'carabao'] },
  { id: 'eur', name: 'European clubs', sport: 'soccer', context: ['soccer', 'football', 'champions league', 'la liga', 'laliga', 'bundesliga', 'serie a', 'ligue 1', 'uefa'] },
  { id: 'bundesliga', name: 'Bundesliga', sport: 'soccer', context: ['bundesliga', 'soccer', 'football', 'dfb'] },
  { id: 'seriea', name: 'Serie A', sport: 'soccer', context: ['serie a', 'soccer', 'football', 'calcio'] },
  { id: 'ligue1', name: 'Ligue 1', sport: 'soccer', context: ['ligue 1', 'soccer', 'football'] },
  { id: 'laliga', name: 'LaLiga', sport: 'soccer', context: ['laliga', 'la liga', 'soccer', 'football', 'futbol'] },
  { id: 'ucl', name: 'Champions League', sport: 'soccer', context: ['champions league', 'ucl', 'uefa', 'soccer', 'football'] },
  { id: 'cbb', name: 'College Basketball', sport: 'basketball', context: ['ncaa', 'college basketball', 'basketball', 'march madness'] },
  { id: 'cfb', name: 'College Football', sport: 'football', context: ['ncaa', 'college football', 'football', 'bowl'] },
  { id: 'custom', name: 'My custom teams', sport: 'other', context: [] },
];

type Row = [abbr: string, name: string, short: string, aliases?: string[]];

function make(league: LeagueId, rows: Row[]): Team[] {
  return rows.map(([abbr, name, short, aliases]) => ({ id: `${league}:${abbr.toLowerCase()}`, league, name, short, abbr, aliases }));
}

export const TEAMS: Team[] = [
  ...make('nfl', [
    ['ARI', 'Arizona Cardinals', 'Cardinals'], ['ATL', 'Atlanta Falcons', 'Falcons'], ['BAL', 'Baltimore Ravens', 'Ravens'],
    ['BUF', 'Buffalo Bills', 'Bills'], ['CAR', 'Carolina Panthers', 'Panthers'], ['CHI', 'Chicago Bears', 'Bears'],
    ['CIN', 'Cincinnati Bengals', 'Bengals'], ['CLE', 'Cleveland Browns', 'Browns'], ['DAL', 'Dallas Cowboys', 'Cowboys'],
    ['DEN', 'Denver Broncos', 'Broncos'], ['DET', 'Detroit Lions', 'Lions'], ['GB', 'Green Bay Packers', 'Packers'],
    ['HOU', 'Houston Texans', 'Texans'], ['IND', 'Indianapolis Colts', 'Colts'], ['JAX', 'Jacksonville Jaguars', 'Jaguars'],
    ['KC', 'Kansas City Chiefs', 'Chiefs'], ['LV', 'Las Vegas Raiders', 'Raiders'], ['LAC', 'Los Angeles Chargers', 'Chargers'],
    ['LAR', 'Los Angeles Rams', 'Rams'], ['MIA', 'Miami Dolphins', 'Dolphins'], ['MIN', 'Minnesota Vikings', 'Vikings'],
    ['NE', 'New England Patriots', 'Patriots'], ['NO', 'New Orleans Saints', 'Saints'], ['NYG', 'New York Giants', 'Giants'],
    ['NYJ', 'New York Jets', 'Jets'], ['PHI', 'Philadelphia Eagles', 'Eagles'], ['PIT', 'Pittsburgh Steelers', 'Steelers'],
    ['SF', 'San Francisco 49ers', '49ers', ['Niners']], ['SEA', 'Seattle Seahawks', 'Seahawks'], ['TB', 'Tampa Bay Buccaneers', 'Buccaneers', ['Bucs']],
    ['TEN', 'Tennessee Titans', 'Titans'], ['WAS', 'Washington Commanders', 'Commanders'],
  ]),
  ...make('nba', [
    ['ATL', 'Atlanta Hawks', 'Hawks'], ['BOS', 'Boston Celtics', 'Celtics'], ['BKN', 'Brooklyn Nets', 'Nets'],
    ['CHA', 'Charlotte Hornets', 'Hornets'], ['CHI', 'Chicago Bulls', 'Bulls'], ['CLE', 'Cleveland Cavaliers', 'Cavaliers', ['Cavs']],
    ['DAL', 'Dallas Mavericks', 'Mavericks', ['Mavs']], ['DEN', 'Denver Nuggets', 'Nuggets'], ['DET', 'Detroit Pistons', 'Pistons'],
    ['GSW', 'Golden State Warriors', 'Warriors'], ['HOU', 'Houston Rockets', 'Rockets'], ['IND', 'Indiana Pacers', 'Pacers'],
    ['LAC', 'LA Clippers', 'Clippers', ['Los Angeles Clippers']], ['LAL', 'Los Angeles Lakers', 'Lakers', ['LA Lakers']], ['MEM', 'Memphis Grizzlies', 'Grizzlies'],
    ['MIA', 'Miami Heat', 'Heat'], ['MIL', 'Milwaukee Bucks', 'Bucks'], ['MIN', 'Minnesota Timberwolves', 'Timberwolves', ['Wolves']],
    ['NOP', 'New Orleans Pelicans', 'Pelicans'], ['NYK', 'New York Knicks', 'Knicks'], ['OKC', 'Oklahoma City Thunder', 'Thunder'],
    ['ORL', 'Orlando Magic', 'Magic'], ['PHI', 'Philadelphia 76ers', '76ers', ['Sixers']], ['PHX', 'Phoenix Suns', 'Suns'],
    ['POR', 'Portland Trail Blazers', 'Trail Blazers', ['Blazers']], ['SAC', 'Sacramento Kings', 'Kings'], ['SAS', 'San Antonio Spurs', 'Spurs'],
    ['TOR', 'Toronto Raptors', 'Raptors'], ['UTA', 'Utah Jazz', 'Jazz'], ['WAS', 'Washington Wizards', 'Wizards'],
  ]),
  ...make('mlb', [
    ['ARI', 'Arizona Diamondbacks', 'Diamondbacks', ['D-backs', 'Dbacks']], ['ATH', 'Athletics', 'Athletics', ["A's"]], ['ATL', 'Atlanta Braves', 'Braves'],
    ['BAL', 'Baltimore Orioles', 'Orioles'], ['BOS', 'Boston Red Sox', 'Red Sox'], ['CHC', 'Chicago Cubs', 'Cubs'],
    ['CWS', 'Chicago White Sox', 'White Sox'], ['CIN', 'Cincinnati Reds', 'Reds'], ['CLE', 'Cleveland Guardians', 'Guardians'],
    ['COL', 'Colorado Rockies', 'Rockies'], ['DET', 'Detroit Tigers', 'Tigers'], ['HOU', 'Houston Astros', 'Astros'],
    ['KC', 'Kansas City Royals', 'Royals'], ['LAA', 'Los Angeles Angels', 'Angels'], ['LAD', 'Los Angeles Dodgers', 'Dodgers'],
    ['MIA', 'Miami Marlins', 'Marlins'], ['MIL', 'Milwaukee Brewers', 'Brewers'], ['MIN', 'Minnesota Twins', 'Twins'],
    ['NYM', 'New York Mets', 'Mets'], ['NYY', 'New York Yankees', 'Yankees'], ['PHI', 'Philadelphia Phillies', 'Phillies'],
    ['PIT', 'Pittsburgh Pirates', 'Pirates'], ['SD', 'San Diego Padres', 'Padres'], ['SF', 'San Francisco Giants', 'Giants'],
    ['SEA', 'Seattle Mariners', 'Mariners'], ['STL', 'St. Louis Cardinals', 'Cardinals', ['Saint Louis Cardinals']], ['TB', 'Tampa Bay Rays', 'Rays'],
    ['TEX', 'Texas Rangers', 'Rangers'], ['TOR', 'Toronto Blue Jays', 'Blue Jays'], ['WSH', 'Washington Nationals', 'Nationals', ['Nats']],
  ]),
  ...make('nhl', [
    ['ANA', 'Anaheim Ducks', 'Ducks'], ['BOS', 'Boston Bruins', 'Bruins'], ['BUF', 'Buffalo Sabres', 'Sabres'],
    ['CGY', 'Calgary Flames', 'Flames'], ['CAR', 'Carolina Hurricanes', 'Hurricanes', ['Canes']], ['CHI', 'Chicago Blackhawks', 'Blackhawks'],
    ['COL', 'Colorado Avalanche', 'Avalanche'], ['CBJ', 'Columbus Blue Jackets', 'Blue Jackets'], ['DAL', 'Dallas Stars', 'Stars'],
    ['DET', 'Detroit Red Wings', 'Red Wings'], ['EDM', 'Edmonton Oilers', 'Oilers'], ['FLA', 'Florida Panthers', 'Panthers'],
    ['LAK', 'Los Angeles Kings', 'Kings', ['LA Kings']], ['MIN', 'Minnesota Wild', 'Wild'], ['MTL', 'Montreal Canadiens', 'Canadiens', ['Montréal Canadiens', 'Habs']],
    ['NSH', 'Nashville Predators', 'Predators', ['Preds']], ['NJD', 'New Jersey Devils', 'Devils'], ['NYI', 'New York Islanders', 'Islanders'],
    ['NYR', 'New York Rangers', 'Rangers'], ['OTT', 'Ottawa Senators', 'Senators', ['Sens']], ['PHI', 'Philadelphia Flyers', 'Flyers'],
    ['PIT', 'Pittsburgh Penguins', 'Penguins', ['Pens']], ['SJS', 'San Jose Sharks', 'Sharks'], ['SEA', 'Seattle Kraken', 'Kraken'],
    ['STL', 'St. Louis Blues', 'Blues'], ['TBL', 'Tampa Bay Lightning', 'Lightning'], ['TOR', 'Toronto Maple Leafs', 'Maple Leafs', ['Leafs']],
    ['UTA', 'Utah Mammoth', 'Mammoth'], ['VAN', 'Vancouver Canucks', 'Canucks'], ['VGK', 'Vegas Golden Knights', 'Golden Knights'],
    ['WSH', 'Washington Capitals', 'Capitals', ['Caps']], ['WPG', 'Winnipeg Jets', 'Jets'],
  ]),
  ...make('wnba', [
    ['ATL', 'Atlanta Dream', 'Dream'], ['CHI', 'Chicago Sky', 'Sky'], ['CON', 'Connecticut Sun', 'Sun'], ['DAL', 'Dallas Wings', 'Wings'],
    ['GSV', 'Golden State Valkyries', 'Valkyries'], ['IND', 'Indiana Fever', 'Fever'], ['LVA', 'Las Vegas Aces', 'Aces'],
    ['LAS', 'Los Angeles Sparks', 'Sparks'], ['MIN', 'Minnesota Lynx', 'Lynx'], ['NYL', 'New York Liberty', 'Liberty'],
    ['PHO', 'Phoenix Mercury', 'Mercury'], ['POR', 'Portland Fire', 'Fire'], ['SEA', 'Seattle Storm', 'Storm'],
    ['TOR', 'Toronto Tempo', 'Tempo'], ['WAS', 'Washington Mystics', 'Mystics'],
  ]),
  ...make('mls', [
    ['ATL', 'Atlanta United', 'Atlanta United'], ['ATX', 'Austin FC', 'Austin FC'], ['CLT', 'Charlotte FC', 'Charlotte FC'],
    ['CHI', 'Chicago Fire', 'Chicago Fire', ['Chicago Fire FC']], ['CIN', 'FC Cincinnati', 'FC Cincinnati'], ['COL', 'Colorado Rapids', 'Rapids'],
    ['CLB', 'Columbus Crew', 'Columbus Crew'], ['DC', 'D.C. United', 'DC United', ['D.C. United']], ['DAL', 'FC Dallas', 'FC Dallas'],
    ['HOU', 'Houston Dynamo', 'Dynamo', ['Houston Dynamo FC']], ['MIA', 'Inter Miami', 'Inter Miami', ['Inter Miami CF']], ['LA', 'LA Galaxy', 'Galaxy'],
    ['LAFC', 'Los Angeles FC', 'LAFC'], ['MIN', 'Minnesota United', 'Minnesota United', ['Minnesota United FC']], ['MTL', 'CF Montréal', 'CF Montreal', ['CF Montréal']],
    ['NSH', 'Nashville SC', 'Nashville SC'], ['NE', 'New England Revolution', 'Revolution', ['New England Revs']], ['NYC', 'New York City FC', 'NYCFC', ['NYC FC']],
    ['RBNY', 'New York Red Bulls', 'Red Bulls', ['NY Red Bulls']], ['ORL', 'Orlando City', 'Orlando City', ['Orlando City SC']], ['PHI', 'Philadelphia Union', 'Union'],
    ['POR', 'Portland Timbers', 'Timbers'], ['RSL', 'Real Salt Lake', 'Real Salt Lake'], ['SD', 'San Diego FC', 'San Diego FC'],
    ['SJ', 'San Jose Earthquakes', 'Earthquakes', ['Quakes']], ['SEA', 'Seattle Sounders', 'Sounders', ['Seattle Sounders FC']], ['SKC', 'Sporting Kansas City', 'Sporting KC'],
    ['STL', 'St. Louis City SC', 'St. Louis City', ['St. Louis CITY SC']], ['TOR', 'Toronto FC', 'Toronto FC'], ['VAN', 'Vancouver Whitecaps', 'Whitecaps', ['Vancouver Whitecaps FC']],
  ]),
  ...make('epl', [
    ['ARS', 'Arsenal', 'Arsenal'], ['AVL', 'Aston Villa', 'Aston Villa'], ['BOU', 'AFC Bournemouth', 'Bournemouth'],
    ['BRE', 'Brentford', 'Brentford'], ['BHA', 'Brighton & Hove Albion', 'Brighton'], ['BUR', 'Burnley', 'Burnley'],
    ['CHE', 'Chelsea', 'Chelsea'], ['CRY', 'Crystal Palace', 'Crystal Palace'], ['EVE', 'Everton', 'Everton'],
    ['FUL', 'Fulham', 'Fulham'], ['LEE', 'Leeds United', 'Leeds', ['Leeds Utd']], ['LIV', 'Liverpool', 'Liverpool'],
    ['MCI', 'Manchester City', 'Man City'], ['MUN', 'Manchester United', 'Man United', ['Man Utd', 'Manchester Utd']], ['NEW', 'Newcastle United', 'Newcastle'],
    ['NFO', 'Nottingham Forest', "Nott'm Forest", ['Nottm Forest', 'Forest']], ['SUN', 'Sunderland', 'Sunderland'], ['TOT', 'Tottenham Hotspur', 'Tottenham', ['Spurs']],
    ['WHU', 'West Ham United', 'West Ham'], ['WOL', 'Wolverhampton Wanderers', 'Wolves'],
  ]),
  ...make('eur', [
    ['RMA', 'Real Madrid', 'Real Madrid'], ['BAR', 'FC Barcelona', 'Barcelona', ['Barça', 'Barca']], ['ATM', 'Atlético Madrid', 'Atletico Madrid', ['Atlético de Madrid']],
    ['BAY', 'Bayern Munich', 'Bayern', ['FC Bayern', 'Bayern München']], ['BVB', 'Borussia Dortmund', 'Dortmund'], ['PSG', 'Paris Saint-Germain', 'PSG', ['Paris SG']],
    ['JUV', 'Juventus', 'Juventus'], ['INT', 'Inter Milan', 'Inter', ['Internazionale', 'Inter Milano']], ['ACM', 'AC Milan', 'AC Milan'],
    ['NAP', 'Napoli', 'Napoli'], ['BEN', 'Benfica', 'Benfica'], ['POR', 'FC Porto', 'Porto'], ['AJA', 'Ajax', 'Ajax'],
    ['CEL', 'Celtic', 'Celtic'], ['RAN', 'Rangers FC', 'Rangers', ['Glasgow Rangers']],
  ]),
];

export function leagueOf(id: LeagueId): League {
  return LEAGUES.find((l) => l.id === id) ?? LEAGUES[LEAGUES.length - 1];
}

export interface CustomTeam {
  id: string; // "custom:<slug>", or "espn:<league>:<id>" for a team picked from ESPN's team list
  name: string;
  aliases: string[];
  league?: LeagueId;
  short?: string;
  abbr?: string;
  logo?: string;
}

export function customToTeam(c: CustomTeam): Team {
  const abbr = c.abbr || c.name.replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase() || 'T';
  return { id: c.id, league: c.league ?? 'custom', name: c.name, short: c.short || c.name, abbr, aliases: c.aliases, logo: c.logo };
}

export function allTeams(custom: CustomTeam[] = []): Team[] {
  return [...TEAMS, ...custom.map(customToTeam)];
}

/** Stable, pleasant badge color for a team (no trademarked colors). */
export function teamColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 62%, 46%)`;
}
