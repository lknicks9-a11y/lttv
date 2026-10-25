// Phone remote, the computer's side: LTTV (desktop, served by the local helper) listens for commands the phone sends
// through the helper and carries them out — remote buttons, typing, watching a channel, filling Multiview tiles.
import { dispatchAppKey, type AppKey } from './nav';
import { native, serverCaps } from './platform';
import { getState, navigate, player, stopPlayback, tune, type Screen } from './state';
import { closeMultiview, openMultiview, setActiveTile, setLayout, setTile, type MvLayout } from './multiview';
import { loadGames } from './schedule';
import { scheduleDay, scheduleLeague, SCHEDULE_LEAGUES, type ScheduleLeagueId } from '../core/schedule';
import { bestStreams, buildGameIndexAsync } from '../core/streamfinder';
import { isUsableMatch } from '../core/match';
import type { LineupChannel } from '../core/types';

type Args = Record<string, unknown>;

let started = false;

/** Start listening for the phone (desktop only; the Fire TV app has its own phone setup). */
export function startRemoteBridge() {
  if (started || native) return;
  started = true;
  void serverCaps().then((c) => {
    if (!(c as { remote?: boolean }).remote || typeof EventSource === 'undefined') return;
    const es = new EventSource('api/remote/events');
    es.onmessage = (e) => void answer(e.data);
  });
}

async function answer(data: string) {
  let msg: { id: number; cmd: string; args: Args };
  try {
    msg = JSON.parse(data);
  } catch {
    return;
  }
  let reply: { id: number; ok: boolean; result?: unknown; error?: string };
  try {
    reply = { id: msg.id, ok: true, result: await run(msg.cmd, msg.args ?? {}) };
  } catch (e) {
    reply = { id: msg.id, ok: false, error: (e as Error).message };
  }
  await fetch('api/remote/reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(reply) }).catch(() => undefined);
}

const KEYS: Record<string, string> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', back: 'Escape' };
const APP_KEYS = new Set<AppKey>(['menu', 'playpause', 'chup', 'chdown', 'info', 'guide', 'ffwd', 'rewind']);
const SCREENS = new Set<Screen>(['home', 'sports', 'movies', 'shows', 'channels', 'search', 'sources', 'settings']);

async function run(cmd: string, a: Args): Promise<unknown> {
  switch (cmd) {
    case 'key':
      return pressKey(String(a.key));
    case 'text':
      return typeText(String(a.text ?? ''));
    case 'state':
      return snapshot();
    case 'search':
      return searchChannels(String(a.q ?? ''));
    case 'sportsNow':
      return sportsNow();
    case 'games':
      return games(String(a.league ?? 'nfl') as ScheduleLeagueId);
    case 'tune':
      if (getState().multiview) closeMultiview();
      await tune(String(a.key), { fullscreen: true });
      return snapshot();
    case 'stop':
      stopPlayback();
      return snapshot();
    case 'navigate':
      if (!SCREENS.has(a.screen as Screen)) throw new Error('Unknown screen');
      if (getState().multiview) closeMultiview();
      getState().fullscreen && setFullscreenOff();
      navigate(a.screen as Screen);
      return snapshot();
    case 'mvOpen':
      if (!getState().multiview) openMultiview();
      return snapshot();
    case 'mvSet': {
      const i = tileIndex(a.tile);
      const ch = channel(String(a.key));
      if (!getState().multiview) openMultiview();
      setTile(i, { key: ch.key, title: String(a.title || ch.name) });
      // The sound goes to this game when the game that had it is empty.
      const mv = getState().multiview;
      if (mv && !mv.tiles[mv.active]) setActiveTile(i);
      return snapshot();
    }
    case 'mvSound':
      setActiveTile(tileIndex(a.tile));
      return snapshot();
    case 'mvLayout': {
      const n = Number(a.n);
      if (n !== 2 && n !== 3 && n !== 4) throw new Error('Layout must be 2, 3 or 4');
      if (!getState().multiview) openMultiview();
      setLayout(n as MvLayout);
      return snapshot();
    }
    case 'mvFull':
      closeMultiview(tileIndex(a.tile));
      return snapshot();
    case 'mvClose':
      closeMultiview();
      return snapshot();
  }
  throw new Error('Unknown command');
}

function setFullscreenOff() {
  // Back once leaves the full-screen player the same way the remote's Back does.
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

function tileIndex(v: unknown): number {
  const i = Number(v);
  if (!Number.isInteger(i) || i < 0 || i > 3) throw new Error('Tile must be 0–3');
  return i;
}

function channel(key: string): LineupChannel {
  const ch = getState().lineup.find((c) => c.key === key);
  if (!ch) throw new Error('That channel isn’t in the lineup any more.');
  return ch;
}

function pressKey(k: string) {
  if (k === 'ok') {
    const el = document.activeElement as HTMLElement | null;
    if (el && el !== document.body) el.click();
    else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  }
  if (KEYS[k]) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: KEYS[k], bubbles: true }));
    return true;
  }
  if (APP_KEYS.has(k as AppKey)) return dispatchAppKey(k as AppKey);
  throw new Error('Unknown key');
}

