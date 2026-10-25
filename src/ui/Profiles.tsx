// Profiles (like Netflix): "Who's watching?", the sidebar avatar, and Settings → Account & profiles.
import { h, Fragment } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { focusFirst, onBack } from '../app/nav';
import { setState, toast } from '../app/state';
import { cloudConfig, currentSession, signOut } from '../app/cloud';
import { onSyncStatus, pushNow, syncStatus, type SyncStatus } from '../app/cloudsync';
import {
  PROFILE_COLORS, addProfile, currentProfile, deleteProfile, editProfile, listProfiles, markProfilePicked, onProfilesChanged, switchProfile, type Profile,
} from '../app/profiles';
import { Button, Icon, Modal } from './common';

function useProfiles() {
  const [, bump] = useState(0);
  useEffect(() => onProfilesChanged(() => bump((n) => n + 1)), []);
  return { list: listProfiles(), current: currentProfile() };
}

export function ProfileAvatar({ p, size = '2.4rem' }: { p: Pick<Profile, 'name' | 'color'>; size?: string }) {
  return (
    <span class="avatar" style={{ background: p.color, width: size, height: size, fontSize: `calc(${size} * 0.45)` }} aria-hidden="true">
      {p.name.trim().charAt(0).toUpperCase() || <Icon name="user" />}
    </span>
  );
}

