/**
 * Spatial (D-pad) navigation for TV remotes, also used with arrow keys on desktop.
 *
 * - Focusable elements: anything with the `f` class (plus native inputs/buttons inside scopes).
 * - Scopes: the top-most open element with [data-scope] traps focus (modals, player OSD).
 * - Groups: elements with [data-group] remember their last focused child; entering a
 *   group from outside restores that child (sidebar -> list returns to the same row).
 * - Components can handle keys themselves (call e.preventDefault() in onKeyDown);
 *   the global handler ignores events that are already handled.
 * - Back is a stack of handlers; screens/overlays push and pop them.
 */

export type Dir = 'up' | 'down' | 'left' | 'right';

const KEY_DIR: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

export function keyDir(e: KeyboardEvent): Dir | undefined {
  return KEY_DIR[e.key];
}

function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none';
}

export function currentScope(): HTMLElement {
  const scopes = Array.from(document.querySelectorAll<HTMLElement>('[data-scope]')).filter(isVisible);
  return scopes[scopes.length - 1] ?? document.body;
}

function focusables(scope: HTMLElement): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>('.f:not([disabled]), [data-scope] input:not([type=hidden]), [data-scope] select, [data-scope] textarea'))
    .filter((el) => isVisible(el) && !el.closest('[data-nav-skip]') && (scope === document.body ? !el.closest('[data-scope]') : true));
}

function center(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Score a candidate; lower is better. Infinity = not in that direction. */
function score(from: DOMRect, to: DOMRect, dir: Dir): number {
  const fc = center(from);
  const tc = center(to);
  const eps = 2;
  let primary: number;
  let overlap: number;
  if (dir === 'right' || dir === 'left') {
    if (dir === 'right' ? to.left < from.right - eps && tc.x <= fc.x + eps : to.right > from.left + eps && tc.x >= fc.x - eps) return Infinity;
    primary = dir === 'right' ? Math.max(0, to.left - from.right) : Math.max(0, from.left - to.right);
    overlap = Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top);
    const secondary = overlap > 0 ? 0 : Math.abs(tc.y - fc.y);
    return primary + secondary * 3 - (overlap > 0 ? Math.min(overlap, from.height) * 0.5 : 0);
  }
  if (dir === 'down' ? to.top < from.bottom - eps && tc.y <= fc.y + eps : to.bottom > from.top + eps && tc.y >= fc.y - eps) return Infinity;
  primary = dir === 'down' ? Math.max(0, to.top - from.bottom) : Math.max(0, from.top - to.bottom);
  overlap = Math.min(from.right, to.right) - Math.max(from.left, to.left);
  // Prefer the target aligned with the left edge (reading order) or centre of the source.
  const align = Math.min(Math.abs(tc.x - fc.x), Math.abs(to.left - from.left));
  const secondary = overlap > 0 ? align * 0.2 : align * 2;
  return primary + secondary;
}

const lastInGroup = new WeakMap<HTMLElement, HTMLElement>();

export function focusEl(el: HTMLElement | null | undefined, opts: { scroll?: boolean } = {}): boolean {
  if (!el) return false;
  el.focus({ preventScroll: true });
  if (opts.scroll !== false) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return document.activeElement === el;
}

