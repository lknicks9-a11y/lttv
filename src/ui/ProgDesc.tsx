import { h } from 'preact';
import type { LineupChannel, Programme } from '../core/types';
import { useProgrammeDescription } from '../app/describe';

const SOURCE: Record<string, string> = { schedule: 'From the ESPN schedule', tvmaze: 'From TVmaze', wikipedia: 'From Wikipedia' };

/** What a programme is about: the guide's own description, or one LTTV found for it (labelled). */
export function ProgDesc({ p, ch, class: cls = '', short }: { p: Programme; ch?: LineupChannel; class?: string; short?: boolean }) {
  const d = useProgrammeDescription(p, ch);
  if (d === undefined) return <p class={`${cls} prog-desc muted`}>{short ? '' : 'Looking up a description…'}</p>;
  if (!d) return short ? null : <p class={`${cls} prog-desc muted`}>No description available.</p>;
  return (
    <p class={`${cls} prog-desc ${short ? 'prog-desc-short' : ''} ${d.source === 'note' ? 'muted' : ''}`}>
      {d.text}
      {d.source !== 'guide' && d.source !== 'note' && <small class="desc-source"> · {SOURCE[d.source]}</small>}
    </p>
  );
}
