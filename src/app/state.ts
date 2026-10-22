import { accountKey, currentDbName } from './accounts';
import { useEffect, useRef, useState } from 'preact/hooks';
import type {
  ChannelCustomization, EpgSource, LineupChannel, MatchResult, PlaylistSource, Programme, RecentEntry, Reminder, Settings,
} from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';
import { Repo } from '../core/storage';
import { IdbBackend } from '../core/idb';
import { loadMatches, loadSources, type LoadedData } from '../core/pipeline';
import { buildLineup, setProviderOrder, sortLineup } from '../core/organize';
import { GuideIndex } from '../core/guide';
import { isUsableMatch } from '../core/match';
import { importEpg, importPlaylist, pruneGuide, rematch, matchMissingChannels, type InputSource, type JobProgress } from './importer';
import { PlayerController } from './player';
import { redactUrl, uid } from '../core/util';
import { CLIENT_IDENTITIES, isClientRejection, xtreamUrls, type XtreamLogin } from '../core/xtream';
import { loadXtreamPlaylist } from './xtream-login';
import { FetchError, native } from './platform';
import { applyGuideExtras, foreignNear, providerRef } from '../core/extras';
import { expectsEnglish } from '../core/lang';
import { guideIsStation, nyCallSign } from '../core/mytv';
import { normalizeForMatch } from '../core/normalize';
import { splitEpgRef } from '../core/match';
import { setHqLogos } from '../core/logos';
import { isEventChannel } from '../core/events';
import { addProviderProgrammes, initProviderGuide, wantProviderGuide } from './provider-guide';
import { guessKind } from './player';
import { xtreamAlternates } from '../core/xtream';


/** A game a Multiview tile shows (league + ESPN game id + schedule day). */
export interface MultiviewGame {
  league: import('../core/schedule').ScheduleLeagueId;
  id: string;
  day: string;
}

export type Screen = 'home' | 'guide' | 'sports' | 'movies' | 'shows' | 'channels' | 'search' | 'sources' | 'settings' | 'matches' | 'wizard';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

export interface Task {
  id: string;
  label: string;
  progress?: JobProgress;
  error?: string;
  done?: boolean;
}

export interface AppState {
  ready: boolean;
  settings: Settings;
  playlists: PlaylistSource[];
  epgSources: EpgSource[];
  lineup: LineupChannel[]; // all channels (including hidden), sorted by settings.sortMode
  matches: Map<string, MatchResult>;
  customizations: Map<string, ChannelCustomization>;
  guide: GuideIndex;
  guideVersion: number;
  recents: RecentEntry[];
  now: number;
  screen: Screen;
  screenStack: Screen[];
  currentKey?: string;
  fullscreen: boolean;
  /** Sports Multiview (up to four games at once). */
  multiview?: import('./multiview').MultiviewState;
  /** "Who's watching?" account picker is showing. */
  accountPicker?: boolean;
  /** Which on-demand screens exist (the playlists have movies / shows). */
  vodAvail?: { movies: boolean; shows: boolean };
  /** The movie / episode playing full screen. */
  vodPlaying?: import('./vod').VodPlay;
  toasts: Toast[];
  tasks: Task[];
  detail?: { channelKey: string; programme?: Programme };
  channelMenu?: string; // key of channel whose action sheet is open
  epgChannelNames: Map<string, string>; // ref -> display name (for match review)
  reminders: Reminder[];
  /** What startup is doing (shown if loading takes a while). */
  loadingPhase?: string;
  /** A reminder whose programme is starting now (shown as a prompt). */
  reminderDue?: Reminder;
}

// ---------------------------------------------------------------------------
// tiny store

type Listener = () => void;
let state: AppState = {
  ready: false,
  settings: DEFAULT_SETTINGS,
  playlists: [],
  epgSources: [],
  lineup: [],
  matches: new Map(),
  customizations: new Map(),
  guide: new GuideIndex(),
  guideVersion: 0,
  recents: [],
  now: Date.now(),
  screen: 'home',
  screenStack: [],
  fullscreen: false,
  toasts: [],
  tasks: [],
  epgChannelNames: new Map(),
  reminders: [],
};
const listeners = new Set<Listener>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  for (const l of listeners) l();
}

