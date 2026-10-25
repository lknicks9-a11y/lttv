// Sports Multiview screen: a 2×2 grid of games. Empty tiles add a game (league → game → stream);
// OK on a tile gives it the sound, OK again (or Menu) opens its options; Back goes full screen on the game with sound.
import { h, Fragment } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { toast, useApp } from '../app/state';
import { native } from '../app/platform';
import { focusFirst, onAppKey, onBack } from '../app/nav';
import { closeMultiview, connectionLimit, loadMix, isLimitError, providerUsage, decoderLimit, noteDecoderLimit, resetDecoderLimit, restartTile, setActiveTile, setLayout, setTile, tilePlayer, type MvLayout, type MvTile } from '../app/multiview';
import type { PlayerController, PlayerStatus } from '../app/player';
import type { ScheduleLeagueId } from '../core/schedule';
import { Button, Icon, Modal } from './common';
import { LeagueGrid } from './Sports';
import { LeagueGames } from './Games';
import { channelMixes, deleteMix, gameMixes, myMixes, saveMix, type Mix } from '../app/mixes';

function TileVideo({ ctl }: { ctl: PlayerController }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => ctl.registerSlot(ref.current!, 50), [ctl]);
  return <div class="video-slot mv-video" ref={ref} />;
}

function useTileStatus(ctl: PlayerController): PlayerStatus {
  const [s, set] = useState(ctl.status);
  useEffect(() => ctl.subscribe(set), [ctl]);
  return s;
}

let soundTimer = 0;

