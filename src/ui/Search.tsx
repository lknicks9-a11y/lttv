import { ChannelName } from './ChannelName';
import { h, Fragment } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useApp, tune, setState, toggleFavorite } from '../app/state';
import { searchChannels, searchProgrammes } from '../core/search';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../core/normalize';
import type { CategoryId } from '../core/types';
import { Button, ChannelLogo, Choice, Toggle, Empty, Modal, Progress, Icon } from './common';
import type { LineupChannel } from '../core/types';
import { when, progress, range, UNAVAILABLE } from './fmt';

export function SearchScreen() {
  const lineup = useApp((s) => s.lineup);
  const guide = useApp((s) => s.guide);
  const guideVersion = useApp((s) => s.guideVersion);
  const now = useApp((s) => s.now);
  const [q, setQ] = useState(() => sessionStorage.getItem('searchQ') ?? '');
  const [category, setCategory] = useState<CategoryId | 'all'>('all');
  const [favoritesOnly, setFav] = useState(false);
  const [withGuideOnly, setWithGuide] = useState(false);
  const filters = { category, favoritesOnly, withGuideOnly };

  // Searching a big lineup and guide on every key press made the TV keyboard crawl: the box updates at once,
  // the search itself runs when you pause typing.
  const [dq, setDq] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 350);
    return () => clearTimeout(t);
  }, [q]);
  const [card, setCard] = useState<LineupChannel | null>(null);
  const chHits = useMemo(() => searchChannels(lineup, dq, filters, guide).slice(0, 40), [lineup, dq, category, favoritesOnly, withGuideOnly, guideVersion]);
  const pHits = useMemo(() => searchProgrammes(lineup, guide, dq, Date.now(), filters, 60), [lineup, dq, category, favoritesOnly, withGuideOnly, guideVersion]);

  const catOptions = [{ value: 'all' as const, label: 'All categories' }, ...CATEGORY_ORDER.filter((c) => lineup.some((l) => l.category === c)).map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))];

  return (
    <section class="screen search">
      <header class="screen-head">
        <h1>Search</h1>
      </header>
      <div class="search-bar" data-group="search-bar">
        <Icon name="search" size="2rem" />
        <input
          class="f input big"
          type="search"
          data-autofocus
          placeholder="Channel name, number, category or program title"
          value={q}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            setQ(v);
            try {
              sessionStorage.setItem('searchQ', v);
            } catch {
              /* ignore */
            }
          }}
          aria-label="Search"
        />
      </div>
      <div class="search-filters" data-group="search-filters">
        <Choice label="Category" value={category} options={catOptions} onChange={setCategory} />
        <Toggle label="Favorites only" checked={favoritesOnly} onChange={setFav} />
        <Toggle label="Only channels with guide data" checked={withGuideOnly} onChange={setWithGuide} />
      </div>
      {!q.trim() ? (
        <Empty icon="search" title="Find channels and programs">
          <p>Program search covers what’s on now and upcoming in your guide. Movies and shows from your provider (if it has them) have their own search in Movies and Shows.</p>
        </Empty>
      ) : (
        <div class="search-results">
          <div class="results-col" data-group="results-channels">
            <h3>Channels <span class="muted">({chHits.length})</span></h3>
            {chHits.length === 0 && <p class="muted">No channels found.</p>}
            {chHits.map(({ channel: c }) => {
              const usable = c.matchStatus === 'auto' || c.matchStatus === 'approved';
              const cur = usable ? guide.current(c.epgChannelId, now) : undefined;
              return (
                <button type="button" class="f result-row" onClick={() => setCard(c)} onContextMenu={(e) => { e.preventDefault(); setState({ channelMenu: c.key }); }}>
                  <span class="ch-num">{c.number}</span>
                  <ChannelLogo ch={c} src={c.logo} name={c.name} size="sm" />
                  <span class="result-main">
                    <ChannelName ch={c} />
                    <small class="muted">{cur ? `Now: ${cur.title}` : UNAVAILABLE}</small>
                  </span>
                  <small class="muted">{CATEGORY_LABELS[c.category]}</small>
                </button>
              );
            })}
          </div>
          <div class="results-col" data-group="results-programs">
            <h3>Programs <span class="muted">({pHits.length})</span></h3>
            {q.trim().length < 2 && <p class="muted">Type at least 2 letters.</p>}
            {q.trim().length >= 2 && pHits.length === 0 && <p class="muted">No matching programs in the loaded guide.</p>}
            {pHits.map(({ channel: c, programme: p, airingNow }) => (
              <button type="button" class="f result-row" onClick={() => setState({ detail: { channelKey: c.key, programme: p } })}>
                <span class={`when ${airingNow ? 'accent' : ''}`}>{airingNow ? 'On now' : when(p.start, now)}</span>
                <span class="result-main">
                  <span>{p.title}{p.episode ? ` · ${p.episode}` : ''}</span>
                  <small class="muted">{c.number} {c.name} · {range(p)}</small>
                  {airingNow && <Progress value={progress(p, now)} />}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {card && <WatchCard ch={lineup.find((c) => c.key === card.key) ?? card} onClose={() => setCard(null)} />}
    </section>
  );
}

/** A channel you picked: what's on, and Watch (full screen, straight from here). */
export function WatchCard({ ch, onClose }: { ch: LineupChannel; onClose: () => void }) {
  const guide = useApp((s) => s.guide);
  const now = useApp((s) => s.now);
  const usable = ch.matchStatus === 'auto' || ch.matchStatus === 'approved';
  const cur = usable ? guide.current(ch.epgChannelId, now) : undefined;
  return (
    <Modal onClose={onClose} class="watch-card" title={ch.name}>
      <div class="watch-card-body">
        <div class="watch-card-logo"><ChannelLogo ch={ch} src={ch.logo} name={ch.name} size="lg" /></div>
        <div class="watch-card-info">
          <small class="watch-card-ch">{ch.number} · {CATEGORY_LABELS[ch.category]}</small>
          <div class="watch-card-title">{cur ? cur.title : ch.name}</div>
          {cur ? (
            <>
              <small class="muted">{range(cur)}</small>
              <Progress value={progress(cur, now)} />
              {cur.desc && <p class="watch-card-desc">{cur.desc}</p>}
            </>
          ) : (
            <small class="muted">{UNAVAILABLE}</small>
          )}
        </div>
      </div>
      <div class="row gap modal-actions">
        <Button variant="primary" icon="play" data-autofocus onClick={() => { onClose(); void tune(ch.key, { fullscreen: true }); }}>Watch live</Button>
        <Button icon={ch.favorite ? 'star' : 'starOutline'} onClick={() => void toggleFavorite(ch.key)}>{ch.favorite ? 'Remove from favorites' : 'Add to favorites'}</Button>
      </div>
    </Modal>
  );
}
