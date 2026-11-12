// A game's box score from the schedule source's game summary: each team's players with PTS / REB / AST / BLK,
// starters first. Used by LTTV League Pass.
export interface BoxPlayer {
  /** The player's id at the schedule source (opens his page). */
  id?: string;
  name: string;
  jersey?: string;
  headshot?: string;
  starter: boolean;
  dnp: boolean;
  pts: string;
  reb: string;
  ast: string;
  blk: string;
}
export interface BoxTeam {
  abbr: string;
  name: string;
  players: BoxPlayer[];
}

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === 'object' ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** The source's headshots are 600 px wide; a box score row shows them at ~35 px. Ask its image service for a small one
 *  (26 full-size photos made a Fire TV Stick crawl). */
export function smallHeadshot(href: string): string {
  const m = /^https:\/\/a\.espncdn\.com(\/i\/headshots\/[^?]+)$/.exec(href);
  return m ? `https://a.espncdn.com/combiner/i?img=${m[1]}&w=96&h=70` : href;
}

export function summaryUrl(base: string, eventId: string, path = 'basketball/nba'): string {
  return `${base}/${path}/summary?event=${encodeURIComponent(eventId)}`;
}

export function parseBoxScore(json: unknown): BoxTeam[] {
  const out: BoxTeam[] = [];
  for (const t of arr(obj(obj(json).boxscore).players).map(obj)) {
    const team = obj(t.team);
    const group = obj(arr(t.statistics)[0]);
    const labels = arr(group.labels ?? group.names).map((l) => str(l).toUpperCase());
    const col = (name: string) => labels.indexOf(name);
    const players: BoxPlayer[] = arr(group.athletes).map(obj).map((a) => {
      const ath = obj(a.athlete);
      const stats = arr(a.stats).map(str);
      const at = (n: string) => (col(n) >= 0 ? stats[col(n)] ?? '' : '');
      return {
        id: str(ath.id) || undefined,
        name: str(ath.shortName) || str(ath.displayName),
        jersey: str(ath.jersey) || undefined,
        headshot: smallHeadshot(str(obj(ath.headshot).href)) || undefined,
        starter: a.starter === true,
        dnp: a.didNotPlay === true || !stats.length,
        pts: at('PTS') || '0',
        reb: at('REB') || '0',
        ast: at('AST') || '0',
        blk: at('BLK') || '0',
      };
    });
    players.sort((a, b) => Number(b.starter) - Number(a.starter) || Number(a.dnp) - Number(b.dnp) || Number(b.pts) - Number(a.pts));
    out.push({ abbr: str(team.abbreviation), name: str(team.shortDisplayName) || str(team.displayName), players });
  }
  return out;
}

// ---------------------------------------------------------------------------
// NFL (LTTV Blitz): each team's passing, rushing and receiving lines. Shape read from the live service (Nov 2026):
// boxscore.players[].statistics[] = { name: 'passing', labels: ['C/ATT','YDS',…], athletes: [{ athlete, stats }] }.
export interface StatGroup {
  title: string;
  head: string[];
  rows: { id?: string; name: string; jersey?: string; headshot?: string; cells: string[] }[];
}
export interface StatTeam {
  abbr: string;
  name: string;
  groups: StatGroup[];
}
const NFL_GROUPS: [string, string, string[], number][] = [
  ['passing', 'Passing', ['C/ATT', 'YDS', 'TD', 'INT'], 2],
  ['rushing', 'Rushing', ['CAR', 'YDS', 'TD'], 4],
  ['receiving', 'Receiving', ['REC', 'YDS', 'TD'], 6],
];
export function parseNflBox(json: unknown): StatTeam[] {
  return arr(obj(obj(json).boxscore).players).map(obj).map((t) => {
    const team = obj(t.team);
    const cats = arr(t.statistics).map(obj);
    const groups: StatGroup[] = [];
    for (const [name, title, cols, max] of NFL_GROUPS) {
      const c = cats.find((x) => str(x.name) === name);
      const labels = arr(c?.labels).map((l) => str(l).toUpperCase());
      const rows = arr(c?.athletes).map(obj).slice(0, max).map((a) => {
        const ath = obj(a.athlete);
        const stats = arr(a.stats).map(str);
        return { id: str(ath.id) || undefined, name: str(ath.shortName) || str(ath.displayName), jersey: str(ath.jersey) || undefined, headshot: smallHeadshot(str(obj(ath.headshot).href)) || undefined, cells: cols.map((k) => stats[labels.indexOf(k)] ?? '') };
      });
      if (rows.length) groups.push({ title, head: cols, rows });
    }
    return { abbr: str(team.abbreviation), name: str(team.shortDisplayName) || str(team.displayName), groups };
  });
}
