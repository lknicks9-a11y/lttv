// Sports → Regional networks: every MLB / NBA / NHL / WNBA team, the local-TV channel found for it in the lineup, and
// whether that channel is sending video (checked on request, one at a time, gently — a provider that refuses stops it).
import { h, Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp, tune } from '../app/state';
import { canCheck, cachedLiveness, checkStream } from '../app/streamcheck';
import type { Liveness } from '../core/liveness';
import { RSN_LEAGUES, TEAM_RSN, rsnChannels } from '../core/rsn';
import { allTeams } from '../core/teams';
import { proTeamLogo } from '../core/schedule';
import { Button, Chip, Icon } from './common';
import { ChannelName } from './ChannelName';

type League = (typeof RSN_LEAGUES)[number];
const LABEL: Record<League, string> = { mlb: 'MLB', nba: 'NBA', nhl: 'NHL', wnba: 'WNBA' };

export function RsnScreen() {
  const lineup = useApp((s) => s.lineup);
  const [league, setLeague] = useState<League>('nba');
  const [status, setStatus] = useState<Map<string, Liveness>>(() => new Map());
  const [checking, setChecking] = useState<{ done: number; total: number; current?: string; stopped?: string } | null>(null);
  const stop = useRef(false);

  const rows = useMemo(
    () => allTeams()
      .filter((t) => t.league === league)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({ team: t, networks: TEAM_RSN[t.id] ?? [], found: rsnChannels(t.id, lineup) })),
    [league, lineup],
  );
  const foundCount = rows.filter((r) => r.found.length).length;

  // Results already known (this session) show straight away.
  useEffect(() => {
    const m = new Map<string, Liveness>();
    for (const r of rows) for (const f of r.found) {
      const v = cachedLiveness(f.ch.key);
      if (v) m.set(f.ch.key, v);
    }
    setStatus(m);
  }, [rows]);
  useEffect(() => () => void (stop.current = true), []);

  const checkAll = async () => {
    stop.current = false;
    // Each team's best channel once (teams sharing a network share the check).
    const chans = [...new Map(rows.flatMap((r) => (r.found[0] ? [[r.found[0].ch.key, r.found[0].ch] as const] : []))).values()];
    setChecking({ done: 0, total: chans.length });
    for (let i = 0; i < chans.length; i++) {
      if (stop.current) return;
      const ch = chans[i];
      if (!canCheck(ch)) {
        setChecking({ done: i, total: chans.length, stopped: 'Stopped: your provider refused a check or its streams are in use — try again later.' });
        return;
      }
      setChecking({ done: i, total: chans.length, current: ch.key });
      const v = await checkStream(ch);
      if (v) setStatus((m) => new Map(m).set(ch.key, v));
      // A short pause between checks: many quick connections can get a login blocked for a while.
      await new Promise((r) => setTimeout(r, 1500));
    }
    setChecking({ done: chans.length, total: chans.length });
  };

  return (
    <div class="rsn">
      <div class="row gap wrap rsn-head" data-group="rsn-head">
        <div class="chips compact" role="tablist">
          {RSN_LEAGUES.map((l) => <Chip active={league === l} onClick={() => { stop.current = true; setChecking(null); setLeague(l); }}>{LABEL[l]}</Chip>)}
        </div>
        <span class="muted">{foundCount} of {rows.length} teams found in your playlist</span>
        {checking && checking.done < checking.total && !checking.stopped
          ? <Button icon="close" onClick={() => { stop.current = true; setChecking(null); }}>Stop ({checking.done}/{checking.total})</Button>
          : <Button variant="primary" icon="refresh" onClick={() => void checkAll()}>Check all {LABEL[league]}</Button>}
      </div>
      {checking?.stopped && <p class="error-text">{checking.stopped}</p>}
      <div class="rsn-list" data-group="rsn-list">
        {rows.map(({ team, networks, found }) => {
          const best = found[0];
          const st = best ? status.get(best.ch.key) : undefined;
          return (
            <div class="rsn-row" key={team.id}>
              <img class="rsn-logo" src={proTeamLogo(team.league, team.abbr) ?? ''} alt="" onError={(e) => ((e.target as HTMLElement).style.visibility = 'hidden')} />
              <span class="rsn-team">
                <b>{team.name}</b>
                <small class="muted">{networks.slice(0, 2).join(' / ')}</small>
              </span>
              <span class="rsn-ch">
                {best ? <><span class="ch-num">{best.ch.number}</span> <ChannelName ch={best.ch} />{found.length > 1 && <small class="muted"> +{found.length - 1} more</small>}</> : <span class="muted">Not in your playlist</span>}
              </span>
              <span class={`rsn-status ${st ?? ''}`}>
                {!best ? '' : checking?.current === best.ch.key ? 'Checking…' : st === 'live' ? <><Icon name="check" size="1em" /> Working</> : st === 'dead' ? 'Not sending video' : ''}
              </span>
              {best ? <Button small icon="play" onClick={() => void tune(best.ch.key, { fullscreen: true })}>Watch</Button> : <span />}
            </div>
          );
        })}
      </div>
      <p class="hint">In a game’s stream list, the teams’ regional networks always come first: ESPN’s local listing for that game, or this list when ESPN has none (not for national-only games like NBA on ESPN). Networks change; if a team’s channel is wrong or missing here, tell me the channel name in your playlist.</p>
    </div>
  );
}
