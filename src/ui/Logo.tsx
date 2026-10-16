import { h, Fragment } from 'preact';

let gid = 0;

/**
 * LTTV mark in the Frutiger Aero style: a glossy sky-blue screen with a green
 * aurora hill, a glass highlight across the top, a white "LT" and a bubble on-air dot.
 */
export function LogoMark({ size = '3rem', class: cls }: { size?: string; class?: string }) {
  return (
    <>
      <AeroMark size={size} class={cls} />
      <OwlMark size={size} class={cls} />
    </>
  );
}

/**
 * Luxury theme mark: an original owl drawn as a little TV — the screen is its face, the two
 * round "lenses" its eyes, the antennas its ear tufts and the stand its feet — in fine gold line.
 */
export function OwlMark({ size = '3rem', class: cls }: { size?: string; class?: string }) {
  const n = ++gid;
  const g = `lttv-owl${n}`;
  return (
    <svg class={'logo-mark logo-owl ' + (cls ?? '')} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f3e2b8" /><stop offset="1" stop-color="#b08a43" />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${g})`} stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M24 13 17 4M40 13 47 4" />
        <rect x="10" y="13" width="44" height="38" rx="15" fill="#0b0a08" />
        <circle cx="24.5" cy="29" r="7.5" />
        <circle cx="39.5" cy="29" r="7.5" />
        <path d="M28 42.5 32 45.5 36 42.5" />
        <path d="M27 51v5M37 51v5M22 57h20" />
      </g>
      <g fill={`url(#${g})`}>
        <circle cx="17" cy="4" r="1.8" /><circle cx="47" cy="4" r="1.8" />
        <circle class="logo-dot" cx="24.5" cy="29" r="2.8" /><circle cx="39.5" cy="29" r="2.8" />
        <path d="M32 33.5 34.6 36.6 32 39.6 29.4 36.6Z" />
      </g>
    </svg>
  );
}

function AeroMark({ size = '3rem', class: cls }: { size?: string; class?: string }) {
  const n = ++gid;
  const id = (k: string) => `lttv-${k}${n}`;
  return (
    <svg class={'logo-mark logo-aero ' + (cls ?? '')} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={id('sky')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8fe6ff" /><stop offset=".5" stop-color="#1f9ce9" /><stop offset="1" stop-color="#0a4aa6" />
        </linearGradient>
        <linearGradient id={id('grass')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#d4ff86" /><stop offset=".55" stop-color="#6fdc4a" /><stop offset="1" stop-color="#1fa64f" />
        </linearGradient>
        <linearGradient id={id('gloss')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity=".9" /><stop offset="1" stop-color="#fff" stop-opacity=".06" />
        </linearGradient>
        <radialGradient id={id('bub')} cx=".35" cy=".3" r=".75">
          <stop offset="0" stop-color="#fff" /><stop offset=".45" stop-color="#c9f4ff" stop-opacity=".55" /><stop offset="1" stop-color="#5cc8ff" stop-opacity=".35" />
        </radialGradient>
        <clipPath id={id('scr')}><rect x="4" y="8" width="56" height="42" rx="12" /></clipPath>
      </defs>
      <ellipse cx="32" cy="57.5" rx="13" ry="3" fill="#0a4aa6" opacity=".35" />
      <rect x="25" y="49" width="14" height="6" rx="3" fill={`url(#${id('sky')})`} />
      <rect x="4" y="8" width="56" height="42" rx="12" fill={`url(#${id('sky')})`} />
      <g clip-path={`url(#${id('scr')})`}>
        <path d="M0 43c14-10 30 2 64-13v26H0z" fill={`url(#${id('grass')})`} />
        <path d="M0 39.5c18-10 34 0 64-14" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.4" />
        <path d="M-2 47c20-6 36 2 68-8" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1" />
        <ellipse cx="32" cy="11" rx="31" ry="13.5" fill={`url(#${id('gloss')})`} />
      </g>
      <rect x="4.7" y="8.7" width="54.6" height="40.6" rx="11.3" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="1.4" />
      <g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="5.4">
        <path d="M16.3 20.7v16.8h9.4M31 20.7h16.6M39.3 20.7v16.8" stroke="#06336f" stroke-opacity=".35" transform="translate(.6 1)" />
        <path d="M16.3 20.7v16.8h9.4M31 20.7h16.6M39.3 20.7v16.8" stroke="#fff" />
      </g>
      <circle class="logo-dot" cx="51" cy="38.5" r="3.7" fill={`url(#${id('bub')})`} stroke="#fff" stroke-opacity=".85" stroke-width=".8" />
    </svg>
  );
}

export function Wordmark({ class: cls }: { class?: string }) {
  return (
    <span class={'wordmark ' + (cls ?? '')} aria-label="LTTV">
      LT<span class="wordmark-tv">TV</span>
    </span>
  );
}
