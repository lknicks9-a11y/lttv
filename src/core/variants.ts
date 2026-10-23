// The same channel in a lighter quality ("ESPN FHD" -> "ESPN HD"), for small Multiview tiles: a Fire TV stick
// can't decode four full-HD / 60 fps games at once, so every tile stutters; four 720p games it can.
import type { LineupChannel } from './types';
import { qualityRank } from './mytv';
import { matchKey } from './normalize';

/**
 * A lighter copy of `ch` from the same provider and country: HD, else unmarked, else (with `allowSd`, for a quarter-screen
 * tile) SD. Undefined when there's none or `ch` is already as light as allowed.
 */
export function lighterVariant(ch: LineupChannel, lineup: LineupChannel[], allowSd = false): LineupChannel | undefined {
  const q = qualityRank(ch.originalName);
  if (q < (allowSd ? 1 : 3)) return undefined; // already light enough
  const key = matchKey(ch.originalName);
  if (!key) return undefined;
  let best: LineupChannel | undefined;
  let bestQ = -Infinity;
  for (const c of lineup) {
    if (c === ch || c.hidden || c.playlistId !== ch.playlistId || (c.country ?? '') !== (ch.country ?? '')) continue;
    const cq = qualityRank(c.originalName);
    // 720p first, then unmarked (usually 720p too), then SD for quarter tiles; never backups or another full-HD copy.
    const rank = cq === 2 && q > 2 ? 3 : cq === 1 && q > 1 ? 2 : cq === 0 && allowSd ? 1 : -1;
    if (rank < 0 || rank <= bestQ) continue;
    if (matchKey(c.originalName) !== key) continue;
    best = c;
    bestQ = rank;
  }
  return best;
}
