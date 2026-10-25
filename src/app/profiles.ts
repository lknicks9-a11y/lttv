// Profiles (like Netflix) under the account: everyone shares the account's playlists and guide; each profile has its
// own favorite channels, Continue watching (movies & shows) and recently watched channels. Kept in the account's
// on-device database and, when signed in, with the account in the cloud (cloudsync.ts) — until the profile is deleted.
import type { ChannelCustomization, RecentEntry } from '../core/types';
import { currentDbName } from './accounts';

export interface Profile {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}

interface ProfilesDoc {
  list: Profile[];
  /** Deleted profile ids, so a deletion isn't undone by another device's copy. */
  deleted: string[];
  /** When the list (names, colors, adds, deletes) last changed. */
  at: number;
  /** The account's existing favorites / progress / recents have been moved into the first profile. */
  migrated?: boolean;
}

/** What one profile keeps (also the shape stored with the account in the cloud). */
export interface ProfileData {
  /** Favorite channels: key -> what the channel is (to find it again if the provider renumbers it). */
  fav: Record<string, { name?: string; tvgId?: string }>;
  recents: RecentEntry[];
  vodResume: Record<string, unknown>;
  at: number;
}

interface Kv {
  getKv<T>(key: string): Promise<T | undefined>;
  setKv(key: string, v: unknown): Promise<void>;
}

export const PROFILE_COLORS = ['#4cc2ff', '#ff7a33', '#3ddc97', '#ff4f9a', '#c8a45d', '#9b7bff', '#ff5d5d', '#2ad4c4'];
const DOC = 'profiles';
const k = (what: 'fav' | 'recents' | 'vodResume' | 'profileAt', id: string) => `${what}:${id}`;

