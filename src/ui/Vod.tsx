// Movies and Shows screens (only offered when the user's playlists have them),
// their detail pop-ups and the full-screen movie / episode player.
import { h, Fragment } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { player, setState, useApp } from '../app/state';
import { focusFirst, onAppKey, onBack } from '../app/nav';
import {
  episodeName, episodePlay, itemName, loadAllMovies, loadAllSeries, loadCategoryItems, loadHome, loadMovieDetails, loadSeriesDetails,
  moviePlay, playVod, resumePlay, resumePosition, saveProgress, useContinueWatching,
  type ResumeEntry, type VodCat, type VodHome, type VodItem, type VodKind, type VodPlay,
} from '../app/vod';
import { formatDuration, isEnglishCategory, type VodDetails, type VodEpisode, type VodMovie, type VodSeries } from '../core/vod';
import { Button, Chip, Empty, Icon, Modal } from './common';
import { VideoSlot } from './VideoSlot';
import { usePlayerStatus, PlayerBadge } from './Home';


const PAGE = 48;

function Poster({ src, name }: { src?: string; name: string }) {
  const [bad, setBad] = useState(false);
  return (
    <div class="vod-poster">
      {src && !bad ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBad(true)} /> : <div class="vod-poster-fallback">{name.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'}</div>}
    </div>
  );
}

function fmtClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(s).padStart(2, '0');
}

