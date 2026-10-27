import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NBA_TEAM_CHANNELS, nbaMainChannels, nbaTonightFor, parseNbaTvSchedule } from '../src/core/nbachannels';

const lineup = Object.values(NBA_TEAM_CHANNELS).flat().map((p, i) => ({ key: `k${i}`, originalName: p.name, name: p.name, group: p.group, number: i, hidden: false })) as never[];
const team = (name: string, short: string, side: string) => ({ id: short, name, short, location: '', abbr: short, side });
const game = (away: [string, string], home: [string, string], start: string) => ({ id: 'g', league: 'nba', start: Date.parse(start), state: 'pre', detail: '', name: '', away: team(...away, 'away'), home: team(...home, 'home'), broadcasts: [] }) as never;
const pill = (box: string, text: string) => `<span class="smw-cards-net-item"><span class="smwcards-net-pill">${box ? `<span class="${box}-box">${box === 'away' ? 'A' : 'H'}</span> ` : ''}${text}</span></span>`;
const card = (ts: string, ac: string, an: string, hc: string, hn: string, pills: string) => `<div class="smw-cards-daycard-item"><span data-timestamp="${ts}">x</span><div class="smw-cards-team-away"><a><span class="smwcards-team-text">${ac}</span></a><span class="smw-cards-team-nick" style="a">${an}</span></div><div class="smw-cards-team-home"><a><span class="smwcards-team-text">${hc}</span></a><span class="smw-cards-team-nick" style="a">${hn}</span></div><div class="nets">${pills}</div></div>`;

const html = [
  card('2026-10-26T23:00:00+00:00', 'Washington', 'Wizards', 'Charlotte', 'Hornets', pill('', 'NBA League Pass') + pill('away', 'MNMT') + pill('home', 'WAXN-TV64') + pill('home', 'DAZN')),
  card('2026-10-27T00:00:00+00:00', 'Indiana', 'Pacers', 'Milwaukee', 'Bucks', pill('away', 'DAZN') + pill('home', 'WCGV-My24')),
  card('2026-10-26T23:30:00+00:00', 'Chicago', 'Bulls', 'Boston', 'Celtics', pill('away', 'CHSN') + pill('home', 'NBCSB')),
  card('2026-10-27T00:00:00+00:00', 'Phoenix', 'Suns', 'Oklahoma City', 'Thunder', pill('away', 'KTVK-IND') + pill('home', 'KSBI-IND')),
  card('2026-10-26T23:30:00+00:00', 'Dallas', 'Mavericks', 'Miami', 'Heat', pill('', 'NBA TV') + pill('away', 'KFAA') + pill('home', 'WPLG')),
].join('');
const list = parseNbaTvSchedule(html);
const mains = (away: [string, string], home: [string, string], start: string) => {
  const g = game(away, home, start);
  return nbaMainChannels(g, nbaTonightFor(g, list), lineup).map((m) => `${m.side}:${(m.ch as { originalName: string }).originalName}`);
};

test('NBA: tonight\'s local channel when the team is on it, else its NBA team channel', () => {
  assert.equal(list.length, 5);
  assert.deepEqual(mains(['Washington Wizards', 'Wizards'], ['Charlotte Hornets', 'Hornets'], '2026-10-26T23:00:00Z'), ['away:US: MONUMENTAL SPORTS NETWORK HD', 'away:TV: MONUMENTAL SPORTS NETWORK ALTERNATE ᴿᴬᵂ']);
  assert.deepEqual(mains(['Indiana Pacers', 'Pacers'], ['Milwaukee Bucks', 'Bucks'], '2026-10-27T00:00:00Z'), ['home:NBA: MILWAUKEE BUCKS ᴴᴰ', 'away:NBA: INDIANA PACERS ᴴᴰ']);
  assert.deepEqual(mains(['Chicago Bulls', 'Bulls'], ['Boston Celtics', 'Celtics'], '2026-10-26T23:30:00Z'), ['home:TV: NBC SPORTS BOSTON ᴿᴬᵂ', 'away:TV: CHICAGO SPORTS NETWORK ᴿᴬᵂ', 'away:TV: CHICAGO SPORTS NETWORK PLUS ᴿᴬᵂ']);
  assert.deepEqual(mains(['Phoenix Suns', 'Suns'], ['Oklahoma City Thunder', 'Thunder'], '2026-10-27T00:00:00Z'), ['home:NBA: OKLAHOMA CITY THUNDER ᴴᴰ', "away:RK: ARIZONA'S FAMILY ᴿᴬᵂ"]);
  assert.deepEqual(mains(['Dallas Mavericks', 'Mavericks'], ['Miami Heat', 'Heat'], '2026-10-26T23:30:00Z'), ['home:US: ABC (WPLG) Miami (D) HD', 'away:TV: DALLAS, TX KFAA IND 29 A3 HD MIAMI ᶜᶦᵗʸ ᴿᴬᵂ']);
});
