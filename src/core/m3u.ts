import type { ImportWarning, ParsedChannel } from './types';
import { hash53, maybeDecodeURIComponent } from './util';

export interface M3UResult {
  channels: ParsedChannel[];
  warnings: ImportWarning[];
  /** Attributes found on the #EXTM3U header line (e.g. url-tvg). */
  header: Record<string, string>;
  hadHeader: boolean;
  /** EPG url(s) advertised by the playlist header, if any. */
  epgUrls: string[];
  stats: { lines: number; entries: number; skipped: number };
}

export interface M3UOptions {
  playlistId: string;
  /** Called every ~2000 entries; return value ignored. Allows progress reporting. */
  onProgress?: (entries: number, line: number, totalLines: number) => void;
}

/**
 * Parse `key="value"` / `key='value'` / `key=value` attributes. Tolerant of
 * missing quotes, stray spaces around '=', duplicated keys (first wins) and
 * commas inside quoted values. Returns attributes + the index where the
 * attribute section ended.
 */
export function parseAttributes(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z0-9_\-:.]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,"']+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const key = m[1].toLowerCase();
    const val = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (!(key in out)) out[key] = val;
  }
  return out;
}

/**
 * Split an EXTINF line into its "params" part and the display title.
 * The title follows the first comma that is not inside a quoted attribute.
 */
export function splitExtinf(body: string): { params: string; title: string } {
  let inQuote: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inQuote) {
      if (c === inQuote) inQuote = null;
    } else if (c === '"' || c === "'") {
      // Only treat as a quote if it opens an attribute value (follows '=')
      const prev = body.slice(0, i).trimEnd();
      if (prev.endsWith('=')) inQuote = c;
    } else if (c === ',') {
      return { params: body.slice(0, i), title: body.slice(i + 1) };
    }
  }
  // Unbalanced quotes: fall back to the last comma
  const last = body.lastIndexOf(',');
  if (last >= 0) return { params: body.slice(0, last), title: body.slice(last + 1) };
  return { params: body, title: '' };
}

const URL_LIKE = /^(https?|rtmp[a-z]*|rtsp|rtp|udp|mms|mmsh|srt|file|plugin|acestream|igmp):\/\/|^[a-z][a-z0-9+.-]*:\/\//i;

/** Kodi-style "url|User-Agent=x&Referer=y" header syntax. */
export function splitPipeHeaders(raw: string): { url: string; headers?: Record<string, string> } {
  const pipe = raw.indexOf('|');
  if (pipe < 0) return { url: raw };
  const url = raw.slice(0, pipe);
  const headers: Record<string, string> = {};
  for (const part of raw.slice(pipe + 1).split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = maybeDecodeURIComponent(part.slice(eq + 1).trim());
    if (k) headers[normalizeHeaderName(k)] = v;
  }
  return { url, headers: Object.keys(headers).length ? headers : undefined };
}

function normalizeHeaderName(k: string): string {
  const lower = k.toLowerCase();
  if (lower === 'user-agent' || lower === 'useragent') return 'User-Agent';
  if (lower === 'referer' || lower === 'referrer') return 'Referer';
  if (lower === 'origin') return 'Origin';
  if (lower === 'cookie') return 'Cookie';
  return k;
}

function cleanText(s: string): string {
  // Strip control chars (keep normal unicode), collapse whitespace.
  return s.replace(/[\u0000-\u001f\u007f​﻿]/g, ' ').replace(/\s+/g, ' ').trim();
}

function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || u.hostname;
    return maybeDecodeURIComponent(last.replace(/\.(m3u8?|ts|mp4|mpd)$/i, '')) || u.hostname;
  } catch {
    return url.slice(0, 40);
  }
}

