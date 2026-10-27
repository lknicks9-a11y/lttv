// Team Channel Picker: a separate page of the desktop helper (http://127.0.0.1:8787/picker.html), not part of the
// LTTV app. Load your playlist, watch any channel to check it, and pick each NBA / NHL team's channels; then copy the
// list (channel names only, no stream links or login) to send to Claude. Streams play through the helper's proxy.
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { parseM3U } from '../core/m3u';

type Ch = { name: string; group: string; tvgId?: string; url: string; headers?: Record<string, string>; f: string };
type Pick = { name: string; group: string; tvgId?: string };

const NBA: [string, string, string][] = [['ATL', 'Atlanta Hawks', '#E03A3E'], ['BOS', 'Boston Celtics', '#007A33'], ['BKN', 'Brooklyn Nets', '#777'], ['CHA', 'Charlotte Hornets', '#00788C'], ['CHI', 'Chicago Bulls', '#CE1141'], ['CLE', 'Cleveland Cavaliers', '#860038'], ['DAL', 'Dallas Mavericks', '#00538C'], ['DEN', 'Denver Nuggets', '#FEC524'], ['DET', 'Detroit Pistons', '#C8102E'], ['GSW', 'Golden State Warriors', '#1D428A'], ['HOU', 'Houston Rockets', '#CE1141'], ['IND', 'Indiana Pacers', '#FDBB30'], ['LAC', 'LA Clippers', '#C8102E'], ['LAL', 'Los Angeles Lakers', '#552583'], ['MEM', 'Memphis Grizzlies', '#5D76A9'], ['MIA', 'Miami Heat', '#98002E'], ['MIL', 'Milwaukee Bucks', '#00471B'], ['MIN', 'Minnesota Timberwolves', '#236192'], ['NOP', 'New Orleans Pelicans', '#85714D'], ['NYK', 'New York Knicks', '#F58426'], ['OKC', 'Oklahoma City Thunder', '#007AC1'], ['ORL', 'Orlando Magic', '#0077C0'], ['PHI', 'Philadelphia 76ers', '#ED174C'], ['PHX', 'Phoenix Suns', '#E56020'], ['POR', 'Portland Trail Blazers', '#E03A3E'], ['SAC', 'Sacramento Kings', '#5A2D81'], ['SAS', 'San Antonio Spurs', '#8A8D8F'], ['TOR', 'Toronto Raptors', '#CE1141'], ['UTA', 'Utah Jazz', '#3E2680'], ['WAS', 'Washington Wizards', '#E31837']];
const NHL: [string, string, string][] = [['ANA', 'Anaheim Ducks', '#F47A38'], ['BOS', 'Boston Bruins', '#FFB81C'], ['BUF', 'Buffalo Sabres', '#003087'], ['CGY', 'Calgary Flames', '#C8102E'], ['CAR', 'Carolina Hurricanes', '#CE1126'], ['CHI', 'Chicago Blackhawks', '#CF0A2C'], ['COL', 'Colorado Avalanche', '#6F263D'], ['CBJ', 'Columbus Blue Jackets', '#002654'], ['DAL', 'Dallas Stars', '#006847'], ['DET', 'Detroit Red Wings', '#CE1126'], ['EDM', 'Edmonton Oilers', '#FF4C00'], ['FLA', 'Florida Panthers', '#C8102E'], ['LAK', 'Los Angeles Kings', '#A2AAAD'], ['MIN', 'Minnesota Wild', '#154734'], ['MTL', 'Montreal Canadiens', '#AF1E2D'], ['NSH', 'Nashville Predators', '#FFB81C'], ['NJD', 'New Jersey Devils', '#CE1126'], ['NYI', 'New York Islanders', '#00539B'], ['NYR', 'New York Rangers', '#0038A8'], ['OTT', 'Ottawa Senators', '#C52032'], ['PHI', 'Philadelphia Flyers', '#F74902'], ['PIT', 'Pittsburgh Penguins', '#FCB514'], ['SJS', 'San Jose Sharks', '#006D75'], ['SEA', 'Seattle Kraken', '#68A2B9'], ['STL', 'St. Louis Blues', '#002F87'], ['TBL', 'Tampa Bay Lightning', '#002868'], ['TOR', 'Toronto Maple Leafs', '#00205B'], ['UTA', 'Utah Mammoth', '#6CACE4'], ['VAN', 'Vancouver Canucks', '#00205B'], ['VGK', 'Vegas Golden Knights', '#B4975A'], ['WSH', 'Washington Capitals', '#C8102E'], ['WPG', 'Winnipeg Jets', '#041E42']];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9+ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const proxied = (url: string, headers?: Record<string, string>, mode?: string) => {
  const p = new URLSearchParams({ url });
  if (headers && Object.keys(headers).length) p.set('h', JSON.stringify(headers));
  if (mode) p.set('mode', mode);
  return `api/fetch?${p}`;
};

