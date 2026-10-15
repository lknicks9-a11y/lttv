// "My TV": DIRECTV's channel lineup for the New York / New Jersey market (DMA 501),
// from directv.com/channel-lineup (ZIP 07764, October 2026): local stations, all
// packages, add-ons, regional sports networks and the free MyFree DIRECTV channels.
// LTTV maps the user's own playlist channels onto these numbers; nothing is added.
import type { LineupChannel, MyTvPin } from './types';
import { DIRECTV_NY, DIRECTV_NY_LOCALS } from '../data/directv-ny';
import { matchKey, normalizeForMatch } from './normalize';
import { stripCountry } from './match';
import { detectCountry } from './countries';

export interface MyTvEntry {
  n: number;
  name: string;
  /** Other names the channel goes by in playlists. */
  aliases?: string[];
  /** Regexes tested against the raw channel name (used for local stations). */
  re?: RegExp[];
  /** West/Pacific feed (otherwise East feeds are preferred). */
  west?: boolean;
  /** Local station (allowed even when the name carries a city). */
  local?: boolean;
  /** MyFree DIRECTV (free streaming channel). */
  free?: boolean;
  /** DIRECTV add-on (not in the base packages). */
  addon?: boolean;
}

const L = (n: number, name: string, re: RegExp[], aliases: string[] = []): MyTvEntry => ({ n, name, re, aliases, local: true });
/** A network word that isn't part of a national brand ("CBS" but not "CBS Sports"/"CBS News"). */
const NET = (w: string) => `\\b${w}\\b(?!\\s*(?:sports|news|business|weather|deportes|life|soul|kids|cinema|movies|drama|comedy|reality|sp))`;
const CITY = '(?:\\bnew[\\s_.-]*york\\b|\\bnyc?\\b|\\bn\\.y\\.)';
/** Local affiliate patterns: call sign, "CBS 2 New York", "New York CBS", "CBS New York". */
const affiliate = (call: string, net: string, num: number): RegExp[] => [
  new RegExp(`\\b${call}\\b`, 'i'),
  new RegExp(`${NET(net)}\\s*${num}\\b.*${CITY}`, 'i'),
  new RegExp(`${CITY}.*${NET(net)}`, 'i'),
  new RegExp(`${NET(net)}\\s*(?:${num}\\s*)?${CITY}`, 'i'),
];

export const MYTV_TITLE = 'My TV';
export const MYTV_SUBTITLE = 'DIRECTV New York / New Jersey channel numbers';

/**
 * Hand-made entries with the other names channels go by in playlists ("FS1" for
 * FOX Sports 1, "MSNBC" for MS NOW…). Used for aliases and the local-station patterns;
 * the lineup itself (which channels, which numbers) comes from DIRECTV's channel-lineup
 * page (src/data/directv-ny.ts).
 */