/** Called after every state change (outside components). */
export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Subscribe a component to a slice of state. Re-renders only when the slice changes (===). */
export function useApp<T>(sel: (s: AppState) => T): T {
  const selRef = useRef(sel);
  selRef.current = sel;
  const [value, setValue] = useState(() => sel(state));
  useEffect(() => {
    const l = () => setValue(() => selRef.current(state));
    listeners.add(l);
    l();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return sel(state) === value ? value : sel(state);
}

// ---------------------------------------------------------------------------

export const repo = new Repo(new IdbBackend(currentDbName()));
export const player = new PlayerController(() => state.settings);
let lastData: LoadedData | null = null;
/** Matches as stored (user decisions + automatic matching), before guide extras. */
let rawMatches = new Map<string, MatchResult>();
/** Lineup built from stored data, before guide extras (rebuilt only when its inputs change). */
let baseLineup: LineupChannel[] = [];

let toastSeq = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 4500) {
  const id = ++toastSeq;
  setState((s) => ({ toasts: [...s.toasts, { id, text, kind }].slice(-4) }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

const setTaskRaw = (t: Task) => setTask(t);
const endTaskRaw = (id: string, delay?: number) => endTask(id, delay);
function setTask(t: Task) {
  setState((s) => {
    const others = s.tasks.filter((x) => x.id !== t.id);
    return { tasks: [...others, t] };
  });
}
function endTask(id: string, delay = 2500) {
  setTimeout(() => setState((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })), delay);
}

// ---------------------------------------------------------------------------
// Navigation

export function navigate(screen: Screen, opts: { replace?: boolean } = {}) {
  setState((s) => {
    if (s.screen === screen) return {};
    const stack = opts.replace ? s.screenStack : [...s.screenStack, s.screen].slice(-10);
    return { screen, screenStack: stack, fullscreen: false };
  });
}

/** Back from the current screen. Returns false if already at the root. */
export function screenBack(): boolean {
  const s = state;
  if (s.fullscreen) {
    setState({ fullscreen: false });
    return true;
  }
  if (!s.screenStack.length) {
    if (s.screen !== 'home') {
      setState({ screen: 'home' });
      return true;
    }
    return false;
  }
  const prev = s.screenStack[s.screenStack.length - 1];
  setState({ screen: prev, screenStack: s.screenStack.slice(0, -1) });
  return true;
}

// ---------------------------------------------------------------------------
// Loading & derived data

function rebuildLineup(data: LoadedData, matches: Map<string, MatchResult>, customizations: Map<string, ChannelCustomization>, settings: Settings, recents: RecentEntry[]) {
  const uas = new Map(data.playlists.filter((p) => p.userAgent).map((p) => [p.id, p.userAgent!]));
  setProviderOrder(data.playlists.map((p) => p.id));
  const lineup = buildLineup({ channels: data.channels, customizations, matches, playlistOrder: data.playlists.map((p) => p.id), playlistUserAgents: uas, myTvNumbers: settings.sortMode === 'mytv', epgNames: epgNamesOf(data), myTvPins: settings.myTvPins });
  return sortLineup(lineup, settings.sortMode, recents);
}

/**
 * Layer the provider's per-channel guide and games from event-channel names on top
 * of the stored matches. Mutates `guide` (adds those programmes) and returns what
 * the screens should show.
 */
function withExtras(guide: GuideIndex, settings: Settings) {
  addProviderProgrammes(guide);
  const x = applyGuideExtras(baseLineup, rawMatches, guide, {
    now: Date.now(),
    timeZone: settings.timeZone,
    eventNames: settings.liveEventNames !== false,
    providerGuide: settings.providerGuide !== false,
    preferEnglish: settings.preferEnglish !== false,
    englishAlt,
    stationAlt,
  });
  return { lineup: x.lineup, matches: x.matches };
}

/** English channels whose matched guide is in another script -> an English guide channel for them. */
let englishAlt = new Map<string, string>();

/**
 * For English channels whose guide text is in another script (e.g. Arabic titles on
 * MeTV), look for the same channel in English among the other guide channels: the same
 * id in another guide source, the match's other candidates, or a guide channel with the
 * same name. Their programmes are loaded into `g`.
 */
async function findEnglishAlternates(g: GuideIndex): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (state.settings.preferEnglish === false || !lastData) return out;
  const now = Date.now();
  const need = baseLineup.filter((c) => expectsEnglish(c) && isUsableMatch(rawMatches.get(c.key)) && g.has(c.epgChannelId) && foreignNear(g, c.epgChannelId!, now));
  if (!need.length) return out;
  const byId = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const a = m.get(k);
    if (a) a.push(v);
    else m.set(k, [v]);
  };
  for (const e of lastData.epgChannels) {
    const ref = `${e.sourceId}|${e.id}`;
    push(byId, e.id.toLowerCase(), ref);
    for (const n of e.displayNames) {
      const k = normalizeForMatch(n);
      if (k) push(byName, k, ref);
    }
  }
  const wanted = new Map<string, string[]>();
  for (const c of need) {
    const m = rawMatches.get(c.key)!;
    const cur = m.epgChannelId!;
    const opts = new Set<string>([
      ...(byId.get(splitEpgRef(cur).id.toLowerCase()) ?? []),
      ...(m.candidates ?? []).map((x) => x.id),
      ...(byName.get(normalizeForMatch(c.cleanedName)) ?? []),
    ]);
    opts.delete(cur);
    if (opts.size) wanted.set(c.key, [...opts].slice(0, 8));
  }
  const load = [...new Set([...wanted.values()].flat())].filter((r) => !g.has(r));
  for (let i = 0; i < load.length; i += 400) {
    const part = await repo.getProgrammes(load.slice(i, i + 400));
    for (const [r, list] of part) g.setNormalized(r, list);
  }
  for (const [key, refs] of wanted) {
    const hit = refs.find((r) => g.range(r, now - 3600_000, now + 6 * 3600_000).length > 0 && !foreignNear(g, r, now));
    if (hit) out.set(key, hit);
  }
  return out;
}

let stationAlt = new Map<string, string>();

/**
 * My TV's New York locals (CBS 2, NBC 4, FOX 5, ABC 7…) whose guide match is another
 * market's station get the New York station's own listings (local news times etc.)
 * when the guide data has that station (by call sign in its id or names).
 */
async function findStationAlternates(g: GuideIndex): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!lastData) return out;
  const names = epgNamesOf(lastData);
  const need: { key: string; call: string }[] = [];
  for (const c of baseLineup) {
    const call = c.myTv !== undefined ? nyCallSign(c.myTv) : undefined;
    if (!call) continue;
    const m = rawMatches.get(c.key);
    const ref = isUsableMatch(m) ? m!.epgChannelId! : undefined;
    if (ref && guideIsStation(call, ref, names.get(ref))) continue;
    need.push({ key: c.key, call });
  }
  if (!need.length) return out;
  const byCall = new Map<string, string>();
  for (const { call } of need) {
    if (byCall.has(call)) continue;
    const hit = lastData.epgChannels.find((e) => guideIsStation(call, `${e.sourceId}|${e.id}`, e.displayNames));
    if (hit) byCall.set(call, `${hit.sourceId}|${hit.id}`);
  }
  const load = [...new Set(byCall.values())].filter((r) => !g.has(r));
  if (load.length) for (const [r, list] of await repo.getProgrammes(load)) g.setNormalized(r, list);
  for (const { key, call } of need) {
    const r = byCall.get(call);
    if (r && g.has(r)) out.set(key, r);
  }
  return out;
}

