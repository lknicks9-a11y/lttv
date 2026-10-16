import { ChannelName } from './ChannelName';
import { h, Fragment } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useState } from 'preact/hooks';
import { onBack, focusFirst } from '../app/nav';
import { useApp, tune, updateSettings, toggleReminder, setState, navigate } from '../app/state';
import { allTeams, LEAGUES, leagueOf, teamColor, type LeagueId, type Team } from '../core/teams';
import { buildMatchers, findTeamListings, teamChannels, type TeamListing } from '../core/sports';
import { isUsableMatch } from '../core/match';
import type { LineupChannel } from '../core/types';
import { Button, Chip, ChannelLogo, Empty, Icon, Modal, Progress, Toggle } from './common';
import { clock, when, range, progress, remaining } from './fmt';
import { LeagueGames, TeamLogo } from './Games';
import { BetsScreen, FantasyScreen } from './Fantasy';
import { logoFor, leagueLogo, useLeagueSummaries, useLeagueTeams } from '../app/schedule';
import { SCHEDULE_LEAGUES, proTeamLogo, scheduleDay, scheduleLeague, type ScheduleLeagueId } from '../core/schedule';

export function TeamBadge({ team, size = 'md' }: { team: Team; size?: 'sm' | 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  const logo = logoFor(team.name) ?? team.logo ?? proTeamLogo(team.league, team.abbr);
  if (logo && !failed) return <img class={`team-logo team-logo-${size}`} src={logo} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  return (
    <span class={`team-badge team-badge-${size}`} style={{ background: teamColor(team.id) }} aria-hidden="true">
      {team.abbr}
    </span>
  );
}

/** The user's favorite teams as Team objects (catalog + custom). */
export function useFavoriteTeams(): Team[] {
  const ids = useApp((s) => s.settings.favoriteTeams);
  const custom = useApp((s) => s.settings.customTeams);
  return useMemo(() => {
    const all = allTeams(custom);
    return ids.map((id) => all.find((t) => t.id === id)).filter((t): t is Team => !!t);
  }, [ids, custom]);
}

/** Games and shows for the given teams found in the user's guide (recomputed at most once a minute). */
export function useTeamListings(teams: Team[], opts: { includeShows?: boolean; horizonDays?: number } = {}): TeamListing[] {
  const lineup = useApp((s) => s.lineup);
  const guide = useApp((s) => s.guide);
  const guideVersion = useApp((s) => s.guideVersion);
  const minute = useApp((s) => Math.floor(s.now / 60000));
  const custom = useApp((s) => s.settings.customTeams);
  return useMemo(() => {
    if (!teams.length) return [];
    const matchers = buildMatchers(teams, allTeams(custom));
    return findTeamListings(matchers, lineup, guide, { now: Date.now(), horizon: (opts.horizonDays ?? 7) * 86400_000, includeShows: opts.includeShows });
  }, [teams, lineup, guide, guideVersion, minute, custom, opts.includeShows, opts.horizonDays]);
}

function channelLabel(chs: LineupChannel[]) {
  const first = chs[0];
  return `${first.number} ${first.name}${chs.length > 1 ? ` +${chs.length - 1} more` : ''}`;
}

function ListingRow({ l, now }: { l: TeamListing; now: number }) {
  const reminders = useApp((s) => s.reminders);
  const p = l.programme;
  const ch = l.channels[0];
  const rKey = `${ch.key}|${p.start}`;
  const reminded = reminders.some((r) => r.key === rKey);
  const live = p.start <= now && p.stop > now;
  return (
    <div class={`listing ${live ? 'is-live' : ''}`}>
      <div class="listing-when">
        {live ? <span class="badge-live">LIVE</span> : <span>{when(p.start, now)}</span>}
        {l.kind === 'game' && <small class="muted">Game</small>}
      </div>
      <div class="listing-main">
        <div class="listing-title">{p.title}{p.subTitle ? <span class="muted"> · {p.subTitle}</span> : null}</div>
        <div class="listing-meta">
          {l.teams.map((t) => <TeamBadge team={t} size="sm" />)}
          <span class="muted">{range(p)}</span>
          {live && <Progress value={progress(p, now)} />}
          {live && <span class="muted">{remaining(p, now)}</span>}
        </div>
      </div>
      <div class="listing-ch">
        <ChannelLogo ch={ch} src={ch.logo} name={ch.name} size="sm" />
        <span>{channelLabel(l.channels)}</span>
      </div>
      <div class="listing-actions">
        {live ? (
          <Button small variant="primary" icon="play" onClick={() => void tune(ch.key, { fullscreen: true })}>Watch</Button>
        ) : (
          <Button small icon="bell" onClick={() => void toggleReminder({ key: rKey, channelKey: ch.key, title: p.title + (p.subTitle ? ` · ${p.subTitle}` : ''), start: p.start, stop: p.stop })}>
            {reminded ? 'Reminder on' : 'Remind me'}
          </Button>
        )}
        <Button small variant="ghost" icon="info" aria-label="Details" onClick={() => setState({ detail: { channelKey: ch.key, programme: p } })} />
      </div>
    </div>
  );
}

export type SportsView = 'home' | 'teams' | 'fantasy' | 'bets' | ScheduleLeagueId;

/** Sports: pick a league (or My Teams), then today's games, then the streams for a game. */
export function SportsScreen() {
  const [view, setViewState] = useState<SportsView>(() => {
    try {
      return (sessionStorage.getItem('sportsView') as SportsView) || 'home';
    } catch {
      return 'home';
    }
  });
  const setView = (v: SportsView) => {
    setViewState(v);
    try {
      sessionStorage.setItem('sportsView', v);
    } catch {
      /* ignore */
    }
  };
  // Back goes up a level (league -> league picker) before leaving Sports.
  useEffect(() => {
    if (view === 'home') return;
    return onBack(() => {
      setView('home');
      return true;
    });
  }, [view]);
  useLayoutEffect(() => {
    requestAnimationFrame(() => focusFirst(document.querySelector<HTMLElement>('[data-group="content"]')));
  }, [view]);

  if (view === 'home') return <LeaguePicker onPick={setView} />;
  const league = view === 'teams' || view === 'fantasy' || view === 'bets' ? undefined : scheduleLeague(view);
  return (
    <section class="screen sports">
      <div class="row gap sports-crumbs" data-group="sports-crumbs">
        <Button small icon="back" onClick={() => setView('home')}>Sports</Button>
        {league && leagueLogo(league.id) && <img class="league-logo-sm" src={leagueLogo(league.id)} alt="" />}
        <h1>{league ? league.name : view === 'fantasy' ? 'Fantasy' : view === 'bets' ? 'Bets · prop tracker' : 'My Teams'}</h1>
      </div>
      {view === 'teams' ? <MyTeams /> : view === 'fantasy' ? <FantasyScreen /> : view === 'bets' ? <BetsScreen /> : <LeagueGames key={view} leagueId={view as ScheduleLeagueId} />}
    </section>
  );
}

function LeaguePicker({ onPick }: { onPick: (v: SportsView) => void }) {
  return (
    <section class="screen sports">
      <header class="screen-head">
        <div>
          <h1>Sports</h1>
          <p class="muted">Choose a league to see today’s games and the best channels for each one in your lineup.</p>
        </div>
      </header>
      <LeagueGrid onPick={onPick} />
    </section>
  );
}

/** League cards with today's game count and live badge (My Teams first unless left out). */
export function LeagueGrid({ onPick, teams: withTeams = true }: { onPick: (v: SportsView) => void; teams?: boolean }) {
  const tz = useApp((s) => s.settings.timeZone);
  const now = useApp((s) => s.now);
  const teams = useFavoriteTeams();
  const sums = useLeagueSummaries(scheduleDay(now, tz));
  return (
    <div class="league-grid" data-group="leagues">
      {withTeams && (
        <button type="button" class="f league-card league-card-special" onClick={() => onPick('fantasy')}>
          <Icon name="star" size="3rem" class="league-card-icon" />
          <span class="league-card-name">Fantasy</span>
          <small class="muted">Your lineup, live points and scoring pop-ups</small>
        </button>
      )}
      {withTeams && (
        <button type="button" class="f league-card league-card-special" onClick={() => onPick('bets')}>
          <Icon name="check" size="3rem" class="league-card-icon" />
          <span class="league-card-name">Bets</span>
          <small class="muted">Track player and team props against your lines</small>
        </button>
      )}
      {withTeams && (
        <button type="button" class="f league-card" data-autofocus onClick={() => onPick('teams')}>
          <Icon name="star" size="3rem" class="league-card-icon" />
          <span class="league-card-name">My Teams</span>
          <small class="muted">{teams.length ? `${teams.length} team${teams.length === 1 ? '' : 's'}` : 'Choose your teams'}</small>
        </button>
      )}
      {SCHEDULE_LEAGUES.map((l, i) => {
        const s = sums[l.id];
        const logo = leagueLogo(l.id);
        return (
          <button type="button" class={`f league-card ${s?.live ? 'live' : ''}`} data-autofocus={!withTeams && i === 0 ? '' : undefined} onClick={() => onPick(l.id)}>
            {logo ? <img class="league-logo" src={logo} alt="" onError={(e) => ((e.target as HTMLElement).style.visibility = 'hidden')} /> : l.tab !== l.name ? <span class="league-logo league-logo-text">{l.tab}</span> : <Icon name="sports" size="4rem" class="league-card-icon" />}
            <span class="league-card-name">{l.name}</span>
            <small class="muted">
              {s?.loading ? 'Loading…' : s?.error ? 'Schedule unavailable' : s?.games ? `${s.games} game${s.games === 1 ? '' : 's'} today` : 'No games today'}
              {s?.live ? <span class="badge-live"> {s.live} LIVE</span> : null}
            </small>
          </button>
        );
      })}
    </div>
  );
}

function MyTeams() {
  const teams = useFavoriteTeams();
  const lineup = useApp((s) => s.lineup);
  const guide = useApp((s) => s.guide);
  useApp((s) => s.guideVersion);
  const matches = useApp((s) => s.matches);
  const now = useApp((s) => s.now);
  const custom = useApp((s) => s.settings.customTeams);
  const [picker, setPicker] = useState(false);
  const [focusTeam, setFocusTeam] = useState<string>('all');
  const [gamesOnly, setGamesOnly] = useState(false);

  const listings = useTeamListings(teams, { includeShows: true });
  const shown = listings.filter((l) => (focusTeam === 'all' || l.teams.some((t) => t.id === focusTeam)) && (!gamesOnly || l.kind === 'game'));

  const teamChans = useMemo(() => {
    const ms = buildMatchers(teams, allTeams(custom));
    return ms.map((m) => ({ team: m.team, channels: teamChannels(m, lineup) }));
  }, [teams, lineup, custom]);

  const liveSports = useMemo(() => lineup
    .filter((c) => !c.hidden && c.category === 'sports')
    .map((c) => ({ c, p: isUsableMatch(matches.get(c.key)) ? guide.current(c.epgChannelId, now) : undefined }))
    .filter((x) => x.p)
    .slice(0, 24), [lineup, guide, matches, Math.floor(now / 60000)]);

  return (
    <>
      <header class="screen-head">
        <div>
          <p class="muted">Games for your teams found in your own program guide, and the channels in your lineup that carry them.</p>
        </div>
        <div class="row gap" data-group="sports-head">
          <Button variant="primary" icon="star" data-autofocus onClick={() => setPicker(true)}>{teams.length ? 'Edit my teams' : 'Choose my teams'}</Button>
        </div>
      </header>

      {!teams.length ? (
        <div class="card sports-empty">
          <Empty icon="sports" title="Follow your teams">
            <p>Pick teams from the NFL, NBA, WNBA, MLB, NHL, MLS, Premier League and more — or add any team by name. LTTV then shows when they play and on which of your channels.</p>
            <Button variant="primary" icon="add" onClick={() => setPicker(true)}>Choose teams</Button>
          </Empty>
        </div>
      ) : (
        <>
          <div class="team-cards" data-group="team-cards">
            {teams.map((t) => {
              const mine = listings.filter((l) => l.teams.some((x) => x.id === t.id));
              const liveGame = mine.find((l) => l.live && l.kind === 'game') ?? mine.find((l) => l.live);
              const next = mine.find((l) => !l.live && l.kind === 'game') ?? mine.find((l) => !l.live);
              const chans = teamChans.find((x) => x.team.id === t.id)?.channels ?? [];
              return (
                <button
                  type="button"
                  class={`f team-card ${focusTeam === t.id ? 'selected' : ''} ${liveGame ? 'live' : ''}`}
                  onClick={() => {
                    if (liveGame) void tune(liveGame.channels[0].key, { fullscreen: true });
                    else setFocusTeam(focusTeam === t.id ? 'all' : t.id);
                  }}
                >
                  <TeamBadge team={t} size="lg" />
                  <span class="team-card-body">
                    <span class="team-card-name">{t.name}</span>
                    <small class="muted">{leagueOf(t.league).name}{chans.length ? ` · ${chans.length} team channel${chans.length > 1 ? 's' : ''}` : ''}</small>
                    {liveGame ? (
                      <span class="team-card-status live"><span class="badge-live">LIVE</span> {liveGame.programme.subTitle || liveGame.programme.title} · ch {liveGame.channels[0].number}</span>
                    ) : next ? (
                      <span class="team-card-status">Next: {when(next.programme.start, now)} · ch {next.channels[0].number}</span>
                    ) : (
                      <span class="team-card-status muted">Nothing in your guide yet</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div class="row gap wrap" data-group="sports-filters">
            <div class="chips compact">
              <Chip active={focusTeam === 'all'} onClick={() => setFocusTeam('all')}>All my teams</Chip>
              {teams.map((t) => <Chip active={focusTeam === t.id} onClick={() => setFocusTeam(t.id)}>{t.short}</Chip>)}
            </div>
            <div class="sports-toggle"><Toggle label="Games only" checked={gamesOnly} onChange={setGamesOnly} /></div>
          </div>

          <h2 class="section-title">Live &amp; upcoming <span class="muted">({shown.length})</span></h2>
          {shown.length ? (
            <div class="listings" data-group="listings">
              {shown.slice(0, 80).map((l) => <ListingRow l={l} now={now} />)}
            </div>
          ) : (
            <p class="muted">
              No listings for {focusTeam === 'all' ? 'your teams' : teams.find((t) => t.id === focusTeam)?.name} in the next 7 days of your guide.
              {' '}Games only appear if your XMLTV guide lists them on channels that are matched to it.
            </p>
          )}

          {teamChans.some((x) => x.channels.length) && (
            <>
              <h2 class="section-title">Team channels in your lineup</h2>
              <div class="mini-channels" data-group="team-channels">
                {teamChans.flatMap((x) => x.channels.map((c) => (
                  <button type="button" class="f mini-channel" onClick={() => void tune(c.key)}>
                    <TeamBadge team={x.team} size="sm" />
                    <ChannelLogo ch={c} src={c.logo} name={c.name} size="sm" />
                    <span>{c.number} <ChannelName ch={c} /></span>
                  </button>
                )))}
              </div>
            </>
          )}
        </>
      )}

      <h2 class="section-title">On sports channels now</h2>
      {liveSports.length ? (
        <div class="mini-channels" data-group="live-sports">
          {liveSports.map(({ c, p }) => (
            <button type="button" class="f mini-channel wide" onClick={() => void tune(c.key)}>
              <ChannelLogo ch={c} src={c.logo} name={c.name} size="sm" />
              <span class="mini-channel-text">
                <span>{c.number} {c.name}</span>
                <small class="muted">{p!.title}</small>
                <Progress value={progress(p!, now)} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p class="muted">No guide data for channels in the Sports category right now. <a class="f link" href="#" onClick={(e) => { e.preventDefault(); navigate('channels'); }}>Organize channels</a></p>
      )}

      {picker && <TeamPicker onClose={() => setPicker(false)} />}
    </>
  );
}

/** Leagues offered in the team picker (all with ESPN's full team list and logos), then custom teams. */
const PICKER_LEAGUES: LeagueId[] = ['nfl', 'nba', 'wnba', 'mlb', 'nhl', 'mls', 'epl', 'bundesliga', 'seriea', 'ligue1', 'laliga', 'ucl', 'cbb', 'cfb', 'custom'];
const fold = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function TeamPicker({ onClose }: { onClose: () => void }) {
  const fav = useApp((s) => s.settings.favoriteTeams);
  const custom = useApp((s) => s.settings.customTeams);
  const banner = useApp((s) => s.settings.sportsBanner);
  const [league, setLeague] = useState<LeagueId>('nfl');
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState('');
  const [q, setQ] = useState('');
  const dir = useLeagueTeams(league === 'custom' ? '' : league);
  const all = allTeams(custom);
  // ESPN's full list (with logos) when it loads; the built-in list otherwise. Built-in ids are kept so saved favorites still match.
  const teams: Team[] = useMemo(() => {
    if (league === 'custom') return all.filter((t) => t.league === 'custom');
    const builtIn = all.filter((t) => t.league === league || (league === 'ucl' && t.league === 'eur'));
    if (!dir.teams?.length) return builtIn;
    return dir.teams.map((d) => {
      const known = builtIn.find((t) => fold(t.name) === fold(d.name) || (!!d.abbr && t.abbr === d.abbr && fold(t.short) === fold(d.short)))
        ?? all.find((t) => t.id === `espn:${league}:${d.espnId}`);
      return known ? { ...known, logo: d.logo } : { id: `espn:${league}:${d.espnId}`, league, name: d.name, short: d.short, abbr: d.abbr || d.short.slice(0, 3).toUpperCase(), logo: d.logo };
    });
  }, [league, dir.teams, custom]);
  const shown = q.trim() ? teams.filter((t) => fold(`${t.name} ${t.abbr}`).includes(fold(q))) : teams;
  const toggle = (t: Team) => {
    const on = fav.includes(t.id);
    const favoriteTeams = on ? fav.filter((x) => x !== t.id) : [...fav, t.id];
    // Teams from ESPN's list aren't built in: keep their details so the sports screen can find their games.
    const customTeams = t.id.startsWith('espn:')
      ? on ? custom.filter((c) => c.id !== t.id) : [...custom.filter((c) => c.id !== t.id), { id: t.id, name: t.name, aliases: [], league: t.league, short: t.short, abbr: t.abbr, logo: t.logo }]
      : custom;
    void updateSettings({ favoriteTeams, customTeams });
  };
  const addCustom = () => {
    const n = name.trim();
    if (n.length < 2) return;
    const id = 'custom:' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const aliases = keywords.split(',').map((k) => k.trim()).filter((k) => k.length >= 2);
    void updateSettings({
      customTeams: [...custom.filter((c) => c.id !== id), { id, name: n, aliases }],
      favoriteTeams: fav.includes(id) ? fav : [...fav, id],
    });
    setName('');
    setKeywords('');
  };
  return (
    <Modal title="My teams" onClose={onClose} wide class="team-picker">
      <div class="chips compact" data-group="leagues">
        {PICKER_LEAGUES.map((id) => {
          const l = leagueOf(id);
          const n = all.filter((t) => (t.league === id || (id === 'ucl' && t.league === 'eur')) && fav.includes(t.id)).length;
          const sl = scheduleLeague(id as ScheduleLeagueId);
          return (
            <Chip active={league === id} onClick={() => { setLeague(id); setQ(''); }} count={n || undefined}>
              {sl && leagueLogo(sl.id) ? <img class="chip-logo" src={leagueLogo(sl.id)} alt="" onError={(e) => ((e.target as HTMLElement).style.display = 'none')} /> : null}
              {l.name}
            </Chip>
          );
        })}
      </div>
      {league === 'custom' ? (
        <form class="custom-team" onSubmit={(e) => { e.preventDefault(); addCustom(); }}>
          <input class="f input" placeholder="Team name, e.g. Ohio State Buckeyes" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <input class="f input" placeholder="Other names, comma separated (optional), e.g. Ohio State, Buckeyes" value={keywords} onInput={(e) => setKeywords((e.target as HTMLInputElement).value)} />
          <Button icon="add" onClick={addCustom}>Add team</Button>
        </form>
      ) : (
        teams.length > 40 && <input class="f input" type="search" placeholder={`Search ${leagueOf(league).name} teams`} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      )}
      <div class="team-grid" data-group="team-grid" data-hlock>
        {shown.map((t, i) => {
          const on = fav.includes(t.id);
          return (
            <button type="button" class={`f team-option ${on ? 'on' : ''}`} aria-pressed={on} data-autofocus={i === 0 ? '' : undefined} onClick={() => toggle(t)}>
              <TeamBadge team={t} size="sm" />
              <span>{t.name}</span>
              {on && <Icon name="check" class="team-check" />}
            </button>
          );
        })}
        {!shown.length && (league === 'custom' ? <p class="muted">No custom teams yet. Add college, international or local teams above.</p> : <p class="muted">{dir.loading ? 'Loading teams…' : 'No teams found.'}</p>)}
      </div>
      <Toggle label="Show a banner on Live TV when my team is playing" checked={banner} onChange={(v) => void updateSettings({ sportsBanner: v })} />
      <div class="row gap modal-actions">
        <Button variant="primary" icon="check" onClick={onClose}>Done ({fav.length} team{fav.length === 1 ? '' : 's'})</Button>
      </div>
    </Modal>
  );
}

/** Banner on the Live TV screen when a favorite team is playing right now. */
export function LiveTeamBanner() {
  const teams = useFavoriteTeams();
  const enabled = useApp((s) => s.settings.sportsBanner);
  const listings = useTeamListings(enabled ? teams : [], { includeShows: false, horizonDays: 0.01 });
  const live = listings.find((l) => l.live);
  if (!live) return null;
  const ch = live.channels[0];
  return (
    <button type="button" class="f live-banner" onClick={() => void tune(ch.key, { fullscreen: true })}>
      <span class="badge-live">LIVE</span>
      {live.teams.slice(0, 2).map((t) => <TeamBadge team={t} size="sm" />)}
      <span class="live-banner-title">{live.programme.subTitle || live.programme.title}</span>
      <span class="muted">on {ch.number} {ch.name}</span>
      <span class="live-banner-cta"><Icon name="play" size="1em" /> Watch</span>
    </button>
  );
}

/** Prompt shown when a reminder's programme starts. */
export function ReminderPrompt() {
  const due = useApp((s) => s.reminderDue);
  const ch = useApp((s) => s.lineup.find((c) => c.key === s.reminderDue?.channelKey));
  if (!due || !ch) return null;
  const close = () => setState({ reminderDue: undefined });
  return (
    <Modal title="Starting now" onClose={close}>
      <p class="reminder-title">{due.title}</p>
      <p class="muted">{clock(due.start)} on {ch.number} {ch.name}</p>
      <div class="row gap modal-actions">
        <Button variant="primary" icon="play" data-autofocus onClick={() => { close(); void tune(ch.key, { fullscreen: true }); }}>Watch now</Button>
        <Button variant="ghost" onClick={close}>Dismiss</Button>
      </div>
    </Modal>
  );
}
