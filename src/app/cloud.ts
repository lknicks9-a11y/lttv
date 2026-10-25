// LTTV accounts in the cloud (Supabase): sign up / sign in with email and password; the sign-in is
// remembered on each device, and the account's playlists, guides, favorites, teams, bets, Continue
// watching and settings are kept with the account so every device you sign in on has them.
//
// Data lives in the owner's own Supabase project (table `lttv_profiles`, one row per user, readable
// and writable only by that user — row level security). Tokens and playlist logins are never logged.
import { createAccount, currentAccount, listAccounts, switchAccount, updateAccount, type Account } from './accounts';
import { CLOUD_CONFIG } from './cloud-config';

export interface CloudConfig {
  url: string;
  anonKey: string;
}

export function cloudConfig(): CloudConfig | null {
  let url = CLOUD_CONFIG.url;
  let anonKey = CLOUD_CONFIG.anonKey;
  try {
    // Testing / self-hosting override.
    url = localStorage.getItem('lttvCloudUrl') || url;
    anonKey = localStorage.getItem('lttvCloudKey') || anonKey;
  } catch {
    /* defaults */
  }
  url = url.trim().replace(/\/+$/, '');
  return url && anonKey ? { url, anonKey: anonKey.trim() } : null;
}

export interface CloudSession {
  userId: string;
  email?: string;
  accessToken: string;
  refreshToken: string;
  /** ms */
  expiresAt: number;
}

const SESSIONS_KEY = 'lttvCloudSessions';

function readSessions(): Record<string, CloudSession> {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '{}') as Record<string, CloudSession>;
  } catch {
    return {};
  }
}
function writeSessions(s: Record<string, CloudSession>) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(s));
  } catch {
    /* storage blocked */
  }
}

/** The signed-in cloud user of the account that's open, if any. */
export function currentSession(): CloudSession | null {
  const uid = currentAccount().cloudUserId;
  return uid ? readSessions()[uid] ?? null : null;
}

// ---------------------------------------------------------------- auth (Supabase GoTrue REST)

interface AuthResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  user?: { id: string; email?: string; user_metadata?: { full_name?: string; name?: string } };
  id?: string;
  email?: string;
  error?: string;
  error_description?: string;
  msg?: string;
  message?: string;
}

function authError(j: AuthResponse, status: number): Error {
  const raw = j.error_description || j.msg || j.message || j.error || `Sign-in failed (HTTP ${status}).`;
  if (/invalid login credentials/i.test(raw)) return new Error('That email and password don’t match an account.');
  if (/already registered|already exists/i.test(raw)) return new Error('There’s already an account with this email — sign in instead.');
  if (/email not confirmed/i.test(raw)) return new Error('Confirm your email first (check your inbox), then sign in.');
  if (/password should be at least/i.test(raw)) return new Error('Use a password with at least 6 characters.');
  return new Error(raw);
}

async function authPost(path: string, body: unknown): Promise<AuthResponse> {
  const c = cloudConfig();
  if (!c) throw new Error('Accounts aren’t set up for this app yet.');
  let r: Response;
  try {
    r = await fetch(`${c.url}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: c.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Couldn’t reach the account server. Check the internet connection.');
  }
  const j = (await r.json().catch(() => ({}))) as AuthResponse;
  if (!r.ok) throw authError(j, r.status);
  return j;
}

function toSession(j: AuthResponse): CloudSession {
  if (!j.access_token || !j.refresh_token || !j.user?.id) throw new Error('The account server sent an unexpected answer.');
  return {
    userId: j.user.id,
    email: j.user.email,
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: j.expires_at ? j.expires_at * 1000 : Date.now() + (j.expires_in ?? 3600) * 1000,
  };
}

function saveSession(s: CloudSession) {
  const all = readSessions();
  all[s.userId] = s;
  writeSessions(all);
}

export type SignUpResult = { session: CloudSession } | { confirmEmail: true };

export async function signUpEmail(email: string, password: string): Promise<SignUpResult> {
  const j = await authPost('signup', { email: email.trim(), password });
  if (!j.access_token) return { confirmEmail: true };
  const s = toSession(j);
  saveSession(s);
  return { session: s };
}

export async function signInEmail(email: string, password: string): Promise<CloudSession> {
  const s = toSession(await authPost('token?grant_type=password', { email: email.trim(), password }));
  saveSession(s);
  return s;
}

/** Turn a refresh token (from the phone sign-in) into this device's own session. */
export async function signInWithRefreshToken(refreshToken: string): Promise<CloudSession> {
  const s = toSession(await authPost('token?grant_type=refresh_token', { refresh_token: refreshToken }));
  saveSession(s);
  return s;
}

let refreshing: Promise<CloudSession> | null = null;

/** A valid access token for the open account (refreshed when it's about to expire). */
export async function accessToken(): Promise<string | null> {
  const s = currentSession();
  if (!s) return null;
  if (s.expiresAt - Date.now() > 60_000) return s.accessToken;
  try {
    // One refresh at a time: two at once with the same token makes the server refuse the second ("already used").
    refreshing ??= signInWithRefreshToken(s.refreshToken).finally(() => {
      refreshing = null;
    });
    return (await refreshing).accessToken;
  } catch (e) {
    // Only a sign-in the server says is gone for good is forgotten (signed out elsewhere, password changed, account
    // deleted). Offline, a server hiccup, "too many requests" or any other error keeps you signed in: try again later.
    if (/invalid_grant|invalid refresh token|refresh[_ ]token[_ ]not[_ ]found|session[_ ]not[_ ]found|session_expired|user[_ ]not[_ ]found|refresh_token_already_used/i.test((e as Error).message)) {
      const all = readSessions();
      delete all[s.userId];
      writeSessions(all);
      return null;
    }
    throw e;
  }
}

export async function signOut(): Promise<void> {
  const s = currentSession();
  if (!s) return;
  const c = cloudConfig();
  if (c) {
    void fetch(`${c.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: c.anonKey, Authorization: `Bearer ${s.accessToken}` } }).catch(() => undefined);
  }
  const all = readSessions();
  delete all[s.userId];
  writeSessions(all);
  updateAccount(currentAccount().id, { cloudUserId: undefined, email: undefined });
}

