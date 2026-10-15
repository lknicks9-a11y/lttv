import type { Programme } from './types';
import { lowerBound } from './util';
import { normalizeSchedule } from './xmltv';

/**
 * In-memory programme index keyed by EPG reference ("<sourceId>|<id>").
 * Each channel's list is kept sorted and non-overlapping so lookups are
 * binary searches.
 */
export class GuideIndex {
  private byRef = new Map<string, Programme[]>();

  get size(): number {
    return this.byRef.size;
  }

  refs(): IterableIterator<string> {
    return this.byRef.keys();
  }

  set(ref: string, list: Programme[]): void {
    this.byRef.set(ref, normalizeSchedule(list));
  }

  /** Set an already-normalised list (as stored) without re-sorting. */
  setNormalized(ref: string, list: Programme[]): void {
    this.byRef.set(ref, list);
  }

  get(ref: string | undefined): Programme[] {
    return (ref && this.byRef.get(ref)) || [];
  }

  has(ref: string | undefined): boolean {
    return !!ref && (this.byRef.get(ref)?.length ?? 0) > 0;
  }

  delete(ref: string): void {
    this.byRef.delete(ref);
  }

  clear(): void {
    this.byRef.clear();
  }

  /** Programme airing at `now`, if any. */
  current(ref: string | undefined, now: number): Programme | undefined {
    const list = this.get(ref);
    if (!list.length) return undefined;
    const i = lowerBound(list, (p) => p.stop > now);
    const p = list[i];
    return p && p.start <= now ? p : undefined;
  }

  /** Programmes starting after now (or the current one's successors). */
  upcoming(ref: string | undefined, now: number, count = 5): Programme[] {
    const list = this.get(ref);
    const i = lowerBound(list, (p) => p.start > now);
    return list.slice(i, i + count);
  }

  next(ref: string | undefined, now: number): Programme | undefined {
    return this.upcoming(ref, now, 1)[0];
  }

  /** Programmes overlapping [from, to). */
  range(ref: string | undefined, from: number, to: number): Programme[] {
    const list = this.get(ref);
    if (!list.length) return list;
    const i = lowerBound(list, (p) => p.stop > from);
    const out: Programme[] = [];
    for (let k = i; k < list.length && list[k].start < to; k++) out.push(list[k]);
    return out;
  }

  /** Drop programmes that ended before `before`. Returns number removed. */
  prune(before: number): number {
    let removed = 0;
    for (const [ref, list] of this.byRef) {
      const i = lowerBound(list, (p) => p.stop > before);
      if (i > 0) {
        removed += i;
        this.byRef.set(ref, list.slice(i));
      }
    }
    return removed;
  }

  /** Overall [min start, max stop] covered. */
  coverage(): { start: number; end: number } | null {
    let start = Infinity;
    let end = -Infinity;
    for (const list of this.byRef.values()) {
      if (!list.length) continue;
      if (list[0].start < start) start = list[0].start;
      if (list[list.length - 1].stop > end) end = list[list.length - 1].stop;
    }
    return Number.isFinite(start) ? { start, end } : null;
  }
}

/** Horizontal layout helpers for the EPG grid. Positions are linear in absolute time, so DST is handled naturally. */
export function timeToX(ts: number, viewStart: number, pxPerMin: number): number {
  return ((ts - viewStart) / 60000) * pxPerMin;
}

export interface Block {
  p: Programme;
  left: number;
  width: number;
  /** clipped at the left/right edge of the window */
  clippedStart: boolean;
  clippedEnd: boolean;
}

export function layoutRow(list: Programme[], winStart: number, winEnd: number, pxPerMin: number): Block[] {
  const out: Block[] = [];
  for (const p of list) {
    if (p.stop <= winStart || p.start >= winEnd) continue;
    const s = Math.max(p.start, winStart);
    const e = Math.min(p.stop, winEnd);
    out.push({
      p,
      left: timeToX(s, winStart, pxPerMin),
      width: Math.max(0, timeToX(e, winStart, pxPerMin) - timeToX(s, winStart, pxPerMin)),
      clippedStart: p.start < winStart,
      clippedEnd: p.stop > winEnd,
    });
  }
  return out;
}

/** Half-hour tick marks between two instants, aligned to the display zone's clock. */
export function halfHourTicks(from: number, to: number, floorFn: (t: number) => number): number[] {
  const ticks: number[] = [];
  let t = floorFn(from);
  if (t < from) t += 1800_000;
  for (; t <= to; t += 1800_000) ticks.push(t);
  return ticks;
}