/** Re-apply guide extras (new provider data, time passing) without rebuilding the lineup. */
export function refreshExtras() {
  if (!state.ready) return;
  const v = withExtras(state.guide, state.settings);
  setState((s) => ({ ...v, guideVersion: s.guideVersion + 1 }));
}

/** User-Agent the channel's provider accepts (for its API calls). */
function playlistUa(playlistId: string): string | undefined {
  return state.playlists.find((p) => p.id === playlistId)?.userAgent;
}

/** Called by screens for channels they show: fetches the provider's guide for them if needed. */
export function wantGuideFor(ch: LineupChannel) {
  if (!state.settings.providerGuide || !providerRef(ch.url)) return;
  wantProviderGuide(ch, state.guide, playlistUa(ch.playlistId));
}

const epgNameCache = new WeakMap<LoadedData, Map<string, string[]>>();
/** Guide channel ref -> display names (for telling which city's station a channel is). */
function epgNamesOf(data: LoadedData): Map<string, string[]> {
  let m = epgNameCache.get(data);
  if (!m) {
    m = new Map(data.epgChannels.map((e) => [`${e.sourceId}|${e.id}`, e.displayNames]));
    epgNameCache.set(data, m);
  }
  return m;
}

/** Reload everything from storage (after imports or on startup). */
/** Let the screen paint between heavy steps (keeps the remote responsive on slow devices). */
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