const KNOWN: MyTvEntry[] = [
  // ---- New York locals (DIRECTV carries them on their virtual channel numbers)
  L(2, 'CBS 2 New York (WCBS)', affiliate('wcbs', 'cbs', 2)),
  L(4, 'NBC 4 New York (WNBC)', affiliate('wnbc', 'nbc', 4)),
  L(5, 'FOX 5 New York (WNYW)', affiliate('wnyw', 'fox', 5)),
  L(7, 'ABC 7 New York (WABC)', affiliate('wabc', 'abc', 7)),
  L(9, 'My9 (WWOR)', [/\bwwor\b/i, /\bmy\s*9\b/i, /\bmy\s*network\b.*\b(new york|ny|nyc)\b/i]),
  L(11, 'PIX11 (WPIX)', [/\bwpix\b/i, /\bpix\s*11\b/i, /\bcw\b.*\b(new york|ny|nyc)\b/i, /\b(new york|ny|nyc)\b.*\bcw\b/i]),
  L(13, 'THIRTEEN PBS (WNET)', [/\bwnet\b/i, /\bthirteen\b/i, /\bpbs\s*13\b/i, /\bpbs\b.*\b(new york|nyc)\b/i]),
  L(21, 'WLIW 21 PBS', [/\bwliw\b/i]),
  L(25, 'NYC Life (WNYE)', [/\bwnye\b/i, /\bnyc\s*(life|media)\b/i]),
  L(31, 'ION New York (WPXN)', [/\bwpxn\b/i, /\bion\b.*\b(new york|ny|nyc)\b/i]),
  L(33, 'MeTV New York (WJLP)', [/\bwjlp\b/i]),
  L(41, 'Univision 41 New York (WXTV)', [/\bwxtv\b/i, /\bunivision\s*41\b/i, /\bunivision\b.*\b(new york|ny|nyc)\b/i]),
  L(47, 'Telemundo 47 New York (WNJU)', [/\bwnju\b/i, /\btelemundo\s*47\b/i, /\btelemundo\b.*\b(new york|ny|nyc)\b/i]),
  L(48, 'WRNN 48', [/\bwrnn\b/i]),
  L(50, 'NJ PBS (WNJN)', [/\bwnjn\b/i, /\bnj\s*pbs\b/i, /\bnjtv\b/i]),
  L(55, 'WLNY 55', [/\bwlny\b/i]),
  L(63, 'WMBC 63', [/\bwmbc\b/i]),
  L(67, 'WFTY 67', [/\bwfty\b/i]),
  L(68, 'UniMás 68 New York (WFUT)', [/\bwfut\b/i, /\bunim[aá]s\s*68\b/i]),

  // ---- News & information
  { n: 202, name: 'CNN', aliases: ['CNN USA', 'CNN US'] },
  { n: 204, name: 'HLN', aliases: ['Headline News', 'CNN Headline News'] },
  { n: 307, name: 'NewsNation', aliases: ['WGN America'] },
  { n: 346, name: 'BBC News', aliases: ['BBC World News'] },
  { n: 349, name: 'Newsmax', aliases: ['Newsmax TV'] },
  { n: 350, name: 'C-SPAN', aliases: ['CSPAN', 'C SPAN 1', 'CSPAN 1'] },
  { n: 351, name: 'C-SPAN2', aliases: ['CSPAN2', 'C SPAN 2'] },
  { n: 353, name: 'Bloomberg TV', aliases: ['Bloomberg', 'Bloomberg Television'] },
  { n: 354, name: 'Cheddar News', aliases: ['Cheddar'] },
  { n: 355, name: 'CNBC' },
  { n: 356, name: 'MS NOW', aliases: ['MSNBC', 'MS Now'] },
  { n: 357, name: 'CNBC World' },
  { n: 358, name: 'CNN International', aliases: ['CNNI'] },
  { n: 359, name: 'FOX Business', aliases: ['Fox Business Network', 'FBN'] },
  { n: 360, name: 'FOX News', aliases: ['Fox News Channel', 'FNC'] },
  { n: 361, name: 'AccuWeather', aliases: ['AccuWeather Network'] },
  { n: 362, name: 'The Weather Channel', aliases: ['Weather Channel', 'TWC'] },
  { n: 363, name: 'FOX Weather' },
  { n: 343, name: 'i24 News', aliases: ['i24NEWS'] },
  { n: 348, name: 'Free Speech TV' },

  // ---- Sports
  { n: 206, name: 'ESPN' },
  { n: 207, name: 'ESPNEWS', aliases: ['ESPN News'] },
  { n: 208, name: 'ESPNU', aliases: ['ESPN U'] },
  { n: 209, name: 'ESPN2', aliases: ['ESPN 2'] },
  { n: 211, name: 'NFL RedZone', aliases: ['RedZone', 'NFL Red Zone'] },
  { n: 212, name: 'NFL Network', aliases: ['NFL Net', 'NFLN'] },
  { n: 213, name: 'MLB Network', aliases: ['MLB Net', 'MLBN'] },
  { n: 214, name: 'RACER Network', aliases: ['Racer'] },
  { n: 215, name: 'NHL Network', aliases: ['NHL Net'] },
  { n: 216, name: 'NBA TV', aliases: ['NBATV'] },
  { n: 217, name: 'Tennis Channel', aliases: ['Tennis'] },
  { n: 218, name: 'GOLF Channel', aliases: ['Golf'] },
  { n: 219, name: 'FS1', aliases: ['Fox Sports 1', 'FOX Sports 1'] },
  { n: 221, name: 'CBS Sports Network', aliases: ['CBSSN', 'CBS Sports Net'] },
  { n: 602, name: 'FanDuel TV', aliases: ['TVG', 'FanDuel TV HD'] },
  { n: 603, name: 'Cowboy Channel', aliases: ['The Cowboy Channel'] },
  { n: 604, name: 'Pursuit', aliases: ['Pursuit Channel'] },
  { n: 605, name: 'Sportsman Channel', aliases: ['Sportsman'] },
  { n: 606, name: 'Outdoor Channel', aliases: ['Outdoor'] },
  { n: 610, name: 'Big Ten Network', aliases: ['BTN', 'B1G Network', 'Big 10 Network'] },
  { n: 611, name: 'SEC Network', aliases: ['SECN'] },
  { n: 612, name: 'ACC Network', aliases: ['ACCN'] },
  { n: 618, name: 'FS2', aliases: ['Fox Sports 2', 'FOX Sports 2'] },
  { n: 623, name: 'Next Level Sports' },
  { n: 625, name: 'Willow', aliases: ['Willow Cricket', 'Willow HD'] },
  { n: 626, name: 'Willow 2', aliases: ['Willow Xtra', 'Willow Extra'] },
  { n: 628, name: 'NESN', aliases: ['New England Sports Network'] },
  { n: 630, name: 'NBC Sports Boston', aliases: ['NBCS Boston', 'NBC Boston Sports'] },
  { n: 631, name: 'YES Network', aliases: ['YES', 'Yankees Entertainment and Sports'] },
  { n: 634, name: 'MSG', aliases: ['MSG Network', 'Madison Square Garden'] },
  { n: 635, name: 'MSG SportsNet', aliases: ['MSG Sportsnet', 'MSGSN', 'MSG Plus', 'MSG+', 'MSG 2', 'MSG2'] },
  { n: 639, name: 'SNY', aliases: ['SportsNet New York', 'SNY Mets'] },
  { n: 464, name: 'TUDN' },
  { n: 719, name: 'MLB Strike Zone', aliases: ['MLB Strikezone', 'Strike Zone'] },

  // ---- Entertainment
  { n: 223, name: 'Celebrity Shopping' },
  { n: 226, name: 'Shop LC' },
  { n: 228, name: 'GEM Shopping Network' },
  { n: 229, name: 'HGTV', aliases: ['Home and Garden', 'Home & Garden TV'] },
  { n: 230, name: 'Magnolia Network', aliases: ['Magnolia', 'DIY Network', 'DIY'] },
  { n: 231, name: 'Food Network', aliases: ['Food'] },
  { n: 232, name: 'Cooking Channel', aliases: ['Cooking'] },
  { n: 233, name: 'Game Show Network', aliases: ['GSN', 'Game Show'] },
  { n: 235, name: 'Tastemade' },
  { n: 236, name: 'E!', aliases: ['E! Entertainment', 'E Entertainment', 'E! Entertainment Television'] },
  { n: 237, name: 'Bravo' },
  { n: 238, name: 'REELZ', aliases: ['Reelz Channel'] },
  { n: 239, name: 'SundanceTV', aliases: ['Sundance', 'Sundance TV'] },
  { n: 240, name: 'HSN', aliases: ['Home Shopping Network'] },
  { n: 241, name: 'Paramount Network', aliases: ['Paramount', 'Spike'] },
  { n: 242, name: 'USA Network', aliases: ['USA'] },
  { n: 244, name: 'Syfy', aliases: ['Sci Fi', 'SyFy Channel'] },
  { n: 245, name: 'TNT' },
  { n: 246, name: 'truTV', aliases: ['Tru TV'] },
  { n: 247, name: 'TBS' },
  { n: 248, name: 'FX' },
  { n: 249, name: 'Comedy Central', aliases: ['Comedy'] },
  { n: 251, name: 'Oxygen True Crime', aliases: ['Oxygen'] },
  { n: 252, name: 'Lifetime' },
  { n: 253, name: 'LMN', aliases: ['Lifetime Movie Network', 'Lifetime Movies'] },
  { n: 254, name: 'AMC' },
  { n: 256, name: 'TCM', aliases: ['Turner Classic Movies'] },
  { n: 258, name: 'FX Movie Channel', aliases: ['FXM', 'FX Movies'] },
  { n: 259, name: 'FXX' },
  { n: 260, name: 'WE tv', aliases: ['WEtv', 'WE'] },
  { n: 261, name: 'Discovery Life' },
  { n: 264, name: 'BBC America', aliases: ['BBCA'] },
  { n: 265, name: 'A&E', aliases: ['AandE', 'A and E', 'Arts and Entertainment'] },
  { n: 266, name: 'FYI', aliases: ['fyi,'] },
  { n: 267, name: 'EarthX' },
  { n: 269, name: 'History', aliases: ['History Channel', 'The History Channel', 'HISTORY Channel, The'] },
  { n: 271, name: 'VICE', aliases: ['Viceland', 'Vice TV'] },
  { n: 272, name: 'Logo', aliases: ['Logo TV'] },
  { n: 273, name: 'Pop TV', aliases: ['Pop'] },
  { n: 274, name: 'Ovation' },
  { n: 276, name: 'National Geographic', aliases: ['Nat Geo', 'NatGeo', 'National Geographic Channel'] },
  { n: 277, name: 'Travel Channel', aliases: ['Travel'] },
  { n: 278, name: 'Discovery', aliases: ['Discovery Channel'] },
  { n: 279, name: 'OWN', aliases: ['Oprah Winfrey Network'] },
  { n: 280, name: 'TLC', aliases: ['The Learning Channel'] },
  { n: 281, name: 'Discovery Turbo', aliases: ['Turbo'] },
  { n: 282, name: 'Animal Planet' },
  { n: 283, name: 'Nat Geo WILD', aliases: ['National Geographic Wild', 'NatGeo Wild'] },
  { n: 284, name: 'Science', aliases: ['Science Channel'] },
  { n: 285, name: 'Investigation Discovery', aliases: ['ID', 'ID Investigation Discovery'] },
  { n: 286, name: 'Destination America' },
  { n: 287, name: 'American Heroes Channel', aliases: ['AHC'] },
  { n: 304, name: 'TV Land', aliases: ['TVLand'] },
  { n: 305, name: 'ION Television', aliases: ['ION', 'ION TV'] },
  { n: 310, name: 'HSN2' },
  { n: 311, name: 'Freeform', aliases: ['ABC Family'] },
  { n: 312, name: 'Hallmark Channel', aliases: ['Hallmark'] },
  { n: 313, name: 'Jewelry TV', aliases: ['JTV'] },
  { n: 314, name: 'Family Movie Classics', aliases: ['FMC'] },
  { n: 315, name: 'QVC2' },
  { n: 317, name: 'QVC' },
  { n: 318, name: 'QVC3' },
  { n: 322, name: 'NHK World', aliases: ['NHK', 'NHK World Japan'] },
  { n: 323, name: 'FETV', aliases: ['Family Entertainment TV'] },
  { n: 326, name: 'Great American Family', aliases: ['GAF', 'Great American Country', 'GAC Family'] },
  { n: 327, name: 'CMT', aliases: ['Country Music Television'] },
  { n: 328, name: 'TV One', aliases: ['TVOne'] },
  { n: 329, name: 'BET', aliases: ['Black Entertainment Television'] },
  { n: 330, name: 'BET Her', aliases: ['BETHer', 'Centric'] },
  { n: 331, name: 'MTV', aliases: ['MTV Music Television'] },
  { n: 332, name: 'MTV2', aliases: ['MTV 2'] },
  { n: 333, name: 'IFC' },
  { n: 334, name: 'Revolt', aliases: ['Revolt TV'] },
  { n: 335, name: 'VH1' },
  { n: 336, name: 'MTV Classic' },
  { n: 338, name: 'UPtv', aliases: ['UP TV', 'UP'] },
  { n: 339, name: 'Fuse', aliases: ['Fuse TV'] },
  { n: 340, name: 'AXS TV', aliases: ['AXS'] },
  { n: 341, name: 'Cleo TV', aliases: ['Cleo'] },
  { n: 342, name: 'TheGrio', aliases: ['The Grio', 'TheGrio TV'] },
  { n: 345, name: 'RFD-TV', aliases: ['RFD TV', 'RFDTV'] },
  { n: 364, name: 'INSP' },
  { n: 365, name: 'GOD TV' },
  { n: 366, name: 'Victory' },
  { n: 369, name: 'Daystar' },
  { n: 370, name: 'EWTN' },
  { n: 372, name: 'TBN', aliases: ['Trinity Broadcasting Network'] },
  { n: 373, name: 'The Word Network', aliases: ['Word Network'] },
  { n: 374, name: 'BYUtv', aliases: ['BYU TV'] },
  { n: 380, name: 'IMPACT', aliases: ['Impact Network'] },
  { n: 385, name: 'Heroes & Icons', aliases: ['H&I', 'Heroes and Icons'] },
  { n: 386, name: 'FM2' },

  // ---- Kids & family
  { n: 288, name: 'PBS Kids' },
  { n: 289, name: 'Disney Junior', aliases: ['Disney Jr'] },
  { n: 290, name: 'Disney Channel', aliases: ['Disney'] },
  { n: 291, name: 'Disney Channel West', aliases: ['Disney West'], west: true },
  { n: 292, name: 'Disney XD' },
  { n: 293, name: 'BabyFirst TV', aliases: ['BabyFirst', 'Baby First'] },
  { n: 294, name: 'Discovery Family', aliases: ['Discovery Family Channel'] },
  { n: 295, name: 'MeTV Toons' },
  { n: 296, name: 'Cartoon Network', aliases: ['Cartoon Network East', 'CN'] },
  { n: 297, name: 'Cartoon Network West', west: true },
  { n: 298, name: 'Boomerang' },
  { n: 299, name: 'Nickelodeon', aliases: ['Nick', 'Nickelodeon East', 'Nick at Nite', 'Nickelodeon Nick at Nite'] },
  { n: 300, name: 'Nickelodeon West', aliases: ['Nick West'], west: true },
  { n: 301, name: 'Nick Jr.', aliases: ['Nick Jr', 'Nick Junior'] },
  { n: 302, name: 'Nicktoons', aliases: ['Nick Toons'] },
  { n: 303, name: 'TeenNick', aliases: ['Teen Nick'] },
  { n: 308, name: 'LooLoo Kids' },

  // ---- Free broadcast networks DIRECTV carries nationally
  { n: 77, name: 'MeTV', aliases: ['Me TV'] },
  { n: 80, name: 'Cozi TV', aliases: ['Cozi'] },
  { n: 81, name: 'GRIT', aliases: ['Grit TV'] },
  { n: 82, name: 'Bounce TV', aliases: ['Bounce'] },
  { n: 83, name: 'GREAT', aliases: ['Great TV'] },
  { n: 84, name: 'Start TV' },
  { n: 85, name: 'True CRMZ' },
  { n: 86, name: 'MovieSphere Gold' },
  { n: 88, name: 'ION Mystery', aliases: ['Court TV Mystery'] },

  // ---- Premium movies
  { n: 501, name: 'HBO', aliases: ['HBO East'] },
  { n: 502, name: 'HBO Hits', aliases: ['HBO 2', 'HBO2'] },
  { n: 503, name: 'HBO Drama', aliases: ['HBO Signature'] },
  { n: 504, name: 'HBO West', west: true },
  { n: 505, name: 'HBO Hits West', aliases: ['HBO 2 West', 'HBO2 West'], west: true },
  { n: 506, name: 'HBO Comedy' },
  { n: 509, name: 'HBO Movies', aliases: ['HBO Zone'] },
  { n: 511, name: 'HBO Latino' },
  { n: 515, name: 'Cinemax', aliases: ['Cinemax East'] },
  { n: 516, name: 'Cinemax West', west: true },
  { n: 517, name: 'Cinemax Hits', aliases: ['MoreMax', 'More Max'] },
  { n: 519, name: 'Cinemax Action', aliases: ['ActionMax', 'Action Max'] },
  { n: 520, name: 'Cinemax Classics', aliases: ['ThrillerMax', 'MovieMax'] },
  { n: 525, name: 'STARZ', aliases: ['Starz East'] },
  { n: 526, name: 'STARZ West', west: true },
  { n: 527, name: 'STARZ Kids & Family', aliases: ['Starz Kids and Family', 'Starz Kids'] },
  { n: 528, name: 'STARZ Comedy' },
  { n: 529, name: 'STARZ Edge' },
  { n: 530, name: 'STARZ in Black', aliases: ['Starz InBlack'] },
  { n: 531, name: 'STARZ Cinema' },
  { n: 535, name: 'STARZ ENCORE', aliases: ['Encore', 'Starz Encore East'] },
  { n: 536, name: 'STARZ ENCORE West', aliases: ['Encore West'], west: true },
  { n: 537, name: 'STARZ ENCORE Classic', aliases: ['Encore Classic'] },
  { n: 538, name: 'STARZ ENCORE Westerns', aliases: ['Encore Westerns'] },
  { n: 539, name: 'STARZ ENCORE Suspense', aliases: ['Encore Suspense'] },
  { n: 540, name: 'STARZ ENCORE Black', aliases: ['Encore Black'] },
  { n: 541, name: 'STARZ ENCORE Action', aliases: ['Encore Action'] },
  { n: 542, name: 'STARZ ENCORE Family', aliases: ['Encore Family'] },
  { n: 545, name: 'Paramount+ with SHOWTIME', aliases: ['Showtime', 'SHOWTIME East', 'Paramount Plus with Showtime'] },
  { n: 546, name: 'Paramount+ with SHOWTIME West', aliases: ['Showtime West'], west: true },
  { n: 547, name: 'SHOWTIME 2', aliases: ['Showtime2'] },
  { n: 548, name: 'SHOxBET', aliases: ['Sho x BET', 'Showtime BET'] },
  { n: 549, name: 'SHOWTIME EXTREME', aliases: ['Showtime Extreme'] },
  { n: 550, name: 'SHOWTIME SHOWCASE', aliases: ['Showtime Showcase'] },
  { n: 551, name: 'SHOWTIME NEXT', aliases: ['Showtime Next'] },
  { n: 553, name: 'The Movie Channel', aliases: ['TMC', 'The Movie Channel East'] },
  { n: 554, name: 'The Movie Channel West', aliases: ['TMC West'], west: true },
  { n: 555, name: 'The Movie Channel Xtra', aliases: ['TMC Xtra', 'Movie Channel Xtra'] },
  { n: 556, name: 'FLIX' },
  { n: 561, name: 'Lionsgate Collection' },
  { n: 565, name: 'Hallmark Mystery', aliases: ['Hallmark Movies & Mysteries', 'Hallmark Movies and Mysteries', 'HMM'] },
  { n: 566, name: 'HDNet Movies', aliases: ['HDNet'] },
  { n: 567, name: 'Tribeca Festival+' },
  { n: 570, name: 'Smithsonian Channel', aliases: ['Smithsonian'] },
  { n: 573, name: 'ShortsTV', aliases: ['Shorts TV'] },

  // ---- Spanish
  { n: 401, name: 'Aquí', aliases: ['Aqui'] },
  { n: 402, name: 'Univision', aliases: ['Univision East', 'Univision Este'] },
  { n: 403, name: 'Univision West', aliases: ['Univision Oeste'], west: true },
  { n: 404, name: 'Galavisión', aliases: ['Galavision'] },
  { n: 408, name: 'UniMás', aliases: ['UniMas', 'Unimas'] },
  { n: 410, name: 'UNIVERSO', aliases: ['Universo'] },
  { n: 419, name: 'CNN en Español', aliases: ['CNN Espanol', 'CNN en Espanol'] },
  { n: 461, name: 'HITN' },
];

