import type {
  CategoryId, ChannelCustomization, LineupChannel, MatchResult, MyTvPin, ParsedChannel, RecentEntry, SortMode,
} from './types';
import { categorize, cleanChannelNames, normalizeGroupTitle, normalizeForMatch, CATEGORY_ORDER } from './normalize';
import { assignMyTv, channelCountry, portableName } from './mytv';
import { countryName, countryFromTag, countryOfGroup, groupCountryCode } from './countries';
import { getPrefixTag } from './normalize';
import { isAdultChannel } from './adult';

export interface DuplicateInfo {
  /** key -> key of the first channel it duplicates */
  duplicateOf: Map<string, string>;
  groups: { keys: string[]; reason: 'same-url' | 'same-name' }[];
}

function urlIdentity(url: string): string {
  // Ignore trailing slashes and fragment; keep query (it often identifies the stream).
  return url.trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
}

/**
 * Detect duplicates without merging anything:
 *  - same stream URL => definite duplicate
 *  - same normalised name AND same tvg-id (or both empty) AND same quality => probable duplicate
 * Channels that differ by HD/4K, +1, region or number are NOT duplicates.
 */
export function detectDuplicates(channels: ParsedChannel[], cleaned?: Map<string, string>): DuplicateInfo {
  const duplicateOf = new Map<string, string>();
  const groups: DuplicateInfo['groups'] = [];
  const byUrl = new Map<string, string[]>();
  for (const c of channels) {
    const k = urlIdentity(c.url);
    const arr = byUrl.get(k);
    if (arr) arr.push(c.key);
    else byUrl.set(k, [c.key]);
  }
  for (const keys of byUrl.values()) {
    if (keys.length < 2) continue;
    groups.push({ keys, reason: 'same-url' });
    for (const k of keys.slice(1)) duplicateOf.set(k, keys[0]);
  }
  const quality = (n: string) => (/\b(4k|uhd|2160p)\b/i.test(n) ? 'uhd' : /\b(f?hd|1080p|720p)\b/i.test(n) ? 'hd' : /\bsd\b/i.test(n) ? 'sd' : '');
  const byName = new Map<string, string[]>();
  for (const c of channels) {
    if (duplicateOf.has(c.key)) continue;
    const name = cleaned?.get(c.key) ?? c.originalName;
    const nk = normalizeForMatch(name);
    if (!nk) continue;
    const k = `${nk}|${(c.tvgId || '').toLowerCase()}|${quality(name)}`;
    const arr = byName.get(k);
    if (arr) arr.push(c.key);
    else byName.set(k, [c.key]);
  }
  for (const keys of byName.values()) {
    if (keys.length < 2) continue;
    groups.push({ keys, reason: 'same-name' });
    for (const k of keys.slice(1)) duplicateOf.set(k, keys[0]);
  }
  return { duplicateOf, groups };
}

function withUserAgent(h: Record<string, string> | undefined, ua: string | undefined): Record<string, string> | undefined {
  if (!ua || (h && Object.keys(h).some((k) => k.toLowerCase() === 'user-agent'))) return h;
  return { ...(h ?? {}), 'User-Agent': ua };
}

export interface LineupInput {
  channels: ParsedChannel[]; // all enabled playlists, in playlist order
  customizations: Map<string, ChannelCustomization>;
  matches: Map<string, MatchResult>;
  playlistOrder?: string[]; // playlist ids in display order
  /** User-Agent per playlist, applied to its streams unless the channel sets its own. */
  playlistUserAgents?: Map<string, string>;
  /** Number channels with My TV (DIRECTV New York/NJ) numbers; others follow from 1000. */
  myTvNumbers?: boolean;
  /** Guide channel ("source|id") -> its display names: tells which city's station a plain "NBC" is. */
  epgNames?: Map<string, string[]>;
  /** Streams chosen for My TV numbers. */
  myTvPins?: MyTvPin[];
}