export async function reloadAll() {
  setState({ loadingPhase: 'Reading settings' });
  let settings = await repo.getSettings();
  // New look: switch existing setups to the Aero theme once (Settings → Theme switches back).
  // Checked with its own flag: saved settings are merged with the defaults, so a settings field can't tell.
  if (!(await repo.getKv<boolean>('aeroIntroduced').catch(() => true))) {
    settings = { ...settings, theme: 'aero', aeroIntroduced: true };
    await repo.saveSettings(settings);
    await repo.setKv('aeroIntroduced', true).catch(() => undefined);
  }
  // The Luxury look (with the owl logo) is switched on once when it arrives.
  if (!(await repo.getKv<boolean>('luxuryIntroduced').catch(() => true))) {
    settings = { ...settings, theme: 'luxury' };
    await repo.saveSettings(settings);
    await repo.setKv('luxuryIntroduced', true).catch(() => undefined);
  }
  // The A7 look (cosmic orb logo) is switched on once when it arrives; Settings → Theme switches back.
  if (!(await repo.getKv<boolean>('a7Introduced').catch(() => true))) {
    settings = { ...settings, theme: 'a7' };
    await repo.saveSettings(settings);
    await repo.setKv('a7Introduced', true).catch(() => undefined);
  }
  setHqLogos(settings.hqLogos !== false);
  applyTheme(settings); // your theme from the first moment, not after everything has loaded
  setState({ loadingPhase: 'Reading your playlists and guide channels' });
  const data = await loadSources(repo);
  lastData = data;
  setState({ loadingPhase: 'Reading guide matches' });
  const matches = await loadMatches(repo);
  rawMatches = matches;
  // Matches may be missing/stale if channels were imported but matching didn't finish.
  // Never block startup on it: show the lineup now and match in the background.
  const known = data.channels.every((c) => matches.has(c.key));
  if (!known && data.epgChannels.length) setTimeout(() => void matchMissingAndReload(), 1500);
  setState({ loadingPhase: 'Organizing channels' });
  const customizations = await repo.getCustomizations();
  // Remember what each customized channel is, so changes can follow it to another provider.
  const byKey = new Map(data.channels.map((c) => [c.key, c]));
  const fixed = [...customizations.values()].filter((c) => !c.ident && byKey.has(c.key));
  for (const c of fixed) c.ident = { name: byKey.get(c.key)!.originalName, tvgId: byKey.get(c.key)!.tvgId };
  if (fixed.length) await repo.saveCustomizations(fixed).catch(() => undefined);
  const recents = await repo.getRecents();
  const reminders = ((await repo.getKv<Reminder[]>('reminders')) ?? []).filter((r) => r.stop > Date.now());
  await breathe();
  setProviderOrder(data.playlists.map((p) => p.id));
  const uas = new Map(data.playlists.filter((p) => p.userAgent).map((p) => [p.id, p.userAgent!]));
  const built = buildLineup({ channels: data.channels, customizations, matches, playlistOrder: data.playlists.map((p) => p.id), playlistUserAgents: uas, myTvNumbers: settings.sortMode === 'mytv', epgNames: epgNamesOf(data), myTvPins: settings.myTvPins });
  await breathe();
  baseLineup = sortLineup(built, settings.sortMode, recents);
  if (!providerInit) providerInit = initProviderGuide(repo, refreshExtras);
  await providerInit;
  await breathe();
  const view = withExtras(state.guide, settings);
  await breathe();
  const epgChannelNames = new Map<string, string>();
  for (const c of data.epgChannels) epgChannelNames.set(`${c.sourceId}|${c.id}`, c.displayNames[0] ?? c.id);
  setState({ settings, playlists: data.playlists, epgSources: data.epgSources, ...view, customizations, recents, epgChannelNames, reminders, ready: true, loadingPhase: undefined });
  await loadGuide();
}

let providerInit: Promise<void> | null = null;

/** Load programmes for every channel with a usable match into memory. */
export async function loadGuide() {
  const refs = [...new Set(baseLineup.filter((c) => isUsableMatch(rawMatches.get(c.key))).map((c) => c.epgChannelId!))];
  const g = new GuideIndex();
  const BATCH = 400;
  for (let i = 0; i < refs.length; i += BATCH) {
    const part = await repo.getProgrammes(refs.slice(i, i + BATCH));
    for (const [r, list] of part) g.setNormalized(r, list);
  }
  g.prune(Date.now() - state.settings.epgKeepPastHours * 3600_000);
  await breathe();
  try {
    englishAlt = await findEnglishAlternates(g);
  } catch {
    englishAlt = new Map();
  }
  try {
    stationAlt = await findStationAlternates(g);
  } catch {
    stationAlt = new Map();
  }
  const view = withExtras(g, state.settings);
  setState((s) => ({ guide: g, ...view, guideVersion: s.guideVersion + 1 }));
}

function refreshLineupLocal() {
  if (!lastData) return;
  baseLineup = rebuildLineup(lastData, rawMatches, state.customizations, state.settings, state.recents);
  refreshExtras();
}

export async function updateSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  await repo.saveSettings(settings);
  setState({ settings });
  if ('sortMode' in patch || 'myTvPins' in patch) refreshLineupLocal();
  else if ('preferEnglish' in patch) await loadGuide();
  else if ('liveEventNames' in patch || 'providerGuide' in patch || 'timeZone' in patch) refreshExtras();
  if ('accent' in patch || 'theme' in patch || 'background' in patch) applyTheme(settings);
  if ('hqLogos' in patch) setHqLogos(settings.hqLogos !== false);
  if ('fuzzyAutoApprove' in patch) await rematchAndReload();
}

export function applyTheme(s: Settings) {
  const root = document.documentElement;
  // Luxury always uses its champagne gold; other themes use the chosen accent.
  // Luxury and A7 have their own fixed accents (champagne gold; flame orange with nebula pink).
  const t = accentTokens(s.theme === 'luxury' ? '#c8a45d' : s.theme === 'a7' ? '#ff7a33' : s.theme === 'victors' ? '#ffc72c' : s.accent);
  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-2', s.theme === 'luxury' ? '#e9d3a2' : s.theme === 'a7' ? '#ff4f9a' : s.theme === 'victors' ? '#ffe28a' : t.accent2);
  root.style.setProperty('--accent-soft', t.soft);
  root.style.setProperty('--accent-ink', t.ink);
  root.dataset.theme = s.theme;
  root.dataset.bg = s.background ?? 'autumn';
  // Remembered for the next start, so the app opens in your theme instead of flashing the default one.
  try {
    localStorage.setItem(accountKey('lttvTheme'), JSON.stringify({ theme: s.theme, bg: root.dataset.bg, accent: t.accent, accent2: root.style.getPropertyValue('--accent-2'), soft: t.soft, ink: t.ink }));
  } catch {
    /* not remembered */
  }
}

