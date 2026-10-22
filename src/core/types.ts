// Shared data model used by the desktop app, the Fire TV app (same UI bundle)
// and the automated tests. Everything here is plain JSON-serialisable data.

export type SourceKind = 'url' | 'file';

export interface PlaylistSource {
  id: string;
  name: string;
  kind: SourceKind;
  /** Remote URL (kind = 'url'). Treated as a secret: never logged or displayed in full. */
  url?: string;
  /** Original file name (kind = 'file'). The file content is cached in storage. */
  fileName?: string;
  /** Optional EPG source ids linked to this playlist. */
  epgIds: string[];
  enabled: boolean;
  createdAt: number;
  lastImportAt?: number;
  lastImportError?: string;
  /** EPG URL advertised in the playlist header (url-tvg / x-tvg-url), if any. */
  headerEpgUrl?: string;
  channelCount?: number;
  /** User-Agent this provider accepts (auto-detected at import); also used for its streams. */
  userAgent?: string;
  /** Provider login (server/username/password) when added with "Username & password". */
  xtream?: { server: string; username: string; password: string; output: 'm3u8' | 'ts' };
  /** Streams the provider allows at once (from the account check), if known. */
  maxConnections?: number;
}

export interface EpgSource {
  id: string;
  name: string;
  kind: SourceKind;
  url?: string;
  fileName?: string;
  enabled: boolean;
  createdAt: number;
  lastRefreshAt?: number;
  lastAttemptAt?: number;
  lastError?: string;
  channelCount?: number;
  programmeCount?: number;
  userAgent?: string;
  /** Time span covered by the cached data (UTC ms). */
  coverageStart?: number;
  coverageEnd?: number;
}

/** A channel exactly as parsed from the playlist (never modified by the user). */
export interface ParsedChannel {
  /** Stable key: survives URL/token changes on re-import. */
  key: string;
  playlistId: string;
  /** Position in the source playlist (0-based). */
  index: number;
  /** Name exactly as it appeared after the EXTINF comma (or tvg-name fallback). */
  originalName: string;
  tvgId?: string;
  tvgName?: string;
  tvgLogo?: string;
  tvgChno?: number;
  groupTitle?: string;
  url: string;
  /** Extra HTTP headers required by the stream (from #EXTVLCOPT / Kodi pipe syntax). */
  headers?: Record<string, string>;
  /** Any other attributes found on the EXTINF line. */
  attrs?: Record<string, string>;
  catchup?: string;
  radio?: boolean;
}

export type CategoryId =
  | 'sports' | 'news' | 'entertainment' | 'movies' | 'kids' | 'documentaries'
  | 'music' | 'international' | 'lifestyle' | 'religious' | 'radio' | 'other';

export type CategoryEvidence = 'group' | 'name' | 'user' | 'none';

/** User customisations, stored separately from parsed data so they survive re-imports. */
export interface ChannelCustomization {
  key: string;
  name?: string;
  number?: number;
  hidden?: boolean;
  favorite?: boolean;
  category?: CategoryId;
  /** Manual sort position (lower comes first) used by the "custom" sort. */
  order?: number;
  /** What the channel was (name, tvg-id), so the change can follow it to another provider. */
  ident?: { name: string; tvgId?: string };
}

/** 'provider' = the provider's own per-channel guide (Xtream short EPG); 'event' = game read from an event channel's name. */
export type MatchMethod = 'tvg-id' | 'tvg-name' | 'name' | 'fuzzy' | 'manual' | 'provider' | 'event' | 'english' | 'station' | 'none';
export type MatchStatus = 'auto' | 'pending' | 'approved' | 'rejected' | 'unmatched';

export interface MatchResult {
  key: string;
  epgChannelId?: string;
  method: MatchMethod;
  /** 0..1 */
  confidence: number;
  status: MatchStatus;
  candidates?: { id: string; score: number; name: string }[];
}

/** A user decision about an EPG match; persisted and re-applied after refreshes. */
export interface MatchDecision {
  key: string;
  epgChannelId?: string; // undefined + rejected => "no guide"
  status: 'approved' | 'rejected' | 'manual';
  decidedAt: number;
}

export interface EpgChannel {
  id: string;
  sourceId: string;
  displayNames: string[];
  icon?: string;
}

export interface Programme {
  /** EPG channel id */
  ch: string;
  start: number; // UTC ms
  stop: number; // UTC ms
  title: string;
  subTitle?: string;
  desc?: string;
  categories?: string[];
  episode?: string; // human readable, e.g. "S2 E5"
  date?: string;
  rating?: string;
  icon?: string;
  isNew?: boolean;
  live?: boolean;
}

/** Channel as displayed: parsed data + customisations + derived info. */
export interface LineupChannel {
  key: string;
  playlistId: string;
  index: number;
  number: number;
  name: string;
  originalName: string;
  cleanedName: string;
  logo?: string;
  url: string;
  headers?: Record<string, string>;
  group?: string;
  category: CategoryId;
  categoryEvidence: CategoryEvidence;
  favorite: boolean;
  hidden: boolean;
  order: number;
  epgChannelId?: string;
  matchStatus: MatchStatus;
  matchMethod: MatchMethod;
  matchConfidence: number;
  duplicateOf?: string;
  tvgId?: string;
  /** Country code from the name prefix or group ("us", "uk", …). */
  country?: string;
  /** The provider's own code for that country ("US", "UK", "ES"), shown on the tab. */
  countryCode?: string;
  /** My TV (DIRECTV New York/NJ) channel number, on the best copy of that channel. */
  myTv?: number;
  /** Playlist channel number before My TV numbering was applied. */
  playlistNumber?: number;
}

