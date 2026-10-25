// Telling a working live stream from a dead or blank one by what the server sends.
//  - dead: an error, nothing, an error page, an empty playlist.
//  - blank: video that carries next to no picture — a black screen, a still "off air" / slate card — found by its
//    bitrate on the stream's own clock (a real game is well over 1 Mbit/s; a still or black picture is a few hundred
//    kbit/s at most, mostly the audio). The clock (PCR) is used, not the wall clock, because IPTV servers send the
//    first seconds in a burst.
export type Liveness = 'live' | 'dead' | 'blank';

/** Below this, a channel is showing a still or black picture. */
export const BLANK_BPS = 350_000;

/** MPEG-TS packets or an HLS playlist with media = live; an error page, an empty playlist or nothing = dead. */
export function judgeStreamStart(head: Uint8Array, total: number): Liveness {
  if (isTs(head)) return 'live';
  const text = new TextDecoder().decode(head.subarray(0, 4096)).trimStart();
  if (text.startsWith('#EXTM3U')) return /#EXTINF|#EXT-X-STREAM-INF/.test(text) ? 'live' : 'dead';
  if (/^(<!doctype|<html|<\?xml|\{)/i.test(text)) return 'dead'; // an error page instead of video
  // Something else that keeps coming (MP4, FLV…): counts as live once a real amount arrived.
  return total >= 8192 ? 'live' : 'dead';
}

/** Where MPEG-TS packets start (sync byte every 188 bytes), or -1. */
export function tsStart(buf: Uint8Array): number {
  for (let i = 0; i < 188 && i < buf.length; i++) {
    if (buf[i] === 0x47 && (i + 188 >= buf.length || buf[i + 188] === 0x47)) return i;
  }
  return -1;
}
export function isTs(buf: Uint8Array): boolean {
  return tsStart(buf) >= 0;
}

/**
 * Bits per second of an MPEG-TS sample, measured on its own clock (the PCR of one programme), or undefined when the
 * sample covers less than a second of stream time (not enough to tell).
 */
export function tsBitrate(buf: Uint8Array): number | undefined {
  const off = tsStart(buf);
  if (off < 0) return undefined;
  let pcrPid = -1;
  let first = -1;
  let firstPos = 0;
  let last = -1;
  let lastPos = 0;
  // Real data only: the filler packets cable streams are padded with (PID 0x1FFF) aren't picture.
  let payload = 0;
  let payloadAtFirst = 0;
  let payloadAtLast = 0;
  for (let i = off; i + 188 <= buf.length; i += 188) {
    if (buf[i] !== 0x47) break; // lost sync: use what was measured so far
    const pid0 = ((buf[i + 1] & 0x1f) << 8) | buf[i + 2];
    if (pid0 !== 0x1fff) payload += 188;
    const afc = (buf[i + 3] >> 4) & 3;
    if (afc !== 2 && afc !== 3) continue;
    if (buf[i + 4] < 7 || (buf[i + 5] & 0x10) === 0) continue;
    const pid = ((buf[i + 1] & 0x1f) << 8) | buf[i + 2];
    if (pcrPid < 0) pcrPid = pid;
    if (pid !== pcrPid) continue;
    // 33-bit PCR base in 90 kHz units (plain arithmetic: more than 32 bits).
    const pcr = (buf[i + 6] * 16777216 + buf[i + 7] * 65536 + buf[i + 8] * 256 + buf[i + 9]) * 2 + (buf[i + 10] >> 7);
    if (first < 0) {
      first = pcr;
      firstPos = i;
      payloadAtFirst = payload;
    }
    last = pcr;
    lastPos = i;
    payloadAtLast = payload;
  }
  if (first < 0) return undefined;
  let d = last - first;
  if (d < 0) d += 8589934592; // clock wrapped
  const secs = d / 90000;
  if (secs < 1 || secs > 120) return undefined;
  void firstPos;
  void lastPos;
  return ((payloadAtLast - payloadAtFirst) * 8) / secs;
}

/** Live or blank from a sample's bitrate (undefined: can't tell). */
export function judgeBitrate(bps: number | undefined): Liveness | undefined {
  if (bps === undefined || !Number.isFinite(bps)) return undefined;
  return bps < BLANK_BPS ? 'blank' : 'live';
}

/** From an HLS media playlist: a recent full segment and its length (seconds), to measure the bitrate. */
export function pickHlsSegment(text: string): { uri: string; dur: number } | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const segs: { uri: string; dur: number }[] = [];
  let dur = 0;
  for (const l of lines) {
    if (l.startsWith('#EXTINF:')) dur = parseFloat(l.slice(8));
    else if (l && !l.startsWith('#')) {
      segs.push({ uri: l, dur });
      dur = 0;
    }
  }
  // The one before the newest: complete on the server.
  const s = segs.length > 1 ? segs[segs.length - 2] : segs[0];
  return s && s.dur > 0.5 ? s : undefined;
}

/** From an HLS master playlist: the first variant's playlist address. */
export function pickHlsVariant(text: string): string | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
      for (let j = i + 1; j < lines.length; j++) if (lines[j] && !lines[j].startsWith('#')) return lines[j];
    }
  }
  return undefined;
}
