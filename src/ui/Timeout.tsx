// "LTTV League Pass took a timeout": the screen League Pass shows when no game is on. Your own pictures fade one
// into the next with the words and logo laid over them, and your own songs play on a loop. The files are yours and
// stay on your devices: a "timeout" folder beside LTTV on the computer (the Fire TV reads it over the home network).
import { h, Fragment, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { native, openRemote, proxiedUrl } from '../app/platform';
import { getState, updateSettings } from '../app/state';
import { TIMEOUT_ART, startBeat, teamArt } from './timeoutart';
import type { GameTeam } from '../core/schedule';

export interface TimeoutMedia {
  images: string[];
  /** The file name of each picture ("knicks/1.jpg"), to find a team's own. */
  names: string[];
  audio: string[];
}
const NONE: TimeoutMedia = { images: [], names: [], audio: [] };
let cached: { at: number; job: Promise<TimeoutMedia> } | null = null;

async function load(): Promise<TimeoutMedia> {
  try {
    if (!native) {
      // On the computer: straight from the helper.
      const r = await fetch('api/timeout');
      if (!r.ok) return NONE;
      const j = (await r.json()) as { images?: string[]; audio?: string[]; lan?: string; v?: Record<string, string> };
      const has = (j.images?.length ?? 0) + (j.audio?.length ?? 0) > 0;
      // Remember where this computer is on the home network: the setting travels with your account, and the Fire TV
      // uses it to find the same folder.
      if (has && j.lan && getState().settings.timeoutMedia !== j.lan) void updateSettings({ timeoutMedia: j.lan });
      const url = (n: string) => `timeout/${encodeURIComponent(n)}${j.v?.[n] ? `?v=${encodeURIComponent(j.v[n])}` : ''}`;
      return { images: (j.images ?? []).map(url), names: j.images ?? [], audio: (j.audio ?? []).map(url) };
    }
    return await loadOnTv();
  } catch {
    return NONE; // computer off, folder missing: the plain off-air screen shows instead
  }
}
// ---- Fire TV: copy the files from the computer once and keep them on the stick, so the timeout screen also works
// with the computer off. They are refreshed whenever the computer can be reached.
const LIST_KEY = 'lttvTimeoutList';
type Listing = { images: string[]; audio: string[]; v?: Record<string, string> };
let lastTvStatus = '';
/** What happened the last time the Fire TV looked for the files (shown in Settings). */
export const timeoutTvStatus = () => lastTvStatus;
async function loadOnTv(): Promise<TimeoutMedia> {
  const base = (getState().settings.timeoutMedia ?? '').trim().replace(/\/+$/, '');
  let list: Listing | null = null;
  let reached = false;
  if (/^https?:\/\//.test(base)) {
    try {
      const { stream } = await openRemote(`${base}/timeout.json`, AbortSignal.timeout?.(6000));
      const j = JSON.parse(await new Response(stream).text()) as Partial<Listing>;
      list = { images: j.images ?? [], audio: j.audio ?? [], v: j.v ?? {} };
      reached = true;
    } catch {
      /* computer off or asleep: use what was kept */
    }
  }
  if (!list) {
    try {
      list = JSON.parse(localStorage.getItem(LIST_KEY) ?? 'null') as Listing | null;
    } catch {
      list = null;
    }
  }
  if (!list) {
    lastTvStatus = base ? `Couldn’t reach the computer at ${base}. It has to be on with LTTV running, on the same Wi-Fi.` : 'No computer address yet.';
    return NONE;
  }
  const names = [...list.images, ...list.audio];
  if (typeof caches === 'undefined') {
    // No storage for them here: play straight from the computer.
    const url = (n: string) => proxiedUrl(`${base}/timeout/${encodeURIComponent(n)}`);
    lastTvStatus = reached ? `Found ${list.images.length} pictures and ${list.audio.length} songs on the computer.` : 'The computer isn’t reachable.';
    return reached ? { images: list.images.map(url), names: list.images, audio: list.audio.map(url) } : NONE;
  }
  const cache = await caches.open('lttv-timeout');
  // The version is part of the key: a picture replaced under the same name is fetched again, not the old copy.
  const key = (n: string) => `/timeout-kept/${encodeURIComponent(n)}${list!.v?.[n] ? `?v=${encodeURIComponent(list!.v[n])}` : ''}`;
  const urls = new Map<string, string>();
  for (const n of names) {
    let hit = await cache.match(key(n));
    if (!hit && reached) {
      try {
        const { stream } = await openRemote(`${base}/timeout/${encodeURIComponent(n)}`, AbortSignal.timeout?.(120_000));
        const blob = await tvSized(n, await new Response(stream).blob());
        if (blob.size > 0) {
          await cache.put(key(n), new Response(blob));
          hit = await cache.match(key(n));
        }
      } catch {
        /* skip this one for now */
      }
    }
    if (hit) {
      const type = /\.(mp3)$/i.test(n) ? 'audio/mpeg' : /\.(m4a|aac)$/i.test(n) ? 'audio/mp4' : /\.png$/i.test(n) ? 'image/png' : /\.webp$/i.test(n) ? 'image/webp' : /\.avif$/i.test(n) ? 'image/avif' : /\.gif$/i.test(n) ? 'image/gif' : /\.(ogg)$/i.test(n) ? 'audio/ogg' : /\.wav$/i.test(n) ? 'audio/wav' : 'image/jpeg';
      urls.set(n, URL.createObjectURL(new Blob([await hit.blob()], { type })));
    }
  }
  if (reached) {
    try {
      localStorage.setItem(LIST_KEY, JSON.stringify(list));
      // Files removed from the folder are forgotten here too.
      for (const req of await cache.keys()) if (!names.some((n) => req.url.endsWith(key(n)))) await cache.delete(req);
    } catch {
      /* not critical */
    }
  }
  const got = { images: list.images.flatMap((n) => urls.get(n) ?? []), names: list.images.filter((n) => urls.has(n)), audio: list.audio.flatMap((n) => urls.get(n) ?? []) };
  lastTvStatus = `${got.images.length} pictures and ${got.audio.length} songs ${reached ? 'copied from the computer' : 'kept on this TV (computer not reachable right now)'}.`;
  return got;
}
/** A big photo is shrunk to TV size before it is kept (a 10 MB picture would choke a Fire TV Stick). */
async function tvSized(name: string, blob: Blob): Promise<Blob> {
  if (/\.(mp3|m4a|aac|ogg|wav|gif)$/i.test(name) || blob.size < 500_000 || typeof createImageBitmap !== 'function') return blob;
  try {
    const full = await createImageBitmap(blob);
    const k = Math.min(1, 1920 / full.width);
    if (k >= 1 && blob.size < 1_500_000) return blob;
    const c = document.createElement('canvas');
    c.width = Math.round(full.width * k);
    c.height = Math.round(full.height * k);
    c.getContext('2d')!.drawImage(full, 0, 0, c.width, c.height);
    full.close();
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.86));
    return out && out.size > 0 && out.size < blob.size ? out : blob;
  } catch {
    return blob;
  }
}
/** Look again now (after changing the address or the folder). */
export function refreshTimeoutMedia(): Promise<TimeoutMedia> {
  cached = null;
  return timeoutMedia();
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
    if (!on) return;
    // No songs of your own: LTTV's built-in beat.
    if (!tracks.length) return startBeat();
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
/** Other names a team goes by in file names (nickname and city are matched anyway). */
const TEAM_ALIASES: Record<string, string[]> = {
  '76ers': ['sixers', 'phi', 'philly'], 'trail blazers': ['blazers', 'trailblazers', 'por'], timberwolves: ['wolves', 'twolves'],
  knicks: ['nyk'], warriors: ['gsw', 'dubs'], pelicans: ['nop', 'pels'], spurs: ['sas'], jazz: ['uta'], nets: ['bkn'], suns: ['phx'],
  thunder: ['okc'], mavericks: ['mavs', 'dal'], cavaliers: ['cavs', 'cle'], clippers: ['lac', 'clips'], lakers: ['lal'], celtics: ['bos'],
  grizzlies: ['grizz', 'mem'], hornets: ['cha'], raptors: ['tor', 'raps'], wizards: ['wsh', 'wiz'], rockets: ['hou'], pacers: ['ind'],
  pistons: ['det'], bucks: ['mil'], hawks: ['atl'], heat: ['mia'], magic: ['orl'], bulls: ['chi'], kings: ['sac'], nuggets: ['nuggs', 'den'],
};
const tokens = (n: string) => n.toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9]+/).filter(Boolean);
/** A team's own pictures: the team's name (or a folder named after it) in the file name, e.g. "knicks-1.jpg" or "Knicks/brunson.jpg". */
export function teamPictures(media: TimeoutMedia, team: Pick<GameTeam, 'short' | 'name'>): string[] {
  const nick = team.short.toLowerCase();
  const words = new Set([nick.replace(/\s+/g, ''), ...nick.split(/\s+/).slice(-1), ...(TEAM_ALIASES[nick] ?? [])]);
  const full = team.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return media.images.filter((_, i) => {
    const n = media.names[i] ?? '';
    const t = tokens(n);
    return t.some((x) => words.has(x)) || n.toLowerCase().replace(/[^a-z0-9]/g, '').includes(full);
  });
}

