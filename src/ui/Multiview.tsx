// Sports Multiview screen: a 2×2 grid of games. Empty tiles add a game (league → game → stream);
// OK on a tile gives it the sound, OK again (or Menu) opens its options; Back goes full screen on the game with sound.
import { h, Fragment } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../app/state';
import { focusFirst, onAppKey, onBack } from '../app/nav';
import { TILE_COUNT, closeMultiview, connectionLimit, setActiveTile, setTile, tilePlayer, type MvTile } from '../app/multiview';
import type { PlayerController, PlayerStatus } from '../app/player';
import type { ScheduleLeagueId } from '../core/schedule';
import { Button, Icon, Modal } from './common';
import { LeagueGrid } from './Sports';
import { LeagueGames } from './Games';

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

function Tile({ i, tile, active, onAdd, onOptions }: { i: number; tile: MvTile | null; active: boolean; onAdd: () => void; onOptions: () => void }) {
  const ctl = tilePlayer(i);
  const st = useTileStatus(ctl);
  // The name shows for a few seconds after the tile changes or is selected, then gets out of the way.
  const [label, setLabel] = useState(true);
  const timer = useRef<number>();
  const showLabel = () => {
    setLabel(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLabel(false), 5000);
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
      onFocus={showLabel}
      onClick={() => (active ? onOptions() : setActiveTile(i))}
      aria-label={`${tile.title}${active ? ', sound on' : ''}`}
    >
      <TileVideo ctl={ctl} />
      {(st.state === 'loading' || st.state === 'buffering' || st.state === 'retrying') && <span class="spinner mv-spinner" />}
      {st.state === 'error' && <span class="mv-error">{st.error ?? 'This stream didn’t start.'}</span>}
      {(label || active) && (
        <span class={`mv-label ${label ? '' : 'mv-label-min'}`}>
          {active && <Icon name="volume" size="1.1em" />}
          {label && <b>{tile.title}</b>}
          {label && tile.sub && <small>{tile.sub}</small>}
        </span>
      )}
    </button>
  );
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

export function MultiviewScreen() {
  const mv = useApp((s) => s.multiview)!;
  const [adding, setAdding] = useState<number | null>(null);
  const [options, setOptions] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    requestAnimationFrame(() => focusFirst(rootRef.current));
  }, []);
  useEffect(() => {
    if (adding !== null || options !== null) return;
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
  }, [adding, options, mv]);

  const keys = mv.tiles.filter((t): t is MvTile => !!t).map((t) => t.key);
  const limit = connectionLimit(keys);
  return (
    <div class="multiview" ref={rootRef} data-scope role="region" aria-label="Multiview">
      <div class="mv-grid" data-group="mv-grid">
        {Array.from({ length: TILE_COUNT }, (_, i) => (
          <div class="mv-cell" data-tile={i} key={i}>
            <Tile i={i} tile={mv.tiles[i]} active={mv.active === i && !!mv.tiles[i]} onAdd={() => setAdding(i)} onOptions={() => setOptions(i)} />
          </div>
        ))}
      </div>
      {limit !== undefined && keys.length > limit && (
        <div class="mv-note">Your provider allows {limit} stream{limit === 1 ? '' : 's'} at once — the extra tiles may not play or may buffer.</div>
      )}
      <div class="mv-hint muted">OK: sound · OK again or Menu: options · Back: full screen on the game with sound</div>
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
            <Button icon="close" onClick={() => { setTile(options, null); setOptions(null); }}>Remove</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
