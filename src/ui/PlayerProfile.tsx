// A player's page in LTTV League Pass: bio, this season and career, awards, recent games and every season.
import { h, Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { openRemote } from '../app/platform';
import { ATHLETE_BASE, athleteUrls, parseBio, parseGamelog, parseOverview, parseSeasons, type PlayerBio, type PlayerOverview } from '../core/playerprofile';
import { Modal } from './common';

const base = (league: 'nba' | 'nfl' = 'nba') => {
  let b = ATHLETE_BASE;
  try {
    b = localStorage.getItem('lttvAthleteBase') || ATHLETE_BASE;
  } catch {
    /* default */
  }
  return league === 'nfl' ? b.replace('basketball/nba', 'football/nfl') : b;
};
async function getJson(url: string): Promise<unknown> {
  const { stream } = await openRemote(url, AbortSignal.timeout?.(15_000));
  return JSON.parse(await new Response(stream).text());
}
type Loaded<T> = T | null | undefined; // undefined: loading, null: didn't load
function useJson<T>(url: string, parse: (j: unknown) => T): Loaded<T> {
  const [v, setV] = useState<Loaded<T>>(undefined);
  useEffect(() => {
    let alive = true;
    setV(undefined);
    if (!url) return;
    getJson(url).then((j) => alive && setV(parse(j))).catch(() => alive && setV(null));
    return () => {
      alive = false;
    };
  }, [url]);
  return v;
}

const HEADLINE = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'FG%', '3P%', 'FT%', 'MIN', 'GP'];
function Tiles({ o }: { o: PlayerOverview }) {
  return (
    <>
      {o.lines.map((l) => (
        <div class="pp-line" key={l.title}>
          <div class="pp-sub">{l.title}</div>
          <div class="pp-tiles">
            {HEADLINE.filter((k) => l.labels.includes(k)).map((k) => (
              <div class="pp-tile" key={k}><b>{l.stats[l.labels.indexOf(k)] ?? '–'}</b><small>{k}</small></div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** A stats table whose rows take the remote, so a long table scrolls on a TV. */
function Table({ head, rows, lead }: { head: string[]; rows: { key: string; cells: string[]; cls?: string }[]; lead: string }) {
  const cols = `${lead} repeat(${head.length - lead.split(' ').length}, minmax(2.6rem, 1fr))`;
  return (
    <div class="pp-table" data-group="pp-table">
      <div class="pp-tr pp-th" style={{ gridTemplateColumns: cols }}>{head.map((x) => <span key={x}>{x}</span>)}</div>
      {rows.map((r) => (
        <button type="button" class={`f pp-tr ${r.cls ?? ''}`} key={r.key} style={{ gridTemplateColumns: cols }}>{r.cells.map((c, i) => <span key={i}>{c}</span>)}</button>
      ))}
    </div>
  );
}

export function PlayerProfile({ id, name, headshot, onClose, league = 'nba' }: { id: string; name: string; headshot?: string; onClose: () => void; league?: 'nba' | 'nfl' }) {
  const u = athleteUrls(id, base(league));
  const bio = useJson<PlayerBio | null>(u.bio, parseBio);
  const ov = useJson(u.overview, parseOverview);
  const [tab, setTab] = useState<'overview' | 'games' | 'seasons'>('overview');
  // The longer tables are fetched when you open them.
  const gl = useJson(tab === 'games' ? u.gamelog : '', (j) => (tab === 'games' ? parseGamelog(j) : null));
  const se = useJson(tab === 'seasons' ? u.seasons : '', (j) => (tab === 'seasons' ? parseSeasons(j) : null));
  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const face = bio?.headshot ?? headshot;
  return (
    <Modal onClose={onClose} wide class={`pp lp-modal ${league}`} title={bio?.name ?? name}>
      <div class="pp-head">
        {face ? <img class="pp-face" src={face} alt="" /> : <span class="pp-face" />}
        <div class="pp-id">
          <div class="pp-role">{[bio?.jersey ? `#${bio.jersey}` : '', bio?.position, bio?.team].filter(Boolean).join(' · ') || (bio === undefined ? 'Loading…' : '')}</div>
          <div class="pp-facts">
            {bio?.facts.map(([k, v]) => <div key={k}><small>{k}</small><span>{v}</span></div>)}
          </div>
          {ov && ov.awards.length > 0 && <div class="pp-awards">{ov.awards.slice(0, 8).map((a) => <span class="pp-award" key={a.name}>{a.count ? `${a.count} ` : ''}{a.name}</span>)}</div>}
        </div>
      </div>
      <div class="pp-tabs" data-group="pp-tabs">
        {([['overview', 'Overview'], ['games', 'Game log'], ['seasons', 'Seasons']] as const).map(([k, label]) => (
          <button type="button" class={`f lp-tab ${tab === k ? 'on' : ''}`} key={k} data-autofocus={k === 'overview' ? '' : undefined} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'overview' && (ov === undefined ? <p class="muted row gap"><span class="spinner" /> Loading stats…</p> : ov && ov.lines.length ? <Tiles o={ov} /> : <p class="muted">Stats for this player didn’t load.</p>)}
      {tab === 'games' && (gl === undefined ? <p class="muted row gap"><span class="spinner" /> Loading games…</p> : gl && gl.games.length ? (
        <Table lead="4.6rem 5.4rem 7.6rem" head={['Date', 'Opp', 'Result', ...gl.labels]} rows={gl.games.slice(0, 25).map((g) => ({ key: String(g.date), cls: g.result === 'W' ? 'win' : g.result === 'L' ? 'loss' : '', cells: [day(g.date), `${g.at ? '@' : 'vs'} ${g.opp}`, `${g.result} ${g.score}`, ...g.stats] }))} />
      ) : <p class="muted">No games this season yet.</p>)}
      {tab === 'seasons' && (se === undefined ? <p class="muted row gap"><span class="spinner" /> Loading seasons…</p> : se && se.seasons.length ? (
        <Table lead="5.4rem 4rem" head={['Season', 'Team', ...se.labels]} rows={[...se.seasons.map((s, i) => ({ key: s.season + s.team + i, cells: [s.season, s.team, ...s.stats] })).reverse(), ...(se.career.length ? [{ key: 'career', cls: 'career', cells: ['Career', '', ...se.career] }] : [])]} />
      ) : <p class="muted">Season stats for this player didn’t load.</p>)}
      <p class="hint">Stats: ESPN.</p>
    </Modal>
  );
}
