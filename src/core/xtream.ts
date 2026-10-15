// "Xtream Codes" style provider logins (server + username + password), used by
// most IPTV services. LTTV turns them into the standard M3U + XMLTV URLs.

/**
 * Some IPTV servers only answer requests that look like a common media player and
 * reject others with unusual codes (e.g. 884). LTTV tries these identities in order.
 */
export const CLIENT_IDENTITIES: { id: string; label: string; ua?: string }[] = [
  { id: 'lttv', label: 'LTTV (default)' },
  { id: 'vlc', label: 'VLC media player', ua: 'VLC/3.0.20 LibVLC/3.0.20' },
  { id: 'okhttp', label: 'Android player (okhttp)', ua: 'okhttp/4.12.0' },
  { id: 'browser', label: 'Web browser', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36' },
];

/** HTTP statuses that mean "the server refused this client" (worth retrying with another identity). */
export function isClientRejection(status: number | undefined): boolean {
  if (!status) return false;
  return status === 400 || status === 401 || status === 403 || status === 405 || status === 406 || status === 451 || status === 458 || status >= 600 || (status >= 460 && status < 500);
}

export interface XtreamLogin {
  server: string;
  username: string;
  password: string;
  /** 'm3u8' = HLS (plays in desktop browsers), 'ts' = MPEG-TS (fine on Fire TV). */
  output: 'm3u8' | 'ts';
}

/** Accepts "line.example.com:8080", "http://host:port/", or a pasted get.php/player_api URL. */
export function normalizeServer(input: string): string {
  let s = input.trim();
  if (!s) throw new Error('Enter the server address from your provider.');
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error('That server address doesn’t look right. It usually looks like http://line.example.com:8080');
  }
  // Drop known endpoint paths / query a user may have pasted.
  const path = u.pathname.replace(/\/(get|player_api|xmltv|panel_api)\.php$/i, '').replace(/\/+$/, '');
  return `${u.protocol}//${u.host}${path}`;
}

/** If the user pasted a full playlist link, pull the login out of it. */
export function parseXtreamUrl(url: string): Partial<XtreamLogin> | null {
  try {
    const u = new URL(url.trim());
    const username = u.searchParams.get('username');
    const password = u.searchParams.get('password');
    if (!username || !password) return null;
    const out = (u.searchParams.get('output') || '').toLowerCase();
    return { server: normalizeServer(url), username, password, output: out === 'ts' || out === 'mpegts' ? 'ts' : 'm3u8' };
  } catch {
    return null;
  }
}

function q(l: XtreamLogin) {
  return `username=${encodeURIComponent(l.username.trim())}&password=${encodeURIComponent(l.password.trim())}`;
}

export function xtreamUrls(l: XtreamLogin) {
  const base = normalizeServer(l.server);
  return {
    playlist: `${base}/get.php?${q(l)}&type=m3u_plus&output=${l.output === 'ts' ? 'ts' : 'm3u8'}`,
    epg: `${base}/xmltv.php?${q(l)}`,
    account: `${base}/player_api.php?${q(l)}`,
  };
}

export interface XtreamAccount {
  ok: boolean;
  message?: string;
  status?: string;
  expires?: number; // ms
  maxConnections?: number;
  activeConnections?: number;
  formats?: string[];
}

/** Interpret the provider's player_api.php response. */
export function parseAccount(json: unknown): XtreamAccount {
  const ui = (json as { user_info?: Record<string, unknown> } | null)?.user_info;
  if (!ui) return { ok: false, message: 'The server didn’t answer like an IPTV provider. Check the server address.' };
  const auth = Number(ui.auth);
  if (auth !== 1) return { ok: false, message: 'Login failed: the username or password is wrong.' };
  const status = String(ui.status ?? '');
  const exp = Number(ui.exp_date);
  const account: XtreamAccount = {
    ok: !/expired|banned|disabled/i.test(status),
    status: status || undefined,
    expires: Number.isFinite(exp) && exp > 0 ? exp * 1000 : undefined,
    maxConnections: ui.max_connections !== undefined ? Number(ui.max_connections) : undefined,
    activeConnections: ui.active_cons !== undefined ? Number(ui.active_cons) : undefined,
    formats: Array.isArray(ui.allowed_output_formats) ? (ui.allowed_output_formats as string[]) : undefined,
  };
  if (!account.ok) account.message = `Your subscription is ${status.toLowerCase()}. Contact your provider.`;
  else if (account.expires && account.expires < Date.now()) {
    account.ok = false;
    account.message = 'Your subscription has expired. Contact your provider.';
  }
  return account;
}

/** Pick an output format the account allows, preferring the requested one. */
export function chooseOutput(wanted: 'm3u8' | 'ts', formats?: string[]): 'm3u8' | 'ts' {
  if (!formats?.length) return wanted;
  const has = (f: string) => formats.some((x) => x.toLowerCase() === f);
  if (has(wanted)) return wanted;
  if (wanted === 'm3u8' && has('ts')) return 'ts';
  if (wanted === 'ts' && has('m3u8')) return 'm3u8';
  return wanted;
}

export interface XtreamCategory {
  category_id: string | number;
  category_name: string;
}

export interface XtreamStream {
  num?: number | string;
  name?: string;
  stream_type?: string;
  stream_id: number | string;
  stream_icon?: string;
  epg_channel_id?: string | null;
  category_id?: string | number | null;
  tv_archive?: number | string;
}

export function xtreamApiUrl(l: XtreamLogin, action: string): string {
  return `${xtreamUrls(l).account}&action=${encodeURIComponent(action)}`;
}

