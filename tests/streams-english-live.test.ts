import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEnglishChannel } from '../src/core/lang';

const ch = (originalName: string, group = '', country?: string) => ({ originalName, group, country });

test('English channels: Spanish-language and foreign feeds are left out', () => {
  assert.ok(isEnglishChannel(ch('US: ESPN HD', 'USA Sports', 'us')));
  assert.ok(isEnglishChannel(ch('NFL 03: Bears @ Packers', 'NFL Sunday Ticket')));
  assert.ok(isEnglishChannel(ch('UK: Sky Sports Main Event', 'UK Sports', 'uk')));
  assert.ok(!isEnglishChannel(ch('US: ESPN Deportes', 'USA Sports', 'us')));
  assert.ok(!isEnglishChannel(ch('US: TUDN', 'USA Sports', 'us')));
  assert.ok(!isEnglishChannel(ch('Telemundo Deportes', 'USA')));
  assert.ok(!isEnglishChannel(ch('NFL 03: Bears @ Packers', 'LATINO | NFL')));
  assert.ok(!isEnglishChannel(ch('ES: DAZN LaLiga', 'Spain', 'es')));
  assert.ok(!isEnglishChannel(ch('beIN Sports عربي', 'AR Sports')));
  assert.ok(!isEnglishChannel(ch('FR: Canal+ Sport', 'France', 'fr')));
});

import { judgeStreamStart } from '../src/core/liveness';

test('stream check: TS packets and HLS media are live; error pages and empty playlists are dead', () => {
  const ts = new Uint8Array(188 * 3);
  for (let i = 0; i < 3; i++) ts[i * 188] = 0x47;
  assert.equal(judgeStreamStart(ts, ts.length), 'live');
  const enc = (t: string) => new TextEncoder().encode(t);
  assert.equal(judgeStreamStart(enc('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg1.ts\n'), 60), 'live');
  assert.equal(judgeStreamStart(enc('#EXTM3U\n#EXT-X-ENDLIST\n'), 25), 'dead');
  assert.equal(judgeStreamStart(enc('<html><body>Stream not found</body></html>'), 42), 'dead');
  assert.equal(judgeStreamStart(enc('{"error":"offline"}'), 19), 'dead');
});

import { judgeBitrate, pickHlsSegment, pickHlsVariant, tsBitrate } from '../src/core/liveness';

/** A synthetic MPEG-TS sample: `secs` of stream clock, `pps` real packets per second (+ `filler` padding packets). */
function tsSample(secs: number, pps: number, filler = 0): Uint8Array {
  const pkts: Uint8Array[] = [];
  const pcrEvery = 0.04;
  for (let t = 0; t <= secs + 1e-9; t += pcrEvery) {
    const pcr = Math.round(t * 90000);
    const p = new Uint8Array(188);
    p[0] = 0x47; p[1] = 0x01; p[2] = 0x00; p[3] = 0x30; p[4] = 7; p[5] = 0x10;
    p[6] = Math.floor(pcr / 2 / 16777216) & 0xff; p[7] = Math.floor(pcr / 2 / 65536) & 0xff; p[8] = Math.floor(pcr / 2 / 256) & 0xff; p[9] = Math.floor(pcr / 2) & 0xff; p[10] = (pcr & 1) << 7;
    pkts.push(p);
    for (let i = 0; i < Math.round(pps * pcrEvery) - 1; i++) { const d = new Uint8Array(188); d[0] = 0x47; d[1] = 0x01; d[2] = 0x01; d[3] = 0x10; pkts.push(d); }
    for (let i = 0; i < Math.round(filler * pcrEvery); i++) { const f = new Uint8Array(188); f[0] = 0x47; f[1] = 0x1f; f[2] = 0xff; f[3] = 0x10; pkts.push(f); }
  }
  const out = new Uint8Array(pkts.length * 188);
  pkts.forEach((p, i) => out.set(p, i * 188));
  return out;
}

test('blank check: picture bitrate on the stream clock, filler ignored; HLS segment and variant picked', () => {
  const real = tsBitrate(tsSample(2, 2500))!; // ~3.8 Mbit/s
  assert.ok(real > 3_000_000 && real < 4_500_000, String(real));
  assert.equal(judgeBitrate(real), 'live');
  assert.equal(judgeBitrate(tsBitrate(tsSample(2, 125))), 'blank'); // ~190 kbit/s: a still / black picture
  assert.equal(judgeBitrate(tsBitrate(tsSample(2, 125, 4000))), 'blank'); // padded to 6 Mbit/s with filler: still blank
  assert.equal(tsBitrate(tsSample(0.5, 2500)), undefined); // under a second of clock: can't tell
  assert.deepEqual(pickHlsSegment('#EXTM3U\n#EXTINF:6.0,\na.ts\n#EXTINF:6.0,\nb.ts\n#EXTINF:4.0,\nc.ts\n'), { uri: 'b.ts', dur: 6 });
  assert.equal(pickHlsVariant('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000\nhi/index.m3u8\n'), 'low/index.m3u8');
});
