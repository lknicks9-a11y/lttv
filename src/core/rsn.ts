// Each MLB / NBA / NHL / WNBA team's local TV home (regional sports network or local station), in preference order.
// Names are what playlists and ESPN call them; channelsForBroadcast() finds them in the lineup (FanDuel / Bally names
// included). This is LTTV's built-in list (2025 season): for a game, ESPN's own local listing for that game wins,
// and this list fills in when ESPN has none.
import type { LineupChannel } from './types';
import { channelsForBroadcast } from './networks';
import { qualityRank } from './mytv';
import { isEnglishChannel } from './lang';
import { allTeams, type Team } from './teams';

const FD = (region: string) => [`FanDuel Sports Network ${region}`, `Bally Sports ${region}`];

export const TEAM_RSN: Record<string, string[]> = {
  // ---------------- MLB ----------------
  'mlb:ari': ['D-backs.TV', 'Arizona Diamondbacks'],
  'mlb:ath': ['NBC Sports California'],
  'mlb:atl': ['BravesVision', ...FD('South'), ...FD('Southeast')],
  'mlb:bal': ['MASN', 'MASN2'],
  'mlb:bos': ['NESN'],
  'mlb:chc': ['Marquee Sports Network'],
  'mlb:cws': ['Chicago Sports Network'],
  'mlb:cin': [...FD('Ohio')],
  'mlb:cle': ['Guardians.TV', ...FD('Great Lakes')],
  'mlb:col': ['Rockies.TV'],
  'mlb:det': [...FD('Detroit'), 'Detroit SportsNet'],
  'mlb:hou': ['Space City Home Network'],
  'mlb:kc': [...FD('Kansas City')],
  'mlb:laa': [...FD('West')],
  'mlb:lad': ['SportsNet LA'],
  'mlb:mia': [...FD('Florida')],
  'mlb:mil': [...FD('Wisconsin')],
  'mlb:min': ['Twins.TV', ...FD('North')],
  'mlb:nym': ['SNY'],
  'mlb:nyy': ['YES Network'],
  'mlb:phi': ['NBC Sports Philadelphia', 'NBC Sports Philadelphia+'],
  'mlb:pit': ['SportsNet Pittsburgh'],
  'mlb:sd': ['Padres.TV', 'San Diego Padres'],
  'mlb:sf': ['NBC Sports Bay Area'],
  'mlb:sea': ['ROOT SPORTS', 'Mariners.TV'],
  'mlb:stl': [...FD('Midwest')],
  'mlb:tb': [...FD('Sun')],
  'mlb:tex': ['Rangers SportsNet'],
  'mlb:tor': ['Sportsnet One', 'Sportsnet Ontario', 'Sportsnet'],
  'mlb:wsh': ['MASN', 'MASN2', 'Nationals.TV'],
  // ---------------- NBA ----------------
  'nba:atl': [...FD('Southeast')],
  'nba:bos': ['NBC Sports Boston'],
  'nba:bkn': ['YES Network'],
  'nba:cha': [...FD('Southeast')],
  'nba:chi': ['Chicago Sports Network'],
  'nba:cle': [...FD('Ohio')],
  'nba:dal': ['KFAA', 'Mavs.TV'],
  'nba:den': ['Altitude'],
  'nba:det': [...FD('Detroit')],
  'nba:gsw': ['NBC Sports Bay Area'],
  'nba:hou': ['Space City Home Network'],
  'nba:ind': [...FD('Indiana')],
  'nba:lac': [...FD('SoCal'), 'ClipperVision'],
  'nba:lal': ['Spectrum SportsNet'],
  'nba:mem': [...FD('Southeast')],
  'nba:mia': [...FD('Sun')],
  'nba:mil': [...FD('Wisconsin')],
  'nba:min': [...FD('North')],
  'nba:nop': ['Gulf Coast Sports', ...FD('New Orleans')],
  'nba:nyk': ['MSG'],
  'nba:okc': [...FD('Oklahoma')],
  'nba:orl': [...FD('Florida')],
  'nba:phi': ['NBC Sports Philadelphia', 'NBC Sports Philadelphia+'],
  'nba:phx': ["Arizona's Family", 'KTVK', 'Suns+'],
  'nba:por': ['BlazerVision', 'ROOT SPORTS'],
  'nba:sac': ['NBC Sports California'],
  'nba:sas': [...FD('Southwest'), 'KENS'],
  'nba:tor': ['TSN', 'Sportsnet'],
  'nba:uta': ['KJZZ', 'Jazz+'],
  'nba:was': ['Monumental Sports Network'],
  // ---------------- NHL ----------------
  'nhl:ana': ['KCOP', 'FOX 11 Plus', ...FD('West')],
  'nhl:bos': ['NESN'],
  'nhl:buf': ['MSG Buffalo', 'MSG'],
  'nhl:cgy': ['Sportsnet West', 'Sportsnet'],
  'nhl:car': [...FD('South')],
  'nhl:chi': ['Chicago Sports Network'],
  'nhl:col': ['Altitude'],
  'nhl:cbj': [...FD('Ohio')],
  'nhl:dal': ['Victory+', 'KTXA'],
  'nhl:det': [...FD('Detroit')],
  'nhl:edm': ['Sportsnet West', 'Sportsnet'],
  'nhl:fla': ['Panthers+', 'WSFL', ...FD('Florida')],
  'nhl:lak': [...FD('West')],
  'nhl:min': [...FD('North')],
  'nhl:mtl': ['TSN2', 'RDS', 'Sportsnet'],
  'nhl:nsh': [...FD('South')],
  'nhl:njd': ['MSG SportsNet'],
  'nhl:nyi': ['MSG SportsNet'],
  'nhl:nyr': ['MSG'],
  'nhl:ott': ['TSN5', 'TSN'],
  'nhl:phi': ['NBC Sports Philadelphia', 'NBC Sports Philadelphia+'],
  'nhl:pit': ['SportsNet Pittsburgh'],
  'nhl:sjs': ['NBC Sports California'],
  'nhl:sea': ['ROOT SPORTS', 'KONG'],
  'nhl:stl': [...FD('Midwest')],
  'nhl:tbl': [...FD('Sun')],
  'nhl:tor': ['Sportsnet Ontario', 'TSN4', 'Sportsnet'],
  'nhl:uta': ['KJZZ', 'Mammoth+'],
  'nhl:van': ['Sportsnet Pacific', 'Sportsnet'],
  'nhl:vgk': ['Vegas 34', 'KMCC'],
  'nhl:wsh': ['Monumental Sports Network'],
  'nhl:wpg': ['TSN3', 'TSN'],
  // ---------------- WNBA (mostly local stations) ----------------
  'wnba:atl': ['Peachtree TV'],
  'wnba:chi': ['Chicago Sports Network'],
  'wnba:con': ['NBC Sports Boston'],
  'wnba:dal': ['KFAA'],
  'wnba:gsv': ['NBC Sports Bay Area'],
  'wnba:ind': ['WALV', 'WTHR'],
  'wnba:lva': ['Vegas 34', 'KVVU'],
  'wnba:las': ['Spectrum SportsNet'],
  'wnba:min': [...FD('North')],
  'wnba:nyl': ['WNYW', 'FOX 5', 'WWOR'],
  'wnba:pho': ["Arizona's Family", 'KTVK'],
  'wnba:por': ['KGW', 'ROOT SPORTS'],
  'wnba:sea': ['KONG', 'ROOT SPORTS'],
  'wnba:tor': ['TSN', 'Sportsnet'],
  'wnba:was': ['Monumental Sports Network'],
};