/**
 * Your changes (renames, favorites, hidden, numbers, categories) to channels that are
 * no longer in any playlist — e.g. after switching provider — move to the channel that
 * is the same one now: same tvg-id, else the same name once provider prefixes and
 * quality words are ignored. Each old change is used once.
 */
export function carryOverCustomizations(channels: ParsedChannel[], customizations: Map<string, ChannelCustomization>): Map<string, ChannelCustomization> {
  const present = new Set(channels.map((c) => c.key));
  const byId = new Map<string, ChannelCustomization>();
  const byName = new Map<string, ChannelCustomization>();
  for (const cu of customizations.values()) {
    if (present.has(cu.key) || !cu.ident) continue;
    const meaningful = cu.name || cu.favorite || cu.hidden || cu.number !== undefined || cu.category;
    if (!meaningful) continue;
    if (cu.ident.tvgId && !byId.has(cu.ident.tvgId.toLowerCase())) byId.set(cu.ident.tvgId.toLowerCase(), cu);
    const pn = portableName(cu.ident.name);
    if (pn && !byName.has(pn)) byName.set(pn, cu);
  }
  if (!byId.size && !byName.size) return customizations;
  const out = new Map(customizations);
  const used = new Set<string>();
  for (const c of channels) {
    if (out.has(c.key)) continue;
    const cand = (c.tvgId && byId.get(c.tvgId.toLowerCase())) || byName.get(portableName(c.originalName));
    if (!cand || used.has(cand.key)) continue;
    used.add(cand.key);
    const { key: _old, order: _o, ...rest } = cand;
    out.set(c.key, { ...rest, key: c.key, ident: { name: c.originalName, tvgId: c.tvgId } });
  }
  return out;
}

/** Combine parsed channels with user customisations into display channels. */
export function buildLineup(input: LineupInput): LineupChannel[] {
  // Adult (XXX) channels are left out of the lineup entirely.
  const channels = input.channels.filter((c) => !isAdultChannel(c.groupTitle, c.originalName));
  const { matches } = input;
  const customizations = carryOverCustomizations(channels, input.customizations);
  const order = input.playlistOrder ?? [];
  const sorted = [...channels].sort((a, b) => {
    const pa = order.indexOf(a.playlistId);
    const pb = order.indexOf(b.playlistId);
    return pa - pb || a.index - b.index;
  });
  const cleaned = cleanChannelNames(sorted);
  const dups = detectDuplicates(sorted, cleaned);

  // Channel numbers: custom > tvg-chno > sequential (skipping numbers already taken).
  const taken = new Set<number>();
  for (const c of sorted) {
    const n = customizations.get(c.key)?.number ?? c.tvgChno;
    if (n !== undefined) taken.add(n);
  }
  let next = 1;
  const out: LineupChannel[] = [];
  sorted.forEach((c, i) => {
    const cu = customizations.get(c.key);
    let number = cu?.number ?? c.tvgChno;
    if (number === undefined) {
      while (taken.has(next)) next++;
      number = next;
      taken.add(next);
    }
    const cleanedName = cleaned.get(c.key) ?? c.originalName;
    const group = normalizeGroupTitle(c.groupTitle);
    const auto = categorize(group ?? c.groupTitle, cleanedName, c.radio);
    const m = matches.get(c.key);
    out.push({
      key: c.key,
      playlistId: c.playlistId,
      index: i,
      number,
      name: cu?.name?.trim() || cleanedName,
      originalName: c.originalName,
      cleanedName,
      logo: c.tvgLogo,
      url: c.url,
      headers: withUserAgent(c.headers, input.playlistUserAgents?.get(c.playlistId)),
      group,
      category: cu?.category ?? auto.category,
      categoryEvidence: cu?.category ? 'user' : auto.evidence,
      favorite: !!cu?.favorite,
      hidden: !!cu?.hidden,
      order: cu?.order ?? i,
      epgChannelId: m?.epgChannelId,
      matchStatus: m?.status ?? 'unmatched',
      matchMethod: m?.method ?? 'none',
      matchConfidence: m?.confidence ?? 0,
      duplicateOf: dups.duplicateOf.get(c.key),
      tvgId: c.tvgId,
      country: channelCountry({ originalName: c.originalName, group: group ?? c.groupTitle }),
    });
  });
  assignGroupCountries(out, new Map(sorted.map((c) => [c.key, c.groupTitle])));
  const mytv = assignMyTv(out, input.epgNames ? (r) => input.epgNames!.get(r) : undefined, input.myTvPins ?? []);
  for (const ch of out) {
    const n = mytv.get(ch.key);
    if (n !== undefined) ch.myTv = n;
    if (input.myTvNumbers && customizations.get(ch.key)?.number === undefined) {
      ch.playlistNumber = ch.number;
      ch.number = n ?? (ch.number < 1000 ? ch.number + 1000 : ch.number);
    }
  }
  return out;
}

