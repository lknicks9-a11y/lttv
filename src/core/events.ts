// Live sports "event channels": provider slots such as "NFL 03", "PPV 2" or "ESPN+ 14"
// that carry a different game every day. Many providers write the game into the
// channel name ("NBA 05: Lakers vs Celtics @ 7:30 PM ET"); others only list it in
// the guide. LTTV shows what's actually on instead of the bare slot name.
import type { LineupChannel, Programme } from './types';
import type { GuideIndex } from './guide';
import { dayKey, isValidTimeZone, zonedTimeToUtc } from './time';

/** Leading words that mark a numbered slot as an event channel (not a linear channel like "ESPN 2"). */
const EVENT_PREFIX = /^(?:ppv|pay ?per ?view|events?|live events?|live|game|match|ncaa[fbm]?|ncaa ?(?:football|basketball)|college ?(?:football|basketball|sports)?|cfb|cbb|nfl|nba|wnba|nhl|mlb|mls|nwsl|xfl|ufl|ufc|pfl|bellator|boxing|wwe|aew|nascar|indycar|f1|formula ?1|motogp|espn ?(?:\+|plus)|espn ?(?:college )?extra|espn ?3|espn ?unlimited|peacock|paramount ?(?:\+|plus)?|dazn|fubo|flo ?\w*|fanatiz|victory ?\+?|sec ?(?:\+|plus|network ?\+)|acc ?(?:extra|network ?extra|\+)|big ?(?:ten|10) ?(?:\+|plus)|b1g ?\+?|pac ?12 ?(?:\+|plus)?|nfl ?(?:sunday ticket|game ?pass|\+|plus)|sunday ticket|nba ?league ?pass|league ?pass|nhl ?(?:center ice|\+|power play|tv)|center ice|mlb ?(?:extra innings|tv|\.tv)|extra innings|mls ?(?:season ?pass|direct ?kick)|season ?pass|direct ?kick|apple ?tv ?\+?|prime ?(?:video)?|amazon ?prime|tsn ?\+?|sportsnet ?\+?|sn ?\+|kayo|optus|bein ?(?:connect|sports ?connect)|sky ?sports ?(?:\+|plus|box ?office)|box ?office|tnt ?sports ?(?:box ?office|ppv)|uefa|ucl|epl|premier ?league|la ?liga|laliga|serie ?a|bundesliga|ligue ?1|eredivisie|liga ?mx|copa|champions ?league|europa ?league|tennis|atp|wta|golf|pga|liv|cricket|ipl|rugby|nrl|afl|darts|snooker|cycling|volleyball|lacrosse|hockey|baseball|basketball|football|soccer|fight|fights|combat|mma|racing)(?![a-z0-9])/i;

/** Group titles that hold event slots. */
const EVENT_GROUP = /\b(ppv|pay ?per ?view|events?|live ?events?|sports? ?events?|game ?pass|league ?pass|season ?pass|sunday ticket|center ice|extra innings|direct ?kick|espn ?\+|espn ?plus|peacock|paramount|dazn|flo ?sports?|fubo|victory|b1g ?\+|big ?ten ?\+|sec ?\+|acc ?extra|matchday|match ?center|ncaa|college|ufc|boxing|wwe)\b|\+/i;

const IDLE = /^(?:-+|\.+|_+|n\/?a|none|tba|tbd|tbc|to be (?:announced|determined|confirmed)|no (?:event|game|games|match|broadcast|programme|program|info(?:rmation)?|stream|signal|live event)s?(?: (?:scheduled|today|now|available|at this time))?|off ?air|offline|stand ?by|coming soon|event (?:ended|over|finished)|ended|closed|not live|no live events?|channel off|stream offline|break|replay soon)$/i;

const QUALITY = /\b(?:f?hd|uhd|sd|4k|8k|hevc|h\.?26[45]|\d{3,4}p|[56]0 ?fps|raw|backup|alt|vip|ᴴᴰ|ᶠᴴᴰ|ᵁᴴᴰ|ᴿᴬᵂ)\b/gi;

