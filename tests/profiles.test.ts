import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/app/profiles';
import type { ChannelCustomization } from '../src/core/types';

function memKv(init: Record<string, unknown> = {}) {
  const m = new Map<string, unknown>(Object.entries(init));
  return { m, getKv: async <T,>(k: string) => m.get(k) as T | undefined, setKv: async (k: string, v: unknown) => void (v === undefined ? m.delete(k) : m.set(k, v)) };
}

test('profiles: the account’s favorites, recents and Continue watching become the first profile’s; each profile keeps its own', async () => {
  const customs = new Map<string, ChannelCustomization>([
    ['a', { key: 'a', favorite: true, ident: { name: 'US: ESPN' } }],
    ['b', { key: 'b', name: 'Renamed' }],
  ]);
  const kv = memKv({ recents: [{ key: 'b', at: 1 }], vodResume: { 'm:p:1': { key: 'm:p:1', pos: 100 } } });
  await P.initProfiles(kv, customs, 'Luke');
  const first = P.listProfiles()[0];
  assert.equal(first.name, 'Luke');
  assert.ok(P.isFavorite('a'));
  assert.deepEqual(await P.profileRecents(), [{ key: 'b', at: 1 }]);
  assert.ok((kv.m.get(P.resumeKey()) as Record<string, unknown>)['m:p:1']);
  // Favorites with no other change still come through (with the channel's name to follow a renumbering).
  const w = P.withProfileFavorites(new Map([['b', { key: 'b', name: 'Renamed' }]]));
  assert.equal(w.get('a')?.favorite, true);
  assert.equal(w.get('a')?.ident?.name, 'US: ESPN');
  await P.setFavorite('c', true, { name: 'US: TNT' });
  await P.setFavorite('a', false);
  assert.ok(P.isFavorite('c') && !P.isFavorite('a'));
  // A second profile starts empty; deleting needs another profile in use.
  const kid = await P.addProfile('Kids');
  assert.deepEqual(kv.m.get(`fav:${kid.id}`), {});
  await assert.rejects(P.deleteProfile(first.id));
  await P.deleteProfile(kid.id);
  assert.equal(P.listProfiles().length, 1);
});

test('profiles merge across devices: deletions stick, the newer copy of a profile wins', async () => {
  const kv = memKv();
  await P.initProfiles(kv, new Map(), 'Me');
  const me = P.listProfiles()[0];
  await P.setFavorite('local-old', true);
  const localAt = kv.m.get(`profileAt:${me.id}`) as number;
  // The other device: newer favorites for "Me", a "Dad" profile, and a profile it deleted.
  const dad = { id: 'dad1', name: 'Dad', color: '#fff', createdAt: 1 };
  const gone = { id: 'gone1', name: 'Old', color: '#000', createdAt: 1 };
  const r = await P.mergeProfiles({
    list: [me, dad], deleted: ['gone1'], at: Date.now() + 1000,
    data: {
      [me.id]: { fav: { 'remote-new': {} }, recents: [], vodResume: {}, at: localAt + 1000 },
      dad1: { fav: { espn: {} }, recents: [], vodResume: {}, at: 5 },
    },
  });
  assert.ok(r.changed && r.currentChanged);
  assert.deepEqual(P.listProfiles().map((p) => p.name), ['Me', 'Dad']);
  assert.ok(P.isFavorite('remote-new') && !P.isFavorite('local-old'));
  // An older copy arriving later doesn't undo newer local changes, and a deleted profile doesn't come back.
  await P.setFavorite('mine-now', true);
  await P.mergeProfiles({ list: [me, dad, gone], deleted: [], at: 1, data: { [me.id]: { fav: {}, recents: [], vodResume: {}, at: 2 } } });
  assert.ok(P.isFavorite('mine-now'));
  assert.ok(!P.listProfiles().some((p) => p.id === 'gone1'));
});