const knownByNumber = new Map(KNOWN.map((e) => [e.n, e]));

/** "Nickelodeon East HD" -> "Nickelodeon", "HBO Hits HD East" -> "HBO Hits". */
function tidyDtvName(name: string): string {
  return name
    .replace(/\s+HD\s+East$|\s+East\s+HD$|\s+HD$|\s+East$/i, '')
    .replace(/\s+HD(?=\s)/i, '')
    .trim();
}

function buildLineup(): MyTvEntry[] {
  const out: MyTvEntry[] = [];
  // Local stations on their channel numbers (patterns recognise playlist names for them).
  for (const line of DIRECTV_NY_LOCALS.split('\n')) {
    const [num, call, network] = line.split('|');
    const n = Number(num);
    const known = knownByNumber.get(n);
    if (known) out.push({ ...known, name: known.name });
    else if (n === 4051) out.push(L(n, 'ABC7 New York 24/7', [/\babc\s*7\b.*\b(24\s*\/?\s*7|news live|streaming)\b/i, /\bwabc\s*fast\b/i]));
    else out.push(L(n, `${network} (${call})`, [new RegExp(`\\b${call}\\b`, 'i')]));
  }
  for (const line of DIRECTV_NY.split('\n')) {
    const [num, rawName, flags] = line.split('|');
    const n = Number(num);
    const tidy = tidyDtvName(rawName);
    const name = out.some((e) => e.name === tidy) ? rawName.replace(/^Cinemx/, 'Cinemax') : tidy;
    const known = knownByNumber.get(n);
    const aliases = new Set<string>([...(known?.aliases ?? []), ...(known && known.name !== name ? [known.name] : []), ...(rawName !== name ? [rawName] : [])]);
    out.push({ n, name, aliases: [...aliases], west: /\bwest\b/i.test(rawName) && !/unim/i.test(rawName), free: flags.includes('F'), addon: flags.includes('A') });
  }
  return out;
}

