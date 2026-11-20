// Movies and Shows screens (only offered when the user's playlists have them),
// their detail pop-ups and the full-screen movie / episode player.
import { h, Fragment, type ComponentChildren } from 'preact';
import { CastRow } from './VodPeople';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { navigate, player, setState, toast, useApp } from '../app/state';
import { isTV, native } from '../app/platform';
import { focusFirst, onAppKey, onBack } from '../app/nav';
import {
  continueList, dedupe, episodeName, episodePlay, findSeriesByName, findVersions, itemName, lastWatched, loadAllMovies, loadAllSeries, loadCategoryItems, loadCategories, loadHome, loadMovieDetails, loadSeriesDetails,
  moviePlay, playVod, resumePlay, resumePosition, saveProgress, useContinueWatching, movieResume, showEntries, providerPresent, findMovieByName,
  type ResumeEntry, type VodCat, type VodHome, type VodItem, type VodKind, type VodPlay, type VodVersion,
} from '../app/vod';
import { sizedImage, cleanTitle, formatDuration, isEnglishCategory, qualityOf, type VodDetails, type VodEpisode, type VodMovie, type VodSeries } from '../core/vod';
import { Button, Chip, Empty, Icon, Modal } from './common';
import { VideoSlot } from './VideoSlot';
import { clock } from './fmt';
import { useArt } from '../app/vodmeta';
import { isForeignScript } from '../core/lang';
import { updateSettings } from '../app/state';
import { usePlayerStatus, PlayerBadge } from './Home';
import { APP_MODE } from '../app/appmode';
import { ALL_SERVICES, STREAMING_SERVICES, loadServiceHome, type ServiceHome, type StreamingService, type SvcItem } from '../app/vod';
import { tmdbKey, useTmdb } from '../app/tmdb';
import { currentProfile } from '../app/profiles';


const PAGE = 48;
/** A title as shown: no "EN -" / "|NF|" prefixes or quality tags ("EN - The Batman 4K" -> "The Batman"). */
const tt = (n: string) => cleanTitle(n) || n;
/** Pictures at the size they're shown (smaller on a TV). */
const pic = (u: string | undefined, use: 'poster' | 'backdrop' | 'still') => sizedImage(u, use, isTV);