/** Apply the last theme right away at startup (before settings are read). */
export function applySavedTheme() {
  try {
    const v = JSON.parse(localStorage.getItem(accountKey('lttvTheme')) || 'null') as { theme: string; bg?: string; accent: string; accent2: string; soft: string; ink: string } | null;
    const root = document.documentElement;
    root.dataset.bg = v?.bg ?? 'autumn';
    if (!v) return;
    root.dataset.theme = v.theme;
    root.style.setProperty('--accent', v.accent);
    if (v.accent2) root.style.setProperty('--accent-2', v.accent2);
    root.style.setProperty('--accent-soft', v.soft);
    root.style.setProperty('--accent-ink', v.ink);
  } catch {
    /* default look */
  }
}

/** Derive the accent palette from one color: a hue-shifted partner for gradients, a soft tint and readable ink. */
export function accentTokens(hex: string): { accent: string; accent2: string; soft: string; ink: string } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  const [r, g, b] = m ? [1, 2, 3].map((i) => parseInt(m[i], 16)) : [76, 194, 255];
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let hDeg = 0;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) {
    if (max === rn) hDeg = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) hDeg = 60 * ((bn - rn) / d + 2);
    else hDeg = 60 * ((rn - gn) / d + 4);
  }
  const accent2 = sat < 0.12 ? `hsl(${Math.round(hDeg)}, 8%, ${Math.round(Math.max(30, l * 100 - 25))}%)` : `hsl(${Math.round((hDeg + 42) % 360)}, ${Math.round(Math.min(95, sat * 100))}%, ${Math.round(Math.min(65, Math.max(45, l * 100)))}%)`;
  // WCAG relative luminance decides dark or white text on the accent.
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(rn) + 0.7152 * lin(gn) + 0.0722 * lin(bn);
  return { accent: `rgb(${r}, ${g}, ${b})`, accent2, soft: `rgba(${r}, ${g}, ${b}, 0.2)`, ink: lum > 0.28 ? '#06121b' : '#ffffff' };
}

// ---------------------------------------------------------------------------
// Customisation

export async function customize(key: string, patch: Partial<ChannelCustomization>) {
  const prev = state.customizations.get(key) ?? { key };
  const ch = lastData?.channels.find((c) => c.key === key);
  // Remember what the channel was, so the change can follow it to another provider.
  const ident = ch ? { name: ch.originalName, tvgId: ch.tvgId } : prev.ident;
  const next: ChannelCustomization = { ...prev, ...patch, key, ident };
  for (const k of Object.keys(next) as (keyof ChannelCustomization)[]) if (next[k] === undefined) delete next[k];
  await repo.saveCustomization(next);
  const map = new Map(state.customizations);
  map.set(key, next);
  setState({ customizations: map });
  refreshLineupLocal();
}

export async function setOrder(order: Map<string, number>) {
  const map = new Map(state.customizations);
  const list: ChannelCustomization[] = [];
  for (const [key, o] of order) {
    const c = { ...(map.get(key) ?? { key }), order: o };
    map.set(key, c);
    list.push(c);
  }
  await repo.saveCustomizations(list);
  setState({ customizations: map });
  if (state.settings.sortMode !== 'custom') await updateSettings({ sortMode: 'custom' });
  else refreshLineupLocal();
}

export async function toggleFavorite(key: string) {
  const fav = !state.customizations.get(key)?.favorite;
  await customize(key, { favorite: fav || undefined });
  toast(fav ? 'Added to favorites' : 'Removed from favorites', 'success', 2000);
}

export async function decideMatch(key: string, status: 'approved' | 'rejected' | 'manual', epgChannelId?: string) {
  await repo.saveDecision({ key, status, epgChannelId, decidedAt: Date.now() });
  await rematchAndReload(false);
}

/** Approve many suggested matches at once (one rematch at the end instead of one per channel). */
export async function approveMatches(items: { key: string; epgChannelId: string }[]) {
  if (!items.length) return;
  const at = Date.now();
  for (const it of items) await repo.saveDecision({ key: it.key, status: 'approved', epgChannelId: it.epgChannelId, decidedAt: at });
  await rematchAndReload(true);
  toast(`Approved ${items.length} guide match${items.length === 1 ? '' : 'es'}`, 'success', 3000);
}

export async function clearDecision(key: string) {
  await repo.deleteDecision(key);
  await rematchAndReload(false);
}

/** Startup: quietly match only the channels that don't have a match yet, then refresh the lineup. */
let matchingMissing = false;
async function matchMissingAndReload() {
  if (matchingMissing) return;
  matchingMissing = true;
  try {
    const { matched } = await matchMissingChannels(state.settings);
    if (matched) {
      rawMatches = await loadMatches(repo);
      refreshLineupLocal();
      await loadGuide();
    }
  } catch (e) {
    console.warn('Guide matching will continue next time:', (e as Error).message);
  } finally {
    matchingMissing = false;
  }
}

