// Loads today's games per league (cached), and remembers team logos so the
// My Teams cards can show them too.
import { useEffect, useState } from 'preact/hooks';
import { ESPN_BASE, LEAGUE_LOGO_FALLBACK, SCHEDULE_LEAGUES, TEAM_DIRECTORY, parseLeagueLogo, parseScoreboard, parseStandingsTeams, parseTeams, scheduleDay, standingsUrl, scheduleLeague, scoreboardUrl, teamsUrl, type DirTeam, type Game, type ScheduleLeagueId } from '../core/schedule';
import { openRemote } from './platform';

interface Entry {
  at: number;
  games: Game[];
}

const cache = new Map<string, Entry>();
const leagueLogos = new Map<string, string>();

/** League logo learned from its scoreboard. */
export function leagueLogo(id: ScheduleLeagueId): string | undefined {
  return leagueLogos.get(id) ?? LEAGUE_LOGO_FALLBACK[id];
}
const inflight = new Map<string, Promise<Game[]>>();

/** Schedule server; tests point this at a local mock. */
export function scheduleBase(): string {
  try {
    return localStorage.getItem('lttvScheduleBase') || ESPN_BASE;
  } catch {
    return ESPN_BASE;
  }
}

const LOGO_KEY = 'lttvTeamLogos';
let logos: Record<string, string> | null = null;
const foldName = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function logoStore(): Record<string, string> {
  if (logos) return logos;
  try {
    logos = JSON.parse(localStorage.getItem(LOGO_KEY) || '{}') as Record<string, string>;
  } catch {
    logos = {};
  }
  return logos;
}

function learnLogos(games: Game[]) {
  const store = logoStore();
  let changed = false;
  for (const g of games) for (const t of [g.home, g.away]) {
    if (!t.logo) continue;
    const k = foldName(t.name);
    if (store[k] !== t.logo) {
      store[k] = t.logo;
      changed = true;
    }
  }
  if (changed) {
    try {
      localStorage.setItem(LOGO_KEY, JSON.stringify(store));
    } catch {
      /* storage full or blocked: logos just won't be remembered */
    }
  }
}

/** Logo learned from the schedule for a team name ("New York Yankees"). */
export function logoFor(name: string): string | undefined {
  return logoStore()[foldName(name)];
}

function ttl(games: Game[], day: string, today: string): number {
  if (day !== today) return 30 * 60_000;
  return games.some((g) => g.state === 'in') ? 45_000 : 5 * 60_000;
}

export async function loadGames(leagueId: ScheduleLeagueId, day: string, today: string, force = false): Promise<Game[]> {
  const league = scheduleLeague(leagueId)!;
  const k = `${leagueId}|${day}`;
  const hit = cache.get(k);
  if (hit && !force && Date.now() - hit.at < ttl(hit.games, day, today)) return hit.games;
  const running = inflight.get(k);
  if (running) return running;
  const p = (async () => {
    const { stream } = await openRemote(scoreboardUrl(league, day, scheduleBase()), AbortSignal.timeout?.(20_000));
    const json = JSON.parse(await new Response(stream).text());
    const games = parseScoreboard(json, leagueId);
    const logo = parseLeagueLogo(json);
    if (logo) leagueLogos.set(leagueId, logo);
    cache.set(k, { at: Date.now(), games });
    learnLogos(games);
    return games;
  })();
  inflight.set(k, p);
  try {
    return await p;
  } finally {
    inflight.delete(k);
  }
}

/** Games for a league/day, refreshed while live games are on. */
export function useGames(leagueId: ScheduleLeagueId, day: string, today: string): { games: Game[]; loading: boolean; error?: string; reload: () => void } {
  const [state, setState] = useState<{ games: Game[]; loading: boolean; error?: string }>(() => ({ games: cache.get(`${leagueId}|${day}`)?.games ?? [], loading: true }));
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ games: cache.get(`${leagueId}|${day}`)?.games ?? (s.games.length && s.games[0]?.league === leagueId ? s.games : []), loading: true }));
    loadGames(leagueId, day, today, tick > 0)
      .then((games) => alive && setState({ games, loading: false }))
      .catch((e: Error) => alive && setState((s) => ({ games: s.games, loading: false, error: e.message || 'Could not load the schedule.' })));
    return () => {
      alive = false;
    };
  }, [leagueId, day, tick]);
  // Keep scores fresh while games are live today.
  useEffect(() => {
    if (day !== today) return;
    const live = state.games.some((g) => g.state === 'in');
    const t = setInterval(() => setTick((x) => x + 1), live ? 60_000 : 5 * 60_000);
    return () => clearInterval(t);
  }, [leagueId, day, today, state.games]);
  return { ...state, reload: () => setTick((x) => x + 1) };
}

export interface LeagueSummary {
  games: number;
  live: number;
  loading: boolean;
  error?: boolean;
}

