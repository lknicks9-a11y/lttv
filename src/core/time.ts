import type { NaiveTimeMode } from './types';

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    partsFormatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) of `tz` from UTC at instant `ts`: local = utc + offset. */
export function tzOffsetMs(ts: number, tz: string): number {
  const parts = partsFormatter(tz).formatToParts(new Date(ts));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/**
 * Convert a wall-clock time in IANA zone `tz` to a UTC timestamp.
 * DST gaps (non-existent times) resolve forward; overlaps resolve to the earlier instant.
 */
export function zonedTimeToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  // Offsets in force half a day either side cover any single DST transition.
  const before = tzOffsetMs(wall - 43_200_000, tz);
  const after = tzOffsetMs(wall + 43_200_000, tz);
  const candidates = [wall - before, wall - after].filter((t) => t + tzOffsetMs(t, tz) === wall);
  if (candidates.length) return Math.min(...candidates); // overlap -> earlier instant
  // Gap (time does not exist): interpret with the pre-transition offset, which lands after the jump.
  return wall - before;
}

export interface NaiveTimePolicy {
  mode: NaiveTimeMode;
  zone?: string;
}

/**
 * Parse an XMLTV timestamp: "YYYYMMDDhhmmss +hhmm" with optional parts.
 * Accepted forms include: 20240101120000 +0100, 20240101120000+0100,
 * 202401011200 -0500, 20240101120000 Z, 20240101120000 UTC, 20240101 and
 * offsets like +01:00. Without an offset, `policy` decides (XMLTV default: UTC).
 * Returns NaN if unparseable.
 */
export function parseXmltvTime(raw: string | undefined | null, policy: NaiveTimePolicy = { mode: 'utc' }): number {
  if (!raw) return NaN;
  const s = raw.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?(?:\.\d+)?\s*(?:([+-])(\d{2}):?(\d{2})?|(Z|UTC|GMT)|([A-Za-z_]+\/[A-Za-z_\/+-]+))?\s*$/.exec(s);
  if (!m) return NaN;
  const y = +m[1], mo = +m[2], d = +m[3];
  const h = m[4] ? +m[4] : 0, mi = m[5] ? +m[5] : 0, sec = m[6] ? +m[6] : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 24 || mi > 59 || sec > 60) return NaN;
  const wall = Date.UTC(y, mo - 1, d, h, mi, sec);
  if (m[7]) {
    const off = (+m[8] * 60 + (m[9] ? +m[9] : 0)) * 60_000;
    return m[7] === '+' ? wall - off : wall + off;
  }
  if (m[10]) return wall;
  if (m[11] && isValidTimeZone(m[11])) return zonedTimeToUtc(y, mo, d, h, mi, sec, m[11]);
  switch (policy.mode) {
    case 'local':
      return new Date(y, mo - 1, d, h, mi, sec).getTime();
    case 'zone':
      if (policy.zone && isValidTimeZone(policy.zone)) return zonedTimeToUtc(y, mo, d, h, mi, sec, policy.zone);
      return wall;
    default:
      return wall;
  }
}

/** Fraction (0..1) of a programme that has elapsed at `now`. */
export function programmeProgress(start: number, stop: number, now: number): number {
  if (!(stop > start)) return 0;
  if (now <= start) return 0;
  if (now >= stop) return 1;
  return (now - start) / (stop - start);
}

export function isAiring(start: number, stop: number, now: number): boolean {
  return now >= start && now < stop;
}

// ---------- Formatting ----------

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, make: () => Intl.DateTimeFormat) {
  let f = fmtCache.get(key);
  if (!f) {
    f = make();
    fmtCache.set(key, f);
  }
  return f;
}

export interface DisplayTimeOptions {
  timeZone?: string; // '' = system
  hour12?: boolean | 'auto';
  locale?: string;
}

function tzOpt(o: DisplayTimeOptions) {
  return o.timeZone && isValidTimeZone(o.timeZone) ? o.timeZone : undefined;
}

export function formatClock(ts: number, o: DisplayTimeOptions = {}): string {
  const tz = tzOpt(o);
  const h12 = o.hour12 === 'auto' || o.hour12 === undefined ? undefined : o.hour12;
  const f = fmt(`clock|${tz}|${h12}|${o.locale}`, () =>
    new Intl.DateTimeFormat(o.locale, { hour: 'numeric', minute: '2-digit', timeZone: tz, hour12: h12 }));
  return f.format(new Date(ts));
}

export function formatDay(ts: number, o: DisplayTimeOptions = {}): string {
  const tz = tzOpt(o);
  const f = fmt(`day|${tz}|${o.locale}`, () =>
    new Intl.DateTimeFormat(o.locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }));
  return f.format(new Date(ts));
}

export function formatDateTime(ts: number, o: DisplayTimeOptions = {}): string {
  return `${formatDay(ts, o)} ${formatClock(ts, o)}`;
}

/** Calendar day key (YYYY-MM-DD) of an instant in the display zone. */
export function dayKey(ts: number, o: DisplayTimeOptions = {}): string {
  const tz = tzOpt(o);
  const f = fmt(`daykey|${tz}`, () => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }));
  return f.format(new Date(ts));
}

export function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatRemaining(stop: number, now: number): string {
  const ms = stop - now;
  if (ms <= 0) return 'Ended';
  return `${formatDuration(ms)} left`;
}

/** Floor an instant to the previous half-hour boundary (absolute, zone-independent for :00/:30 zones). */
export function floorToHalfHour(ts: number, tz?: string): number {
  // Use the zone offset so boundaries align with the displayed clock even for +05:45 zones.
  const off = tz && isValidTimeZone(tz) ? tzOffsetMs(ts, tz) : -new Date(ts).getTimezoneOffset() * 60000;
  const local = ts + off;
  const floored = Math.floor(local / 1800_000) * 1800_000;
  return floored - off;
}
