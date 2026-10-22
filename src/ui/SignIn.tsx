// Sign in / create an LTTV account (email, Google, Apple). On a TV the easy way is the phone: scan the
// code, sign in there, and the TV picks up the sign-in.
import { h, Fragment } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { cloudConfig, oauthUrl, openCloudAccount, signInEmail, signUpEmail } from '../app/cloud';
import { focusFirst } from '../app/nav';
import { native } from '../app/platform';
import { qrMatrix, qrSvgPath } from '../core/qr';
import { Button, Icon, Modal } from './common';
import { LogoMark, Wordmark } from './Logo';
import { handleSetupSubmission } from './setup';

const SKIP_KEY = 'lttvCloudSkip';
export function signInSkipped(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
}
function skipSignIn() {
  try {
    localStorage.setItem(SKIP_KEY, '1');
  } catch {
    /* ignore */
  }
}


function Qr({ text }: { text: string }) {
  const q = useMemo(() => {
    try {
      return qrSvgPath(qrMatrix(text));
    } catch {
      return null;
    }
  }, [text]);
  if (!q) return null;
  return (
    <svg class="setup-qr" viewBox={`0 0 ${q.size} ${q.size}`} shape-rendering="crispEdges" role="img" aria-label="QR code for signing in on your phone">
      <rect width={q.size} height={q.size} fill="#fff" />
      <path d={q.d} fill="#000" />
    </svg>
  );
}

/** TV: the phone sign-in page (QR code + address) served by the TV on the home network. */
export function PhoneSignInModal({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<{ url?: string; pin?: string; error?: string } | null>(null);
  useEffect(() => {
    try {
      const c = cloudConfig();
      native?.setCloudConfig?.(JSON.stringify(c ? { url: c.url, anonKey: c.anonKey } : {}));
      setInfo(JSON.parse(native!.startSetupServer()));
    } catch (e) {
      setInfo({ error: (e as Error).message });
    }
    window.lttvHost = window.lttvHost ?? ({} as NonNullable<Window['lttvHost']>);
    window.lttvHost.onSetupSubmit = (json: string) => void handleSetupSubmission(json);
    return () => native?.stopSetupServer();
  }, []);
  const link = info?.url && info.pin && /^http/.test(info.url) ? `${info.url}/signin?pin=${info.pin}` : '';
  return (
    <Modal title="Sign in with your phone" onClose={onClose} wide>
      {!info ? (
        <p><span class="spinner" /> Starting…</p>
      ) : info.error ? (
        <p class="error-text">{info.error}</p>
      ) : (
        <div class="setup setup-split">
          {link ? <Qr text={link} /> : null}
          <div class="setup-steps">
            <p><b>1.</b> Scan the code with your phone’s camera (your phone must be on the <b>same Wi-Fi</b> as the TV).</p>
            <p><b>2.</b> Sign in with Google, Apple or your email — or create an account.</p>
            <p><b>3.</b> The TV signs in by itself and loads your channels.</p>
            {link ? <p class="muted">Or open <b class="setup-url-sm">{info.url}/signin</b> and enter PIN <b>{info.pin}</b>.</p> : <p class="error-text">{info.url}</p>}
          </div>
        </div>
      )}
      <div class="row gap modal-actions">
        <Button data-autofocus onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

function EmailForm({ mode, onMode, onDone }: { mode: 'in' | 'up'; onMode: (m: 'in' | 'up') => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const go = async () => {
    if (!email.trim() || !pw) {
      setMsg({ ok: false, text: 'Enter your email and a password.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'up') {
        const r = await signUpEmail(email, pw);
        if ('confirmEmail' in r) {
          setMsg({ ok: true, text: 'Check your email to confirm your account, then sign in here.' });
          onMode('in');
          return;
        }
        onDone();
        openCloudAccount(r.session);
      } else {
        const s = await signInEmail(email, pw);
        onDone();
        openCloudAccount(s);
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="signin-form" data-group="signin-form">
      <label class="field">
        <span>Email</span>
        <input class="f input" type="email" data-autofocus autoComplete="email" autoCapitalize="off" spellcheck={false} value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
      </label>
      <label class="field">
        <span>Password</span>
        <input class="f input" type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && void go()} />
      </label>
      {msg && <p class={msg.ok ? 'ok-text' : 'error-text'}>{msg.text}</p>}
      <div class="row gap">
        <Button variant="primary" disabled={busy} icon={busy ? undefined : 'check'} onClick={() => void go()}>{busy ? 'One moment…' : mode === 'up' ? 'Create account' : 'Sign in'}</Button>
        <Button variant="ghost" onClick={() => onMode(mode === 'up' ? 'in' : 'up')}>{mode === 'up' ? 'I have an account' : 'Create an account'}</Button>
      </div>
    </div>
  );
}

/** The sign-in screen (first start, or Settings → Accounts → Sign in). */
export function SignInScreen({ onClose, canSkip = true }: { onClose: () => void; canSkip?: boolean }) {
  const [phone, setPhone] = useState(false);
  const [email, setEmail] = useState<'in' | 'up' | null>(null);
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    requestAnimationFrame(() => focusFirst(ref.current));
  }, [email]);
  const oauth = (p: 'google' | 'apple') => {
    location.href = oauthUrl(p, `${location.origin}${location.pathname}?cloud=1`);
  };
  return (
    <section class="screen signin" data-scope ref={ref}>
      <div class="signin-card">
        <div class="welcome-logo"><LogoMark size="6rem" /><Wordmark /></div>
        <h1>Sign in to LTTV</h1>
        <p class="muted">Your account keeps your playlists, guide, favorites, teams and settings, so every TV, phone or computer you sign in on has them.</p>
        {email ? (
          <EmailForm mode={email} onMode={setEmail} onDone={onClose} />
        ) : (
          <div class="signin-options" data-group="signin-options">
            {native ? (
              <Button variant="primary" icon="phone" data-autofocus onClick={() => setPhone(true)}>Sign in with your phone (Google, Apple or email)</Button>
            ) : (
              <>
                <button type="button" class="f btn signin-google" data-autofocus onClick={() => oauth('google')}><b class="g-mark">G</b> Continue with Google</button>
                <button type="button" class="f btn signin-apple" onClick={() => oauth('apple')}><svg width="16" height="18" viewBox="0 0 17 20" fill="#fff" aria-hidden="true"><path d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9s-2-.9-3.4-.9C3.6 4.8 1.9 5.8 1 7.4c-1.9 3.3-.5 8.1 1.3 10.8.9 1.3 2 2.7 3.4 2.7 1.3-.1 1.9-.9 3.5-.9s2.1.9 3.5.8c1.4 0 2.4-1.3 3.2-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.9-1.1-2.9-4.3zM11.5 3c.7-.9 1.2-2.1 1.1-3.3-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.2 1.1.1 2.3-.6 3-1.5z" /></svg> Continue with Apple</button>
              </>
            )}
            <Button icon="user" onClick={() => setEmail('in')}>Sign in with email</Button>
            <Button icon="add" onClick={() => setEmail('up')}>Create an account</Button>
            {canSkip && (
              <Button variant="ghost" onClick={() => { skipSignIn(); onClose(); }}>Not now — use LTTV on this device only</Button>
            )}
          </div>
        )}
        {email && <Button variant="ghost" icon="back" onClick={() => setEmail(null)}>Other ways to sign in</Button>}
        <p class="hint"><Icon name="info" size="1em" /> Only add playlists you’re allowed to use. Your account and its data are stored in LTTV’s account database, readable only by you.</p>
      </div>
      {phone && <PhoneSignInModal onClose={() => setPhone(false)} />}
    </section>
  );
}