/** Type into the text field that has focus (search boxes, playlist URLs…). */
function typeText(text: string) {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el || !('value' in el) || !/^(INPUT|TEXTAREA)$/.test(el.tagName)) throw new Error('Select a text box on the TV first.');
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

function nowOn(c: LineupChannel): string | undefined {
  const s = getState();
  if (!c.epgChannelId || !isUsableMatch(s.matches.get(c.key))) return undefined;
  return s.guide.current(c.epgChannelId, Date.now())?.title;
}

function chInfo(c: LineupChannel) {
  return { key: c.key, name: c.name, number: c.number, logo: c.logo, now: nowOn(c) };
}

function snapshot() {
  const s = getState();
  const cur = player.currentKey ? s.lineup.find((c) => c.key === player.currentKey) : undefined;
  const mv = s.multiview;
  return {
    screen: s.screen,
    fullscreen: !!s.fullscreen,
    playing: cur ? { ...chInfo(cur), state: player.status.state } : null,
    multiview: mv ? { layout: mv.layout, active: mv.active, tiles: mv.tiles.map((t) => (t ? { key: t.key, title: t.title } : null)) } : null,
    channels: s.lineup.length,
  };
}

function searchChannels(q: string) {
  const s = getState();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const num = /^\d+$/.test(q.trim()) ? Number(q.trim()) : undefined;
  return s.lineup
    .filter((c) => !c.hidden && (num !== undefined ? c.number === num || String(c.number).startsWith(q.trim()) : words.every((w) => c.name.toLowerCase().includes(w))))
    .slice(0, 60)
    .map(chInfo);
}

function sportsNow() {
  return getState().lineup
    .filter((c) => !c.hidden && c.category === 'sports')
    .map((c) => ({ c, now: nowOn(c) }))
    .filter((x) => x.now)
    .slice(0, 60)
    .map(({ c }) => chInfo(c));
}

async function games(leagueId: ScheduleLeagueId) {
  const league = scheduleLeague(leagueId);
  if (!league) throw new Error('Unknown league');
  const s = getState();
  const today = scheduleDay(Date.now(), s.settings.timeZone);
  const list = await loadGames(leagueId, today, today);
  if (!list.length) return { leagues: leagueList(), games: [] };
  const from = Math.min(...list.map((g) => g.start)) - 3600_000;
  const to = Math.max(...list.map((g) => g.start)) + 5 * 3600_000;
  const index = await buildGameIndexAsync(s.lineup, s.guide, from, to, s.guideVersion);
  return {
    leagues: leagueList(),
    games: list.map((g) => ({
      id: g.id,
      title: `${g.away.short} at ${g.home.short}`,
      away: { name: g.away.short, score: g.away.score, logo: g.away.logo },
      home: { name: g.home.short, score: g.home.score, logo: g.home.logo },
      state: g.state,
      detail: g.detail,
      start: g.start,
      streams: bestStreams(g, s.lineup, league.sport, index).slice(0, 6).map((p) => ({ ...chInfo(p.ch), reason: p.reason })),
    })),
  };
}

function leagueList() {
  return SCHEDULE_LEAGUES.map((l) => ({ id: l.id, name: l.tab }));
}