export type SortMode = 'playlist' | 'alpha' | 'number' | 'category' | 'favorites' | 'recent' | 'custom' | 'mytv' | 'country' | 'provider';
export type StartupScreen = 'home' | 'guide' | 'channels' | 'last-channel';
export type NaiveTimeMode = 'utc' | 'local' | 'zone';

export interface Settings {
  sortMode: SortMode;
  showEmptyCategories: boolean;
  showHidden: boolean;
  /** Display time zone; '' = device/system zone. */
  timeZone: string;
  hour12: boolean | 'auto';
  /** How XMLTV timestamps without an offset are interpreted. */
  naiveTimeMode: NaiveTimeMode;
  naiveTimeZone: string;
  /** Hours between automatic guide refreshes; 0 = manual only. */
  epgRefreshHours: number;
  /** Hours of past programmes kept in cache. */
  epgKeepPastHours: number;
  /** Auto-approve fuzzy matches at or above this confidence. 0 = never (default). */
  fuzzyAutoApprove: number;
  accent: string;
  theme: 'a7' | 'victors' | 'luxury' | 'aero' | 'dark' | 'darker' | 'contrast';
  /** The Frutiger Aero look was introduced (switched on once for existing setups). */
  aeroIntroduced?: boolean;
  startupScreen: StartupScreen;
  /** Playback */
  autoplayLastChannel: boolean;
  playbackRetries: number;
  stallTimeoutSec: number;
  bufferSec: number;
  /** Desktop only: 'auto' tries direct then falls back to local proxy. */
  streamProxy: 'auto' | 'always' | 'never';
  osdTimeoutSec: number;
  showDemo: boolean;
  zapFavoritesOnly: boolean;
  guideHoursVisible: number;
  /** Sports: favorite team ids (catalog ids like "nfl:nyg" or "custom:…"). */
  favoriteTeams: string[];
  customTeams: { id: string; name: string; aliases: string[] }[];
  /** Show a "your team is live" banner on the Live TV screen. */
  sportsBanner: boolean;
  /** Event channels ("NFL 03", "PPV 2") show the game that's on instead of the slot name. */
  liveEventNames: boolean;
  /** Fetch guide data per channel from the provider for channels the guide file doesn't cover. */
  providerGuide: boolean;
  /** Replace playlist logos with matching high-quality transparent logos. */
  hqLogos: boolean;
  /** Live rewind: minutes of the channel kept for rewinding / pausing (0 = off). Fire TV keeps them on the device; browsers in memory (max 10). */
  rewindMin: number;
  /** Prefer English programme titles/descriptions when the guide has several languages. */
  preferEnglish: boolean;
  /** Subtitles / captions on movies and shows that have them. */
  captions?: boolean;
  /** Streams you chose for My TV numbers (they win over the automatic pick, and follow you to other providers by name / call sign). */
  myTvPins: MyTvPin[];
}

export interface MyTvPin {
  /** My TV (DIRECTV) number. */
  n: number;
  /** The stream's name in the playlist. */
  name: string;
  /** Station call sign, so a similar stream from another provider is found too. */
  call?: string;
  /** Stream id / number at the provider the pin was made with. */
  streamId?: string;
}

export interface Reminder {
  key: string; // channelKey|start
  channelKey: string;
  title: string;
  start: number;
  stop: number;
}

export const DEFAULT_SETTINGS: Settings = {
  sortMode: 'number',
  showEmptyCategories: false,
  showHidden: false,
  timeZone: '',
  hour12: 'auto',
  naiveTimeMode: 'utc',
  naiveTimeZone: '',
  epgRefreshHours: 12,
  epgKeepPastHours: 3,
  fuzzyAutoApprove: 0,
  accent: '#4cc2ff',
  theme: 'aero',
  startupScreen: 'home',
  autoplayLastChannel: false,
  playbackRetries: 3,
  stallTimeoutSec: 15,
  bufferSec: 8,
  streamProxy: 'auto',
  osdTimeoutSec: 5,
  showDemo: true,
  zapFavoritesOnly: false,
  guideHoursVisible: 2.5,
  favoriteTeams: [],
  customTeams: [],
  sportsBanner: true,
  liveEventNames: true,
  providerGuide: true,
  hqLogos: true,
  rewindMin: 30,
  preferEnglish: true,
  myTvPins: [
    { n: 2, name: 'A3 NEW YORK 02 WCBS CBS NEW YORK ᶜᶦᵗʸ RAW', call: 'WCBS', streamId: '2353' },
    { n: 4, name: 'A3 NEW YORK 04 WNBC NBC NEW YORK ᶜᶦᵗʸ RAW', call: 'WNBC', streamId: '2354' },
    { n: 5, name: 'A3 NEW YORK 05 WNYW FOX NEW YORK ᶜᶦᵗʸ RAW', call: 'WNYW', streamId: '2355' },
    { n: 7, name: 'A3 NEW YORK 07 WABC ABC NEW YORK ᶜᶦᵗʸ RAW', call: 'WABC', streamId: '2356' },
  ],
};

export interface RecentEntry {
  key: string;
  at: number;
}

export interface ImportWarning {
  line?: number;
  message: string;
}