let channels: Ch[] = [];
let league: 'nba' | 'nhl' = 'nba';
let current = 'nba:ATL';
let playing: Ch | undefined;
let picks: Record<string, Pick[]> = {};
try {
  picks = JSON.parse(localStorage.getItem('lttvPickerPicks') || '{}') || {};
} catch {
  picks = {};
}
const save = () => {
  try {
    localStorage.setItem('lttvPickerPicks', JSON.stringify(picks));
  } catch {
    /* not remembered */
  }
};
const teamsOf = (lg: string) => (lg === 'nba' ? NBA : NHL);
const teamName = (key: string) => {
  const [lg, ab] = key.split(':');
  return teamsOf(lg).find((t) => t[0] === ab)?.[1] ?? key;
};

function setStatus(text: string, cls = 'muted') {
  const s = $('status');
  s.textContent = text;
  s.className = `status ${cls}`;
}

function loadText(text: string, from: string) {
  const r = parseM3U(text, { playlistId: 'picker' });
  channels = r.channels.map((c) => ({ name: c.originalName, group: c.groupTitle ?? '', tvgId: c.tvgId, url: c.url, headers: c.headers, f: fold(`${c.originalName} ${c.groupTitle ?? ''}`) }));
  if (!channels.length) return setStatus('No channels found in that playlist. Check the link or file.', 'err');
  setStatus(`${channels.length.toLocaleString()} channels loaded from ${from}.`, 'ok');
  if (!($('q') as HTMLInputElement).value) ($('q') as HTMLInputElement).value = teamName(current).split(' ').slice(-1)[0];
  renderResults();
}

async function loadUrl() {
  let url = ($('url') as HTMLInputElement).value.trim();
  const user = ($('user') as HTMLInputElement).value.trim();
  const pass = ($('pass') as HTMLInputElement).value;
  if (!url) return setStatus('Paste your playlist link first, or open a file.', 'err');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  if (user) url = `${url.replace(/\/+$/, '').replace(/\/(get\.php|player_api\.php).*$/i, '')}/get.php?${new URLSearchParams({ username: user, password: pass, type: 'm3u_plus', output: 'ts' })}`;
  setStatus('Loading playlist…');
  try {
    const r = await fetch(proxied(url, undefined, undefined) + '&gunzip=auto', { cache: 'no-store' });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}) as { error?: string });
      throw new Error((j as { error?: string }).error || `HTTP ${r.status}`);
    }
    loadText(await r.text(), 'your provider');
  } catch (e) {
    setStatus(`Couldn't load the playlist: ${(e as Error).message}. Is the LTTV helper running on this computer?`, 'err');
  }
}

// ---------------- player ----------------
let hls: Hls | null = null;
let ts: ReturnType<typeof mpegts.createPlayer> | null = null;
function stop() {
  hls?.destroy();
  hls = null;
  try {
    ts?.destroy();
  } catch {
    /* already gone */
  }
  ts = null;
  const v = $('video') as HTMLVideoElement;
  v.removeAttribute('src');
  v.load();
}

