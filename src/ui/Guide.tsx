import { ChannelName } from './ChannelName';
import { onBack } from '../app/nav';
import { h, Fragment } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp, setState, tune, getState, refreshAll, toast } from '../app/state';
import { filterLineup, type CategoryFilter } from '../core/organize';
import { layoutRow, halfHourTicks, timeToX } from '../core/guide';
import { floorToHalfHour } from '../core/time';
import { isUsableMatch } from '../core/match';
import type { LineupChannel, Programme } from '../core/types';
import { ChannelLogo, Icon, Button, Progress, useRemPx, Empty } from './common';
import { VideoSlot } from './VideoSlot';
import { useCategoryChips, usePlayerStatus, PlayerBadge, validFilter, Welcome } from './Home';
import { subProviders } from '../core/organize';
import { ProgDesc } from './ProgDesc';
import { prefetchDescriptions } from '../app/describe';
import { LiveTeamBanner } from './Sports';
import { Modal } from './common';
import { clock, day, range, progress, remaining, UNAVAILABLE } from './fmt';
import { navigate } from '../app/state';

const STEP = 30 * 60_000;

interface Cursor {
  row: number;
  /** focused programme (undefined = the channel cell or an "unavailable" row) */
  start?: number;
  col: 'channel' | 'grid';
  /** time anchor used when moving vertically */
  anchor: number;
}