/** Add or edit a profile: name, color, and (editing) delete. */
function ProfileEditor({ p, onClose }: { p?: Profile; onClose: () => void }) {
  const [name, setName] = useState(p?.name ?? '');
  const [color, setColor] = useState(p?.color ?? PROFILE_COLORS[listProfiles().length % PROFILE_COLORS.length]);
  const [confirm, setConfirm] = useState(false);
  const isCurrent = !!p && p.id === currentProfile()?.id;
  const canDelete = !!p && !isCurrent && listProfiles().length > 1;
  const save = async () => {
    if (p) await editProfile(p.id, { name, color });
    else toast(`Profile “${(await addProfile(name, color)).name}” added`, 'success');
    onClose();
  };
  return (
    <Modal title={p ? `Edit ${p.name}` : 'Add a profile'} onClose={onClose}>
      <div class="avatar-preview"><ProfileAvatar p={{ name: name || '?', color }} size="5rem" /></div>
      <label class="field">
        <span>Name</span>
        <input class="f input" data-autofocus maxLength={20} value={name} placeholder="e.g. Luke" onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
      </label>
      <div class="avatar-colors" data-group="profile-colors" role="radiogroup" aria-label="Color">
        {PROFILE_COLORS.map((c) => <button type="button" role="radio" aria-checked={c === color} aria-label={c} class={`f avatar-color ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />)}
      </div>
      {confirm && <p class="error-text">Delete {p!.name}? Their favorite channels, Continue watching and recently watched are deleted too, on every device.</p>}
      <div class="row gap modal-actions">
        {confirm ? (
          <>
            <Button variant="danger" data-autofocus onClick={() => void deleteProfile(p!.id).then(() => { toast(`${p!.name} deleted`, 'success'); onClose(); }, (e) => toast((e as Error).message, 'error'))}>Delete profile</Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          </>
        ) : (
          <>
            <Button variant="primary" icon="check" onClick={() => void save()}>{p ? 'Save' : 'Add profile'}</Button>
            {canDelete && <Button variant="danger" icon="close" onClick={() => setConfirm(true)}>Delete</Button>}
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </>
        )}
      </div>
      {p && isCurrent && listProfiles().length > 1 && <p class="hint">To delete this profile, switch to another one first.</p>}
    </Modal>
  );
}

/** "Who's watching?" — at startup with several profiles, and from the sidebar avatar. */
export function WhoIsWatching({ onPicked }: { onPicked: () => void }) {
  const { list, current } = useProfiles();
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);
  const [manage, setManage] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    requestAnimationFrame(() => focusFirst(ref.current));
  }, [manage]);
  useEffect(() => {
    if (editing) return;
    return onBack(() => {
      markProfilePicked();
      onPicked();
      return true;
    });
  }, [editing]);
  return (
    <section class="screen who-watching" data-scope ref={ref}>
      <h1>{manage ? 'Manage profiles' : 'Who’s watching?'}</h1>
      <div class="who-grid" data-group="who-grid">
        {list.map((p) => (
          <button
            type="button"
            class="f who-card"
            key={p.id}
            data-autofocus={p.id === current?.id ? '' : undefined}
            onClick={() => {
              if (manage) return setEditing(p);
              if (p.id === current?.id) {
                markProfilePicked();
                onPicked();
              } else switchProfile(p.id);
            }}
          >
            <ProfileAvatar p={p} size="7rem" />
            <span>{p.name}{manage && <small class="muted"> ✎</small>}</span>
          </button>
        ))}
        {list.length < 8 && (
          <button type="button" class="f who-card who-add" onClick={() => setEditing('new')}>
            <span class="avatar avatar-add" style={{ width: '7rem', height: '7rem' }}><Icon name="add" size="3rem" /></span>
            <span>Add profile</span>
          </button>
        )}
      </div>
      <div class="row gap" style={{ justifyContent: 'center', marginTop: '2rem' }}>
        <Button icon={manage ? 'check' : 'edit'} onClick={() => setManage(!manage)}>{manage ? 'Done' : 'Manage profiles'}</Button>
      </div>
      {editing && <ProfileEditor p={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

/** The sidebar avatar: who's watching; opens "Who's watching?". */
export function SidebarProfile() {
  const { list, current } = useProfiles();
  if (!current) return null;
  return (
    <button type="button" class="f nav-item sidebar-profile" onClick={() => setState({ profilePicker: true })} aria-label={`Profile: ${current.name}${list.length > 1 ? '. Switch profile' : ''}`}>
      <ProfileAvatar p={current} size="1.9rem" />
      <span class="nav-label">{current.name}</span>
    </button>
  );
}

function ago(t?: number) {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/** Settings → Account & profiles. */
export function ProfilesSection() {
  const { list, current } = useProfiles();
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);
  const [st, setSt] = useState<SyncStatus>(syncStatus());
  const [confirmOut, setConfirmOut] = useState(false);
  useEffect(() => onSyncStatus(setSt), []);
  const sess = currentSession();
  return (
    <div class="card settings-section accounts-section" data-group="set-profiles">
      <h3>Account &amp; profiles</h3>
      {!cloudConfig() ? null : sess ? (
        <div class="cloud-row signed-in">
          <span class="cloud-text">
            <b>Signed in as {sess.email ?? 'your account'}</b>
            <small class="muted">{st.state === 'syncing' ? 'Saving to your account…' : st.state === 'error' ? `Not saved yet: ${st.message}` : st.at ? `Saved to your account ${ago(st.at)}. You stay signed in until you sign out.` : 'Your profiles, favorites and Continue watching are kept with your account. You stay signed in until you sign out.'}</small>
          </span>
          <Button small icon="refresh" onClick={() => void pushNow()}>Save now</Button>
          <Button small variant="ghost" icon="close" onClick={() => setConfirmOut(true)}>Sign out</Button>
        </div>
      ) : (
        <div class="cloud-row">
          <span class="cloud-text"><b>Not signed in</b><small class="muted">Sign in to keep your profiles, favorites and Continue watching on all your devices.</small></span>
          <Button variant="primary" icon="user" onClick={() => setState({ signIn: true })}>Sign in</Button>
        </div>
      )}
      <div class="account-list">
        {list.map((p) => (
          <div class={`account-row ${p.id === current?.id ? 'current' : ''}`} key={p.id}>
            <ProfileAvatar p={p} />
            <span class="account-name">{p.name}{p.id === current?.id && <small class="muted"> · Watching now</small>}</span>
            {p.id !== current?.id && <Button small icon="user" onClick={() => switchProfile(p.id)}>Switch</Button>}
            <Button small icon="edit" onClick={() => setEditing(p)}>Edit</Button>
          </div>
        ))}
      </div>
      <div class="row gap">
        {list.length < 8 && <Button icon="add" onClick={() => setEditing('new')}>Add profile</Button>}
      </div>
      <p class="hint">Everyone shares the account’s playlists and guide. Each profile has its own favorite channels, Continue watching and recently watched.</p>
      {editing && <ProfileEditor p={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {confirmOut && (
        <Modal title="Sign out?" onClose={() => setConfirmOut(false)}>
          <p>Your profiles and channels stay saved with your account and come back when you sign in again.</p>
          <div class="row gap modal-actions">
            <Button variant="danger" data-autofocus onClick={() => void signOut().then(() => location.reload())}>Sign out</Button>
            <Button variant="ghost" onClick={() => setConfirmOut(false)}>Cancel</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
