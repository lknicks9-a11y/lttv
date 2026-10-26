// Keeps each game's channels current: when the schedule rolls over to a new day, today's games and the channels
// carrying them are fetched fresh from the schedule source (ESPN lists each game's national and home/away local
// TV), and the playlists are refreshed so the provider's event channels for today are in. One hour before each
// game, its channels are fetched again (in case they changed) and its best streams are checked so dead ones drop
// out of the game's stream list.
import { SCHEDULE_LEAGUES, scheduleDay, scheduleLeague, type Game, type ScheduleLeagueId } from '../core/schedule';
import { bestStreams, buildGameIndexAsync, capStreams } from '../core/streamfinder';
import { loadGames } from './schedule';
import { canCheck, checkStream } from './streamcheck';
import { getState, refreshAll, reloadAll } from './state';

const BEFORE_MS = 60 * 60_000;
const CHECK_TOP = 8;
let day = '';
let lastPlan = 0;
const prechecked = new Set<string>();
const timers = new Map<string, number>();

const today = () => scheduleDay(Date.now(), getState().settings.timeZone);

async function forEachLeague(dayStr: string, force: boolean, fn: (league: ScheduleLeagueId, games: Game[]) => void) {
  for (const l of SCHEDULE_LEAGUES) {
    try {
      fn(l.id, await loadGames(l.id, dayStr, dayStr, force));
    } catch {
      /* that league's schedule is unavailable right now */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** One hour before a game: its channels again from the source, then its top streams checked. */
async function precheck(league: ScheduleLeagueId, gameId: string) {
  if (prechecked.has(gameId)) return;
  prechecked.add(gameId);
  timers.delete(gameId);
  try {
    const d = today();
    const game = (await loadGames(league, d, d, true)).find((g) => g.id === gameId);
    if (!game || game.state !== 'pre') return;
    const s = getState();
    if (!s.lineup.length) return;
    const index = await buildGameIndexAsync(s.lineup, s.guide, game.start - BEFORE_MS, game.start + 5 * 3600_000, s.guideVersion);
    const sport = scheduleLeague(league)!.sport;
    for (const p of capStreams(bestStreams(game, s.lineup, sport, index)).slice(0, CHECK_TOP)) {
      if (!canCheck(p.ch)) continue; // never knock out something playing
      await checkStream(p.ch);
    }
  } catch {
    /* try again next time the game is opened */
  }
}

function plan(league: ScheduleLeagueId, games: Game[]) {
  for (const g of games) {
    if (g.state !== 'pre' || prechecked.has(g.id) || timers.has(g.id)) continue;
    const wait = g.start - BEFORE_MS - Date.now();
    if (wait <= 0) {
      if (g.start > Date.now()) void precheck(league, g.id); // within the hour already (e.g. the TV just woke up)
      continue;
    }
    if (wait > 20 * 3600_000) continue;
    timers.set(g.id, window.setTimeout(() => void precheck(league, g.id), wait));
  }
}

async function tick() {
  const d = today();
  if (d !== day) {
    const first = !day;
    day = d;
    prechecked.clear();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    // New day: playlists again (today's event channels), unless the app just started and loaded them.
    if (!first) {
      try {
        await refreshAll();
        await reloadAll();
      } catch {
        /* keeps yesterday's channels */
      }
    }
    await forEachLeague(d, !first, plan);
    lastPlan = Date.now();
    return;
  }
  // Same day, every half hour: pick up games added since, and timers lost while the TV slept.
  if (Date.now() - lastPlan < 30 * 60_000) return;
  lastPlan = Date.now();
  await forEachLeague(d, false, plan);
}

let started = false;
export function startGameWatch() {
  if (started) return;
  started = true;
  // After startup has settled; then every 10 minutes (catches midnight and a TV waking from sleep).
  window.setTimeout(() => void tick(), 60_000);
  window.setInterval(() => void tick(), 10 * 60_000);
}
