import type { CategoryEvidence, CategoryId, ParsedChannel } from './types';

// ---------------------------------------------------------------------------
// Title cleanup
// ---------------------------------------------------------------------------

const SUPERSCRIPT_MAP: Record<string, string> = {
  'ᴴᴰ': 'HD', 'ᶠᴴᴰ': 'FHD', 'ᵁᴴᴰ': 'UHD', 'ᴿᴬᵂ': 'RAW', '⁴ᴷ': '4K', 'ˢᴰ': 'SD', '⁶⁰ᶠᵖˢ': '60fps', '⁵⁰ᶠᵖˢ': '50fps',
};

const DECORATION = /[★☆✪✦✧◉●○◆◇■□▶►▷▸♦♛♚⚡✔✓❤♥⭐🔴🟢🔵⚽🏀🏈⚾🎬🎥📺]/gu;

const QUALITY_TOKENS: Record<string, string> = {
  hd: 'HD', fhd: 'FHD', uhd: 'UHD', '4k': '4K', '8k': '8K', sd: 'SD', hevc: 'HEVC', h265: 'H265', h264: 'H264',
  '1080p': '1080p', '720p': '720p', '2160p': '2160p', '50fps': '50fps', '60fps': '60fps', raw: 'RAW',
};

/** Prefix tags like "US:", "UK |", "|FR|", "[DE]", "AR -" (2–4 uppercase letters). */
const PREFIX_TAG = /^\s*(?:\|([A-Z]{2,4}(?:-[A-Z]{2,4})?)\||\[([A-Z]{2,4})\]|([A-Z]{2,4})\s*(?:[:|»]|-(?=\s)))\s*/;

export function getPrefixTag(name: string): string | undefined {
  const m = PREFIX_TAG.exec(name);
  return m ? (m[1] || m[2] || m[3]) : undefined;
}

const SUPER_CHARS = /[\u02B0-\u02FF\u1D00-\u1DBF\u2070-\u209F]/;
const SUPER_ENTRIES = Object.entries(SUPERSCRIPT_MAP);
const tidyCache = new Map<string, string>();
const matchCache = new Map<string, string>();

function memo(cache: Map<string, string>, key: string, fn: (k: string) => string): string {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (cache.size > 200_000) cache.clear();
  const v = fn(key);
  cache.set(key, v);
  return v;
}

/** Cosmetic cleanup that never removes meaningful words. */
export function tidyName(name: string): string {
  return memo(tidyCache, name, tidyNameRaw);
}

