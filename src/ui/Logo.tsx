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
      <A7Mark size={size} class={cls} />
      <AutumnMark size={size} class={cls} />
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

/**
 * A7 theme mark: the TV screen is a glowing cosmic orb — flame-orange rim, pink / teal / gold
 * nebula inside, glitch streaks — with a small white winged figure and halo floating in front.
 */
export function A7Mark({ size = '3rem', class: cls }: { size?: string; class?: string }) {
  const n = ++gid;
  const id = (k: string) => `lttv-a7${k}${n}`;
  return (
    <svg class={'logo-mark logo-a7 ' + (cls ?? '')} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <radialGradient id={id('orb')} cx=".5" cy=".46" r=".52">
          <stop offset="0" stop-color="#2a1240" />
          <stop offset=".32" stop-color="#9b2f7a" />
          <stop offset=".5" stop-color="#ff4f9a" />
          <stop offset=".64" stop-color="#ffcf4a" />
          <stop offset=".8" stop-color="#ff6a2b" />
          <stop offset="1" stop-color="#ff6a2b" stop-opacity="0" />
        </radialGradient>
        <radialGradient id={id('teal')} cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color="#7ff3e6" stop-opacity=".85" /><stop offset="1" stop-color="#7ff3e6" stop-opacity="0" />
        </radialGradient>
        <linearGradient id={id('rim')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffb066" /><stop offset=".5" stop-color="#ff4f9a" /><stop offset="1" stop-color="#ffd84d" />
        </linearGradient>
        <radialGradient id={id('glow')} cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color="#fff" /><stop offset=".6" stop-color="#fff" stop-opacity=".55" /><stop offset="1" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
        <clipPath id={id('scr')}><rect x="5" y="10" width="54" height="39" rx="12" /></clipPath>
      </defs>
      {/* antennas with little stars */}
      <path d="M26 10 20 3M38 10 44 3" stroke={`url(#${id('rim')})`} stroke-width="1.8" stroke-linecap="round" />
      <circle cx="20" cy="3" r="1.6" fill="#fff4e6" /><circle cx="44" cy="3" r="1.6" fill="#ffd84d" />
      {/* screen: deep space with stars */}
      <rect x="5" y="10" width="54" height="39" rx="12" fill="#07060c" />
      <g clip-path={`url(#${id('scr')})`}>
        <circle cx="12" cy="16" r=".7" fill="#fff" opacity=".8" /><circle cx="52" cy="15" r=".6" fill="#fff" opacity=".7" />
        <circle cx="54" cy="42" r=".7" fill="#fff" opacity=".6" /><circle cx="10" cy="41" r=".5" fill="#fff" opacity=".6" />
        <circle cx="32" cy="29.5" r="17" fill={`url(#${id('orb')})`} />
        <circle cx="32" cy="29.5" r="15.6" fill="none" stroke="#ff7a33" stroke-width="2.2" opacity=".85" />
        {/* glitch streaks across the orb */}
        <rect x="14" y="20" width="16" height="1.1" fill="#ff7a33" opacity=".7" />
        <rect x="36" y="25" width="13" height=".9" fill="#7ff3e6" opacity=".55" />
        <rect x="17" y="36" width="11" height="1" fill="#ffd84d" opacity=".6" />
        <rect x="35" y="39" width="14" height=".9" fill="#ff4f9a" opacity=".6" />
        {/* clouds at the bottom of the orb */}
        <ellipse cx="22" cy="44" rx="7" ry="2.6" fill="#fff" opacity=".55" />
        <ellipse cx="42" cy="44.5" rx="8" ry="2.4" fill="#fff" opacity=".45" />
        <ellipse cx="38" cy="31" rx="7" ry="5" fill={`url(#${id('teal')})`} />
        {/* winged figure with halo */}
        <circle cx="32" cy="29" r="6.5" fill={`url(#${id('glow')})`} opacity=".35" />
        <ellipse cx="32" cy="20.4" rx="2.7" ry=".95" fill="none" stroke="#fff" stroke-width=".85" />
        <circle cx="32" cy="22.9" r="1.45" fill="#fff" />
        <path d="M30.7 25h2.6l-.5 6.2.6 6.4h-1.1l-.3-5.2-.3 5.2h-1.1l.6-6.4z" fill="#fff" />
        <path d="M30.6 25.6C27.4 22.6 23.2 20.2 18.6 20c2.6 1.5 4.6 3.6 5.8 6-1.6-.5-3.2-.5-4.6 0 3.4.8 6 2.3 8.2 4.2.6-1.6 1.4-3.2 2.6-4.6ZM33.4 25.6c3.2-3 7.4-5.4 12-5.6-2.6 1.5-4.6 3.6-5.8 6 1.6-.5 3.2-.5 4.6 0-3.4.8-6 2.3-8.2 4.2-.6-1.6-1.4-3.2-2.6-4.6Z" fill="#fff" opacity=".96" />
      </g>
      <rect x="5" y="10" width="54" height="39" rx="12" fill="none" stroke={`url(#${id('rim')})`} stroke-width="1.8" />
      {/* stand */}
      <path d="M27 49v5M37 49v5M22 55.5h20" stroke={`url(#${id('rim')})`} stroke-width="1.8" stroke-linecap="round" />
      <circle class="logo-dot" cx="52.5" cy="44" r="1.6" fill="#ff7a33" />
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

/**
 * Autumn theme mark: a TV whose screen is a golden fall sky with a tree-lined road
 * running into the distance and a falling leaf.
 */
export function AutumnMark({ size = '3rem', class: cls }: { size?: string; class?: string }) {
  const n = ++gid;
  const id = (k: string) => `lttv-aut${k}${n}`;
  return (
    <svg class={'logo-mark logo-autumn ' + (cls ?? '')} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={id('sky')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffd36b" /><stop offset=".55" stop-color="#ff9a2e" /><stop offset="1" stop-color="#c2410c" />
        </linearGradient>
        <linearGradient id={id('rim')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffd36b" /><stop offset="1" stop-color="#e2620f" />
        </linearGradient>
        <clipPath id={id('clip')}><rect x="5" y="10" width="54" height="39" rx="11" /></clipPath>
      </defs>
      <path d="M26 10 20 3M38 10 44 3" stroke={`url(#${id('rim')})`} stroke-width="1.9" stroke-linecap="round" />
      <circle cx="20" cy="3" r="1.7" fill="#ffc24a" /><circle cx="44" cy="3" r="1.7" fill="#ff8a1e" />
      <rect x="5" y="10" width="54" height="39" rx="11" fill={`url(#${id('sky')})`} />
      <g clip-path={`url(#${id('clip')})`}>
        {/* road */}
        <path d="M29.5 33h5L46 50H18Z" fill="#8a5a3a" opacity=".85" />
        {/* tree trunks */}
        <path d="M13 50 15 26h2.4L19 50ZM45 50l1.6-24H49l2 24ZM24 40l1-12h1.4l.8 12ZM37.6 40l.8-12h1.4l1 12Z" fill="#3b2314" />
        {/* canopies */}
        <circle cx="13" cy="20" r="9" fill="#e2620f" /><circle cx="20" cy="17" r="7" fill="#ff8a1e" />
        <circle cx="51" cy="20" r="9" fill="#e2620f" /><circle cx="44" cy="17" r="7" fill="#ffb02e" />
        <circle cx="26" cy="25" r="4.5" fill="#ffb02e" /><circle cx="38.5" cy="25" r="4.5" fill="#ff8a1e" />
        {/* leaves on the road */}
        <circle cx="25" cy="47" r="1.1" fill="#ffd36b" /><circle cx="38" cy="45" r="1" fill="#ffc24a" /><circle cx="31" cy="44" r=".9" fill="#ff8a1e" />
      </g>
      <rect x="5" y="10" width="54" height="39" rx="11" fill="none" stroke={`url(#${id('rim')})`} stroke-width="1.8" />
      {/* falling leaf */}
      <path class="logo-dot" d="M53 41c2.6-.2 4.2 1.4 4.4 4-2.6.2-4.2-1.4-4.4-4Zm.4.4 3.6 3.6" fill="#ffc24a" stroke="#c2410c" stroke-width=".5" />
      <path d="M27 49v5M37 49v5M22 55.5h20" stroke={`url(#${id('rim')})`} stroke-width="1.9" stroke-linecap="round" />
    </svg>
  );
}