async function play(ch: Ch) {
  playing = ch;
  stop();
  $('nowName').textContent = ch.name;
  ($('addNow') as HTMLButtonElement).disabled = false;
  ($('addNow') as HTMLButtonElement).textContent = `Add to ${teamName(current)}`;
  const ps = $('playStatus');
  ps.textContent = 'Connecting…';
  ps.className = 'status muted';
  const v = $('video') as HTMLVideoElement;
  let kind = 'unknown';
  try {
    const p = new URLSearchParams({ url: ch.url });
    if (ch.headers) p.set('h', JSON.stringify(ch.headers));
    kind = ((await (await fetch(`api/probe?${p}`)).json()) as { kind?: string }).kind ?? 'unknown';
  } catch {
    /* guess below */
  }
  if (playing !== ch) return;
  const fail = (msg: string) => {
    if (playing !== ch) return;
    ps.textContent = msg;
    ps.className = 'status err';
  };
  v.onplaying = () => {
    if (playing === ch) {
      ps.textContent = 'Playing. Unmute with the speaker button if you want sound.';
      ps.className = 'status ok';
    }
  };
  if (kind === 'ts' || (kind === 'unknown' && /\.ts(\?|$)|\/live\/[^/]+\/[^/]+\/\d+$/i.test(ch.url))) {
    if (!mpegts.isSupported()) return fail("This browser can't play raw TS streams. Use Chrome or Edge.");
    ts = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: new URL(proxied(ch.url, ch.headers), location.href).href }, { enableWorker: false, liveBufferLatencyChasing: true });
    ts.on(mpegts.Events.ERROR, (...args: unknown[]) => { const info = args[2] as { code?: number } | undefined; fail(info?.code === 401 || info?.code === 403 ? `The provider refused this stream (${info.code}). Your connection limit may be in use.` : info?.code === 404 ? 'Stream not found (404). This channel may be offline.' : 'This stream stopped or can’t be played here.'); });
    ts.attachMediaElement(v);
    ts.load();
    void Promise.resolve(ts.play()).catch(() => undefined);
    return;
  }
  if (Hls.isSupported()) {
    hls = new Hls({ lowLatencyMode: false, liveSyncDurationCount: 3 });
    hls.on(Hls.Events.ERROR, (_e, d) => {
      if (d.fatal) fail(d.response?.code === 401 || d.response?.code === 403 ? `The provider refused this stream (${d.response.code}).` : d.response?.code === 404 ? 'Stream not found (404). This channel may be offline.' : 'This stream stopped or can’t be played here.');
    });
    hls.loadSource(proxied(ch.url, ch.headers, 'hls'));
    hls.attachMedia(v);
    void v.play().catch(() => undefined);
    return;
  }
  v.src = proxied(ch.url, ch.headers);
  void v.play().catch(() => fail('This stream can’t be played here.'));
}

// ---------------- lists ----------------
function renderTeams() {
  $('tab-nba').setAttribute('aria-selected', String(league === 'nba'));
  $('tab-nhl').setAttribute('aria-selected', String(league === 'nhl'));
  $('teams').innerHTML = teamsOf(league)
    .map(([ab, name, col]) => {
      const key = `${league}:${ab}`;
      const n = (picks[key] ?? []).length;
      return `<button class="team" type="button" data-key="${key}" aria-current="${key === current}"><span class="sw" style="background:${col}"></span><span class="n">${esc(name)}</span><span class="c ${n ? 'done' : ''}">${n ? `${n} ✓` : '—'}</span></button>`;
    })
    .join('');
}

function renderPicked() {
  const list = picks[current] ?? [];
  $('teamTitle').textContent = `${teamName(current)} channels`;
  $('picked').innerHTML = list.length
    ? list.map((p, i) => `<div class="pick"><span class="r">${i + 1}</span><span class="t">${esc(p.name)}<small>${esc(p.group || 'No group')}</small></span>${i ? `<button type="button" data-up="${i}" title="Move up">↑</button>` : ''}<button type="button" data-rm="${i}">Remove</button></div>`).join('')
    : '<span class="muted">None yet. Click a channel to watch it, then press "Add to team".</span>';
  if (playing) ($('addNow') as HTMLButtonElement).textContent = `Add to ${teamName(current)}`;
}

