import { ChannelName } from './ChannelName';
import { h, Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  useApp, setState, tune, customize, toggleFavorite, updateSettings, setOrder, decideMatch, clearDecision, channelByKey, getState, toast,
} from '../app/state';
import { countryLabel, filterLineup, reorder, sortLineup } from '../core/organize';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../core/normalize';
import { nameSimilarity, isUsableMatch } from '../core/match';
import type { CategoryId, LineupChannel, Programme, SortMode } from '../core/types';
import { ChannelLogo, Icon, Button, Choice, Modal, VirtualList, useRemPx, Empty } from './common';
import { onBack } from '../app/nav';
import { myTvEntryFor, myTvName, pinScore } from '../core/mytv';

export const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'number', label: 'Channel number' },
  { value: 'playlist', label: 'Playlist order' },
  { value: 'alpha', label: 'Alphabetical' },
  { value: 'category', label: 'Category' },
  { value: 'favorites', label: 'Favorites first' },
  { value: 'recent', label: 'Recently watched' },
  { value: 'custom', label: 'My order' },
  { value: 'mytv', label: 'My TV (DIRECTV New York/NJ numbers)' },
  { value: 'country', label: 'Country' },
  { value: 'provider', label: 'Provider (playlist)' },
];

type ViewFilter = 'all' | 'favorites' | 'hidden' | 'duplicates' | 'noguide' | 'pending' | 'mytv' | CategoryId | `group:${string}` | `country:${string}` | `provider:${string}`;

function matchLabel(c: LineupChannel): { text: string; cls: string } {
  switch (c.matchStatus) {
    case 'auto':
      return { text: c.matchMethod === 'tvg-id' ? 'Guide: ID' : c.matchMethod === 'tvg-name' ? 'Guide: name' : c.matchMethod === 'name' ? 'Guide: name match' : `Guide: ${Math.round(c.matchConfidence * 100)}%`, cls: 'ok' };
    case 'approved':
      return { text: 'Guide: confirmed', cls: 'ok' };
    case 'pending':
      return { text: `Review ${Math.round(c.matchConfidence * 100)}%`, cls: 'warn' };
    case 'rejected':
      return { text: 'No guide (set)', cls: 'muted' };
    default:
      return { text: 'No guide', cls: 'muted' };
  }
}

