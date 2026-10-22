// Live player and team stats for Fantasy and Bets (prop tracker), from ESPN's public game
// summary feed (site.api.espn.com/.../summary?event=<id>). Pure functions: parsing a summary,
// fantasy points, prop values, and what changed between two snapshots (for the pop-ups).
// Nothing here places bets or contacts a sportsbook: lines are typed in by the user.

export type LiveSport = 'football' | 'basketball';
export type LiveLeague = 'nfl' | 'nba' | 'cfb' | 'cbb';

export const LIVE_LEAGUES: { id: LiveLeague; name: string; sport: LiveSport; path: string; headshot?: string }[] = [
  { id: 'nfl', name: 'NFL', sport: 'football', path: 'football/nfl', headshot: 'nfl' },
  { id: 'nba', name: 'NBA', sport: 'basketball', path: 'basketball/nba', headshot: 'nba' },
  { id: 'cfb', name: 'College Football', sport: 'football', path: 'football/college-football', headshot: 'college-football' },
  { id: 'cbb', name: 'College Basketball', sport: 'basketball', path: 'basketball/mens-college-basketball', headshot: 'mens-college-basketball' },
];

export function liveLeague(id: string) {
  return LIVE_LEAGUES.find((l) => l.id === id);
}

export interface LivePlayer {
  id: string;
  name: string;
  teamId: string;
  headshot?: string;
  /** Normalised stats: passYds, passTD, int, rushYds, rushTD, rec, recYds, recTD, fumLost, pts, reb, ast… */
  stats: Record<string, number>;
}

export interface LivePlay {
  id: string;
  text: string;
  teamId?: string;
  athleteIds: string[];
  scoring?: boolean;
}

export interface LiveTeam {
  id: string;
  abbr: string;
  name: string;
  logo?: string;
  score: number;
  stats: Record<string, number>;
  homeAway?: 'home' | 'away';
}

export interface LiveGame {
  id: string;
  state: 'pre' | 'in' | 'post';
  detail: string;
  teams: LiveTeam[];
  players: Map<string, LivePlayer>;
  /** Most recent last. */
  plays: LivePlay[];
}

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === 'object' ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** "21/31" -> [21, 31]; "2-14" -> [2, 14]; "256" -> [256]. */
function nums(v: string): number[] {
  return v.split(/[/-]/).map((x) => Number(x.trim())).map((n) => (Number.isFinite(n) ? n : 0));
}

/** ESPN stat key (or column label) -> our names; compound keys produce several. */
const FOOTBALL_KEYS: Record<string, string[]> = {
  'completions/passingAttempts': ['completions', 'passAtt'],
  passingYards: ['passYds'],
  passingTouchdowns: ['passTD'],
  interceptions: ['int'],
  rushingAttempts: ['rushAtt'],
  rushingYards: ['rushYds'],
  rushingTouchdowns: ['rushTD'],
  longRushing: ['longRush'],
  receptions: ['rec'],
  receivingYards: ['recYds'],
  receivingTouchdowns: ['recTD'],
  longReception: ['longRec'],
  receivingTargets: ['targets'],
  fumblesLost: ['fumLost'],
  'fieldGoalsMade/fieldGoalAttempts': ['fgMade', 'fgAtt'],
  'extraPointsMade/extraPointAttempts': ['xpMade', 'xpAtt'],
  totalKickingPoints: ['kickPts'],
  totalTackles: ['tackles'],
  sacks: ['sacks'],
};
/** The same stat names appear under several categories (e.g. "interceptions" thrown vs caught). */
const FOOTBALL_CATEGORY_OVERRIDES: Record<string, Record<string, string[]>> = {
  interceptions: { interceptions: ['defInt'] },
  defensive: { sacks: ['sacks'] },
  passing: { 'sacks-sackYardsLost': ['sacked', 'sackYds'] },
};
const BASKETBALL_KEYS: Record<string, string[]> = {
  minutes: ['min'],
  points: ['pts'],
  'fieldGoalsMade-fieldGoalsAttempted': ['fgm', 'fga'],
  'threePointFieldGoalsMade-threePointFieldGoalsAttempted': ['tpm', 'tpa'],
  'freeThrowsMade-freeThrowsAttempted': ['ftm', 'fta'],
  rebounds: ['reb'],
  assists: ['ast'],
  turnovers: ['to'],
  steals: ['stl'],
  blocks: ['blk'],
  offensiveRebounds: ['oreb'],
  defensiveRebounds: ['dreb'],
  fouls: ['pf'],
};
const BASKETBALL_LABELS: Record<string, string[]> = {
  MIN: ['min'], PTS: ['pts'], FG: ['fgm', 'fga'], '3PT': ['tpm', 'tpa'], FT: ['ftm', 'fta'], REB: ['reb'], AST: ['ast'], TO: ['to'], STL: ['stl'], BLK: ['blk'], OREB: ['oreb'], DREB: ['dreb'], PF: ['pf'],
};