function Poster({ src, name }: { src?: string; name: string }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  return (
    <div class="vod-poster">
      {src && !bad ? <img src={pic(src, 'poster')} alt="" loading="lazy" decoding="async" onError={() => setBad(true)} /> : <div class="vod-poster-fallback">{name.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'}</div>}
    </div>
  );
}

/** Card poster: once the card is on screen, a sharper poster from TVmaze (shows) / iTunes (movies) replaces the provider's. */
function ArtPoster({ kind, name, year, src }: { kind: 'movie' | 'series'; name: string; year?: string; src?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setSeen(true);
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const art = useArt(kind, name, year, seen);
  return <div ref={ref} class="vod-poster-wrap"><Poster src={art?.poster ?? src} name={name} /></div>;
}

function fmtClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(s).padStart(2, '0');
}

/**
 * A row's cards: the first 8 are drawn right away, the rest once you move into the row (20 rows × 30
 * posters drawn at once made opening Movies / Shows slow on a TV).
 */
function LazyStrip({ id, count, children }: { id: string; count: number; children: (n: number) => ComponentChildren }) {
  const [full, setFull] = useState(false);
  return (
    <div class="vod-strip" data-group={`vod-row-${id}`} data-hlock onFocusIn={() => !full && setFull(true)}>
      {children(full ? count : Math.min(8, count))}
    </div>
  );
}

export function VodScreen({ kind }: { kind: VodKind }) {
  const title = kind === 'movies' ? 'Movies' : 'Shows';
  const [home, setHome] = useState<VodHome | null>(null);
  const [homeErr, setHomeErr] = useState('');
  const contAll = continueList(useContinueWatching());
  const cont = contAll.filter((e) => e.key.startsWith(kind === 'movies' ? 'm:' : 'e:'));
  // Continue watching: shows open their page with the episode selected; movies continue right away.
  const openResume = (e: ResumeEntry) => {
    const here = providerPresent(e.playlistId);
    if (e.series && here) setOpen({ kind: 'series', playlistId: e.playlistId, s: { id: e.series.id, name: e.series.name, poster: e.series.poster, categoryId: '', year: e.series.year } });
    else if (e.series || e.key.startsWith('e:')) {
      // Watched on a provider you've since replaced: the same show on your provider now.
      void findSeriesByName(e.playlistId, e.series?.name ?? e.title).then((sr) => (sr ? setOpen({ kind: 'series', playlistId: (sr as VodSeries & { playlistId?: string }).playlistId ?? e.playlistId, s: sr }) : here ? playVod(resumePlay(e)) : toast(`${e.series?.name ?? e.title} isn’t on your provider now.`, 'info')));
    } else if (here) playVod(resumePlay(e));
    else {
      void findMovieByName(e.title, e.subtitle).then((m) => {
        const v = m && moviePlay(m.playlistId, m, Math.max(0, e.pos - 5));
        if (v) playVod(v);
        else toast(`${e.title} isn’t on your provider now.`, 'info');
      });
    }
  };
  const [view, setView] = useState<{ mode: 'home' } | { mode: 'search' } | { mode: 'category'; cat: VodCat; kind?: VodKind } | { mode: 'service'; svc: StreamingService } | { mode: 'services' } | { mode: 'all' }>(() => (
    // Movies & Shows is one app, Netflix-style: everything from every service on one home.
    APP_MODE === 'movies' ? { mode: 'all' } : { mode: 'home' }
  ));
  // Service pages and the services page cover the whole screen (no LTTV menu over them).
  const fullPage = view.mode === 'service' || view.mode === 'services' || view.mode === 'all';
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('svc-open', fullPage);
    return () => document.documentElement.classList.remove('svc-open');
  }, [fullPage]);
  const [open, setOpen] = useState<VodItem | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  // The page appears right away with its first rows; the others are added a few at a time just after
  // (drawing every row at once kept a Fire TV Stick busy for seconds before anything showed).
  const [rowsShown, setRowsShown] = useState(3);
  const rowCount = home?.rows.length ?? 0;
  useEffect(() => {
    if (rowsShown >= rowCount) return;
    const t = setTimeout(() => setRowsShown((n) => n + 3), 150);
    return () => clearTimeout(t);
  }, [rowsShown, rowCount]);

  useEffect(() => {
    let alive = true;
    setHome(null);
    loadHome(kind, (h) => alive && setHome(h)).catch((e) => alive && setHomeErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [kind]);

  // Back leaves search / a category before leaving the screen; on the home rows it goes to the menu.
  useEffect(() => {
    if (view.mode === 'home') {
      return onBack(() => {
        const a = document.activeElement;
        if (!rootRef.current?.contains(a)) return false;
        // Movies & Shows: Back from the plain list goes to its home.
        if (APP_MODE === 'movies') {
          setView({ mode: 'all' });
          return true;
        }
        const item = document.querySelector<HTMLElement>('.topbar .tab.active') ?? document.querySelector<HTMLElement>('.topbar .tab');
        item?.focus();
        return !!item;
      });
    }
    return onBack(() => {
      // Movies & Shows: Back on its home leaves the app; from search or a category it goes back home.
      if (APP_MODE === 'movies' && view.mode === 'all') return false;
      if (APP_MODE === 'movies') {
        setView({ mode: 'all' });
        return true;
      }
      setView({ mode: 'home' });
      return true;
    });
  }, [view]);
  useLayoutEffect(() => {
    requestAnimationFrame(() => focusFirst(rootRef.current?.querySelector<HTMLElement>('.vod-body') ?? null));
  }, [view.mode, view.mode === 'category' ? view.cat.key : view.mode === 'service' ? view.svc.id : '']);
  const pickService = (svc: StreamingService | null) => {
    try {
      if (svc) localStorage.setItem('lttvService', svc.id);
      else localStorage.removeItem('lttvService');
    } catch { /* storage off */ }
    setView(svc ? { mode: 'service', svc } : APP_MODE === 'movies' ? { mode: 'all' } : { mode: 'home' });
  };
  // Rows arrive after the screen opens: put focus on the first poster once (unless the viewer moved elsewhere).
  const hasRows = !!home?.rows.length || cont.length > 0;
  useEffect(() => {
    if (!hasRows || view.mode !== 'home') return;
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body || (rootRef.current?.contains(a) && !a.closest('.vod-card'))) requestAnimationFrame(() => focusFirst(rootRef.current?.querySelector<HTMLElement>('.vod-body') ?? null));
  }, [hasRows]);

  return (
    <section class="screen vod" ref={rootRef}>
      <header class={`screen-head compact ${view.mode === 'home' ? 'vod-home-head' : ''}`}>
        {view.mode === 'home' ? null : (
          <div class="row gap">
            <Button small icon="back" onClick={() => pickService(null)}>{title}</Button>
            {view.mode === 'search' && <h1>Search</h1>}
          </div>
        )}
        {view.mode !== 'search' && <Button icon="search" class="vod-search-btn" onClick={() => setView({ mode: 'search' })}>Search</Button>}
      </header>
      <div class="vod-body">
        {view.mode === 'search' ? (
          <VodSearch kind={kind} onOpen={setOpen} />
        ) : view.mode === 'category' ? (
          <CategoryGrid kind={view.kind ?? kind} cat={view.cat} onOpen={setOpen} />
        ) : view.mode === 'service' ? (
          <ServicePage key={view.svc.id} svc={view.svc} onOpen={setOpen} onPick={pickService} onSearch={() => setView({ mode: 'search' })} />
        ) : view.mode === 'all' ? (
          <ServicePage key="all" svc={ALL_SERVICES} onOpen={setOpen} onPick={() => setView({ mode: 'home' })} onSearch={() => setView({ mode: 'search' })} cont={contAll} onResume={openResume} onCategory={(k, cat) => setView({ mode: 'category', cat, kind: k })} />
        ) : view.mode === 'services' ? (
          <ServicesPage kind={kind} onPick={pickService} onAll={() => setView({ mode: 'home' })} />
        ) : (
          <>
            {home && home.rows[0] && <Hero items={home.rows[0].items.slice(0, 10)} top={home.rows[0].id === 'trending' || home.rows[0].id === 'popular'} onOpen={setOpen} />}
            {cont.length > 0 && (
              <section class="vod-row">
                <h2 class="vod-row-title">Continue watching</h2>
                <div class="vod-strip" data-group="vod-row-continue" data-hlock>
                  {cont.map((e, i) => (
                    <button
                      type="button"
                      class="f vod-card"
                      key={e.key}
                      data-autofocus={i === 0 ? '' : undefined}
                      // Shows open their page with the episode selected; movies continue right away.
                      onClick={() => openResume(e)}
                    >
                      <ArtPoster kind={e.key.startsWith('e:') ? 'series' : 'movie'} name={e.series?.name ?? e.title} year={e.series?.year} src={e.series?.poster ?? (e.key.startsWith('e:') ? undefined : e.poster)} />
                      <div class="vod-progress"><div style={{ width: `${e.done ? 100 : Math.min(100, (e.pos / Math.max(1, e.dur)) * 100)}%` }} /></div>
                      <div class="vod-name">{tt(e.series?.name ?? e.title)}</div>
                      <div class="vod-meta muted">{!e.series && e.key.startsWith('e:') ? `${(e.subtitle ?? '').split(' · ')[0]} · ${fmtClock(Math.max(0, e.dur - e.pos))} left` : e.series ? (e.done ? `Up next after S${e.series.season} E${e.series.episode}` : `S${e.series.season} E${e.series.episode} · ${fmtClock(Math.max(0, e.dur - e.pos))} left`) : `${fmtClock(Math.max(0, e.dur - e.pos))} left`}</div>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {home?.rows.slice(0, rowsShown).map((r, ri) => (r.id === 'trending' || r.id === 'popular') ? <TopRow key={r.id} kind={kind} items={r.items} onOpen={setOpen} autofocus={!cont.length && ri === 0} /> : (
              <section class={`vod-row ${r.id === 'trending' ? 'vod-ranked' : ''}`} key={r.id}>
                <h2 class="vod-row-title">{r.title}{r.note && <small class="muted"> · {r.note}</small>}</h2>
                <LazyStrip id={r.id} count={r.items.length}>
                  {(n) => r.items.slice(0, n).map((it, i) => <ItemCard it={it} rank={r.id === 'trending' && i < 10 ? i + 1 : undefined} autofocus={!cont.length && ri === 0 && i === 0} onOpen={setOpen} />)}
                </LazyStrip>
              </section>
            ))}
            {(!home || home.loading) && !homeErr && <div class="muted row gap vod-loading"><span class="spinner" /> Loading {title.toLowerCase()}…</div>}
            {homeErr && <p class="error-text">Couldn’t load {title.toLowerCase()}: {homeErr}</p>}
            {home && !home.loading && !home.rows.length && !home.categories.length && !cont.length && (
              <Empty icon={kind === 'movies' ? 'movie' : 'shows'} title={`No English ${title.toLowerCase()} found`}>
                <p>Your provider’s other categories are below.</p>
              </Empty>
            )}
            {home && !home.loading && rowsShown >= rowCount && home.categories.length > 0 && <CategoryRow id="cats" title="Browse categories" cats={home.categories} onPick={(cat) => setView({ mode: 'category', cat })} autofocus={!cont.length && !home.rows.length} />}
            {/* US / English only: other-language categories aren't shown. */}
          </>
        )}
      </div>
      {open?.kind === 'movie' && <MovieDetail key={`m${open.playlistId}:${open.m.id}`} playlistId={open.playlistId} m={open.m} onClose={() => setOpen(null)} onOpen={setOpen} />}
      {open?.kind === 'series' && <SeriesDetail key={`s${open.playlistId}:${open.s.id}`} playlistId={open.playlistId} s={open.s} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </section>
  );
}

/** Featured titles at the top: full-width artwork, "#1 Trending", one meta line, Play and More info, page dots. */
function Hero({ items, onOpen, top }: { items: VodItem[]; onOpen: (it: VodItem) => void; top?: boolean }) {
  const [i, setI] = useState(0);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => {
      if (!ref.current?.contains(document.activeElement)) setI((n) => (n + 1) % items.length);
    }, 12000);
    return () => clearInterval(t);
  }, [items.length]);
  const it = items[i % items.length];
  const name = itemName(it);
  const year = it.kind === 'movie' ? it.m.year : it.s.year;
  const rating = it.kind === 'movie' ? it.m.rating : it.s.rating;
  const art = useArt(it.kind, name, year, true);
  const [d, setD] = useState<VodDetails | null>(null);
  const id = it.kind === 'movie' ? it.m.id : it.s.id;
  useEffect(() => {
    setD(null);
    if (it.kind === 'movie') void loadMovieDetails(it.playlistId, it.m).then(setD);
  }, [id]);
  // The show's own wide picture from TVmaze / TMDB first (sharp, the right shape); the provider's only if there's none.
  const backdrop = art?.backdrop ?? (it.kind === 'series' ? it.s.backdrop : d?.backdrop);
  const poster = art?.poster ?? (it.kind === 'movie' ? it.m.poster : it.s.poster);
  const plot = goodText(it.kind === 'series' ? it.s.plot : d?.plot) ?? art?.plot;
  const genre = firstGenre((it.kind === 'series' ? it.s.genre : d?.genre) ?? art?.genre);
  const play = async () => {
    if (it.kind === 'series') return onOpen(it);
    const r = await movieResume(it.playlistId, it.m);
    const v = moviePlay(it.playlistId, it.m, r ? Math.max(0, r.pos - 5) : 0);
    if (v) playVod({ ...v, poster: poster ?? v.poster });
  };
  const meta = [it.kind === 'movie' ? 'Movie' : 'Series', genre, year ?? art?.year, it.kind === 'movie' ? formatDuration(d?.durationSec) : '', rating ? `★ ${rating.toFixed(1)}` : ''].filter(Boolean).join(' · ');
  return (
    <section class="vod-hero" ref={ref} data-group="vod-hero">
      {(backdrop || poster) && <div class={`vod-hero-bg ${backdrop ? '' : 'is-poster'}`} style={{ backgroundImage: `url("${pic(backdrop, 'backdrop') ?? pic(poster, 'poster')}")` }} />}
      <div class="vod-hero-shade" />
      {!backdrop && poster && <img class="vod-hero-poster is-shown" src={pic(poster, 'poster')} alt="" decoding="async" />}
      <div class="vod-hero-text">
        <span class="vod-hero-badge">{top ? `#${(i % items.length) + 1} Trending` : it.kind === 'movie' ? 'Featured' : 'Featured series'}</span>
        <h2 class="vod-hero-title">{cleanTitle(name) || name}</h2>
        <div class="vod-hero-meta">{meta}</div>
        {plot && <p class="vod-hero-plot">{plot}</p>}
        <div class="row gap vod-hero-actions">
          <Button class="vod-play-btn" icon="play" data-autofocus onClick={() => void play()}>{it.kind === 'movie' ? 'Play' : 'Watch'}</Button>
          <Button class="vod-info-btn" icon="info" onClick={() => onOpen(it)}>More info</Button>
        </div>
        {items.length > 1 && <div class="vod-hero-dots" aria-hidden="true">{items.map((_, n) => <span class={n === i % items.length ? 'on' : ''} />)}</div>}
      </div>
    </section>
  );
}

const firstGenre = (g?: string) => (g ?? '').split(/[,/|]/)[0].trim() || undefined;

function ItemCard({ it, onOpen, autofocus, rank }: { it: VodItem; onOpen: (it: VodItem) => void; autofocus?: boolean; rank?: number }) {
  const poster = it.kind === 'movie' ? it.m.poster : it.s.poster;
  const year = it.kind === 'movie' ? it.m.year : it.s.year;
  const rating = it.kind === 'movie' ? it.m.rating : it.s.rating;
  const name = itemName(it);
  return (
    <button type="button" class="f vod-card" key={`${it.playlistId}:${it.kind === 'movie' ? it.m.id : it.s.id}`} data-autofocus={autofocus ? '' : undefined} onClick={() => onOpen(it)}>
      {rank && <span class="vod-rank" aria-hidden="true">{rank}</span>}
      <ArtPoster kind={it.kind} name={name} year={year} src={poster} />
      <div class="vod-name">{tt(name)}</div>
      <div class="vod-meta muted">{[year, rating ? `★ ${rating.toFixed(1)}` : ''].filter(Boolean).join(' · ')}</div>
    </button>
  );
}

/**
 * "Top 25 movies today": big outlined numbers, posters, and the title you're on opened up wide with its
 * picture, one meta line and the description under it.
 */
function TopRow({ kind, items, onOpen, autofocus }: { kind: VodKind; items: VodItem[]; onOpen: (it: VodItem) => void; autofocus?: boolean }) {
  const [fi, setFi] = useState(0);
  const list = items.slice(0, 25);
  return (
    <section class="vod-row vod-top">
      <h2 class="vod-row-title">{kind === 'movies' ? 'Top 25 movies today' : 'Top 25 TV shows today'}</h2>
      <LazyStrip id="trending" count={list.length}>
        {(n) => list.slice(0, n).map((it, i) => <TopCard key={`${it.playlistId}:${it.kind === 'movie' ? it.m.id : it.s.id}`} it={it} rank={i + 1} wide={i === fi} autofocus={autofocus && i === 0} onFocus={() => setFi(i)} onOpen={onOpen} />)}
      </LazyStrip>
    </section>
  );
}

function TopCard({ it, rank, wide, autofocus, onFocus, onOpen }: { it: VodItem; rank: number; wide: boolean; autofocus?: boolean; onFocus: () => void; onOpen: (it: VodItem) => void }) {
  const name = itemName(it);
  const year = it.kind === 'movie' ? it.m.year : it.s.year;
  const art = useArt(it.kind, name, year, wide);
  const [d, setD] = useState<VodDetails | null>(null);
  // The wide picture and description are looked up once you stay on the title for a moment.
  useEffect(() => {
    if (!wide || d || it.kind !== 'movie') return;
    const t = setTimeout(() => void loadMovieDetails(it.playlistId, it.m).then(setD).catch(() => undefined), 250);
    return () => clearTimeout(t);
  }, [wide]);
  // The show's own wide picture from TVmaze / TMDB first (sharp, the right shape); the provider's only if there's none.
  const backdrop = art?.backdrop ?? (it.kind === 'series' ? it.s.backdrop : d?.backdrop);
  const poster = art?.poster ?? (it.kind === 'movie' ? it.m.poster : it.s.poster);
  const plot = goodText(it.kind === 'series' ? it.s.plot : d?.plot) ?? art?.plot;
  const genre = firstGenre((it.kind === 'series' ? it.s.genre : d?.genre) ?? art?.genre);
  const meta = [it.kind === 'movie' ? 'Movie' : 'Series', year ?? art?.year, it.kind === 'movie' ? formatDuration(d?.durationSec) : '', genre].filter(Boolean).join(' · ');
  return (
    <div class={`vod-top-item ${wide ? 'is-wide' : ''}`}>
      <span class="vod-top-num" aria-hidden="true">{rank}</span>
      <div class="vod-top-col">
        <button type="button" class="f vod-top-card" data-autofocus={autofocus ? '' : undefined} onFocus={onFocus} onClick={() => onOpen(it)} aria-label={`${rank}. ${name}`}>
          {wide && backdrop ? <img class="vod-top-wide" src={pic(backdrop, 'backdrop')} alt="" decoding="async" /> : wide ? <div class="vod-top-wide is-poster" style={poster ? { backgroundImage: `url("${pic(poster, 'poster')}")` } : undefined}><span>{cleanTitle(name) || name}</span></div> : <ArtPoster kind={it.kind} name={name} year={year} src={it.kind === 'movie' ? it.m.poster : it.s.poster} />}
        </button>
        {wide && (
          <div class="vod-top-text">
            <div class="vod-top-meta">{meta}</div>
            {plot && <p class="vod-top-plot">{plot}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Movies & Shows' first page: every streaming service as a big tile, plus "Everything". */
function ServicesPage({ kind, onPick, onAll }: { kind: VodKind; onPick: (s: StreamingService) => void; onAll: () => void }) {
  return (
    <div class="svc-full svc-chooser">
      <div class="svc-chooser-head">
        <h1>Choose a streaming service</h1>
        <p class="muted">What's on each service that your provider has.</p>
      </div>
      <div class="svc-chooser-grid" data-group="svc-chooser">
        {STREAMING_SERVICES.map((x, i) => (
          <button
            type="button"
            key={x.id}
            class="f svc-big"
            data-autofocus={i === 0 ? '' : undefined}
            style={{ '--svc-top': x.page.top, '--svc-bottom': x.page.bottom, '--svc-accent': x.page.accent } as Record<string, string>}
            onClick={() => onPick(x)}
          >
            <span class="svc-big-name">{x.label}</span>
          </button>
        ))}
        <button type="button" class="f svc-big svc-big-all" onClick={onAll}>
          <span class="svc-big-name">Everything</span>
          <span class="svc-big-sub">All {kind === 'movies' ? 'movies' : 'shows'} from your provider</span>
        </button>
      </div>
    </div>
  );
}

/**
 * How each service's own TV app is laid out (from screenshots of the real apps): where its menu sits, what its
 * featured area looks like, its labels and buttons, how rows are titled, card shape and focus colour. The
 * services' logos aren't used — their names are written out instead.
 */
interface SvcStyle {
  nav: 'rail' | 'top' | 'pill';
  hero: 'bleed' | 'inset' | 'posters';
  eyebrow?: string;
  upper?: boolean;
  serif?: boolean;
  buttons: 'hulu' | 'netflix' | 'none' | 'apple' | 'paramount' | 'prime' | 'peacock' | 'disney';
  rowCaps?: boolean;
  card: 'wide' | 'poster';
  bigNumbers?: boolean;
  subtitles?: boolean;
  chips?: boolean;
  follow?: boolean;
  home?: string;
}
const SVC_STYLE: Record<string, SvcStyle> = {
  Hulu: { nav: 'rail', hero: 'bleed', eyebrow: 'START WATCHING', upper: true, buttons: 'hulu', rowCaps: true, card: 'wide', follow: true },
  Netflix: { nav: 'top', hero: 'inset', buttons: 'netflix', card: 'wide', bigNumbers: true, home: 'Home' },
  'HBO Max': { nav: 'rail', hero: 'bleed', buttons: 'none', card: 'wide', follow: true },
  'Prime Video': { nav: 'rail', hero: 'bleed', eyebrow: '#1 in the US', upper: true, buttons: 'prime', card: 'wide', bigNumbers: true, follow: true },
  Peacock: { nav: 'rail', hero: 'bleed', buttons: 'peacock', rowCaps: true, card: 'wide', follow: true },
  'Disney+': { nav: 'rail', hero: 'posters', buttons: 'disney', card: 'wide', chips: true },
  'Apple TV': { nav: 'pill', hero: 'bleed', serif: true, buttons: 'apple', card: 'wide', subtitles: true, home: 'Watch Now' },
  'Paramount+': { nav: 'rail', hero: 'bleed', upper: true, buttons: 'paramount', card: 'wide', follow: true },
};

type Filter = 'all' | 'shows' | 'movies';

/** Pictures and details for a service title: TMDB with your key (sharp, fast), else TVmaze / iTunes, else your provider's. */
function useSvcArt(it: SvcItem, enabled = true) {
  const tm = useTmdb(enabled && tmdbKey() && it.tmdb ? it.kind : undefined, it.tmdb);
  const name = it.match ? itemName(it.match) : it.title;
  const fb = useArt(it.kind === 'movie' ? 'movie' : 'series', name, it.year ? String(it.year) : undefined, enabled && tm === null);
  const m = it.match;
  return {
    poster: tm?.poster ?? fb?.poster ?? (m ? (m.kind === 'movie' ? m.m.poster : m.s.poster) : undefined),
    backdrop: tm?.backdrop ?? (m?.kind === 'series' ? m.s.backdrop : undefined) ?? fb?.backdrop,
    plot: tm?.plot ?? fb?.plot ?? (m?.kind === 'series' ? goodText(m.s.plot) : undefined),
    genre: tm?.genre ?? firstGenre(fb?.genre),
    rating: tm?.rating ?? (m ? (m.kind === 'movie' ? m.m.rating : m.s.rating) : undefined),
    year: it.year ? String(it.year) : tm?.year ?? fb?.year,
  };
}

/**
 * One streaming service's page, full screen, laid out like that service's own app — its menu, featured area,
 * buttons, rows and focus colour — with everything Watchmode lists on the service. Titles your provider has play;
 * the others open their details.
 */
function ServicePage({ svc, onOpen, onPick, onSearch, cont, onResume, onCategory }: { svc: StreamingService; onOpen: (it: VodItem) => void; onPick: (s: StreamingService | null) => void; onSearch: () => void; cont?: ResumeEntry[]; onResume?: (e: ResumeEntry) => void; onCategory?: (kind: VodKind, cat: VodCat) => void }) {
  const all = svc.id === 'all';
  const st = svc.id === 'all' ? { ...SVC_STYLE.Netflix, follow: true } : SVC_STYLE[svc.id] ?? SVC_STYLE.Hulu;
  const [home, setHome] = useState<ServiceHome | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(3);
  const [heroIt, setHeroIt] = useState<SvcItem | null>(null);
  const [info, setInfo] = useState<SvcItem | null>(null);
  useEffect(() => {
    let alive = true;
    loadServiceHome(svc.id, (h) => alive && setHome(h)).catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [svc.id]);
  const rows = useMemo(() => (home?.rows ?? [])
    .map((r) => ({ ...r, items: filter === 'all' ? r.items : r.items.filter((it) => (filter === 'movies') === (it.kind === 'movie')) }))
    .filter((r) => r.items.length >= (r.ranked ? 3 : 4)), [home, filter]);
  useEffect(() => {
    if (shown >= rows.length) return;
    const t = setTimeout(() => setShown((n) => n + 3), 150);
    return () => clearTimeout(t);
  }, [shown, rows.length]);
  const featured = rows.find((r) => !r.ranked)?.items ?? rows[0]?.items ?? [];
  const [pick, setPick] = useState(0);
  useEffect(() => {
    if (st.follow || featured.length < 2) return;
    const t = setInterval(() => {
      if (!document.activeElement?.closest('.svcx-hero')) setPick((n) => (n + 1) % Math.min(8, featured.length));
    }, 9000);
    return () => clearInterval(t);
  }, [featured.length]);
  const current = (st.follow && heroIt) || featured[pick % Math.max(1, Math.min(8, featured.length))];
  const p = svc.page;
  const slug = svc.id === 'all' ? 'netflix' : svc.id.toLowerCase().replace(/[^a-z]+/g, '');
  const open = (it: SvcItem) => (it.match ? onOpen(it.match) : setInfo(it));
  const onCard = (it: SvcItem) => st.follow && setHeroIt(it);
  const nav = <SvcNav svc={svc} st={st} filter={filter} onFilter={(f) => { setFilter(f); setShown(3); setHeroIt(null); }} onSearch={onSearch} onServices={() => onPick(null)} />;
  const playable = home?.rows.reduce((n, r) => n + r.items.filter((x) => x.match).length, 0) ?? 0;
  return (
    <div class={`svc-full svcx svcx-${slug} svcx-nav-${st.nav} svcx-hero-${st.hero}`} style={{ '--svc-top': p.top, '--svc-bottom': p.bottom, '--svc-accent': p.accent } as Record<string, string>}>
      {nav}
      {current && st.hero !== 'posters' && <SvcHero svc={svc} st={st} it={current} onOpen={open} dots={!st.follow ? Math.min(8, featured.length) : 0} dot={pick} />}
      {st.hero === 'posters' && featured.length > 0 && <SvcPosters svc={svc} items={featured.slice(0, 6)} onOpen={open} filter={filter} onFilter={(f) => { setFilter(f); setShown(3); }} />}
      <div class="svcx-rows">
        {all && cont && onResume && (() => {
          const list = cont.filter((e) => filter === 'all' || (filter === 'movies') === !e.key.startsWith('e:'));
          return list.length > 0 && (
            <section class="svcx-row">
              <h2 class="svcx-row-title">Continue Watching</h2>
              <LazyStrip id="svc-continue" count={list.length}>
                {(n) => list.slice(0, n).map((e, i) => <ResumeCard e={e} autofocus={!featured.length && i === 0} onOpen={onResume} />)}
              </LazyStrip>
            </section>
          );
        })()}
        {rows.slice(0, shown).map((r, ri) => (
          <section class={`svcx-row ${r.ranked && st.bigNumbers ? 'svcx-ranked' : ''}`} key={`${filter}:${r.id}`}>
            <h2 class="svcx-row-title">{st.rowCaps ? r.title.toUpperCase() : r.title}</h2>
            <LazyStrip id={`svc-${r.id}`} count={r.items.length}>
              {(n) => r.items.slice(0, n).map((it, i) => (
                <SvcCard it={it} st={st} named={all} rank={r.ranked && st.bigNumbers ? i + 1 : undefined} autofocus={st.buttons === 'none' && ri === 0 && i === 0} onFocus={() => onCard(it)} onOpen={open} />
              ))}
            </LazyStrip>
          </section>
        ))}
        {all && onCategory && home && !home.loading && shown >= rows.length && (home.categories?.length ?? 0) > 0 && (
          <section class="svcx-row">
            <h2 class="svcx-row-title">Browse by Category</h2>
            <div class="vod-strip svcx-cats" data-group="svc-cats" data-hlock>
              {home.categories!.filter((c) => filter === 'all' || c.kind === filter).map((c) => (
                <button type="button" class="f svcx-catbtn" onClick={() => onCategory(c.kind, c.cat)}>
                  <span>{c.cat.name.replace(/^[A-Z]{2,3}\s*[|:-]\s*/, '')}</span><small>{c.kind === 'movies' ? 'Movies' : 'Shows'}</small>
                </button>
              ))}
            </div>
          </section>
        )}
        {(!home || home.loading) && !err && <div class="muted row gap vod-loading"><span class="spinner" /> Loading {svc.label}…</div>}
        {err && <p class="error-text">Couldn’t load {svc.label}: {err}</p>}
        {home && !home.loading && !rows.length && (
          <Empty icon="search" title={svc.id === 'all' ? 'Nothing to show yet' : home.noKey ? `Add a Watchmode key to see ${svc.label}` : `Nothing from ${svc.label} right now`}>
            <p>{home.noKey ? 'With your free Watchmode key (Settings → Movies & Shows), every movie and show on each service shows here.' : 'Watchmode didn’t list anything for this service. Try again later.'}</p>
          </Empty>
        )}
        {home && !home.loading && !home.noKey && !all && <p class="muted svc-note">{playable.toLocaleString()} of these play from your provider. {tmdbKey() ? '' : 'Add a free TMDB key in Settings → Movies & Shows for sharp pictures on every title.'}</p>}
      </div>
      {info && <SvcInfo it={info} svc={svc} onClose={() => setInfo(null)} onSearch={onSearch} />}
    </div>
  );
}

/** A title your provider doesn't have: its picture and details, and that it isn't available to play. */
function SvcInfo({ it, svc, onClose, onSearch }: { it: SvcItem; svc: StreamingService; onClose: () => void; onSearch: () => void }) {
  const art = useSvcArt(it);
  return (
    <Modal title={it.title} onClose={onClose} class="svcx-info">
      {art.backdrop && <div class="svcx-info-img" style={{ backgroundImage: `url("${pic(art.backdrop, 'backdrop')}")` }} />}
      <div class="muted">{[it.kind === 'movie' ? 'Movie' : 'Series', art.year, art.genre, art.rating ? `★ ${art.rating.toFixed(1)}` : ''].filter(Boolean).join(' · ')}</div>
      {art.plot && <p>{art.plot}</p>}
      <p class="svcx-info-note">{svc.id === 'all' ? 'Your provider doesn’t have it right now.' : `On ${svc.label}, but your provider doesn’t have it right now.`}</p>
      <div class="row gap modal-actions">
        <Button variant="primary" icon="search" data-autofocus onClick={() => { onClose(); onSearch(); }}>Search your provider</Button>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

/** The service's menu, with you (your LTTV profile) at the top like the service's own apps. */
function SvcNav({ svc, st, filter, onFilter, onSearch, onServices }: { svc: StreamingService; st: SvcStyle; filter: Filter; onFilter: (f: Filter) => void; onSearch: () => void; onServices: () => void }) {
  const me = currentProfile();
  const avatar = <div class="svcx-avatar" style={me?.color ? { background: me.color } : undefined} title={me?.name}>{(me?.name ?? svc.label).slice(0, 1).toUpperCase()}</div>;
  const items: { id: Filter | 'search' | 'services'; label: string; icon: string }[] = [
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'all', label: st.home ?? 'Home', icon: 'home' },
    { id: 'shows', label: svc.id === 'Netflix' ? 'Shows' : 'TV Shows', icon: 'shows' },
    { id: 'movies', label: 'Movies', icon: 'movie' },
    svc.id === 'all' ? { id: 'services', label: 'Settings', icon: 'settings' } : { id: 'services', label: 'Services', icon: 'grid' },
  ];
  const act = (id: (typeof items)[number]['id']) => (id === 'search' ? onSearch() : id === 'services' ? (svc.id === 'all' ? navigate('settings') : onServices()) : onFilter(id));
  if (st.nav === 'rail') {
    return (
      <nav class="svcx-rail" data-group="svc-nav" data-zone="v">
        {avatar}
        {items.map((n) => (
          <button type="button" class={`f svcx-rail-btn ${n.id === filter ? 'is-on' : ''}`} onClick={() => act(n.id)} aria-label={n.label}>
            <Icon name={n.icon} size="1.7rem" /><span class="svcx-rail-tip">{n.label}</span>
          </button>
        ))}
      </nav>
    );
  }
  const words = st.nav === 'pill' ? [items[1], items[2], items[3], items[4], items[0]] : items;
  return (
    <nav class={`svcx-top svcx-top-${st.nav}`} data-group="svc-nav" data-zone="h" onFocusIn={(ev) => (ev.currentTarget as HTMLElement).closest('.svc-full')?.scrollTo({ top: 0 })}>
      {st.nav === 'top' && avatar}
      <div class="svcx-top-items">
        {words.map((n) => (
          <button type="button" class={`f svcx-top-btn ${n.id === filter ? 'is-on' : ''}`} onClick={() => act(n.id)} aria-label={n.label}>
            {n.id === 'search' ? <Icon name="search" size="1.5rem" /> : n.label}
          </button>
        ))}
      </div>
      {st.nav === 'top' && <div class="svcx-top-mark">{svc.label}</div>}
      {st.nav === 'pill' && <div class="svcx-pill-me">{avatar}</div>}
    </nav>
  );
}

/** The featured area: the title's wide picture behind (or in a rounded card for Netflix), its name, details and the service's buttons. */
function SvcHero({ svc, st, it, onOpen, dots, dot }: { svc: StreamingService; st: SvcStyle; it: SvcItem; onOpen: (it: SvcItem) => void; dots: number; dot: number }) {
  const art = useSvcArt(it);
  const img = art.backdrop ? pic(art.backdrop, 'backdrop') : art.poster ? pic(art.poster, 'poster') : undefined;
  const kindWord = it.kind === 'movie' ? 'Movie' : 'Series';
  const play = async () => {
    const m = it.match;
    if (!m || m.kind === 'series') return onOpen(it);
    const r = await movieResume(m.playlistId, m.m);
    const v = moviePlay(m.playlistId, m.m, r ? Math.max(0, r.pos - 5) : 0);
    if (v) playVod({ ...v, poster: art.poster ?? v.poster });
  };
  const meta = st.buttons === 'netflix'
    ? [it.kind === 'movie' ? 'Movie' : 'Show', art.genre, art.year].filter(Boolean).join(' • ')
    : st.buttons === 'prime'
      ? [art.rating ? `★ ${art.rating.toFixed(1)}` : '', art.year, art.genre].filter(Boolean).join('   ')
      : st.buttons === 'none'
        ? [kindWord, art.year, art.genre].filter(Boolean).join('   ')
        : [art.genre, art.year, kindWord].filter(Boolean).join(' • ');
  const can = !!it.match;
  const btn = (label: string, primary: boolean, onClick: () => void, icon?: string, auto?: boolean) => (
    <button type="button" class={`f svcx-btn ${primary ? 'svcx-btn-main' : 'svcx-btn-alt'}`} data-autofocus={auto ? '' : undefined} onClick={onClick}>
      {icon && <Icon name={icon} size="1.3rem" />}<span>{label}</span>
    </button>
  );
  const playLabel = (l: string) => (can ? l : l === l.toUpperCase() ? 'DETAILS' : 'Details');
  const buttons = {
    hulu: <>{btn(playLabel('PLAY'), true, () => void play(), can ? 'play' : 'info', true)}{can && btn('DETAILS', false, () => onOpen(it), 'chevronRight')}</>,
    netflix: <>{btn(playLabel('Play'), true, () => void play(), can ? 'play' : 'info', true)}{can && btn('More Info', false, () => onOpen(it))}</>,
    apple: <>{btn(can ? (it.kind === 'movie' ? 'Play' : 'Go to Show') : 'Details', true, () => (it.kind === 'movie' ? void play() : onOpen(it)), undefined, true)}</>,
    paramount: <>{btn(can ? 'WATCH NOW' : 'DETAILS', true, () => void play(), undefined, true)}{can && btn('MORE INFO', false, () => onOpen(it), 'info')}</>,
    prime: <>{btn(playLabel('Play'), true, () => void play(), can ? 'play' : 'info', true)}{can && btn('Details', false, () => onOpen(it))}</>,
    peacock: <>{btn(can ? 'Watch Now' : 'Details', true, () => void play(), can ? 'play' : 'info', true)}{can && btn('Details', false, () => onOpen(it))}</>,
    disney: <>{btn(playLabel('PLAY'), true, () => void play(), can ? 'play' : 'info', true)}{can && btn('DETAILS', false, () => onOpen(it))}</>,
    none: null,
  }[st.buttons];
  return (
    <section class="svcx-hero" data-group="svc-hero" data-zone="h" onFocusIn={(ev) => (ev.currentTarget as HTMLElement).closest('.svc-full')?.scrollTo({ top: 0 })}>
      {art.backdrop || !img ? (
        <div class="svcx-hero-img" key={img} style={img ? { backgroundImage: `url("${img}")` } : undefined} />
      ) : (
        <div class="svcx-hero-img svcx-hero-poster" key={img}>
          <div class="svcx-hero-blur" style={{ backgroundImage: `url("${img}")` }} />
          <img src={img} alt="" />
        </div>
      )}
      <div class="svcx-hero-shade" />
      <div class="svcx-hero-text">
        {st.eyebrow && <div class="svcx-eyebrow">{st.eyebrow}</div>}
        {!st.eyebrow && st.buttons !== 'apple' && <div class="svcx-label">{svc.id === 'all' ? '' : `${svc.label.toUpperCase()} `}{it.kind === 'movie' ? 'MOVIE' : 'SERIES'}</div>}
        <h1 class={`svcx-title ${st.upper ? 'is-upper' : ''} ${st.serif ? 'is-serif' : ''} ${it.title.length > 22 ? 'is-long' : ''}`}>{it.title}</h1>
        {st.buttons === 'peacock' && art.rating ? <div class="svcx-chip">★ {art.rating.toFixed(1)}</div> : null}
        {meta && <div class="svcx-meta">{meta}</div>}
        {art.plot && <p class="svcx-plot">{art.plot}</p>}
        {st.buttons === 'prime' && can && <div class="svcx-included"><Icon name="check" size="1.2rem" /> On your provider</div>}
        {!can && svc.id !== 'all' && <div class="svcx-unavail">Not on your provider right now</div>}
        {buttons && <div class="svcx-btns">{buttons}</div>}
      </div>
      {dots > 1 && <div class="svcx-dots" aria-hidden="true">{Array.from({ length: dots }, (_, n) => <span class={n === dot % dots ? 'on' : ''} />)}</div>}
    </section>
  );
}

/** Disney+'s featured area: category pills, the service's name, and big posters. */
function SvcPosters({ svc, items, onOpen, filter, onFilter }: { svc: StreamingService; items: SvcItem[]; onOpen: (it: SvcItem) => void; filter: Filter; onFilter: (f: Filter) => void }) {
  return (
    <section class="svcx-band" data-group="svc-band">
      <div class="svcx-chips" data-group="svc-chips" data-hlock>
        {(['all', 'movies', 'shows'] as Filter[]).map((f, i) => (
          <button type="button" class={`f svcx-chipbtn ${filter === f ? 'is-on' : ''}`} data-autofocus={i === 0 ? '' : undefined} onClick={() => onFilter(f)}>{f === 'all' ? 'Featured' : f === 'movies' ? 'Movies' : 'Series'}</button>
        ))}
      </div>
      <div class="svcx-band-body">
        <div class="svcx-band-text">
          <div class="svcx-band-name">{svc.label}</div>
          <p>Everything on {svc.label}.</p>
        </div>
        <div class="svcx-band-posters" data-hlock>
          {items.map((it) => <SvcCard it={it} st={{ ...SVC_STYLE['Disney+'], card: 'poster' }} onFocus={() => undefined} onOpen={onOpen} big />)}
        </div>
      </div>
    </section>
  );
}

/**
 * A title card in the service's shape. Wide cards use the title's wide picture; when there isn't one, the poster
 * sits on a blurred copy of itself with the name beside it (instead of a stretched, cropped poster).
 */
function SvcCard({ it, st, rank, autofocus, onFocus, onOpen, big, named }: { it: SvcItem; st: SvcStyle; rank?: number; autofocus?: boolean; onFocus: () => void; onOpen: (it: SvcItem) => void; big?: boolean; named?: boolean }) {
  const art = useSvcArt(it);
  const wide = st.card === 'wide';
  const back = wide ? art.backdrop : undefined;
  const poster = art.poster ? pic(art.poster, 'poster') : undefined;
  return (
    <div class={`svcx-card-wrap ${rank ? 'has-rank' : ''} ${it.match ? '' : 'is-off'}`}>
      {rank && <span class="svcx-num" aria-hidden="true">{rank}</span>}
      <div class="svcx-cardcol">
      <button
        type="button"
        class={`f svcx-card ${wide ? 'is-wide' : 'is-poster'} ${big ? 'is-big' : ''}`}
        data-autofocus={autofocus ? '' : undefined}
        onFocus={onFocus}
        onClick={() => onOpen(it)}
        aria-label={it.title}
      >
        {back ? (
          <div class="svcx-card-img" style={{ backgroundImage: `url("${pic(back, 'backdrop')}")` }} />
        ) : wide && poster ? (
          <div class="svcx-card-img svcx-pw">
            <div class="svcx-pw-blur" style={{ backgroundImage: `url("${poster}")` }} />
            <img class="svcx-pw-poster" src={poster} alt="" loading="lazy" />
            <span class="svcx-pw-name">{it.title}</span>
          </div>
        ) : (
          <div class="svcx-card-img" style={poster ? { backgroundImage: `url("${poster}")` } : undefined}>
            {!poster && <span class="svcx-card-name">{it.title}</span>}
          </div>
        )}
      </button>
      {(st.subtitles || named) && <div class="svcx-sub"><b>{it.title}</b><span>{[it.kind === 'movie' ? 'Movie' : 'Series', art.year, art.genre].filter(Boolean).join(' · ')}</span></div>}
      </div>
    </div>
  );
}

/** Continue Watching: the title's picture with how far you got, its name and what's next under it. */
function ResumeCard({ e, autofocus, onOpen }: { e: ResumeEntry; autofocus?: boolean; onOpen: (e: ResumeEntry) => void }) {
  const isShow = e.key.startsWith('e:');
  const name = e.series?.name ?? e.title;
  const art = useArt(isShow ? 'series' : 'movie', name, e.series?.year, true);
  const back = art?.backdrop;
  const poster = art?.poster ?? e.series?.poster ?? (isShow ? undefined : e.poster);
  const pct = e.done ? 100 : Math.min(100, (e.pos / Math.max(1, e.dur)) * 100);
  const left = `${fmtClock(Math.max(0, e.dur - e.pos))} left`;
  const sub = e.series ? (e.done ? `Next after S${e.series.season} E${e.series.episode}` : `S${e.series.season} E${e.series.episode} · ${left}`) : left;
  return (
    <div class="svcx-card-wrap"><div class="svcx-cardcol">
      <button type="button" class="f svcx-card is-wide" data-autofocus={autofocus ? '' : undefined} onClick={() => onOpen(e)} aria-label={name}>
        {back ? <div class="svcx-card-img" style={{ backgroundImage: `url("${pic(back, 'backdrop')}")` }} />
          : poster ? (
            <div class="svcx-card-img svcx-pw">
              <div class="svcx-pw-blur" style={{ backgroundImage: `url("${pic(poster, 'poster')}")` }} />
              <img class="svcx-pw-poster" src={pic(poster, 'poster')} alt="" loading="lazy" />
              <span class="svcx-pw-name">{name}</span>
            </div>
          ) : <div class="svcx-card-img"><span class="svcx-card-name">{name}</span></div>}
        <span class="svcx-progress"><span style={{ width: `${pct}%` }} /></span>
      </button>
      <div class="svcx-sub"><b>{name}</b><span>{sub}</span></div>
    </div></div>
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

type SortBy = 'provider' | 'added' | 'year' | 'az' | 'rating';
const SORTS: { value: SortBy; label: string }[] = [
  { value: 'provider', label: 'Recommended' },
  { value: 'added', label: 'Recently added' },
  { value: 'year', label: 'Newest first' },
  { value: 'az', label: 'A to Z' },
  { value: 'rating', label: 'Top rated' },
];
type Era = 'all' | 'new' | '2020s' | '2010s' | 'older';
const ERAS: { value: Era; label: string }[] = [
  { value: 'all', label: 'All years' },
  { value: 'new', label: 'This year and last' },
  { value: '2020s', label: '2020s' },
  { value: '2010s', label: '2010s' },
  { value: 'older', label: 'Before 2010' },
];
const yearNum = (it: VodItem) => Number((it.kind === 'movie' ? it.m.year : it.s.year) ?? /\b(19|20)\d\d\b/.exec(itemName(it))?.[0]) || 0;
function inEra(y: number, e: Era): boolean {
  if (e === 'all') return true;
  if (!y) return false;
  const now = new Date().getFullYear();
  return e === 'new' ? y >= now - 1 : e === '2020s' ? y >= 2020 : e === '2010s' ? y >= 2010 && y < 2020 : y < 2010;
}

function CategoryGrid({ kind, cat, onOpen, load, emptyNote }: { kind: VodKind; cat: VodCat; onOpen: (it: VodItem) => void; load?: () => Promise<VodItem[]>; emptyNote?: string }) {
  const [items, setItems] = useState<VodItem[] | null>(null);
  const [err, setErr] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [sort, setSort] = useState<SortBy>('provider');
  const [era, setEra] = useState<Era>('all');
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    let alive = true;
    setItems(null);
    setShown(PAGE);
    (load ? load() : loadCategoryItems(kind, cat)).then((l) => alive && setItems(dedupe(l))).catch((e) => alive && (setErr((e as Error).message), setItems([])));
    return () => {
      alive = false;
    };
  }, [cat.key]);
  const list = useMemo(() => {
    if (!items) return [];
    const l = items.filter((it) => inEra(yearNum(it), era));
    const rating = (it: VodItem) => (it.kind === 'movie' ? it.m.rating : it.s.rating) ?? 0;
    const added = (it: VodItem) => (it.kind === 'movie' ? it.m.added : it.s.added) ?? 0;
    if (sort === 'az') l.sort((a, b) => cleanTitle(itemName(a)).localeCompare(cleanTitle(itemName(b))));
    else if (sort === 'year') l.sort((a, b) => yearNum(b) - yearNum(a));
    else if (sort === 'rating') l.sort((a, b) => rating(b) - rating(a));
    else if (sort === 'added') l.sort((a, b) => added(b) - added(a));
    return l;
  }, [items, sort, era]);
  const label = kind === 'movies' ? 'Movies' : 'TV Shows';
  const unit = kind === 'movies' ? 'films' : 'shows';
  const changed = sort !== 'provider' || era !== 'all';
  return (
    <>
      <div class="vod-grid-head">
        <h2>{label}: {cat.name.replace(/^[A-Z]{2,3}\s*[|:-]\s*/, '')} {items && <small class="muted">{list.length.toLocaleString()} {list.length === 1 ? unit.slice(0, -1) : unit}</small>}</h2>
        <Button class={`vod-filter-btn ${changed ? 'is-on' : ''}`} icon="menu" onClick={() => setMenu(true)}>Filter and sort</Button>
      </div>
      {!items ? <div class="muted row gap"><span class="spinner" /> Loading…</div>
        : !list.length ? <Empty icon="search" title={err ? 'This category didn’t load' : 'Nothing here'}>{err ? <p>{err}</p> : emptyNote && <p>{emptyNote}</p>}</Empty>
        : (
          <div class="vod-grid vod-grid-posters" data-group="vod-grid" data-hlock>
            {list.slice(0, shown).map((it, i) => <GridCard key={`${it.playlistId}:${it.kind === 'movie' ? it.m.id : it.s.id}`} it={it} autofocus={i === 0} onOpen={onOpen} />)}
          </div>
        )}
      {list.length > shown && (
        <div class="row vod-more">
          <Button icon="add" onClick={() => setShown((n) => n + PAGE)}>Show more ({(list.length - shown).toLocaleString()} left)</Button>
        </div>
      )}
      {menu && (
        <Modal title="Filter and sort" onClose={() => setMenu(false)}>
          <h3 class="vod-sort-h">Sort by</h3>
          <div class="row gap wrap">{SORTS.map((o, i) => <Chip active={sort === o.value} data-autofocus={sort === o.value || (i === 0 && !SORTS.some((x) => x.value === sort)) ? '' : undefined} onClick={() => { setSort(o.value); setShown(PAGE); }}>{o.label}</Chip>)}</div>
          <h3 class="vod-sort-h">Year</h3>
          <div class="row gap wrap">{ERAS.map((o) => <Chip active={era === o.value} onClick={() => { setEra(o.value); setShown(PAGE); }}>{o.label}</Chip>)}</div>
          <div class="row gap modal-actions">
            <Button variant="primary" onClick={() => setMenu(false)}>Done</Button>
            {changed && <Button variant="ghost" onClick={() => { setSort('provider'); setEra('all'); }}>Reset</Button>}
          </div>
        </Modal>
      )}
    </>
  );
}

/** A poster in a category grid with "Title - Year" under it. */
function GridCard({ it, onOpen, autofocus }: { it: VodItem; onOpen: (it: VodItem) => void; autofocus?: boolean }) {
  const name = itemName(it);
  const year = it.kind === 'movie' ? it.m.year : it.s.year;
  const clean = cleanTitle(name) || name;
  const y = year ?? /\b(19|20)\d\d\b/.exec(name)?.[0];
  return (
    <button type="button" class="f vod-card vod-gcard" data-autofocus={autofocus ? '' : undefined} onClick={() => onOpen(it)}>
      <ArtPoster kind={it.kind} name={name} year={year} src={it.kind === 'movie' ? it.m.poster : it.s.poster} />
      <div class="vod-gname">{y && !clean.includes(y) ? `${clean} - ${y}` : clean}</div>
    </button>
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
    return dedupe(found.sort((a, b) => Number(isEnglishCategory(itemName(b))) - Number(isEnglishCategory(itemName(a))))).slice(0, 120);
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

function Facts({ d, year, rating, quality }: { d: VodDetails; year?: string; rating?: number; quality?: string }) {
  const bits = [d.year ?? year, formatDuration(d.durationSec), d.genre, (d.rating ?? rating) ? `★ ${(d.rating ?? rating)!.toFixed(1)}` : ''].filter(Boolean);
  return bits.length || quality ? <div class="vod-facts muted">{quality && <span class="vod-quality">{quality}</span>}{bits.join(' · ')}</div> : null;
}

/** "4K · 1080p · 720p" choice when the provider has the title more than once. */
function VersionChips({ versions, sel, onSel }: { versions: VodVersion[]; sel: number; onSel: (i: number) => void }) {
  if (versions.length < 2) return null;
  return (
    <div class="chips compact vod-versions" data-group="vod-versions">
      {versions.map((v, i) => <Chip key={i} active={i === sel} onClick={() => onSel(i)}>{v.quality.label || `Version ${i + 1}`}</Chip>)}
    </div>
  );
}

/** Heights from the provider's media info for copies whose name doesn't say (up to 4), then best first. */
async function refineVersions(vs: VodVersion[]): Promise<VodVersion[]> {
  const out = await Promise.all(vs.map(async (v, i) => {
    if (v.item.kind !== 'movie' || v.quality.rank !== 2 || i > 3) return v;
    const d = await loadMovieDetails(v.item.playlistId, v.item.m);
    return { ...v, quality: qualityOf(v.item.m.name, d.height) };
  }));
  return out.sort((a, b) => b.quality.rank - a.quality.rank);
}

const goodText = (t?: string) => (t && !isForeignScript(t) ? t : undefined);

/** Other titles from the same category of your provider's library. */
function MoreLike({ kind, playlistId, categoryId, selfName, onOpen }: { kind: VodKind; playlistId: string; categoryId: string; selfName: string; onOpen: (it: VodItem) => void }) {
  const [items, setItems] = useState<VodItem[]>([]);
  useEffect(() => {
    let alive = true;
    if (!categoryId) return;
    void (async () => {
      const cat = (await loadCategories(kind)).find((c) => c.playlistId === playlistId && c.id === categoryId);
      if (!cat) return;
      const list = dedupe(await loadCategoryItems(kind, cat)).filter((it) => itemName(it) !== selfName).slice(0, 18);
      if (alive) setItems(list);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [playlistId, categoryId]);
  if (!items.length) return null;
  return (
    <section class="vod-row">
      <h2 class="vod-row-title">More like this</h2>
      <div class="vod-strip" data-group="vod-more-like" data-hlock>
        {items.map((it) => <ItemCard it={it} onOpen={onOpen} />)}
      </div>
    </section>
  );
}

function MovieDetail({ playlistId, m, onClose, onOpen }: { playlistId: string; m: VodMovie; onClose: () => void; onOpen: (it: VodItem) => void }) {
  const first: VodVersion = { item: { kind: 'movie', playlistId, m }, quality: qualityOf(m.name) };
  const [versions, setVersions] = useState<VodVersion[]>([first]);
  const [sel, setSel] = useState(0);
  const cur = versions[sel]?.item as Extract<VodItem, { kind: 'movie' }>;
  const [d, setD] = useState<VodDetails | null>(null);
  const [resume, setResume] = useState<ResumeEntry | undefined>();
  const art = useArt('movie', m.name, m.year, true, true);
  const playing = useApp((s) => !!s.vodPlaying);
  useEffect(() => {
    let alive = true;
    void findVersions(first.item).then(refineVersions).then(async (vs) => {
      if (!alive || vs.length < 2) return;
      // A copy you already started wins; otherwise the best quality (1080p first).
      let pick = 0;
      for (let i = 0; i < vs.length; i++) {
        const it = vs[i].item as Extract<VodItem, { kind: 'movie' }>;
        if ((await resumePosition(`m:${it.playlistId}:${it.m.id}`))) {
          pick = i;
          break;
        }
      }
      setVersions(vs);
      setSel(pick);
    });
    return () => {
      alive = false;
    };
  }, [m.id]);
  useEffect(() => {
    setD(null);
    void loadMovieDetails(cur.playlistId, cur.m).then(setD);
    void movieResume(cur.playlistId, cur.m).then(setResume);
  }, [cur.m.id, playing]);
  const play = (startSec?: number) => {
    const v = moviePlay(cur.playlistId, cur.m, startSec);
    const genre = d?.genre ?? art?.genre;
    const meta = [d?.year ?? cur.m.year ?? art?.year, formatDuration(d?.durationSec), genre, (d?.rating ?? cur.m.rating) ? `★ ${(d?.rating ?? cur.m.rating)!.toFixed(1)}` : ''].filter(Boolean).join(' · ');
    if (v) playVod({ ...v, poster: art?.poster ?? v.poster, kicker: ['Movies', genre?.split(/[,/]/)[0]?.trim()].filter(Boolean).join(' · '), meta });
  };
  const quality = qualityOf(cur.m.name, d?.height).label;
  const plot = goodText(d?.plot) ?? art?.plot;
  return (
    <Modal title={tt(m.name)} onClose={onClose} wide class="vod-detail">
      {(d?.backdrop || art?.poster || m.poster) && <div class={`vod-detail-bg ${d?.backdrop ? '' : 'is-poster'}`} style={{ backgroundImage: `url("${pic(d?.backdrop, 'backdrop') ?? pic(art?.poster ?? m.poster, 'poster')}")` }} />}
      <div class="vod-detail-body">
        <Poster src={art?.poster ?? d?.poster ?? m.poster} name={m.name} />
        <div class="vod-detail-text">
          <Facts d={{ ...(d ?? {}), genre: d?.genre ?? art?.genre }} year={m.year ?? art?.year} rating={m.rating} quality={quality} />
          <VersionChips versions={versions} sel={sel} onSel={setSel} />
          {d === null && art === undefined ? <p class="muted row gap"><span class="spinner" /> Loading details…</p> : plot ? <p class="vod-plot">{plot}</p> : null}
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
      <CastRow cast={d?.cast} director={d?.director} />
      <MoreLike kind="movies" playlistId={cur.playlistId} categoryId={cur.m.categoryId} selfName={m.name} onOpen={onOpen} />
    </Modal>
  );
}

type SeriesInfo = Awaited<ReturnType<typeof loadSeriesDetails>>;

/** The episode a show's page selects: the one watched last — or the next one when it was finished. */
/** An episode's picture: its own stills in order; if they don't load, the show's artwork with the number; else the number. */
function EpisodeImage({ srcs, fallback, num }: { srcs: string[]; fallback?: string; num: number }) {
  const [i, setI] = useState(0);
  const [fbBad, setFbBad] = useState(false);
  const key = srcs.join('|');
  useEffect(() => {
    setI(0);
    setFbBad(false);
  }, [key, fallback]);
  if (i < srcs.length) return <img class="vod-ep-img" src={pic(srcs[i], 'still')} alt="" loading="lazy" onError={() => setI(i + 1)} />;
  if (fallback && !fbBad) return <span class="vod-ep-img vod-ep-fallback"><img src={fallback} alt="" loading="lazy" onError={() => setFbBad(true)} /><b>{num}</b></span>;
  return <span class="vod-ep-num">{num}</span>;
}

/** "2019-03-04" -> "Mar 4, 2019" (an episode's air date). */
function fmtAirDate(d?: string): string {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return '';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, day);
  if (Number.isNaN(dt.getTime())) return '';
  const label = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return dt.getTime() > Date.now() ? `Airs ${label}` : label;
}

function targetEpisode(info: SeriesInfo | null, r: ResumeEntry | undefined): VodEpisode | undefined {
  if (!info) return undefined;
  const flat = info.seasons.flatMap((x) => x.episodes);
  if (!r) return flat[0];
  const id = r.series?.episodeId ?? r.key.split(':').pop();
  const i = flat.findIndex((e) => e.id === id);
  if (i < 0) return (r.series && flat.find((e) => e.season === r.series!.season && e.episode === r.series!.episode)) || flat[0];
  return r.done && flat[i + 1] ? flat[i + 1] : flat[i];
}

function SeriesDetail({ playlistId, s, onClose, onOpen }: { playlistId: string; s: VodSeries; onClose: () => void; onOpen: (it: VodItem) => void }) {
  const first: VodVersion = { item: { kind: 'series', playlistId, s }, quality: qualityOf(s.name) };
  const [versions, setVersions] = useState<VodVersion[]>([first]);
  const [sel, setSel] = useState(0);
  const cur = versions[sel]?.item as Extract<VodItem, { kind: 'series' }>;
  const [info, setInfo] = useState<SeriesInfo | null>(null);
  const [err, setErr] = useState('');
  const [season, setSeason] = useState<number | null>(null);
  const all = useContinueWatching();
  const art = useArt('series', s.name, s.year, true, true);
  const playing = useApp((st) => !!st.vodPlaying);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void findVersions(first.item).then((vs) => {
      if (!alive || vs.length < 2) return;
      // The copy you've been watching wins; otherwise the best quality.
      const watched = vs.findIndex((v) => all.some((r) => r.series?.id === (v.item as Extract<VodItem, { kind: 'series' }>).s.id && r.playlistId === v.item.playlistId));
      setVersions(vs);
      setSel(Math.max(0, watched));
    });
    return () => {
      alive = false;
    };
  }, [s.id]);
  useEffect(() => {
    setInfo(null);
    loadSeriesDetails(cur.playlistId, cur.s).then(setInfo).catch((e) => {
      setErr((e as Error).message);
      setInfo({ details: {}, seasons: [] });
    });
  }, [cur.s.id]);

  // The episode watched last: by show id, or (older entries) by any of this show's episodes.
  const last = useMemo(() => {
    const keys = new Set((info?.seasons ?? []).flatMap((x) => x.episodes.map((e) => `e:${cur.playlistId}:${e.id}`)));
    // Also progress from another provider / copy of this show (matched by name, then by season + episode).
    return all.filter((r) => keys.has(r.key) || (r.series?.id === cur.s.id && r.playlistId === cur.playlistId)).sort((a, b) => b.at - a.at)[0] ?? lastWatched(all, cur.playlistId, cur.s.id) ?? showEntries(all, cur.s.name).sort((a, b) => b.at - a.at)[0];
  }, [all, info, cur.s.id]);
  const target = targetEpisode(info, last);
  const shownSeason = season ?? target?.season ?? info?.seasons[0]?.season ?? null;
  const seasonEps = info?.seasons.find((x) => x.season === shownSeason)?.episodes ?? [];
  const d = info?.details ?? {};
  // Episodes without their own still use the show's artwork (wide backdrop first).
  const epFallbackImg = cur.s.backdrop ?? d.backdrop ?? art?.poster ?? cur.s.poster;
  const named = useMemo(() => showEntries(all, cur.s.name), [all, cur.s.name]);
  const resumeOf = (e: VodEpisode) => all.find((r) => r.key === `e:${cur.playlistId}:${e.id}`) ?? named.find((r) => r.series?.season === e.season && r.series?.episode === e.episode);

  // When the episodes arrive, select the one watched last (or the first).
  useEffect(() => {
    if (!info || playing) return;
    const t = setTimeout(() => {
      const list = listRef.current;
      const el = list?.querySelector<HTMLElement>('[data-target]') ?? list?.querySelector<HTMLElement>('.vod-episode');
      if (el && list && !list.contains(document.activeElement)) {
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'nearest' });
      }
    }, 80);
    return () => clearTimeout(t);
  }, [info]);

  // Back from the player: this page again, with the episode watched last (or the next one) selected — like Hulu.
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (playing) {
      wasPlaying.current = true;
      return;
    }
    if (!wasPlaying.current) return;
    wasPlaying.current = false;
    setSeason(null);
    const t = setTimeout(() => listRef.current?.querySelector<HTMLElement>('[data-target]')?.focus(), 120);
    return () => clearTimeout(t);
  }, [playing]);

  const play = (e: VodEpisode, startSec?: number) => {
    if (!info) return;
    const flat = info.seasons.flatMap((x) => x.episodes);
    const i = flat.findIndex((x) => x.id === e.id);
    const show = { ...cur.s, poster: art?.poster ?? cur.s.poster };
    const v = episodePlay(cur.playlistId, show, e, startSec);
    if (!v) return;
    v.kicker = 'Shows';
    v.meta = formatDuration(e.durationSec) || undefined;
    v.queue = flat.slice(i + 1, i + 31).map((x) => episodePlay(cur.playlistId, show, x)).filter((x): x is VodPlay => !!x);
    playVod(v);
  };
  const epArt = (e: VodEpisode) => art?.episodes?.[`${e.season}:${e.episode}`];
  const plot = goodText(d.plot) ?? goodText(s.plot) ?? art?.plot;

  return (
    <Modal title={tt(s.name)} onClose={onClose} wide class="vod-detail">
      {(s.backdrop || art?.poster || s.poster) && <div class={`vod-detail-bg ${s.backdrop ? '' : 'is-poster'}`} style={{ backgroundImage: `url("${pic(s.backdrop, 'backdrop') ?? pic(art?.poster ?? s.poster, 'poster')}")` }} />}
      <div class="vod-detail-body">
        <Poster src={art?.poster ?? d.poster ?? s.poster} name={s.name} />
        <div class="vod-detail-text">
          <Facts d={{ ...d, genre: d.genre ?? art?.genre }} year={s.year ?? art?.year} rating={s.rating ?? art?.rating} quality={versions[sel]?.quality.label} />
          <VersionChips versions={versions} sel={sel} onSel={(i) => { setSel(i); setSeason(null); }} />
          {plot && <p class="vod-plot">{plot}</p>}
          {!info ? (
            <p class="muted row gap"><span class="spinner" /> Loading episodes…</p>
          ) : info.seasons.length === 0 ? (
            <p class="muted">{err ? `Episodes didn’t load: ${err}` : 'The provider lists no episodes for this show.'}</p>
          ) : (
            <>
              {info.seasons.length > 1 && (
                <div class="chips compact" data-group="vod-seasons">
                  {info.seasons.map((x) => (
                    <Chip key={x.season} active={x.season === shownSeason} onClick={() => setSeason(x.season)}>Season {x.season}</Chip>
                  ))}
                </div>
              )}
              <div class="vod-episodes" data-group="vod-episodes" ref={listRef}>
                {seasonEps.map((e, i) => {
                  const r = resumeOf(e);
                  const a = epArt(e);
                  const isTarget = target?.id === e.id;
                  const name = episodeName(s.name, e) || a?.title || `Episode ${e.episode || i + 1}`;
                  const watched = !!r?.done;
                  return (
                    <button
                      type="button"
                      class={`f vod-episode ${isTarget ? 'is-target' : ''}`}
                      key={e.id}
                      data-ep-id={e.id}
                      data-target={isTarget ? '' : undefined}
                      data-autofocus={(target && shownSeason === target.season ? isTarget : i === 0) ? '' : undefined}
                      onClick={() => play(e, r && !r.done ? Math.max(0, r.pos - 5) : 0)}
                    >
                      {/* Every episode gets a picture: its own still (TVmaze, then the provider), else the show's artwork. */}
                      <EpisodeImage srcs={[a?.image, e.image].filter((x): x is string => !!x)} fallback={epFallbackImg} num={e.episode || i + 1} />
                      <span class="vod-ep-text">
                        <span class="vod-ep-title">{e.episode ? `${e.episode}. ` : ''}{name}</span>
                        <span class="muted vod-ep-meta">
                          {[fmtAirDate(a?.airDate ?? e.airDate), formatDuration(e.durationSec ?? (a?.runtime ? a.runtime * 60 : undefined)), watched ? 'Watched' : r ? `Resume at ${fmtClock(r.pos)}` : '', isTarget && last ? (watched ? '' : 'Continue') : ''].filter(Boolean).join(' · ')}
                        </span>
                        {(goodText(e.plot) ?? a?.plot) && <span class="muted vod-ep-plot">{goodText(e.plot) ?? a?.plot}</span>}
                      </span>
                      {r && !watched && <span class="vod-ep-bar"><span style={{ width: `${Math.min(100, (r.pos / Math.max(1, r.dur)) * 100)}%` }} /></span>}
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
      <CastRow cast={d.cast ?? s.cast} director={d.director} />
      <MoreLike kind="shows" playlistId={playlistId} categoryId={s.categoryId} selfName={s.name} onOpen={onOpen} />
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
  // SD video isn't blown up to full screen (sharper, its own shape) unless "Picture: Full screen" is chosen.
  const sdPicture = useApp((s) => s.settings.sdPicture ?? 'sharp');
  const isSd = !!status.videoHeight && status.videoHeight <= 576;
  useEffect(() => {
    native?.setPictureMode?.(sdPicture);
  }, [sdPicture]);

  const save = () => {
    const p = posRef.current;
    if (p.dur > 0) void saveProgress({ key: v.key, title: v.title, subtitle: v.subtitle, poster: v.poster, pos: p.at, dur: p.dur, url: v.url, playlistId: v.playlistId, series: v.series, hasNext: !!v.queue?.length });
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
    void saveProgress({ key: v.key, title: v.title, subtitle: v.subtitle, poster: v.poster, pos: posRef.current.dur, dur: posRef.current.dur, url: v.url, playlistId: v.playlistId, series: v.series, hasNext: !!v.queue?.length });
    const [next, ...rest] = v.queue ?? [];
    if (next) setState({ vodPlaying: { ...next, queue: rest } });
    else close();
  }, [status.state]);

  const captions = useApp((st) => !!st.settings.captions);
  const toggleCaptions = () => {
    const on = !captions;
    void updateSettings({ captions: on });
    player.setCaptions(on);
    poke();
  };

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
  const [hint, setHint] = useState('');
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
      <div class="osd-top">
        <button type="button" class="f osd-back" onClick={close} aria-label="Close" data-nav-skip={controls ? undefined : ''}><Icon name="chevronLeft" size="1.3em" /></button>
        <span class="osd-src">{v.kicker?.split(' · ')[0] ?? 'LTTV'}</span>
        <span class="osd-spacer" />
        <span class="osd-clock">{clock(Date.now())}</span>
      </div>
      <div class="osd vod-osd">
        <div class="osd-tags">
          {status.videoHeight ? <span class="osd-badge">{qualityOf('', status.videoHeight).label || `${status.videoHeight}p`}</span> : null}
          {v.kicker && <span>{v.kicker}</span>}
          {captions && status.textTracks === 0 ? <span>No captions in this video</span> : null}
        </div>
        <div class="osd-title">{tt(v.title)}</div>
        {(v.subtitle || v.meta) && <div class="osd-meta">{(v.kicker === 'Shows' || !v.meta ? [v.subtitle, v.meta] : [v.meta]).filter(Boolean).join(' · ')}</div>}
        <div class="osd-bar vod-controls" data-group="vod-controls" data-nav-skip={controls ? undefined : ''} onFocusIn={(e) => setHint((e.target as HTMLElement).getAttribute('aria-label') ?? '')}>
          <button type="button" class="f osd-play" data-autofocus onClick={() => { player.togglePause(); poke(); }} aria-label={paused ? 'Play' : 'Pause'}><Icon name={paused ? 'play' : 'pause'} size="1.6rem" /></button>
          <span class="osd-status">{controls && hint ? hint : `${paused ? 'Paused' : 'Playing'}${pos.dur ? ` · ends at ${clock(Date.now() + (pos.dur - pos.at) * 1000)}` : ''}`}</span>
          <span class="osd-spacer" />
          <button type="button" class="f osd-round" onClick={() => skip(-1)} aria-label="Back 10 seconds"><Icon name="rewind" /></button>
          <button type="button" class="f osd-round" onClick={() => skip(1)} aria-label="Forward 10 seconds"><Icon name="ffwd" /></button>
          {v.queue?.length ? <button type="button" class="f osd-round" onClick={nextEpisode} aria-label="Next episode"><Icon name="chevronRight" /></button> : null}
          <button type="button" class={`f osd-round osd-cc ${captions ? 'on' : ''}`} onClick={toggleCaptions} aria-pressed={captions} aria-label={captions ? 'Captions on' : 'Captions off'}>CC</button>
          {isSd && native?.setPictureMode && (
            <button type="button" class="f osd-round" onClick={() => void updateSettings({ sdPicture: sdPicture === 'sharp' ? 'full' : 'sharp' })} aria-label={sdPicture === 'sharp' ? 'Picture: sharper' : 'Picture: full screen'}><Icon name="fullscreen" /></button>
          )}
          <button type="button" class="f osd-round" onClick={close} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div class="osd-progress">
          <span>{fmtClock(pos.at)}</span>
          <div class="osd-track" aria-hidden="true">
            <div class="osd-fill" style={{ width: `${frac * 100}%` }} />
            <div class="osd-knob" style={{ left: `${frac * 100}%` }} />
          </div>
          <span>{pos.dur ? `-${fmtClock(pos.dur - pos.at)}` : ''}</span>
        </div>
        <div class="osd-hints muted">{controls ? '◀ ▶ choose · OK select · ▲ hide' : '◀ ▶ seek · OK pause · ▼ controls · Back to close'}</div>
      </div>
    </div>
  );
}

/** Whether the menu should show Movies / Shows (only when the playlists have them). */
export function useVodNav(): { movies: boolean; shows: boolean } {
  return useApp((s) => s.vodAvail) ?? { movies: false, shows: false };
}

