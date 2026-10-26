// Which channels a game is on, from each league's own official schedule feed (not ESPN):
//   NHL  — api-web.nhle.com schedule: tvBroadcasts per game (network, market H/A/N, country)
//   NBA / WNBA — cdn.nba.com / cdn.wnba.com league schedule: national, home and away TV broadcasters
//   MLB  — statsapi.mlb.com schedule with broadcasts: TV name, home/away, national
// Each game's listing is matched to the schedule's game by the two teams and the start time.
import type { Broadcast, Game, GameTeam } from './schedule';
import { foldText } from './schedule';

export type ListingLeague = 'nhl' | 'nba' | 'wnba' | 'mlb';
export const LISTING_LEAGUES: ListingLeague[] = ['nhl', 'nba', 'wnba', 'mlb'];

export interface TvListing {
  start: number;
  home: string[];
  away: string[];
  broadcasts: Broadcast[];
}

/** The feed for a league and day ("20261025"). */
export function listingUrl(league: ListingLeague, day: string): string {
  const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
  switch (league) {
    case 'nhl':
      return `https://api-web.nhle.com/v1/schedule/${iso}`;
    case 'mlb':
      return `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${iso}&hydrate=broadcasts(all),team`;
    case 'nba':
      return 'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json';
    case 'wnba':
      return 'https://cdn.wnba.com/static/json/staticData/scheduleLeagueV2_1.json';
  }
}

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === 'object' ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const def = (v: unknown): string => str(obj(v).default) || str(v);
const STREAMING = /\+|prime|peacock|apple|netflix|paramount|max\b|stream|pass|app\b|dazn|youtube|victory|ott/i;

function add(out: Broadcast[], name: string, market: Broadcast['market']) {
  // "WTTV/WXIN", "KONG & KING": each station on its own.
  let parts = name.split(/\s*\/\s*/).filter((x) => x.trim().length >= 2);
  if (parts.length < 2) {
    const short = name.split(/\s*[&,]\s*/).filter((x) => x.trim().length >= 2);
    if (short.length > 1 && short.every((x) => x.length <= 10)) parts = short; // "KONG & KING", not "Sports & Entertainment"
  }
  if (parts.length > 1) {
    for (const p of parts) add(out, p, market);
    return;
  }
  const n = name.trim();
  if (!n || out.some((b) => b.name.toLowerCase() === n.toLowerCase() && b.market === market)) return;
  out.push({ name: n, market, kind: STREAMING.test(n) ? 'streaming' : 'tv' });
}

/** NHL broadcast abbreviations as channel names; the country decides the ambiguous ones (SNP). */
const NHL_NAMES: Record<string, string> = {
  SN: 'Sportsnet', SN1: 'Sportsnet ONE', SN360: 'Sportsnet 360', SNE: 'Sportsnet East', SNO: 'Sportsnet Ontario', SNW: 'Sportsnet West',
  TSN1: 'TSN1', TSN2: 'TSN2', TSN3: 'TSN3', TSN4: 'TSN4', TSN5: 'TSN5', TVAS: 'TVA Sports', RDS: 'RDS', CBC: 'CBC', CITY: 'Citytv',
  NHLN: 'NHL Network', MSG: 'MSG', MSGSN: 'MSG SportsNet', MSG2: 'MSG SportsNet', 'MSG-B': 'MSG Buffalo', MSGB: 'MSG Buffalo', NESN: 'NESN', 'NESN+': 'NESN+',
  NBCSP: 'NBC Sports Philadelphia', NBCSCA: 'NBC Sports California', 'NBCS-CA': 'NBC Sports California', CHSN: 'Chicago Sports Network', ALT: 'Altitude', ALT2: 'Altitude 2',
  MNMT: 'Monumental Sports Network', MNMT2: 'Monumental Sports Network 2', SCRIPPS: 'Scripps Sports', 'KCOP-13': 'KCOP', KCOP: 'KCOP', TRUTV: 'truTV',
  MSGSN2: 'MSG SportsNet', 'SN+': 'Sportsnet', BSN: 'Sportsnet', CBJNHL: 'Blue Jackets Hockey Network', CBJHN: 'Blue Jackets Hockey Network',
  MINNHL: 'Minnesota Wild', STLNHL: 'St. Louis Blues', CARNHL: 'Carolina Hurricanes', ABTV: 'Angels Broadcast Television', 'FOXLA+': 'KCOP',
  ESPN: 'ESPN', ESPN2: 'ESPN2', ABC: 'ABC', TNT: 'TNT', TBS: 'TBS', 'NBCSCH': 'Chicago Sports Network', DSN: 'Detroit SportsNet', 'DET SN': 'Detroit SportsNet',
  KONG: 'KONG', KING: 'KING 5', KUPX: 'KUPX', 'UTAH16': 'KUPX', WSFL: 'WSFL', WXPX: 'WXPX', WFTS: 'WFTS', KMCC: 'KMCC', 'VEGAS34': 'KMCC', WNPX: 'WNPX',
  'SN-PIT': 'SportsNet Pittsburgh', SNPIT: 'SportsNet Pittsburgh', 'NBCS-PH': 'NBC Sports Philadelphia', 'NBCSP+': 'NBC Sports Philadelphia+',
};

