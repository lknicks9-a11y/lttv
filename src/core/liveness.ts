// Telling a working live stream from a dead one by the first bytes the server sends.
export type Liveness = 'live' | 'dead';

/** MPEG-TS packets or an HLS playlist with media = live; an error page, an empty playlist or nothing = dead. */
export function judgeStreamStart(head: Uint8Array, total: number): Liveness {
  // MPEG-TS: sync byte every 188 bytes.
  const ts = head.findIndex((b) => b === 0x47);
  if (ts >= 0 && ts < 188 && (head.length < ts + 189 || head[ts + 188] === 0x47)) return 'live';
  const text = new TextDecoder().decode(head.subarray(0, 4096)).trimStart();
  if (text.startsWith('#EXTM3U')) return /#EXTINF|#EXT-X-STREAM-INF/.test(text) ? 'live' : 'dead';
  if (/^(<!doctype|<html|<\?xml|\{)/i.test(text)) return 'dead'; // an error page instead of video
  // Something else that keeps coming (MP4, FLV…): counts as live once a real amount arrived.
  return total >= 8192 ? 'live' : 'dead';
}

/**
 * What's inside an MPEG-TS sample: whether it has a video track, and how much picture data arrives per second of
 * video (by the video's own timestamps, so a fast first burst from the server doesn't count). A real game is
 * hundreds of KB per second; a black screen or a still "event starts soon" slate is only a few KB.
 */
export interface TsPicture {
  /** The stream's table of tracks was found. */
  tables: boolean;
  hasVideo: boolean;
  videoBytes: number;
  /** Seconds of video covered by the sample (from its timestamps). */
  seconds: number;
}

const VIDEO_TYPES = new Set([0x01, 0x02, 0x10, 0x1b, 0x24, 0x42, 0xd1, 0xea]);

export function analyzeTs(buf: Uint8Array): TsPicture | undefined {
  let s = -1;
  for (let i = 0; i < Math.min(buf.length - 376, 188); i++) {
    if (buf[i] === 0x47 && buf[i + 188] === 0x47 && buf[i + 376] === 0x47) { s = i; break; }
  }
  if (s < 0) return undefined;
  const pmtPids = new Set<number>();
  const videoPids = new Set<number>();
  let tables = false;
  const payloadAt = (o: number) => {
    const afc = (buf[o + 3] >> 4) & 3;
    if (afc === 0 || afc === 2) return -1;
    return afc === 3 ? o + 5 + buf[o + 4] : o + 4;
  };
  // Pass 1: the tables (PAT → PMT → which tracks are video).
  for (let o = s; o + 188 <= buf.length; o += 188) {
    if (buf[o] !== 0x47) continue;
    const pid = ((buf[o + 1] & 0x1f) << 8) | buf[o + 2];
    const pusi = (buf[o + 1] & 0x40) !== 0;
    if (!pusi) continue;
    let p = payloadAt(o);
    if (p < 0 || p >= o + 188) continue;
    p += 1 + buf[p]; // pointer field
    if (p + 8 >= o + 188) continue;
    const len = ((buf[p + 1] & 0x0f) << 8) | buf[p + 2];
    const end = Math.min(o + 188, p + 3 + len - 4);
    if (pid === 0 && buf[p] === 0x00) {
      for (let q = p + 8; q + 4 <= end; q += 4) {
        const prog = (buf[q] << 8) | buf[q + 1];
        if (prog !== 0) pmtPids.add(((buf[q + 2] & 0x1f) << 8) | buf[q + 3]);
      }
    } else if (pmtPids.has(pid) && buf[p] === 0x02) {
      tables = true;
      const infoLen = ((buf[p + 10] & 0x0f) << 8) | buf[p + 11];
      for (let q = p + 12 + infoLen; q + 5 <= end; ) {
        const type = buf[q];
        const epid = ((buf[q + 1] & 0x1f) << 8) | buf[q + 2];
        const esLen = ((buf[q + 3] & 0x0f) << 8) | buf[q + 4];
        if (VIDEO_TYPES.has(type)) videoPids.add(epid);
        q += 5 + esLen;
      }
    }
  }
  // Pass 2: the video's bytes and timestamps.
  let videoBytes = 0;
  let first = -1;
  let last = -1;
  for (let o = s; o + 188 <= buf.length; o += 188) {
    if (buf[o] !== 0x47) continue;
    const pid = ((buf[o + 1] & 0x1f) << 8) | buf[o + 2];
    if (!videoPids.has(pid)) continue;
    const p = payloadAt(o);
    if (p < 0 || p >= o + 188) continue;
    videoBytes += o + 188 - p;
    if ((buf[o + 1] & 0x40) && buf[p] === 0 && buf[p + 1] === 0 && buf[p + 2] === 1 && (buf[p + 7] & 0x80)) {
      const t = buf.subarray(p + 9, p + 14);
      const pts = (t[0] & 0x0e) * 536870912 + t[1] * 4194304 + (t[2] >> 1) * 32768 + t[3] * 128 + (t[4] >> 1);
      if (first < 0) first = pts;
      last = pts;
    }
  }
  let seconds = first >= 0 ? (last - first) / 90000 : 0;
  if (seconds < 0 || seconds > 60) seconds = 0; // a clock wrap or a jump: no verdict on the rate
  return { tables, hasVideo: videoPids.size > 0, videoBytes, seconds };
}

/** A real picture? 'dead' for no video track, or a black / still picture (almost no picture data per second). */
export function judgePicture(buf: Uint8Array): Liveness | undefined {
  const a = analyzeTs(buf);
  if (!a || !a.tables) return undefined;
  if (!a.hasVideo) return 'dead';
  if (a.seconds >= 1.2) return a.videoBytes / a.seconds < 25_000 ? 'dead' : 'live';
  return undefined;
}