export function TimeoutShow({ media, team, children }: { media: TimeoutMedia; team?: GameTeam; children: ComponentChildren }) {
  const [i, setI] = useState(0);
  const prev = useRef(-1);
  // A team's broadcast picked: that team's own pictures, else its built-in team picture. Otherwise your pictures,
  // else LTTV's built-in scenes.
  const own = team ? teamPictures(media, team) : [];
  const images = team ? (own.length ? own : [teamArt(team)]) : media.images.length ? media.images : TIMEOUT_ART;
  useEffect(() => {
    setI(0);
    prev.current = -1;
  }, [team?.name]);
  const n = images.length;
  useEffect(() => {
    if (n < 2) return;
    const t = window.setInterval(() => setI((x) => {
      prev.current = x;
      return (x + 1) % n;
    }), 9000);
    return () => window.clearInterval(t);
  }, [n]);
  useMusic(media.audio);
  const img = (k: number, cls: string) => <div class={`lp-slide ${cls}`} key={k} style={{ backgroundImage: `url("${images[k]}"), linear-gradient(rgba(0,0,0,0.7), rgba(0,0,0,0.7)), url("${images[k]}")` }} />;
  return (
    <div class="lp-timeout">
      {n > 0 && prev.current >= 0 && prev.current !== i && img(prev.current, 'out')}
      {n > 0 && img(i % n, 'in')}
      <div class="lp-timeout-shade" />
      <div class="lp-timeout-text">{children}</div>
    </div>
  );
}

