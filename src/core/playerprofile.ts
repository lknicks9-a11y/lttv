// An NBA player's page for LTTV League Pass: who he is, this season and career averages, awards, his recent games
// and every season, from the schedule source's athlete pages (shapes read from the live service, Nov 2026).
type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === 'object' ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const strs = (v: unknown) => arr(v).map(str);

export const ATHLETE_BASE = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes';
export const athleteUrls = (id: string, base = ATHLETE_BASE) => {
  const a = `${base}/${encodeURIComponent(id)}`;
  return { bio: a, overview: `${a}/overview`, gamelog: `${a}/gamelog`, seasons: `${a}/stats` };
};

export interface PlayerBio {
  name: string;
  jersey?: string;
  position?: string;
  team?: string;
  headshot?: string;
  /** Label → value, only the ones the source has (Height, Weight, Born, From, Draft, Experience). */
  facts: [string, string][];
}
export function parseBio(json: unknown): PlayerBio | null {
  const a = obj(obj(json).athlete);
  const name = str(a.displayName) || str(a.fullName);
  if (!name) return null;
  // The source writes birthdays day/month/year ("19/2/1995").
  const dob = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str(a.displayDOB));
  const born = dob ? `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(dob[2]) - 1] ?? ''} ${Number(dob[1])}, ${dob[3]}`.trim() : str(a.displayDOB);
  const facts: [string, string][] = [
    ['Height', str(a.displayHeight)], ['Weight', str(a.displayWeight)], ['Born', born ? `${born}${a.age ? ` (age ${str(a.age)})` : ''}` : ''],
    ['From', str(a.displayBirthPlace)], ['College', str(obj(a.college).name)], ['Draft', str(a.displayDraft)], ['Experience', str(a.displayExperience)],
  ];
  return {
    name,
    jersey: str(a.jersey) || undefined,
    position: str(obj(a.position).displayName) || undefined,
    team: str(obj(a.team).displayName) || undefined,
    headshot: str(obj(a.headshot).href) || undefined,
    facts: facts.filter(([, v]) => !!v),
  };
}

export interface StatLine {
  title: string;
  labels: string[];
  stats: string[];
}
export interface PlayerOverview {
  lines: StatLine[]; // "Regular Season", "Career"
  awards: { name: string; count: string }[];
}
export function parseOverview(json: unknown): PlayerOverview {
  const st = obj(obj(json).statistics);
  const labels = strs(st.labels);
  return {
    lines: arr(st.splits).map(obj).map((s) => ({ title: str(s.displayName), labels, stats: strs(s.stats) })).filter((l) => l.stats.length > 0),
    awards: arr(obj(json).awards).map(obj).map((a) => ({ name: str(a.name), count: str(a.displayCount) })).filter((a) => !!a.name),
  };
}

export interface GameRow {
  date: number;
  opp: string;
  at: boolean;
  result: string; // "W" / "L"
  score: string;
  stats: string[];
}
/** This season's games, newest first (regular season; the preseason only when there is nothing else yet). */
export function parseGamelog(json: unknown): { labels: string[]; games: GameRow[] } {
  const j = obj(json);
  const events = obj(j.events);
  const types = arr(j.seasonTypes).map(obj);
  const type = types.find((t) => /regular/i.test(str(t.displayName))) ?? types[0];
  const games: GameRow[] = [];
  for (const cat of arr(obj(type).categories).map(obj)) {
    for (const e of arr(cat.events).map(obj)) {
      const ev = obj(events[str(e.eventId)]);
      const date = Date.parse(str(ev.gameDate));
      if (!Number.isFinite(date)) continue;
      games.push({ date, opp: str(obj(ev.opponent).abbreviation), at: str(ev.atVs) === '@', result: str(ev.gameResult), score: str(ev.score), stats: strs(e.stats) });
    }
  }
  games.sort((a, b) => b.date - a.date);
  return { labels: strs(j.labels), games };
}

export interface SeasonRow {
  season: string;
  team: string;
  stats: string[];
}
/** Per-game averages for every season, and the career line. */
export function parseSeasons(json: unknown): { labels: string[]; seasons: SeasonRow[]; career: string[] } {
  const j = obj(json);
  const teams = obj(j.teams);
  const cat = arr(j.categories).map(obj).find((c) => str(c.name) === 'averages') ?? obj(arr(j.categories)[0]);
  const seasons = arr(cat.statistics).map(obj).map((s) => ({
    season: str(obj(s.season).displayName) || str(obj(s.season).year),
    team: str(obj(teams[str(s.teamSlug)]).abbreviation),
    stats: strs(s.stats),
  }));
  return { labels: strs(cat.labels), seasons, career: strs(cat.totals) };
}
