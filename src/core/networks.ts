// TV networks as the schedule names them ("NBC Sports Phil", "FDSN Detroit", "USA Net")
// and as IPTV playlists name them ("US: NBC Sports Philadelphia HD", "Bally Sports Detroit").
// Used to find which of the user's own channels carries a broadcast.
import type { LineupChannel } from './types';
import { normalizeForMatch } from './normalize';
import { stripCountry } from './match';
import { channelCountry } from './mytv';

export interface Network {
  id: string;
  label: string;
  /** Compact channel keys (see channelKey) that are this network. */
  keys: string[];
  /** My TV numbers (New York/NJ locals) that carry this network, preferred in that order. */
  local?: number[];
  /** Over-the-air network: affiliates elsewhere carry it too ("CBS Boston"). */
  broadcast?: boolean;
  rsn?: boolean;
  /** Not a US channel (TSN, Sportsnet, Sky…). */
  country?: string;
}

/** Compact name key used for matching: "US: ESPN 2 FHD" -> "espn2", "AMC East" -> "amc". */
export function channelKey(name: string): string {
  return normalizeForMatch(name).split(' ').filter((t) => t !== 'east' && t !== 'the').join('');
}

/** Keys for a playlist name, with and without a leading country word ("USA Network" stays, "USA ESPN" -> "espn"). */
export function channelKeys(name: string): string[] {
  const full = channelKey(name);
  const st = stripCountry(name);
  return st ? [full, channelKey(st)] : [full];
}

const N = (id: string, label: string, keys: string[], extra: Partial<Network> = {}): Network => ({ id, label, keys, ...extra });