let kv: Kv | null = null;
let doc: ProfilesDoc = { list: [], deleted: [], at: 0 };
let current = '';
let fav: ProfileData['fav'] = {};
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function onProfilesChanged(l: () => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

const pickKey = () => `lttvProfile:${currentDbName()}`;
function rememberedProfile(): string {
  try {
    return localStorage.getItem(pickKey()) || '';
  } catch {
    return '';
  }
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Load the profiles (at startup, before the channel list is built). The first time, the account's existing favorites,
 * Continue watching and recents become the first profile's.
 */
export async function initProfiles(store: Kv, customizations: Map<string, ChannelCustomization>, ownerName: string): Promise<void> {
  kv = store;
  doc = (await store.getKv<ProfilesDoc>(DOC)) ?? { list: [], deleted: [], at: 0 };
  doc.deleted ??= [];
  if (!doc.list.length) {
    const first: Profile = { id: newId(), name: ownerName || 'Me', color: PROFILE_COLORS[0], createdAt: Date.now() };
    doc = { list: [first], deleted: doc.deleted, at: Date.now(), migrated: doc.migrated };
  }
  if (!doc.migrated) {
    const id = doc.list[0].id;
    const favs: ProfileData['fav'] = {};
    for (const c of customizations.values()) if (c.favorite) favs[c.key] = { name: c.ident?.name, tvgId: c.ident?.tvgId };
    await store.setKv(k('fav', id), favs);
    const recents = await store.getKv<RecentEntry[]>('recents');
    if (recents) await store.setKv(k('recents', id), recents);
    const resume = await store.getKv<Record<string, unknown>>('vodResume');
    if (resume) await store.setKv(k('vodResume', id), resume);
    await store.setKv(k('profileAt', id), Date.now());
    doc.migrated = true;
  }
  await store.setKv(DOC, doc);
  const want = rememberedProfile();
  current = doc.list.some((p) => p.id === want) ? want : doc.list[0].id;
  fav = (await store.getKv<ProfileData['fav']>(k('fav', current))) ?? {};
  notify();
}

export function listProfiles(): Profile[] {
  return doc.list;
}
export function currentProfile(): Profile | undefined {
  return doc.list.find((p) => p.id === current);
}
export function currentProfileId(): string {
  return current;
}
export function profilesReady(): boolean {
  return !!kv && !!current;
}

/** The storage key for this profile's Continue watching (vod.ts). */
export function resumeKey(): string {
  return current ? k('vodResume', current) : 'vodResume';
}

async function touch(id = current) {
  await kv?.setKv(k('profileAt', id), Date.now());
}
async function saveDoc() {
  doc.at = Date.now();
  await kv?.setKv(DOC, doc);
  notify();
}

// ---------------- favorites ----------------

export function isFavorite(key: string): boolean {
  return !!fav[key];
}

/** The account's channel changes with this profile's favorites in place of the stored ones. */
export function withProfileFavorites(customs: Map<string, ChannelCustomization>): Map<string, ChannelCustomization> {
  if (!profilesReady()) return customs;
  const out = new Map<string, ChannelCustomization>();
  for (const [key, c] of customs) {
    const f = !!fav[key];
    out.set(key, f === !!c.favorite ? c : { ...c, favorite: f || undefined });
  }
  // Favorites with no other change; the name lets a renumbered channel keep its star.
  for (const [key, ident] of Object.entries(fav)) if (!out.has(key)) out.set(key, { key, favorite: true, ident: ident.name ? { name: ident.name, tvgId: ident.tvgId } : undefined });
  return out;
}

export async function setFavorite(key: string, on: boolean, ident?: { name?: string; tvgId?: string }) {
  if (on) fav = { ...fav, [key]: ident ?? {} };
  else {
    fav = { ...fav };
    delete fav[key];
  }
  await kv?.setKv(k('fav', current), fav);
  await touch();
  notify();
}

// ---------------- recents ----------------

export async function profileRecents(): Promise<RecentEntry[]> {
  return (await kv?.getKv<RecentEntry[]>(k('recents', current))) ?? [];
}

export async function addProfileRecent(key: string, max = 30): Promise<RecentEntry[]> {
  const list = (await profileRecents()).filter((r) => r.key !== key);
  list.unshift({ key, at: Date.now() });
  const trimmed = list.slice(0, max);
  await kv?.setKv(k('recents', current), trimmed);
  await touch();
  return trimmed;
}

/** Continue watching changed (vod.ts calls this after saving progress). */
export async function touchProfile() {
  await touch();
}

// ---------------- managing profiles ----------------

export async function addProfile(name: string, color?: string): Promise<Profile> {
  const p: Profile = { id: newId(), name: name.trim().slice(0, 20) || `Profile ${doc.list.length + 1}`, color: color ?? PROFILE_COLORS[doc.list.length % PROFILE_COLORS.length], createdAt: Date.now() };
  doc.list = [...doc.list, p];
  await kv?.setKv(k('fav', p.id), {});
  await touch(p.id);
  await saveDoc();
  return p;
}

export async function editProfile(id: string, patch: { name?: string; color?: string }) {
  doc.list = doc.list.map((p) => (p.id === id ? { ...p, ...(patch.name?.trim() ? { name: patch.name.trim().slice(0, 20) } : {}), ...(patch.color ? { color: patch.color } : {}) } : p));
  await saveDoc();
}

/** Delete a profile and what it kept (not the one in use, nor the last one). */
export async function deleteProfile(id: string) {
  if (id === current) throw new Error('Switch to another profile first.');
  if (doc.list.length < 2) throw new Error('An account needs at least one profile.');
  doc.list = doc.list.filter((p) => p.id !== id);
  doc.deleted = [...new Set([...doc.deleted, id])];
  for (const what of ['fav', 'recents', 'vodResume', 'profileAt'] as const) await kv?.setKv(k(what, id), undefined);
  await saveDoc();
}

/** Watch as another profile: the app restarts on that profile. */
export function switchProfile(id: string) {
  if (!doc.list.some((p) => p.id === id)) return;
  try {
    localStorage.setItem(pickKey(), id);
    sessionStorage.setItem('lttvProfilePicked', '1');
  } catch {
    /* ignore */
  }
  location.reload();
}

/** "Who's watching?" at startup: more than one profile and none picked since the app opened. */
export function needsProfilePick(): boolean {
  if (doc.list.length < 2) return false;
  try {
    return !sessionStorage.getItem('lttvProfilePicked');
  } catch {
    return false;
  }
}
export function markProfilePicked() {
  try {
    sessionStorage.setItem('lttvProfilePicked', '1');
  } catch {
    /* ignore */
  }
}

// ---------------- with the account in the cloud ----------------

export interface ProfilesBundle {
  list: Profile[];
  deleted: string[];
  at: number;
  data: Record<string, ProfileData>;
}

/** Everything about the profiles, for saving with the account. */
export async function exportProfiles(): Promise<ProfilesBundle | undefined> {
  if (!kv) return undefined;
  const data: Record<string, ProfileData> = {};
  for (const p of doc.list) {
    data[p.id] = {
      fav: (await kv.getKv<ProfileData['fav']>(k('fav', p.id))) ?? {},
      recents: (await kv.getKv<RecentEntry[]>(k('recents', p.id))) ?? [],
      vodResume: (await kv.getKv<Record<string, unknown>>(k('vodResume', p.id))) ?? {},
      at: (await kv.getKv<number>(k('profileAt', p.id))) ?? 0,
    };
  }
  return { list: doc.list, deleted: doc.deleted, at: doc.at, data };
}

/**
 * Merge the account's saved profiles into this device: deletions win, the newer list wins for names / colors, and
 * each profile's favorites / progress / recents come from whichever copy changed last. Returns whether the profile
 * in use changed (the caller reloads what's on screen).
 */
export async function mergeProfiles(remote: ProfilesBundle | undefined): Promise<{ currentChanged: boolean; changed: boolean }> {
  if (!kv || !remote || !Array.isArray(remote.list)) return { currentChanged: false, changed: false };
  const deleted = new Set([...(doc.deleted ?? []), ...(remote.deleted ?? [])]);
  const newer = (remote.at ?? 0) > doc.at ? remote.list : doc.list;
  const older = newer === remote.list ? doc.list : remote.list;
  const list = [...newer, ...older.filter((p) => !newer.some((n) => n.id === p.id))].filter((p) => !deleted.has(p.id));
  let changed = JSON.stringify(list) !== JSON.stringify(doc.list) || deleted.size !== doc.deleted.length;
  let currentChanged = false;
  for (const p of list) {
    const r = remote.data?.[p.id];
    if (!r) continue;
    const localAt = (await kv.getKv<number>(k('profileAt', p.id))) ?? 0;
    if (r.at > localAt) {
      await kv.setKv(k('fav', p.id), r.fav ?? {});
      await kv.setKv(k('recents', p.id), r.recents ?? []);
      await kv.setKv(k('vodResume', p.id), r.vodResume ?? {});
      await kv.setKv(k('profileAt', p.id), r.at);
      changed = true;
      if (p.id === current) currentChanged = true;
    }
  }
  for (const id of deleted) if (!doc.deleted.includes(id)) for (const what of ['fav', 'recents', 'vodResume', 'profileAt'] as const) await kv.setKv(k(what, id), undefined);
  if (list.length) {
    doc = { ...doc, list, deleted: [...deleted], at: Math.max(doc.at, remote.at ?? 0) };
    await kv.setKv(DOC, doc);
  }
  if (!list.some((p) => p.id === current) && list.length) {
    current = list[0].id;
    currentChanged = true;
  }
  if (currentChanged) fav = (await kv.getKv<ProfileData['fav']>(k('fav', current))) ?? {};
  if (changed) notify();
  return { currentChanged, changed };
}