export async function rematchAndReload(showTask = true) {
  const id = 'match';
  if (showTask) setTask({ id, label: 'Matching channels to guide' });
  try {
    await rematch(state.settings);
    rawMatches = await loadMatches(repo);
    refreshLineupLocal();
    await loadGuide();
    if (showTask) setTask({ id, label: 'Guide matching updated', done: true });
  } catch (e) {
    setTask({ id, label: 'Matching failed', error: (e as Error).message });
  } finally {
    if (showTask) endTask(id);
  }
}

// ---------------------------------------------------------------------------
// Playback

export function channelByKey(key: string | undefined): LineupChannel | undefined {
  return key ? state.lineup.find((c) => c.key === key) : undefined;
}

export async function tune(key: string, opts: { fullscreen?: boolean } = {}) {
  const ch = channelByKey(key);
  if (!ch) return;
  if (player.currentKey !== key || player.status.state === 'error') player.play(playRequest(ch));
  wantGuideFor(ch);
  setState({ currentKey: key, ...(opts.fullscreen !== undefined ? { fullscreen: opts.fullscreen } : {}) });
  const recents = await repo.addRecent(key);
  await repo.setKv('lastChannel', key);
  setState({ recents });
}

/** Preferred stream format per server, learned from what actually played. */
const preferredExt = new Map<string, string>();
let preferredLoaded = false;
async function loadPreferred() {
  if (preferredLoaded) return;
  preferredLoaded = true;
  const saved = (await repo.getKv<Record<string, string>>('preferredStreamExt').catch(() => undefined)) ?? {};
  for (const [h, e] of Object.entries(saved)) preferredExt.set(h, e);
}
void Promise.resolve().then(loadPreferred).catch(() => undefined);

const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return '';
  }
};
const extOf = (u: string) => /\.(m3u8|ts)(?:$|\?)/i.exec(u.split('#')[0])?.[1]?.toLowerCase() ?? '';

/**
 * Build the play request: the channel URL plus the same channel in the provider's other
 * format (.m3u8 / .ts), tried automatically when one doesn't play. Browsers can't play
 * raw .ts, so desktop starts with HLS; the format that worked on a server is remembered.
 */
export function playRequest(ch: LineupChannel) {
  let urls = [ch.url, ...xtreamAlternates(ch.url, !native)];
  if (urls.length > 1) {
    const pref = preferredExt.get(hostOf(ch.url));
    const first = pref ? urls.find((u) => extOf(u) === pref) : !native && guessKind(ch.url) === 'ts' ? urls.find((u) => extOf(u) === 'm3u8') : undefined;
    if (first) urls = [first, ...urls.filter((u) => u !== first)];
  }
  return {
    key: ch.key,
    url: urls[0],
    headers: ch.headers,
    alternates: urls.slice(1),
    onWorking: (u: string) => {
      const h = hostOf(u);
      const e = extOf(u);
      if (!h || !e || urls.length < 2 || preferredExt.get(h) === e) return;
      preferredExt.set(h, e);
      void repo.setKv('preferredStreamExt', Object.fromEntries(preferredExt)).catch(() => undefined);
    },
  };
}

export function stopPlayback() {
  player.stop();
  setState({ currentKey: undefined, fullscreen: false });
}

/** Channels available for zapping (visible, current sort; favorites only if enabled). */
export function zapList(): LineupChannel[] {
  const visible = state.lineup.filter((c) => !c.hidden);
  return state.settings.zapFavoritesOnly ? visible.filter((c) => c.favorite) : visible;
}

// ---------------------------------------------------------------------------
// Sources: add / refresh / delete

export async function addPlaylist(p: { name: string; input: InputSource; epgIds?: string[]; skipVod?: boolean; xtream?: XtreamLogin; userAgent?: string; maxConnections?: number }, onProgress?: (p: JobProgress) => void) {
  const playlist: PlaylistSource = {
    id: uid('pl'),
    name: p.name.trim() || ('file' in p.input ? p.input.file.name : redactUrl(p.input.url)),
    kind: p.xtream || !('file' in p.input) ? 'url' : 'file',
    url: p.xtream ? xtreamUrls(p.xtream).playlist : 'url' in p.input ? p.input.url : undefined,
    xtream: p.xtream,
    maxConnections: p.maxConnections,
    fileName: 'file' in p.input && !p.xtream ? p.input.file.name : undefined,
    userAgent: p.userAgent ?? ('url' in p.input ? p.input.headers?.['User-Agent'] : undefined),
    epgIds: p.epgIds ?? [],
    enabled: true,
    createdAt: Date.now(),
  };
  const summary = await importPlaylist(playlist, p.input, { skipVod: p.skipVod, onProgress });
  return { playlist: (await repo.listPlaylists()).find((x) => x.id === playlist.id) ?? playlist, summary };
}