/**
 * Country tabs follow the provider's own country code on the group ("US| SPORTS",
 * "CA| NEWS", "UK: MOVIES", "ES| DEPORTES"): every channel in a group goes under that
 * group's country, so each provider category sits under exactly one country tab.
 * Groups without a code take the code most of their channels' names carry ("US: ESPN"),
 * then the country most of them look like; otherwise they're under "Other".
 */
export function assignGroupCountries(list: LineupChannel[], rawGroups: Map<string, string | undefined>) {
  const groups = new Map<string, LineupChannel[]>();
  for (const c of list) {
    const k = `${c.playlistId}\u0000${rawGroups.get(c.key) ?? ''}`;
    const a = groups.get(k);
    if (a) a.push(c);
    else groups.set(k, [c]);
  }
  for (const [k, chans] of groups) {
    const raw = k.slice(k.indexOf('\u0000') + 1);
    const coded = groupCountryCode(raw);
    let key = coded?.key;
    let code = coded?.code;
    if (!key) {
      const tally = new Map<string, number>();
      for (const c of chans) {
        const t = getPrefixTag(c.originalName) ?? /^\s*([A-Z]{2,3})\s+\S/.exec(c.originalName)?.[1];
        const ck = t ? countryFromTag(t, true) : undefined;
        if (ck) tally.set(ck + '|' + t!.toUpperCase(), (tally.get(ck + '|' + t!.toUpperCase()) ?? 0) + 1);
      }
      const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] * 2 >= chans.length) [key, code] = top[0].split('|');
    }
    if (!key) {
      const tally = new Map<string, number>();
      for (const c of chans) if (c.country) tally.set(c.country, (tally.get(c.country) ?? 0) + 1);
      key = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    }
    for (const c of chans) {
      c.country = key;
      c.countryCode = key ? code ?? displayCode(key) : undefined;
    }
  }
}

function displayCode(key: string): string {
  return key === 'ar_country' ? 'AR' : key === 'latam' ? 'LATAM' : key === 'exyu' ? 'EXYU' : key.toUpperCase();
}

/** Display label for a country code. */
export function countryLabel(code: string | undefined): string {
  return code ? countryName(code) : 'Other';
}

const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;
const cmpName = (a: string, b: string) => (collator ? collator.compare(a, b) : a.localeCompare(b));