/** Does this programme / name text describe a real listing (not "No event", not the slot name itself)? */
export function isMeaningfulTitle(title: string | undefined, ch?: Pick<LineupChannel, 'name' | 'originalName' | 'cleanedName'>): boolean {
  if (!title) return false;
  const t = title.replace(QUALITY, '').replace(/[\s:|\-–—•·*#]+/g, ' ').trim();
  if (t.length < 3 || IDLE.test(t)) return false;
  if (/^(?:no |off ?air|offline|tba\b|tbd\b|stand ?by)/i.test(t)) return false;
  if (ch) {
    const k = (s: string) => s.toLowerCase().replace(QUALITY, '').replace(/[^\p{L}\p{N}+]+/gu, '');
    const tk = k(t);
    if (tk === k(ch.name) || tk === k(ch.cleanedName) || tk === k(ch.originalName)) return false;
    if (tk === k(splitSlot(ch.originalName).label)) return false;
  }
  return true;
}

/** Split "NBA 05: Lakers vs Celtics 7:30 PM ET" into slot label and the rest. */
export function splitSlot(name: string): { label: string; rest: string } {
  let s = name.normalize('NFC').replace(/[★☆✪●◉■◆▶►⚡🔴🟢]/gu, ' ').replace(/[ᴬ-ᵡᶠᶦ-ᶻ⁰-⁹ʰ-ˤ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  // Drop a leading country tag ("US:", "USA |", "|UK|").
  s = s.replace(/^\s*(?!(?:NBA|NFL|NHL|MLB|MLS|PPV|UFC|WWE|AEW|EPL|UCL|F1|CFB|CBB|DAZN|ESPN)\b)(?:\|[A-Z]{2,4}\||\[[A-Z]{2,4}\]|[A-Z]{2,4}\s*[:|»])\s*/, '');
  // label = text up to and including the slot number, e.g. "NBA 05", "ESPN+ 14", "PPV 2"
  const m = /^(.{1,40}?\d{1,3})(?:\s*[:|•»\-–—]\s*|\s*\(\s*|\s+(?=\S*[A-Za-z]))(.*)$/.exec(s);
  if (m && /[A-Za-z]/.test(m[1])) return { label: m[1].replace(QUALITY, '').replace(/\s+/g, ' ').trim(), rest: m[2].replace(/\)\s*$/, '').trim() };
  const sep = /^(.+?)\s*[:|•»]\s*(.+)$/.exec(s);
  if (sep) return { label: sep[1].trim(), rest: sep[2].trim() };
  return { label: s.replace(QUALITY, '').replace(/\s+/g, ' ').trim(), rest: '' };
}

const GAME = /\s(?:vs\.?|v\.?|versus|at|@|x)\s/i;

/**
 * Is this channel a numbered event slot? Linear channels that happen to carry a
 * number ("ESPN 2", "Sky Sports 1", "beIN Sports 3") are not.
 */
const eventCache = new Map<string, boolean>();

export function isEventChannel(ch: Pick<LineupChannel, 'originalName' | 'group' | 'category'>): boolean {
  const ck = `${ch.originalName}\u0000${ch.group ?? ''}\u0000${ch.category}`;
  let v = eventCache.get(ck);
  if (v === undefined) {
    if (eventCache.size > 50_000) eventCache.clear();
    eventCache.set(ck, (v = detectEventChannel(ch)));
  }
  return v;
}

function detectEventChannel(ch: Pick<LineupChannel, 'originalName' | 'group' | 'category'>): boolean {
  // Quick reject: event slots carry a number or a game ("A vs B").
  if (!/\d/.test(ch.originalName) && !GAME.test(` ${ch.originalName} `)) return false;
  const { label, rest } = splitSlot(ch.originalName);
  const group = ch.group ?? '';
  const numbered = /\d{1,3}\s*$/.test(label);
  // A game written into the name is the strongest signal.
  if (rest && GAME.test(` ${rest} `) && (ch.category === 'sports' || EVENT_PREFIX.test(label) || EVENT_GROUP.test(group))) return true;
  if (!numbered) return false;
  const base = label.replace(/[#:\s]*\d{1,3}\s*$/, '').trim();
  if (EVENT_PREFIX.test(base) && !/^(?:espn|fox sports|fs|sky sports|bein sports|tsn|sportsnet|sn|bt sport|tnt sports|eurosport|dazn|super ?sport|arena sport|sport ?klub|setanta|nbcsn|cbs sports)$/i.test(base)) return true;
  if (EVENT_GROUP.test(group) && (ch.category === 'sports' || /sport|event|ppv|pass/i.test(group))) {
    // Zero-padded or high slot numbers are event slots ("ESPN+ 07", "DAZN 23").
    if (/\b0\d\s*$/.test(label) || Number(/\d{1,3}\s*$/.exec(label)![0]) > 4 || EVENT_PREFIX.test(base)) return true;
  }
  return false;
}

const ZONES: Record<string, string> = {
  ET: 'America/New_York', EST: 'America/New_York', EDT: 'America/New_York',
  CT: 'America/Chicago', CST: 'America/Chicago', CDT: 'America/Chicago',
  MT: 'America/Denver', MST: 'America/Denver', MDT: 'America/Denver',
  PT: 'America/Los_Angeles', PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles',
  UK: 'Europe/London', GMT: 'Europe/London', BST: 'Europe/London',
  CET: 'Europe/Paris', CEST: 'Europe/Paris', UTC: 'UTC',
  AEST: 'Australia/Sydney', AEDT: 'Australia/Sydney',
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const TIME_RE = new RegExp(
  String.raw`(?:\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s*)?` +
  String.raw`(?:\b(?<mon>jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(?<mday>\d{1,2})(?:st|nd|rd|th)?,?\s*|\b(?<nm>\d{1,2})[/.](?<nd>\d{1,2})(?:[/.]\d{2,4})?\s+)?` +
  String.raw`(?:@\s*|at\s+)?` +
  String.raw`\b(?<h>\d{1,2})(?:[:.h](?<mi>\d{2}))?\s*(?<ap>am|pm|a\.m\.?|p\.m\.?)?\s*\(?\s*(?<z>ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT|UK|GMT|BST|CET|CEST|UTC|AEST|AEDT)?\b\)?`,
  'i',
);

export interface NameEvent {
  label: string;
  title: string;
  start?: number;
}

/** Find a start time in event text. Needs h:mm or am/pm to avoid "UFC 310". */
export function parseEventTime(text: string, now: number, displayZone = ''): { start: number; match: string } | undefined {
  const re = new RegExp(TIME_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const g = m.groups ?? {};
    if (!g.mi && !g.ap) continue;
    let h = Number(g.h);
    const mi = Number(g.mi ?? 0);
    if (h > 23 || mi > 59) continue;
    const ap = (g.ap ?? '').toLowerCase();
    if (ap.startsWith('p') && h < 12) h += 12;
    if (ap.startsWith('a') && h === 12) h = 0;
    const tz = g.z ? ZONES[g.z.toUpperCase()] : displayZone && isValidTimeZone(displayZone) ? displayZone : undefined;
    const zone = tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    let y: number, mo: number, d: number;
    const explicit = g.mon || g.nm;
    if (g.mon) {
      mo = MONTHS.indexOf(g.mon.toLowerCase().slice(0, 3)) + 1;
      d = Number(g.mday);
    } else if (g.nm) {
      // US style month/day (these providers are mostly US); fall back to day/month if invalid.
      mo = Number(g.nm);
      d = Number(g.nd);
      if (mo > 12) [mo, d] = [d, mo];
    } else {
      [, mo, d] = dayKey(now, { timeZone: zone }).split('-').map(Number);
    }
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) continue;
    y = Number(dayKey(now, { timeZone: zone }).slice(0, 4));
    let start = zonedTimeToUtc(y, mo, d, h, mi, 0, zone);
    if (explicit) {
      // Around New Year the listed date may belong to the neighbouring year.
      if (start - now > 180 * 86400_000) start = zonedTimeToUtc(y - 1, mo, d, h, mi, 0, zone);
      else if (now - start > 180 * 86400_000) start = zonedTimeToUtc(y + 1, mo, d, h, mi, 0, zone);
    } else {
      // No date: pick the occurrence closest to now (late games listed after midnight etc.).
      if (start - now > 14 * 3600_000) start -= 86400_000;
      else if (now - start > 10 * 3600_000) start += 86400_000;
    }
    return { start, match: m[0] };
  }
  return undefined;
}

/** Tidy the event text: drop times, dates, stray separators. */
function cleanTitle(s: string): string {
  return s
    .replace(QUALITY, ' ')
    .replace(/\s*[(\[]\s*[)\]]\s*/g, ' ')
    .replace(/^[\s:|\-–—•·@,]+|[\s:|\-–—•·@,(]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Read the event out of a channel name, e.g. "NBA 05: Lakers vs Celtics @ 7:30 PM ET". */
export function parseEventName(name: string, now: number, displayZone = ''): NameEvent {
  const { label, rest } = splitSlot(name);
  if (!rest) return { label, title: '' };
  let text = rest;
  const t = parseEventTime(text, now, displayZone);
  if (t) text = text.replace(t.match, ' ');
  // Some providers append the date separately: "| 10/14" or "(Oct 14)".
  text = text.replace(/\(\s*\)|\[\s*\]/g, ' ').replace(/\b(?:start(?:s|ing)?|kick ?off|live)\s*:?\s*$/i, '');
  const title = cleanTitle(text);
  if (!isMeaningfulTitle(title)) return { label, title: '', start: t?.start };
  return { label, title, start: t?.start };
}

/** Typical length of a broadcast for a sport, from words in the label/title. */
export function typicalDuration(text: string): number {
  const s = text.toLowerCase();
  if (/\b(ppv|ufc|boxing|fight|wwe|aew|bellator|pfl|mma|card|main event)\b/.test(s)) return 5 * 3600_000;
  if (/\b(nfl|ncaaf|cfb|college football|football)\b/.test(s) && !/soccer/.test(s)) return 3.5 * 3600_000;
  if (/\b(f1|formula|nascar|indycar|motogp|golf|pga|liv|tennis|cricket)\b/.test(s)) return 4 * 3600_000;
  if (/\b(mlb|baseball)\b/.test(s)) return 3.25 * 3600_000;
  if (/\b(epl|premier league|la ?liga|serie a|bundesliga|ligue 1|mls|uefa|ucl|soccer|champions league|liga mx|copa|fc)\b/.test(s)) return 2.25 * 3600_000;
  return 3 * 3600_000;
}

/**
 * A guide entry made from the channel name, so the guide, the sports screen and
 * the player all show the game. Without a start time it covers the current hours.
 */
export function eventProgramme(ref: string, ev: NameEvent, now: number): Programme | undefined {
  if (!ev.title) return undefined;
  const dur = typicalDuration(`${ev.label} ${ev.title}`);
  if (ev.start !== undefined) {
    const stop = ev.start + dur;
    if (stop < now - 30 * 60_000) return undefined; // finished: name is stale until the next playlist refresh
    return { ch: ref, start: ev.start, stop, title: ev.title, live: true, categories: ['Sports'], desc: `From the channel name: ${ev.label}` };
  }
  const hour = Math.floor(now / 3600_000) * 3600_000;
  return { ch: ref, start: hour - 3600_000, stop: hour + 5 * 3600_000, title: ev.title, categories: ['Sports'], desc: `From the channel name (no start time given): ${ev.label}` };
}

export interface ChannelHeadline {
  /** What to show as the channel's name. */
  title: string;
  /** The provider's slot name, shown small next to it when the title is a game. */
  slot?: string;
  /** The game is on right now. */
  live: boolean;
  start?: number;
}

/**
 * Name to display for a channel. Event channels show the game on now (or starting
 * within 4 hours) from the guide; everything else keeps its name. A name the user
 * set themselves always wins.
 */
export function channelHeadline(ch: LineupChannel, guide: GuideIndex, now: number, enabled = true): ChannelHeadline {
  const custom = ch.name !== ch.cleanedName;
  if (!enabled || custom || !isEventChannel(ch)) return { title: ch.name, live: false };
  const slot = splitSlot(ch.originalName).label || ch.name;
  const usable = ch.epgChannelId && (ch.matchStatus === 'auto' || ch.matchStatus === 'approved');
  if (usable) {
    const cur = guide.current(ch.epgChannelId, now);
    if (cur && isMeaningfulTitle(cur.title, ch)) return { title: cur.title, slot, live: true, start: cur.start };
    const next = guide.upcoming(ch.epgChannelId, now, 3).find((p) => p.start - now < 4 * 3600_000 && isMeaningfulTitle(p.title, ch));
    if (next) return { title: next.title, slot, live: false, start: next.start };
  }
  return { title: slot, live: false };
}