export function ChannelsScreen() {
  const lineup = useApp((s) => s.lineup);
  const playlists = useApp((s) => s.playlists);
  const sortMode = useApp((s) => s.settings.sortMode);
  const recents = useApp((s) => s.recents);
  const currentKey = useApp((s) => s.currentKey);
  const rem = useRemPx();
  const [view, setView] = useState<ViewFilter>('all');
  const [q, setQ] = useState('');
  const [moving, setMoving] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);

  const groups = useMemo(() => [...new Set(lineup.map((c) => c.group).filter((g): g is string => !!g))].sort(), [lineup]);
  const viewOptions = useMemo(() => {
    const opts: { value: ViewFilter; label: string }[] = [
      { value: 'all', label: 'All channels' },
      { value: 'favorites', label: 'Favorites' },
      { value: 'hidden', label: 'Hidden' },
      { value: 'duplicates', label: 'Possible duplicates' },
      { value: 'noguide', label: 'Without guide' },
      { value: 'pending', label: 'Guide needs review' },
    ];
    if (lineup.some((ch) => ch.myTv !== undefined)) opts.push({ value: 'mytv', label: 'My TV (DIRECTV New York/NJ)' });
    for (const c of CATEGORY_ORDER) if (lineup.some((ch) => ch.category === c)) opts.push({ value: c, label: CATEGORY_LABELS[c] });
    if (playlists.length > 1) for (const p of playlists) opts.push({ value: `provider:${p.id}`, label: `Provider: ${p.name}` });
    const countries = [...new Set(lineup.map((c) => c.country ?? 'none'))].sort((a, b) => (a === 'us' ? -1 : b === 'us' ? 1 : countryLabel(a === 'none' ? undefined : a).localeCompare(countryLabel(b === 'none' ? undefined : b))));
    if (countries.length > 1) for (const c of countries) opts.push({ value: `country:${c}`, label: `Country: ${countryLabel(c === 'none' ? undefined : c)}` });
    for (const g of groups.slice(0, 200)) opts.push({ value: `group:${g}`, label: `Group: ${g}` });
    return opts;
  }, [lineup, groups, playlists]);

  const list = useMemo(() => {
    let l: LineupChannel[];
    switch (view) {
      case 'hidden':
        l = lineup.filter((c) => c.hidden);
        break;
      case 'duplicates': {
        const dupTargets = new Set(lineup.map((c) => c.duplicateOf).filter(Boolean));
        l = lineup.filter((c) => c.duplicateOf || dupTargets.has(c.key));
        break;
      }
      case 'noguide':
        l = lineup.filter((c) => !c.hidden && !(c.matchStatus === 'auto' || c.matchStatus === 'approved'));
        break;
      case 'pending':
        l = lineup.filter((c) => c.matchStatus === 'pending');
        break;
      default:
        l = filterLineup(lineup, view as never, { recents });
    }
    const qq = q.trim().toLowerCase();
    if (qq) l = l.filter((c) => c.name.toLowerCase().includes(qq) || c.originalName.toLowerCase().includes(qq) || String(c.number) === qq);
    return l;
  }, [lineup, view, q, recents]);

  // Move mode: up/down moves the channel, OK/back finishes.
  useEffect(() => {
    if (!moving) return;
    return onBack(() => {
      setMoving(null);
      return true;
    });
  }, [moving]);

  const moveBy = async (key: string, delta: number) => {
    const ordered = sortLineup(lineup, sortMode, recents);
    const idx = ordered.findIndex((c) => c.key === key);
    const target = Math.max(0, Math.min(ordered.length - 1, idx + delta));
    if (target === idx) return;
    await setOrder(reorder(ordered, key, target));
  };

  const dupCount = lineup.filter((c) => c.duplicateOf).length;
  const hiddenCount = lineup.filter((c) => c.hidden).length;
  const initialIndex = Math.max(0, list.findIndex((c) => c.key === (moving ?? currentKey)));

  const guide = useApp((s) => s.guide);
  useApp((s) => s.guideVersion);
  const matches = useApp((s) => s.matches);
  const now = useApp((s) => s.now);
  const visible = useMemo(() => lineup.filter((c) => !c.hidden), [lineup]);
  const groupCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of visible) if (c.group) m.set(c.group, (m.get(c.group) ?? 0) + 1);
    return m;
  }, [visible]);
  const countryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of visible) m.set(c.country ?? 'none', (m.get(c.country ?? 'none') ?? 0) + 1);
    return [...m.entries()].filter(([k]) => k !== 'none').sort((a, b) => (a[0] === 'us' ? -1 : b[0] === 'us' ? 1 : b[1] - a[1]));
  }, [visible]);
  const organize = moving !== null || view === 'hidden' || view === 'duplicates' || view === 'noguide' || view === 'pending';
  const label = viewOptions.find((o) => o.value === view)?.label.replace(/^(Group|Country|Provider): /, '') ?? 'Channels';
  const side = (v: ViewFilter, text: string, count: number, icon?: string) => (
    <button type="button" class={`f ch-side-item ${view === v ? 'on' : ''}`} data-autofocus={view === v ? '' : undefined} onClick={() => { setView(v); setQ(''); }}>
      {icon && <Icon name={icon} size="1.05em" />}<span class="ch-side-label">{text}</span><span class="ch-side-count">{count.toLocaleString()}</span>
    </button>
  );
  const watch = (c: LineupChannel) => {
    if (getState().currentKey === c.key) setState({ fullscreen: true });
    else void tune(c.key);
  };

  return (
    <section class="screen channels ch2">
      {moving && (
        <div class="banner">
          <Icon name="move" /> Moving <b>{channelByKey(moving)?.name}</b>: use ▲ ▼ to move, OK to finish.
        </div>
      )}
      <div class="ch2-body">
        <aside class="ch-side" data-group="ch-side">
          <Choice label="Sort" value={sortMode} options={SORT_OPTIONS} onChange={(v) => void updateSettings({ sortMode: v })} />
          <input class="f input ch-side-search" type="search" placeholder="Find a channel" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Find a channel" />
          {side('all', 'All channels', visible.length, 'tv')}
          {side('favorites', 'Favorites', visible.filter((c) => c.favorite).length, 'star')}
          {lineup.some((c) => c.myTv !== undefined) && side('mytv', 'My TV', visible.filter((c) => c.myTv !== undefined).length, 'live')}
          {countryCounts.length > 1 && <div class="ch-side-h">Countries · {countryCounts.length}</div>}
          {countryCounts.length > 1 && countryCounts.slice(0, 40).map(([k, n]) => side(`country:${k}` as ViewFilter, countryLabel(k), n))}
          <div class="ch-side-h">All groups · {groupCounts.size.toLocaleString()}</div>
          {groups.slice(0, 400).map((g) => (groupCounts.get(g) ? side(`group:${g}` as ViewFilter, g, groupCounts.get(g)!) : null))}
          <div class="ch-side-h">Organize</div>
          {side('hidden', 'Hidden', hiddenCount)}
          {side('duplicates', 'Possible duplicates', dupCount)}
          {side('noguide', 'Without guide', lineup.filter((c) => !c.hidden && !(c.matchStatus === 'auto' || c.matchStatus === 'approved')).length)}
          {side('pending', 'Guide needs review', lineup.filter((c) => c.matchStatus === 'pending').length)}
        </aside>
        <div class="ch-main">
          <div class="ch-main-head"><h2>{q.trim() ? `“${q.trim()}”` : label}</h2><span class="muted">{list.length.toLocaleString()} channels</span></div>
          {organize ? (
      <div class="channels-list">
          {list.length ? (
            <VirtualList
              key={view + '|' + (moving ?? '')}
              items={list}
              rowHeight={4.75 * rem}
              initialIndex={initialIndex}
              keyOf={(c) => c.key}
              groupName="channels-list"
              render={(c, i) => {
                const m = matchLabel(c);
                const isMoving = moving === c.key;
                return (
                  <div
                    class={`f org-row ${isMoving ? 'moving' : ''} ${c.hidden ? 'is-hidden' : ''} ${dragKey === c.key ? 'dragging' : ''}`}
                    tabIndex={0}
                    data-index={i}
                    data-autofocus={i === initialIndex ? '' : undefined}
                    draggable={sortMode === 'custom' || sortMode === 'number' || sortMode === 'playlist'}
                    onDragStart={(e) => {
                      setDragKey(c.key);
                      e.dataTransfer?.setData('text/plain', c.key);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = e.dataTransfer?.getData('text/plain') || dragKey;
                      setDragKey(null);
                      if (!from || from === c.key) return;
                      const ordered = sortLineup(lineup, sortMode, recents);
                      void setOrder(reorder(ordered, from, ordered.findIndex((x) => x.key === c.key)));
                    }}
                    onDragEnd={() => setDragKey(null)}
                    onKeyDown={(e) => {
                      if (!isMoving) {
                        if (e.key === 'ContextMenu' || e.key === 'm' || e.key === 'M') {
                          e.preventDefault();
                          setState({ channelMenu: c.key });
                        }
                        return;
                      }
                      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                        e.preventDefault();
                        e.stopPropagation();
                        void moveBy(c.key, e.key === 'ArrowUp' ? -1 : 1);
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        setMoving(null);
                        toast('Channel order saved', 'success', 2000);
                      }
                    }}
                    onClick={() => {
                      if (!isMoving) setState({ channelMenu: c.key });
                    }}
                  >
                    <span>{sortMode === 'custom' && <Icon name="move" class="drag-handle muted" />}</span>
                    <span class="ch-num">{c.number}</span>
                    <ChannelLogo ch={c} src={c.logo} name={c.name} size="sm" />
                    <span class="org-name">
                      <span class="org-title">
                        <ChannelName ch={c} />
                        {c.favorite && <Icon name="star" class="fav-star" size="1em" />}
                        {c.hidden && <span class="pill muted">Hidden</span>}
                        {c.duplicateOf && <span class="pill warn">Duplicate?</span>}
                      </span>
                      {c.name !== c.originalName && <small class="muted">Original: {c.originalName}</small>}
                    </span>
                    <span class="org-cat">
                      {CATEGORY_LABELS[c.category]}
                      <small class="muted">{c.categoryEvidence === 'user' ? 'set by you' : c.categoryEvidence === 'group' ? 'from group' : c.categoryEvidence === 'name' ? 'from name' : 'no evidence'}</small>
                    </span>
                    <span class="org-group muted">{c.group ?? '—'}</span>
                    <span class={`pill ${m.cls}`}>{m.text}</span>
                  </div>
                );
              }}
            />
          ) : (
            <Empty title="No channels match" icon="channels" />
          )}
        </div>
            ) : list.length ? (
            <ChannelGrid key={view + '|' + q} list={list} now={now} currentKey={currentKey} progOf={(c) => (isUsableMatch(matches.get(c.key)) ? guide.current(c.epgChannelId, now) : undefined)} onWatch={watch} />
          ) : (
            <Empty title="No channels match" icon="channels" />
          )}
        </div>
      </div>
      <p class="guide-hint muted">OK: watch · ☰ Menu: channel options{organize ? ' · Desktop: drag rows to reorder' : ''}</p>
      <MoveBridge onMove={(k) => setMoving(k)} />
    </section>
  );
}

