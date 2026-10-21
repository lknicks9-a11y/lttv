// Fantasy lineup and tracked props (Bets): stored on the device, followed live from ESPN's
// game summaries while their games are on, and announced with pop-ups in the bottom corner.
import { useEffect, useState } from 'preact/hooks';
import { betProgress, diffNotices, fantasyPoints, liveLeague, parlayStatus, parseRoster, parseSummary, type Bet, type BetStatus, type FantasyScoring, type LiveGame, type LiveLeague, type LiveNotice, type Parlay } from '../core/livestats';
import { isEventChannel } from '../core/events';
import { isUsableMatch } from '../core/match';
import { scheduleDay } from '../core/schedule';
import { openRemote } from './platform';
import { loadGames, scheduleBase } from './schedule';
import { repo, getState, player } from './state';

export interface FantasyPlayer {
  athleteId: string;
  name: string;
  league: LiveLeague;
  teamId: string;
  teamName: string;
  teamLogo?: string;
  position?: string;
  headshot?: string;
}

interface Saved {
  roster: FantasyPlayer[];
  bets: Bet[];
  parlays: Parlay[];
  scoring: FantasyScoring;
  notify: boolean;
}

const KV = 'liveSports';
let saved: Saved = { roster: [], bets: [], parlays: [], scoring: 'ppr', notify: true };
let loaded = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const s = await repo.getKv<Saved>(KV);
    if (s) saved = { ...saved, ...s, parlays: s.parlays ?? [] };
  } catch {
    /* start empty */
  }
  changed();
}

async function save(patch: Partial<Saved>) {
  saved = { ...saved, ...patch };
  changed();
  await repo.setKv(KV, saved).catch(() => undefined);
  kickPoller();
}

export function useLiveSports(): Saved & { games: Map<string, LiveGame> } {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((n) => n + 1);
    listeners.add(l);
    void ensureLoaded();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { ...saved, games };
}

export const addFantasyPlayer = (p: FantasyPlayer) => save({ roster: [...saved.roster.filter((x) => x.athleteId !== p.athleteId), p] });
export const removeFantasyPlayer = (id: string) => save({ roster: saved.roster.filter((x) => x.athleteId !== id) });
export const setScoring = (scoring: FantasyScoring) => save({ scoring });
export const setNotify = (notify: boolean) => save({ notify });
export const addBet = (b: Bet) => save({ bets: [...saved.bets, b] });
export const removeBet = (id: string) => save({ bets: saved.bets.filter((x) => x.id !== id) });
export const clearSettledBets = () => {
  const open = (b: Bet) => { const g = gameForTeam(b.league, b.teamId); return !g || g.state !== 'post'; };
  // A parlay goes when it's decided (all legs final, or one lost).
  const settledParlays = new Set(saved.parlays.filter((p) => { const st = parlayOf(p.id); return st.status === 'hit' || st.status === 'lost' || st.status === 'push'; }).map((p) => p.id));
  return save({ bets: saved.bets.filter((b) => (b.parlayId ? !settledParlays.has(b.parlayId) : open(b))), parlays: saved.parlays.filter((p) => !settledParlays.has(p.id)) });
};

/** Track several props together: wins only if every leg wins. */
export const addParlay = (legs: Bet[]) => {
  const id = 'p' + Math.random().toString(36).slice(2, 10);
  return save({ bets: [...saved.bets, ...legs.map((b) => ({ ...b, parlayId: id }))], parlays: [...(saved.parlays ?? []), { id, createdAt: Date.now() }] });
};
export const removeParlay = (id: string) => save({ bets: saved.bets.filter((b) => b.parlayId !== id), parlays: saved.parlays.filter((p) => p.id !== id) });

export function parlayLegs(id: string): Bet[] {
  return saved.bets.filter((b) => b.parlayId === id);
}

export function parlayOf(id: string): ReturnType<typeof parlayStatus> {
  return parlayStatus(parlayLegs(id).map((b) => betStatus(b).status as BetStatus));
}

// ---- Rosters (player picker) ----

const rosterCache = new Map<string, ReturnType<typeof parseRoster>>();

/** A team's players from ESPN (cached for the session). */
export async function loadRoster(league: LiveLeague, teamId: string) {
  const k = `${league}|${teamId}`;
  const hit = rosterCache.get(k);
  if (hit) return hit;
  const l = liveLeague(league)!;
  const { stream } = await openRemote(`${scheduleBase().replace(/\/+$/, '')}/${l.path}/teams/${teamId}/roster`, AbortSignal.timeout?.(20_000));
  const list = parseRoster(JSON.parse(await new Response(stream).text()));
  if (!list.length) throw new Error('No players listed');
  rosterCache.set(k, list);
  return list;
}

export function headshotUrl(league: LiveLeague, athleteId: string, given?: string): string | undefined {
  if (given) return given;
  const h = liveLeague(league)?.headshot;
  return h ? `https://a.espncdn.com/i/headshots/${h}/players/full/${athleteId}.png` : undefined;
}

// ---- Live following ----

/** Latest snapshot per game id. */
const games = new Map<string, LiveGame>();
/** Today's game id per league|team. */
const teamGame = new Map<string, string>();

export function gameForTeam(league: LiveLeague, teamId: string): LiveGame | undefined {
  const id = teamGame.get(`${league}|${teamId}`);
  return id ? games.get(id) : undefined;
}

export function fantasyTotal(league?: LiveLeague): number {
  let t = 0;
  for (const p of saved.roster) {
    if (league && p.league !== league) continue;
    const g = gameForTeam(p.league, p.teamId);
    const s = g?.players.get(p.athleteId)?.stats;
    if (s) t += fantasyPoints(s, liveLeague(p.league)!.sport, saved.scoring);
  }
  return Math.round(t * 100) / 100;
}

