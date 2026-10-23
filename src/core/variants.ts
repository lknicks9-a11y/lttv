// The same channel in a lighter quality ("ESPN FHD" -> "ESPN HD"), for small Multiview tiles: a Fire TV stick
// can't decode four full-HD / 60 fps games at once, so every tile stutters; four 720p games it can.
import type { LineupChannel } from './types';
import { qualityRank } from './mytv';
import { matchKey } from './normalize';

/** A lighter copy of `ch` from the same provider and country (HD, else unmarked), or undefined when `ch` is already light. */
export function lighterVariant(ch: LineupChannel, lineup: LineupChannel[]): LineupChannel | undefined {
  const q = qualityRank(ch.originalName);
  if (q < 3) return undefined; // HD or lower already
  const key = matchKey(ch.originalName);
  if (!key) return undefined;
  let best: LineupChannel | undefined;
  let bestQ = -Infinity;
  for (const c of lineup) {
    if (c === ch || c.hidden || c.playlistId !== ch.playlistId || (c.country ?? '') !== (ch.country ?? '')) continue;
    const cq = qualityRank(c.originalName);
    // 720p first, then unmarked (usually 720p too); never SD, backups or another full-HD copy.
    const rank = cq === 2 ? 2 : cq === 1 ? 1 : -1;
    if (rank < 0 || rank <= bestQ) continue;
    if (matchKey(c.originalName) !== key) continue;
    best = c;
    bestQ = rank;
  }
  return best;
}