export const NETWORKS: Network[] = [
  // Broadcast networks (New York affiliates first)
  N('abc', 'ABC', ['abc'], { local: [7], broadcast: true }),
  N('cbs', 'CBS', ['cbs'], { local: [2], broadcast: true }),
  N('nbc', 'NBC', ['nbc'], { local: [4], broadcast: true }),
  N('fox', 'FOX', ['fox'], { local: [5], broadcast: true }),
  N('cw', 'The CW', ['cw', 'thecw'], { local: [11], broadcast: true }),
  N('ion', 'ION', ['ion', 'iontelevision'], { local: [31, 305], broadcast: true }),
  N('pbs', 'PBS', ['pbs'], { local: [13], broadcast: true }),
  N('telemundo', 'Telemundo', ['telemundo'], { local: [47], broadcast: true }),
  N('univision', 'Univision', ['univision'], { local: [41, 402], broadcast: true }),
  N('unimas', 'UniMás', ['unimas'], { local: [68, 408], broadcast: true }),
  N('my9', 'MyNetworkTV', ['my9', 'mynetworktv'], { local: [9], broadcast: true }),
  // National cable
  N('espn', 'ESPN', ['espn'], { local: [206] }),
  N('espn2', 'ESPN2', ['espn2'], { local: [209] }),
  N('espnu', 'ESPNU', ['espnu'], { local: [208] }),
  N('espnews', 'ESPNEWS', ['espnews'], { local: [207] }),
  N('espndeportes', 'ESPN Deportes', ['espndeportes']),
  N('tnt', 'TNT', ['tnt'], { local: [245] }),
  N('tbs', 'TBS', ['tbs'], { local: [247] }),
  N('trutv', 'truTV', ['trutv'], { local: [246] }),
  N('fs1', 'FS1', ['fs1', 'foxsports1'], { local: [219] }),
  N('fs2', 'FS2', ['fs2', 'foxsports2'], { local: [618] }),
  N('foxdeportes', 'FOX Deportes', ['foxdeportes']),
  N('cbssn', 'CBS Sports Network', ['cbssportsnetwork', 'cbssn', 'cbssportsnet'], { local: [221] }),
  N('usa', 'USA Network', ['usanetwork', 'usa'], { local: [242] }),
  N('cnbc', 'CNBC', ['cnbc'], { local: [355] }),
  N('nflnet', 'NFL Network', ['nflnetwork', 'nfln', 'nflnet'], { local: [212] }),
  N('redzone', 'NFL RedZone', ['nflredzone', 'redzone'], { local: [211] }),
  N('nbatv', 'NBA TV', ['nbatv'], { local: [216] }),
  N('mlbnet', 'MLB Network', ['mlbnetwork', 'mlbn', 'mlbnet'], { local: [213] }),
  N('nhlnet', 'NHL Network', ['nhlnetwork', 'nhlnet'], { local: [215] }),
  N('btn', 'Big Ten Network', ['bigtennetwork', 'btn', 'b1gnetwork', 'big10network'], { local: [610] }),
  N('secn', 'SEC Network', ['secnetwork', 'secn'], { local: [611] }),
  N('accn', 'ACC Network', ['accnetwork', 'accn'], { local: [612] }),
  N('lhn', 'Longhorn Network', ['longhornnetwork', 'lhn']),
  N('pac12', 'Pac-12 Network', ['pac12network', 'pac12']),
  N('golf', 'Golf Channel', ['golfchannel', 'golf'], { local: [218] }),
  N('tennis', 'Tennis Channel', ['tennischannel', 'tennis'], { local: [217] }),
  N('bein', 'beIN SPORTS', ['beinsports', 'bein', 'beinsportsusa']),
  N('beinesp', 'beIN SPORTS en Español', ['beinsportsenespanol', 'beinsportsespanol', 'beinespanol']),
  N('tudn', 'TUDN', ['tudn'], { local: [464] }),
  N('golazo', 'CBS Sports Golazo', ['cbssportsgolazonetwork', 'cbssportsgolazo', 'golazo', 'golazonetwork']),
  N('paramountplus', 'Paramount+', ['paramountplus']),
  N('vix', 'ViX', ['vix', 'vixplus']),
  N('peacock', 'Peacock', ['peacock']),
  N('universo', 'Universo', ['universo'], { local: [410] }),
  N('galavision', 'Galavisión', ['galavision'], { local: [404] }),
  // New York RSNs
  N('yes', 'YES Network', ['yesnetwork', 'yes'], { local: [631], rsn: true }),
  N('sny', 'SNY', ['sny', 'sportsnetnewyork'], { local: [639], rsn: true }),
  N('msg', 'MSG', ['msg', 'msgnetwork'], { local: [634], rsn: true }),
  N('msgb', 'MSG Buffalo', ['msgbuffalo', 'msgb'], { rsn: true }),
  N('msgsn', 'MSG SportsNet', ['msgsportsnet', 'msgsn', 'msgplus', 'msg2', 'msgsn2', 'msgsportsnet2'], { local: [635], rsn: true }),
  // Other RSNs
  N('nesn', 'NESN', ['nesn', 'newenglandsportsnetwork'], { local: [628], rsn: true }),
  N('nesnplus', 'NESN+', ['nesnplus']),
  N('nbcsboston', 'NBC Sports Boston', ['nbcsportsboston', 'nbcsboston', 'nbcsb', 'nbcsbos'], { local: [630], rsn: true }),
  N('nbcsphilly', 'NBC Sports Philadelphia', ['nbcsportsphiladelphia', 'nbcsphiladelphia', 'nbcsportsphilly', 'nbcsphilly', 'nbcsph', 'nbcsp', 'nbcsportsphila'], { rsn: true }),
  N('nbcsphillyplus', 'NBC Sports Philadelphia+', ['nbcsportsphiladelphiaplus', 'nbcsphiladelphiaplus'], { rsn: true }),
  N('nbcsba', 'NBC Sports Bay Area', ['nbcsportsbayarea', 'nbcsbayarea', 'nbcsba', 'nbcsportsba'], { rsn: true }),
  N('nbcsca', 'NBC Sports California', ['nbcsportscalifornia', 'nbcscalifornia', 'nbcsportsca', 'nbcsca', 'nbcsportscal', 'nbcscal'], { rsn: true }),
  N('chsn', 'Chicago Sports Network', ['chicagosportsnetwork', 'chsn'], { rsn: true }),
  N('marquee', 'Marquee Sports Network', ['marqueesportsnetwork', 'marquee'], { rsn: true }),
  N('masn', 'MASN', ['masn', 'midatlanticsportsnetwork'], { rsn: true }),
  N('masn2', 'MASN2', ['masn2'], { rsn: true }),
  N('monumental', 'Monumental Sports Network', ['monumentalsportsnetwork', 'monumental', 'monumentalsports', 'mnmt'], { rsn: true }),
  N('altitude', 'Altitude', ['altitude', 'altitudesports', 'alt', 'altitudesportsandentertainment'], { rsn: true }),
  N('schn', 'Space City Home Network', ['spacecityhomenetwork', 'schn', 'spacecity'], { rsn: true }),
  N('spectrumsn', 'Spectrum SportsNet', ['spectrumsportsnet'], { rsn: true }),
  N('snla', 'SportsNet LA', ['spectrumsportsnetla', 'spectrumsportsnetlosangeles', 'sportsnetla', 'snla'], { rsn: true }),
  N('snpitt', 'SportsNet Pittsburgh', ['sportsnetpittsburgh', 'snpittsburgh', 'attsportsnetpittsburgh'], { rsn: true }),
  N('root', 'ROOT SPORTS', ['rootsports', 'rootsportsnorthwest', 'rootsportsnw'], { rsn: true }),
  N('detroitsn', 'Detroit SportsNet', ['detroitsportsnet'], { rsn: true }),
  N('rangerssn', 'Rangers SportsNet', ['rangerssportsnet'], { rsn: true }),
  N('bravesvision', 'BravesVision', ['bravesvision'], { rsn: true }),
  N('thespot', 'The Spot', ['thespot'], { rsn: true }),
  N('kjzz', 'KJZZ', ['kjzz'], { rsn: true }),
  N('victory', 'Victory+', ['victoryplus', 'victory'], { rsn: true }),
  // Canada
  N('tsn1', 'TSN1', ['tsn1'], { country: 'ca' }), N('tsn2', 'TSN2', ['tsn2'], { country: 'ca' }), N('tsn3', 'TSN3', ['tsn3'], { country: 'ca' }),
  N('tsn4', 'TSN4', ['tsn4'], { country: 'ca' }), N('tsn5', 'TSN5', ['tsn5'], { country: 'ca' }),
  N('sn', 'Sportsnet', ['sportsnet', 'sportsnetontario', 'sportsneteast', 'sportsnetwest', 'sportsnetpacific'], { country: 'ca' }),
  N('sn1', 'Sportsnet ONE', ['sportsnetone', 'sn1'], { country: 'ca' }),
  N('sn360', 'Sportsnet 360', ['sportsnet360', 'sn360'], { country: 'ca' }),
  N('cbc', 'CBC', ['cbc'], { country: 'ca' }),
  N('rds', 'RDS', ['rds'], { country: 'ca' }),
  N('tva', 'TVA Sports', ['tvasports'], { country: 'ca' }),
];