const TEAM_STAT_KEYS: Record<string, string> = {
  totalYards: 'totalYds', netPassingYards: 'passYds', rushingYards: 'rushYds', firstDowns: 'firstDowns', turnovers: 'turnovers',
  totalPenaltiesYards: 'penalties', sacksYardsLost: 'sacked',
  // basketball
  fieldGoalsMade: 'fgm', threePointFieldGoalsMade: 'tpm', freeThrowsMade: 'ftm', totalRebounds: 'reb', rebounds: 'reb', assists: 'ast', steals: 'stl', blocks: 'blk', turnovers_bb: 'to',
};

/** Read one ESPN summary. Tolerant: missing parts just stay empty. */
export function parseSummary(json: unknown, sport: LiveSport, gameId = ''): LiveGame {
  const root = obj(json);
  const comp = obj(arr(obj(root.header).competitions)[0]);
  const status = obj(obj(comp.status).type);
  const state = (str(status.state) as LiveGame['state']) || 'pre';
  const teams: LiveTeam[] = arr(comp.competitors).map((c) => {
    const cc = obj(c);
    const t = obj(cc.team);
    const logo = str(t.logo) || str(obj(arr(t.logos)[0]).href) || undefined;
    return { id: str(t.id), abbr: str(t.abbreviation), name: str(t.displayName), logo, score: Number(str(cc.score)) || 0, stats: {}, homeAway: str(cc.homeAway) as 'home' | 'away' };
  });
  const box = obj(root.boxscore);
  for (const bt of arr(box.teams)) {
    const b = obj(bt);
    const tid = str(obj(b.team).id);
    const t = teams.find((x) => x.id === tid);
    if (!t) continue;
    if (!t.logo) t.logo = str(obj(b.team).logo) || undefined;
    for (const s of arr(b.statistics)) {
      const ss = obj(s);
      let key = str(ss.name);
      if (sport === 'basketball' && key === 'turnovers') key = 'turnovers_bb';
      const ours = TEAM_STAT_KEYS[key];
      if (!ours) continue;
      const v = nums(str(ss.displayValue))[0];
      if (Number.isFinite(v)) t.stats[ours] = v;
    }
  }
  const players = new Map<string, LivePlayer>();
  for (const bp of arr(box.players)) {
    const b = obj(bp);
    const tid = str(obj(b.team).id);
    for (const cat of arr(b.statistics)) {
      const c = obj(cat);
      const catName = str(c.name);
      const keys = arr(c.keys).map(str);
      const labels = arr(c.labels).map(str);
      for (const a of arr(c.athletes)) {
        const aa = obj(a);
        const ath = obj(aa.athlete);
        const id = str(ath.id);
        if (!id) continue;
        let p = players.get(id);
        if (!p) {
          p = { id, name: str(ath.displayName) || str(ath.shortName), teamId: tid, headshot: str(obj(ath.headshot).href) || undefined, stats: {} };
          players.set(id, p);
        }
        const vals = arr(aa.stats).map(str);
        vals.forEach((raw, i) => {
          const key = keys[i] ?? '';
          const names = sport === 'football'
            ? FOOTBALL_CATEGORY_OVERRIDES[catName]?.[key] ?? FOOTBALL_KEYS[key]
            : BASKETBALL_KEYS[key] ?? BASKETBALL_LABELS[labels[i] ?? ''];
          if (!names) return;
          const n = nums(raw);
          names.forEach((name, j) => {
            if (n[j] !== undefined) p!.stats[name] = n[j];
          });
        });
      }
    }
  }
  // Plays: football keeps them per drive; basketball has one list.
  const rawPlays: unknown[] = [];
  const drives = obj(root.drives);
  for (const d of arr(drives.previous)) rawPlays.push(...arr(obj(d).plays));
  rawPlays.push(...arr(obj(drives.current).plays));
  rawPlays.push(...arr(root.plays));
  const plays: LivePlay[] = rawPlays.map((x) => {
    const p = obj(x);
    const athleteIds = arr(p.participants).map((q) => str(obj(obj(q).athlete).id)).filter(Boolean);
    return { id: str(p.id), text: str(p.text), teamId: str(obj(p.team).id) || undefined, athleteIds, scoring: !!p.scoringPlay };
  }).filter((p) => p.text);
  return { id: gameId || str(comp.id) || str(obj(root.header).id), state, detail: str(status.shortDetail) || str(status.detail), teams, players, plays };
}