/**
 * After signing in: open the device account that belongs to this cloud user (creating it the first
 * time — it gets its own on-device data), so each person's channels stay separate. Reloads the app.
 */
export function openCloudAccount(s: CloudSession, displayName?: string) {
  const mine = listAccounts().find((a) => a.cloudUserId === s.userId);
  if (mine) {
    if (mine.id === currentAccount().id) {
      location.reload();
      return;
    }
    switchAccount(mine.id);
    return;
  }
  // A brand-new account on an untouched device takes over the first (empty) account instead of adding one.
  const cur = currentAccount();
  const name = displayName || s.email?.split('@')[0] || 'Me';
  if (!cur.cloudUserId && listAccounts().length === 1 && isFreshDevice()) {
    updateAccount(cur.id, { cloudUserId: s.userId, email: s.email, name });
    location.reload();
    return;
  }
  const acc: Account = createAccount(name);
  updateAccount(acc.id, { cloudUserId: s.userId, email: s.email });
  switchAccount(acc.id);
}

let freshDevice = false;
/** Set at startup: the open account has no playlists yet. */
export function markFreshDevice(v: boolean) {
  freshDevice = v;
}
function isFreshDevice() {
  return freshDevice;
}

// ---------------------------------------------------------------- profile data (Supabase REST)

export interface CloudProfile {
  data: Record<string, unknown>;
  updatedAt: string;
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const c = cloudConfig();
  const token = await accessToken();
  if (!c || !token) throw new Error('Not signed in.');
  return fetch(`${c.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: c.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

export async function loadProfile(): Promise<CloudProfile | null> {
  const s = currentSession();
  if (!s) return null;
  const r = await rest(`lttv_profiles?select=data,updated_at&user_id=eq.${encodeURIComponent(s.userId)}`);
  if (!r.ok) throw new Error(r.status === 404 ? 'The account database isn’t set up yet (table lttv_profiles is missing).' : `Couldn’t load your account (HTTP ${r.status}).`);
  const rows = (await r.json()) as { data: Record<string, unknown>; updated_at: string }[];
  return rows[0] ? { data: rows[0].data ?? {}, updatedAt: rows[0].updated_at } : null;
}

export async function saveProfile(data: Record<string, unknown>): Promise<void> {
  const s = currentSession();
  if (!s) return;
  const r = await rest('lttv_profiles?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: s.userId, data, updated_at: new Date().toISOString() }, cleanForDb),
  });
  if (!r.ok) {
    // Say what the database objected to (PostgREST answers { message, code, hint }).
    const j = (await r.json().catch(() => ({}))) as { message?: string; code?: string; hint?: string };
    const why = j.message ? `: ${j.message}${j.code ? ` (${j.code})` : ''}` : '';
    if (/column .* does not exist|could not find the .* column|PGRST204|42703/i.test(`${j.message} ${j.code}`)) {
      throw new Error(`The account table is missing a column${why}. Run the SQL from docs/accounts.md again in Supabase.`);
    }
    throw new Error(`Couldn’t save to your account (HTTP ${r.status}${why}).`);
  }
}

/**
 * Text Postgres refuses to keep in a JSON column: the NUL character and half an emoji (a lone surrogate) — both turn up
 * in IPTV channel / programme names and made the whole save fail with HTTP 400. Left out of what's saved.
 */
export function cleanForDb(_key: string, v: unknown): unknown {
  if (typeof v !== 'string') return v;
  // (A plain loop: older Fire TV web engines don't support every regex feature.)
  let out = '';
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c === 0) continue;
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = v.charCodeAt(i + 1);
      if (n >= 0xdc00 && n <= 0xdfff) {
        out += v[i] + v[i + 1];
        i++;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    out += v[i];
  }
  return out;
}
