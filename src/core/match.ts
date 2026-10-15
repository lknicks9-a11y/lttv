import type { EpgChannel, MatchDecision, MatchResult, ParsedChannel } from './types';
import { getPrefixTag, matchKey, normalizeForMatch } from './normalize';

/** Globally unique EPG channel reference: "<sourceId>|<xmltv id>". */
export function epgRef(sourceId: string, id: string): string {
  return `${sourceId}|${id}`;
}

export function splitEpgRef(ref: string): { sourceId: string; id: string } {
  const i = ref.indexOf('|');
  return { sourceId: ref.slice(0, i), id: ref.slice(i + 1) };
}

/** Country words providers put in front of names ("USA ESPN", "UK - Sky Sports Main Event"). */
const COUNTRY_CODES: Record<string, string> = {
  us: 'us', usa: 'us', uk: 'uk', gb: 'uk', ca: 'ca', can: 'ca', au: 'au', aus: 'au', ie: 'ie', irl: 'ie', nz: 'nz',
  fr: 'fr', de: 'de', ger: 'de', es: 'es', esp: 'es', it: 'it', ita: 'it', pt: 'pt', br: 'br', mx: 'mx', mex: 'mx',
  nl: 'nl', be: 'be', ch: 'ch', at: 'at', pl: 'pl', tr: 'tr', ar: 'ar', in: 'in', ind: 'in', za: 'za', se: 'se', no: 'no', dk: 'dk', fi: 'fi',
};
const LEADING_COUNTRY = /^\s*(?:\|\s*)?([A-Za-z]{2,3})(?:\s*[:|»\-–—]\s*|\s+)(?=\S)/;

/** Country a channel name is tagged with, if any ("US: ESPN", "USA ESPN", "|UK| Sky"). */
export function countryOf(name: string): string | undefined {
  const tag = getPrefixTag(name);
  if (tag) return COUNTRY_CODES[tag.toLowerCase()];
  const m = LEADING_COUNTRY.exec(name);
  return m && m[1] === m[1].toUpperCase() ? COUNTRY_CODES[m[1].toLowerCase()] : undefined;
}

/** "USA ESPN HD" -> "ESPN HD" (only when an all-caps country word leads the name). */
export function stripCountry(name: string): string | undefined {
  const m = LEADING_COUNTRY.exec(name);
  if (!m || m[1] !== m[1].toUpperCase() || !COUNTRY_CODES[m[1].toLowerCase()]) return undefined;
  const rest = name.slice(m[0].length).trim();
  return rest.length >= 2 ? rest : undefined;
}

/** Pick one EPG channel among several with the same normalised name, when that's safe. */
function breakTie(refs: string[], country: string | undefined): string | undefined {
  if (country) {
    const byCountry = refs.filter((r) => {
      const id = splitEpgRef(r).id.toLowerCase();
      return id.endsWith('.' + country) || new RegExp(`(^|[^a-z])${country}([^a-z]|$)`).test(id);
    });
    if (byCountry.length === 1) return byCountry[0];
    if (byCountry.length > 1) refs = byCountry;
  }
  // The same channel id offered by several guide sources: any of them is right; take the first.
  const ids = new Set(refs.map((r) => splitEpgRef(r).id.toLowerCase()));
  if (ids.size === 1) return refs[0];
  return undefined;
}

const REGION_WORDS = new Set(['east', 'west', 'pacific', 'mountain', 'central', 'north', 'south', 'atlantic', 'eastern', 'western']);