// ---- Fantasy ----

export type FantasyScoring = 'ppr' | 'half' | 'standard';

/** Fantasy points from normalised stats (standard ESPN-style rules). */
export function fantasyPoints(s: Record<string, number>, sport: LiveSport, scoring: FantasyScoring = 'ppr'): number {
  const v = (k: string) => s[k] ?? 0;
  let pts: number;
  if (sport === 'football') {
    const recPts = scoring === 'ppr' ? 1 : scoring === 'half' ? 0.5 : 0;
    pts = v('passYds') / 25 + v('passTD') * 4 - v('int') * 2
      + v('rushYds') / 10 + v('rushTD') * 6
      + v('rec') * recPts + v('recYds') / 10 + v('recTD') * 6
      - v('fumLost') * 2
      + v('fgMade') * 3 + v('xpMade');
  } else {
    pts = v('pts') + v('reb') * 1.2 + v('ast') * 1.5 + v('stl') * 3 + v('blk') * 3 - v('to');
  }
  return Math.round(pts * 100) / 100;
}

// ---- Props ----

export interface PropDef {
  id: string;
  label: string;
  /** Short unit for pop-ups ("rec yds"). */
  unit: string;
  value: (s: Record<string, number>) => number;
}

const st = (k: string) => (s: Record<string, number>) => s[k] ?? 0;
const sum = (...ks: string[]) => (s: Record<string, number>) => ks.reduce((t, k) => t + (s[k] ?? 0), 0);