/** Stream URL for a live channel, the way Xtream-compatible apps build it. */
export function xtreamStreamUrl(l: XtreamLogin, streamId: string | number): string {
  const base = normalizeServer(l.server);
  return `${base}/live/${encodeURIComponent(l.username.trim())}/${encodeURIComponent(l.password.trim())}/${streamId}.${l.output === 'ts' ? 'ts' : 'm3u8'}`;
}

const attr = (v: string) => v.replace(/"/g, "'").replace(/[\r\n]+/g, ' ').trim();

/**
 * Build an M3U playlist from the provider's app API (player_api.php), used when the
 * provider has switched off the plain get.php playlist download.
 */
export function xtreamToM3U(l: XtreamLogin, categories: XtreamCategory[], streams: XtreamStream[]): string {
  const cats = new Map(categories.map((c) => [String(c.category_id), c.category_name]));
  const lines = [`#EXTM3U url-tvg="${xtreamUrls(l).epg}"`];
  for (const s of streams) {
    if (s.stream_type && s.stream_type !== 'live' && s.stream_type !== 'created_live') continue;
    const name = attr(String(s.name ?? `Channel ${s.stream_id}`));
    const group = cats.get(String(s.category_id ?? '')) ?? '';
    const parts = [
      s.epg_channel_id ? `tvg-id="${attr(String(s.epg_channel_id))}"` : '',
      `tvg-name="${name}"`,
      s.stream_icon ? `tvg-logo="${attr(String(s.stream_icon))}"` : '',
      s.num !== undefined && s.num !== '' ? `tvg-chno="${attr(String(s.num))}"` : '',
      group ? `group-title="${attr(group)}"` : '',
    ].filter(Boolean);
    lines.push(`#EXTINF:-1 ${parts.join(' ')},${name}`);
    lines.push(xtreamStreamUrl(l, s.stream_id));
  }
  return lines.join('\n') + '\n';
}

/** "/live/user/pass/123.m3u8" (or the older "/user/pass/123") -> { id: "123", ext: "m3u8" }. */
export function xtreamStreamRef(url: string): { id: string; ext: string; base: string; user: string; pass: string } | null {
  try {
    const u = new URL(url);
    const m = /^(.*?)\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)(?:\.(m3u8|ts|mpegts))?$/i.exec(u.pathname);
    if (!m) return null;
    return { base: `${u.protocol}//${u.host}${m[1]}`, user: decodeURIComponent(m[2]), pass: decodeURIComponent(m[3]), id: m[4], ext: (m[5] ?? '').toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * Other ways the same live channel can be requested from an Xtream-style server.
 * Some channels only work as HLS (.m3u8) or only as MPEG-TS (.ts), so playback
 * rotates through these when the first one fails.
 */
export function xtreamAlternates(url: string, preferHls: boolean): string[] {
  const r = xtreamStreamRef(url);
  if (!r || !isXtreamLive(url)) return [];
  const u = encodeURIComponent(r.user);
  const p = encodeURIComponent(r.pass);
  const hls = `${r.base}/live/${u}/${p}/${r.id}.m3u8`;
  const ts = `${r.base}/live/${u}/${p}/${r.id}.ts`;
  // Classic Xtream playlists (output=ts) use /user/pass/id.ts without "/live/".
  const classic = `${r.base}/${u}/${p}/${r.id}.ts`;
  const order = preferHls ? [hls, ts, classic] : [classic, ts, hls];
  return [...new Set(order)].filter((x) => x !== url);
}

/**
 * Is this an Xtream-style live channel URL? "/live/user/pass/123.m3u8", or the classic
 * "/user/pass/123.ts" / "/user/pass/123" that get.php?output=ts produces.
 */
export function isXtreamLive(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    if (/\/live\/[^/]+\/[^/]+\/\d+(\.(m3u8|ts|mpegts))?$/i.test(path)) return true;
    return /^\/(?!movie\/|series\/|timeshift\/|vod\/)[^/]+\/[^/]+\/\d+(\.(ts|m3u8|mpegts))?$/i.test(path);
  } catch {
    return false;
  }
}

/** Login for a playlist: the saved one, or one read from a pasted get.php link. */
export function loginFor(p: { xtream?: XtreamLogin; url?: string }): XtreamLogin | null {
  if (p.xtream) return p.xtream;
  if (!p.url) return null;
  const l = parseXtreamUrl(p.url);
  return l?.server && l.username && l.password ? (l as XtreamLogin) : null;
}

function b64(s: unknown): string {
  if (typeof s !== 'string' || !s) return '';
  try {
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes).trim();
  } catch {
    return s;
  }
}

/** Parse player_api.php?action=get_short_epg into guide programmes (titles are base64). */
export function parseShortEpg(json: unknown, ref: string): import('./types').Programme[] {
  const list = (json as { epg_listings?: unknown[] } | null)?.epg_listings;
  if (!Array.isArray(list)) return [];
  const out: import('./types').Programme[] = [];
  for (const raw of list) {
    const e = raw as Record<string, unknown>;
    let start = Number(e.start_timestamp) * 1000;
    let stop = Number(e.stop_timestamp ?? e.end_timestamp) * 1000;
    if (!Number.isFinite(start) || !start) start = Date.parse(String(e.start ?? '').replace(' ', 'T') + 'Z');
    if (!Number.isFinite(stop) || !stop) stop = Date.parse(String(e.end ?? e.stop ?? '').replace(' ', 'T') + 'Z');
    const title = b64(e.title);
    if (!title || !(stop > start)) continue;
    const desc = b64(e.description);
    out.push({ ch: ref, start, stop, title, ...(desc ? { desc } : {}) });
  }
  out.sort((a, b) => a.start - b.start);
  // Drop overlaps (some panels repeat entries).
  return out.filter((p, i) => i === 0 || p.start >= out[i - 1].stop || p.start !== out[i - 1].start);
}