/** The channel tiles: logo card with a progress line, the name, what's on and how long is left. More load as you go down. */
function ChannelGrid({ list, now, currentKey, progOf, onWatch }: { list: LineupChannel[]; now: number; currentKey?: string; progOf: (c: LineupChannel) => Programme | undefined; onWatch: (c: LineupChannel) => void }) {
  const [shown, setShown] = useState(48);
  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setShown((n) => Math.min(list.length, n + 48)), { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list.length, shown]);
  return (
    <div class="ch-grid" data-group="ch-grid">
      {list.slice(0, shown).map((c, i) => {
        const p = progOf(c);
        const pct = p ? Math.max(0, Math.min(1, (now - p.start) / Math.max(1, p.stop - p.start))) : 0;
        return (
          <button
            type="button"
            class={`f ch-tile ${c.key === currentKey ? 'playing' : ''}`}
            key={c.key}
            data-autofocus={i === 0 ? '' : undefined}
            onClick={() => onWatch(c)}
            onContextMenu={(e) => { e.preventDefault(); setState({ channelMenu: c.key }); }}
            onKeyDown={(e) => {
              if (e.key === 'ContextMenu' || e.key === 'm' || e.key === 'M') {
                e.preventDefault();
                setState({ channelMenu: c.key });
              }
              // Near the end of what's drawn: draw more.
              if (e.key === 'ArrowDown' && i >= shown - 12) setShown((n) => Math.min(list.length, n + 48));
            }}
          >
            <div class="ch-tile-logo">
              <ChannelLogo ch={c} src={c.logo} name={c.name} size="lg" />
              {c.favorite && <Icon name="star" class="fav-star" size="0.9em" />}
            </div>
            <div class="ch-tile-bar">{p && <span style={{ width: `${pct * 100}%` }} />}</div>
            <div class="ch-tile-name"><ChannelName ch={c} /></div>
            <div class="ch-tile-now"><span>{p?.title ?? 'No information'}</span>{p && <span class="ch-tile-left">{shortLeft(p.stop - now)}</span>}</div>
          </button>
        );
      })}
      {shown < list.length && <div ref={more} class="ch-grid-more" />}
    </div>
  );
}

