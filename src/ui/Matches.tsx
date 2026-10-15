import { h, Fragment } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { useApp, decideMatch, navigate, approveMatches } from '../app/state';
import type { LineupChannel } from '../core/types';
import { ChannelLogo, Button, Choice, Empty, Icon } from './common';
import { MatchPicker } from './Channels';

export function MatchesScreen() {
  const lineup = useApp((s) => s.lineup);
  const matches = useApp((s) => s.matches);
  const names = useApp((s) => s.epgChannelNames);
  const [view, setView] = useState<'pending' | 'unmatched' | 'all'>('pending');
  const [picking, setPicking] = useState<LineupChannel | null>(null);

  const list = useMemo(() => {
    const vis = lineup.filter((c) => !c.hidden);
    if (view === 'pending') return vis.filter((c) => c.matchStatus === 'pending').sort((a, b) => b.matchConfidence - a.matchConfidence);
    if (view === 'unmatched') return vis.filter((c) => c.matchStatus === 'unmatched' || c.matchStatus === 'rejected');
    return vis;
  }, [lineup, view]);

  const approveAllAbove = async (min: number) => {
    const items: { key: string; epgChannelId: string }[] = [];
    for (const c of list) {
      const m = matches.get(c.key);
      if (m?.status === 'pending' && m.epgChannelId && m.confidence >= min) items.push({ key: c.key, epgChannelId: m.epgChannelId });
    }
    await approveMatches(items);
  };

  return (
    <section class="screen matches">
      <header class="screen-head">
        <div>
          <h1>Guide matches</h1>
          <p class="muted">Exact matches (tvg-id, tvg-name, identical names) are applied automatically. Fuzzy suggestions are shown with their confidence and only used after you approve them.</p>
        </div>
        <div class="row gap" data-group="match-head">
          <Choice label="Show" value={view} options={[
            { value: 'pending', label: 'Needs review' },
            { value: 'unmatched', label: 'No guide' },
            { value: 'all', label: 'All channels' },
          ]} onChange={setView} />
          {view === 'pending' && list.some((c) => c.matchConfidence >= 0.9) && (
            <Button icon="check" onClick={() => void approveAllAbove(0.9)}>Approve all ≥ 90% ({list.filter((c) => c.matchConfidence >= 0.9).length})</Button>
          )}
          {view === 'pending' && list.some((c) => c.matchConfidence >= 0.8 && c.matchConfidence < 0.9) && (
            <Button icon="check" onClick={() => void approveAllAbove(0.8)}>Approve all ≥ 80% ({list.filter((c) => c.matchConfidence >= 0.8).length})</Button>
          )}
        </div>
      </header>
      {list.length === 0 ? (
        <Empty icon="check" title={view === 'pending' ? 'Nothing to review' : 'All channels have guide data'}>
          <Button onClick={() => navigate('sources')}>Back to sources</Button>
        </Empty>
      ) : (
        <div class="match-list" data-group="match-list">
          {list.slice(0, 300).map((c) => {
            const m = matches.get(c.key);
            const suggestion = m?.epgChannelId ? names.get(m.epgChannelId) : undefined;
            return (
              <div class="match-row">
                <ChannelLogo ch={c} src={c.logo} name={c.name} size="sm" />
                <div class="match-ch">
                  <b>{c.name}</b>
                  <small class="muted">{c.tvgId ? `tvg-id: ${c.tvgId}` : 'no tvg-id'}</small>
                </div>
                <Icon name="chevronRight" class="muted" />
                <div class="match-sugg">
                  {suggestion ? (
                    <>
                      <span>{suggestion}</span>
                      <small class={`pill ${m!.status === 'pending' ? 'warn' : 'ok'}`}>
                        {m!.status === 'pending' ? `${Math.round(m!.confidence * 100)}% confidence` : m!.method === 'manual' ? 'set by you' : `matched by ${m!.method}`}
                      </small>
                    </>
                  ) : (
                    <span class="muted">{m?.status === 'rejected' ? 'No guide (your choice)' : 'No suggestion'}</span>
                  )}
                </div>
                <div class="row gap-sm">
                  {m?.status === 'pending' && m.epgChannelId && (
                    <>
                      <Button small variant="primary" icon="check" onClick={() => void decideMatch(c.key, 'approved', m.epgChannelId)}>Approve</Button>
                      <Button small icon="close" onClick={() => void decideMatch(c.key, 'rejected', m.epgChannelId)}>Reject</Button>
                    </>
                  )}
                  <Button small icon="search" onClick={() => setPicking(c)}>Choose…</Button>
                </div>
              </div>
            );
          })}
          {list.length > 300 && <p class="muted">Showing the first 300 of {list.length}. Use Channels → Show: “Without guide” and the channel options to handle the rest.</p>}
        </div>
      )}
      {picking && <MatchPicker ch={picking} onClose={() => setPicking(null)} />}
    </section>
  );
}