function Tile({ i, tile, active, onAdd, onOptions }: { i: number; tile: MvTile | null; active: boolean; onAdd: () => void; onOptions: () => void }) {
  const ctl = tilePlayer(i);
  const st = useTileStatus(ctl);
  // Refused a hardware video decoder: learn how many games this TV can play at once.
  useEffect(() => {
    if (st.state === 'error' && /no free video decoder|needed this game's video decoder/i.test(st.error ?? '')) {
      const n = noteDecoderLimit();
      toast(`This TV can play ${n} game${n === 1 ? '' : 's'} at once in Dual view (it has ${n === 1 ? 'one video decoder' : `${n} video decoders`} free).`, 'info', 9000);
    }
  }, [st.state, st.error]);
  // The name shows for a few seconds after the tile changes or is selected, then gets out of the way.
  const [label, setLabel] = useState(true);
  const timer = useRef<number>();
  const showLabel = () => {
    setLabel(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLabel(false), 15000);
  };
  useEffect(() => {
    showLabel();
    return () => window.clearTimeout(timer.current);
  }, [tile?.key]);
  if (!tile) {
    return (
      <button type="button" class="f mv-tile mv-empty" onClick={onAdd} data-autofocus={i === 0 ? '' : undefined}>
        <Icon name="add" size="3rem" />
        <span>Add a game</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      class={`f mv-tile ${active ? 'mv-active' : ''}`}
      onFocus={() => {
        showLabel();
        // Sound follows the highlighted game (after a short pause, so moving across tiles doesn't blip audio).
        window.clearTimeout(soundTimer);
        soundTimer = window.setTimeout(() => setActiveTile(i), 250);
      }}
      onClick={() => {
        showLabel();
        if (st.state === 'error') restartTile(i);
        else onOptions();
      }}
      aria-label={`${tile.title}${active ? ', sound on' : ''}`}
    >
      <TileVideo ctl={ctl} />
      {(st.state === 'loading' || st.state === 'buffering' || st.state === 'retrying') && <span class="spinner mv-spinner" />}
      {st.state === 'error' && <TileError error={st.error} channelKey={tile.key} />}
      {label && (
        <span class="mv-label">
          {active && <Icon name="volume" size="1.1em" />}
          <b>{tile.title}</b>
          {tile.sub && <small>{tile.sub}</small>}
        </span>
      )}
    </button>
  );
}

/**
 * Why a game didn't play. When it could be the provider's limit (an "access denied" or a limit answer), LTTV asks
 * the provider how many streams the plan allows and how many it counts as in use, and says so plainly.
 */
function TileError({ error, channelKey }: { error?: string; channelKey: string }) {
  const maybeLimit = isLimitError(error) || /\b(401|403)\b/.test(error ?? '');
  const [usage, setUsage] = useState<{ max?: number; active?: number } | null | undefined>(undefined);
  useEffect(() => {
    if (!maybeLimit) return;
    let alive = true;
    void providerUsage(channelKey).then((u) => alive && setUsage(u));
    return () => {
      alive = false;
    };
  }, [error, channelKey]);
  const full = usage?.max !== undefined && usage.active !== undefined && usage.active >= usage.max;
  let text: string;
  if (full) text = `Your provider allows ${usage!.max} stream${usage!.max === 1 ? '' : 's'} at once and says ${usage!.active} ${usage!.active === 1 ? 'is' : 'are'} in use right now (every device on your login counts). Remove a game or stop another device, then press OK.`;
  else if (isLimitError(error)) text = `Your provider turned this stream away (too many at once${usage?.max ? ` — your plan allows ${usage.max}` : ''}). Remove a game, or press OK to try again.`;
  else text = `${error ?? 'This stream didn’t start.'}${usage?.max ? ` (Your plan allows ${usage.max} streams; ${usage.active ?? '?'} in use.)` : ''} Press OK to try again.`;
  return <span class="mv-error">{text}</span>;
}

/** Pick a game: league, then the league's games and their streams (the same screens as Sports). */
function GamePicker({ onPick, onClose }: { onPick: (t: MvTile) => void; onClose: () => void }) {
  const [league, setLeague] = useState<ScheduleLeagueId | null>(null);
  useEffect(() => {
    if (!league) return;
    return onBack(() => {
      setLeague(null);
      return true;
    });
  }, [league]);
  return (
    <Modal title={league ? 'Choose a game and stream' : 'Add a game'} onClose={onClose} wide class="mv-picker">
      {!league ? (
        <LeagueGrid teams={false} onPick={(v) => typeof v === 'string' && v !== 'home' && v !== 'teams' && v !== 'fantasy' && v !== 'bets' && setLeague(v as ScheduleLeagueId)} />
      ) : (
        <>
          <div class="row gap"><Button small icon="back" onClick={() => setLeague(null)}>Leagues</Button></div>
          <LeagueGames leagueId={league} onPick={(key, game) => onPick({ key, title: `${game.away.short} at ${game.home.short}`, sub: game.state === 'in' ? 'Live' : undefined })} />
        </>
      )}
    </Modal>
  );
}

function MixCard({ m, onPick, onDelete }: { m: Mix; onPick: (m: Mix) => void; onDelete?: () => void }) {
  return (
    <button type="button" class="f mix-card" onClick={() => onPick(m)} onKeyDown={(e) => { if (onDelete && (e.key === 'Delete' || e.key === 'ContextMenu')) { e.preventDefault(); onDelete(); } }}>
      <span class="mix-tiles" aria-hidden="true">
        {Array.from({ length: 2 }, (_, i) => <span class={`mix-tile ${m.tiles[i] ? '' : 'empty'}`}>{m.tiles[i]?.title ?? ''}</span>)}
      </span>
      <b class="mix-name">{m.name}</b>
      {m.sub && <small class="muted mix-sub">{m.sub}</small>}
    </button>
  );
}

/** DIRECTV-style mixes, as pairs for Dual view: today's games (live now, each league, your teams), channel pairs, and saved ones. */
function MixPicker({ onPick, onClose }: { onPick: (m: Mix) => void; onClose: () => void }) {
  const [games, setGames] = useState<Mix[] | null>(null);
  const [mine, setMine] = useState(() => myMixes());
  const channels = useState(() => channelMixes())[0];
  useEffect(() => {
    let alive = true;
    gameMixes().then((g) => alive && setGames(g), () => alive && setGames([]));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Modal title="Dual view mixes" onClose={onClose} wide class="mix-modal">
      <h3 class="mix-head">Games</h3>
      {games === null ? (
        <p class="muted row gap"><span class="spinner" /> Finding today’s games in your lineup…</p>
      ) : games.length ? (
        <div class="mix-grid" data-group="mix-games">{games.map((m) => <MixCard m={m} onPick={onPick} />)}</div>
      ) : (
        <p class="muted">No games with a stream in your lineup right now.</p>
      )}
      {channels.length > 0 && (
        <>
          <h3 class="mix-head">Channels</h3>
          <div class="mix-grid" data-group="mix-channels">{channels.map((m) => <MixCard m={m} onPick={onPick} />)}</div>
        </>
      )}
      {mine.length > 0 && (
        <>
          <h3 class="mix-head">Your mixes <small class="muted">(Menu on one to delete it)</small></h3>
          <div class="mix-grid" data-group="mix-mine">{mine.map((m) => <MixCard m={m} onPick={onPick} onDelete={() => { deleteMix(m.id); setMine(myMixes()); }} />)}</div>
        </>
      )}
      <div class="row gap modal-actions">
        <Button data-autofocus={games !== null && !games.length ? '' : undefined} icon="add" onClick={onClose}>Build my own</Button>
      </div>
    </Modal>
  );
}

function SaveMix({ tiles, onClose }: { tiles: MvTile[]; onClose: () => void }) {
  const [name, setName] = useState('');
  return (
    <Modal title="Save as a mix" onClose={onClose}>
      {tiles.length ? (
        <>
          <p class="muted">{tiles.map((t) => t.title).join(' · ')}</p>
          <label class="field">
            <span>Name</span>
            <input class="f input" data-autofocus maxLength={30} value={name} placeholder="e.g. Sunday games" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
          <div class="row gap modal-actions">
            <Button variant="primary" icon="check" onClick={() => { const m = saveMix(name, tiles); toast(`Saved “${m.name}” — it’s under Mixes.`, 'success'); onClose(); }}>Save</Button>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </>
      ) : (
        <p class="muted">Add a game first, then save the set as a mix.</p>
      )}
    </Modal>
  );
}

const LAYOUTS: { n: MvLayout; label: string }[] = [
  { n: 2, label: '2 games' },
  { n: 3, label: '3 games' },
  { n: 4, label: '4 games' },
];

function LayoutIcon({ n }: { n: MvLayout }) {
  const rects = n === 2 ? [[1, 6, 14, 9], [17, 6, 14, 9]] : n === 3 ? [[1, 2, 20, 17], [23, 2, 8, 8], [23, 11, 8, 8]] : [[1, 2, 14, 8], [17, 2, 14, 8], [1, 11, 14, 8], [17, 11, 14, 8]];
  return (
    <svg class="mv-layout-icon" viewBox="0 0 32 21" aria-hidden="true">
      {rects.map(([x, y, w, hh]) => <rect x={x} y={y} width={w} height={hh} rx="1.5" />)}
    </svg>
  );
}

function LayoutPicker({ current, onPick, onClose }: { current: MvLayout; onPick: (n: MvLayout) => void; onClose: () => void }) {
  const [limit, setLimit] = useState(decoderLimit());
  return (
    <Modal title="How many games?" onClose={onClose} class="mv-layouts-modal">
      <div class="mv-layouts" data-group="mv-layouts">
        {LAYOUTS.map((l) => {
          const over = !!limit && l.n > limit;
          return (
            <button type="button" class={`f mv-layout ${l.n === current ? 'on' : ''} ${over ? 'mv-layout-over' : ''}`} data-autofocus={l.n === current ? '' : undefined} onClick={() => onPick(l.n)}>
              <LayoutIcon n={l.n} />
              <span>{l.label}</span>
              {over && <small class="muted">More than this TV can play</small>}
            </button>
          );
        })}
      </div>
      {limit && (
        <p class="muted mv-limit-note">
          This TV played up to {limit} game{limit === 1 ? '' : 's'} at once.{' '}
          <Button small variant="ghost" onClick={() => { resetDecoderLimit(); setLimit(undefined); }}>Test again</Button>
        </p>
      )}
    </Modal>
  );
}

interface MvDiag {
  device?: string;
  tiles: { state: string; decoder?: string; format?: string; dropped?: number; bufferedMs?: number; audio?: boolean; error?: string }[];
  decoders: { name: string; type: string; hardware: boolean; maxInstances?: number }[];
}

/** Multiview "Stream info": what each game's player is doing, and the TV's hardware video decoders. */
function StreamInfo({ titles, onClose }: { titles: (string | undefined)[]; onClose: () => void }) {
  const [d, setD] = useState<MvDiag | null>(null);
  useEffect(() => {
    const read = () => {
      try {
        if (native?.mvDiagnostics) setD(JSON.parse(native.mvDiagnostics()) as MvDiag);
      } catch {
        /* older app */
      }
    };
    read();
    const t = window.setInterval(read, 2000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <Modal title="Stream info" onClose={onClose} wide class="mv-info">
      {!native?.mvDiagnostics ? (
        <p class="muted">Stream info is available in the Fire TV app.</p>
      ) : !d ? (
        <p><span class="spinner" /> Reading…</p>
      ) : (
        <>
          <table class="mv-info-table">
            <thead><tr><th>Game</th><th>State</th><th>Decoder</th><th>Picture</th><th>Dropped</th><th>Buffer</th></tr></thead>
            <tbody>
              {titles.map((t, i) => t && (
                <tr>
                  <td>{t}{d.tiles[i]?.audio ? ' 🔊' : ''}</td>
                  <td>{d.tiles[i]?.state ?? '—'}{d.tiles[i]?.error ? <small class="error-text"><br />{d.tiles[i]!.error}</small> : null}</td>
                  <td>{d.tiles[i]?.decoder || '—'}</td>
                  <td>{d.tiles[i]?.format || '—'}</td>
                  <td>{d.tiles[i]?.dropped ?? 0}</td>
                  <td>{((d.tiles[i]?.bufferedMs ?? 0) / 1000).toFixed(1)} s</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="muted mv-info-dec">
            <b>{d.device}</b> · hardware video decoders:{' '}
            {d.decoders.filter((x) => x.hardware).map((x) => `${x.name} (${x.type.replace('video/', '')}${x.maxInstances ? `, up to ${x.maxInstances}` : ''})`).join(' · ') || 'none listed'}
          </p>
        </>
      )}
      <div class="row gap modal-actions"><Button data-autofocus onClick={onClose}>Close</Button></div>
    </Modal>
  );
}

export function MultiviewScreen() {
  const mv = useApp((s) => s.multiview)!;
  const [adding, setAdding] = useState<number | null>(null);
  const [options, setOptions] = useState<number | null>(null);
  const [info, setInfo] = useState(false);
  // Mixes (ready-made sets of 4): offered straight away when Multiview opens empty.
  const [mixing, setMixing] = useState(() => mv.tiles.every((t) => !t));
  const [saving, setSaving] = useState(false);
  // Asked each time Multiview opens (the last choice is selected); also from a tile's options.
  // The layout picker opens only from a tile's options (Multiview starts with 4 games).
  const [choosing, setChoosing] = useState(false);
  // Hints and notes at the bottom fade out after 15 s without a key press.
  const [quiet, setQuiet] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let t = window.setTimeout(() => setQuiet(true), 15000);
    const wake = () => {
      setQuiet(false);
      window.clearTimeout(t);
      t = window.setTimeout(() => setQuiet(true), 15000);
    };
    window.addEventListener('keydown', wake, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', wake, true);
    };
  }, []);

  useLayoutEffect(() => {
    requestAnimationFrame(() => focusFirst(rootRef.current));
  }, []);
  useEffect(() => {
    if (adding !== null || options !== null || choosing || info || mixing || saving) return;
    const offBack = onBack(() => {
      closeMultiview();
      return true;
    });
    const offKeys = onAppKey((k) => {
      if (k === 'menu') {
        const i = Number((document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-tile]')?.dataset.tile ?? mv.active);
        if (mv.tiles[i]) setOptions(i);
        return true;
      }
      return k === 'chup' || k === 'chdown';
    });
    return () => {
      offBack();
      offKeys();
    };
  }, [adding, options, choosing, info, mixing, saving, mv]);

  const keys = mv.tiles.filter((t): t is MvTile => !!t).map((t) => t.key);
  const limit = connectionLimit(keys);
  return (
    <div class={`multiview ${quiet ? 'mv-quiet' : ''}`} ref={rootRef} data-scope role="region" aria-label="Dual view">
      <div class={`mv-grid mv-grid-${mv.layout}`} data-group="mv-grid">
        {Array.from({ length: mv.layout }, (_, i) => (
          <div class="mv-cell" data-tile={i} key={i}>
            <Tile i={i} tile={mv.tiles[i]} active={mv.active === i && !!mv.tiles[i]} onAdd={() => setAdding(i)} onOptions={() => setOptions(i)} />
          </div>
        ))}
      </div>
      {limit !== undefined && keys.length > limit && (
        <div class="mv-note">Your provider allows {limit} stream{limit === 1 ? '' : 's'} at once — the extra tiles may not play or may buffer.</div>
      )}
      <div class="mv-hint muted">Sound plays on the highlighted game · OK or Menu: options (full screen, mixes, change game) · Back: full screen on the highlighted game</div>
      {info && <StreamInfo titles={mv.tiles.map((t) => t?.title)} onClose={() => setInfo(false)} />}
      {mixing && (
        <MixPicker
          onClose={() => {
            setMixing(false);
            requestAnimationFrame(() => focusFirst(rootRef.current));
          }}
          onPick={(m) => {
            const r = loadMix(m.tiles);
            setMixing(false);
            if (r.limit && r.loaded < m.tiles.length) toast(`Loaded ${r.loaded} of ${m.tiles.length}: your provider allows ${r.limit} stream${r.limit === 1 ? '' : 's'} at once.`, 'info', 8000);
            requestAnimationFrame(() => focusFirst(rootRef.current));
          }}
        />
      )}
      {saving && <SaveMix tiles={mv.tiles.slice(0, mv.layout).filter((t): t is MvTile => !!t)} onClose={() => setSaving(false)} />}
      {choosing && (
        <LayoutPicker
          current={mv.layout}
          onClose={() => {
            setChoosing(false);
            requestAnimationFrame(() => focusFirst(rootRef.current));
          }}
          onPick={(n) => {
            setLayout(n);
            setChoosing(false);
            requestAnimationFrame(() => focusFirst(rootRef.current));
          }}
        />
      )}
      {adding !== null && (
        <GamePicker
          onClose={() => setAdding(null)}
          onPick={(t) => {
            setTile(adding, t);
            setAdding(null);
          }}
        />
      )}
      {options !== null && mv.tiles[options] && (
        <Modal title={mv.tiles[options]!.title} onClose={() => setOptions(null)}>
          <div class="row gap modal-actions">
            <Button variant="primary" icon="fullscreen" data-autofocus onClick={() => { const i = options; setOptions(null); closeMultiview(i); }}>Full screen</Button>
            <Button icon="refresh" onClick={() => { const i = options; setOptions(null); setAdding(i); }}>Change game</Button>
            <Button icon="multiview" onClick={() => { setOptions(null); setMixing(true); }}>Mixes</Button>
            <Button icon="star" onClick={() => { setOptions(null); setSaving(true); }}>Save as mix</Button>
            <Button icon="info" onClick={() => { setOptions(null); setInfo(true); }}>Stream info</Button>
            <Button icon="close" onClick={() => { setTile(options, null); setOptions(null); }}>Remove</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