/** FanDuel Sports Network (formerly Bally Sports) regions, by the abbreviations ESPN uses. */
const FDSN_REGIONS: Record<string, string> = {
  det: 'detroit', detroit: 'detroit', fl: 'florida', fla: 'florida', florida: 'florida', mw: 'midwest', midwest: 'midwest', n: 'north', north: 'north',
  oh: 'ohio', ohio: 'ohio', ok: 'oklahoma', okla: 'oklahoma', oklahoma: 'oklahoma', socal: 'socal', s: 'south', south: 'south', se: 'southeast', southeast: 'southeast',
  sw: 'southwest', southwest: 'southwest', sun: 'sun', w: 'west', west: 'west', wi: 'wisconsin', wis: 'wisconsin', wisconsin: 'wisconsin', in: 'indiana', ind: 'indiana', indiana: 'indiana',
  no: 'neworleans', nola: 'neworleans', neworleans: 'neworleans', kc: 'kansascity', kansascity: 'kansascity', gl: 'greatlakes', greatlakes: 'greatlakes', cin: 'cincinnati', cincinnati: 'cincinnati',
};

const ABBREV: [RegExp, string][] = [
  [/\bnbcs\b/g, 'nbc sports'], [/\bphil\b/g, 'philadelphia'], [/\bba\b/g, 'bay area'], [/\bbos\b/g, 'boston'], [/\bchi\b/g, 'chicago'],
  [/\bcal\b/g, 'california'], [/\bpitt?\b/g, 'pittsburgh'], [/\bsn\b/g, 'sportsnet'], [/\bnet\b/g, 'network'], [/\bntwk\b/g, 'network'],
  [/\bla\b/g, 'la'], [/\bny\b/g, 'new york'], [/\bnw\b/g, 'northwest'], [/\bmtn\b/g, 'monumental'], [/\+/g, ' plus'],
];