export const MYTV_LINEUP: MyTvEntry[] = buildLineup();

// ---------------------------------------------------------------------------

const QUALITY_RANK: [RegExp, number][] = [
  [/\b(8k)\b/i, 5], [/\b(4k|uhd|2160p?)\b|ᵁᴴᴰ|⁴ᴷ/i, 4], [/\b(fhd|1080p?)\b|ᶠᴴᴰ/i, 3], [/\b(hd|720p?)\b|ᴴᴰ/i, 2], [/\bsd\b|ˢᴰ/i, 0],
];

/** Higher is better: 4K > FHD > HD > unmarked > SD; backups and timeshifts rank last. */
export function qualityRank(name: string): number {
  let q = 1;
  for (const [re, v] of QUALITY_RANK) if (re.test(name)) {
    q = v;
    break;
  }
  if (/\b(backup|alt|test|low|mobile)\b/i.test(name)) q -= 2;
  return q;
}

/** "AMC East HD" -> "amc"; regional words removed so they can be checked separately. */
function baseKey(name: string): string {
  return normalizeForMatch(name).split(' ').filter((t) => t !== 'east' && t !== 'the').join('');
}

let keyIndex: Map<string, MyTvEntry> | null = null;
function index(): Map<string, MyTvEntry> {
  if (keyIndex) return keyIndex;
  keyIndex = new Map();
  for (const e of MYTV_LINEUP) {
    if (e.local) continue;
    for (const n of [e.name, ...(e.aliases ?? [])]) {
      const k = baseKey(n);
      if (k && !keyIndex.has(k)) keyIndex.set(k, e);
    }
  }
  return keyIndex;
}