export async function addEpgSource(p: { name: string; input: InputSource }, onProgress?: (p: JobProgress) => void) {
  const source: EpgSource = {
    id: uid('ep'),
    name: p.name.trim() || ('file' in p.input ? p.input.file.name : redactUrl(p.input.url)),
    kind: 'file' in p.input ? 'file' : 'url',
    url: 'url' in p.input ? p.input.url : undefined,
    fileName: 'file' in p.input ? p.input.file.name : undefined,
    userAgent: 'url' in p.input ? p.input.headers?.['User-Agent'] : undefined,
    enabled: true,
    createdAt: Date.now(),
  };
  await repo.saveEpgSource({ ...source, lastAttemptAt: Date.now() });
  try {
    const summary = await importEpg(source, state.settings, p.input, { onProgress });
    return { source, summary };
  } catch (e) {
    await repo.deleteEpgSource(source.id);
    throw e;
  }
}

/**
 * Run a download, and if the provider refuses this client (e.g. code 884), retry
 * identifying as a standard media player. Returns the result and the identity that worked.
 */
export async function withClientFallback<T>(preferred: string | undefined, run: (ua: string | undefined) => Promise<T>, onRetry?: (label: string) => void): Promise<{ result: T; ua: string | undefined }> {
  const order = [...new Set([preferred, ...CLIENT_IDENTITIES.map((c) => c.ua)])];
  let lastErr: unknown;
  for (const ua of order) {
    try {
      return { result: await run(ua), ua };
    } catch (e) {
      lastErr = e;
      const status = (e as FetchError).status;
      if (!(e instanceof FetchError) || !isClientRejection(status)) throw e;
      const next = order[order.indexOf(ua) + 1];
      if (next !== undefined || order.indexOf(ua) < order.length - 1) onRetry?.(CLIENT_IDENTITIES.find((c) => c.ua === next)?.label ?? 'another player');
    }
  }
  const msg = (lastErr as Error)?.message ?? 'Request failed';
  throw new FetchError(`${msg} LTTV also tried identifying as VLC and other standard players. Check with your provider that the subscription is active, that your connection limit isn't reached, and that they don't block VPNs.`, (lastErr as FetchError)?.status);
}

export async function refreshPlaylist(p: PlaylistSource, file?: File, opts: { quiet?: boolean } = {}) {
  const id = 'pl-' + p.id;
  // Background refreshes run silently (no "Refreshing…" notices popping up while you browse).
  const setTask = opts.quiet ? (_t: Parameters<typeof setTaskRaw>[0]) => undefined : setTaskRaw;
  const endTask = opts.quiet ? (_id: string, _ms?: number) => undefined : endTaskRaw;
  if (p.kind === 'file' && !file) {
    toast(`"${p.name}" was imported from a file. Choose the file again to refresh it.`, 'info');
    return false;
  }
  setTask({ id, label: `Refreshing ${p.name}` });
  try {
    let input: InputSource = file ? { file } : { url: p.url!, headers: p.userAgent ? { 'User-Agent': p.userAgent } : undefined };
    if (!file && p.xtream) {
      const { text } = await loadXtreamPlaylist(p.xtream, p.userAgent);
      input = { file: new File([text], 'provider.m3u') };
    }
    const sum = await importPlaylist(p, input, { onProgress: (pr) => setTask({ id, label: `Refreshing ${p.name}`, progress: pr }) });
    setTask({ id, label: `${p.name}: ${sum.channels} channels`, done: true });
    return true;
  } catch (e) {
    const msg = (e as Error).message;
    await repo.savePlaylist({ ...p, lastImportError: msg });
    setTask({ id, label: `${p.name} failed`, error: msg });
    return false;
  } finally {
    endTask(id, 6000);
  }
}

export async function refreshEpg(s: EpgSource, file?: File, opts: { quiet?: boolean } = {}) {
  const id = 'ep-' + s.id;
  const setTask = opts.quiet ? (_t: Parameters<typeof setTaskRaw>[0]) => undefined : setTaskRaw;
  const endTask = opts.quiet ? (_id: string, _ms?: number) => undefined : endTaskRaw;
  if (s.kind === 'file' && !file) {
    toast(`"${s.name}" was imported from a file. Choose the file again to refresh it.`, 'info');
    return false;
  }
  setTask({ id, label: `Updating guide: ${s.name}` });
  try {
    const input: InputSource = file ? { file } : { url: s.url!, headers: s.userAgent ? { 'User-Agent': s.userAgent } : undefined };
    const sum = await importEpg(s, state.settings, input, { onProgress: (pr) => setTask({ id, label: `Updating guide: ${s.name}`, progress: pr }) });
    setTask({ id, label: `${s.name}: ${sum.programmes.toLocaleString()} programmes`, done: true });
    return true;
  } catch (e) {
    const msg = (e as Error).message;
    await repo.saveEpgSource({ ...s, lastError: msg, lastAttemptAt: Date.now() });
    setTask({ id, label: `Guide update failed: ${s.name}`, error: msg });
    return false;
  } finally {
    endTask(id, 6000);
  }
}

let refreshing = false;
const lastTry = new Map<string, number>();
/** Refresh all URL sources (playlists + guides), then rematch and reload. */
/** True while a refresh is running (for the guide's Refresh button). */
export function isRefreshing() {
  return refreshing;
}

