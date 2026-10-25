import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdult, isAdultChannel } from '../src/core/adult';

test('adult channels and categories are recognised, look-alikes are not', () => {
  for (const t of ['XXX', 'ADULTS | 18+', 'For Adults', 'Adult', 'US: Playboy TV', 'Brazzers TV', 'Dorcel TV HD', 'VOD | XXX Movies', 'Adult Only', '18+ Channels', 'Hustler HD', 'Penthouse Passion'])
    assert.ok(isAdult(t), t);
  for (const t of ['Adult Swim', 'US: Cartoon Network / Adult Swim', 'Adult Contemporary Hits', 'USA Sports', 'Sky Sports Main Event', 'Sussex', 'Essex Live', 'Middlesex FC', 'Vividly Comedy', 'Kids'])
    assert.ok(!isAdult(t), t);
  assert.ok(isAdultChannel('XXX | Adult', 'Channel 1'));
  assert.ok(!isAdultChannel('USA Entertainment', 'US: Adult Swim HD'));
});
