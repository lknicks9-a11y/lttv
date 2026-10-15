import { formatClock, formatDay, formatDuration, programmeProgress, dayKey } from '../core/time';
import type { Programme, Settings } from '../core/types';
import { getState } from '../app/state';

function opts(s: Settings = getState().settings) {
  return { timeZone: s.timeZone || undefined, hour12: s.hour12 };
}

export const clock = (ts: number) => formatClock(ts, opts());
export const day = (ts: number) => formatDay(ts, opts());
export function range(p: Pick<Programme, 'start' | 'stop'>) {
  return `${clock(p.start)} – ${clock(p.stop)}`;
}
export function when(ts: number, now = Date.now()) {
  const o = opts();
  const today = dayKey(now, o);
  const d = dayKey(ts, o);
  if (d === today) return clock(ts);
  if (d === dayKey(now + 86400_000, o)) return `Tomorrow ${clock(ts)}`;
  return `${day(ts)} ${clock(ts)}`;
}
export const progress = (p: Pick<Programme, 'start' | 'stop'>, now: number) => programmeProgress(p.start, p.stop, now);
export function remaining(p: Pick<Programme, 'stop'>, now: number) {
  const ms = p.stop - now;
  return ms > 0 ? `${formatDuration(ms)} left` : 'Ended';
}
export const duration = (p: Pick<Programme, 'start' | 'stop'>) => formatDuration(p.stop - p.start);
export const UNAVAILABLE = 'Program information unavailable';