const WEST = /\b(west|pacific|oeste)\b/i;
const OFFSET = /\+\s?\d|\b(plus\s?1|timeshift)\b/i;
/** Names that look like a local channel from another city ("CBS Boston", "FOX 29 Philadelphia"). */
const OTHER_CITY = /\b(boston|philadelphia|philly|chicago|los angeles|la|dallas|houston|atlanta|miami|detroit|denver|seattle|phoenix|washington|dc|baltimore|cleveland|pittsburgh|tampa|orlando|minneapolis|st\.? louis|san francisco|sf|bay area|sacramento|portland|las vegas|kansas city|charlotte|nashville|new orleans|buffalo|albany|hartford|providence|syracuse|rochester)\b/i;

/** Which My TV entry a playlist channel is, if any. */
/** Names that could be a New York local station (cheap test before the per-station patterns). */
const MAYBE_LOCAL = /new[\s_.-]*york|\bn\.y\.|\bnyc?\b|\bw[a-z]{3}\b|\bmy\s*9|\bpix|thirteen|\bnj|njtv|univision\s*41|telemundo\s*47|unim[aá]s\s*68|nyc\s*(life|media)/i;

/** New York's network stations: DIRECTV slot -> call sign. */
const NY_STATION: Record<string, { n: number; call: string }> = { cbs: { n: 2, call: 'wcbs' }, nbc: { n: 4, call: 'wnbc' }, fox: { n: 5, call: 'wnyw' }, abc: { n: 7, call: 'wabc' } };
const NY_WORD = /\bnew[\s_.-]*york\b|\bnyc?\b|\bn\.y\./i;
/** Every New York-market call sign (so they aren't mistaken for another city's station). */
const NY_CALLS = new Set(['wcbs', 'wnbc', 'wnyw', 'wabc', 'wwor', 'wpix', 'wnet', 'wliw', 'wnye', 'wpxn', 'wjlp', 'wxtv', 'wnju', 'wrnn', 'wnjn', 'wlny', 'wmbc', 'wfty', 'wfut', 'wedw']);
const NOT_CALLS = new Set(['west', 'wild', 'wolf', 'word', 'work', 'wars', 'wave', 'wife', 'wine', 'wing', 'wiki', 'wise', 'wide', 'wish', 'with', 'weed', 'week', 'well', 'wear', 'kids', 'kick', 'king', 'kiss', 'kite', 'kong', 'keep', 'kino', 'kiwi']);