function renderResults() {
  const q = fold(($('q') as HTMLInputElement).value || '');
  const words = q.split(' ').filter(Boolean);
  if (!channels.length) {
    $('results').innerHTML = '<div class="row muted">Load your playlist to search it.</div>';
    return;
  }
  const list = words.length ? channels.filter((c) => words.every((w) => c.f.includes(w))) : [];
  const mk = (s: string) => {
    let h = esc(s);
    for (const w of words) h = h.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>');
    return h;
  };
  $('results').innerHTML = list.length
    ? list.slice(0, 250).map((c) => `<div class="row ${c === playing ? 'playing' : ''}" data-i="${channels.indexOf(c)}"><span class="t">${mk(c.name)}<small>${esc(c.group || 'No group')}</small></span><span class="muted">▶</span></div>`).join('') + (list.length > 250 ? `<div class="row muted">${list.length - 250} more. Add another word to narrow it down.</div>` : '')
    : `<div class="row muted">${words.length ? 'No channels match. Try the network name, the city or the call sign.' : 'Type to search your playlist.'}</div>`;
}

function renderOut() {
  const lines = ['LTTV team channels (exact names from my playlist, first = usual channel)', ''];
  let done = 0;
  for (const lg of ['nba', 'nhl']) {
    lines.push(lg.toUpperCase());
    for (const [ab, name] of teamsOf(lg)) {
      const list = picks[`${lg}:${ab}`] ?? [];
      if (list.length) done++;
      lines.push(`${name}: ${list.length ? list.map((p) => `${p.name}${p.group ? ` [${p.group}]` : ''}`).join(' | ') : '(none)'}`);
    }
    lines.push('');
  }
  ($('out') as HTMLTextAreaElement).value = lines.join('\n');
  $('done').textContent = `${done} of ${NBA.length + NHL.length} teams`;
}

function renderAll() {
  renderTeams();
  renderPicked();
  renderResults();
  renderOut();
}

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const row = t.closest<HTMLElement>('.row[data-i]');
  if (row) {
    void play(channels[Number(row.dataset.i)]);
    renderResults();
    return;
  }
  const b = t.closest<HTMLButtonElement>('button');
  if (!b) return;
  if (b.id === 'tab-nba' || b.id === 'tab-nhl') {
    league = b.id === 'tab-nba' ? 'nba' : 'nhl';
    current = `${league}:${teamsOf(league)[0][0]}`;
    ($('q') as HTMLInputElement).value = teamName(current).split(' ').slice(-1)[0];
    return renderAll();
  }
  if (b.dataset.key) {
    current = b.dataset.key;
    ($('q') as HTMLInputElement).value = teamName(current).split(' ').slice(-1)[0];
    renderAll();
    $('q').focus();
    return;
  }
  if (b.id === 'addNow' && playing) {
    const list = (picks[current] = picks[current] ?? []);
    if (!list.some((p) => p.name === playing!.name && p.group === playing!.group)) list.push({ name: playing.name, group: playing.group, tvgId: playing.tvgId });
    save();
    return renderAll();
  }
  if (b.dataset.rm !== undefined) {
    picks[current].splice(Number(b.dataset.rm), 1);
    if (!picks[current].length) delete picks[current];
    save();
    return renderAll();
  }
  if (b.dataset.up !== undefined) {
    const i = Number(b.dataset.up);
    const l = picks[current];
    [l[i - 1], l[i]] = [l[i], l[i - 1]];
    save();
    return renderAll();
  }
  if (b.id === 'copy') {
    const ta = $('out') as HTMLTextAreaElement;
    void navigator.clipboard.writeText(ta.value).then(
      () => setStatus('List copied. Paste it to Claude.', 'ok'),
      () => {
        ta.select();
        setStatus('Press Ctrl+C to copy the selected list.');
      },
    );
    return;
  }
  if (b.id === 'load') return void loadUrl();
  if (b.id === 'fileBtn') return $('file').click();
});
$('file').addEventListener('change', () => {
  const f = ($('file') as HTMLInputElement).files?.[0];
  if (!f) return;
  void f.text().then((t) => loadText(t, f.name));
});
$('q').addEventListener('input', renderResults);
$('url').addEventListener('keydown', (e) => e.key === 'Enter' && void loadUrl());
renderAll();