export function moveFocus(dir: Dir, from?: HTMLElement): boolean {
  const scope = currentScope();
  const active = from ?? (document.activeElement as HTMLElement | null);
  const list = focusables(scope);
  if (!active || active === document.body || !scope.contains(active)) {
    // Focus was lost (e.g. the focused element was removed): recover inside the main content.
    const content = scope === document.body ? document.querySelector<HTMLElement>('[data-group="content"]') : null;
    if (content && focusFirst(content)) return true;
    return focusEl(list[0]);
  }
  const fr = active.getBoundingClientRect();
  let best = null as HTMLElement | null;
  let bestScore = Infinity;
  // Up/down stay inside the current zone (sidebar vs. screen content) when possible;
  // only left/right cross between zones, which is how TV menus behave.
  const zone = active.closest<HTMLElement>('[data-zone]');
  let pool = list;
  if ((dir === 'up' || dir === 'down') && zone) pool = list.filter((el) => zone.contains(el));
  // Grids marked [data-hlock] keep left/right inside them (no jumping up to a tab row at a row's end).
  const hlock = dir === 'left' || dir === 'right' ? active.closest<HTMLElement>('[data-hlock]') : null;
  if (hlock) pool = list.filter((el) => hlock.contains(el));
  // Up/down: only consider the nearest "row" in that direction, then pick the best-aligned element in it.
  if (dir === 'up' || dir === 'down') {
    const gap = (r: DOMRect) => (dir === 'down' ? r.top - fr.bottom : fr.top - r.bottom);
    const inDir = pool.filter((el) => el !== active && !el.contains(active) && score(fr, el.getBoundingClientRect(), dir) < Infinity);
    if (inDir.length) {
      const nearest = Math.min(...inDir.map((el) => Math.max(0, gap(el.getBoundingClientRect()))));
      const tol = Math.max(24, fr.height * 0.6);
      pool = inDir.filter((el) => Math.max(0, gap(el.getBoundingClientRect())) <= nearest + tol);
    }
  }
  const pick = (cands: HTMLElement[]) => {
    for (const el of cands) {
      if (el === active || el.contains(active)) continue;
      const s = score(fr, el.getBoundingClientRect(), dir);
      if (s < bestScore) {
        bestScore = s;
        best = el;
      }
    }
  };
  pick(pool);
  // Left at the start of a locked row still reaches the menu (sidebar).
  if (!best && hlock && dir === 'left') pick(list.filter((el) => el.closest('[data-group="sidebar"]')));
  best = best as HTMLElement | null;
  if (!best) return !!hlock;
  // Restore the remembered element when entering a group from outside.
  const group = best.closest<HTMLElement>('[data-group]');
  if (group && !group.contains(active)) {
    const remembered = lastInGroup.get(group);
    if (remembered && remembered.isConnected && isVisible(remembered) && scope.contains(remembered)) best = remembered;
    else {
      const pref = group.querySelector<HTMLElement>('[data-default-focus]');
      if (pref && isVisible(pref)) best = pref;
    }
  }
  return focusEl(best);
}

/** Focus the first focusable element (or the [data-autofocus] one) within an element. */
export function focusFirst(root: HTMLElement | null): boolean {
  if (!root) return false;
  const auto = root.querySelector<HTMLElement>('[data-autofocus]');
  if (auto && isVisible(auto)) return focusEl(auto);
  const scope = root.closest<HTMLElement>('[data-scope]') ?? document.body;
  const list = focusables(scope).filter((el) => root.contains(el));
  return focusEl(list[0]);
}

// ---------------- Back handling ----------------

type BackHandler = () => boolean | void;
const backStack: BackHandler[] = [];

/** Register a back handler; returns an unregister function. Most recent wins. Return false to pass through. */
export function onBack(h: BackHandler): () => void {
  backStack.push(h);
  return () => {
    const i = backStack.lastIndexOf(h);
    if (i >= 0) backStack.splice(i, 1);
  };
}

export function goBack(): boolean {
  for (let i = backStack.length - 1; i >= 0; i--) {
    if (backStack[i]() !== false) return true;
  }
  return false;
}

// ---------------- Global key handling ----------------

export type AppKey = 'menu' | 'playpause' | 'play' | 'pause' | 'ffwd' | 'rewind' | 'chup' | 'chdown' | 'info' | 'guide';
type KeyListener = (k: AppKey) => boolean | void;
const keyListeners: KeyListener[] = [];

export function onAppKey(l: KeyListener): () => void {
  keyListeners.push(l);
  return () => {
    const i = keyListeners.lastIndexOf(l);
    if (i >= 0) keyListeners.splice(i, 1);
  };
}