/** NHL: api-web.nhle.com/v1/schedule/{date}. */
export function parseNhlListings(json: unknown): TvListing[] {
  const out: TvListing[] = [];
  for (const wk of arr(obj(json).gameWeek)) {
    for (const g of arr(obj(wk).games).map(obj)) {
      const start = Date.parse(str(g.startTimeUTC));
      const team = (t: J) => [def(t.commonName), `${def(t.placeName)} ${def(t.commonName)}`, str(t.abbrev)].filter(Boolean);
      const broadcasts: Broadcast[] = [];
      const tv = arr(g.tvBroadcasts).map(obj);
      const anyUs = tv.some((b) => str(b.countryCode).toUpperCase() === 'US');
      for (const b of tv) {
        const code = str(b.network).trim();
        const country = str(b.countryCode).toUpperCase();
        // Canada-wide broadcasts only when the game has no US broadcast (a Canadian team's own channel stays).
        if (country === 'CA' && str(b.market).toUpperCase() === 'N' && anyUs) continue;
        const name = code === 'SNP' ? (country === 'CA' ? 'Sportsnet Pacific' : 'SportsNet Pittsburgh') : NHL_NAMES[code.toUpperCase()] ?? code;
        const m = str(b.market).toUpperCase();
        add(broadcasts, name, m === 'H' ? 'home' : m === 'A' ? 'away' : 'national');
      }
      if (Number.isFinite(start)) out.push({ start, home: team(obj(g.homeTeam)), away: team(obj(g.awayTeam)), broadcasts });
    }
  }
  return out;
}

/** NBA / WNBA: the league schedule (all season); only games between `from` and `to` are kept. */
export function parseNbaListings(json: unknown, from: number, to: number): TvListing[] {
  const out: TvListing[] = [];
  for (const d of arr(obj(obj(json).leagueSchedule).gameDates)) {
    for (const g of arr(obj(d).games).map(obj)) {
      const start = Date.parse(str(g.gameDateTimeUTC) || str(g.gameDateUTC));
      if (!Number.isFinite(start) || start < from || start > to) continue;
      const team = (t: J) => [str(t.teamName), `${str(t.teamCity)} ${str(t.teamName)}`, str(t.teamTricode)].filter((x) => x.trim());
      const bc = obj(g.broadcasters);
      const broadcasts: Broadcast[] = [];
      const take = (key: string, market: Broadcast['market']) => {
        for (const b of arr(bc[key]).map(obj)) {
          const media = str(b.broadcasterMedia).toLowerCase();
          if (media && media !== 'tv') continue;
          add(broadcasts, str(b.broadcasterDisplay) || str(b.broadcasterAbbreviation), market);
        }
      };
      take('nationalTvBroadcasters', 'national');
      take('nationalBroadcasters', 'national');
      take('homeTvBroadcasters', 'home');
      take('awayTvBroadcasters', 'away');
      out.push({ start, home: team(obj(g.homeTeam)), away: team(obj(g.awayTeam)), broadcasts });
    }
  }
  return out;
}

/** MLB: statsapi.mlb.com schedule with broadcasts(all). */
export function parseMlbListings(json: unknown): TvListing[] {
  const out: TvListing[] = [];
  for (const d of arr(obj(json).dates)) {
    for (const g of arr(obj(d).games).map(obj)) {
      const start = Date.parse(str(g.gameDate));
      const teams = obj(g.teams);
      const team = (side: string) => {
        const t = obj(obj(obj(teams)[side]).team);
        return [str(t.teamName), str(t.name), str(t.clubName), str(t.abbreviation)].filter(Boolean);
      };
      const broadcasts: Broadcast[] = [];
      for (const b of arr(g.broadcasts).map(obj)) {
        if (str(b.type).toUpperCase() !== 'TV') continue;
        if (str(b.language) && str(b.language) !== 'en') continue;
        const ha = str(b.homeAway).toLowerCase();
        add(broadcasts, str(b.name) || str(b.callSign), b.isNational === true ? 'national' : ha === 'home' ? 'home' : ha === 'away' ? 'away' : 'national');
      }
      if (Number.isFinite(start)) out.push({ start, home: team('home'), away: team('away'), broadcasts });
    }
  }
  return out;
}

export function parseListings(league: ListingLeague, json: unknown, from: number, to: number): TvListing[] {
  if (league === 'nhl') return parseNhlListings(json);
  if (league === 'mlb') return parseMlbListings(json);
  return parseNbaListings(json, from, to);
}

function sameTeam(t: GameTeam, names: string[]): boolean {
  const mine = [t.name, t.short, t.abbr].map(foldText).filter((x) => x.length >= 2);
  return names.map(foldText).some((n) => n.length >= 2 && mine.some((m) => m === n || (n.length >= 4 && ` ${m} `.includes(` ${n} `)) || (m.length >= 4 && ` ${n} `.includes(` ${m} `))));
}

/** The official listing for a game: same two teams, starting within three hours of each other. */
export function listingFor(game: Game, listings: TvListing[]): TvListing | undefined {
  return listings.find((l) => Math.abs(l.start - game.start) < 3 * 3600_000 && sameTeam(game.home, l.home) && sameTeam(game.away, l.away));
}
