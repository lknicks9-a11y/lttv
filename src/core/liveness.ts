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