export function VodScreen({ kind }: { kind: VodKind }) {
  const title = kind === 'movies' ? 'Movies' : 'Shows';
  const [home, setHome] = useState<VodHome | null>(null);
  const [homeErr, setHomeErr] = useState('');
  const cont = useContinueWatching().filter((e) => e.key.startsWith(kind === 'movies' ? 'm:' : 'e:'));
  const [view, setView] = useState<{ mode: 'home' } | { mode: 'search' } | { mode: 'category'; cat: VodCat }>({ mode: 'home' });
  const [open, setOpen] = useState<VodItem | null>(null);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let alive = true;
    setHome(null);
    loadHome(kind, (h) => alive && setHome(h)).catch((e) => alive && setHomeErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [kind]);

  // Back leaves search / a category before leaving the screen.
  useEffect(() => {
    if (view.mode === 'home') return;
    return onBack(() => {
      setView({ mode: 'home' });
      return true;
    });
  }, [view]);
  useLayoutEffect(() => {
    requestAnimationFrame(() => focusFirst(rootRef.current?.querySelector<HTMLElement>('.vod-body') ?? null));
  }, [view.mode, view.mode === 'category' ? view.cat.key : '']);
  // Rows arrive after the screen opens: put focus on the first poster once (unless the viewer moved elsewhere).
  const hasRows = !!home?.rows.length || cont.length > 0;
  useEffect(() => {
    if (!hasRows || view.mode !== 'home') return;
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body || (rootRef.current?.contains(a) && !a.closest('.vod-card'))) requestAnimationFrame(() => focusFirst(rootRef.current?.querySelector<HTMLElement>('.vod-body') ?? null));
  }, [hasRows]);

  return (
    <section class="screen vod" ref={rootRef}>
      <header class="screen-head compact">
        {view.mode === 'home' ? <h1>{title}</h1> : (
          <div class="row gap">
            <Button small icon="back" onClick={() => setView({ mode: 'home' })}>{title}</Button>
            <h1>{view.mode === 'search' ? 'Search' : view.cat.name}</h1>
          </div>
        )}
        {view.mode !== 'search' && <Button icon="search" class="vod-search-btn" onClick={() => setView({ mode: 'search' })}>Search</Button>}
      </header>
      <div class="vod-body">
        {view.mode === 'search' ? (
          <VodSearch kind={kind} onOpen={setOpen} />
        ) : view.mode === 'category' ? (
          <CategoryGrid kind={kind} cat={view.cat} onOpen={setOpen} />
        ) : (
          <>
            {cont.length > 0 && (
              <section class="vod-row">
                <h2 class="vod-row-title">Continue watching</h2>
                <div class="vod-strip" data-group="vod-row-continue" data-hlock>
                  {cont.map((e, i) => (
                    <button type="button" class="f vod-card" key={e.key} data-autofocus={i === 0 ? '' : undefined} onClick={() => playVod(resumePlay(e))}>
                      <Poster src={e.poster} name={e.title} />
                      <div class="vod-progress"><div style={{ width: `${Math.min(100, (e.pos / Math.max(1, e.dur)) * 100)}%` }} /></div>
                      <div class="vod-name">{e.title}</div>
                      <div class="vod-meta muted">{e.subtitle ? `${e.subtitle} · ` : ''}{fmtClock(Math.max(0, e.dur - e.pos))} left</div>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {home?.rows.map((r, ri) => (
              <section class="vod-row" key={r.id}>
                <h2 class="vod-row-title">{r.title}{r.note && <small class="muted"> · {r.note}</small>}</h2>
                <div class="vod-strip" data-group={`vod-row-${r.id}`} data-hlock>
                  {r.items.map((it, i) => <ItemCard it={it} autofocus={!cont.length && ri === 0 && i === 0} onOpen={setOpen} />)}
                </div>
              </section>
            ))}
            {(!home || home.loading) && !homeErr && <div class="muted row gap vod-loading"><span class="spinner" /> Loading {title.toLowerCase()}…</div>}
            {homeErr && <p class="error-text">Couldn’t load {title.toLowerCase()}: {homeErr}</p>}
            {home && !home.loading && !home.rows.length && !home.categories.length && !cont.length && (
              <Empty icon={kind === 'movies' ? 'movie' : 'shows'} title={`No English ${title.toLowerCase()} found`}>
                <p>Your provider’s other categories are below.</p>
              </Empty>
            )}
            {home && !home.loading && home.categories.length > 0 && <CategoryRow id="cats" title="Browse categories" cats={home.categories} onPick={(cat) => setView({ mode: 'category', cat })} autofocus={!cont.length && !home.rows.length} />}
            {home && !home.loading && home.otherLanguages.length > 0 && <CategoryRow id="other" title="Other languages" cats={home.otherLanguages} onPick={(cat) => setView({ mode: 'category', cat })} />}
          </>
        )}
      </div>
      {open?.kind === 'movie' && <MovieDetail playlistId={open.playlistId} m={open.m} onClose={() => setOpen(null)} />}
      {open?.kind === 'series' && <SeriesDetail playlistId={open.playlistId} s={open.s} onClose={() => setOpen(null)} />}
    </section>
  );
}

function ItemCard({ it, onOpen, autofocus }: { it: VodItem; onOpen: (it: VodItem) => void; autofocus?: boolean }) {
  const poster = it.kind === 'movie' ? it.m.poster : it.s.poster;
  const year = it.kind === 'movie' ? it.m.year : it.s.year;
  const rating = it.kind === 'movie' ? it.m.rating : it.s.rating;
  const name = itemName(it);
  return (
    <button type="button" class="f vod-card" key={`${it.playlistId}:${it.kind === 'movie' ? it.m.id : it.s.id}`} data-autofocus={autofocus ? '' : undefined} onClick={() => onOpen(it)}>
      <Poster src={poster} name={name} />
      <div class="vod-name">{name}</div>
      <div class="vod-meta muted">{[year, rating ? `★ ${rating.toFixed(1)}` : ''].filter(Boolean).join(' · ')}</div>
    </button>
  );
}

function CategoryRow({ id, title, cats, onPick, autofocus }: { id: string; title: string; cats: VodCat[]; onPick: (c: VodCat) => void; autofocus?: boolean }) {
  return (
    <section class="vod-row">
      <h2 class="vod-row-title">{title}</h2>
      <div class="vod-strip vod-cat-strip" data-group={`vod-row-${id}`} data-hlock>
        {cats.map((c, i) => (
          <button type="button" class="f vod-cat-card" key={c.key} data-autofocus={autofocus && i === 0 ? '' : undefined} onClick={() => onPick(c)}>{c.name}</button>
        ))}
      </div>
    </section>
  );
}

function CategoryGrid({ kind, cat, onOpen }: { kind: VodKind; cat: VodCat; onOpen: (it: VodItem) => void }) {
  const [items, setItems] = useState<VodItem[] | null>(null);
  const [err, setErr] = useState('');
  const [shown, setShown] = useState(PAGE);
  useEffect(() => {
    let alive = true;
    setItems(null);
    setShown(PAGE);
    loadCategoryItems(kind, cat).then((l) => alive && setItems(l)).catch((e) => alive && (setErr((e as Error).message), setItems([])));
    return () => {
      alive = false;
    };
  }, [cat.key]);
  if (!items) return <div class="muted row gap"><span class="spinner" /> Loading…</div>;
  if (!items.length) return <Empty icon="search" title={err ? 'This category didn’t load' : 'Nothing here'}>{err && <p>{err}</p>}</Empty>;
  return (
    <>
      <div class="vod-grid" data-group="vod-grid" data-hlock>
        {items.slice(0, shown).map((it, i) => <ItemCard it={it} autofocus={i === 0} onOpen={onOpen} />)}
      </div>
      {items.length > shown && (
        <div class="row vod-more">
          <Button icon="add" onClick={() => setShown((n) => n + PAGE)}>Show more ({(items.length - shown).toLocaleString()} left)</Button>
        </div>
      )}
    </>
  );
}

/** Search across everything — the text field (and the TV keyboard) only opens when you choose Search. */
function VodSearch({ kind, onOpen }: { kind: VodKind; onOpen: (it: VodItem) => void }) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState<VodItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    const job = kind === 'movies'
      ? loadAllMovies().then((l) => l.map((m): VodItem => ({ kind: 'movie', playlistId: m.playlistId, m })))
      : loadAllSeries().then((l) => l.map((s): VodItem => ({ kind: 'series', playlistId: s.playlistId, s })));
    job.then((l) => alive && setAll(l)).catch(() => alive && setAll([]));
    return () => {
      alive = false;
    };
  }, [kind]);
  const query = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (query.length < 2 || !all) return [];
    const words = query.split(/\s+/);
    const found = all.filter((it) => {
      const n = itemName(it).toLowerCase();
      return words.every((w) => n.includes(w));
    });
    // English titles first.
    return found.sort((a, b) => Number(isEnglishCategory(itemName(b))) - Number(isEnglishCategory(itemName(a)))).slice(0, 120);
  }, [all, query]);
  return (
    <>
      <div class="vod-search" data-group="vod-search">
        <Icon name="search" size="1.6rem" />
        <input class="f input big" type="search" data-autofocus placeholder={`Search ${kind === 'movies' ? 'movies' : 'shows'}`} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Search" />
      </div>
      {!all ? (
        <div class="muted row gap"><span class="spinner" /> Getting the full list…</div>
      ) : query.length < 2 ? (
        <p class="muted">Type at least 2 letters.</p>
      ) : !hits.length ? (
        <Empty icon="search" title="Nothing matches" />
      ) : (
        <div class="vod-grid" data-group="vod-grid" data-hlock>
          {hits.map((it) => <ItemCard it={it} onOpen={onOpen} />)}
        </div>
      )}
    </>
  );
}

