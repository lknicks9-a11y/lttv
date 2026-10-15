// Which country a channel belongs to, from the provider's naming: a name prefix
// ("US:", "|UK|", "PK -", "USA ESPN"), or the group ("Pakistan", "UK | Sports",
// "|FR| France"). Any ISO country works; names come from the browser's own
// country list (Intl.DisplayNames), so nothing needs maintaining per country.
import { getPrefixTag } from './normalize';
import { countryOf } from './match';

/** Provider labels that aren't ISO country codes. */
const SPECIAL: Record<string, string> = {
  uk: 'uk', gb: 'uk', usa: 'us', us: 'us', ar: 'ar', arab: 'ar', arabic: 'ar', latam: 'latam', latino: 'latam', lat: 'latam', latin: 'latam',
  exyu: 'exyu', 'ex-yu': 'exyu', yu: 'exyu', afr: 'africa', africa: 'africa', carib: 'carib', car: 'carib', caribbean: 'carib', kurd: 'kurd', kurdish: 'kurd',
  sp: 'es', ger: 'de', por: 'pt', ned: 'nl', gre: 'gr', den: 'dk', rsa: 'za', ksa: 'sa', uae: 'ae', phi: 'ph', vie: 'vn', mal: 'my', chi: 'cl',
  cro: 'hr', bul: 'bg', alg: 'dz', rom: 'ro', uru: 'uy', sui: 'ch', swi: 'ch', ind: 'in', pak: 'pk', bra: 'br', mex: 'mx', arg: 'ar-country',
  can: 'ca', aus: 'au', fra: 'fr', esp: 'es', ita: 'it', deu: 'de', prt: 'pt', nld: 'nl', bel: 'be', pol: 'pl', tur: 'tr', grc: 'gr', swe: 'se',
  nor: 'no', dnk: 'dk', fin: 'fi', irl: 'ie', nzl: 'nz', zaf: 'za', phl: 'ph', chn: 'cn', jpn: 'jp', kor: 'kr', rus: 'ru', ukr: 'ua', rou: 'ro',
  hun: 'hu', cze: 'cz', svk: 'sk', srb: 'rs', hrv: 'hr', bih: 'ba', alb: 'al', mkd: 'mk', bgr: 'bg', isr: 'il', irn: 'ir', irq: 'iq', sau: 'sa',
  are: 'ae', egy: 'eg', mar: 'ma', tun: 'tn', dza: 'dz', lbn: 'lb', jor: 'jo', syr: 'sy', kwt: 'kw', qat: 'qa', afg: 'af', bgd: 'bd',
  lka: 'lk', npl: 'np', tha: 'th', vnm: 'vn', idn: 'id', mys: 'my', sgp: 'sg', col: 'co', per: 'pe', chl: 'cl', ven: 've', ecu: 'ec', ury: 'uy',
  pry: 'py', bol: 'bo', cri: 'cr', pan: 'pa', dom: 'do', pri: 'pr', cub: 'cu', hti: 'ht', jam: 'jm', tto: 'tt', nga: 'ng', gha: 'gh', ken: 'ke',
  eth: 'et', som: 'so', aut: 'at', che: 'ch', lux: 'lu', isl: 'is', est: 'ee', lva: 'lv', ltu: 'lt', svn: 'si', mne: 'me', mlt: 'mt', cyp: 'cy',
  geo: 'ge', arm: 'am', aze: 'az', kaz: 'kz', uzb: 'uz', mng: 'mn', twn: 'tw', hkg: 'hk',
};

/** Codes whose plain ISO meaning providers don't use (AR = Arabic, not Argentina). */
const ISO_OVERRIDE: Record<string, string> = { 'ar-country': 'ar_country' };

/** Two-letter "codes" that are never meant as a country in channel names. */
const NOT_COUNTRY = new Set(['tv', 'hd', 'sd', 'en', 'vo', 'st', 'fm', 'am', 'pm', 'go', 'so', 'do', 'to']);

let dn: Intl.DisplayNames | null | undefined;
function displayNames(): Intl.DisplayNames | null {
  if (dn !== undefined) return dn;
  try {
    dn = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    dn = null;
  }
  return dn;
}