function distinctive(tokens: string[]): { nums: string; regions: string } {
  const nums = tokens.filter((t) => /\d/.test(t)).sort().join(',');
  const regions = tokens.filter((t) => REGION_WORDS.has(t)).map((t) => t.replace(/ern$/, '')).sort().join(',');
  return { nums, regions };
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Tokens are "close" if equal, or long words differing by spelling (centre/center, sport/sports). Digits must be exact. */
function tokensClose(a: string, b: string): boolean {
  if (a === b) return true;
  if (/\d/.test(a) || /\d/.test(b)) return false;
  if (Math.min(a.length, b.length) < 4) return false;
  return levenshtein(a, b, Math.min(a.length, b.length) >= 7 ? 2 : 1) <= (Math.min(a.length, b.length) >= 7 ? 2 : 1);
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, ' ');
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function dice(a: Map<string, number>, b: Map<string, number>): number {
  let inter = 0;
  let na = 0;
  let nb = 0;
  for (const v of a.values()) na += v;
  for (const v of b.values()) nb += v;
  for (const [g, v] of a) inter += Math.min(v, b.get(g) ?? 0);
  return na + nb ? (2 * inter) / (na + nb) : 0;
}

/**
 * Similarity in 0..1 between two channel names. Names whose numbers
 * (e.g. "Sports 1" vs "Sports 2", "+1" timeshifts) or regional feeds
 * (East/West) differ always score 0: they are different schedules.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = na.split(' ');
  const tb = nb.split(' ');
  const da = distinctive(ta);
  const db = distinctive(tb);
  if (da.nums !== db.nums || da.regions !== db.regions) return 0;
  const sa = [...new Set(ta)];
  const sb = [...new Set(tb)];
  let common = 0;
  for (const t of sa) if (sb.some((u) => tokensClose(t, u))) common++;
  const tokenScore = common / Math.max(sa.length, sb.length);
  const charScore = dice(bigrams(na), bigrams(nb));
  // Containment bonus: "bbc one" vs "bbc one london" is closer than token ratio suggests
  const contained = na.replace(/ /g, '').includes(nb.replace(/ /g, '')) || nb.replace(/ /g, '').includes(na.replace(/ /g, ''));
  let score = 0.45 * tokenScore + 0.55 * charScore;
  if (contained) score = Math.max(score, 0.6 + 0.3 * Math.min(na.length, nb.length) / Math.max(na.length, nb.length));
  return Math.min(score, 0.99);
}

export interface MatchOptions {
  /** Auto-approve fuzzy matches at or above this confidence (0 disables). */
  fuzzyAutoApprove?: number;
  /** Minimum fuzzy score to propose a candidate. */
  fuzzyThreshold?: number;
  /** Display names to use for channels (e.g. cleaned names). */
  displayNames?: Map<string, string>;
}

interface Index {
  byId: Map<string, string>; // lower id -> ref
  byName: Map<string, Set<string>>; // lower exact display name -> refs
  byKey: Map<string, Set<string>>; // normalised key -> refs
  byToken: Map<string, Set<string>>;
  names: Map<string, string[]>; // ref -> display names
}