export function dispatchAppKey(k: AppKey): boolean {
  for (let i = keyListeners.length - 1; i >= 0; i--) if (keyListeners[i](k) !== false) return true;
  return false;
}

function isTextField(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const t = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'file', 'color'].includes(t);
  }
  return (el as HTMLElement).isContentEditable;
}

let installed = false;
export let lastInputWasPointer = false;

export function installNavigation(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement;
    let g = t.closest<HTMLElement>('[data-group]');
    while (g) {
      lastInGroup.set(g, t);
      g = g.parentElement?.closest<HTMLElement>('[data-group]') ?? null;
    }
  });
  document.addEventListener('mousedown', () => {
    lastInputWasPointer = true;
    document.documentElement.classList.add('pointer');
  }, true);
  window.addEventListener('keydown', (e) => {
    lastInputWasPointer = false;
    document.documentElement.classList.remove('pointer');
    if (e.defaultPrevented) return;
    const active = document.activeElement as HTMLElement | null;
    const typing = isTextField(active);
    const dir = keyDir(e);
    if (dir) {
      if (typing) {
        // Inside text fields, left/right move the caret; up/down leave the field.
        const input = active as HTMLInputElement;
        if (dir === 'left' || dir === 'right') {
          const atStart = (input.selectionStart ?? 0) === 0 && (input.selectionEnd ?? 0) === 0;
          const atEnd = (input.selectionStart ?? 0) >= (input.value?.length ?? 0);
          if (!(dir === 'left' && atStart) && !(dir === 'right' && atEnd)) return;
        }
        if (active?.tagName === 'SELECT') return;
      }
      if (active?.tagName === 'SELECT' && (dir === 'up' || dir === 'down')) return;
      e.preventDefault();
      moveFocus(dir);
      return;
    }
    if ((!active || active === document.body) && e.key === 'Enter') {
      e.preventDefault();
      moveFocus('down');
      return;
    }
    switch (e.key) {
      case 'Enter':
        if (active && active !== document.body && !typing && active.tagName !== 'BUTTON' && active.tagName !== 'A' && active.tagName !== 'SELECT') {
          e.preventDefault();
          active.click();
        }
        return;
      case 'Escape':
      case 'GoBack':
      case 'BrowserBack':
        e.preventDefault();
        if (typing) {
          (active as HTMLElement).blur();
          return;
        }
        goBack();
        return;
      case 'Backspace':
        if (!typing) {
          e.preventDefault();
          goBack();
        }
        return;
      case 'ContextMenu':
      case 'm':
      case 'M':
        if (typing) return;
        if (dispatchAppKey('menu')) e.preventDefault();
        return;
      case 'MediaPlayPause':
      case ' ':
        if (typing || (e.key === ' ' && active?.tagName === 'BUTTON')) return;
        if (dispatchAppKey('playpause')) e.preventDefault();
        return;
      case 'MediaPlay':
        if (dispatchAppKey('play')) e.preventDefault();
        return;
      case 'MediaPause':
        if (dispatchAppKey('pause')) e.preventDefault();
        return;
      case 'MediaFastForward':
        if (dispatchAppKey('ffwd')) e.preventDefault();
        return;
      case 'MediaRewind':
        if (dispatchAppKey('rewind')) e.preventDefault();
        return;
      case 'ChannelUp':
      case 'PageUp':
        if (typing) return;
        if (dispatchAppKey('chup')) e.preventDefault();
        return;
      case 'ChannelDown':
      case 'PageDown':
        if (typing) return;
        if (dispatchAppKey('chdown')) e.preventDefault();
        return;
      case 'i':
      case 'I':
      case 'Info':
        if (typing) return;
        if (dispatchAppKey('info')) e.preventDefault();
        return;
      case 'g':
      case 'G':
      case 'Guide':
        if (typing) return;
        if (dispatchAppKey('guide')) e.preventDefault();
        return;
    }
  });
}