/** Another market's call sign ("KNBC", "WMAQ-DT", "kabc.us") in a name or guide id. */
function otherCallSign(text: string, caseSensitive: boolean): boolean {
  const re = caseSensitive ? /\b([KW][A-Z]{3})(?:-?(?:TV|DT|HD|CD|LD))?\b/g : /(?:^|[^a-z0-9])([kw][a-z]{3})(?:-?(?:tv|dt|hd|cd|ld))?(?=$|[^a-z0-9])/gi;
  for (const m of text.matchAll(re)) {
    const c = m[1].toLowerCase();
    if (!NY_CALLS.has(c) && !NOT_CALLS.has(c)) return true;
  }
  return false;
}

/** What identifies a channel besides its name: its tvg-id and the guide channel it's matched to. */
export interface StationIdentity {
  tvgId?: string;
  /** Matched guide channel ("source|id") and that guide channel's display names. */
  epgRef?: string;
  epgNames?: string[];
}

/**
 * A plain network channel ("US: NBC", "FOX HD", "ABC East") is only put on the New
 * York station's slot when its tvg-id or guide channel shows it really is that station
 * (WNBC, "NBC 4 New York"…) — providers' unlabeled network feeds are often another
 * city's station, with that city's news and programmes.
 */
export function nyStationSlot(raw: string, id: StationIdentity): number | undefined {
  const m = new RegExp(`${NET('(cbs|nbc|fox|abc)')}`, 'i').exec(raw);
  if (!m) return undefined;
  const st = NY_STATION[m[1].toLowerCase()];
  if (OTHER_CITY.test(raw) || otherCallSign(raw, true)) return undefined;
  const text = [id.tvgId, id.epgRef?.slice(id.epgRef.indexOf('|') + 1), ...(id.epgNames ?? [])].filter(Boolean).join(' · ');
  if (!text) return undefined;
  if (new RegExp(`(^|[^a-z])${st.call}([^a-z]|$)`, 'i').test(text)) return st.n;
  if (otherCallSign(text, false) || OTHER_CITY.test(text.replace(/[._]/g, ' '))) return undefined;
  return NY_WORD.test(text.replace(/[._]/g, ' ')) ? st.n : undefined;
}