function tidyNameRaw(name: string): string {
  let s = name.normalize('NFC');
  if (SUPER_CHARS.test(s)) for (const [k, v] of SUPER_ENTRIES) s = s.split(k).join(' ' + v);
  s = s.replace(DECORATION, ' ');
  s = s.replace(/[_]+/g, ' ');
  s = s.replace(/\s*[|]{1,}\s*$/g, '').replace(/^\s*[|:\-–—•·]+\s*/g, '');
  s = s.replace(/#{2,}|={2,}|-{3,}|\*{2,}/g, ' ');
  s = s.replace(/\(\s*\)|\[\s*\]/g, ' ');
  s = s.replace(/\s*([,;:])\s*/g, '$1 ').replace(/\s+([)\]])/g, '$1').replace(/([(\[])\s+/g, '$1');
  // Normalise quality tokens' casing (hd -> HD, Fhd -> FHD, 4k -> 4K)
  s = s.replace(/\b(f?hd|uhd|[48]k|sd|hevc|h26[45]|\d{3,4}p|[56]0fps|raw)\b/gi, (t) => QUALITY_TOKENS[t.toLowerCase()] ?? t);
  s = s.replace(/\s{2,}/g, ' ').trim();
  s = s.replace(/[\s:|\-–—•·,]+$/g, '').trim();
  return s;
}

/**
 * Produce cleaned display names for a whole playlist. Prefix tags (e.g. "US: ")
 * are removed only when they are redundant: shared by most channels in the
 * playlist or in that channel's group. If removing a prefix would make two
 * different channels collide, the prefix is kept for those channels.
 */
export function cleanChannelNames(channels: Pick<ParsedChannel, 'key' | 'originalName' | 'groupTitle'>[]): Map<string, string> {
  const out = new Map<string, string>();
  const prefixCount = new Map<string, number>();
  const groupPrefix = new Map<string, Map<string, number>>();
  const groupSize = new Map<string, number>();
  for (const c of channels) {
    const g = c.groupTitle ?? '';
    groupSize.set(g, (groupSize.get(g) ?? 0) + 1);
    const p = getPrefixTag(c.originalName);
    if (!p) continue;
    prefixCount.set(p, (prefixCount.get(p) ?? 0) + 1);
    let gm = groupPrefix.get(g);
    if (!gm) groupPrefix.set(g, (gm = new Map()));
    gm.set(p, (gm.get(p) ?? 0) + 1);
  }
  const total = channels.length || 1;
  const stripped = new Map<string, string>(); // key -> candidate
  for (const c of channels) {
    const tidy = tidyName(c.originalName);
    const p = getPrefixTag(c.originalName);
    let candidate = tidy;
    if (p) {
      const g = c.groupTitle ?? '';
      const inGroup = groupPrefix.get(g)?.get(p) ?? 0;
      const redundant = (prefixCount.get(p) ?? 0) / total >= 0.3 || inGroup / (groupSize.get(g) ?? 1) >= 0.6 ||
        (g && new RegExp(`\\b${p}\\b`, 'i').test(g));
      if (redundant) {
        const rest = tidyName(c.originalName.replace(PREFIX_TAG, ''));
        if (rest.length >= 2) candidate = rest;
      }
    }
    stripped.set(c.key, candidate);
  }
  // Collision guard: if stripping made distinct originals identical, keep tidy originals.
  const byName = new Map<string, Set<string>>();
  for (const c of channels) {
    const n = stripped.get(c.key)!.toLowerCase();
    let s = byName.get(n);
    if (!s) byName.set(n, (s = new Set()));
    s.add(c.originalName.toLowerCase());
  }
  for (const c of channels) {
    const cand = stripped.get(c.key)!;
    const originals = byName.get(cand.toLowerCase())!;
    out.set(c.key, originals.size > 1 ? tidyName(c.originalName) || c.originalName : cand || c.originalName);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Normalisation for matching
// ---------------------------------------------------------------------------

const STRIP_FOR_MATCH = new Set(['hd', 'fhd', 'uhd', '4k', '8k', 'sd', 'hevc', 'h265', 'h264', '1080p', '720p', '2160p', '1080', '720', '50fps', '60fps', 'raw', 'backup', 'tv', 'channel', 'live', 'feed', 'hq', 'lq', 'vip', 'ott', 'iptv']);

export function normalizeForMatch(name: string): string {
  return memo(matchCache, name, normalizeForMatchRaw);
}

function normalizeForMatchRaw(name: string): string {
  let s = name;
  if (SUPER_CHARS.test(s)) for (const [k, v] of SUPER_ENTRIES) s = s.split(k).join(' ' + v);
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(PREFIX_TAG, ' ');
  s = s.toLowerCase();
  s = s.replace(/\[[^\]]*\]|\{[^}]*\}/g, ' '); // bracketed notes: [Geo-blocked], {backup}
  s = s.replace(/\+\s?(\d+)/g, ' plus$1 '); // +1 timeshift is a different channel!
  s = s.replace(/&/g, ' and ').replace(/\+/g, ' plus ');
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' ');
  const toks = s.split(' ').filter((t) => t && !STRIP_FOR_MATCH.has(t));
  return toks.join(' ').trim();
}

/** Compact key (no spaces) for exact normalised comparisons. */
export function matchKey(name: string): string {
  return normalizeForMatch(name).replace(/\s+/g, '');
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  sports: 'Sports', news: 'News', entertainment: 'Entertainment', movies: 'Movies', kids: 'Kids',
  documentaries: 'Documentaries', music: 'Music', international: 'International', lifestyle: 'Lifestyle',
  religious: 'Religious', radio: 'Radio', other: 'Other',
};

export const CATEGORY_ORDER: CategoryId[] = ['sports', 'news', 'entertainment', 'movies', 'kids', 'documentaries', 'music', 'lifestyle', 'international', 'religious', 'radio', 'other'];

