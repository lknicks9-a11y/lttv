import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
// @ts-expect-error -- plain ESM module without types
import { createRemoteServer, createServer, remote } from '../server/server.mjs';

const listen = (s: http.Server) => new Promise<number>((ok) => s.listen(0, '127.0.0.1', () => ok((s.address() as AddressInfo).port)));

test('phone remote: pairing code, key check, and commands relayed to the LTTV page', async () => {
  const main = createServer();
  const phone = createRemoteServer();
  const mainPort = await listen(main);
  const phonePort = await listen(phone);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${phonePort}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  // Not paired / wrong code / LTTV not open.
  assert.equal((await post('/rapi/cmd', { cmd: 'state' })).status, 401);
  assert.equal((await post('/rapi/pair', { pin: remote.pin === '000000' ? '111111' : '000000' })).status, 401);
  const paired = await (await post('/rapi/pair', { pin: remote.pin })).json();
  assert.equal(paired.token, remote.token);
  const auth = { 'x-lttv-key': remote.token };
  assert.equal((await post('/rapi/cmd', { cmd: 'state' }, auth)).status, 503);
  assert.equal((await post('/rapi/cmd', { cmd: 'shutdown' }, auth)).status, 400); // only the known commands

  // A fake LTTV page: asks for commands a few times a second and answers them.
  let stop = false;
  const page = (async () => {
    while (!stop) {
      const j = await (await fetch(`http://127.0.0.1:${mainPort}/api/remote/next`)).json();
      for (const m of j.cmds) await fetch(`http://127.0.0.1:${mainPort}/api/remote/reply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: m.id, ok: true, result: { echo: m.cmd, args: m.args } }) });
      await new Promise((r) => setTimeout(r, 30));
    }
  })();
  await new Promise((r) => setTimeout(r, 50));
  const r = await post('/rapi/cmd', { cmd: 'key', args: { key: 'down' } }, auth);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).result, { echo: 'key', args: { key: 'down' } });

  // The pairing info is only for the computer itself, and the phone server never serves the fetch helper.
  assert.equal((await fetch(`http://127.0.0.1:${phonePort}/api/fetch?url=http://example.com`)).status, 404);
  stop = true;
  await page;
  main.close();
  phone.close();
});
