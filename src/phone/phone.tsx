// LTTV on your phone: sign in to your LTTV account, pick one of your TVs (LTTV, League Pass, Blitz, Movies & Shows
// — wherever they are), then use the phone as its remote, start or stop what it plays, or watch on the phone.
// The phone and TVs meet on the account's private link channel (see app/devicelink.ts).
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { cloudConfig, signInEmail, signInWithRefreshToken, type CloudSession } from '../app/cloud';
import { LinkRpc, RealtimeLink, linkTopic, randomId, type LinkStatus, type PresenceMember } from '../core/realtime';

const SESSION_KEY = 'lttvPhoneSession';
const LAST_DEVICE = 'lttvPhoneDevice';

interface Playing { key: string; name: string; logo?: string; state?: string }
interface Device { id: string; name: string; app: string; kind: string; playing: Playing | null }
interface Ch { key: string; name: string; number?: number; logo?: string; now?: string; reason?: string }
interface Game { id: string; title: string; away: { name: string; score?: string; logo?: string }; home: { name: string; score?: string; logo?: string }; state: string; detail?: string; start: number; streams: Ch[] }

function load<T>(k: string): T | undefined {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
}
function save(k: string, v: unknown) {
  try {
    if (v === undefined) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

async function validSession(): Promise<CloudSession | null> {
  const s = load<CloudSession>(SESSION_KEY);
  if (!s) return null;
  if (s.expiresAt - Date.now() > 60_000) return s;
  try {
    const fresh = await signInWithRefreshToken(s.refreshToken);
    save(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return null;
  }
}

/** The account's link secret (only this signed-in account can read it). */
async function fetchSecret(s: CloudSession): Promise<string | undefined> {
  const c = cloudConfig()!;
  const r = await fetch(`${c.url}/rest/v1/lttv_profiles?select=linkSecret:data->>linkSecret&user_id=eq.${encodeURIComponent(s.userId)}`, {
    headers: { apikey: c.anonKey, Authorization: `Bearer ${s.accessToken}` },
  });
  if (!r.ok) throw new Error(`Couldn’t load your account (HTTP ${r.status}).`);
  const rows = (await r.json()) as { linkSecret?: string | null }[];
  return rows[0]?.linkSecret ?? undefined;
}

const APP_LABEL: Record<string, string> = { lttv: 'Live TV & Sports', movies: 'Movies & Shows', leaguepass: 'League Pass', blitz: 'Blitz' };

// ------------------------------------------------------------------------------------------------ app

function App() {
  const [session, setSession] = useState<CloudSession | null | undefined>(undefined);
  useEffect(() => {
    void validSession().then(setSession);
  }, []);
  if (session === undefined) return <div class="center dim">Loading…</div>;
  if (!session) return <SignIn onDone={setSession} />;
  return <Linked session={session} onSignOut={() => { save(SESSION_KEY, undefined); setSession(null); }} />;
}

function SignIn({ onDone }: { onDone: (s: CloudSession) => void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <form class="signin" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setErr('');
      try {
        const s = await signInEmail(email, pw);
        save(SESSION_KEY, s);
        onDone(s);
      } catch (x) {
        setErr((x as Error).message);
      } finally {
        setBusy(false);
      }
    }}>
      <Logo />
      <h1>Your TVs, on your phone</h1>
      <p class="dim">Sign in with your LTTV account to control your TVs, start or stop what they play, or watch here.</p>
      <input type="email" autocomplete="username" placeholder="Email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} required />
      <input type="password" autocomplete="current-password" placeholder="Password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} required />
      {err && <div class="err">{err}</div>}
      <button class="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}

function Logo() {
  return <div class="logo">LT<span>TV</span></div>;
}

function Linked({ session, onSignOut }: { session: CloudSession; onSignOut: () => void }) {
  const [secret, setSecret] = useState<string | null | undefined>(undefined);
  const [err, setErr] = useState('');
  const [status, setStatus] = useState<LinkStatus>('connecting');
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [pick, setPick] = useState<string | undefined>(load<string>(LAST_DEVICE));
  const me = useMemo(() => `phone-${randomId(6)}`, []);
  const rpcRef = useRef<LinkRpc | null>(null);

  useEffect(() => {
    let stop = false;
    const tryLoad = async () => {
      try {
        const s = (await validSession()) ?? session;
        const v = await fetchSecret(s);
        if (!stop) setSecret(v ?? null);
        if (!v && !stop) setTimeout(tryLoad, 8000); // the TV saves it the first time it opens signed in
      } catch (e) {
        if (!stop) setErr((e as Error).message);
      }
    };
    void tryLoad();
    return () => { stop = true; };
  }, [session]);

  useEffect(() => {
    if (!secret) return;
    const c = cloudConfig()!;
    const link = new RealtimeLink({
      url: c.url,
      apiKey: c.anonKey,
      topic: linkTopic(secret),
      presenceKey: me,
      onBroadcast: (e, p) => rpcRef.current?.onBroadcast(e, p),
      onPresence: setMembers,
      onStatus: setStatus,
    });
    rpcRef.current = new LinkRpc(link, me);
    link.track({ phone: true });
    link.start();
    return () => link.stop();
  }, [secret, me]);

  const devices: Device[] = members.filter((m) => m.meta.device).map((m) => m.meta as unknown as Device);
  const device = devices.find((d) => d.id === pick);

  if (err) return <div class="center"><div class="err">{err}</div><button onClick={onSignOut}>Sign out</button></div>;
  if (secret === undefined) return <div class="center dim">Finding your TVs…</div>;
  if (secret === null)
    return (
      <div class="center">
        <Logo />
        <p>Open LTTV on your TV, signed in to <b>{session.email}</b>. It shows up here a few seconds later.</p>
        <button onClick={onSignOut}>Sign out</button>
      </div>
    );
  if (device && rpcRef.current) return <DeviceView device={device} rpc={rpcRef.current} onBack={() => { setPick(undefined); save(LAST_DEVICE, undefined); }} />;
  return (
    <div class="page">
      <header class="bar"><Logo /><button class="ghost" onClick={onSignOut}>Sign out</button></header>
      <h2>Your TVs</h2>
      {status !== 'joined' && <p class="dim">{status === 'connecting' ? 'Connecting…' : 'Offline — reconnecting…'}</p>}
      {status === 'joined' && !devices.length && <p class="dim">No TV is on right now. Open LTTV (or League Pass / Blitz) on a TV signed in to {session.email}.</p>}
      <div class="list">
        {devices.map((d) => (
          <button class="device" key={d.id} onClick={() => { setPick(d.id); save(LAST_DEVICE, d.id); }}>
            <div class="dname">{d.name}</div>
            <div class="dim small">{APP_LABEL[d.app] ?? d.app}{d.playing ? ` · Playing ${d.playing.name}` : ' · Nothing playing'}</div>
          </button>
        ))}
      </div>
      {pick && !device && status === 'joined' && <p class="dim small">The TV you used last isn’t on right now.</p>}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ one TV

type Tab = 'remote' | 'sports' | 'channels';

function DeviceView({ device, rpc, onBack }: { device: Device; rpc: LinkRpc; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('remote');
  const [toast, setToast] = useState('');
  const [sheet, setSheet] = useState<Ch | null>(null);
  const [watch, setWatch] = useState<{ name: string; url: string; hls?: string } | null>(null);
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2600); };
  const ask = async <T,>(cmd: string, args: Record<string, unknown> = {}, ok?: string): Promise<T | undefined> => {
    try {
      const r = await rpc.ask<T>(device.id, cmd, args);
      if (ok) flash(ok);
      return r;
    } catch (e) {
      flash((e as Error).message);
      return undefined;
    }
  };
  const watchHere = async (key?: string) => {
    const r = await ask<{ name: string; url: string; hls?: string }>('watchUrl', key ? { key } : {});
    if (r) setWatch(r);
  };
  return (
    <div class="page">
      <header class="bar">
        <button class="ghost" onClick={onBack}>‹ TVs</button>
        <div class="dname">{device.name}</div>
        <span />
      </header>
      <div class="now">
        {device.playing ? (
          <>
            <div class="nowname">{device.playing.logo && <img src={device.playing.logo} alt="" />}<span>{device.playing.name}</span></div>
            <div class="row">
              <button onClick={() => void ask('stop', {}, 'Stopped')}>■ Stop</button>
              <button onClick={() => void watchHere(device.playing!.key)}>📱 Watch here</button>
            </div>
          </>
        ) : (
          <>
            <div class="dim">Nothing playing</div>
            <div class="row"><button onClick={() => void ask('resume', {}, 'Playing the last channel')}>▶ Start again</button></div>
          </>
        )}
      </div>
      <nav class="tabs">
        {(['remote', 'sports', 'channels'] as Tab[]).map((t) => (
          <button class={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'remote' ? 'Remote' : t === 'sports' ? 'Sports' : 'Channels'}</button>
        ))}
      </nav>
      {tab === 'remote' && <Remote ask={ask} />}
      {tab === 'sports' && <Sports ask={ask} onPick={setSheet} />}
      {tab === 'channels' && <Channels ask={ask} onPick={setSheet} />}
      {sheet && (
        <div class="sheetbg" onClick={() => setSheet(null)}>
          <div class="sheet" onClick={(e) => e.stopPropagation()}>
            <div class="dname">{sheet.name}</div>
            {sheet.now && <div class="dim small">{sheet.now}</div>}
            <button class="primary" onClick={() => { void ask('tune', { key: sheet.key }, `Playing ${sheet.name} on the TV`); setSheet(null); }}>Play on the TV</button>
            <button onClick={() => { void watchHere(sheet.key); setSheet(null); }}>Watch on this phone</button>
            <button class="ghost" onClick={() => setSheet(null)}>Cancel</button>
          </div>
        </div>
      )}
      {watch && <Watch w={watch} onClose={() => setWatch(null)} />}
      {toast && <div class="toast">{toast}</div>}
    </div>
  );
}

type Ask = <T>(cmd: string, args?: Record<string, unknown>, ok?: string) => Promise<T | undefined>;

function Remote({ ask }: { ask: Ask }) {
  const key = (k: string) => () => {
    try { navigator.vibrate?.(10); } catch { /* no vibration */ }
    void ask('key', { key: k });
  };
  const [text, setText] = useState('');
  return (
    <div class="remote">
      <div class="dpad">
        <span /><button onClick={key('up')}>▲</button><span />
        <button onClick={key('left')}>◀</button><button class="ok" onClick={key('ok')}>OK</button><button onClick={key('right')}>▶</button>
        <span /><button onClick={key('down')}>▼</button><span />
      </div>
      <div class="keys">
        <button onClick={key('back')}>↩ Back</button>
        <button onClick={() => void ask('navigate', { screen: 'home' })}>⌂ Home</button>
        <button onClick={key('menu')}>☰ Menu</button>
        <button onClick={key('playpause')}>⏯</button>
        <button onClick={key('chup')}>CH +</button>
        <button onClick={key('chdown')}>CH −</button>
        <button onClick={key('guide')}>Guide</button>
        <button onClick={key('info')}>Info</button>
      </div>
      <form class="type" onSubmit={(e) => { e.preventDefault(); void ask('text', { text }, 'Typed on the TV'); }}>
        <input placeholder="Type on the TV (select a text box there first)" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
        <button>Send</button>
      </form>
    </div>
  );
}

function Sports({ ask, onPick }: { ask: Ask; onPick: (c: Ch) => void }) {
  const [league, setLeague] = useState(load<string>('lttvPhoneLeague') ?? 'nfl');
  const [data, setData] = useState<{ leagues: { id: string; name: string }[]; games: Game[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBusy(true);
    void ask<{ leagues: { id: string; name: string }[]; games: Game[] }>('games', { league }).then((r) => { if (r) setData(r); setBusy(false); });
  }, [league]);
  const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <div>
      <div class="chips">
        {(data?.leagues ?? [{ id: 'nfl', name: 'NFL' }, { id: 'nba', name: 'NBA' }]).map((l) => (
          <button class={l.id === league ? 'on' : ''} onClick={() => { setLeague(l.id); save('lttvPhoneLeague', l.id); }}>{l.name}</button>
        ))}
      </div>
      {busy && <p class="dim">Asking the TV for today’s games…</p>}
      {!busy && data && !data.games.length && <p class="dim">No games today.</p>}
      <div class="list">
        {data?.games.map((g) => (
          <div class="game" key={g.id}>
            <div class="teams">
              <span>{g.away.name} {g.away.score ?? ''}</span>
              <span class="dim small">{g.state === 'pre' ? time(g.start) : g.detail ?? ''}</span>
              <span>{g.home.name} {g.home.score ?? ''}</span>
            </div>
            {g.streams.length ? (
              <div class="streams">{g.streams.map((s) => <button onClick={() => onPick(s)}>{s.name}</button>)}</div>
            ) : (
              <div class="dim small">No streams found for this game.</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Channels({ ask, onPick }: { ask: Ask; onPick: (c: Ch) => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Ch[] | null>(null);
  useEffect(() => {
    void ask<Ch[]>('sportsNow').then((r) => r && setList(r));
  }, []);
  const search = async (e: Event) => {
    e.preventDefault();
    const r = await ask<Ch[]>(q.trim() ? 'search' : 'sportsNow', { q });
    if (r) setList(r);
  };
  return (
    <div>
      <form class="type" onSubmit={search}>
        <input type="search" placeholder="Search channels (name or number)" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <button>Search</button>
      </form>
      {!q && <h3 class="dim small">Sports on now</h3>}
      <div class="list">
        {list?.map((c) => (
          <button class="channel" key={c.key} onClick={() => onPick(c)}>
            {c.logo ? <img src={c.logo} alt="" loading="lazy" /> : <span class="nologo" />}
            <span><div>{c.number ? `${c.number} · ` : ''}{c.name}</div>{c.now && <div class="dim small">{c.now}</div>}</span>
          </button>
        ))}
        {list && !list.length && <p class="dim">Nothing found.</p>}
      </div>
    </div>
  );
}

/** Watching on the phone: right in the page when the stream allows it, else in VLC. */
function Watch({ w, onClose }: { w: { name: string; url: string; hls?: string }; onClose: () => void }) {
  const src = w.hls ?? w.url;
  // A page on https can't play a plain-http stream (the browser blocks it), and browsers only play HLS / MP4.
  const inPage = /^https:/i.test(src) && (!!w.hls || /\.mp4(\?|$)/i.test(src));
  const [failed, setFailed] = useState(false);
  const vlc = /iPhone|iPad|iPod/.test(navigator.userAgent)
    ? `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(w.url)}`
    : `intent:${w.url.replace(/^https?:/, '')}#Intent;scheme=${w.url.split(':')[0]};package=org.videolan.vlc;type=video/*;end`;
  return (
    <div class="watch">
      <header class="bar"><button class="ghost" onClick={onClose}>✕ Close</button><div class="dname">{w.name}</div><span /></header>
      {inPage && !failed ? (
        <video src={src} controls autoplay playsInline onError={() => setFailed(true)} />
      ) : (
        <div class="center">
          <p>{failed ? 'This stream won’t play in the browser.' : 'Your provider sends this channel over plain http, which phone browsers won’t play inside a web page.'} Open it in the free <b>VLC</b> app instead.</p>
          <a class="button primary" href={vlc}>Open in VLC</a>
          <button onClick={() => void navigator.clipboard?.writeText(w.url)}>Copy stream link</button>
        </div>
      )}
      <p class="dim small pad">Watching here uses one of your provider’s connections. If the TV is playing too, that’s two — stop the TV first if your plan only allows one.</p>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