/** Settings: where the timeout pictures and music come from. */
export function TimeoutSettings() {
  const [lan, setLan] = useState('');
  const [status, setStatus] = useState('');
  const [addr, setAddr] = useState(() => getState().settings.timeoutMedia ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (native) return;
    void fetch('api/timeout').then((r) => r.json()).then((j: { images?: string[]; audio?: string[]; lan?: string }) => {
      setLan(j.lan ?? '');
      setStatus(`${j.images?.length ?? 0} pictures and ${j.audio?.length ?? 0} songs in the “timeout” folder.`);
    }).catch(() => setStatus('Couldn’t read the “timeout” folder.'));
  }, []);
  const check = async () => {
    setBusy(true);
    await updateSettings({ timeoutMedia: addr.trim() || undefined });
    await refreshTimeoutMedia();
    setStatus(timeoutTvStatus());
    setBusy(false);
  };
  return (
    <div class="card settings-section" data-group="set-timeout">
      <h3>League Pass timeout pictures and music</h3>
      <p class="muted">The timeout screen has its own pictures and music built in. This part is only for using your own instead.</p>
      {native ? (
        <>
          <p class="muted">Your own pictures and songs live in a “timeout” folder beside LTTV on your computer. This TV copies them from the computer over your Wi-Fi and keeps them. Type the address the computer shows in its LTTV Settings (it looks like http://192.168.1.20:8788).</p>
          <div class="row gap wrap">
            <input class="f input" style={{ flex: 1, minWidth: '20rem' }} value={addr} placeholder="http://192.168.1.20:8788" onInput={(e) => setAddr((e.target as HTMLInputElement).value)} aria-label="Computer address" />
            <button type="button" class="f btn btn-primary" disabled={busy} onClick={() => void check()}>{busy ? 'Looking…' : 'Get pictures and music'}</button>
          </div>
          {status && <p>{status}</p>}
        </>
      ) : (
        <>
          <p class="muted">Put your own pictures (JPG, PNG, WEBP) and songs (MP3) in a folder named “timeout” beside “Start LTTV.bat”. They stay on your devices and are never part of the app.</p>
          {status && <p>{status}</p>}
          {lan ? <p>On the Fire TV, in Settings, type this address: <b>{lan}</b></p> : <p class="muted">The Fire TV can’t reach this computer (the phone-remote part of the helper is off).</p>}
        </>
      )}
    </div>
  );
}
