// Which channels a game is on, from each league's own official schedule feed (not ESPN):
//   NHL  — api-web.nhle.com schedule: tvBroadcasts per game (network, market H/A/N, country)
//   NBA  — Sports Media Watch's NBA TV schedule (the NBA's own feed refuses apps): national and each team's local TV
//   WNBA — cdn.wnba.com league schedule: national, home and away TV broadcasters
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
      return SMW_NBA_URL;
    case 'wnba':
      return 'https://cdn.wnba.com/static/json/staticData/scheduleLeagueV2_1.json';
  }
}

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === 'object' ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const def = (v: unknown): string => str(obj(v).default) || str(v);
const STREAMING = /\+|prime|peacock|apple|netflix|paramount|max\b|stream|pass|app\b|dazn|youtube|victory|ott/i; // DAZN still matched to DAZN channels in the playlist

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

const CA_TEAMS = new Set(['VAN', 'CGY', 'EDM', 'TOR', 'MTL', 'OTT', 'WPG']);

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
        // A Canada-wide broadcast is the Canadian team's channel in a game against a US team; dropped for two US teams.
        let mk = str(b.market).toUpperCase();
        if (country === 'CA' && mk === 'N' && anyUs) {
          const homeCa = CA_TEAMS.has(str(obj(g.homeTeam).abbrev));
          const awayCa = CA_TEAMS.has(str(obj(g.awayTeam).abbrev));
          if (homeCa === awayCa) continue;
          mk = homeCa ? 'H' : 'A';
        }
        const name = code === 'SNP' ? (country === 'CA' ? 'Sportsnet Pacific' : 'SportsNet Pittsburgh') : NHL_NAMES[code.toUpperCase()] ?? code;
        add(broadcasts, name, mk === 'H' ? 'home' : mk === 'A' ? 'away' : 'national');
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
  if (typeof json === 'string') return parseSmwListings(json);
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

// ---------------------------------------------------------------------------
// NBA: Sports Media Watch's NBA TV schedule (sportsmediawatch.com/tv-schedules/nba-tv-schedule/) lists every game
// with its national TV and each team's local channels: "Detroit Pistons vs New York Knicks · NBC, Peacock; H: MSG,
// DAZN; TSN1/4". The first team is the away team; "A:" / "H:" are the away and home teams' local channels.

export const SMW_NBA_URL = 'https://www.sportsmediawatch.com/tv-schedules/nba-tv-schedule/';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Not channels in a playlist: streaming apps, League Pass, Spanish feeds. */
const SMW_SKIP = /^watch on:?$|league pass|peacock|\+$|\bapp\b|unlimited|premium|deportes|prime|youtube|clippervision|max\b|^tbd$|^n\/?a$/i;
const SMW_NAMES: Record<string, string> = {
  NBCSB: 'NBC Sports Boston', NBCSBA: 'NBC Sports Bay Area', NBCSCA: 'NBC Sports California', NBCSP: 'NBC Sports Philadelphia', SPECSN: 'Spectrum SportsNet',
  MNMT: 'Monumental Sports Network', MNMT2: 'Monumental Sports Network', ALT: 'Altitude', ALT2: 'Altitude', GCSEN: 'Gulf Coast Sports & Entertainment Network',
  SCHN: 'Space City Home Network', CHSN: 'Chicago Sports Network', MSG: 'MSG', MSGSN: 'MSG SportsNet', YES: 'YES Network', WPCH: 'Peachtree Sports Network',
  SN1: 'Sportsnet ONE', 'NBA TV': 'NBA TV', NBATV: 'NBA TV',
};

/** One TV item ("WOAI.2-CW", "WCGV-My24", "TSN1/4") as the names a playlist might use. */
function smwItems(item: string): string[] {
  const t = item.replace(/^watch on:?\s*/i, '').trim();
  if (!t || SMW_SKIP.test(t)) return [];
  const tsn = /^TSN\s*(\d(?:\s*\/\s*\d)*)$/i.exec(t);
  if (tsn) return tsn[1].split('/').map((n) => `TSN${n.trim()}`);
  const bare = t.replace(/\.\d+$/, '');
  if (SMW_NAMES[bare.toUpperCase()]) return [SMW_NAMES[bare.toUpperCase()]];
  if (/^RESN$/i.test(bare)) return ['RESN', 'Rock Entertainment Sports Network'];
  // "KARE-NBC", "WMYD-IND", "WOAI.2-CW": the station; "WCGV-My24", "WAXN-TV64": the station and its brand.
  const [station, brand] = t.split('-').map((x) => x.replace(/\.\d+$/, '').trim());
  const out = [station];
  if (brand && !/^(ind|nbc|cbs|abc|fox|cw|tv)$/i.test(brand) && !SMW_SKIP.test(brand)) out.push(brand.replace(/^tv(\d+)$/i, 'TV$1'));
  return out.filter((x) => x.length >= 2);
}