/** Today's game counts for every league (for the league picker). */
export function useLeagueSummaries(day: string): Record<string, LeagueSummary> {
  const [sum, setSum] = useState<Record<string, LeagueSummary>>(() => Object.fromEntries(SCHEDULE_LEAGUES.map((l) => [l.id, { games: 0, live: 0, loading: true }])));
  useEffect(() => {
    let alive = true;
    // Two leagues at a time, with a breather in between, so a TV stays responsive while
    // the schedules (college ones are big) download and are read.
    const queue = [...SCHEDULE_LEAGUES];
    const worker = async () => {
      while (alive && queue.length) {
        const l = queue.shift()!;
        try {
          const g = await loadGames(l.id, day, day);
          if (alive) setSum((s) => ({ ...s, [l.id]: { games: g.length, live: g.filter((x) => x.state === 'in').length, loading: false } }));
        } catch {
          if (alive) setSum((s) => ({ ...s, [l.id]: { games: 0, live: 0, loading: false, error: true } }));
        }
        await new Promise((r) => setTimeout(r, 120));
      }
    };
    void worker();
    void worker();
    return () => {
      alive = false;
    };
  }, [day]);
  return sum;
}

// ---- Team lists for the team picker (all teams of a league, with logos) ----

const DIR_KEY = 'lttvTeamDir2:';
const dirMem = new Map<string, DirTeam[]>();

/** All teams of a league with logos, from ESPN (kept for a week). */
export async function loadLeagueTeams(id: string): Promise<DirTeam[]> {
  const hit = dirMem.get(id);
  if (hit) return hit;
  try {
    const saved = JSON.parse(localStorage.getItem(DIR_KEY + id) || 'null') as { at: number; teams: DirTeam[] } | null;
    if (saved && Date.now() - saved.at < 7 * 86400_000 && saved.teams.length) {
      dirMem.set(id, saved.teams);
      return saved.teams;
    }
  } catch {
    /* fetch below */
  }
  const dir = TEAM_DIRECTORY.find((d) => d.id === id);
  if (!dir) return [];
  let teams: DirTeam[] = [];
  if (dir.groups) {
    // College: only the divisions that matter (FBS + FCS / Division I), from ESPN's standings.
    for (const g of dir.groups) {
      try {
        const { stream } = await openRemote(standingsUrl(dir.path, g, scheduleBase()), AbortSignal.timeout?.(20_000));
        for (const t of parseStandingsTeams(JSON.parse(await new Response(stream).text()), id)) if (!teams.some((x) => x.espnId === t.espnId)) teams.push(t);
      } catch {
        /* fall back to the full list below */
      }
    }
    teams.sort((a, b) => a.name.localeCompare(b.name));
  }
  if (!teams.length) {
    const { stream } = await openRemote(teamsUrl(dir.path, scheduleBase()), AbortSignal.timeout?.(20_000));
    teams = parseTeams(JSON.parse(await new Response(stream).text()), id);
  }
  if (!teams.length) throw new Error('No teams listed');
  dirMem.set(id, teams);
  const store = logoStore();
  for (const t of teams) if (t.logo) store[foldName(t.name)] = t.logo;
  try {
    localStorage.setItem(LOGO_KEY, JSON.stringify(store));
    localStorage.setItem(DIR_KEY + id, JSON.stringify({ at: Date.now(), teams }));
  } catch {
    /* not remembered */
  }
  return teams;
}

export function useLeagueTeams(id: string): { teams: DirTeam[] | null; loading: boolean } {
  const [st, setSt] = useState<{ id: string; teams: DirTeam[] | null; loading: boolean }>({ id, teams: dirMem.get(id) ?? null, loading: !dirMem.has(id) });
  useEffect(() => {
    let alive = true;
    setSt({ id, teams: dirMem.get(id) ?? null, loading: !dirMem.has(id) });
    loadLeagueTeams(id)
      .then((teams) => alive && setSt({ id, teams, loading: false }))
      .catch(() => alive && setSt({ id, teams: null, loading: false }));
    return () => {
      alive = false;
    };
  }, [id]);
  return st.id === id ? { teams: st.teams, loading: st.loading } : { teams: dirMem.get(id) ?? null, loading: true };
}

/** Games in progress right now in these leagues (refreshed every 2 minutes); undefined until loaded. Leagues whose scoreboard couldn't load are listed in `failed`. */
export function useLiveGames(leagues: ScheduleLeagueId[], tz?: string): (Game[] & { failed?: Set<string> }) | undefined {
  const [games, setGames] = useState<(Game[] & { failed?: Set<string> }) | undefined>(undefined);
  const key = [...new Set(leagues)].sort().join(',');
  useEffect(() => {
    if (!key) {
      setGames([]);
      return;
    }
    let alive = true;
    const load = async () => {
      const day = scheduleDay(Date.now(), tz);
      const out: Game[] & { failed?: Set<string> } = [];
      out.failed = new Set();
      for (const id of key.split(',') as ScheduleLeagueId[]) {
        try {
          out.push(...(await loadGames(id, day, day, true)).filter((g) => g.state === 'in'));
        } catch {
          out.failed.add(id); // scoreboard unavailable: the guide decides
        }
      }
      if (alive) setGames(out);
    };
    void load();
    const t = setInterval(() => void load(), 120_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [key]);
  return games;
}
