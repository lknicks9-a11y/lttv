// Each NBA and NHL team's local TV channels (regional sports networks and over-the-air stations), so a game's
// stream list offers the home and away teams' own broadcasts from the user's playlist even when the schedule
// doesn't name them. Streaming-only services (Prime Video, DAZN, Peacock, team "+" apps) aren't channels in a
// playlist and aren't listed; French-language RDS isn't either (English streams only).
import type { LineupChannel } from './types';
import { channelCountry } from './mytv';
import { foldText, type GameTeam } from './schedule';

interface Station {
  label: string;
  /** Tested against the channel's name as the playlist has it. */
  re: RegExp;
  /** Canadian channel (TSN, Sportsnet). */
  ca?: boolean;
}

// Call signs are matched in capitals only, so "KING" doesn't match "King of Queens".
const S: Record<string, Station> = {
  wanf: { label: 'Atlanta News First (WANF)', re: /\bWANF\b|atlanta news first/i },
  peachtree: { label: 'Peachtree Sports Network', re: /peachtree\s*(sports|tv)/i },
  nbcsboston: { label: 'NBC Sports Boston', re: /\bnbc\s*sports?\s*boston\b|\bnbcs\s*boston\b/i },
  yes: { label: 'YES Network', re: /\byes\s*(network|net)\b|\bYES\b(?!\s*TV)/ },
  wsoc: { label: 'WSOC Channel 9', re: /\bWSOC\b/ },
  tv64: { label: 'TV64 (WAXN)', re: /\bWAXN\b|\btv\s*64\b/i },
  chsn: { label: 'Chicago Sports Network', re: /\bchicago\s*sports\s*network\b|\bCHSN\b/i },
  woio: { label: 'WOIO 19', re: /\bWOIO\b/ },
  wuab: { label: 'WUAB 43', re: /\bWUAB\b/ },
  kfaa: { label: 'KFAA 29', re: /\bKFAA\b/ },
  wfaa: { label: 'WFAA 8', re: /\bWFAA\b/ },
  altitude: { label: 'Altitude Sports', re: /\baltitude\b/i },
  wmyd: { label: 'WMYD TV20', re: /\bWMYD\b|\btv\s*20\s*detroit\b/i },
  nbcsba: { label: 'NBC Sports Bay Area', re: /\bnbc\s*sports?\s*bay\s*area\b|\bnbcs\s*bay\s*area\b/i },
  schn: { label: 'Space City Home Network', re: /\bspace\s*city\s*(home\s*)?network\b|\bSCHN\b/i },
  ktla: { label: 'KTLA 5', re: /\bKTLA\b/ },
  spectrumsn: { label: 'Spectrum SportsNet', re: /\bspectrum\s*sports\s*net\b(?!\s*(la|los angeles))/i },
  wplg: { label: 'WPLG Local 10', re: /\bWPLG\b/ },
  wvtv: { label: 'WVTV 24', re: /\bWVTV\b/ },
  kare: { label: 'KARE 11', re: /\bKARE\b/ },
  gcsen: { label: 'Gulf Coast Sports & Entertainment Network', re: /\bgulf\s*coast\s*sports\b|\bGCSEN\b/i },
  msg: { label: 'MSG', re: /^(?!.*\bbuffalo\b).*\bmsg\b(?!\s*(2|plus|\+|sports\s*net|sn)\b)/i },
  msgsn: { label: 'MSG SportsNet', re: /\bmsg\s*(2|plus|\+|sports\s*net|sn)\b/i },
  msgbuffalo: { label: 'MSG Buffalo', re: /\bmsg\b.*\bbuffalo\b|\bmsgb\b/i },
  ksbi: { label: 'KSBI 52', re: /\bKSBI\b/ },
  kqcw: { label: 'KQCW 19', re: /\bKQCW\b/ },
  wrdq: { label: 'WRDQ 27', re: /\bWRDQ\b/ },
  wftv: { label: 'WFTV 9', re: /\bWFTV\b/ },
  nbcsphilly: { label: 'NBC Sports Philadelphia', re: /\bnbc\s*sports?\s*phil(adelphia|ly)\b|\bnbcs\s*phil/i },
  kphe: { label: 'KPHE 44', re: /\bKPHE\b/ },
  ktvk: { label: "Arizona's Family (KTVK 3)", re: /\bKTVK\b|arizona'?s\s*family/i },
  kunp: { label: 'KUNP', re: /\bKUNP\b/ },
  nbcsca: { label: 'NBC Sports California', re: /\bnbc\s*sports?\s*california\b|\bnbcs\s*(california|cal)\b/i },
  woai: { label: 'WOAI', re: /\bWOAI\b/ },
  kjzz: { label: 'KJZZ 14', re: /\bKJZZ\b/ },
  monumental: { label: 'Monumental Sports Network', re: /\bmonumental\s*sports\b|\bmonumental\b/i },
  kcop: { label: 'KCOP 13', re: /\bKCOP\b/ },
  nesn: { label: 'NESN', re: /\bnesn\b(?!\s*(plus|\+))/i },
  detroitsn: { label: 'Detroit SportsNet', re: /\bdetroit\s*sports\s*net\b/i },
  snpitt: { label: 'SportsNet Pittsburgh', re: /\bsports\s*net\s*pittsburgh\b/i },
  kong: { label: 'KONG 16', re: /\bKONG\b(?!.*\bking\b)/ },
  king: { label: 'KING 5', re: /\bKING\s*5\b|\bKING\b.*\b(seattle|nbc)\b/i },
  // Scripps Sports stations
  wsfl: { label: 'WSFL 39 (Scripps Sports)', re: /\bWSFL\b/ },
  wftx: { label: 'WFTX', re: /\bWFTX\b/ },
  wnpx: { label: 'WNPX (Scripps Sports)', re: /\bWNPX\b/ },
  wxpx: { label: 'WXPX 66 (Scripps Sports)', re: /\bWXPX\b/ },
  wfts: { label: 'WFTS Tampa Bay 28', re: /\bWFTS\b/ },
  kmcc: { label: 'Vegas 34 (KMCC)', re: /\bKMCC\b|\bvegas\s*34\b/i },
  kupx: { label: 'Utah 16 (KUPX)', re: /\bKUPX\b|\butah\s*16\b/i },
  scripps: { label: 'Scripps Sports', re: /\bscripps\s*sports\b/i },
  abtv: { label: 'Angels Broadcast Television', re: /\bangels\s*broadcast\b|\bABTV\b/ },
  // Canada
  tsn: { label: 'TSN', re: /\btsn\s*[1-5]?\b/i, ca: true },
  tsn2: { label: 'TSN2', re: /\btsn\s*2\b/i, ca: true },
  tsn3: { label: 'TSN3', re: /\btsn\s*3\b/i, ca: true },
  tsn5: { label: 'TSN5', re: /\btsn\s*5\b/i, ca: true },
  sn: { label: 'Sportsnet', re: /\bsports\s*net\b(?!\s*(new york|pittsburgh|la\b|los angeles|360|one\b|world))|\bsn\s*(ontario|east|west|pacific)\b/i, ca: true },
  snwest: { label: 'Sportsnet West', re: /\bsports\s*net\s*west\b|\bsn\s*west\b/i, ca: true },
  snpacific: { label: 'Sportsnet Pacific', re: /\bsports\s*net\s*pacific\b|\bsn\s*pacific\b/i, ca: true },
};

/** league → team nickname (as in "Boston Celtics") → its local channels, in order of preference. */
export const TEAM_NETWORKS: Record<'nba' | 'nhl', Record<string, (keyof typeof S)[]>> = {
  nba: {
    hawks: ['wanf', 'peachtree'],
    celtics: ['nbcsboston'],
    nets: ['yes'],
    hornets: ['wsoc', 'tv64'],
    bulls: ['chsn'],
    cavaliers: ['woio', 'wuab'],
    mavericks: ['kfaa', 'wfaa'],
    nuggets: ['altitude'],
    pistons: ['wmyd'],
    warriors: ['nbcsba'],
    rockets: ['schn'],
    pacers: [],
    clippers: ['ktla'],
    lakers: ['spectrumsn'],
    grizzlies: [],
    heat: ['wplg'],
    bucks: ['wvtv'],
    timberwolves: ['kare'],
    pelicans: ['gcsen'],
    knicks: ['msg'],
    thunder: ['ksbi', 'kqcw'],
    magic: ['wrdq', 'wftv'],
    '76ers': ['nbcsphilly'],
    suns: ['kphe', 'ktvk'],
    'trail blazers': ['kunp'],
    kings: ['nbcsca'],
    spurs: ['woai'],
    raptors: ['tsn', 'sn'],
    jazz: ['kjzz'],
    wizards: ['monumental'],
  },
  nhl: {
    ducks: ['kcop'],
    bruins: ['nesn'],
    sabres: ['msgbuffalo'],
    flames: ['snwest', 'sn'],
    hurricanes: [],
    blackhawks: ['chsn'],
    avalanche: ['altitude'],
    'blue jackets': [],
    stars: [],
    'red wings': ['detroitsn'],
    oilers: ['snwest', 'sn'],
    panthers: ['wsfl', 'scripps'],
    kings: ['abtv'],
    wild: [],
    canadiens: ['tsn2'],
    predators: ['wnpx', 'scripps'],
    devils: ['msgsn', 'msg'],
    islanders: ['msgsn', 'msg'],
    rangers: ['msg', 'msgsn'],
    senators: ['tsn5'],
    flyers: ['nbcsphilly'],
    penguins: ['snpitt'],
    sharks: ['nbcsca'],
    kraken: ['kong', 'king'],
    blues: [],
    lightning: ['wxpx', 'wfts', 'scripps'],
    'maple leafs': ['sn', 'tsn'],
    mammoth: ['kupx', 'scripps'],
    'hockey club': ['kupx', 'scripps'],
    canucks: ['snpacific', 'sn'],
    'golden knights': ['kmcc', 'scripps'],
    capitals: ['monumental'],
    jets: ['tsn3', 'sn'],
  },
};

/** The team's local channel list, by its nickname. */
export function teamStations(league: string, team: Pick<GameTeam, 'name' | 'short'>): Station[] {
  const table = (TEAM_NETWORKS as Record<string, Record<string, (keyof typeof S)[]>>)[league];
  if (!table) return [];
  const name = ` ${foldText(`${team.name} ${team.short ?? ''}`)} `;
  // Longest nickname first ("trail blazers" before "blazers"-like overlaps).
  const nick = Object.keys(table).sort((a, b) => b.length - a.length).find((n) => name.includes(` ${foldText(n)} `));
  return nick ? table[nick].map((id) => S[id]) : [];
}

const cache = new WeakMap<LineupChannel[], Map<Station, LineupChannel[]>>();
/** The playlist's channels for one station (US ones, or Canadian for TSN/Sportsnet), no timeshift copies. */
export function stationChannels(st: Station, lineup: LineupChannel[]): LineupChannel[] {
  const m = cache.get(lineup) ?? new Map<Station, LineupChannel[]>();
  cache.set(lineup, m);
  let v = m.get(st);
  if (!v) {
    v = lineup.filter((ch) => {
      if (ch.hidden || /\+\s?\d/.test(ch.originalName)) return false;
      const country = channelCountry(ch);
      if (st.ca ? country && country !== 'ca' : country && country !== 'us') return false;
      return st.re.test(ch.originalName) || (!!ch.cleanedName && st.re.test(ch.cleanedName));
    });
    m.set(st, v);
  }
  return v;
}

/** Each team's local channels for a game that are in the playlist. */
export function teamLocalChannels(league: string, team: Pick<GameTeam, 'name' | 'short'>, lineup: LineupChannel[]): { ch: LineupChannel; label: string; rank: number }[] {
  const out: { ch: LineupChannel; label: string; rank: number }[] = [];
  const seen = new Set<string>();
  teamStations(league, team).forEach((st, rank) => {
    for (const ch of stationChannels(st, lineup)) {
      if (seen.has(ch.key)) continue;
      seen.add(ch.key);
      out.push({ ch, label: st.label, rank });
    }
  });
  return out;
}