export async function refreshAll(opts: { onlyStale?: boolean } = {}) {
  if (refreshing) return;
  refreshing = true;
  try {
    const now = Date.now();
    const hours = state.settings.epgRefreshHours;
    const stale = (t?: number) => !opts.onlyStale || !t || (hours > 0 && now - t > hours * 3600_000);
    let changed = false;
    // Providers rename live-event channels ("NFL 03: Bills vs Jets") through the day,
    // so playlists that have them are refreshed at least every 4 hours.
    const hasEvents = (id: string) => state.lineup.some((c) => c.playlistId === id && isEventChannel(c));
    const plStale = (p: PlaylistSource) => stale(p.lastImportAt) || (!!opts.onlyStale && hours > 0 && hasEvents(p.id) && (!p.lastImportAt || now - p.lastImportAt > 4 * 3600_000));
    // Background refreshes: quiet, and a source that just failed waits an hour before the next try.
    const quiet = !!opts.onlyStale;
    const tooSoon = (id: string) => quiet && now - (lastTry.get(id) ?? 0) < 3600_000;
    for (const p of await repo.listPlaylists()) {
      if (!(p.enabled && p.kind === 'url' && plStale(p)) || tooSoon(p.id)) continue;
      lastTry.set(p.id, now);
      changed = (await refreshPlaylist(p, undefined, { quiet })) || changed;
    }
    // A guide whose listings run out within 12 hours is refreshed early (at most once an hour), so the lineup stays current.
    const runningOut = (e: EpgSource) => !!opts.onlyStale && hours > 0 && !!e.coverageEnd && e.coverageEnd < now + 12 * 3600_000 && now - (e.lastAttemptAt ?? 0) > 3600_000;
    for (const s of await repo.listEpgSources()) {
      if (!(s.enabled && s.kind === 'url' && (stale(s.lastAttemptAt ?? s.lastRefreshAt) || runningOut(s))) || tooSoon(s.id)) continue;
      lastTry.set(s.id, now);
      changed = (await refreshEpg(s, undefined, { quiet })) || changed;
    }
    if (changed) {
      // A full re-match can be too much for a TV stick with a huge lineup: then match what's missing.
      await rematch(state.settings).catch(() => matchMissingChannels(state.settings).catch(() => undefined));
      await reloadAll();
    } else if (!opts.onlyStale) {
      await reloadAll();
    }
  } finally {
    refreshing = false;
  }
}

export async function deletePlaylist(id: string) {
  await repo.deletePlaylist(id);
  await rematch(state.settings);
  await reloadAll();
}
export async function deleteEpgSource(id: string) {
  await repo.deleteEpgSource(id);
  await rematch(state.settings);
  await reloadAll();
}
export async function togglePlaylist(p: PlaylistSource) {
  await repo.savePlaylist({ ...p, enabled: !p.enabled });
  await rematch(state.settings);
  await reloadAll();
}
export async function toggleEpg(s: EpgSource) {
  await repo.saveEpgSource({ ...s, enabled: !s.enabled });
  await rematch(state.settings);
  await reloadAll();
}

export async function pruneExpired() {
  const before = Date.now() - state.settings.epgKeepPastHours * 3600_000;
  const { removed } = await pruneGuide(before);
  state.guide.prune(before);
  return removed;
}

// ---------------------------------------------------------------------------
// Clock & background refresh

// ---------------------------------------------------------------------------
// Reminders ("remind me when the game starts")

export async function toggleReminder(r: Reminder) {
  const exists = state.reminders.some((x) => x.key === r.key);
  const reminders = exists ? state.reminders.filter((x) => x.key !== r.key) : [...state.reminders, r];
  await repo.setKv('reminders', reminders);
  setState({ reminders });
  toast(exists ? 'Reminder removed' : 'Reminder set — LTTV will offer to switch when it starts', 'success', 3000);
}

async function checkReminders(now: number) {
  const due = state.reminders.find((r) => r.start <= now + 30_000 && r.stop > now);
  const remaining = state.reminders.filter((r) => r !== due && r.stop > now);
  if (!due && remaining.length === state.reminders.length) return;
  await repo.setKv('reminders', remaining);
  setState({ reminders: remaining, ...(due && state.currentKey !== due.channelKey ? { reminderDue: due } : {}) });
}

export function startClock() {
  const tick = () => {
    const now = Date.now();
    setState({ now });
    void checkReminders(now);
  };
  // Align to the next 15s boundary so progress bars move smoothly but cheaply.
  setInterval(tick, 15_000);
  // Games from event-channel names start and finish: re-evaluate every 5 minutes.
  setInterval(() => refreshExtras(), 5 * 60_000);
  // Every 10 minutes: drop expired programmes and refresh stale sources.
  setInterval(() => {
    void pruneExpired().catch(() => undefined);
    if (state.settings.epgRefreshHours > 0) void refreshAll({ onlyStale: true });
  }, 10 * 60_000);
}