function buildIndex(epg: EpgChannel[]): Index {
  const idx: Index = { byId: new Map(), byName: new Map(), byKey: new Map(), byToken: new Map(), names: new Map() };
  const add = (m: Map<string, Set<string>>, k: string, ref: string) => {
    if (!k) return;
    let s = m.get(k);
    if (!s) m.set(k, (s = new Set()));
    s.add(ref);
  };
  for (const c of epg) {
    const ref = epgRef(c.sourceId, c.id);
    const lid = c.id.trim().toLowerCase();
    if (!idx.byId.has(lid)) idx.byId.set(lid, ref); // first source wins
    const names = c.displayNames.length ? c.displayNames : [c.id.replace(/\.[a-z]{2,3}$/i, '')];
    idx.names.set(ref, names);
    for (const n of names) {
      add(idx.byName, n.trim().toLowerCase(), ref);
      add(idx.byKey, matchKey(n), ref);
      for (const t of normalizeForMatch(n).split(' ')) if (t.length > 1) add(idx.byToken, t, ref);
    }
    // ids like "BBCOne.uk" also carry a usable name
    add(idx.byKey, matchKey(c.id.replace(/\.[a-z]{2,3}$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2')), ref);
  }
  return idx;
}

/**
 * Match playlist channels to EPG channels in priority order:
 *   1. exact tvg-id == XMLTV channel id (case-insensitive)
 *   2. exact tvg-name == XMLTV display-name
 *   3. normalised channel-name equality (unique)
 *   4. fuzzy similarity -> "pending" until the user approves (unless auto-approve is configured)
 * User decisions always win over automatic results.
 */
export function matchChannels(
  channels: ParsedChannel[],
  epg: EpgChannel[],
  decisions: Map<string, MatchDecision> = new Map(),
  opts: MatchOptions = {},
): Map<string, MatchResult> {
  const idx = buildIndex(epg);
  const allRefs = new Set(idx.names.keys());
  const threshold = opts.fuzzyThreshold ?? 0.62;
  const auto = opts.fuzzyAutoApprove ?? 0;
  const out = new Map<string, MatchResult>();

  for (const ch of channels) {
    const decision = decisions.get(ch.key);
    if (decision) {
      if ((decision.status === 'approved' || decision.status === 'manual') && decision.epgChannelId && allRefs.has(decision.epgChannelId)) {
        out.set(ch.key, { key: ch.key, epgChannelId: decision.epgChannelId, method: 'manual', confidence: 1, status: 'approved' });
        continue;
      }
      if (decision.status === 'rejected' && !decision.epgChannelId) {
        out.set(ch.key, { key: ch.key, method: 'none', confidence: 0, status: 'rejected' });
        continue;
      }
    }
    const rejected = decision?.status === 'rejected' ? decision.epgChannelId : undefined;
    const ok = (ref: string | undefined) => !!ref && ref !== rejected;

    // 1. tvg-id
    if (ch.tvgId) {
      const ref = idx.byId.get(ch.tvgId.trim().toLowerCase());
      if (ok(ref)) {
        out.set(ch.key, { key: ch.key, epgChannelId: ref, method: 'tvg-id', confidence: 1, status: 'auto' });
        continue;
      }
    }
    // 2. tvg-name exact display-name
    if (ch.tvgName) {
      const refs = [...(idx.byName.get(ch.tvgName.trim().toLowerCase()) ?? [])].filter(ok);
      const pick = refs.length === 1 ? refs[0] : refs.length > 1 ? breakTie(refs, countryOf(ch.originalName)) : undefined;
      if (pick) {
        out.set(ch.key, { key: ch.key, epgChannelId: pick, method: 'tvg-name', confidence: 0.97, status: 'auto' });
        continue;
      }
    }
    // 3. normalised name (unique)
    const base = [opts.displayNames?.get(ch.key), ch.originalName, ch.tvgName].filter((n): n is string => !!n);
    const names = [...new Set([...base, ...base.map(stripCountry).filter((n): n is string => !!n)])];
    const country = countryOf(ch.originalName);
    let ambiguous: string[] | null = null;
    let found: string | undefined;
    for (const n of names) {
      const refs = [...(idx.byKey.get(matchKey(n)) ?? [])].filter(ok);
      if (refs.length === 1) {
        found = refs[0];
        break;
      }
      if (refs.length > 1) {
        const pick = breakTie(refs, country);
        if (pick) {
          found = pick;
          break;
        }
        if (!ambiguous) ambiguous = refs;
      }
    }
    if (found) {
      out.set(ch.key, { key: ch.key, epgChannelId: found, method: 'name', confidence: 0.9, status: 'auto' });
      continue;
    }

    // 4. fuzzy
    const candidateRefs = new Set<string>(ambiguous ?? []);
    for (const n of names) {
      for (const t of normalizeForMatch(n).split(' ')) {
        const s = idx.byToken.get(t);
        if (s && s.size < 400) for (const r of s) candidateRefs.add(r);
      }
    }
    const scored: { id: string; score: number; name: string }[] = [];
    for (const ref of candidateRefs) {
      if (!ok(ref)) continue;
      let best = 0;
      let bestName = '';
      for (const en of idx.names.get(ref) ?? []) {
        for (const n of names) {
          const s = nameSimilarity(n, en);
          if (s > best) {
            best = s;
            bestName = en;
          }
        }
      }
      if (ambiguous?.includes(ref)) best = Math.min(best, 0.8);
      if (best >= threshold) scored.push({ id: ref, score: Math.round(best * 100) / 100, name: bestName });
    }
    scored.sort((a, b) => b.score - a.score);
    if (scored.length) {
      const top = scored[0];
      // A close runner-up makes the match less certain.
      const margin = scored[1] ? top.score - scored[1].score : 1;
      const confidence = Math.round((margin < 0.05 ? top.score * 0.9 : top.score) * 100) / 100;
      const status = auto > 0 && confidence >= auto ? 'auto' : 'pending';
      out.set(ch.key, { key: ch.key, epgChannelId: top.id, method: 'fuzzy', confidence, status, candidates: scored.slice(0, 5) });
    } else {
      out.set(ch.key, { key: ch.key, method: 'none', confidence: 0, status: rejected ? 'rejected' : 'unmatched' });
    }
  }
  return out;
}

/** Only these statuses may drive the guide; pending/unmatched/rejected show "Program information unavailable". */
export function isUsableMatch(m: MatchResult | undefined): boolean {
  return !!m && !!m.epgChannelId && (m.status === 'auto' || m.status === 'approved');
}