/**
 * Robust M3U / M3U8 (extended) playlist parser.
 *  - Works with or without #EXTM3U, CRLF/CR/LF line endings, a UTF-8 BOM.
 *  - Accepts quoted/unquoted/single-quoted attributes and commas inside quotes.
 *  - Supports #EXTGRP, #EXTVLCOPT http options, #KODIPROP and pipe headers.
 *  - Bare URL lines without #EXTINF become channels named from the URL.
 *  - #EXTINF without a following URL is reported as a warning and skipped.
 */
export function parseM3U(text: string, opts: M3UOptions): M3UResult {
  const warnings: ImportWarning[] = [];
  const channels: ParsedChannel[] = [];
  const header: Record<string, string> = {};
  let hadHeader = false;
  let skipped = 0;

  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r\n|\r|\n/);

  if (/^\s*<\?xml|^\s*<tv[\s>]/i.test(text.slice(0, 200))) {
    throw new Error('This looks like an XMLTV guide file, not an M3U playlist.');
  }
  if (/^\s*<!doctype html|^\s*<html/i.test(text.slice(0, 300))) {
    throw new Error('The source returned a web page (HTML) instead of an M3U playlist. Check the URL or your login.');
  }

  let pending: {
    line: number;
    attrs: Record<string, string>;
    title: string;
    group?: string;
    headers: Record<string, string>;
    kodi: Record<string, string>;
  } | null = null;
  // Options that may precede #EXTINF in some playlists
  let preHeaders: Record<string, string> = {};
  const keyCounts = new Map<string, number>();
  const total = lines.length;

  const push = (rawUrl: string, lineNo: number) => {
    const { url, headers: pipeHeaders } = splitPipeHeaders(rawUrl.trim());
    const attrs = pending?.attrs ?? {};
    const tvgName = attrs['tvg-name'] ? cleanText(maybeDecodeURIComponent(attrs['tvg-name'])) : undefined;
    let originalName = cleanText(maybeDecodeURIComponent(pending?.title ?? ''));
    if (!originalName) originalName = tvgName || cleanText(attrs['tvg-id'] || '') || nameFromUrl(url);
    const headers = { ...preHeaders, ...(pending?.headers ?? {}), ...(pipeHeaders ?? {}) };
    const tvgId = attrs['tvg-id']?.trim() || undefined;
    const group = cleanText(maybeDecodeURIComponent(attrs['group-title'] ?? pending?.group ?? '')) || undefined;
    const chnoRaw = attrs['tvg-chno'] ?? attrs['channel-number'] ?? attrs['tvg-num'];
    const chno = chnoRaw && /^\d{1,6}(\.\d+)?$/.test(chnoRaw.trim()) ? Number(chnoRaw) : undefined;

    // Stable key: independent of the stream URL so tokens/credentials can rotate.
    const base = `${opts.playlistId}|${(tvgId || '').toLowerCase()}|${originalName.toLowerCase()}`;
    const n = keyCounts.get(base) ?? 0;
    keyCounts.set(base, n + 1);
    const key = 'c' + hash53(base + '|' + n);

    const known = new Set(['tvg-id', 'tvg-name', 'tvg-logo', 'group-title', 'tvg-chno', 'channel-number', 'tvg-num', 'catchup', 'radio']);
    const extra: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs)) if (!known.has(k)) extra[k] = v;
    if (pending) for (const [k, v] of Object.entries(pending.kodi)) extra['kodiprop:' + k] = v;

    const logo = (attrs['tvg-logo'] || attrs['logo'] || '').trim();
    channels.push({
      key,
      playlistId: opts.playlistId,
      index: channels.length,
      originalName,
      tvgId,
      tvgName,
      tvgLogo: logo && !/^(null|none|n\/a)$/i.test(logo) ? logo : undefined,
      tvgChno: chno,
      groupTitle: group,
      url,
      headers: Object.keys(headers).length ? headers : undefined,
      attrs: Object.keys(extra).length ? extra : undefined,
      catchup: attrs['catchup'] || undefined,
      radio: attrs['radio'] === 'true' || attrs['radio'] === '1' || undefined,
    });
    if (opts.onProgress && channels.length % 2000 === 0) opts.onProgress(channels.length, lineNo, total);
    pending = null;
    preHeaders = {};
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;
    const lineNo = i + 1;

    if (line.startsWith('#')) {
      const upper = line.slice(0, 12).toUpperCase();
      if (upper.startsWith('#EXTM3U')) {
        hadHeader = true;
        Object.assign(header, parseAttributes(line.slice(7)));
      } else if (upper.startsWith('#EXTINF')) {
        if (pending) {
          warnings.push({ line: pending.line, message: `Entry "${pending.title || '(no name)'}" has no stream URL and was skipped.` });
          skipped++;
        }
        const colon = line.indexOf(':');
        const body = colon >= 0 ? line.slice(colon + 1) : '';
        const { params, title } = splitExtinf(body);
        // params begins with the duration (e.g. "-1" or "0")
        const attrs = parseAttributes(params.replace(/^\s*-?\d+(\.\d+)?/, ''));
        pending = { line: lineNo, attrs, title, headers: {}, kodi: {} };
      } else if (upper.startsWith('#EXTGRP')) {
        const g = line.slice(line.indexOf(':') + 1).trim();
        if (pending) pending.group = pending.group ?? g;
      } else if (upper.startsWith('#EXTVLCOPT')) {
        const opt = line.slice(line.indexOf(':') + 1).trim();
        const eq = opt.indexOf('=');
        if (eq > 0) {
          const k = opt.slice(0, eq).trim().toLowerCase();
          const v = opt.slice(eq + 1).trim();
          const target = pending ? pending.headers : preHeaders;
          if (k === 'http-user-agent') target['User-Agent'] = v;
          else if (k === 'http-referrer' || k === 'http-referer') target['Referer'] = v;
          else if (k === 'http-origin') target['Origin'] = v;
        }
      } else if (upper.startsWith('#KODIPROP')) {
        const opt = line.slice(line.indexOf(':') + 1).trim();
        const eq = opt.indexOf('=');
        if (eq > 0 && pending) {
          const k = opt.slice(0, eq).trim();
          const v = opt.slice(eq + 1).trim();
          pending.kodi[k] = v;
          if (/stream_headers$/i.test(k)) {
            const { headers } = splitPipeHeaders('x|' + v);
            if (headers) Object.assign(pending.headers, headers);
          }
        }
      }
      // Other comments/directives (#EXT-X-*, #PLAYLIST, ...) are ignored.
      continue;
    }

    if (URL_LIKE.test(line) || line.startsWith('/') || /^[\w.-]+\.(m3u8?|ts|mp4|mpd)(\?|$)/i.test(line)) {
      if (!pending) {
        // Bare URL without EXTINF metadata.
        pending = { line: lineNo, attrs: {}, title: '', headers: {}, kodi: {} };
      }
      push(line, lineNo);
    } else {
      warnings.push({ line: lineNo, message: `Unrecognised line ignored: "${line.slice(0, 60)}${line.length > 60 ? '…' : ''}"` });
    }
  }
  if (pending) {
    warnings.push({ line: (pending as { line: number }).line, message: 'The last entry has no stream URL and was skipped.' });
    skipped++;
  }
  if (!hadHeader && channels.length) warnings.unshift({ message: 'Playlist has no #EXTM3U header; parsed anyway.' });
  if (!channels.length) {
    throw new Error(hadHeader ? 'The playlist was read but contains no channels.' : 'No channels found. This does not look like an M3U playlist.');
  }

  const epgUrls: string[] = [];
  for (const k of ['url-tvg', 'x-tvg-url', 'tvg-url']) {
    if (header[k]) for (const u of header[k].split(',')) if (u.trim()) epgUrls.push(u.trim());
  }

  return {
    channels,
    warnings,
    header,
    hadHeader,
    epgUrls: [...new Set(epgUrls)],
    stats: { lines: lines.length, entries: channels.length, skipped },
  };
}
