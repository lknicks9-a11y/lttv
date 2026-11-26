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

// A tiny MPEG-TS writer: PAT + PMT (one track of the given type) + `seconds` of video PES with `bytesPerSec`.
function fakeTs(streamType: number, seconds: number, bytesPerSec: number): Uint8Array {
  const pkts: number[][] = [];
  const pkt = (pid: number, pusi: boolean, payload: number[]) => {
    const p = [0x47, (pusi ? 0x40 : 0) | (pid >> 8), pid & 0xff, 0x10, ...payload];
    while (p.length < 188) p.push(0xff);
    pkts.push(p.slice(0, 188));
  };
  // PAT: program 1 → PMT pid 0x100
  pkt(0, true, [0, 0x00, 0xb0, 13, 0, 1, 0xc1, 0, 0, 0, 1, 0xe1, 0x00, 0, 0, 0, 0]);
  // PMT: PCR pid 0x101, one stream (type) on pid 0x101
  pkt(0x100, true, [0, 0x02, 0xb0, 18, 0, 1, 0xc1, 0, 0, 0xe1, 0x01, 0xf0, 0, streamType, 0xe1, 0x01, 0xf0, 0, 0, 0, 0, 0]);
  const pesPerSec = 10;
  const perPes = Math.max(1, Math.round(bytesPerSec / pesPerSec / 184));
  for (let i = 0; i <= seconds * pesPerSec; i++) {
    const pts = i * 9000;
    const ptsBytes = [0x21 | ((Math.floor(pts / 2 ** 30) & 7) << 1), (pts >> 22) & 0xff, ((pts >> 14) & 0xfe) | 1, (pts >> 7) & 0xff, ((pts << 1) & 0xfe) | 1];
    pkt(0x101, true, [0, 0, 1, 0xe0, 0, 0, 0x80, 0x80, 5, ...ptsBytes]);
    for (let k = 1; k < perPes; k++) pkt(0x101, false, []);
  }
  return Uint8Array.from(pkts.flat());
}

test('stream check: a black screen, a still slate or sound only is "no picture"; a real game is live', async () => {
  const { judgePicture } = await import('../src/core/liveness');
  assert.equal(judgePicture(fakeTs(0x1b, 2, 400_000)), 'live');
  assert.equal(judgePicture(fakeTs(0x1b, 2, 8_000)), 'dead');
  assert.equal(judgePicture(fakeTs(0x0f, 2, 400_000)), 'dead'); // AAC audio only
  assert.equal(judgePicture(fakeTs(0x06, 2, 400_000)), undefined); // a video kind we don't recognise: no verdict, not "dead"
  assert.equal(judgePicture(fakeTs(0x1b, 0.5, 400_000)), undefined); // too short to tell
});
