// First-launch onboarding: sign in → add your first playlist.
// Shown once, before the main app, when the user has never completed setup.
import { h, Fragment } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { cloudConfig, currentSession, openCloudAccount, signInEmail, signUpEmail } from '../app/cloud';
import { focusFirst } from '../app/nav';
import { isNative, native } from '../app/platform';
import { navigate, setState } from '../app/state';
import { Button, Icon } from './common';
import { LogoMark, Wordmark } from './Logo';
import { PhoneSignInModal } from './SignIn';

const ONBOARDED_KEY = 'lttvOnboarded';
/** Has this device completed onboarding? */
export function isOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return false;
  }
}
export function markOnboarded() {
  try {
    localStorage.setItem(ONBOARDED_KEY, '1');
  } catch {
    /* storage blocked */
  }
}

type Step = 'auth' | 'playlist';

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  // If the user already signed in (e.g. page reloaded after sign-in), skip straight to playlist.
  const [step, setStep] = useState<Step>(currentSession() ? 'playlist' : 'auth');
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    requestAnimationFrame(() => focusFirst(ref.current));
  }, [step]);

  return (
    <section class="screen onboarding" data-scope ref={ref}>
      <div class="onboarding-card">
        <div class="welcome-logo"><LogoMark size="6rem" /><Wordmark /></div>
        <StepIndicator current={step} />
        {step === 'auth' && <AuthStep onDone={() => setStep('playlist')} />}
        {step === 'playlist' && <PlaylistStep onDone={() => { markOnboarded(); onDone(); }} />}
      </div>
    </section>
  );
}

function StepIndicator({ current }: { current: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'auth', label: 'Sign in' },
    { id: 'playlist', label: 'Playlist' },
  ];
  const idx = steps.findIndex((s) => s.id === current);
  return (
    <div class="onboarding-steps">
      {steps.map((s, i) => (
        <div class={`onboarding-step ${i < idx ? 'done' : i === idx ? 'active' : ''}`} key={s.id}>
          <span class="step-num">{i < idx ? <Icon name="check" size="0.9em" /> : i + 1}</span>
          <span class="step-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Step 1: Sign in or create account ───

function AuthStep({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'pick' | 'in' | 'up'>('pick');
  const [phone, setPhone] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    requestAnimationFrame(() => focusFirst(ref.current));
  }, [mode]);

  if (mode === 'in' || mode === 'up') {
    return (
      <div ref={ref}>
        <h1>{mode === 'up' ? 'Create your account' : 'Sign in'}</h1>
        <p class="muted">{mode === 'up' ? 'A free LTTV account keeps your channels on every device.' : 'Welcome back.'}</p>
        <EmailForm mode={mode} onMode={setMode} onDone={onDone} />
        <Button variant="ghost" icon="back" onClick={() => setMode('pick')}>Back</Button>
      </div>
    );
  }

  return (
    <div ref={ref}>
      <h1>Welcome to LTTV</h1>
      <p class="muted">Sign in or create an account to get started. Your playlists, guide, favorites and settings follow you to every device.</p>
      <div class="signin-options" data-group="signin-options">
        {isNative && <Button variant="primary" icon="phone" data-autofocus onClick={() => setPhone(true)}>Sign in with your phone</Button>}
        <Button icon="user" variant={isNative ? undefined : 'primary'} data-autofocus={isNative ? undefined : ''} onClick={() => setMode('in')}>Sign in with email</Button>
        <Button icon="add" onClick={() => setMode('up')}>Create an account</Button>
      </div>
      {phone && <PhoneSignInModal onClose={() => setPhone(false)} />}
    </div>
  );
}

function EmailForm({ mode, onMode, onDone }: { mode: 'in' | 'up'; onMode: (m: 'pick' | 'in' | 'up') => void; onDone: () => void }) {
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
        openCloudAccount(r.session);
        onDone();
      } else {
        const s = await signInEmail(email, pw);
        openCloudAccount(s);
        onDone();
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

// ─── Step 2: Add your first playlist ───

function PlaylistStep({ onDone }: { onDone: () => void }) {
  return (
    <div>
      <h1>Add your playlist</h1>
      <p class="muted">LTTV needs a playlist from your IPTV provider. You can add more later in Sources.</p>
      <div class="signin-options" data-group="playlist-options">
        <Button variant="primary" icon="add" data-autofocus onClick={() => { markOnboarded(); setState({ ready: true, screen: 'wizard' }); onDone(); }}>Add playlist now</Button>
        {isNative && (
          <Button icon="phone" onClick={() => { markOnboarded(); setState({ ready: true, screen: 'settings' }); onDone(); }}>Set up from phone or computer</Button>
        )}
      </div>
      <p class="hint"><Icon name="info" size="1em" /> Your provider gives you a server address, username and password — or an M3U playlist URL. Enter either one on the next screen.</p>
    </div>
  );
}
