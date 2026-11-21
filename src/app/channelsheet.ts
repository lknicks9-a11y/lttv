/**
 * Builds the day's channel sheet (see core/channelsheet.ts) in the background and keeps it fresh:
 *   - at 3:00 AM Eastern, when the sports day changes (checked every few minutes; if the TV was off then, as soon as
 *     LTTV is open),
 *   - when the channels or the guide change (a new provider, a refreshed playlist or guide).
 * It works one game at a time and waits while you press buttons, so it never slows the screen down. The result is
 * saved on the device, so game pages open with their channels straight away.
 */
import { useEffect, useState } from 'preact/hooks';
import { getState, repo } from './state';
import { loadGames } from './schedule';
import { whenStill } from './nav';
import { SCHEDULE_LEAGUES, sportsDay, type Game } from '../core/schedule';
import { buildGameIndexAsync, teamOfSide } from '../core/streamfinder';
import { sheetForGame, type ChannelSheet, type SheetPick } from '../core/channelsheet';
import { rememberChannel, teamMemKey } from '../core/streammemory';

let sheet: ChannelSheet | null = null;
let building = false;
const listeners = new Set<() => void>();

const basisOf = () => {
  const s = getState();
  return `${s.lineup.length}|${s.guideVersion}|${s.lineup.filter((c) => c.epgChannelId).length}`;
};

/** The sheet's channels for a game (best first), when today's sheet has it. */
export function sheetFor(gameId: string): SheetPick[] | undefined {
  return sheet?.games[gameId];
}

/** Re-renders when the sheet is rebuilt. */
export function useChannelSheet(): ChannelSheet | null {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return sheet;
}

async function build() {
  if (building) return;
  const s = getState();
  if (!s.lineup.length) return;
  building = true;
  try {
    const day = sportsDay(Date.now());
    const games: { g: Game; sport: (typeof SCHEDULE_LEAGUES)[number]['sport'] }[] = [];
    for (const l of SCHEDULE_LEAGUES) {
      await whenStill();
      try {
        for (const g of await loadGames(l.id, day, day)) games.push({ g, sport: l.sport });
        // College football: FCS games too (the default list is FBS).
        if (l.id === 'cfb') for (const g of await loadGames(l.id, day, day, false, '81')) if (!games.some((x) => x.g.id === g.id)) games.push({ g, sport: l.sport });
      } catch {
        /* a league whose schedule didn't load: the rest still get their channels */
      }
    }
    if (!games.length) return;
    const { lineup, guide, guideVersion } = getState();
    const from = Math.min(...games.map((x) => x.g.start)) - 3600_000;
    const to = Math.max(...games.map((x) => x.g.start)) + 5 * 3600_000;
    const index = await buildGameIndexAsync(lineup, guide, from, to, guideVersion);
    const next: ChannelSheet = { day, builtAt: Date.now(), basis: basisOf(), games: {} };
    for (const { g, sport } of games) {
      await whenStill();
      try {
        const picks = sheetForGame(g, sport, lineup, guide, index);
        next.games[g.id] = picks;
        // Confirmed team channels are remembered by name (they're found again after switching providers).
        for (const p of picks) if (p.status === 'confirmed' && p.side) rememberChannel(teamMemKey(g.league, teamOfSide(g, p.side).name), { originalName: p.name });
      } catch {
        /* one odd game never stops the sheet */
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    sheet = next;
    await repo.setKv('channelSheet', next).catch(() => undefined);
    listeners.forEach((l) => l());
  } finally {
    building = false;
  }
}

/** Rebuild when it's a new sports day (3:00 AM) or the channels / guide changed. */
function check() {
  const day = sportsDay(Date.now());
  if (!sheet || sheet.day !== day || sheet.basis !== basisOf()) void build();
}

let started = false;
export function startChannelSheet() {
  if (started) return;
  started = true;
  void (async () => {
    const saved = await repo.getKv<ChannelSheet>('channelSheet').catch(() => undefined);
    if (saved?.games) sheet = saved;
    listeners.forEach((l) => l());
    // Give the app a minute to load its channels and guide first, then check every 5 minutes.
    setTimeout(check, 60_000);
    setInterval(check, 5 * 60_000);
  })();
}