export function sortLineup(list: LineupChannel[], mode: SortMode, recents: RecentEntry[] = []): LineupChannel[] {
  const arr = [...list];
  const recentRank = new Map(recents.map((r, i) => [r.key, i]));
  switch (mode) {
    case 'playlist':
      return arr.sort((a, b) => a.index - b.index);
    case 'alpha':
      return arr.sort((a, b) => cmpName(a.name, b.name) || a.number - b.number);
    case 'number':
      return arr.sort((a, b) => a.number - b.number || a.index - b.index);
    case 'category':
      return arr.sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.number - b.number);
    case 'favorites':
      return arr.sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.number - b.number);
    case 'recent':
      return arr.sort((a, b) => (recentRank.get(a.key) ?? 1e9) - (recentRank.get(b.key) ?? 1e9) || a.number - b.number);
    case 'custom':
      return arr.sort((a, b) => a.order - b.order || a.index - b.index);
    case 'mytv':
      // My TV channels by their DIRECTV number, then everything else.
      return arr.sort((a, b) => (a.myTv ?? 1e6) - (b.myTv ?? 1e6) || a.number - b.number || a.index - b.index);
    case 'country': {
      // United States first, then countries A–Z, channels without a country last.
      const rank = (c?: string) => (c === 'us' ? '0' : c ? '1' + countryLabel(c) : '2');
      return arr.sort((a, b) => rank(a.country).localeCompare(rank(b.country)) || a.number - b.number || a.index - b.index);
    }
    case 'provider':
      // Playlist (provider) order, then channel number within each.
      return arr.sort((a, b) => providerRank(a) - providerRank(b) || a.number - b.number || a.index - b.index);
  }
}

let providerOrder: string[] = [];
/** Order of playlists for the "provider" sort (set from the sources list). */
export function setProviderOrder(ids: string[]) {
  providerOrder = ids;
}
function providerRank(c: LineupChannel): number {
  const i = providerOrder.indexOf(c.playlistId);
  return i < 0 ? 1e6 : i;
}

export type CategoryFilter = 'all' | 'favorites' | 'recent' | 'mytv' | CategoryId | `group:${string}` | `country:${string}` | `provider:${string}`;

export function filterLineup(list: LineupChannel[], filter: CategoryFilter, opts: { showHidden?: boolean; recents?: RecentEntry[] } = {}): LineupChannel[] {
  const visible = opts.showHidden ? list : list.filter((c) => !c.hidden);
  if (filter === 'all') return visible;
  if (filter === 'favorites') return visible.filter((c) => c.favorite);
  if (filter === 'recent') {
    const keys = (opts.recents ?? []).map((r) => r.key);
    const byKey = new Map(visible.map((c) => [c.key, c]));
    return keys.map((k) => byKey.get(k)).filter((c): c is LineupChannel => !!c);
  }
  if (filter === 'mytv') return visible.filter((c) => c.myTv !== undefined).sort((a, b) => a.myTv! - b.myTv!);
  if (filter.startsWith('group:')) {
    const g = filter.slice(6);
    return visible.filter((c) => c.group === g);
  }
  if (filter.startsWith('country:')) {
    // "country:us", "country:us|mytv", "country:us|group:USA · AT&T"
    const [k, sub] = filter.slice(8).split(/\|(.*)/s);
    const inCountry = visible.filter((c) => (c.country ?? 'none') === k);
    if (sub === 'mytv') return inCountry.filter((c) => c.myTv !== undefined).sort((a, b) => a.myTv! - b.myTv!);
    if (sub?.startsWith('sub:')) {
      const label = sub.slice(4);
      return inCountry.filter((c) => subProviderLabel(c.group, k) === label);
    }
    if (sub?.startsWith('group:')) {
      const g = sub.slice(6);
      return inCountry.filter((c) => (c.group ?? '') === g);
    }
    return inCountry;
  }
  if (filter.startsWith('provider:')) {
    const id = filter.slice(9);
    return visible.filter((c) => c.playlistId === id);
  }
  return visible.filter((c) => c.category === filter);
}

export function categoryCounts(list: LineupChannel[]): Map<CategoryId, number> {
  const m = new Map<CategoryId, number>();
  for (const c of list) if (!c.hidden) m.set(c.category, (m.get(c.category) ?? 0) + 1);
  return m;
}

/**
 * Move a channel within a custom order. Returns new customisation entries
 * (order values) for all channels in `ordered`.
 */
