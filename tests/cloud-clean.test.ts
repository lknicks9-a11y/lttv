import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanForDb } from '../src/app/cloud';

test('account saves leave out text Postgres refuses (NUL, half an emoji), keep real emoji', () => {
  const out = JSON.stringify({ name: 'ESPN\u0000 HD', emoji: 'Game 🏈 on', half: 'Cut \ud83c here', tail: 'x\udc00', list: ['ok\u0000'] }, cleanForDb);
  assert.equal(out, '{"name":"ESPN HD","emoji":"Game 🏈 on","half":"Cut  here","tail":"x","list":["ok"]}');
});
