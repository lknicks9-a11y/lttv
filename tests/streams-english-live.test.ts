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