export function myTvEntryFor(ch: Pick<LineupChannel, 'originalName' | 'cleanedName' | 'group'> & { country?: string } & StationIdentity): MyTvEntry | undefined {
  const raw = ch.originalName;
  const country = 'country' in ch ? ch.country : detectCountry(raw, ch.group);
  if (country && country !== 'us') return undefined;
  if (OFFSET.test(raw)) return undefined;
  if (MAYBE_LOCAL.test(raw) && !(OTHER_CITY.test(raw) && !NY_WORD.test(raw))) for (const e of MYTV_LINEUP) if (e.local && e.re!.some((re) => re.test(raw))) return e;
  // "US: NBC" with a tvg-id / guide channel of WNBC -> NBC 4. Unlabeled network feeds stay out.
  const slot = nyStationSlot(raw, ch);
  if (slot !== undefined) return MYTV_LINEUP.find((x) => x.n === slot && x.local);
  const isWest = WEST.test(raw);
  const name = ch.cleanedName || raw;
  const stripped = stripCountry(name);
  let k = '';
  let e: MyTvEntry | undefined;
  // "USA Network" must stay USA Network; "USA ESPN" is ESPN.
  for (const cand of stripped ? [name, stripped] : [name]) {
    k = baseKey(cand).replace(/(west|pacific|oeste)/g, '');
    e = index().get(k);
    if (e) break;
  }
  if (!e) return undefined;
  // e.g. "NBC Sports Philadelphia" or "CBS Boston" isn't the New York channel.
  if (OTHER_CITY.test(raw) && !OTHER_CITY.test([e.name, ...(e.aliases ?? [])].join(' '))) return undefined;
  if (isWest && !e.west) {
    // "HBO West" -> look for the west entry instead.
    return MYTV_LINEUP.find((x) => x.west && baseKey(x.name).replace(/(west|pacific|oeste)/g, '') === k) ?? undefined;
  }
  return e;
}

export { countryOfGroup } from './countries';

/** Country of a channel: name prefix ("US:", "USA ESPN", "|PK|"), then its group ("UK Sports", "Pakistan"). */
export function channelCountry(ch: Pick<LineupChannel, 'originalName' | 'group'>): string | undefined {
  return detectCountry(ch.originalName, ch.group);
}

/**
 * Assign My TV numbers: for each lineup entry the best playlist channel (highest
 * quality, then one with guide data, then playlist order). Returns key -> number.
 */