/** Every player prop LTTV can track, per sport. */
export const PLAYER_PROPS: Record<LiveSport, PropDef[]> = {
  football: [
    { id: 'passYds', label: 'Passing yards', unit: 'pass yds', value: st('passYds') },
    { id: 'passTD', label: 'Passing touchdowns', unit: 'pass TD', value: st('passTD') },
    { id: 'completions', label: 'Pass completions', unit: 'completions', value: st('completions') },
    { id: 'passAtt', label: 'Pass attempts', unit: 'attempts', value: st('passAtt') },
    { id: 'int', label: 'Interceptions thrown', unit: 'INT', value: st('int') },
    { id: 'rushYds', label: 'Rushing yards', unit: 'rush yds', value: st('rushYds') },
    { id: 'rushAtt', label: 'Rushing attempts', unit: 'carries', value: st('rushAtt') },
    { id: 'rushTD', label: 'Rushing touchdowns', unit: 'rush TD', value: st('rushTD') },
    { id: 'longRush', label: 'Longest rush', unit: 'yd long', value: st('longRush') },
    { id: 'rec', label: 'Receptions', unit: 'rec', value: st('rec') },
    { id: 'recYds', label: 'Receiving yards', unit: 'rec yds', value: st('recYds') },
    { id: 'recTD', label: 'Receiving touchdowns', unit: 'rec TD', value: st('recTD') },
    { id: 'longRec', label: 'Longest reception', unit: 'yd long', value: st('longRec') },
    { id: 'rushRecYds', label: 'Rushing + receiving yards', unit: 'scrimmage yds', value: sum('rushYds', 'recYds') },
    { id: 'passRushYds', label: 'Passing + rushing yards', unit: 'pass+rush yds', value: sum('passYds', 'rushYds') },
    { id: 'anyTD', label: 'Anytime touchdown (rush or receive)', unit: 'TD', value: sum('rushTD', 'recTD') },
    { id: 'fgMade', label: 'Field goals made', unit: 'FG', value: st('fgMade') },
    { id: 'kickPts', label: 'Kicking points', unit: 'kick pts', value: st('kickPts') },
    { id: 'tackles', label: 'Tackles', unit: 'tackles', value: st('tackles') },
    { id: 'sacks', label: 'Sacks', unit: 'sacks', value: st('sacks') },
  ],
  basketball: [
    { id: 'pts', label: 'Points', unit: 'pts', value: st('pts') },
    { id: 'reb', label: 'Rebounds', unit: 'reb', value: st('reb') },
    { id: 'ast', label: 'Assists', unit: 'ast', value: st('ast') },
    { id: 'tpm', label: '3-pointers made', unit: '3PM', value: st('tpm') },
    { id: 'stl', label: 'Steals', unit: 'stl', value: st('stl') },
    { id: 'blk', label: 'Blocks', unit: 'blk', value: st('blk') },
    { id: 'to', label: 'Turnovers', unit: 'TO', value: st('to') },
    { id: 'pra', label: 'Points + rebounds + assists', unit: 'PRA', value: sum('pts', 'reb', 'ast') },
    { id: 'pr', label: 'Points + rebounds', unit: 'P+R', value: sum('pts', 'reb') },
    { id: 'pa', label: 'Points + assists', unit: 'P+A', value: sum('pts', 'ast') },
    { id: 'ra', label: 'Rebounds + assists', unit: 'R+A', value: sum('reb', 'ast') },
    { id: 'sb', label: 'Steals + blocks', unit: 'stl+blk', value: sum('stl', 'blk') },
    { id: 'ftm', label: 'Free throws made', unit: 'FTM', value: st('ftm') },
    { id: 'fgm', label: 'Field goals made', unit: 'FGM', value: st('fgm') },
  ],
};

export interface TeamPropDef {
  id: string;
  label: string;
  unit: string;
  /** Needs the opponent (game total, spread). */
  value: (team: LiveTeam, opp: LiveTeam | undefined) => number;
  /** Spread: the line is added to the team's margin and must stay above 0. */
  spread?: boolean;
}

const ts = (k: string) => (t: LiveTeam) => t.stats[k] ?? 0;

/** Every team / game prop LTTV can track, per sport. */
export const TEAM_PROPS: Record<LiveSport, TeamPropDef[]> = {
  football: [
    { id: 'points', label: 'Team points', unit: 'pts', value: (t) => t.score },
    { id: 'gameTotal', label: 'Game total points (both teams)', unit: 'total pts', value: (t, o) => t.score + (o?.score ?? 0) },
    { id: 'spread', label: 'Spread (enter e.g. -3.5 or +7)', unit: 'margin', value: (t, o) => t.score - (o?.score ?? 0), spread: true },
    { id: 'totalYds', label: 'Total yards', unit: 'yds', value: ts('totalYds') },
    { id: 'passYds', label: 'Passing yards', unit: 'pass yds', value: ts('passYds') },
    { id: 'rushYds', label: 'Rushing yards', unit: 'rush yds', value: ts('rushYds') },
    { id: 'firstDowns', label: 'First downs', unit: '1st downs', value: ts('firstDowns') },
    { id: 'turnovers', label: 'Turnovers', unit: 'turnovers', value: ts('turnovers') },
  ],
  basketball: [
    { id: 'points', label: 'Team points', unit: 'pts', value: (t) => t.score },
    { id: 'gameTotal', label: 'Game total points (both teams)', unit: 'total pts', value: (t, o) => t.score + (o?.score ?? 0) },
    { id: 'spread', label: 'Spread (enter e.g. -5.5 or +3)', unit: 'margin', value: (t, o) => t.score - (o?.score ?? 0), spread: true },
    { id: 'reb', label: 'Team rebounds', unit: 'reb', value: ts('reb') },
    { id: 'ast', label: 'Team assists', unit: 'ast', value: ts('ast') },
    { id: 'tpm', label: 'Team 3-pointers made', unit: '3PM', value: ts('tpm') },
  ],
};

