// Fantasy (your lineup, live fantasy points) and Bets (props you track against your own lines),
// plus the pop-ups that announce plays while you watch.
import { h, Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { LIVE_LEAGUES, PLAYER_PROPS, TEAM_PROPS, betLabel, fantasyPoints, liveLeague, type Bet, type LiveLeague, type LiveNotice } from '../core/livestats';
import {
  addBet, addFantasyPlayer, betStatus, clearSettledBets, fantasyTotal, gameForTeam, headshotUrl, loadRoster, onLiveNotice, removeBet, removeFantasyPlayer,
  setNotify, setScoring, useLiveSports, type FantasyPlayer,
} from '../app/livesports';
import { useLeagueTeams } from '../app/schedule';
import { Button, Chip, Empty, Icon, Modal, Toggle } from './common';
import { toast } from '../app/state';

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function Headshot({ src, name, size = 'md' }: { src?: string; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) return <img class={`headshot headshot-${size}`} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
  return <span class={`headshot headshot-${size} headshot-text`}>{name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</span>;
}

function Logo({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? <img class="team-logo team-logo-sm" src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : null;
}

// ---------------- pickers ----------------

interface PickedTeam { id: string; name: string; logo?: string }
interface PickedPlayer { id: string; name: string; position: string; headshot?: string }

/** League → team (→ player). */
function TeamAndPlayerPicker({ title, needPlayer, onPick, onClose }: { title: string; needPlayer: boolean; onPick: (league: LiveLeague, team: PickedTeam, player?: PickedPlayer) => void; onClose: () => void }) {
  const [league, setLeague] = useState<LiveLeague>('nfl');
  const [team, setTeam] = useState<PickedTeam | null>(null);
  const [q, setQ] = useState('');
  const dir = useLeagueTeams(league);
  const [roster, setRoster] = useState<{ list: PickedPlayer[] | null; error?: string }>({ list: null });
  useEffect(() => {
    if (!team || !needPlayer) return;
    setRoster({ list: null });
    loadRoster(league, team.id).then((list) => setRoster({ list })).catch((e: Error) => setRoster({ list: [], error: e.message }));
  }, [team?.id, league]);
  const teams = (dir.teams ?? []).filter((t) => !q.trim() || `${t.name} ${t.abbr}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Modal title={team ? team.name : title} onClose={onClose} wide class="fx-picker">
      {!team ? (
        <>
          <div class="chips compact" data-group="fx-leagues">
            {LIVE_LEAGUES.map((l) => <Chip active={league === l.id} onClick={() => { setLeague(l.id); setQ(''); }}>{l.name}</Chip>)}
          </div>
          {(dir.teams?.length ?? 0) > 40 && <input class="f input" type="search" placeholder="Search teams" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />}
          <div class="team-grid fx-grid" data-group="fx-teams" data-hlock>
            {teams.map((t, i) => (
              <button type="button" class="f team-option" data-autofocus={i === 0 ? '' : undefined} onClick={() => { const pt = { id: t.espnId, name: t.name, logo: t.logo }; if (needPlayer) setTeam(pt); else onPick(league, pt); }}>
                <Logo src={t.logo} />
                <span>{t.name}</span>
              </button>
            ))}
            {!teams.length && <p class="muted">{dir.loading ? 'Loading teams…' : 'Teams couldn’t be loaded. Check the internet connection.'}</p>}
          </div>
        </>
      ) : (
        <>
          <div class="row gap"><Button small icon="back" onClick={() => setTeam(null)}>Teams</Button><span class="muted">Choose a player</span></div>
          <div class="team-grid fx-grid" data-group="fx-players" data-hlock>
            {(roster.list ?? []).map((p, i) => (
              <button type="button" class="f team-option" data-autofocus={i === 0 ? '' : undefined} onClick={() => onPick(league, team, p)}>
                <Headshot src={headshotUrl(league, p.id, p.headshot)} name={p.name} size="sm" />
                <span>{p.name} <small class="muted">{p.position}</small></span>
              </button>
            ))}
            {!roster.list && <p class="muted">Loading players…</p>}
            {roster.error && <p class="muted">Couldn’t load the players: {roster.error}</p>}
          </div>
        </>
      )}
    </Modal>
  );
}

/** Choose a prop, type your line and pick over / under. */
function PropForm({ league, team, player, onDone, onClose }: { league: LiveLeague; team: PickedTeam; player?: PickedPlayer; onDone: () => void; onClose: () => void }) {
  const sport = liveLeague(league)!.sport;
  const props = player ? PLAYER_PROPS[sport] : TEAM_PROPS[sport];
  const [prop, setProp] = useState<string | null>(null);
  const [line, setLine] = useState('');
  const def = props.find((p) => p.id === prop);
  const spread = !!def && 'spread' in def && !!def.spread;
  const save = (side: 'over' | 'under') => {
    const n = Number(line.replace(',', '.'));
    if (!line.trim() || !Number.isFinite(n)) {
      toast('Type your line first, e.g. 74.5', 'error');
      return;
    }
    const b: Bet = {
      id: Math.random().toString(36).slice(2, 10), kind: player ? 'player' : 'team', league, prop: prop!, line: n, side,
      teamId: team.id, teamName: team.name, teamLogo: team.logo, athleteId: player?.id, athleteName: player?.name, headshot: player ? headshotUrl(league, player.id, player.headshot) : undefined, createdAt: Date.now(),
    };
    void addBet(b);
    toast(`Tracking: ${betLabel(b, sport)}`, 'success');
    onDone();
  };
  return (
    <Modal title={player ? `${player.name} props` : `${team.name} props`} onClose={onClose} wide class="fx-props">
      {!prop ? (
        <div class="fx-prop-grid" data-group="fx-props">
          {props.map((p, i) => <Button data-autofocus={i === 0 ? '' : undefined} onClick={() => setProp(p.id)}>{p.label}</Button>)}
        </div>
      ) : (
        <form class="form" onSubmit={(e) => { e.preventDefault(); save('over'); }}>
          <p><b>{def!.label}</b> {player ? `· ${player.name}` : `· ${team.name}`}</p>
          <input class="f input big" data-autofocus inputMode="decimal" placeholder={spread ? 'e.g. -3.5' : 'Your line, e.g. 74.5'} value={line} onInput={(e) => setLine((e.target as HTMLInputElement).value)} />
          <div class="row gap modal-actions">
            {spread ? (
              <Button variant="primary" icon="check" onClick={() => save('over')}>Track this spread</Button>
            ) : (
              <>
                <Button variant="primary" icon="chevronRight" onClick={() => save('over')}>Over</Button>
                <Button icon="chevronLeft" onClick={() => save('under')}>Under</Button>
              </>
            )}
            <Button variant="ghost" onClick={() => setProp(null)}>Other prop</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ---------------- Fantasy ----------------

export function FantasyScreen() {
  const live = useLiveSports();
  const [adding, setAdding] = useState(false);
  const total = fantasyTotal();
  return (
    <div class="fx-screen">
      <div class="fx-head card" data-group="fx-head">
        <div class="fx-total"><span class="muted">Today</span><b>{fmt(total)}</b><span class="muted">fantasy pts</span></div>
        <div class="chips compact">
          {(['ppr', 'half', 'standard'] as const).map((s) => <Chip active={live.scoring === s} onClick={() => void setScoring(s)}>{s === 'ppr' ? 'PPR' : s === 'half' ? 'Half PPR' : 'Standard'}</Chip>)}
        </div>
        <Button variant="primary" icon="add" data-autofocus onClick={() => setAdding(true)}>Add player</Button>
      </div>
      <Toggle label="Pop-ups while watching (scoring plays, points, props)" checked={live.notify} onChange={(v) => void setNotify(v)} />
      {!live.roster.length ? (
        <Empty icon="sports" title="Your lineup is empty">
          <p>Add your fantasy players (NFL, NBA, college). LTTV keeps their points live from the game feeds and pops up when they score while you watch.</p>
        </Empty>
      ) : (
        <div class="fx-list" data-group="fx-roster">
          {live.roster.map((p) => <RosterRow p={p} scoring={live.scoring} />)}
        </div>
      )}
      <p class="hint">Stats from ESPN’s live game feeds, checked every 30 seconds during games. Scoring: {live.scoring === 'ppr' ? 'PPR' : live.scoring === 'half' ? 'half PPR' : 'standard'} (NFL), points/rebounds/assists/steals/blocks (NBA).</p>
      {adding && (
        <TeamAndPlayerPicker title="Add a fantasy player" needPlayer onClose={() => setAdding(false)} onPick={(league, team, pl) => {
          const fp: FantasyPlayer = { athleteId: pl!.id, name: pl!.name, league, teamId: team.id, teamName: team.name, teamLogo: team.logo, position: pl!.position, headshot: headshotUrl(league, pl!.id, pl!.headshot) };
          void addFantasyPlayer(fp);
          toast(`${pl!.name} added to your lineup`, 'success');
          setAdding(false);
        }} />
      )}
    </div>
  );
}

function RosterRow({ p, scoring }: { p: FantasyPlayer; scoring: 'ppr' | 'half' | 'standard' }) {
  const g = gameForTeam(p.league, p.teamId);
  const stats = g?.players.get(p.athleteId)?.stats;
  const sport = liveLeague(p.league)!.sport;
  const pts = stats ? fantasyPoints(stats, sport, scoring) : 0;
  const line = stats ? statLine(stats, sport) : '';
  return (
    <div class="fx-row">
      <Headshot src={p.headshot} name={p.name} />
      <div class="fx-row-main">
        <div class="fx-row-name">{p.name} <small class="muted">{p.position} · {p.teamName}</small></div>
        <small class="muted">{g ? `${g.state === 'in' ? 'LIVE · ' : g.state === 'post' ? 'Final · ' : ''}${g.detail}${line ? ` · ${line}` : ''}` : 'No game today'}</small>
      </div>
      <Logo src={p.teamLogo} />
      <b class="fx-pts">{fmt(pts)}</b>
      <Button small icon="close" aria-label={`Remove ${p.name}`} onClick={() => void removeFantasyPlayer(p.athleteId)} />
    </div>
  );
}

function statLine(s: Record<string, number>, sport: 'football' | 'basketball'): string {
  const parts: string[] = [];
  const v = (k: string) => s[k] ?? 0;
  if (sport === 'football') {
    if (v('passAtt')) parts.push(`${v('completions')}/${v('passAtt')}, ${v('passYds')} yds, ${v('passTD')} TD${v('int') ? `, ${v('int')} INT` : ''}`);
    if (v('rushAtt')) parts.push(`${v('rushAtt')} car, ${v('rushYds')} yds${v('rushTD') ? `, ${v('rushTD')} TD` : ''}`);
    if (v('rec') || v('targets')) parts.push(`${v('rec')} rec, ${v('recYds')} yds${v('recTD') ? `, ${v('recTD')} TD` : ''}`);
    if (v('fgAtt') || v('xpAtt')) parts.push(`${v('fgMade')}/${v('fgAtt')} FG, ${v('xpMade')} XP`);
  } else {
    parts.push(`${v('pts')} pts, ${v('reb')} reb, ${v('ast')} ast${v('stl') ? `, ${v('stl')} stl` : ''}${v('blk') ? `, ${v('blk')} blk` : ''}`);
  }
  return parts.join(' · ');
}

// ---------------- Bets ----------------

export function BetsScreen() {
  const live = useLiveSports();
  const [mode, setMode] = useState<null | 'player' | 'team'>(null);
  const [picked, setPicked] = useState<{ league: LiveLeague; team: PickedTeam; player?: PickedPlayer } | null>(null);
  return (
    <div class="fx-screen">
      <div class="fx-head card" data-group="fx-head">
        <div class="fx-total"><span class="muted">Tracking</span><b>{live.bets.length}</b><span class="muted">props</span></div>
        <Button variant="primary" icon="add" data-autofocus onClick={() => setMode('player')}>Add player prop</Button>
        <Button icon="add" onClick={() => setMode('team')}>Add team prop</Button>
        {live.bets.length > 0 && <Button icon="close" onClick={() => void clearSettledBets()}>Clear finished</Button>}
      </div>
      <Toggle label="Pop-ups while watching (progress and when a prop hits)" checked={live.notify} onChange={(v) => void setNotify(v)} />
      {!live.bets.length ? (
        <Empty icon="sports" title="No props yet">
          <p>Pick a player or team, choose any prop (yards, receptions, points, rebounds, game total, spread…), type your line — e.g. over 74.5 receiving yards — and LTTV follows it live and pops up in the corner as it moves and when it hits.</p>
        </Empty>
      ) : (
        <div class="fx-list" data-group="fx-bets">
          {live.bets.map((b) => <BetRow b={b} />)}
        </div>
      )}
      <p class="hint">LTTV only tracks the lines you type in; it doesn’t place bets or show odds. Stats from ESPN’s live game feeds, checked every 30 seconds during games.</p>
      {mode && !picked && (
        <TeamAndPlayerPicker title={mode === 'player' ? 'Player prop' : 'Team prop'} needPlayer={mode === 'player'} onClose={() => setMode(null)} onPick={(league, team, player) => setPicked({ league, team, player })} />
      )}
      {picked && <PropForm league={picked.league} team={picked.team} player={picked.player} onDone={() => { setPicked(null); setMode(null); }} onClose={() => setPicked(null)} />}
    </div>
  );
}

function BetRow({ b }: { b: Bet }) {
  const sport = liveLeague(b.league)!.sport;
  const g = gameForTeam(b.league, b.teamId);
  const { value, status } = betStatus(b);
  const isSpread = b.kind === 'team' && b.prop === 'spread';
  const pct = isSpread ? (value + b.line > 0 ? 100 : 30) : Math.max(0, Math.min(100, (value / Math.max(0.5, b.line)) * 100));
  return (
    <div class={`fx-row bet-${status}`}>
      {b.headshot ? <Headshot src={b.headshot} name={b.athleteName ?? b.teamName} /> : <Logo src={b.teamLogo} />}
      <div class="fx-row-main">
        <div class="fx-row-name">{betLabel(b, sport)}</div>
        <div class="fx-progress"><div style={{ width: `${pct}%` }} /></div>
        <small class="muted">{g ? `${g.state === 'in' ? 'LIVE · ' : g.state === 'post' ? 'Final · ' : ''}${g.detail}` : 'Waiting for the game'}</small>
      </div>
      <b class="fx-pts">{isSpread ? `${value > 0 ? '+' : ''}${fmt(value)}` : `${fmt(value)} / ${b.line}`}</b>
      <span class={`bet-badge bet-badge-${status}`}>{status === 'hit' ? 'HIT' : status === 'lost' ? 'LOST' : status === 'push' ? 'PUSH' : status === 'live' ? 'LIVE' : 'PRE'}</span>
      <Button small icon="close" aria-label="Stop tracking" onClick={() => void removeBet(b.id)} />
    </div>
  );
}

// ---------------- pop-ups ----------------

/** Bottom-corner notices for fantasy scoring and prop progress (shown anywhere, also full screen). */
export function LiveNotices() {
  const [items, setItems] = useState<(LiveNotice & { at: number })[]>([]);
  useEffect(() => onLiveNotice((n) => setItems((list) => [...list.slice(-2), { ...n, at: Date.now() }])), []);
  useEffect(() => {
    if (!items.length) return;
    const t = setTimeout(() => setItems((list) => list.filter((x) => Date.now() - x.at < 9000)), 1000);
    return () => clearTimeout(t);
  }, [items]);
  if (!items.length) return null;
  return (
    <div class="live-notices" aria-live="polite">
      {items.map((n) => (
        <div class={`live-notice tone-${n.tone ?? 'info'}`} key={n.key}>
          <div class="live-notice-art">
            {n.headshot ? <Headshot src={n.headshot} name={n.title} size="lg" /> : null}
            {n.logo ? <img class="live-notice-logo" src={n.logo} alt="" /> : null}
          </div>
          <div class="live-notice-text">
            <b>{n.title}</b>
            <small>{n.detail}</small>
            {n.play && <span class="live-notice-play">{n.play}</span>}
          </div>
          <Icon name={n.kind === 'bet' ? 'check' : 'star'} class="live-notice-icon" />
        </div>
      ))}
    </div>
  );
}

