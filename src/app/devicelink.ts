// Your TVs, reachable from the LTTV phone page anywhere: when this app is signed in to an LTTV account, it joins
// the account's private link channel (Supabase Realtime), shows up there as a device (name, app, what's playing)
// and carries out the phone's commands — remote buttons, play a channel or game, stop, start again, watch on the
// phone. The channel's name comes from a long random secret kept in the account (readable only when signed in).
import { cloudConfig, currentSession, loadProfile, saveProfile } from './cloud';
import { APP_MODE } from './appmode';
import { native } from './platform';
import { getState, player, repo, subscribe, tune } from './state';
import { LinkRpc, RealtimeLink, linkTopic, phoneStreamUrls, randomId } from '../core/realtime';

const SECRET_KEY = 'lttvLinkSecret';
const DEVICE_KEY = 'lttvDeviceId';
const NAME_KEY = 'lttvDeviceName';

const APP_NAMES: Record<string, string> = { lttv: 'LTTV', movies: 'Movies & Shows', leaguepass: 'League Pass', blitz: 'Blitz' };

function store(k: string, v?: string): string | undefined {
  try {
    if (v !== undefined) localStorage.setItem(k, v);
    return localStorage.getItem(k) ?? undefined;
  } catch {
    return v;
  }
}

/** The link secret this device knows for the signed-in account (cloud sync saves it with the account). */
export function localLinkSecret(): string | undefined {
  const s = currentSession();
  return s ? store(`${SECRET_KEY}:${s.userId}`) : undefined;
}

/** This device's id on the link (one per app: LTTV and League Pass on the same TV are two devices). */
function deviceId(): string {
  const k = `${DEVICE_KEY}:${APP_MODE}`;
  return store(k) ?? store(k, randomId(8))!;
}

export function deviceName(): string {
  const own = store(NAME_KEY);
  const where = native ? 'Fire TV' : /Android|iPhone|iPad/.test(navigator.userAgent) ? 'Phone' : 'Computer';
  return `${APP_NAMES[APP_MODE] ?? 'LTTV'} · ${own || where}`;
}

/** The account's secret: the one already in the account, else this device's, else a new one (saved to the account). */
async function ensureSecret(): Promise<string | undefined> {
  const s = currentSession();
  if (!s) return undefined;
  const key = `${SECRET_KEY}:${s.userId}`;
  const prof = await loadProfile().catch(() => null);
  const inAccount = typeof prof?.data.linkSecret === 'string' ? (prof.data.linkSecret as string) : undefined;
  if (inAccount) {
    store(key, inAccount);
    return inAccount;
  }
  const secret = store(key) ?? store(key, randomId(24))!;
  // Saved right away (with everything else the account has), so a phone can find this TV before the next sync.
  if (prof) await saveProfile({ ...prof.data, linkSecret: secret }).catch(() => undefined);
  return secret;
}

const SHARED_KEY = 'lttvSharedLinkSecret';

/** League Pass / Blitz / Movies & Shows: the link channel LTTV shared (they have no sign-in of their own). */
export function takeSharedLinkSecret(secret: string | undefined): void {
  if (APP_MODE === 'lttv') return;
  const had = store(SHARED_KEY);
  if (!secret || secret === had) return;
  store(SHARED_KEY, secret);
  // A different account on LTTV now: join its channel instead.
  if (link) {
    link.stop();
    link = null;
    started = false;
  }
  void startDeviceLink();
}

let link: RealtimeLink | null = null;
let started = false;

export async function startDeviceLink(): Promise<void> {
  if (started) return;
  const c = cloudConfig();
  if (!c) return;
  if (APP_MODE === 'lttv' && !currentSession()) return;
  started = true;
  const secret = APP_MODE === 'lttv' ? await ensureSecret() : store(SHARED_KEY);
  if (!secret) {
    started = false;
    return;
  }
  const me = deviceId();
  link = new RealtimeLink({
    url: c.url,
    apiKey: c.anonKey,
    topic: linkTopic(secret),
    presenceKey: me,
    onBroadcast: (e, p) => rpc.onBroadcast(e, p),
  });
  const rpc = new LinkRpc(link, me);
  rpc.serve(answer);
  link.start();
  announce();
  // What's playing changes → the phone's device list shows it (at most once a second).
  let t: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    clearTimeout(t);
    t = setTimeout(announce, 1000);
  };
  player.subscribe(soon);
  subscribe(soon);
}

let lastMeta = '';
function announce() {
  if (!link) return;
  const s = getState();
  const cur = player.currentKey ? s.lineup.find((c) => c.key === player.currentKey) : undefined;
  const meta = {
    device: true,
    id: deviceId(),
    name: deviceName(),
    app: APP_MODE,
    kind: native ? 'firetv' : 'computer',
    playing: cur ? { key: cur.key, name: cur.name, logo: cur.logo, state: player.status.state } : null,
  };
  const j = JSON.stringify(meta);
  if (j === lastMeta) return;
  lastMeta = j;
  link.track(meta);
}

async function answer(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  const { runRemoteCommand, snapshot } = await import('./remote');
  switch (cmd) {
    case 'hello':
      return { name: deviceName(), app: APP_MODE, ...snapshot() };
    case 'resume': {
      // "Turn it back on": the last channel played on this TV.
      const key = (args.key as string | undefined) ?? (await repo.getKv<string>('lastChannel').catch(() => undefined));
      if (!key) throw new Error('Nothing has played on this TV yet — pick a channel.');
      await tune(key, { fullscreen: true });
      return snapshot();
    }
    case 'watchUrl': {
      // Watch on the phone: the stream's address (your own provider's; it goes only to your signed-in phone).
      const key = (args.key as string | undefined) ?? player.currentKey;
      const ch = key ? getState().lineup.find((c) => c.key === key) : undefined;
      if (!ch) throw new Error('Pick a channel first.');
      return { key: ch.key, name: ch.name, logo: ch.logo, ...phoneStreamUrls(ch.url) };
    }
    default:
      return runRemoteCommand(cmd, args);
  }
}