function isoName(code: string): string | undefined {
  if (!/^[a-z]{2}$/.test(code)) return undefined;
  try {
    const n = displayNames()?.of(code.toUpperCase());
    return n && n.toUpperCase() !== code.toUpperCase() && !/^unknown/i.test(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

const NAMES: Record<string, string> = {
  us: 'United States', uk: 'United Kingdom', ar: 'Arabic', latam: 'Latin America', exyu: 'Ex-Yugoslavia', africa: 'Africa', carib: 'Caribbean',
  kurd: 'Kurdish', ar_country: 'Argentina', none: 'Other',
};

/** Normalise a tag like "PK", "USA", "EX-YU", "LATINO" to a country key, if it is one. */
export function countryFromTag(tag: string | undefined, strict = false): string | undefined {
  if (!tag) return undefined;
  const t = tag.toLowerCase().replace(/[^a-z-]/g, '');
  const s = SPECIAL[t] ?? SPECIAL[t.replace('-', '')];
  if (s) return ISO_OVERRIDE[s] ?? s;
  if (t.length === 2 && isoName(t) && !(strict && NOT_COUNTRY.has(t))) return t;
  return undefined;
}

/** "Pakistan Sports", "UK | Entertainment", "|FR| France" -> country key. */
let nameIndex: [RegExp, string][] | null = null;
function groupNameIndex(): [RegExp, string][] {
  if (nameIndex) return nameIndex;
  const words: [string, string][] = [
    ['usa|united states|american?|new york|nyc|new jersey|long island', 'us'], ['uk|united kingdom|british|england|scotland|wales', 'uk'], ['arab|arabic', 'ar'],
    ['latino|latin america|latam|latin', 'latam'], ['ex[- ]?yu(goslavia)?|balkan', 'exyu'], ['africa|african', 'africa'], ['caribbean', 'carib'], ['kurd(ish)?', 'kurd'],
    ['canada|canadian', 'ca'], ['france|french', 'fr'], ['germany|german|deutschland', 'de'], ['spain|spanish|espa[ñn]a', 'es'], ['italy|italian|italia', 'it'],
    ['portugal|portuguese', 'pt'], ['brazil|brasil', 'br'], ['mexico|m[eé]xico', 'mx'], ['india|indian|hindi|desi|punjabi|tamil|telugu|malayalam', 'in'],
    ['pakistan|urdu', 'pk'], ['netherlands|dutch|holland', 'nl'], ['poland|polish|polska', 'pl'], ['turkey|turkish|t[uü]rkiye', 'tr'], ['greece|greek', 'gr'],
    ['philippines|filipino|pinoy', 'ph'], ['ireland|irish', 'ie'], ['australia|aussie', 'au'], ['russia|russian', 'ru'], ['persian|farsi|iran', 'ir'],
    ['china|chinese', 'cn'], ['korea|korean', 'kr'], ['japan|japanese', 'jp'], ['vietnam|vietnamese', 'vn'], ['albania|albanian', 'al'], ['romania|romanian', 'ro'], ['argentina|argentine', 'ar_country'],
  ];
  const out: [RegExp, string][] = words.map(([w, c]) => [new RegExp(`\\b(${w})\\b`, 'i'), c]);
  // Every other country by its English name.
  const A = 'abcdefghijklmnopqrstuvwxyz';
  for (const a of A) for (const b of A) {
    const code = a + b;
    const name = isoName(code);
    if (!name || out.some(([, c]) => c === code)) continue;
    const plain = name.replace(/\s*\(.*\)$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (plain.length >= 4) out.push([new RegExp(`\\b${plain}\\b`, 'i'), code]);
  }
  nameIndex = out;
  return out;
}

const groupCache = new Map<string, string | undefined>();

export function countryOfGroup(group: string | undefined): string | undefined {
  if (!group) return undefined;
  if (groupCache.has(group)) return groupCache.get(group);
  if (groupCache.size > 20_000) groupCache.clear();
  const c = computeGroupCountry(group);
  groupCache.set(group, c);
  return c;
}

function computeGroupCountry(group: string): string | undefined {
  const tag = countryFromTag(getPrefixTag(group), true);
  if (tag) return tag;
  for (const [re, c] of groupNameIndex()) if (re.test(group)) return c;
  // "PK Sports", "FR Cinéma": a leading two/three-letter code word.
  const lead = /^\s*([A-Z]{2,3})\b(?=\s+\S)/.exec(group);
  return lead ? countryFromTag(lead[1], true) : undefined;
}

/** Country of a channel: name prefix first, then its group. */
export function detectCountry(name: string, group: string | undefined): string | undefined {
  if (/^\s*\|?\s*ex[- ]?yu\b/i.test(name)) return 'exyu';
  const known = countryOf(name);
  if (known) return SPECIAL[known] ?? known;
  const tag = countryFromTag(getPrefixTag(name), true);
  if (tag) return tag;
  // US local stations named by city or call sign ("A3 NEW YORK 07 WABC ABC", "KTLA CW").
  if (/\bnew york\b/i.test(name) || /\b[KW][A-Z]{3}\b(?:-(?:TV|DT))?.*\b(ABC|CBS|NBC|FOX|PBS|CW|MyNetwork|Telemundo|Univision)\b/.test(name)) return 'us';
  return countryOfGroup(group);
}

export function countryName(code: string | undefined): string {
  if (!code || code === 'none') return 'Other';
  return NAMES[code] ?? isoName(code) ?? code.toUpperCase();
}

/** Flag emoji for ISO codes ("us" -> 🇺🇸); empty for language/region groups. */
export function countryFlag(code: string | undefined): string {
  const c = code === 'uk' ? 'gb' : code === 'ar_country' ? 'ar' : code;
  if (!c || !/^[a-z]{2}$/.test(c) || code === 'ar' || !isoName(c)) return '';
  return String.fromCodePoint(...[...c.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/**
 * The provider's country code at the start of a group title ("US| SPORTS", "|CA| NEWS",
 * "UK: MOVIES", "[ES] DEPORTES", "US ➾ KIDS", "USA SPORTS"), as { key, code } where code
 * is the provider's own spelling ("US", "UK", "ES") for the tab.
 */
export function groupCountryCode(group: string | undefined): { key: string; code: string } | undefined {
  if (!group) return undefined;
  const g = group.normalize('NFKC');
  const m =
    /^\s*[[(|]\s*([A-Za-z]{2,5}(?:-[A-Za-z]{2,3})?)\s*[\])|]/.exec(g) ??
    /^\s*([A-Za-z]{2,5}(?:-[A-Za-z]{2,3})?)\s*(?:[:|»➾➤►▶•·\/]|[-–—](?=\s))/.exec(g) ??
    /^\s*([A-Z]{2,4})(?=\s+\S)/.exec(g) ??
    /^\s*([A-Z]{2,4})\s*$/.exec(g);
  if (!m) return undefined;
  const key = countryFromTag(m[1], true);
  return key ? { key, code: m[1].toUpperCase() } : undefined;
}
