import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import type { LineupChannel } from '../core/types';
import { channelHeadline } from '../core/events';
import { useApp, wantGuideFor } from '../app/state';
import { myTvName } from '../core/mytv';

/** My TV's New York network stations show as the station ("CBS 2 New York") unless renamed. */
function stationTitle(ch: LineupChannel): string | undefined {
  if (ch.myTv === undefined || ![2, 4, 5, 7].includes(ch.myTv) || ch.name !== ch.cleanedName) return undefined;
  return myTvName(ch.myTv)?.replace(/\s*\([A-Z]{4}\)$/, '');
}

/**
 * A channel's name as shown on screen. Live-event channels ("NFL 03", "PPV 2")
 * show the game that's on now (or starting soon) with the slot name small beside
 * it. Also asks the provider for this channel's guide if the guide file lacks it.
 */
export function ChannelName({ ch, class: cls = '' }: { ch: LineupChannel; class?: string }) {
  const guide = useApp((s) => s.guide);
  useApp((s) => s.guideVersion);
  const now = useApp((s) => s.now);
  const enabled = useApp((s) => s.settings.liveEventNames !== false);
  useEffect(() => wantGuideFor(ch), [ch.key, ch.url, ch.matchMethod]);
  const hl = channelHeadline(ch, guide, now, enabled);
  const station = stationTitle(ch);
  if (!hl.slot) return <span class={`ch-title ${cls}`} title={station ? ch.name : undefined}>{station ?? hl.title}</span>;
  return (
    <span class={`ch-title is-event ${cls}`} title={`${hl.title} · ${hl.slot}`}>
      {hl.live ? <span class="live-dot" aria-label="Live now" /> : null}
      <span class="ch-title-main">{hl.title}</span>
      <small class="ch-slot">{hl.slot}</small>
    </span>
  );
}

/** Plain-text version for labels and aria attributes. */
export function useChannelTitle(ch: LineupChannel | undefined): string {
  const guide = useApp((s) => s.guide);
  useApp((s) => s.guideVersion);
  const now = useApp((s) => s.now);
  const enabled = useApp((s) => s.settings.liveEventNames !== false);
  if (!ch) return '';
  const hl = channelHeadline(ch, guide, now, enabled);
  return hl.slot ? `${hl.title} (${hl.slot})` : stationTitle(ch) ?? hl.title;
}