/** Find the network a schedule broadcast name refers to. */
export function networkForBroadcast(name: string): { network?: Network; keys: string[] } {
  let s = name.toLowerCase().replace(/\(local\)|\blocal\b/g, ' ').replace(/[^a-z0-9+ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  // "The Spot - MTN" style: try the part before the dash too.
  const fd = /^(?:fdsn|fanduel\s*(?:sports)?\s*(?:network|sn)?|bally\s*sports|bally)\s+(.+)$/.exec(s);
  if (fd) {
    const region = FDSN_REGIONS[fd[1].replace(/\s+/g, '')];
    if (region) return { keys: [`fanduelsports${region}`, `fanduelsportsnetwork${region}`, `fdsn${region}`, `ballysports${region}`, `fanduelsn${region}`] };
  }
  for (const [re, v] of ABBREV) s = s.replace(re, v);
  const key = channelKey(s);
  const direct = NETWORKS.find((n) => n.keys.includes(key) || channelKey(n.label) === key);
  if (direct) return { network: direct, keys: direct.keys };
  const first = channelKey(name.split(/\s+-\s+/)[0]);
  const byFirst = NETWORKS.find((n) => n.keys.includes(first));
  if (byFirst) return { network: byFirst, keys: byFirst.keys };
  return { keys: key ? [key] : [] };
}

const OTHER_CITY = /\b(boston|philadelphia|chicago|los angeles|dallas|houston|atlanta|miami|detroit|denver|seattle|phoenix|washington|baltimore|cleveland|pittsburgh|tampa|orlando|minneapolis|st louis|san francisco|bay area|sacramento|portland|las vegas|kansas city|charlotte|nashville|new orleans|buffalo|albany|hartford|providence)\b/i;

export interface NetworkChannel {
  ch: LineupChannel;
  /** New York/NJ channel (My TV), the network itself, or an affiliate in another city. */
  fit: 'mytv' | 'exact' | 'affiliate';
}

/** The user's channels that carry a network/broadcast name. */
const bcCache = new WeakMap<LineupChannel[], Map<string, NetworkChannel[]>>();
/** Channels in the lineup for a broadcast name (worked out once per lineup; games share networks). */
export function channelsForBroadcast(name: string, lineup: LineupChannel[]): NetworkChannel[] {
  const m = bcCache.get(lineup) ?? new Map<string, NetworkChannel[]>();
  bcCache.set(lineup, m);
  let v = m.get(name);
  if (!v) {
    v = channelsForBroadcastUncached(name, lineup);
    if (m.size > 300) m.clear();
    m.set(name, v);
  }
  return v;
}
function channelsForBroadcastUncached(name: string, lineup: LineupChannel[]): NetworkChannel[] {
  const { network, keys } = networkForBroadcast(name);
  if (!keys.length && !network) return [];
  const out: NetworkChannel[] = [];
  const seen = new Set<string>();
  const push = (ch: LineupChannel, fit: NetworkChannel['fit']) => {
    if (seen.has(ch.key) || ch.hidden) return;
    seen.add(ch.key);
    out.push({ ch, fit });
  };
  if (network?.local) for (const n of network.local) for (const ch of lineup) if (ch.myTv === n) push(ch, 'mytv');
  const wantCountry = network?.country ?? 'us';
  for (const ch of lineup) {
    if (seen.has(ch.key)) continue;
    const country = channelCountry(ch);
    if (country && country !== wantCountry) continue;
    if (/\+\s?\d/.test(ch.originalName)) continue; // timeshift
    if (channelKeys(ch.cleanedName || ch.originalName).some((k) => keys.includes(k))) {
      push(ch, 'exact');
      continue;
    }
    if (network?.broadcast) {
      // "CBS 2 New York", "FOX 29 Philadelphia (WTXF)": an affiliate of the network.
      const w = network.keys[0];
      const re = new RegExp(`(^|[^a-z])${w}(\\s*\\d+)?\\b(?!\\s*(sports|news|business|weather|deportes|life|soul|kids|movies|sp))`, 'i');
      if (re.test(ch.originalName) && (OTHER_CITY.test(ch.originalName) || /\b[KW][A-Z]{2,3}\b/.test(ch.originalName))) push(ch, 'affiliate');
    }
  }
  // A local station or network named with extras ("KJZZ 14 Salt Lake", "KTLA 5", "Peachtree Sports Network HD"):
  // channels whose name has the broadcast's name as whole words.
  if (!out.length && !network?.broadcast) {
    const want = normalizeForMatch((network?.label ?? name).replace(/\(local\)|\blocal\b/gi, ' ')).trim();
    if (want.length >= 4 && !/^(tv|local tv|streaming|radio|regional)$/.test(want)) {
      const re = new RegExp(`(^| )${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
      for (const ch of lineup) {
        const country = channelCountry(ch);
        if ((country && country !== 'us') || /\+\s?\d/.test(ch.originalName)) continue;
        if (re.test(normalizeForMatch(ch.cleanedName || ch.originalName))) push(ch, 'exact');
      }
    }
  }
  return out;
}