export const RSN_LEAGUES = ['mlb', 'nba', 'nhl', 'wnba'] as const;

/** The best channels in the lineup for a list of network names: English, not another city's affiliate, best quality. */
export function channelsForNetworks(names: string[], lineup: LineupChannel[]): { ch: LineupChannel; network: string }[] {
  const out: { ch: LineupChannel; network: string }[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    const found = channelsForBroadcast(n, lineup)
      .filter((x) => x.fit !== 'affiliate' && isEnglishChannel(x.ch))
      .sort((a, b) => Number(b.fit === 'mytv') - Number(a.fit === 'mytv') || qualityRank(b.ch.originalName) - qualityRank(a.ch.originalName) || a.ch.number - b.ch.number);
    for (const f of found) {
      if (seen.has(f.ch.key)) continue;
      seen.add(f.ch.key);
      out.push({ ch: f.ch, network: n });
    }
  }
  return out;
}

/** A team's local-TV channels in the lineup (built-in list). */
export function rsnChannels(teamId: string, lineup: LineupChannel[]): { ch: LineupChannel; network: string }[] {
  const names = TEAM_RSN[teamId];
  return names ? channelsForNetworks(names, lineup) : [];
}

/** The built-in team for a scoreboard team (league + abbreviation, else name). */
export function teamForGame(league: string, t: { abbr: string; name: string; short: string }): Team | undefined {
  const all = allTeams().filter((x) => x.league === league);
  const abbr = t.abbr.toUpperCase();
  const f = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return all.find((x) => x.abbr.toUpperCase() === abbr && (f(x.short) === f(t.short) || f(x.name) === f(t.name))) ?? all.find((x) => f(x.name) === f(t.name)) ?? all.find((x) => x.abbr.toUpperCase() === abbr);
}