export function assignMyTv(lineup: LineupChannel[], epgNames?: (ref: string) => string[] | undefined, pins: MyTvPin[] = []): Map<string, number> {
  const best = new Map<number, { key: string; score: number; index: number }>();
  for (const ch of lineup) {
    const matched = ch.epgChannelId && (ch.matchStatus === 'auto' || ch.matchStatus === 'approved') ? ch.epgChannelId : undefined;
    const e = myTvEntryFor({ ...ch, epgRef: matched, epgNames: matched ? epgNames?.(matched) : undefined });
    if (!e) continue;
    const guide = matched ? 1 : 0;
    // A channel whose own name says it's the New York station beats one placed there by its guide id.
    const nyNamed = e.local && MAYBE_LOCAL.test(ch.originalName) ? 100 : 0;
    const score = nyNamed + qualityRank(ch.originalName) * 10 + guide * 5 + (channelCountry(ch) === 'us' ? 1 : 0);
    const cur = best.get(e.n);
    if (!cur || score > cur.score || (score === cur.score && ch.index < cur.index)) best.set(e.n, { key: ch.key, score, index: ch.index });
  }
  const out = new Map<string, number>();
  for (const [n, b] of best) out.set(b.key, n);
  // Streams you chose win their number (and leave any number they had before).
  for (const pin of pins) {
    const ch = pinnedChannel(lineup, pin);
    if (!ch) continue;
    for (const [k, n] of out) if (n === pin.n) out.delete(k);
    out.set(ch.key, pin.n);
  }
  return out;
}

/**
 * A name reduced to what identifies the channel across providers: lower case,
 * superscripts folded ("ᶜᶦᵗʸ" -> "city"), quality / format words and short provider
 * prefixes ("A3", "US:") dropped.
 */
export function portableName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u026a]/g, 'i')
    .replace(/^\s*(?:[a-z]\d|\d[a-z]|[a-z]{2,3})\s*[:|\-–]\s*/, '')
    .replace(/^\s*[a-z]\d\s+/, '')
    .replace(/\b(4k|uhd|fhd|hd|sd|hevc|h\.?265|raw|backup|1080p?|720p?|50fps|60fps)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** How well a playlist channel fits a My TV pin (0 = not it). */
export function pinScore(ch: Pick<LineupChannel, 'originalName' | 'url'> & { number?: number; playlistNumber?: number }, pin: MyTvPin): number {
  const name = ch.originalName;
  let score = 0;
  if (name.trim().toLowerCase() === pin.name.trim().toLowerCase()) score += 60;
  else if (portableName(name) === portableName(pin.name)) score += 40;
  const callHit = !!pin.call && new RegExp(`\\b${pin.call}\\b`, 'i').test(name);
  if (callHit) score += 20;
  if (!score) return 0;
  if (pin.streamId) {
    const id = /\/(\d+)(?:\.[a-z0-9]+)?(?:[?#].*)?$/i.exec(ch.url)?.[1];
    if (id === pin.streamId || String(ch.playlistNumber ?? ch.number ?? '') === pin.streamId) score += 30;
  }
  // Another provider's copy of the station: prefer the same kind of feed (RAW, city feed…).
  if (callHit && /\braw\b/i.test(pin.name) && /\braw\b/i.test(name)) score += 5;
  if (callHit && /ᶜᶦᵗʸ|\bcity\b/i.test(pin.name) && /ᶜᶦᵗʸ|\bcity\b/i.test(name)) score += 3;
  if (callHit && !/\+\s?\d|\bwest\b/i.test(name)) score += 1;
  return score;
}

/** The playlist channel a pin points at: the best fit, if any fits. */
export function pinnedChannel(lineup: LineupChannel[], pin: MyTvPin): LineupChannel | undefined {
  let best: LineupChannel | undefined;
  let top = 0;
  for (const ch of lineup) {
    if (ch.hidden) continue;
    const sc = pinScore(ch, pin);
    if (sc > top || (sc === top && sc > 0 && best && qualityRank(ch.originalName) > qualityRank(best.originalName))) {
      top = sc;
      best = ch;
    }
  }
  return top >= 20 ? best : undefined;
}

/** Call sign of a My TV New York local station ("WNBC" for 4), if it has one. */
export function nyCallSign(n: number): string | undefined {
  const e = MYTV_LINEUP.find((x) => x.n === n && x.local);
  return e ? /\b(W[A-Z]{3})\b/.exec(e.name)?.[1] : undefined;
}

/** Does this guide channel (id + names) belong to that New York station? */
export function guideIsStation(call: string, ref: string, names: string[] | undefined): boolean {
  const text = `${ref.slice(ref.indexOf('|') + 1)} ${(names ?? []).join(' ')}`;
  return new RegExp(`(^|[^a-z])${call}([^a-z]|$)`, 'i').test(text);
}

export function myTvName(n: number): string | undefined {
  return MYTV_LINEUP.find((e) => e.n === n)?.name;
}

export { matchKey };
