import { test } from 'node:test';
import assert from 'node:assert/strict';
import { undefer } from '../src/app/undefer';

const enc = new TextEncoder();
const body = (parts: string[]) => new ReadableStream<Uint8Array>({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } });

test('Fire TV fetches: the status line is read first, the rest is the body (split anywhere)', async () => {
  const ok = await undefer(body(['LTTV-STA', 'TUS 200 11\n{"a"', ':1}xxxx']));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('x-upstream-length'), '11');
  assert.equal(await ok.text(), '{"a":1}xxxx');
  const bad = await undefer(body(['LTTV-STATUS 404 \n{"error":"The source server answered 404"}']));
  assert.equal(bad.status, 404);
  assert.equal((await bad.json()).error, 'The source server answered 404');
});
