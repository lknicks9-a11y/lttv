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

export function summaryUrl(base: string, eventId: string): string {
  return `${base}/basketball/nba/summary?event=${encodeURIComponent(eventId)}`;
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
        headshot: str(obj(ath.headshot).href) || undefined,
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