export function betStatus(b: Bet) {
  return betProgress(b, gameForTeam(b.league, b.teamId), liveLeague(b.league)!.sport);
}

// Pop-up queue.
const noticeListeners = new Set<(n: LiveNotice) => void>();
const seen = new Set<string>();
export function onLiveNotice(l: (n: LiveNotice) => void): () => void {
  noticeListeners.add(l);
  return () => noticeListeners.delete(l);
}
/** Pop-ups only while a sports channel / game is playing (not while browsing or watching other things). */
export function watchingSports(): boolean {
  const s = getState();
  if (s.multiview?.tiles.some(Boolean)) return true; // Multiview is sports
  if (s.vodPlaying || !s.currentKey || player.currentKey !== s.currentKey) return false;
  const ch = s.lineup.find((c) => c.key === s.currentKey);
  if (!ch) return false;
  if (ch.category === 'sports' || isEventChannel(ch)) return true;
  if (!isUsableMatch(s.matches.get(ch.key))) return false;
  const p = s.guide.current(ch.epgChannelId, Date.now());
  return !!p && (p.categories?.some((c) => /sport|football|basketball|baseball|hockey|soccer/i.test(c)) || /\s(vs\.?|at|@)\s/i.test(` ${p.title} ${p.subTitle ?? ''} `));
}

function announce(n: LiveNotice) {
  if (seen.has(n.key)) return;
  seen.add(n.key);
  if (seen.size > 2000) seen.clear();
  if (saved.notify && watchingSports()) noticeListeners.forEach((l) => l(n));
}

// Parlays: announce when another leg hits, and when the parlay is decided.
const parlayState = new Map<string, string>();
function parlayNotices() {
  for (const p of saved.parlays ?? []) {
    const legs = parlayLegs(p.id);
    if (!legs.length) continue;
    const st = parlayStatus(legs.map((b) => betStatus(b).status as BetStatus));
    const sig = `${st.hit}|${st.status}`;
    const before = parlayState.get(p.id);
    parlayState.set(p.id, sig);
    if (before === undefined || before === sig) continue;
    const decided = st.status === 'hit' || st.status === 'lost' || st.status === 'push';
    announce({
      key: `p|${p.id}|${sig}`,
      kind: 'parlay',
      title: decided ? (st.status === 'hit' ? `PARLAY HIT · ${st.total} legs` : st.status === 'push' ? 'Parlay pushed' : 'Parlay lost') : `Parlay: ${st.hit} of ${st.total} legs hit`,
      detail: legs.map((b) => `${betStatus(b).status === 'hit' ? '✓' : betStatus(b).status === 'lost' ? '✗' : '·'} ${b.athleteName ?? b.teamName}`).join('  '),
      logo: legs[0].teamLogo,
      tone: st.status === 'lost' ? 'bad' : st.status === 'hit' || !decided ? 'good' : 'info',
    });
  }
}

let timer: number | undefined;
let running = false;

/** Fetch every game today that involves a fantasy player or a tracked prop, and announce changes. */
export async function pollLive(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await ensureLoaded();
    const leagues = new Set<LiveLeague>([...saved.roster.map((p) => p.league), ...saved.bets.map((b) => b.league)]);
    const tz = getState().settings.timeZone;
    const today = scheduleDay(Date.now(), tz);
    let anyLive = false;
    for (const league of leagues) {
      const teams = new Set([...saved.roster.filter((p) => p.league === league).map((p) => p.teamId), ...saved.bets.filter((b) => b.league === league).map((b) => b.teamId)]);
      let list;
      try {
        list = await loadGames(league, today, today);
      } catch {
        continue;
      }
      for (const g of list) {
        if (!teams.has(g.home.id) && !teams.has(g.away.id)) continue;
        teamGame.set(`${league}|${g.home.id}`, g.id);
        teamGame.set(`${league}|${g.away.id}`, g.id);
        const prev = games.get(g.id);
        // Finished games are read once (final stats); upcoming ones aren't read yet.
        if (g.state === 'pre' || (g.state === 'post' && prev?.state === 'post')) continue;
        if (g.state === 'in') anyLive = true;
        try {
          const l = liveLeague(league)!;
          const { stream } = await openRemote(`${scheduleBase().replace(/\/+$/, '')}/${l.path}/summary?event=${g.id}`, AbortSignal.timeout?.(20_000));
          const next = parseSummary(JSON.parse(await new Response(stream).text()), l.sport, g.id);
          if (next.state === 'pre') next.state = g.state;
          games.set(g.id, next);
          const inGame = (teamId: string) => next.teams.some((t) => t.id === teamId);
          for (const n of diffNotices(prev, next, l.sport, {
            roster: saved.roster.filter((p) => p.league === league && inGame(p.teamId)).map((p) => ({ athleteId: p.athleteId, name: p.name, headshot: p.headshot })),
            bets: saved.bets.filter((b) => b.league === league && inGame(b.teamId)),
            scoring: saved.scoring,
            leagueHeadshot: l.headshot,
          })) announce(n);
          changed();
        } catch {
          /* try again next round */
        }
      }
    }
    parlayNotices();
    schedule(anyLive ? 30_000 : 5 * 60_000);
  } finally {
    running = false;
  }
}

function schedule(ms: number) {
  window.clearTimeout(timer);
  if (!saved.roster.length && !saved.bets.length) return;
  timer = window.setTimeout(() => void pollLive(), ms);
}

function kickPoller() {
  schedule(500);
}

/** Start following (called once at startup). */
export async function startLiveSports() {
  await ensureLoaded();
  kickPoller();
}