/** Text lines of an HTML page (block elements break lines). */
export function htmlLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(div|p|li|ul|ol|tr|td|th|table|tbody|thead|h[1-6]|br|section|article|header|footer)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;|&rsquo;/g, "'").replace(/&#8211;|&ndash;/g, '-').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Eastern time on that calendar day → epoch ms (DST: mid-March to early November). */
function easternMs(y: number, m: number, d: number, h: number, mi: number): number {
  const dst = (m > 2 && m < 10) || (m === 2 && d >= 8) || (m === 10 && d < 7);
  return Date.UTC(y, m, d, h + (dst ? 4 : 5), mi);
}

/** The schedule's game cards: exact start time, "City Nickname" teams, and channel pills marked A (away) / H (home). */
function parseSmwCards(html: string): TvListing[] {
  const strip = (x: string) => x.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;/g, "'").replace(/\s+/g, ' ').trim();
  const out: TvListing[] = [];
  const seen = new Set<string>();
  for (const c of html.split('smw-cards-daycard-item"').slice(1)) {
    const start = Date.parse(/data-timestamp="([^"]+)"/.exec(c)?.[1] ?? '');
    const team = (cls: string) => {
      const i = c.indexOf(cls);
      if (i < 0) return '';
      const seg = c.slice(i, c.indexOf('</div>', i));
      return [...seg.matchAll(/class="(?:smwcards-team-text|smw-cards-team-nick)"[^>]*>([^<]*)/g)].map((m) => strip(m[1])).join(' ').trim();
    };
    const away = team('smw-cards-team-away');
    const home = team('smw-cards-team-home');
    if (!Number.isFinite(start) || !away || !home) continue;
    const key = `${start}|${away}|${home}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const caGame = /toronto|raptors/i.test(`${away} ${home}`);
    const broadcasts: Broadcast[] = [];
    for (const m of c.matchAll(/<span[^>]*class="smw-cards-net-item[^"]*"[^>]*>([\s\S]*?)<\/span><\/span>/g)) {
      const raw = m[1];
      const market: Broadcast['market'] = /class="away-box"/.test(raw) ? 'away' : /class="home-box"/.test(raw) ? 'home' : 'national';
      const text = strip(raw.replace(/<span class="(?:away|home)-box">[AH]<\/span>/, ''));
      for (const n of smwItems(text)) {
        // Canada's channels (TSN, Sportsnet) only for a Raptors game.
        if (market === 'national' && !caGame && /^(tsn|sn\b|sn1|sn360|sportsnet)/i.test(n)) continue;
        add(broadcasts, n, market);
      }
    }
    out.push({ start, away: [away], home: [home], broadcasts });
  }
  return out;
}

export function parseSmwListings(html: string, now = Date.now()): TvListing[] {
  const cards = parseSmwCards(html);
  if (cards.length) return cards;
  const today = new Date(now - 5 * 3600_000);
  let y = today.getUTCFullYear(), m = today.getUTCMonth(), d = today.getUTCDate();
  let time: [number, number] | undefined;
  const byKey = new Map<string, TvListing & { tv: string }>();
  let cur: (TvListing & { tv: string }) | undefined;
  const finish = () => {
    if (!cur) return;
    const key = `${cur.start}|${cur.away[0]}|${cur.home[0]}`.toLowerCase();
    const prev = byKey.get(key);
    if (!prev || cur.tv.length > prev.tv.length) byKey.set(key, cur);
    cur = undefined;
  };
  for (const line of htmlLines(html)) {
    const date = /^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+([a-z]{3})[a-z]*\.?\s+(\d{1,2})\b/i.exec(line);
    if (date && MONTHS.includes(date[1].toLowerCase())) {
      finish();
      const mm = MONTHS.indexOf(date[1].toLowerCase());
      y = today.getUTCFullYear() + (mm < today.getUTCMonth() - 6 ? 1 : mm > today.getUTCMonth() + 6 ? -1 : 0);
      m = mm;
      d = Number(date[2]);
      time = undefined;
      continue;
    }
    if (/^today\b/i.test(line)) {
      finish();
      y = today.getUTCFullYear(); m = today.getUTCMonth(); d = today.getUTCDate();
      continue;
    }
    if (/^(time|game|tv|game \/ tv|matchup|network|load more|key dates|how to watch|\d+ games?)$/i.test(line)) {
      finish();
      continue;
    }
    let rest = line;
    const t = /^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?\b\s*(?:et\b)?\s*[|·-]?\s*/i.exec(rest);
    if (t) {
      finish();
      time = [(Number(t[1]) % 12) + (t[3].toLowerCase() === 'p' ? 12 : 0), Number(t[2])];
      rest = rest.slice(t[0].length);
      if (!rest) continue;
    }
    const mu = /^([A-Z][A-Za-z0-9.' ]{2,40}?)\s+(?:vs\.?|at|@)\s+([A-Z][A-Za-z0-9.' ]{2,40}?)(?:\s*[|·]\s*(.*))?$/.exec(rest);
    if (mu && time) {
      finish();
      cur = { start: easternMs(y, m, d, time[0], time[1]), away: [mu[1].trim()], home: [mu[2].trim()], broadcasts: [], tv: '' };
      rest = mu[3] ?? '';
      if (!rest) continue;
    }
    if (cur && rest) {
      // Pieces of one TV line can arrive on separate lines ("A:" then "NBCSP"); keep the segments apart.
      const sep = !cur.tv ? '' : /:\s*$/.test(cur.tv) ? ' ' : /^[AH]:/i.test(rest) ? '; ' : ', ';
      cur.tv += sep + rest;
    }
  }
  finish();
  const out: TvListing[] = [];
  for (const g of byKey.values()) {
    const broadcasts: Broadcast[] = [];
    for (const seg of g.tv.split(/;|,\s*(?=[AH]:)/)) {
      const s = seg.trim();
      const side = /^([AH]):\s*/i.exec(s);
      const market: Broadcast['market'] = side ? (side[1].toUpperCase() === 'H' ? 'home' : 'away') : 'national';
      for (const item of s.slice(side ? side[0].length : 0).split(',')) for (const n of smwItems(item)) add(broadcasts, n, market);
    }
    out.push({ start: g.start, home: g.home, away: g.away, broadcasts });
  }
  return out;
}
