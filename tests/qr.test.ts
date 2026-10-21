import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix, qrSvgPath } from '../src/core/qr';

test('QR: picks the smallest version and draws the finder patterns', () => {
  assert.equal(qrMatrix('A').length, 21);
  assert.equal(qrMatrix('http://192.168.1.23:8787').length, 25);
  const m = qrMatrix('http://192.168.100.200:8797/?pin=1234');
  const n = m.length;
  for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    assert.ok(m[y][x] && m[y + 6][x + 6] && !m[y + 1][x + 1] && m[y + 3][x + 3], `finder at ${x},${y}`);
  }
  assert.equal(qrSvgPath(m).size, n + 8);
});

test('QR: rejects text that does not fit', () => {
  assert.throws(() => qrMatrix('x'.repeat(400)));
});
