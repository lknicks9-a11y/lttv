// Accounts (profiles) on this device. Each account has its own provider login, playlists, guide,
// favorites, teams, bets, Continue watching and theme: it simply uses its own on-device database.
// The first account uses the original database, so existing setups become "account 1" unchanged.
// An account can be linked to a cloud sign-in (cloud.ts); its data is then also kept with that sign-in.

export interface Account {
  id: string;
  name: string;
  /** Avatar color. */
  color: string;
  /** Cloud user this account is signed in as (cloud.ts). */
  cloudUserId?: string;
  email?: string;
}

interface Saved {
  list: Account[];
  current: string;
}

const KEY = 'lttvAccounts';
export const MAIN = 'main';
export const AVATAR_COLORS = ['#4cc2ff', '#ff7a33', '#3ddc97', '#ff4f9a', '#c8a45d', '#9b7bff', '#ff5d5d', '#2ad4c4'];

let cacheRaw: string | null | undefined;
let cacheVal: Saved | undefined;
function read(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    // Parsed once per change (the sidebar asks on every render).
    if (raw === cacheRaw && cacheVal) return JSON.parse(JSON.stringify(cacheVal)) as Saved;
    cacheRaw = raw;
    const v = JSON.parse(raw || 'null') as Saved | null;
    cacheVal = undefined;
    if (v && Array.isArray(v.list) && v.list.length) {
      if (!v.list.some((a) => a.id === v.current)) v.current = v.list[0].id;
      cacheVal = JSON.parse(JSON.stringify(v)) as Saved;
      return v;
    }
  } catch {
    /* first run */
  }
  return { list: [{ id: MAIN, name: 'Me', color: AVATAR_COLORS[0] }], current: MAIN };
}

function write(v: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage blocked */
  }
}

export function listAccounts(): Account[] {
  return read().list;
}

export function currentAccount(): Account {
  const s = read();
  return s.list.find((a) => a.id === s.current) ?? s.list[0];
}

/** The on-device database for an account. */
export function dbNameFor(id: string): string {
  return id === MAIN ? 'lttv' : `lttv-${id}`;
}

export function currentDbName(): string {
  return dbNameFor(currentAccount().id);
}

/** Key for small per-account values kept outside the database (e.g. the theme shown at startup). */
export function accountKey(base: string): string {
  const id = currentAccount().id;
  return id === MAIN ? base : `${base}:${id}`;
}

export function createAccount(name: string): Account {
  const s = read();
  const id = Math.random().toString(36).slice(2, 10);
  const acc: Account = { id, name: name.trim().slice(0, 24) || `Account ${s.list.length + 1}`, color: AVATAR_COLORS[s.list.length % AVATAR_COLORS.length] };
  s.list.push(acc);
  write(s);
  return acc;
}

export function renameAccount(id: string, name: string) {
  const s = read();
  const a = s.list.find((x) => x.id === id);
  if (!a || !name.trim()) return;
  a.name = name.trim().slice(0, 24);
  write(s);
}

export function updateAccount(id: string, patch: Partial<Omit<Account, 'id'>>) {
  const s = read();
  const a = s.list.find((x) => x.id === id);
  if (!a) return;
  Object.assign(a, patch);
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (a as unknown as Record<string, unknown>)[k];
  write(s);
}

export function setAccountColor(id: string, color: string) {
  const s = read();
  const a = s.list.find((x) => x.id === id);
  if (!a) return;
  a.color = color;
  write(s);
}

/** Switch to another account: the app restarts on that account's data. */
export function switchAccount(id: string, opts: { reload?: boolean } = {}) {
  const s = read();
  if (!s.list.some((a) => a.id === id)) return;
  s.current = id;
  write(s);
  try {
    sessionStorage.clear();
    sessionStorage.setItem('lttvPickedAccount', '1');
  } catch {
    /* ignore */
  }
  if (opts.reload !== false) location.reload();
}

/** Remove an account and everything stored for it on this device (not the current one). */
export async function removeAccount(id: string): Promise<void> {
  const s = read();
  if (id === s.current || s.list.length < 2) throw new Error('Switch to another account first.');
  s.list = s.list.filter((a) => a.id !== id);
  write(s);
  try {
    localStorage.removeItem(`lttvTheme:${id}`);
  } catch {
    /* ignore */
  }
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(dbNameFor(id));
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}

/** Show "Who's watching?" at startup: several accounts and none picked yet in this session. */
export function needsAccountPick(): boolean {
  if (read().list.length < 2) return false;
  try {
    return !sessionStorage.getItem('lttvPickedAccount');
  } catch {
    return false;
  }
}

export function markAccountPicked() {
  try {
    sessionStorage.setItem('lttvPickedAccount', '1');
  } catch {
    /* ignore */
  }
}
