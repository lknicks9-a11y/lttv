import { h, Fragment, type ComponentChildren, type JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { focusFirst, onBack } from '../app/nav';
import { bestLogo, loadLogoIndex, logosReady, onLogosReady } from '../core/logos';

// ---------------- Icons (inline SVG, no network) ----------------
const ICONS: Record<string, string> = {
  volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  mute: 'M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z',
  fullscreen: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  multiview: 'M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z',
  sports: 'M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94A5.01 5.01 0 0 0 11 15.9V19H7v2h10v-2h-4v-3.1a5.01 5.01 0 0 0 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z',
  bell: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  live: 'M21 6h-7.59l3.29-3.29L16 2l-4 4-4-4-.71.71L10.59 6H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm0 14H3V8h18v12z',
  guide: 'M3 4h18v2H3V4zm0 4h6v5H3V8zm8 0h10v5H11V8zm-8 7h10v5H3v-5zm12 0h6v5h-6v-5z',
  channels: 'M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  sources: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 14-5-5h3V8h4v4h3l-5 5z',
  settings: 'M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.61.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.05.24.25.42.5.42h3.84c.25 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.48 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
  star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  starOutline: 'm22 9.24-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z',
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  refresh: 'M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  hidden: 'M12 7a5 5 0 0 1 5 5c0 .65-.13 1.26-.36 1.83l2.92 2.92A11.8 11.8 0 0 0 22.99 12 11.83 11.83 0 0 0 12 4.5c-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12a11.82 11.82 0 0 0 15.38 6.66l.42.42L19.73 22 21 20.73 3.27 3 2 4.27z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  move: 'M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H7l5 5 5-5h-3v-3z',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
  link: 'M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12zM8 13h8v-2H8v2zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10z',
  now: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  warn: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  tv: 'M21 3H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5v2h8v-2h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 14H3V5h18v12z',
  chevronRight: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  chevronLeft: 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  rewind: 'M11 18V6l-8.5 6 8.5 6zm.5-6 8.5 6V6l-8.5 6z',
  ffwd: 'M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z',
  menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
};

export function Icon({ name, size = '1.25em', class: cls }: { name: keyof typeof ICONS | string; size?: string; class?: string }) {
  return (
    <svg class={'icon ' + (cls ?? '')} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.info} fill="currentColor" />
    </svg>
  );
}

// ---------------- Channel logo with graceful fallback ----------------
const failedLogos = new Set<string>();

/**
 * A channel's logo: the matching high-quality transparent logo when there is one
 * (see core/logos.ts), else the playlist's logo, else initials.
 */
export function ChannelLogo({ src, name, size = 'md', ch }: { src?: string; name: string; size?: 'sm' | 'md' | 'lg'; ch?: Parameters<typeof bestLogo>[0] }) {
  const [, setReady] = useState(logosReady());
  useEffect(() => {
    if (!ch || logosReady()) return;
    void loadLogoIndex();
    return onLogosReady(() => setReady(true));
  }, [ch?.key]);
  const hq = ch ? bestLogo(ch) : undefined;
  const [, bump] = useState(0);
  const pick = [hq, src].find((u) => u && !failedLogos.has(u));
  const initials = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 3);
  if (!pick) return <div class={`logo logo-${size} logo-fallback`} aria-hidden="true">{initials || 'TV'}</div>;
  return (
    <div class={`logo logo-${size} ${pick === hq ? 'logo-hq' : ''}`}>
      <img
        key={pick}
        src={pick}
        alt=""
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        onError={() => {
          failedLogos.add(pick);
          bump((x) => x + 1);
        }}
      />
    </div>
  );
}