export interface Bet {
  id: string;
  kind: 'player' | 'team';
  league: LiveLeague;
  prop: string;
  line: number;
  side: 'over' | 'under';
  teamId: string;
  teamName: string;
  teamLogo?: string;
  athleteId?: string;
  athleteName?: string;
  headshot?: string;
  createdAt: number;
  /** A leg of this parlay (see Parlay). */
  parlayId?: string;
}

export interface Parlay {
  id: string;
  createdAt: number;
}

export type BetStatus = 'pending' | 'live' | 'hit' | 'lost' | 'push';

/** Current value and status of a tracked prop in a game. */
export function betProgress(b: Bet, g: LiveGame | undefined, sport: LiveSport): { value: number; status: BetStatus } {
  if (!g) return { value: 0, status: 'pending' };
  let value = 0;
  let spread = false;
  if (b.kind === 'player') {
    const p = b.athleteId ? g.players.get(b.athleteId) : undefined;
    const def = PLAYER_PROPS[sport].find((x) => x.id === b.prop);
    value = p && def ? def.value(p.stats) : 0;
  } else {
    const t = g.teams.find((x) => x.id === b.teamId);
    const o = g.teams.find((x) => x.id !== b.teamId);
    const def = TEAM_PROPS[sport].find((x) => x.id === b.prop);
    value = t && def ? def.value(t, o) : 0;
    spread = !!def?.spread;
  }
  if (g.state === 'pre') return { value, status: 'pending' };
  // Spread: margin + line > 0 wins (the "over" side is the team covering).
  const score = spread ? value + b.line : value;
  const target = spread ? 0 : b.line;
  const over = b.side === 'over';
  if (score === target && g.state === 'post') return { value, status: 'push' };
  if (over && score > target && !spread) return { value, status: 'hit' }; // an over can't be lost once it's hit
  if (!over && score > target && !spread) return { value, status: 'lost' };
  if (g.state === 'post') return { value, status: (over ? score > target : score < target) ? 'hit' : 'lost' };
  return { value, status: 'live' };
}

export function betLabel(b: Bet, sport: LiveSport): string {
  const def = b.kind === 'player' ? PLAYER_PROPS[sport].find((x) => x.id === b.prop) : TEAM_PROPS[sport].find((x) => x.id === b.prop);
  const who = b.kind === 'player' ? b.athleteName ?? 'Player' : b.teamName;
  if (b.kind === 'team' && b.prop === 'spread') return `${who} ${b.line > 0 ? '+' : ''}${b.line}`;
  return `${who} ${b.side === 'over' ? 'over' : 'under'} ${b.line} ${def?.label.toLowerCase() ?? b.prop}`;
}

// ---- What changed (for the pop-ups) ----

export interface LiveNotice {
  key: string;
  kind: 'fantasy' | 'bet' | 'score' | 'parlay';
  title: string;
  detail: string;
  play?: string;
  headshot?: string;
  logo?: string;
  tone?: 'good' | 'bad' | 'info';
}