const CATEGORY_KEYWORDS: [CategoryId, RegExp][] = [
  ['kids', /\b(kids?|children|child|enfants?|kinder|infantil|cartoons?|animation|anime|junior|family|familia)\b/i],
  ['sports', /\b(sports?|deportes?|sportif|football|futbol|f[uú]tbol|soccer|nba|nfl|nhl|mlb|ufc|wwe|boxing|tennis|golf|racing|motorsports?|cricket|rugby|espn|bein|dazn|ppv|olympics?|f1|formula)\b/i],
  ['news', /\b(news|noticias|nachrichten|info|actualit[eé]s?|notizie|weather|business|finance|cnbc|politics)\b/i],
  ['movies', /\b(movies?|films?|cin[eé]ma|cine|kino|peliculas?|hbo|cinemax|showtime|starz|premium|vod)\b/i],
  ['documentaries', /\b(documentar(y|ies|ios?)|docs?|doku|science|history|nature|discovery|educational|knowledge|natgeo|national geographic)\b/i],
  ['music', /\b(music|musique|musica|m[uú]sica|musik|mtv|hits|concerts?)\b/i],
  ['religious', /\b(religio(us|n)|faith|christian|islamic|church|gospel|catholic|quran|bible)\b/i],
  ['lifestyle', /\b(lifestyle|cooking|food|travel|home|fashion|shopping|health|outdoor|hunting|fishing|reality)\b/i],
  ['entertainment', /\b(entertainment|general|generalist|variety|series|shows?|comedy|drama|lokal|local|network|broadcast|usa entertainment|divertissement|entretenimiento)\b/i],
  ['international', /\b(international|world|foreign|latino|latin|arabic|arab|hindi|indian|desi|turkish|persian|french|german|italian|spanish|portuguese|russian|polish|greek|chinese|korean|japanese|filipino|african|caribbean|asia|asian|europe|european|multilingual)\b/i],
  ['radio', /\b(radio|fm|am radio)\b/i],
];

// Country / language group titles ("France", "|DE| Germany", "UK") are treated as International
const COUNTRY_GROUP = /^(afghanistan|albania|algeria|argentina|australia|austria|belgium|brazil|bulgaria|canada|chile|china|colombia|croatia|czech|denmark|egypt|finland|france|germany|greece|hungary|india|indonesia|iran|iraq|ireland|israel|italy|japan|jordan|korea|kuwait|lebanon|malaysia|mexico|morocco|netherlands|norway|pakistan|peru|philippines|poland|portugal|qatar|romania|russia|saudi|serbia|singapore|spain|sweden|switzerland|syria|thailand|tunisia|turkey|ukraine|venezuela|vietnam)$/i;

/** Brand names that stay in capitals when a shouting group title is tidied. */
const KEEP_CAPS = new Set(['DIRECTV', 'DTV', 'ESPN', 'HBO', 'NCAA', 'UEFA', 'DAZN', 'BEIN', 'NESN', 'MSG', 'SNY', 'TSN', 'WWE', 'AEW', 'UFC', 'NBCSN', 'CNBC', 'MSNBC', 'BBC', 'ITV', 'AMC', 'TNT', 'TBS']);

/** Normalise a raw group-title for display: trims, collapses whitespace, removes separators. */
export function normalizeGroupTitle(g: string | undefined): string | undefined {
  if (!g) return undefined;
  let s = tidyName(g).replace(/\s*[|/]\s*/g, ' · ').replace(/^[·\s]+|[·\s]+$/g, '');
  if (!s || /^(undefined|null|none|n\/a|other|others|misc|uncategori[sz]ed|no group|-)$/i.test(s)) return undefined;
  // Title-case shouting groups ("USA SPORTS" -> "USA Sports") but leave short acronyms.
  if (s === s.toUpperCase() && /[A-Z]{4,}/.test(s)) {
    s = s.split(' ').map((w) => (w.length <= 3 || KEEP_CAPS.has(w) ? w : w[0] + w.slice(1).toLowerCase())).join(' ');
  }
  return s;
}

/**
 * Determine a channel's category with explicit evidence:
 *  1. group-title keywords (strong evidence)
 *  2. channel-name keywords such as "News" or "Sports" (weaker, only when the group gives nothing)
 * Otherwise "other". Never guesses from brand knowledge.
 */
export function categorize(groupTitle: string | undefined, name: string, radio?: boolean): { category: CategoryId; evidence: CategoryEvidence } {
  if (radio) return { category: 'radio', evidence: 'group' };
  const g = (groupTitle ?? '').trim();
  if (g) {
    for (const [cat, re] of CATEGORY_KEYWORDS) if (re.test(g)) return { category: cat, evidence: 'group' };
    const bare = g.replace(/[|\[\]]/g, '').trim();
    if (COUNTRY_GROUP.test(bare)) return { category: 'international', evidence: 'group' };
  }
  const n = name.toLowerCase();
  const nameRules: [CategoryId, RegExp][] = [
    ['news', /\bnews\b/],
    ['sports', /\bsports?\b/],
    ['kids', /\bkids\b/],
    ['movies', /\bmovies?\b|\bcinema\b/],
    ['music', /\bmusic\b/],
    ['documentaries', /\bdocumentar/],
  ];
  for (const [cat, re] of nameRules) if (re.test(n)) return { category: cat, evidence: 'name' };
  return { category: 'other', evidence: 'none' };
}
