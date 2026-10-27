// Local TV stations that carry NBA / NHL games, so a station the schedule names by call sign ("KSBI") is found in
// a playlist that names it by its network and city instead ("MyNetworkTV Oklahoma City", "MY 52 OKC").
import type { LineupChannel } from './types';

interface Station {
  /** City words the playlist might use. */
  city: RegExp;
  /** Network the station carries (its affiliation), if any. */
  net?: 'my' | 'cw' | 'nbc' | 'abc' | 'cbs' | 'fox' | 'ion';
  /** Over-the-air channel number. */
  num?: number;
  /** Brand names ("Peachtree", "Arizona's Family"). */
  brand?: RegExp;
}

const C = {
  okc: /\b(oklahoma city|okc)\b/i,
  tulsa: /\btulsa\b/i,
  phoenix: /\b(phoenix|arizona)\b/i,
  charlotte: /\bcharlotte\b/i,
  cleveland: /\bcleveland\b/i,
  miami: /\b(miami|fort lauderdale|south florida)\b/i,
  dallas: /\b(dallas|fort worth|dfw)\b/i,
  milwaukee: /\bmilwaukee\b/i,
  atlanta: /\batlanta\b/i,
  slc: /\b(salt lake|utah|slc)\b/i,
  sanantonio: /\bsan antonio\b/i,
  la: /\b(los angeles|l\.?a\.?)\b/i,
  minneapolis: /\b(minneapolis|twin cities|minnesota|st\.? paul)\b/i,
  detroit: /\bdetroit\b/i,
  orlando: /\borlando\b/i,
  portland: /\bportland\b/i,
  denver: /\b(denver|colorado)\b/i,
  indy: /\b(indianapolis|indy)\b/i,
  seattle: /\b(seattle|tacoma)\b/i,
  vegas: /\b(las vegas|vegas)\b/i,
  tampa: /\btampa\b/i,
  nashville: /\bnashville\b/i,
  evansville: /\bevansville\b/i,
  sacramento: /\bsacramento\b/i,
};

export const STATIONS: Record<string, Station> = {
  KSBI: { city: C.okc, net: 'my', num: 52 },
  KQCW: { city: C.tulsa, net: 'cw', num: 19 },
  KTVK: { city: C.phoenix, num: 3, brand: /arizona'?s family|\b3tv\b/i },
  KPHE: { city: C.phoenix, num: 44, brand: /arizona'?s family sports/i },
  WAXN: { city: C.charlotte, num: 64, brand: /\btv\s*64\b/i },
  WSOC: { city: C.charlotte, net: 'abc', num: 9 },
  WUAB: { city: C.cleveland, num: 43 },
  WOIO: { city: C.cleveland, net: 'cbs', num: 19 },
  WPLG: { city: C.miami, num: 10, brand: /\blocal\s*10\b/i },
  WSFL: { city: C.miami, num: 39 },
  KFAA: { city: C.dallas, num: 29 },
  WFAA: { city: C.dallas, net: 'abc', num: 8 },
  WCGV: { city: C.milwaukee, net: 'my', num: 24 },
  WVTV: { city: C.milwaukee, net: 'cw', num: 18 },
  WANF: { city: C.atlanta, num: 46, brand: /atlanta news first/i },
  WPCH: { city: C.atlanta, num: 17, brand: /peachtree/i },
  KJZZ: { city: C.slc, num: 14 },
  KUPX: { city: C.slc, num: 16, brand: /\butah\s*16\b/i },
  WOAI: { city: C.sanantonio, net: 'nbc', num: 4 },
  KTLA: { city: C.la, num: 5 },
  KCOP: { city: C.la, net: 'my', num: 13 },
  KARE: { city: C.minneapolis, net: 'nbc', num: 11 },
  WMYD: { city: C.detroit, num: 20 },
  WRDQ: { city: C.orlando, num: 27 },
  WFTV: { city: C.orlando, net: 'abc', num: 9 },
  KUNP: { city: C.portland, num: 16 },
  KTVD: { city: C.denver, net: 'my', num: 20 },
  WTTV: { city: C.indy, net: 'cbs', num: 4 },
  WXIN: { city: C.indy, net: 'fox', num: 59 },
  WTVW: { city: C.evansville, num: 7 },
  KONG: { city: C.seattle, num: 16 },
  KING: { city: C.seattle, net: 'nbc', num: 5 },
  KMCC: { city: C.vegas, num: 34, brand: /\bvegas\s*34\b/i },
  WFTS: { city: C.tampa, net: 'abc', num: 28 },
  WXPX: { city: C.tampa, net: 'ion', num: 66 },
  WNPX: { city: C.nashville, net: 'ion', num: 28 },
  KMAX: { city: C.sacramento, net: 'cw', num: 31 },
};

const NET: Record<NonNullable<Station['net']>, RegExp> = {
  my: /\bmy\s*(network\s*tv|networktv|net|tv)?\s*\d*\b|\bmynetwork/i,
  cw: /\b(the\s*)?cw\b/i,
  nbc: /\bnbc\b(?!\s*(sports|news|universo))/i,
  abc: /\babc\b(?!\s*news)/i,
  cbs: /\bcbs\b(?!\s*(sports|news))/i,
  fox: /\bfox\b(?!\s*(sports|news|business|deportes|soul|weather))/i,
  ion: /\bion\b/i,
};

/** The station for a schedule name ("KSBI", "KSBI-IND"), if it's one of these. */
export function stationFor(name: string): (Station & { call: string }) | undefined {
  const call = name.trim().toUpperCase().split(/[-.\s]/)[0];
  const st = STATIONS[call];
  return st ? { ...st, call } : undefined;
}

/** Does a playlist channel name carry this station: its call sign, or its network / number / brand in its city. */
export function isStation(chName: string, st: Station & { call: string }): boolean {
  if (new RegExp(`\\b${st.call}\\b`, 'i').test(chName)) return true;
  if (st.brand?.test(chName)) return true;
  if (!st.city.test(chName)) return false;
  const num = st.num !== undefined && new RegExp(`(^|[^0-9.])${st.num}([^0-9]|$)`).test(chName);
  if (st.net) return NET[st.net].test(chName) && (num || st.net === 'my' || st.net === 'cw' || st.net === 'ion' || !/\b\d{1,2}\b/.test(chName));
  return num; // an independent station: its channel number in its city ("Charlotte 64")
}

export function stationChannels(name: string, lineup: LineupChannel[], country: (ch: LineupChannel) => string | undefined): LineupChannel[] | undefined {
  const st = stationFor(name);
  if (!st) return undefined;
  return lineup.filter((ch) => {
    if (ch.hidden || /\+\s?\d/.test(ch.originalName)) return false;
    const c = country(ch);
    if (c && c !== 'us') return false;
    return isStation(ch.originalName, st) || (!!ch.cleanedName && isStation(ch.cleanedName, st));
  });
}
