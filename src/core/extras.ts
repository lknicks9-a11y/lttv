// Guide data from places other than the XMLTV file:
//  - "provider": the IPTV provider's own per-channel guide (Xtream get_short_epg), used
//    for channels the guide file doesn't cover;
//  - "event": the game written into a live-event channel's name ("NFL 03: Bills vs Jets").
// These are layered on top of the stored matches at display time; nothing here changes
// the user's match decisions.
import type { LineupChannel, MatchResult } from './types';
import type { GuideIndex } from './guide';
import { isUsableMatch } from './match';
import { eventProgramme, isEventChannel, isMeaningfulTitle, parseEventName } from './events';
import { isXtreamLive, xtreamStreamRef } from './xtream';
import { expectsEnglish, mostlyForeign } from './lang';

export const EVENT_REF = 'evt|';
export const PROVIDER_REF = 'xt|';

const refCache = new Map<string, string | undefined>();

/** Guide reference for a channel's provider guide, if its URL is an Xtream-style live stream. */
export function providerRef(url: string): string | undefined {
  if (refCache.has(url)) return refCache.get(url);
  if (refCache.size > 100_000) refCache.clear();
  const r = computeProviderRef(url);
  refCache.set(url, r);
  return r;
}

function computeProviderRef(url: string): string | undefined {
  if (!isXtreamLive(url)) return undefined;
  const r = xtreamStreamRef(url);
  if (!r) return undefined;
  try {
    return `${PROVIDER_REF}${new URL(url).host}|${r.id}`;
  } catch {
    return undefined;
  }
}

/** player_api.php request for a channel's upcoming programmes. */
export function shortEpgUrl(streamUrl: string, limit = 12): string | undefined {
  const r = xtreamStreamRef(streamUrl);
  if (!r || !isXtreamLive(streamUrl)) return undefined;
  const q = new URLSearchParams({ username: r.user, password: r.pass, action: 'get_short_epg', stream_id: r.id, limit: String(limit) });
  return `${r.base}/player_api.php?${q.toString()}`;
}

export interface ExtrasOptions {
  now: number;
  /** Display time zone ('' = device), used for times in channel names without a zone. */
  timeZone?: string;
  eventNames: boolean;
  providerGuide: boolean;
  /** English channels whose guide is in another script switch to an English source when there is one. */
  preferEnglish?: boolean;
  /** Channel key -> another guide channel (already in `guide`) with the same channel in English. */
  englishAlt?: Map<string, string>;
  /** Channel key -> the guide channel of its New York station (WNBC…) when the match was another market's. */
  stationAlt?: Map<string, string>;
}

/** The guide around now is mostly in a foreign script (Arabic etc.). */
export function foreignNear(guide: GuideIndex, ref: string, now: number): boolean {
  return mostlyForeign(guide.range(ref, now - 3600_000, now + 6 * 3600_000));
}

/** Channels that currently have an event programme in the guide (so it can be removed later). */
const hadEvent = new Set<string>();
const nameCache = new Map<string, { bucket: number; ev: ReturnType<typeof parseEventName> }>();

/** parseEventName, reused for 10 minutes per name (names only change on playlist refresh). */
function cachedEventName(name: string, now: number, tz?: string) {
  const bucket = Math.floor(now / 600_000);
  const k = `${name}\u0000${tz ?? ''}`;
  const hit = nameCache.get(k);
  if (hit && hit.bucket === bucket) return hit.ev;
  if (nameCache.size > 50_000) nameCache.clear();
  const ev = parseEventName(name, now, tz);
  nameCache.set(k, { bucket, ev });
  return ev;
}

/** Does the matched guide say anything real about this channel around now? */
function meaningfulNear(guide: GuideIndex, ref: string, ch: LineupChannel, now: number): boolean {
  return guide.range(ref, now - 30 * 60_000, now + 4 * 3600_000).some((p) => isMeaningfulTitle(p.title, ch));
}

/**
 * Return the lineup and matches as the screens should see them. Event programmes are
 * written into `guide` (refs "evt|<channel key>"); provider programmes must already be
 * in `guide` (refs from providerRef()).
 */
export function applyGuideExtras(
  lineup: LineupChannel[],
  raw: Map<string, MatchResult>,
  guide: GuideIndex,
  opts: ExtrasOptions,
): { lineup: LineupChannel[]; matches: Map<string, MatchResult>; events: number; provider: number } {
  const matches = new Map(raw);
  let events = 0;
  let provider = 0;
  const out = lineup.map((ch) => {
    const m = raw.get(ch.key);
    const realRef = isUsableMatch(m) ? m!.epgChannelId! : undefined;
    const hasReal = !!realRef && guide.has(realRef);
    let use: { ref: string; method: 'event' | 'provider' | 'english' | 'station' } | undefined;

    const isEvent = isEventChannel(ch);
    if (isEvent || hadEvent.has(ch.key)) {
      const evRef = EVENT_REF + ch.key;
      const p = opts.eventNames && isEvent ? eventProgramme(evRef, cachedEventName(ch.originalName, opts.now, opts.timeZone), opts.now) : undefined;
      if (p) {
        guide.set(evRef, [p]);
        hadEvent.add(ch.key);
        if (!hasReal || !meaningfulNear(guide, realRef!, ch, opts.now)) use = { ref: evRef, method: 'event' };
      } else {
        guide.delete(evRef);
        hadEvent.delete(ch.key);
      }
    }

    // My TV New York local matched to another city's guide: use the New York station's own listings.
    const st = opts.stationAlt?.get(ch.key);
    if (!use && st && guide.has(st)) use = { ref: st, method: 'station' };
    if (!use && opts.providerGuide && (!hasReal || (isEvent && !meaningfulNear(guide, realRef!, ch, opts.now)))) {
      const pr = providerRef(ch.url);
      if (pr && guide.has(pr)) use = { ref: pr, method: 'provider' };
    }
    // English channel, guide text in Arabic/Cyrillic/…: use an English source for it if one exists.
    if (!use && opts.preferEnglish && hasReal && expectsEnglish(ch) && foreignNear(guide, realRef!, opts.now)) {
      const alt = opts.englishAlt?.get(ch.key);
      const pr = opts.providerGuide ? providerRef(ch.url) : undefined;
      if (alt && guide.has(alt) && !foreignNear(guide, alt, opts.now)) use = { ref: alt, method: 'english' };
      else if (pr && guide.has(pr) && !foreignNear(guide, pr, opts.now)) use = { ref: pr, method: 'provider' };
    }
    if (!use) return ch;
    if (use.method === 'event') events++;
    else provider++;
    matches.set(ch.key, { key: ch.key, epgChannelId: use.ref, method: use.method, confidence: 1, status: 'auto', candidates: m?.candidates });
    return { ...ch, epgChannelId: use.ref, matchStatus: 'auto' as const, matchMethod: use.method, matchConfidence: 1 };
  });
  return { lineup: out, matches, events, provider };
}

/** Should LTTV ask the provider for this channel's guide? (No usable guide-file data for it.) */
export function needsProviderGuide(ch: LineupChannel, guide: GuideIndex, now = Date.now()): boolean {
  if (ch.matchMethod === 'provider') return true; // keep it fresh
  if (ch.matchMethod === 'event') return false;
  const real = ch.epgChannelId && (ch.matchStatus === 'auto' || ch.matchStatus === 'approved');
  if (real && guide.has(ch.epgChannelId)) {
    if (expectsEnglish(ch) && foreignNear(guide, ch.epgChannelId!, now)) return true; // look for English text
    return isEventChannel(ch); // event slots often have empty guide-file entries
  }
  return true;
}