export function reorder(ordered: LineupChannel[], fromKey: string, toIndex: number): Map<string, number> {
  const arr = ordered.map((c) => c.key);
  const from = arr.indexOf(fromKey);
  if (from < 0) return new Map();
  arr.splice(from, 1);
  arr.splice(Math.max(0, Math.min(arr.length, toIndex)), 0, fromKey);
  return new Map(arr.map((k, i) => [k, i]));
}

/** Next/previous channel for zapping, wrapping around. */
export function adjacentChannel(list: LineupChannel[], currentKey: string | undefined, dir: 1 | -1): LineupChannel | undefined {
  if (!list.length) return undefined;
  const i = list.findIndex((c) => c.key === currentKey);
  if (i < 0) return list[0];
  return list[(i + dir + list.length) % list.length];
}

/**
 * A provider group's name without the country part, for the country menu:
 * "USA · AT&T" -> "AT&T", "US| DIRECTV" -> "DIRECTV", "USA" -> "General".
 */
export function subProviderLabel(group: string | undefined, country: string): string {
  if (!group) return 'General';
  const isCountry = (t: string) => countryFromTag(t, true) === country || (countryOfGroup(t) === country && fullCountryWords(t));
  const parts = group.split(/\s*(?:·|\||:|»)\s*/).filter(Boolean);
  if (parts.length && isCountry(parts[0])) parts.shift();
  else if (parts.length) {
    // "USA Sports" -> "Sports", "United States Locals" -> "Locals"
    const m = /^(united states|united kingdom|[a-z]{2,3})\s+(.+)$/i.exec(parts[0]);
    if (m && isCountry(m[1])) parts[0] = m[2];
  }
  return parts.join(' · ').trim() || 'General';
}

/** The whole text is just a country's name/code (so it can be dropped from a group label). */
function fullCountryWords(t: string): boolean {
  return /^(?:the\s+)?[a-z.]+(?:\s+[a-z.]+)?$/i.test(t.trim()) && t.trim().split(/\s+/).length <= 2 && !/\b(sports?|news|kids|movies|entertainment|music|local|locals|ppv|events?|general)\b/i.test(t);
}

export interface SubProvider {
  id: string; // filter suffix: "mytv" or "group:<original group>"
  label: string;
  count: number;
}

const subCache = new WeakMap<LineupChannel[], Map<string, SubProvider[]>>();

/**
 * The menu shown when a country tab is chosen: My TV (US), then every one of the
 * playlist's own groups for that country, in the provider's order. Each original
 * group is its own entry; the country word is dropped from the label unless two
 * groups would then read the same.
 */
export function subProviders(lineup: LineupChannel[], country: string): SubProvider[] {
  let byCountry = subCache.get(lineup);
  if (!byCountry) subCache.set(lineup, (byCountry = new Map()));
  const hit = byCountry.get(country);
  if (hit) return hit;
  const inCountry = lineup.filter((c) => !c.hidden && (c.country ?? 'none') === country);
  const out: SubProvider[] = [];
  const myTv = inCountry.filter((c) => c.myTv !== undefined).length;
  if (myTv) out.push({ id: 'mytv', label: 'My TV', count: myTv });
  const groups = new Map<string, { n: number; first: number }>();
  for (const c of inCountry) {
    const g = c.group ?? '';
    const e = groups.get(g);
    if (e) e.n++;
    else groups.set(g, { n: 1, first: c.index });
  }
  const entries = [...groups.entries()].sort((a, b) => a[1].first - b[1].first);
  const short = entries.map(([g]) => (g ? subProviderLabel(g, country) : 'Ungrouped'));
  const seen = new Map<string, number>();
  for (const s of short) seen.set(s.toLowerCase(), (seen.get(s.toLowerCase()) ?? 0) + 1);
  entries.forEach(([g, e], i) => {
    const label = (seen.get(short[i].toLowerCase()) ?? 0) > 1 && g ? g : short[i];
    out.push({ id: `group:${g}`, label, count: e.n });
  });
  byCountry.set(country, out);
  return out;
}