export function Progress({ value, class: cls }: { value: number; class?: string }) {
  return (
    <div class={'progress ' + (cls ?? '')} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div class="progress-fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

type BtnProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: string; variant?: 'primary' | 'ghost' | 'danger' | 'default'; small?: boolean };
export function Button({ icon, variant = 'default', small, children, class: cls, ...rest }: BtnProps) {
  return (
    <button type="button" class={`f btn btn-${variant} ${small ? 'btn-sm' : ''} ${cls ?? ''}`} {...rest}>
      {icon && <Icon name={icon} />}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Chip({ active, children, onClick, count, ...rest }: { active?: boolean; children: ComponentChildren; onClick: () => void; count?: number } & JSX.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" class={`f chip ${active ? 'chip-active' : ''}`} aria-pressed={!!active} onClick={onClick} {...rest}>
      {children}
      {count !== undefined && <span class="chip-count">{count}</span>}
    </button>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} class="f row-control toggle" onClick={() => onChange(!checked)}>
      <span class="row-control-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <span class={`switch ${checked ? 'on' : ''}`}><span /></span>
    </button>
  );
}

/**
 * Remote-friendly select. OK opens a list of options (up/down + OK to choose, Back to cancel).
 * Left/right are left alone so they keep moving focus, as users expect on a TV.
 */
export function Choice<T extends string | number>({ label, value, options, onChange, hint }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <>
      <button type="button" class="f row-control choice" aria-haspopup="listbox" onClick={() => setOpen(true)}>
        <span class="row-control-text">
          <span>{label}</span>
          {hint && <small>{hint}</small>}
        </span>
        <span class="choice-value">
          {current?.label}
          <Icon name="chevronRight" size="1em" />
        </span>
      </button>
      {open && (
        <Modal title={label} onClose={() => setOpen(false)} class="picker-modal">
          <div class="picker-options" role="listbox">
            {options.map((o) => (
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                class={`f picker-option ${o.value === value ? 'selected' : ''}`}
                data-autofocus={o.value === value ? '' : undefined}
                onClick={() => {
                  setOpen(false);
                  if (o.value !== value) onChange(o.value);
                }}
              >
                <span>{o.label}</span>
                {o.value === value && <Icon name="check" />}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------------- Modal (focus scope) ----------------
export function Modal({ title, onClose, children, wide, class: cls }: { title?: string; onClose: () => void; children: ComponentChildren; wide?: boolean; class?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    prevFocus.current = document.activeElement as HTMLElement;
    focusFirst(ref.current);
    const off = onBack(() => {
      onClose();
      return true;
    });
    return () => {
      off();
      const p = prevFocus.current;
      if (p && p.isConnected) p.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`modal ${wide ? 'modal-wide' : ''} ${cls ?? ''}`} data-scope ref={ref} role="dialog" aria-modal="true" aria-label={title}>
        {title && <h2 class="modal-title">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

// ---------------- Virtualised list ----------------
/**
 * Fixed-height virtual list with its own up/down handling so thousands of rows
 * stay fast on low-end TV hardware. Left/right fall through to spatial navigation.
 */
export function VirtualList<T>({ items, rowHeight, render, keyOf, initialIndex = 0, onFocusIndex, class: cls, groupName, overscan = 6 }: {
  items: T[];
  rowHeight: number; // in px
  render: (item: T, index: number, focused: boolean) => ComponentChildren;
  keyOf: (item: T) => string;
  initialIndex?: number;
  onFocusIndex?: (i: number) => void;
  class?: string;
  groupName?: string;
  overscan?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const [focusIdx, setFocusIdx] = useState(Math.min(initialIndex, Math.max(0, items.length - 1)));
  const pendingFocus = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (focusIdx >= items.length) setFocusIdx(Math.max(0, items.length - 1));
  }, [items.length]);

  useLayoutEffect(() => {
    // scroll initial index into view
    const el = ref.current;
    if (el && initialIndex > 0) {
      el.scrollTop = Math.max(0, initialIndex * rowHeight - el.clientHeight / 2 + rowHeight / 2);
      setScrollTop(el.scrollTop);
    }
  }, []);

  const ensureVisible = (i: number) => {
    const el = ref.current!;
    const top = i * rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + rowHeight - el.clientHeight;
    setScrollTop(el.scrollTop);
  };

  const moveTo = (i: number) => {
    const n = Math.max(0, Math.min(items.length - 1, i));
    setFocusIdx(n);
    onFocusIndex?.(n);
    ensureVisible(n);
    pendingFocus.current = n;
  };

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const el = ref.current?.querySelector<HTMLElement>(`[data-index="${pendingFocus.current}"]`);
    pendingFocus.current = null;
    el?.focus({ preventScroll: true });
  });

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  const rows: ComponentChildren[] = [];
  for (let i = start; i < end; i++) {
    const it = items[i];
    rows.push(
      <div
        key={keyOf(it)}
        class="vrow"
        style={{ transform: `translateY(${i * rowHeight}px)`, height: `${rowHeight}px` }}
        onFocusCapture={() => {
          if (focusIdx !== i) {
            setFocusIdx(i);
            onFocusIndex?.(i);
          }
        }}
        onKeyDown={(e) => {
          if (e.defaultPrevented) return;
          const pageRows = Math.max(1, Math.floor(height / rowHeight) - 1);
          if (e.key === 'ArrowDown' && i < items.length - 1) {
            e.preventDefault();
            moveTo(i + 1);
          } else if (e.key === 'ArrowUp' && i > 0) {
            e.preventDefault();
            moveTo(i - 1);
          } else if (e.key === 'PageDown' || e.key === 'MediaFastForward') {
            e.preventDefault();
            moveTo(i + pageRows);
          } else if (e.key === 'PageUp' || e.key === 'MediaRewind') {
            e.preventDefault();
            moveTo(i - pageRows);
          }
        }}
      >
        {render(it, i, i === focusIdx)}
      </div>,
    );
  }
  return (
    <div
      ref={ref}
      class={'vlist ' + (cls ?? '')}
      data-group={groupName ?? 'vlist'}
      onScroll={(e) => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}
    >
      <div class="vlist-inner" style={{ height: `${items.length * rowHeight}px` }}>
        {rows}
      </div>
    </div>
  );
}

/** Measure 1rem in px (rows are sized in rem so they scale with the TV resolution). */
export function useRemPx(): number {
  const [px, setPx] = useState(() => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
  useEffect(() => {
    const on = () => setPx(parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return px;
}

export function Empty({ icon = 'tv', title, children, art }: { icon?: string; title: string; children?: ComponentChildren; art?: ComponentChildren }) {
  return (
    <div class="empty">
      {art ?? <Icon name={icon} size="3.5rem" />}
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function fmtBytes(n?: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export { h };
