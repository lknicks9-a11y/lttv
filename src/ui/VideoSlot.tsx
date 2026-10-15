import { h, Fragment } from 'preact';
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { player } from '../app/state';

/** Marks where the video should appear. The player positions the <video> (desktop) or native surface (TV) over it. */
export function VideoSlot({ children, priority = 0, class: cls }: { children?: ComponentChildren; priority?: number; class?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => player.registerSlot(ref.current!, priority), [priority]);
  return (
    <div class={'video-slot ' + (cls ?? '')} ref={ref}>
      <div class="video-slot-overlay">{children}</div>
    </div>
  );
}
