// LTTV Home, laid out like YouTube TV's: "Top picks for you" (what's live now that you'll most want — your
// favourites, channels you watch, games), category buttons, then rows of what's on by category and your channels.
// Design: Figma "LTTV — Home (Top picks)".
import { h, Fragment } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { useApp, tune, getState, setState, navigate } from '../app/state';
import type { LineupChannel, Programme, CategoryId } from '../core/types';
import { ChannelLogo, Icon } from './common';
import { ChannelName } from './ChannelName';
import { clock, progress } from './fmt';
import { Welcome } from './Home';

const SPORTY = /\b(vs\.?|v\.|at)\b|\b(nfl|nba|nhl|mlb|ncaa|ufc|wnba|mls|premier league|champions league|f1|grand prix|pga|nascar|live)\b/i;
const CHIPS: { id: 'all' | CategoryId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'sports', label: 'Sports' },
  { id: 'news', label: 'News' },
  { id: 'entertainment', label: 'Shows' },
  { id: 'movies', label: 'Movies' },
  { id: 'kids', label: 'Family' },
  { id: 'documentaries', label: 'Documentaries' },
  { id: 'lifestyle', label: 'Lifestyle' },
  { id: 'music', label: 'Music' },
];

interface Pick {
  ch: LineupChannel;
  p?: Programme;
  score: number;
}

export function TopPicksScreen() {
  const lineup = useApp((s) => s.lineup);
  const guide = useApp((s) => s.guide);
  useApp((s) => s.guideVersion);
  const now = useApp((s) => s.now);
  const recents = useApp((s) => s.recents);
  const playlists = useApp((s) => s.playlists);
  const [chip, setChip] = useState<'all' | CategoryId>('all');

  const picks = useMemo(() => {
    const recent = new Map(recents.map((r, i) => [r.key, recents.length - i]));
    const t = Date.now();
    const out: Pick[] = [];
    for (const ch of lineup) {
      if (ch.hidden || ch.duplicateOf) continue;
      const p = ch.epgChannelId ? guide.current(ch.epgChannelId, t) : undefined;
      let score = 0;
      if (ch.favorite) score += 5;
      if (recent.has(ch.key)) score += 2 + Math.min(3, recent.get(ch.key)! / 5);
      if (p) score += 1;
      if (p && (p.live || SPORTY.test(p.title))) score += 3;
      if (p?.isNew) score += 1;
      if (ch.category === 'sports' && p) score += 1;
      out.push({ ch, p, score });
    }
    return out.sort((a, b) => b.score - a.score);
  }, [lineup, guide, recents, Math.floor(now / 60_000)]);

  if (!playlists.length) return <Welcome />;
  const top = picks.filter((x) => x.p).slice(0, 12);
  const byChip = picks.filter((x) => x.p && (chip === 'all' || x.ch.category === chip)).slice(0, 24);
  const yours = picks.filter((x) => x.ch.favorite || recents.some((r) => r.key === x.ch.key)).slice(0, 20);
  const sports = picks.filter((x) => x.p && (x.ch.category === 'sports' || SPORTY.test(x.p.title))).slice(0, 20);

  return (
    <section class="screen ytt-home">
      <h2 class="ytt-row-title">Top picks for you</h2>
      <div class="ytt-strip ytt-top" data-group="ytt-top" data-hlock>
        {top.map((x, i) => <LiveCard key={x.ch.key} pick={x} now={now} big={i === 0} autofocus={i === 0} />)}
      </div>
      <div class="ytt-chips" data-group="ytt-chips" data-hlock>
        {CHIPS.map((c) => (
          <button type="button" class={`f ytt-chip ${chip === c.id ? 'is-on' : ''}`} onClick={() => setChip(c.id)}>{c.label}</button>
        ))}
      </div>
      {chip !== 'all' && (
        <Row title={`${CHIPS.find((c) => c.id === chip)?.label} on now`} items={byChip} now={now} id="chip" />
      )}
      {yours.length > 0 && (
        <>
          <h2 class="ytt-row-title">Your channels</h2>
          <div class="ytt-strip" data-group="ytt-yours" data-hlock>
            {yours.map((x) => <ChannelTile key={x.ch.key} ch={x.ch} />)}
          </div>
        </>
      )}
      {chip === 'all' && sports.length > 0 && <Row title="Live sports" items={sports} now={now} id="sports" />}
      {chip === 'all' && <Row title="On now" items={picks.filter((x) => x.p).slice(12, 36)} now={now} id="onnow" />}
      <div class="ytt-more">
        <button type="button" class="f ytt-chip" onClick={() => navigate('guide')}><Icon name="guide" size="1.2rem" /> Open the live guide</button>
      </div>
    </section>
  );
}

function Row({ title, items, now, id }: { title: string; items: Pick[]; now: number; id: string }) {
  if (!items.length) return null;
  return (
    <>
      <h2 class="ytt-row-title">{title}</h2>
      <div class="ytt-strip" data-group={`ytt-${id}`} data-hlock>
        {items.map((x) => <LiveCard key={x.ch.key} pick={x} now={now} />)}
      </div>
    </>
  );
}

const watch = (ch: LineupChannel) => {
  if (getState().currentKey === ch.key) setState({ fullscreen: true });
  else void tune(ch.key, { fullscreen: true });
};

/** A live card: the programme's picture (or the channel's logo on its colour), LIVE, progress, then channel · time, title, episode. */
function LiveCard({ pick, now, big, autofocus }: { pick: Pick; now: number; big?: boolean; autofocus?: boolean }) {
  const { ch, p } = pick;
  const [imgOk, setImgOk] = useState(true);
  return (
    <div class={`ytt-card-wrap ${big ? 'is-big' : ''}`}>
      <button
        type="button"
        class="f ytt-card"
        data-autofocus={autofocus ? '' : undefined}
        onClick={() => watch(ch)}
        onContextMenu={(e) => { e.preventDefault(); if (p) setState({ detail: { channelKey: ch.key, programme: p } }); }}
        aria-label={`${p?.title ?? ch.name} on ${ch.name}`}
      >
        {p?.icon && imgOk ? <img class="ytt-card-img" src={p.icon} alt="" loading="lazy" onError={() => setImgOk(false)} /> : <div class="ytt-card-logo"><ChannelLogo ch={ch} src={ch.logo} name={ch.name} size="lg" /></div>}
        <span class="ytt-gloss" />
        {p && <span class="ytt-live">LIVE</span>}
        {p && <span class="ytt-progress"><span style={{ width: `${Math.round(progress(p, now) * 100)}%` }} /></span>}
      </button>
      <div class="ytt-meta"><ChannelName ch={ch} />{p ? ` • ${clock(p.start)} – ${clock(p.stop)}` : ''}</div>
      <div class="ytt-title">{p?.title ?? ch.name}</div>
      {big && (p?.episode || p?.subTitle) && <div class="ytt-sub">{[p?.episode, p?.subTitle].filter(Boolean).join(' · ')}</div>}
    </div>
  );
}

function ChannelTile({ ch }: { ch: LineupChannel }) {
  return (
    <button type="button" class="f ytt-ch" onClick={() => watch(ch)} aria-label={ch.name}>
      <ChannelLogo ch={ch} src={ch.logo} name={ch.name} size="lg" />
      <span class="ytt-gloss" />
    </button>
  );
}