function Facts({ d, year, rating }: { d: VodDetails; year?: string; rating?: number }) {
  const bits = [d.year ?? year, formatDuration(d.durationSec), d.genre, (d.rating ?? rating) ? `★ ${(d.rating ?? rating)!.toFixed(1)}` : ''].filter(Boolean);
  return bits.length ? <div class="vod-facts muted">{bits.join(' · ')}</div> : null;
}

function MovieDetail({ playlistId, m, onClose }: { playlistId: string; m: VodMovie; onClose: () => void }) {
  const [d, setD] = useState<VodDetails | null>(null);
  const [resume, setResume] = useState<ResumeEntry | undefined>();
  useEffect(() => {
    void loadMovieDetails(playlistId, m).then(setD);
    void resumePosition(`m:${playlistId}:${m.id}`).then(setResume);
  }, [m.id]);
  const play = (startSec?: number) => {
    const v = moviePlay(playlistId, m, startSec);
    if (v) {
      onClose();
      playVod(v);
    }
  };
  return (
    <Modal title={m.name} onClose={onClose} wide class="vod-detail">
      <div class="vod-detail-body">
        <Poster src={d?.poster ?? m.poster} name={m.name} />
        <div class="vod-detail-text">
          <Facts d={d ?? {}} year={m.year} rating={m.rating} />
          {d === null ? <p class="muted row gap"><span class="spinner" /> Loading details…</p> : d.plot ? <p class="vod-plot">{d.plot}</p> : null}
          {d?.cast && <p class="muted vod-cast">Starring {d.cast}</p>}
          {d?.director && <p class="muted vod-cast">Directed by {d.director}</p>}
          <div class="row gap modal-actions">
            {resume ? (
              <>
                <Button variant="primary" icon="play" data-autofocus onClick={() => play(Math.max(0, resume.pos - 5))}>Resume from {fmtClock(resume.pos)}</Button>
                <Button icon="refresh" onClick={() => play(0)}>Start over</Button>
              </>
            ) : (
              <Button variant="primary" icon="play" data-autofocus onClick={() => play(0)}>Play</Button>
            )}
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function SeriesDetail({ playlistId, s, onClose }: { playlistId: string; s: VodSeries; onClose: () => void }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof loadSeriesDetails>> | null>(null);
  const [err, setErr] = useState('');
  const [season, setSeason] = useState<number | null>(null);
  const cont = useContinueWatching();
  useEffect(() => {
    loadSeriesDetails(playlistId, s).then(setInfo).catch((e) => {
      setErr((e as Error).message);
      setInfo({ details: {}, seasons: [] });
    });
  }, [s.id]);
  const resumeOf = (e: VodEpisode) => cont.find((r) => r.key === `e:${playlistId}:${e.id}`);
  // Open on the season of the episode last watched, else the first.
  const lastSeason = useMemo(() => {
    if (!info) return null;
    for (const r of cont) for (const se of info.seasons) if (se.episodes.some((e) => r.key === `e:${playlistId}:${e.id}`)) return se.season;
    return info.seasons[0]?.season ?? null;
  }, [info]);
  const cur = season ?? lastSeason;
  const seasonEps = info?.seasons.find((x) => x.season === cur)?.episodes ?? [];
  const d = info?.details ?? {};

  const play = (e: VodEpisode, startSec?: number) => {
    if (!info) return;
    const flat = info.seasons.flatMap((x) => x.episodes);
    const i = flat.findIndex((x) => x.id === e.id);
    const v = episodePlay(playlistId, s, e, startSec);
    if (!v) return;
    v.queue = flat.slice(i + 1, i + 31).map((x) => episodePlay(playlistId, s, x)).filter((x): x is VodPlay => !!x);
    onClose();
    playVod(v);
  };

  return (
    <Modal title={s.name} onClose={onClose} wide class="vod-detail">
      <div class="vod-detail-body">
        <Poster src={d.poster ?? s.poster} name={s.name} />
        <div class="vod-detail-text">
          <Facts d={d} year={s.year} rating={s.rating} />
          {(d.plot ?? s.plot) && <p class="vod-plot">{d.plot ?? s.plot}</p>}
          {(d.cast ?? s.cast) && <p class="muted vod-cast">Starring {d.cast ?? s.cast}</p>}
          {!info ? (
            <p class="muted row gap"><span class="spinner" /> Loading episodes…</p>
          ) : info.seasons.length === 0 ? (
            <p class="muted">{err ? `Episodes didn’t load: ${err}` : 'The provider lists no episodes for this show.'}</p>
          ) : (
            <>
              {info.seasons.length > 1 && (
                <div class="chips compact" data-group="vod-seasons">
                  {info.seasons.map((x) => (
                    <Chip key={x.season} active={x.season === cur} onClick={() => setSeason(x.season)}>Season {x.season}</Chip>
                  ))}
                </div>
              )}
              <div class="vod-episodes" data-group="vod-episodes">
                {seasonEps.map((e, i) => {
                  const r = resumeOf(e);
                  return (
                    <button type="button" class="f vod-episode" key={e.id} data-autofocus={(r ? true : i === 0) ? '' : undefined} onClick={() => play(e, r ? Math.max(0, r.pos - 5) : 0)}>
                      <span class="vod-ep-num">{e.episode || i + 1}</span>
                      <span class="vod-ep-text">
                        <span class="vod-ep-title">{episodeName(s.name, e) || `Episode ${e.episode || i + 1}`}</span>
                        <span class="muted vod-ep-meta">
                          {[formatDuration(e.durationSec), r ? `Resume at ${fmtClock(r.pos)}` : ''].filter(Boolean).join(' · ')}
                        </span>
                        {e.plot && <span class="muted vod-ep-plot">{e.plot}</span>}
                      </span>
                      {r && <span class="vod-ep-bar"><span style={{ width: `${Math.min(100, (r.pos / Math.max(1, r.dur)) * 100)}%` }} /></span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div class="row gap modal-actions">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Full-screen movie / episode playback: seek with Left/Right, resume where you left off, next episode. */
export function VodPlayer() {
  const v = useApp((s) => s.vodPlaying)!;
  const status = usePlayerStatus();
  const [osd, setOsd] = useState(true);
  const [controls, setControls] = useState(false);
  const [pos, setPos] = useState({ at: v.startSec ?? 0, dur: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number>();
  const posRef = useRef(pos);
  posRef.current = pos;
  const lastSaved = useRef(0);

  const save = () => {
    const p = posRef.current;
    if (p.dur > 0) void saveProgress({ key: v.key, title: v.title, subtitle: v.subtitle, poster: v.poster, pos: p.at, dur: p.dur, url: v.url, playlistId: v.playlistId });
  };
  const close = () => {
    save();
    player.stop();
    setState({ vodPlaying: undefined, currentKey: undefined });
  };
  const poke = () => {
    setOsd(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setOsd(false);
      setControls(false);
    }, 5000);
  };

  // Start (and restart for the next episode).
  useEffect(() => {
    setPos({ at: v.startSec ?? 0, dur: 0 });
    player.play({ key: v.key, url: v.url, headers: v.headers, vod: true, startSec: v.startSec });
    poke();
  }, [v.key]);

  // Position, and saving it every 15 seconds.
  useEffect(() => {
    const t = window.setInterval(() => {
      const info = player.liveInfo();
      if (!info || !info.window) return;
      const at = Math.max(0, info.window - info.behind);
      setPos({ at, dur: info.window });
      if (Date.now() - lastSaved.current > 15_000 && at > 0) {
        lastSaved.current = Date.now();
        save();
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [v.key]);

  // The end: next episode, or close.
  useEffect(() => {
    if (status.state !== 'ended' || status.key !== v.key) return;
    void saveProgress({ key: v.key, title: v.title, subtitle: v.subtitle, poster: v.poster, pos: posRef.current.dur, dur: posRef.current.dur, url: v.url, playlistId: v.playlistId });
    const [next, ...rest] = v.queue ?? [];
    if (next) setState({ vodPlaying: { ...next, queue: rest } });
    else close();
  }, [status.state]);

  const nextEpisode = () => {
    const [next, ...rest] = v.queue ?? [];
    if (!next) return;
    save();
    setState({ vodPlaying: { ...next, queue: rest } });
  };

  // Seek: repeated presses go further (10 s, 30 s, then 1 min).
  const skipRef = useRef({ dir: 0, at: 0, n: 0 });
  const skip = (dir: 1 | -1) => {
    const k = skipRef.current;
    const t = Date.now();
    k.n = k.dir === dir && t - k.at < 1500 ? k.n + 1 : 0;
    k.dir = dir;
    k.at = t;
    const step = k.n >= 6 ? 60 : k.n >= 3 ? 30 : 10;
    player.seekBy(dir * step);
    setPos((p) => ({ ...p, at: Math.min(Math.max(0, p.at + dir * step), p.dur || Infinity) }));
    poke();
  };

  useLayoutEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    return () => {
      requestAnimationFrame(() => {
        if (prev && prev.isConnected && prev !== document.body) prev.focus({ preventScroll: true });
        else focusFirst(document.querySelector<HTMLElement>('[data-group="content"]'));
      });
    };
  }, []);

  useLayoutEffect(() => {
    const offBack = onBack(() => {
      if (controls) {
        setControls(false);
        return true;
      }
      close();
      return true;
    });
    const offKeys = onAppKey((k) => {
      if (k === 'rewind' || k === 'ffwd') {
        skip(k === 'rewind' ? -1 : 1);
        return true;
      }
      if (k === 'playpause' || k === 'play' || k === 'pause') {
        const paused = player.status.state === 'paused';
        if (k === 'playpause' || (k === 'play') === paused) player.togglePause();
        poke();
        return true;
      }
      if (k === 'chup' || k === 'chdown' || k === 'guide' || k === 'menu' || k === 'info') {
        setControls(true);
        poke();
        return true;
      }
      return false;
    });
    return () => {
      offBack();
      offKeys();
    };
  }, [controls, v.key]);

  useEffect(() => {
    if (controls) requestAnimationFrame(() => focusFirst(rootRef.current?.querySelector('.vod-controls') as HTMLElement));
    else rootRef.current?.focus({ preventScroll: true });
  }, [controls]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    poke();
    if (controls) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setControls(false);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        e.preventDefault();
        skip(e.key === 'ArrowLeft' ? -1 : 1);
        break;
      case 'Enter':
        e.preventDefault();
        if (status.state === 'error') player.reload();
        else player.togglePause();
        break;
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        setControls(true);
        break;
    }
  };

  const frac = pos.dur > 0 ? Math.min(1, pos.at / pos.dur) : 0;
  const paused = status.state === 'paused';
  return (
    <div
      class={`player vod-player ${osd || paused || controls ? 'osd-on' : 'osd-off'}`}
      data-scope
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseMove={poke}
      role="region"
      aria-label={`Playing ${v.title}`}
    >
      <VideoSlot priority={200} class="player-video">
        <PlayerBadge status={status} />
      </VideoSlot>
      <div class="osd vod-osd">
        <div class="vod-osd-title">
          <div class="osd-title">{v.title}</div>
          {v.subtitle && <div class="muted">{v.subtitle}</div>}
        </div>
        <div class="livebar">
          <span class="livebar-note">{fmtClock(pos.at)}</span>
          <div class="livebar-track" aria-hidden="true">
            <div class="livebar-fill" style={{ width: `${frac * 100}%` }} />
            <div class="livebar-head" style={{ left: `${frac * 100}%` }} />
          </div>
          <span class="livebar-note muted">{pos.dur ? `-${fmtClock(pos.dur - pos.at)}` : ''}</span>
        </div>
        <div class="osd-controls vod-controls" data-group="vod-controls" data-nav-skip={controls ? undefined : ''}>
          <Button small icon="rewind" onClick={() => skip(-1)} aria-label="Back 10 seconds">10s</Button>
          <Button small data-autofocus icon={paused ? 'play' : 'pause'} onClick={() => { player.togglePause(); poke(); }} aria-label="Play/pause" />
          <Button small icon="ffwd" onClick={() => skip(1)} aria-label="Forward 10 seconds">10s</Button>
          {v.queue?.length ? <Button small icon="ffwd" onClick={nextEpisode}>Next episode</Button> : null}
          <Button small icon="close" onClick={close}>Close</Button>
          <span class="muted vod-hint">← → seek · OK pause · Back to close</span>
        </div>
      </div>
    </div>
  );
}

/** Whether the menu should show Movies / Shows (only when the playlists have them). */
export function useVodNav(): { movies: boolean; shows: boolean } {
  return useApp((s) => s.vodAvail) ?? { movies: false, shows: false };
}

