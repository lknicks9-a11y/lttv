// "LTTV League Pass took a timeout": the screen League Pass shows when no game is on. Your own pictures fade one
// into the next with the words and logo laid over them, and your own songs play on a loop. The files are yours and
// stay on your devices: a "timeout" folder beside LTTV on the computer (the Fire TV reads it over the home network).
import { h, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { native, openRemote, proxiedUrl } from '../app/platform';
import { getState, updateSettings } from '../app/state';

export interface TimeoutMedia {
  images: string[];
  audio: string[];
}
const NONE: TimeoutMedia = { images: [], audio: [] };
let cached: { at: number; job: Promise<TimeoutMedia> } | null = null;

async function load(): Promise<TimeoutMedia> {
  try {
    if (!native) {
      // On the computer: straight from the helper.
      const r = await fetch('api/timeout');
      if (!r.ok) return NONE;
      const j = (await r.json()) as { images?: string[]; audio?: string[]; lan?: string };
      const has = (j.images?.length ?? 0) + (j.audio?.length ?? 0) > 0;
      // Remember where this computer is on the home network: the setting travels with your account, and the Fire TV
      // uses it to find the same folder.
      if (has && j.lan && getState().settings.timeoutMedia !== j.lan) void updateSettings({ timeoutMedia: j.lan });
      const url = (n: string) => `timeout/${encodeURIComponent(n)}`;
      return { images: (j.images ?? []).map(url), audio: (j.audio ?? []).map(url) };
    }
    const base = (getState().settings.timeoutMedia ?? '').replace(/\/+$/, '');
    if (!/^https?:\/\//.test(base)) return NONE;
    const { stream } = await openRemote(`${base}/timeout.json`, AbortSignal.timeout?.(6000));
    const j = JSON.parse(await new Response(stream).text()) as { images?: string[]; audio?: string[] };
    const url = (n: string) => proxiedUrl(`${base}/timeout/${encodeURIComponent(n)}`);
    return { images: (j.images ?? []).map(url), audio: (j.audio ?? []).map(url) };
  } catch {
    return NONE; // computer off, folder missing: the plain off-air screen shows instead
  }
}
/** The pictures and songs (looked up again after five minutes, so new files and a computer that woke up are found). */
export function timeoutMedia(): Promise<TimeoutMedia> {
  if (!cached || Date.now() - cached.at > 5 * 60_000) cached = { at: Date.now(), job: load() };
  return cached.job;
}
export function useTimeoutMedia(): TimeoutMedia {
  const [m, setM] = useState<TimeoutMedia>(NONE);
  useEffect(() => {
    let alive = true;
    void timeoutMedia().then((v) => alive && setM(v));
    return () => {
      alive = false;
    };
  }, []);
  return m;
}

const MUSIC_KEY = 'lttvTimeoutMusic';
export function musicOn(): boolean {
  try {
    return localStorage.getItem(MUSIC_KEY) !== '0';
  } catch {
    return true;
  }
}
export function setMusicOn(on: boolean) {
  try {
    localStorage.setItem(MUSIC_KEY, on ? '1' : '0');
  } catch {
    /* not remembered */
  }
  window.dispatchEvent(new Event('lttv-timeout-music'));
}

/** Your songs, one after another, on a loop, fading in and out with the screen. */
function useMusic(tracks: string[]) {
  const [on, setOn] = useState(musicOn);
  useEffect(() => {
    const f = () => setOn(musicOn());
    window.addEventListener('lttv-timeout-music', f);
    return () => window.removeEventListener('lttv-timeout-music', f);
  }, []);
  useEffect(() => {
    if (!on || !tracks.length) return;
    const a = new Audio();
    let k = Math.floor(Math.random() * tracks.length);
    let fade = 0;
    const LOUD = 0.7;
    const ramp = (to: number, done?: () => void) => {
      window.clearInterval(fade);
      fade = window.setInterval(() => {
        const v = a.volume + (to > a.volume ? 0.05 : -0.07);
        a.volume = Math.max(0, Math.min(LOUD, v));
        if ((to > 0 && a.volume >= to) || (to === 0 && a.volume <= 0.001)) {
          window.clearInterval(fade);
          done?.();
        }
      }, 100);
    };
    const play = () => {
      a.src = tracks[k % tracks.length];
      a.volume = 0;
      void a.play().then(() => ramp(LOUD)).catch(() => undefined);
    };
    const next = () => {
      k++;
      play();
    };
    a.addEventListener('ended', next);
    a.addEventListener('error', next);
    play();
    return () => {
      a.removeEventListener('ended', next);
      a.removeEventListener('error', next);
      ramp(0, () => {
        a.pause();
        a.removeAttribute('src');
      });
    };
  }, [on, tracks.join('|')]);
}

/** The pictures cross-fading behind `children` (the words). Only two pictures are ever on screen at once. */
export function TimeoutShow({ media, children }: { media: TimeoutMedia; children: ComponentChildren }) {
  const [i, setI] = useState(0);
  const prev = useRef(-1);
  const n = media.images.length;
  useEffect(() => {
    if (n < 2) return;
    const t = window.setInterval(() => setI((x) => {
      prev.current = x;
      return (x + 1) % n;
    }), 9000);
    return () => window.clearInterval(t);
  }, [n]);
  useMusic(media.audio);
  const img = (k: number, cls: string) => <div class={`lp-slide ${cls}`} key={media.images[k]} style={{ backgroundImage: `url("${media.images[k]}")` }} />;
  return (
    <div class="lp-timeout">
      {n > 0 && prev.current >= 0 && prev.current !== i && img(prev.current, 'out')}
      {n > 0 && img(i % n, 'in')}
      <div class="lp-timeout-shade" />
      <div class="lp-timeout-text">{children}</div>
    </div>
  );
}