function shortLeft(ms: number): string {
  if (ms <= 0) return '';
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`;
}

// Lets the ChannelMenu (rendered at app level) start move mode in this screen.
let moveHandler: ((key: string) => void) | null = null;
function MoveBridge({ onMove }: { onMove: (k: string) => void }) {
  useEffect(() => {
    moveHandler = onMove;
    return () => {
      moveHandler = null;
    };
  }, [onMove]);
  return null;
}

// ---------------------------------------------------------------------------

export function ChannelMenu({ channelKey, onClose }: { channelKey: string; onClose: () => void }) {
  const ch = useApp((s) => s.lineup.find((c) => c.key === channelKey));
  const match = useApp((s) => s.matches.get(channelKey));
  const epgNames = useApp((s) => s.epgChannelNames);
  const [mode, setMode] = useState<'menu' | 'rename' | 'number' | 'category' | 'match'>('menu');
  const [text, setText] = useState('');
  if (!ch) return null;

  if (mode === 'match') return <MatchPicker ch={ch} onClose={() => setMode('menu')} />;

  if (mode === 'rename' || mode === 'number') {
    const save = async () => {
      if (mode === 'rename') await customize(ch.key, { name: text.trim() || undefined });
      else {
        const n = text.trim() ? Number(text) : undefined;
        if (n !== undefined && (!Number.isInteger(n) || n < 0 || n > 99999)) {
          toast('Enter a whole number between 0 and 99999', 'error');
          return;
        }
        const clash = n !== undefined ? getState().lineup.find((c) => c.number === n && c.key !== ch.key) : undefined;
        await customize(ch.key, { number: n });
        if (clash) toast(`Note: ${clash.name} also uses number ${n}.`, 'info');
      }
      setMode('menu');
    };
    return (
      <Modal key={mode} title={mode === 'rename' ? `Rename ${ch.name}` : `Channel number for ${ch.name}`} onClose={() => setMode('menu')}>
        <form
          class="form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            class="f input big"
            data-autofocus
            inputMode={mode === 'number' ? 'numeric' : 'text'}
            value={text}
            placeholder={mode === 'rename' ? ch.cleanedName : String(ch.number)}
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
          />
          {mode === 'rename' && <p class="muted">Original name from playlist: {ch.originalName}</p>}
          <div class="row gap modal-actions">
            <Button variant="primary" icon="check" onClick={() => void save()}>Save</Button>
            <Button onClick={() => { setText(''); void (mode === 'rename' ? customize(ch.key, { name: undefined }) : customize(ch.key, { number: undefined })).then(() => setMode('menu')); }}>
              {mode === 'rename' ? 'Restore original name' : 'Use automatic number'}
            </Button>
            <Button variant="ghost" onClick={() => setMode('menu')}>Cancel</Button>
          </div>
        </form>
      </Modal>
    );
  }

  if (mode === 'category') {
    return (
      <Modal key="category" title={`Category for ${ch.name}`} onClose={() => setMode('menu')}>
        <div class="grid-buttons">
          <Button variant={ch.categoryEvidence !== 'user' ? 'primary' : 'default'} onClick={() => void customize(ch.key, { category: undefined }).then(() => setMode('menu'))}>
            Automatic
          </Button>
          {CATEGORY_ORDER.map((c) => (
            <Button variant={ch.categoryEvidence === 'user' && ch.category === c ? 'primary' : 'default'} onClick={() => void customize(ch.key, { category: c }).then(() => setMode('menu'))}>
              {CATEGORY_LABELS[c]}
            </Button>
          ))}
        </div>
      </Modal>
    );
  }

  const usable = isUsableMatch(match);
  return (
    <Modal key="menu" title={ch.name} onClose={onClose}>
      <div class="sheet">
        <div class="sheet-head">
          <ChannelLogo ch={ch} src={ch.logo} name={ch.name} />
          <div>
            <div><span class="ch-num">{ch.number}</span> {ch.name}</div>
            <small class="muted">
              {CATEGORY_LABELS[ch.category]} · {ch.group ?? 'No group'}{ch.country ? ` · ${countryLabel(ch.country)}` : ''}{ch.myTv !== undefined ? ` · My TV ${ch.myTv}` : ''} · {match?.method === 'provider' ? 'Guide: from your provider' : match?.method === 'station' ? `Guide: New York station (${epgNames.get(match!.epgChannelId!) ?? 'from your guide'})` : match?.method === 'english' ? `Guide: English version (${epgNames.get(match!.epgChannelId!) ?? 'another guide channel'})` : match?.method === 'event' ? 'Guide: game from the channel name' : usable ? `Guide: ${epgNames.get(match!.epgChannelId!) ?? 'matched'}` : match?.status === 'pending' ? 'Guide match needs review' : 'No guide'}
            </small>
          </div>
        </div>
        <div class="sheet-actions">
          <Button variant="primary" icon="play" data-autofocus onClick={() => { onClose(); void tune(ch.key, { fullscreen: true }); }}>Watch</Button>
          <Button icon={ch.favorite ? 'star' : 'starOutline'} onClick={() => void toggleFavorite(ch.key)}>{ch.favorite ? 'Remove from favorites' : 'Add to favorites'}</Button>
          <Button icon="edit" onClick={() => { setText(ch.name === ch.cleanedName ? '' : ch.name); setMode('rename'); }}>Rename</Button>
          <Button icon="channels" onClick={() => { setText(''); setMode('number'); }}>Channel number</Button>
          <Button icon="guide" onClick={() => setMode('category')}>Category</Button>
          <MyTvPinButton ch={ch} />
          <Button icon="hidden" onClick={() => void customize(ch.key, { hidden: !ch.hidden || undefined })}>{ch.hidden ? 'Show channel' : 'Hide channel'}</Button>
          {moveHandler && (
            <Button icon="move" onClick={() => { const k = ch.key; onClose(); moveHandler?.(k); }}>Move position</Button>
          )}
          <Button icon="link" onClick={() => setMode('match')}>{usable ? 'Change guide match' : 'Find guide match'}</Button>
          {match?.status === 'pending' && match.epgChannelId && (
            <Button icon="check" onClick={() => void decideMatch(ch.key, 'approved', match.epgChannelId)}>
              Approve “{epgNames.get(match.epgChannelId) ?? 'suggested match'}” ({Math.round(match.confidence * 100)}%)
            </Button>
          )}
          {(usable || match?.status === 'pending') && (
            <Button icon="close" onClick={() => void decideMatch(ch.key, 'rejected', match?.method === 'manual' ? undefined : match?.epgChannelId)}>
              {match?.status === 'pending' ? 'Reject suggestion' : 'Remove guide match'}
            </Button>
          )}
          {(match?.status === 'approved' || match?.status === 'rejected') && (
            <Button icon="refresh" onClick={() => void clearDecision(ch.key)}>Reset guide match to automatic</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Pin this stream to its My TV number (it then wins over other copies, and follows you to another provider). */
function MyTvPinButton({ ch }: { ch: LineupChannel }) {
  const pins = useApp((s) => s.settings.myTvPins ?? []);
  const slot = ch.myTv ?? myTvEntryFor(ch)?.n;
  if (slot === undefined) return null;
  const pinned = pins.find((p) => p.n === slot && pinScore(ch, p) >= 60);
  const id = /\/(\d+)(?:\.[a-z0-9]+)?(?:[?#].*)?$/i.exec(ch.url)?.[1];
  const call = /\b([KW][A-Z]{3})\b/.exec(ch.originalName)?.[1];
  return pinned ? (
    <Button icon="close" onClick={() => void updateSettings({ myTvPins: pins.filter((p) => p !== pinned) })}>Stop pinning to My TV {slot}</Button>
  ) : (
    <Button icon="tv" onClick={() => { void updateSettings({ myTvPins: [...pins.filter((p) => p.n !== slot), { n: slot, name: ch.originalName, call, streamId: id }] }); toast(`My TV ${slot} (${myTvName(slot) ?? ''}) now uses this stream.`, 'success'); }}>
      Always use this stream for My TV {slot}
    </Button>
  );
}

export function MatchPicker({ ch, onClose }: { ch: LineupChannel; onClose: () => void }) {
  const names = useApp((s) => s.epgChannelNames);
  const match = useApp((s) => s.matches.get(ch.key));
  const [q, setQ] = useState('');
  const rem = useRemPx();
  const inputRef = useRef<HTMLInputElement>(null);
  const options = useMemo(() => {
    const all = [...names.entries()].map(([ref, name]) => ({ ref, name }));
    const qq = q.trim().toLowerCase();
    if (qq) return all.filter((o) => o.name.toLowerCase().includes(qq) || o.ref.toLowerCase().includes(qq)).slice(0, 300);
    // Suggest by similarity (candidates first)
    const cands = new Map((match?.candidates ?? []).map((c) => [c.id, c.score]));
    return all
      .map((o) => ({ ...o, score: cands.get(o.ref) ?? nameSimilarity(ch.name, o.name) }))
      .filter((o) => o.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);
  }, [names, q, ch.name, match]);
  return (
    <Modal title={`Guide match for ${ch.name}`} onClose={onClose} wide>
      <input
        ref={inputRef}
        class="f input"
        data-autofocus
        type="search"
        placeholder="Search guide channels"
        value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
      />
      {!names.size ? (
        <p class="muted">No guide data loaded. Add an XMLTV guide in Sources first.</p>
      ) : (
        <div class="picker-list">
          {options.length ? (
            <VirtualList
              items={options}
              rowHeight={3.6 * rem}
              keyOf={(o) => o.ref}
              render={(o, i) => (
                <button
                  type="button"
                  class={`f picker-row ${match?.epgChannelId === o.ref ? 'selected' : ''}`}
                  data-index={i}
                  onClick={() => void decideMatch(ch.key, 'manual', o.ref).then(onClose)}
                >
                  <span>{o.name}</span>
                  <small class="muted">{o.ref.split('|').slice(1).join('|')}</small>
                  {'score' in o && <small class="pill">{Math.round((o as { score: number }).score * 100)}%</small>}
                </button>
              )}
            />
          ) : (
            <p class="muted">No similar guide channels. Type to search.</p>
          )}
        </div>
      )}
      <div class="row gap modal-actions">
        <Button icon="close" onClick={() => void decideMatch(ch.key, 'rejected').then(onClose)}>This channel has no guide</Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}