export function GuideScreen() {
  const lineup = useApp((s) => s.lineup);
  const guide = useApp((s) => s.guide);
  const guideVersion = useApp((s) => s.guideVersion);
  const now = useApp((s) => s.now);
  const settings = useApp((s) => s.settings);
  const matches = useApp((s) => s.matches);
  const currentKey = useApp((s) => s.currentKey);
  const recents = useApp((s) => s.recents);
  const playlists = useApp((s) => s.playlists);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const rem = useRemPx();
  const tz = settings.timeZone || undefined;
  const floor = (t: number) => floorToHalfHour(t, tz);

  // Same country tab as Live TV.
  const [savedFilter, setSavedFilter] = useState<CategoryFilter>(() => {
    try {
      return (sessionStorage.getItem('homeFilter') as CategoryFilter) || 'country:us';
    } catch {
      return 'country:us';
    }
  });
  const setFilter = (f: CategoryFilter) => {
    setSavedFilter(f);
    try {
      sessionStorage.setItem('homeFilter', String(f));
    } catch {
      /* ignore */
    }
  };
  // Back on Live TV: from the channels go to the country tabs first, then to the menu (sidebar), then out.
  useEffect(() => onBack(() => {
    const a = document.activeElement as HTMLElement | null;
    const content = document.querySelector('[data-group="content"]');
    if (!a || !content?.contains(a)) return false;
    if (!a.closest('.country-tabs')) {
      const tab = document.querySelector<HTMLElement>('.country-tabs .chip-active') ?? document.querySelector<HTMLElement>('.country-tabs .chip');
      if (tab) {
        tab.focus();
        tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return true;
      }
    }
    const item = document.querySelector<HTMLElement>('.sidebar .nav-item.active') ?? document.querySelector<HTMLElement>('.sidebar .nav-item');
    item?.focus();
    return !!item;
  }), []);
  const chips = useCategoryChips(lineup);
  const filter = validFilter(savedFilter, chips);
  const rows = useMemo(() => filterLineup(lineup, filter, { recents }), [lineup, filter, recents]);

  const minStart = floor(Date.now() - settings.epgKeepPastHours * 3600_000);
  const coverage = useMemo(() => guide.coverage(), [guide, guideVersion]);
  const maxStart = Math.max(floor(Date.now()) + 6 * 3600_000, coverage ? floor(coverage.end) - STEP : 0);

  const [viewStart, setViewStart] = useState(() => floor(Date.now()));
  const gridRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [gridW, setGridW] = useState(1200);
  const [bodyH, setBodyH] = useState(600);
  const [scrollRow, setScrollRow] = useState(() => Math.max(0, rows.findIndex((c) => c.key === currentKey) - 2));
  const [cursor, setCursor] = useState<Cursor>(() => {
    const row = Math.max(0, rows.findIndex((c) => c.key === currentKey));
    const ch = rows[row];
    const t = Date.now();
    const cur = ch && isUsableMatch(matches.get(ch.key)) ? guide.range(ch.epgChannelId, t, t + 1)[0] : undefined;
    return { row, col: 'grid', anchor: t, start: cur?.start };
  });
  // The grid owns focus when the guide opens, so the remote starts on "what's on now".
  const [active, setActive] = useState(true);

  const chW = 21 * rem;
  const rowH = 5 * rem;
  const span = settings.guideHoursVisible * 3600_000;
  const pxPerMin = gridW / (span / 60000);
  const viewEnd = viewStart + span;
  const visibleRows = Math.max(1, Math.floor(bodyH / rowH));

  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => {
      if (gridRef.current) setGridW(Math.max(200, gridRef.current.clientWidth - chW));
      if (bodyRef.current) setBodyH(bodyRef.current.clientHeight);
    });
    if (gridRef.current) ro.observe(gridRef.current);
    if (bodyRef.current) ro.observe(bodyRef.current);
    return () => ro.disconnect();
  }, [chW]);

  // keep the cursor inside the row range after filtering
  useEffect(() => {
    setCursor((c) => ({ ...c, row: Math.min(c.row, Math.max(0, rows.length - 1)) }));
    setScrollRow((r) => Math.min(r, Math.max(0, rows.length - visibleRows)));
  }, [rows.length]);

  const usable = (ch: LineupChannel) => isUsableMatch(matches.get(ch.key));
  const progsFor = (ch: LineupChannel, from: number, to: number) => (usable(ch) ? guide.range(ch.epgChannelId, from, to) : []);

  const focusedChannel = rows[cursor.row];
  const focusedProg: Programme | undefined = useMemo(() => {
    if (!focusedChannel || cursor.col !== 'grid' || cursor.start === undefined) return undefined;
    return guide.range(focusedChannel.epgChannelId, cursor.start, cursor.start + 1)[0];
  }, [focusedChannel, cursor, guide, guideVersion]);

  // ---- keyboard model ----
  const ensureRowVisible = (row: number) => {
    setScrollRow((sr) => (row < sr ? row : row >= sr + visibleRows ? row - visibleRows + 1 : sr));
  };

  const pickInRow = (row: number, anchor: number, vs: number, ve: number): number | undefined => {
    const ch = rows[row];
    if (!ch) return undefined;
    const list = progsFor(ch, vs, ve);
    if (!list.length) return undefined;
    const hit = list.find((p) => p.start <= anchor && p.stop > anchor) ?? list.find((p) => p.start >= anchor) ?? list[list.length - 1];
    return hit.start;
  };

  const shiftView = (delta: number) => {
    const next = Math.max(minStart, Math.min(maxStart, viewStart + delta));
    setViewStart(next);
    return next;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!rows.length) return;
    const ch = rows[cursor.row];
    const key = e.key;
    const handled = () => e.preventDefault();
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'PageDown' || key === 'PageUp') {
      const delta = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : key === 'PageDown' ? visibleRows - 1 : -(visibleRows - 1);
      const row = Math.max(0, Math.min(rows.length - 1, cursor.row + delta));
      if (row === cursor.row) {
        if (key === 'ArrowUp') return; // let spatial nav leave the grid (to chips)
        handled();
        return;
      }
      handled();
      const start = cursor.col === 'grid' ? pickInRow(row, cursor.anchor, viewStart, viewEnd) : undefined;
      setCursor({ ...cursor, row, start });
      ensureRowVisible(row);
      return;
    }
    if (key === 'ArrowRight') {
      handled();
      if (cursor.col === 'channel') {
        const start = pickInRow(cursor.row, Math.max(cursor.anchor, viewStart), viewStart, viewEnd);
        setCursor({ ...cursor, col: 'grid', start });
        return;
      }
      const list = progsFor(ch, viewStart, maxStart + span);
      const cur = list.find((p) => p.start === cursor.start);
      const next = cur ? list.find((p) => p.start >= cur.stop) : undefined;
      if (!next) {
        const vs = shiftView(STEP);
        setCursor({ ...cursor, anchor: Math.max(cursor.anchor, vs), start: pickInRow(cursor.row, Math.max(cursor.anchor + STEP, vs), vs, vs + span) });
        return;
      }
      let vs = viewStart;
      // Scroll so the next programme's start is visible (keep a little context).
      while (next.start >= vs + span - STEP / 2 && vs < maxStart) vs = Math.min(maxStart, vs + STEP);
      if (vs !== viewStart) setViewStart(vs);
      setCursor({ ...cursor, start: next.start, anchor: Math.max(next.start, vs) });
      return;
    }
    if (key === 'ArrowLeft') {
      if (cursor.col === 'channel') return; // spatial nav -> sidebar
      handled();
      const list = progsFor(ch, minStart, viewEnd);
      const cur = list.find((p) => p.start === cursor.start);
      const atLeftEdge = !cur || cur.start <= viewStart;
      if (atLeftEdge) {
        if (viewStart > minStart) {
          const vs = shiftView(-STEP);
          const prev = cur ? [...list].reverse().find((p) => p.stop <= cur.start && p.stop > vs) : undefined;
          const start = cur && cur.start < vs + STEP ? cur.start : prev?.start ?? pickInRow(cursor.row, vs, vs, vs + span);
          setCursor({ ...cursor, start, anchor: Math.max(vs, start ?? vs) });
        } else {
          setCursor({ ...cursor, col: 'channel', start: undefined });
        }
        return;
      }
      const prev = [...list].reverse().find((p) => p.stop <= cur!.start);
      if (prev) setCursor({ ...cursor, start: prev.start, anchor: Math.max(prev.start, viewStart) });
      else setCursor({ ...cursor, col: 'channel', start: undefined });
      return;
    }
    if (key === 'MediaFastForward') {
      handled();
      const vs = shiftView(2 * 3600_000);
      setCursor({ ...cursor, anchor: vs, start: pickInRow(cursor.row, vs, vs, vs + span) });
      return;
    }
    if (key === 'MediaRewind') {
      handled();
      const vs = shiftView(-2 * 3600_000);
      setCursor({ ...cursor, anchor: vs, start: pickInRow(cursor.row, vs, vs, vs + span) });
      return;
    }
    if (key === 'Enter') {
      handled();
      activate();
      return;
    }
    if (key === 'ContextMenu' || key === 'm' || key === 'M' || key === 'i' || key === 'I') {
      handled();
      if (ch && focusedProg) setState({ detail: { channelKey: ch.key, programme: focusedProg } });
      else if (ch) setState({ channelMenu: ch.key });
    }
  };

  const activate = () => {
    const ch = rows[cursor.row];
    if (!ch) return;
    const p = focusedProg;
    if (cursor.col === 'channel' || !p || (p.start <= Date.now() && p.stop > Date.now())) {
      if (getState().currentKey === ch.key) setState({ fullscreen: true });
      else void tune(ch.key);
    } else {
      setState({ detail: { channelKey: ch.key, programme: p } });
    }
  };

  const choose = (f: CategoryFilter) => {
    setFilter(f);
    setScrollRow(0);
    setCursor({ row: 0, col: 'grid', anchor: Date.now() });
  };

  const jumpNow = () => {
    const vs = floor(Date.now());
    setViewStart(vs);
    setCursor((c) => ({ ...c, col: 'grid', anchor: Date.now(), start: pickInRow(c.row, Date.now(), vs, vs + span) }));
  };

  // Initial focus target in the current row
  useEffect(() => {
    setCursor((c) => (c.start === undefined && c.col === 'grid' ? { ...c, start: pickInRow(c.row, Date.now(), viewStart, viewEnd) } : c));
  }, [guideVersion, rows]);

  // Move DOM focus to the cursor element whenever the grid is active.
  useLayoutEffect(() => {
    if (!active) return;
    const sel = cursor.col === 'channel' || cursor.start === undefined
      ? (cursor.col === 'channel' ? `[data-chcell="${cursor.row}"]` : `[data-empty="${cursor.row}"]`)
      : `[data-row="${cursor.row}"][data-start="${cursor.start}"]`;
    const el = gridRef.current?.querySelector<HTMLElement>(sel) ?? gridRef.current?.querySelector<HTMLElement>(`[data-chcell="${cursor.row}"]`);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  });

  const ticks = halfHourTicks(viewStart, viewEnd, floor).filter((t) => timeToX(t, viewStart, pxPerMin) < gridW - 4 * rem);
  const nowX = timeToX(now, viewStart, pxPerMin);
  const first = scrollRow;
  const last = Math.min(rows.length, scrollRow + visibleRows + 1);
  const status = usePlayerStatus();
  const playing = lineup.find((c) => c.key === currentKey);
  const infoCh = focusedChannel;

  // Fetch descriptions for what's on now on the rows in view, so they're ready when focused.
  useEffect(() => {
    const t = setTimeout(() => {
      const items = rows.slice(first, last).flatMap((ch) => {
        const p = usable(ch) ? guide.current(ch.epgChannelId, Date.now()) : undefined;
        return p ? [{ p, ch }] : [];
      });
      // TVs: just the first few rows, to keep the network and the stick's CPU free.
      prefetchDescriptions(document.documentElement.classList.contains('tv') ? items.slice(0, 4) : items);
    }, 1200);
    return () => clearTimeout(t);
  }, [first, last, rows, guideVersion]);

  if (!playlists.length) return <Welcome />;
  if (!lineup.length) {
    return (
      <section class="screen">
        <Empty title="No channels yet" icon="guide">
          <p>Add a playlist and a guide source to see the program guide.</p>
          <Button variant="primary" icon="add" onClick={() => navigate('wizard')}>Add playlist</Button>
        </Empty>
      </section>
    );
  }

  return (
    <section class="screen guide">
      <div class="guide-top">
        <div class="guide-preview">
          <VideoSlot>
            {!playing && <div class="video-placeholder small"><Icon name="tv" size="2.5rem" /></div>}
            {playing && <PlayerBadge status={status} />}
          </VideoSlot>
        </div>
        <div class="guide-info">
          {infoCh && (
            <div class="guide-info-ch">
              <span class="ch-num">{infoCh.number}</span> <ChannelName ch={infoCh} />
            </div>
          )}
          {focusedProg ? (
            <>
              <h2 class="guide-info-title">{focusedProg.title}</h2>
              <div class="guide-info-meta">
                <span>{day(focusedProg.start)} · {range(focusedProg)}</span>
                {focusedProg.episode && <span>{focusedProg.episode}</span>}
                {focusedProg.start <= now && focusedProg.stop > now && <span class="accent">{remaining(focusedProg, now)}</span>}
              </div>
              {focusedProg.start <= now && focusedProg.stop > now && <Progress value={progress(focusedProg, now)} />}
              <ProgDesc p={focusedProg} ch={infoCh} class="guide-info-desc" />
            </>
          ) : (
            <p class="muted">{infoCh && !usable(infoCh) ? `${UNAVAILABLE}.` : 'Select a program to see details.'}</p>
          )}
        </div>
      </div>
      <LiveTeamBanner />
      <div class="guide-controls" data-group="guide-controls">
        <div class="chips compact country-tabs">
          {chips.map((c) => {
            const active = filter === c.id || filter.startsWith(`${c.id}|`);
            const code = String(c.id).slice(8);
            const subs = active && filter.includes('|') ? subProviders(lineup, code).find((s) => filter === `${c.id}|${s.id}`) : undefined;
            return (
              <button
                type="button"
                class={`f chip ${active ? 'chip-active' : ''}`}
                onClick={() => {
                  if (subProviders(lineup, code).length) setMenuFor(code);
                  else choose(c.id);
                }}
              >
                {c.label}{subs ? <span class="chip-sub"> · {subs.label}</span> : null}
                <span class="chip-count">{c.count}</span>
                {subProviders(lineup, code).length > 0 && <Icon name="chevronRight" class="chip-more" size="0.9em" />}
              </button>
            );
          })}
        </div>
        <div class="row gap-sm">
          <GuideUpdateButton />
          <Button small icon="chevronLeft" onClick={() => shiftView(-STEP * 2)} aria-label="Earlier" />
          <Button small icon="now" onClick={jumpNow}>Now</Button>
          <Button small icon="chevronRight" onClick={() => shiftView(STEP * 2)} aria-label="Later" />
        </div>
      </div>
      <div
        class={`guide-grid ${active ? 'active' : ''}`}
        ref={gridRef}
        onKeyDown={onKeyDown}
        onFocusIn={() => setActive(true)}
        onFocusOut={(e) => {
          if (!gridRef.current?.contains(e.relatedTarget as Node)) setActive(false);
        }}
        onWheel={(e) => {
          if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
            shiftView(Math.sign(e.deltaX || e.deltaY) * STEP);
          } else {
            setScrollRow((r) => Math.max(0, Math.min(rows.length - visibleRows, r + Math.sign(e.deltaY) * 2)));
          }
          e.preventDefault();
        }}
      >
        <div class="guide-ruler" style={{ paddingLeft: `${chW}px` }}>
          <div class="guide-date">{day(viewStart)}</div>
          <div class="guide-ticks">
            {ticks.map((t) => (
              <span class="tick" style={{ left: `${timeToX(t, viewStart, pxPerMin)}px` }}>{clock(t)}</span>
            ))}
            {nowX >= 0 && nowX <= gridW && <span class="now-marker-top" style={{ left: `${nowX}px` }} />}
          </div>
        </div>
        <div class="guide-body" ref={bodyRef}>
          {rows.slice(first, last).map((ch, k) => {
            const row = first + k;
            const has = usable(ch) && guide.has(ch.epgChannelId);
            const blocks = has ? layoutRow(guide.range(ch.epgChannelId, viewStart, viewEnd), viewStart, viewEnd, pxPerMin) : [];
            const isCursorRow = cursor.row === row;
            return (
              <div class={`guide-row ${ch.key === currentKey ? 'playing' : ''}`} style={{ height: `${rowH}px`, top: `${k * rowH}px` }} key={ch.key}>
                <div
                  class={`f guide-ch ${isCursorRow && cursor.col === 'channel' ? 'cursor' : ''}`}
                  style={{ width: `${chW}px` }}
                  tabIndex={0}
                  data-chcell={row}
                  onClick={() => {
                    setCursor({ row, col: 'channel', anchor: cursor.anchor });
                    if (getState().currentKey === ch.key) setState({ fullscreen: true });
                    else void tune(ch.key);
                  }}
                  onFocus={() => {
                    if (!(isCursorRow && cursor.col === 'channel')) setCursor({ row, col: 'channel', anchor: cursor.anchor });
                  }}
                >
                  <span class="ch-num">{ch.number}</span>
                  <ChannelLogo ch={ch} src={ch.logo} name={ch.name} size="sm" />
                  <ChannelName ch={ch} class="guide-ch-name" />
                  {ch.favorite && <Icon name="star" class="fav-star" size="1em" />}
                </div>
                <div class="guide-progs" style={{ width: `${gridW}px` }}>
                  {blocks.length ? (
                    blocks.map((b) => {
                      const airing = b.p.start <= now && b.p.stop > now;
                      const isCursor = isCursorRow && cursor.col === 'grid' && cursor.start === b.p.start;
                      return (
                        <div
                          class={`f prog ${airing ? 'airing' : ''} ${b.p.stop <= now ? 'past' : ''} ${isCursor ? 'cursor' : ''} ${b.width < 6 * rem ? 'narrow' : ''}`}
                          style={{ left: `${b.left}px`, width: `${Math.max(2, b.width - 3)}px` }}
                          tabIndex={-1}
                          data-row={row}
                          data-start={b.p.start}
                          data-autofocus={isCursor ? '' : undefined}
                          title={`${b.p.title} · ${range(b.p)}`}
                          onClick={() => {
                            if (isCursor) activate();
                            else setCursor({ row, col: 'grid', start: b.p.start, anchor: Math.max(b.p.start, viewStart) });
                          }}
                          onFocus={() => {
                            if (!isCursor) setCursor({ row, col: 'grid', start: b.p.start, anchor: Math.max(b.p.start, viewStart) });
                          }}
                        >
                          <span class="prog-title">{b.clippedStart && '‹ '}{b.p.title}</span>
                          {b.width > 9 * rem && <span class="prog-time">{range(b.p)}</span>}
                          {airing && <span class="prog-progress" style={{ width: `${progress(b.p, now) * 100}%` }} />}
                        </div>
                      );
                    })
                  ) : (
                    <div
                      class={`f prog prog-empty ${isCursorRow && cursor.col === 'grid' ? 'cursor' : ''}`}
                      style={{ left: '0px', width: `${gridW - 3}px` }}
                      tabIndex={-1}
                      data-empty={row}
                      data-autofocus={isCursorRow && cursor.col === 'grid' ? '' : undefined}
                      onClick={() => setCursor({ row, col: 'grid', anchor: cursor.anchor })}
                    >
                      <span class="prog-title muted">{has ? 'No programs in this time range' : UNAVAILABLE}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {nowX >= 0 && nowX <= gridW && <div class="now-line" style={{ left: `${chW + nowX}px` }} />}
        </div>
        <div class="guide-scrollbar" aria-hidden="true">
          <div style={{ top: `${(scrollRow / Math.max(1, rows.length)) * 100}%`, height: `${Math.min(100, (visibleRows / Math.max(1, rows.length)) * 100)}%` }} />
        </div>
      </div>
      <div class="guide-hint muted">OK: watch / details · ☰ Menu: details · ⏪ ⏩: jump 2 hours</div>
      {menuFor !== null && (
        <Modal title={chips.find((c) => c.id === `country:${menuFor}`)?.label ?? 'Channels'} onClose={() => setMenuFor(null)} class="country-menu">
          <div class={`sheet-actions ${subProviders(lineup, menuFor).length > 8 ? 'many' : ''}`} data-group="country-menu">
            <Button data-autofocus={filter === `country:${menuFor}` || !filter.startsWith(`country:${menuFor}`) ? '' : undefined} icon="channels" onClick={() => { choose(`country:${menuFor}` as CategoryFilter); setMenuFor(null); }}>
              All channels <span class="muted">({lineup.filter((c) => !c.hidden && (c.country ?? 'none') === menuFor).length})</span>
            </Button>
            {subProviders(lineup, menuFor).map((sp) => (
              <Button data-autofocus={filter === `country:${menuFor}|${sp.id}` ? '' : undefined} icon={sp.id === 'mytv' ? 'tv' : 'sources'} onClick={() => { choose(`country:${menuFor}|${sp.id}` as CategoryFilter); setMenuFor(null); }}>
                {sp.id === 'mytv' ? <>My TV <span class="muted">· DIRECTV New York/NJ numbers</span></> : sp.label} <span class="muted">({sp.count})</span>
              </Button>
            ))}
          </div>
        </Modal>
      )}
    </section>
  );
}

/** Update the listings now (guide files and playlists), with when they were last updated. */
function GuideUpdateButton() {
  const sources = useApp((s) => s.epgSources);
  const now = useApp((s) => s.now);
  const [busy, setBusy] = useState(false);
  const last = Math.max(0, ...sources.filter((e) => e.enabled).map((e) => e.lastRefreshAt ?? 0));
  const ago = last ? Math.round((now - last) / 60000) : undefined;
  const label = busy ? 'Updating…' : ago === undefined ? 'Update listings' : ago < 60 ? `Updated ${ago} min ago` : `Updated ${Math.round(ago / 60)} h ago`;
  return (
    <Button small icon="refresh" disabled={busy} title="Download the latest TV listings and channel names" onClick={async () => {
      setBusy(true);
      try {
        await refreshAll();
        toast('TV listings updated', 'success', 2500);
      } catch (e) {
        toast('Couldn’t update the listings: ' + (e as Error).message, 'error');
      } finally {
        setBusy(false);
      }
    }}>{label}</Button>
  );
}
