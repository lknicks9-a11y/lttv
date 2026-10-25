// Accounts on this device: switch, add, rename, remove; "Who's watching?" at startup.
import { h, Fragment } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { focusFirst, onBack } from '../app/nav';
import {
  AVATAR_COLORS, createAccount, currentAccount, listAccounts, markAccountPicked, removeAccount, renameAccount, setAccountColor, switchAccount, type Account,
} from '../app/accounts';
import { native } from '../app/platform';
import { setState, toast } from '../app/state';
import { cloudConfig, currentSession, signOut } from '../app/cloud';
import { onSyncStatus, pushNow, syncStatus, type SyncStatus } from '../app/cloudsync';
import { Button, Icon, Modal } from './common';

const listeners = new Set<() => void>();
export function notifyAccountsChanged() {
  listeners.forEach((l) => l());
}
function useAccounts(): { list: Account[]; current: Account } {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return { list: listAccounts(), current: currentAccount() };
}

export function Avatar({ acc, size = '2.4rem' }: { acc: Account; size?: string }) {
  return (
    <span class="avatar" style={{ background: acc.color, width: size, height: size, fontSize: `calc(${size} * 0.45)` }} aria-hidden="true">
      {acc.name.trim().charAt(0).toUpperCase() || <Icon name="user" />}
    </span>
  );
}

function NewAccountModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  return (
    <Modal title="Add an account" onClose={onClose}>
      <p>Each account has its own provider login, channels, guide, favorites, teams, bets, Continue watching and theme.</p>
      <label class="field">
        <span>Name</span>
        <input class="f input" data-autofocus maxLength={24} value={name} placeholder="e.g. Luke" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>
      <p class="muted">LTTV switches to the new account{native ? '; then choose “Set up from phone or computer” to type the provider login on your phone' : ''}.</p>
      <div class="row gap modal-actions">
        <Button variant="primary" icon="check" onClick={() => switchAccount(createAccount(name).id)}>Create &amp; switch</Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

function EditAccountModal({ acc, onClose }: { acc: Account; onClose: () => void }) {
  const [name, setName] = useState(acc.name);
  const [color, setColor] = useState(acc.color);
  const [confirm, setConfirm] = useState(false);
  const isCurrent = acc.id === currentAccount().id;
  return (
    <Modal title={`Edit ${acc.name}`} onClose={onClose}>
      <label class="field">
        <span>Name</span>
        <input class="f input" data-autofocus maxLength={24} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>
      <div class="avatar-colors" data-group="avatar-colors" role="radiogroup" aria-label="Color">
        {AVATAR_COLORS.map((c) => (
          <button type="button" role="radio" aria-checked={c === color} aria-label={c} class={`f avatar-color ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
        ))}
      </div>
      {confirm ? (
        <p class="error-text">Remove {acc.name} and everything saved for it on this TV (provider login, channels, favorites, bets…)?</p>
      ) : null}
      <div class="row gap modal-actions">
        {confirm ? (
          <>
            <Button variant="danger" data-autofocus onClick={() => void removeAccount(acc.id).then(() => { toast(`${acc.name} removed`, 'success'); notifyAccountsChanged(); onClose(); }, (e) => toast((e as Error).message, 'error'))}>Remove</Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          </>
        ) : (
          <>
            <Button variant="primary" icon="check" onClick={() => { renameAccount(acc.id, name); setAccountColor(acc.id, color); notifyAccountsChanged(); onClose(); }}>Save</Button>
            {!isCurrent && listAccounts().length > 1 && <Button variant="danger" icon="close" onClick={() => setConfirm(true)}>Remove account</Button>}
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Settings → Accounts. */
export function AccountsSection({ onPhoneSetup }: { onPhoneSetup?: () => void }) {
  const { list, current } = useAccounts();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  return (
    <div class="card settings-section accounts-section" data-group="set-accounts">
      <h3>Accounts</h3>
      <CloudRow />
      <p class="hint">Everyone in the house can have their own account with their own provider.</p>
      <div class="account-list">
        {list.map((a) => (
          <div class={`account-row ${a.id === current.id ? 'current' : ''}`} key={a.id}>
            <Avatar acc={a} />
            <span class="account-name">{a.name}{a.email && <small class="muted"> · {a.email}</small>}{a.id === current.id && <small class="muted"> · Watching now</small>}</span>
            {a.id !== current.id && <Button small icon="user" onClick={() => switchAccount(a.id)}>Switch</Button>}
            <Button small icon="edit" onClick={() => setEditing(a)}>Edit</Button>
          </div>
        ))}
      </div>
      <div class="row gap">
        <Button icon="add" onClick={() => setAdding(true)}>Add account</Button>
        {native && onPhoneSetup && <Button icon="phone" onClick={onPhoneSetup}>Set up from phone or computer</Button>}
      </div>
      {adding && <NewAccountModal onClose={() => setAdding(false)} />}
      {editing && <EditAccountModal acc={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** "Who's watching?" — shown at startup when there are several accounts. */
export function WhoIsWatching({ onPicked }: { onPicked: () => void }) {
  const { list, current } = useAccounts();
  const [adding, setAdding] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    requestAnimationFrame(() => focusFirst(ref.current));
  }, []);
  useEffect(() => {
    if (adding) return;
    return onBack(() => {
      markAccountPicked();
      onPicked();
      return true;
    });
  }, [adding]);
  return (
    <section class="screen who-watching" data-scope ref={ref}>
      <h1>Who’s watching?</h1>
      <div class="who-grid" data-group="who-grid">
        {list.map((a) => (
          <button
            type="button"
            class="f who-card"
            key={a.id}
            data-autofocus={a.id === current.id ? '' : undefined}
            onClick={() => {
              if (a.id === current.id) {
                markAccountPicked();
                onPicked();
              } else switchAccount(a.id);
            }}
          >
            <Avatar acc={a} size="7rem" />
            <span>{a.name}</span>
          </button>
        ))}
        <button type="button" class="f who-card who-add" onClick={() => setAdding(true)}>
          <span class="avatar avatar-add" style={{ width: '7rem', height: '7rem' }}><Icon name="add" size="3rem" /></span>
          <span>Add account</span>
        </button>
      </div>
      {adding && <NewAccountModal onClose={() => setAdding(false)} />}
    </section>
  );
}

function ago(t?: number) {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/** Signed in (and synced) or not, for the account that's open. */
function CloudRow() {
  const [st, setSt] = useState<SyncStatus>(syncStatus());
  const [, bump] = useState(0);
  useEffect(() => onSyncStatus(setSt), []);
  if (!cloudConfig()) return <p class="hint">Online sign-in isn’t switched on in this version of the app yet.</p>;
  const sess = currentSession();
  if (!sess) {
    return (
      <div class="cloud-row">
        <span class="cloud-text"><b>Not signed in</b><small class="muted">Sign in to keep your playlists, guide and settings on all your devices.</small></span>
        <Button variant="primary" icon="user" onClick={() => setState({ signIn: true })}>Sign in or create an account</Button>
      </div>
    );
  }
  return (
    <div class="cloud-row signed-in">
      <span class="cloud-text">
        <b>Signed in as {sess.email ?? 'your account'}</b>
        <small class="muted">
          {st.state === 'syncing' ? 'Saving to your account…' : st.state === 'error' ? `Not saved: ${st.message}` : st.at ? `Saved to your account ${ago(st.at)}` : 'Your playlists, guide and settings follow you to every device you sign in on.'}
        </small>
      </span>
      <Button small icon="refresh" onClick={() => void pushNow(true)}>Save now</Button>
      <Button small variant="ghost" icon="close" onClick={() => void signOut().then(() => { toast('Signed out. Your channels stay on this device.', 'success'); notifyAccountsChanged(); bump((n) => n + 1); })}>Sign out</Button>
    </div>
  );
}
