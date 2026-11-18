import { h, type ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';

/**
 * A screen that's only downloaded and run when it's first shown. Each LTTV app (Live TV, Movies & Shows,
 * League Pass, Blitz) then starts with just its own part — the others' code is never loaded.
 */
export function lazy<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  let C: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  const start = () => (pending ??= load().then((c) => void (C = c)));
  function Lazy(props: P) {
    const [, ready] = useState(0);
    useEffect(() => {
      if (!C) void start().then(() => ready((n) => n + 1));
    }, []);
    return C ? h(C, props) : null;
  }
  return Lazy;
}