/** The latest play that mentions a player (by id when the feed lists participants, else by name). */
export function latestPlayFor(g: LiveGame, athleteId: string, name: string, match?: (p: LivePlay) => boolean): string | undefined {
  const last = name.split(' ').slice(-1)[0];
  for (let i = g.plays.length - 1; i >= Math.max(0, g.plays.length - 40); i--) {
    const p = g.plays[i];
    if (match && !match(p)) continue;
    if (p.athleteIds.includes(athleteId) || (last.length > 2 && new RegExp(`\\b${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(p.text))) return p.text;
  }
  return undefined;
}

/** The kind of play that moves a prop (so a points bet shows the basket, not the player's last turnover). */
const PROP_PLAYS: Record<string, (p: LivePlay) => boolean> = {
  pts: (p) => !!p.scoring,
  fgm: (p) => !!p.scoring && !/free throw/i.test(p.text),
  tpm: (p) => !!p.scoring && /three point|3-pt|3pt/i.test(p.text),
  ftm: (p) => /free throw/i.test(p.text) && /make/i.test(p.text),
  reb: (p) => /rebound/i.test(p.text),
  ast: (p) => /assist/i.test(p.text),
  stl: (p) => /steal/i.test(p.text),
  blk: (p) => /block/i.test(p.text),
  to: (p) => /turnover|bad pass|lost ball|traveling|offensive foul/i.test(p.text),
  pra: (p) => !!p.scoring || /rebound|assist/i.test(p.text),
  pr: (p) => !!p.scoring || /rebound/i.test(p.text),
  pa: (p) => !!p.scoring || /assist/i.test(p.text),
  ra: (p) => /rebound|assist/i.test(p.text),
  sb: (p) => /steal|block/i.test(p.text),
  passTD: (p) => !!p.scoring,
  rushTD: (p) => !!p.scoring,
  recTD: (p) => !!p.scoring,
  anyTD: (p) => !!p.scoring,
  kickPts: (p) => !!p.scoring,
  fgMade: (p) => /field goal/i.test(p.text) && /good/i.test(p.text),
  sacks: (p) => /sack/i.test(p.text),
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Compare two snapshots of a game and describe what changed for the user's fantasy players
 * and tracked props: one notice per player whose fantasy points went up/down, one per prop
 * whose value moved (with "HIT" / "LOST" when it is decided).
 */
export function diffNotices(prev: LiveGame | undefined, next: LiveGame, sport: LiveSport, opts: { roster: { athleteId: string; name: string; headshot?: string }[]; bets: Bet[]; scoring?: FantasyScoring; leagueHeadshot?: string }): LiveNotice[] {
  if (!prev) return [];
  const out: LiveNotice[] = [];
  const logoOf = (teamId: string) => next.teams.find((t) => t.id === teamId)?.logo;
  // Games with a team bet: every score change pops up (score line, the scoring team's logo, the play).
  // …until every team bet on the game is decided (e.g. an over that already hit): then the game goes quiet.
  const openTeamBet = opts.bets.some((b) => b.kind === 'team' && !['hit', 'lost', 'push'].includes(betProgress(b, prev, sport).status));
  if (openTeamBet) {
    const scorer = next.teams.find((t) => t.score > (prev.teams.find((x) => x.id === t.id)?.score ?? 0));
    if (scorer) {
      const away = next.teams.find((t) => t.homeAway === 'away') ?? next.teams[1] ?? next.teams[0];
      const home = next.teams.find((t) => t.homeAway === 'home') ?? next.teams[0];
      const pts = scorer.score - (prev.teams.find((x) => x.id === scorer.id)?.score ?? 0);
      const play = [...next.plays].reverse().find((pl) => pl.scoring && (!pl.teamId || pl.teamId === scorer.id)) ?? next.plays[next.plays.length - 1];
      out.push({
        key: `s|${next.id}|${next.teams.map((t) => `${t.id}:${t.score}`).join(',')}`,
        kind: 'score',
        title: `${away.abbr} ${away.score} – ${home.score} ${home.abbr}`,
        detail: `${scorer.abbr} +${pts} · ${next.detail}`,
        play: play?.text,
        logo: scorer.logo,
        tone: opts.bets.some((b) => b.kind === 'team' && b.teamId === scorer.id) ? 'good' : 'info',
      });
    }
  }
  const shot = (id: string, given?: string) => given || next.players.get(id)?.headshot || (opts.leagueHeadshot ? `https://a.espncdn.com/i/headshots/${opts.leagueHeadshot}/players/full/${id}.png` : undefined);
  // A player with an open bet gets bet pop-ups only (not also fantasy-point ones, which made a points
  // bet show "-1" for the player's turnover).
  const betOn = new Set(opts.bets.filter((b) => b.athleteId && !['hit', 'lost', 'push'].includes(betProgress(b, prev, sport).status)).map((b) => b.athleteId!));
  for (const r of opts.roster) {
    if (betOn.has(r.athleteId)) continue;
    const a = prev.players.get(r.athleteId);
    const b = next.players.get(r.athleteId);
    if (!b) continue;
    const before = a ? fantasyPoints(a.stats, sport, opts.scoring) : 0;
    const after = fantasyPoints(b.stats, sport, opts.scoring);
    const d = Math.round((after - before) * 100) / 100;
    if (Math.abs(d) < 0.05) continue;
    out.push({
      key: `f|${next.id}|${r.athleteId}|${after}`,
      kind: 'fantasy',
      title: `${b.name} ${d > 0 ? '+' : ''}${fmt(d)} fantasy pts`,
      detail: `${fmt(after)} pts today`,
      play: latestPlayFor(next, r.athleteId, b.name),
      headshot: shot(r.athleteId, r.headshot),
      logo: logoOf(b.teamId),
      tone: d > 0 ? 'good' : 'bad',
    });
  }
  for (const bet of opts.bets) {
    const p0 = betProgress(bet, prev, sport);
    const p1 = betProgress(bet, next, sport);
    if (p1.value === p0.value && p1.status === p0.status) continue;
    // Once a bet is decided it goes quiet (one "BET HIT" / "BET LOST" and nothing more).
    if (p0.status === 'hit' || p0.status === 'lost' || p0.status === 'push') continue;
    const def = bet.kind === 'player' ? PLAYER_PROPS[sport].find((x) => x.id === bet.prop) : TEAM_PROPS[sport].find((x) => x.id === bet.prop);
    const decided = p1.status !== p0.status && (p1.status === 'hit' || p1.status === 'lost' || p1.status === 'push');
    // A stat corrected down by ESPN isn't news (it showed as "-1").
    if (!decided && p1.value < p0.value) continue;
    const lineText = def && 'spread' in def && def.spread ? `${bet.line > 0 ? '+' : ''}${bet.line}` : `${bet.side === 'over' ? 'O' : 'U'} ${bet.line}`;
    out.push({
      key: `b|${bet.id}|${p1.value}|${p1.status}`,
      kind: 'bet',
      title: decided ? `${p1.status === 'hit' ? 'BET HIT' : p1.status === 'push' ? 'BET PUSH' : 'BET LOST'}: ${betLabel(bet, sport)}` : `${bet.athleteName ?? bet.teamName}: ${fmt(p1.value)} ${def?.unit ?? ''} (${lineText})`,
      detail: decided ? `${next.state === 'post' ? 'Finished at' : 'Now at'} ${fmt(p1.value)} ${def?.unit ?? ''}` : `${p1.value > p0.value ? '+' : ''}${fmt(p1.value - p0.value)} ${def?.unit ?? ''} · needs ${bet.side === 'over' ? 'over' : 'under'} ${bet.line}`,
      play: bet.athleteId ? latestPlayFor(next, bet.athleteId, bet.athleteName ?? '', PROP_PLAYS[bet.prop]) : undefined,
      headshot: bet.athleteId ? shot(bet.athleteId, bet.headshot) : undefined,
      logo: bet.teamLogo || logoOf(bet.teamId),
      tone: p1.status === 'hit' ? 'good' : p1.status === 'lost' ? 'bad' : 'info',
    });
  }
  return out;
}

/** ESPN roster response -> players (NFL groups them by unit, NBA lists them flat). */
export function parseRoster(json: unknown): { id: string; name: string; position: string; jersey?: string; headshot?: string }[] {
  const out: { id: string; name: string; position: string; jersey?: string; headshot?: string }[] = [];
  const add = (x: unknown) => {
    const a = obj(x);
    const id = str(a.id);
    if (!id || !str(a.displayName)) return;
    out.push({ id, name: str(a.displayName), position: str(obj(a.position).abbreviation), jersey: str(a.jersey) || undefined, headshot: str(obj(a.headshot).href) || undefined });
  };
  for (const g of arr(obj(json).athletes)) {
    const gg = obj(g);
    if (Array.isArray(gg.items)) for (const x of gg.items) add(x);
    else add(g);
  }
  return out;
}

// ---------------- position groups ----------------

export interface PositionGroup {
  id: string;
  label: string;
  positions: string[];
  /** Player props that make sense for this group (ids from PLAYER_PROPS). */
  props: string[];
  /** Counts for fantasy scoring. */
  fantasy: boolean;
}

/** Position groups in roster order; positions not listed (linemen, punters, long snappers) have no props. */
export const POSITION_GROUPS: Record<LiveSport, PositionGroup[]> = {
  football: [
    { id: 'qb', label: 'Quarterbacks', positions: ['QB'], props: ['passYds', 'passTD', 'completions', 'passAtt', 'int', 'passRushYds', 'rushYds', 'rushAtt', 'rushTD', 'longRush', 'anyTD'], fantasy: true },
    { id: 'rb', label: 'Running backs', positions: ['RB', 'HB', 'FB'], props: ['rushYds', 'rushAtt', 'rushTD', 'longRush', 'rec', 'recYds', 'longRec', 'rushRecYds', 'anyTD'], fantasy: true },
    { id: 'wr', label: 'Wide receivers', positions: ['WR'], props: ['rec', 'recYds', 'recTD', 'longRec', 'rushRecYds', 'rushYds', 'anyTD'], fantasy: true },
    { id: 'te', label: 'Tight ends', positions: ['TE'], props: ['rec', 'recYds', 'recTD', 'longRec', 'rushRecYds', 'anyTD'], fantasy: true },
    { id: 'k', label: 'Kickers', positions: ['K', 'PK'], props: ['fgMade', 'kickPts'], fantasy: true },
    { id: 'def', label: 'Defense', positions: ['DE', 'DT', 'DL', 'NT', 'EDGE', 'LB', 'OLB', 'ILB', 'MLB', 'CB', 'DB', 'S', 'FS', 'SS'], props: ['tackles', 'sacks'], fantasy: false },
  ],
  basketball: [
    { id: 'g', label: 'Guards', positions: ['PG', 'SG', 'G'], props: PLAYER_PROPS.basketball.map((p) => p.id), fantasy: true },
    { id: 'f', label: 'Forwards', positions: ['SF', 'PF', 'F', 'GF', 'G-F', 'F-G'], props: PLAYER_PROPS.basketball.map((p) => p.id), fantasy: true },
    { id: 'c', label: 'Centers', positions: ['C', 'FC', 'F-C', 'C-F'], props: PLAYER_PROPS.basketball.map((p) => p.id), fantasy: true },
  ],
};

export function positionGroup(sport: LiveSport, position: string): PositionGroup | undefined {
  const p = position.trim().toUpperCase();
  return POSITION_GROUPS[sport].find((g) => g.positions.includes(p));
}

/** A roster grouped by position (in the groups' order), keeping only players with props (or fantasy points). */
export function groupRoster<T extends { position: string; name: string }>(sport: LiveSport, players: T[], purpose: 'bets' | 'fantasy'): { group: PositionGroup; players: T[] }[] {
  return POSITION_GROUPS[sport]
    .filter((g) => (purpose === 'fantasy' ? g.fantasy : g.props.length > 0))
    .map((group) => ({ group, players: players.filter((p) => group.positions.includes(p.position.trim().toUpperCase())) }))
    .filter((x) => x.players.length > 0);
}

/** The props offered for a player at this position (all of them when the position is unknown). */
export function propsForPosition(sport: LiveSport, position: string): PropDef[] {
  const g = positionGroup(sport, position);
  return g ? PLAYER_PROPS[sport].filter((p) => g.props.includes(p.id)) : PLAYER_PROPS[sport];
}

/** "74.5", "74,5", "-3.5" (typed on a TV keyboard) -> number. */
export function parseLine(text: string): number | undefined {
  const t = text.trim().replace(',', '.').replace(/[^\d.+-]/g, '');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}


// ---------------- Parlays ----------------

/** A parlay wins when every leg wins (pushed legs drop out), loses as soon as one leg loses. */
export function parlayStatus(legs: BetStatus[]): { status: BetStatus; hit: number; total: number } {
  const total = legs.length;
  const hit = legs.filter((s) => s === 'hit').length;
  const counted = legs.filter((s) => s !== 'push');
  if (legs.includes('lost')) return { status: 'lost', hit, total };
  if (counted.length === 0 && total > 0) return { status: 'push', hit, total };
  if (counted.length > 0 && counted.every((s) => s === 'hit')) return { status: 'hit', hit, total };
  return { status: legs.some((s) => s === 'live' || s === 'hit') ? 'live' : 'pending', hit, total };
}
