import { h, Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  useApp, navigate, refreshAll, refreshPlaylist, refreshEpg, deletePlaylist, deleteEpgSource, togglePlaylist, toggleEpg, rematchAndReload, reloadAll, toast,
} from '../app/state';
import type { EpgSource, PlaylistSource } from '../core/types';
import { redactUrl } from '../core/util';
import { CLIENT_IDENTITIES } from '../core/xtream';
import { Button, Icon, Modal } from './common';
import { day, when } from './fmt';
import { native } from '../app/platform';
import { SetupServerModal } from './PhoneSetup';

function ago(t?: number) {
  if (!t) return 'never';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return day(t);
}

function FileRefresh({ accept, onFile, label }: { accept: string; onFile: (f: File) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept={accept} hidden onChange={(e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) onFile(f);
      }} />
      <Button small icon="file" onClick={() => ref.current?.click()}>{label}</Button>
    </>
  );
}

export function SourcesScreen() {
  const playlists = useApp((s) => s.playlists);
  const epg = useApp((s) => s.epgSources);
  const lineup = useApp((s) => s.lineup);
  const tasks = useApp((s) => s.tasks);
  const [confirm, setConfirm] = useState<{ kind: 'pl' | 'epg'; item: PlaylistSource | EpgSource } | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const pending = lineup.filter((c) => c.matchStatus === 'pending').length;
  const unmatched = lineup.filter((c) => !c.hidden && (c.matchStatus === 'unmatched' || c.matchStatus === 'rejected')).length;
  const busy = tasks.some((t) => !t.done && !t.error);

  const doRefreshOne = async (fn: () => Promise<boolean>) => {
    if (await fn()) {
      await rematchAndReload(false);
      await reloadAll();
    }
  };

  return (
    <section class="screen sources">
      <header class="screen-head">
        <div>
          <h1>Sources</h1>
          <p class="muted">Your playlists and program guides. Everything is stored on this device only.</p>
        </div>
        <div class="row gap" data-group="sources-actions">
          <Button variant="primary" icon="add" onClick={() => navigate('wizard')}>Add playlist</Button>
          <Button icon="refresh" disabled={busy} onClick={() => void refreshAll()}>Refresh all</Button>
          {native && <Button icon="phone" onClick={() => setSetupOpen(true)}>Set up from phone or computer</Button>}
        </div>
      </header>

      {(pending > 0 || unmatched > 0) && (
        <button type="button" class="f card banner-card" onClick={() => navigate('matches')}>
          <Icon name="link" size="2rem" />
          <div>
            <b>{pending} suggested guide matches need your review</b>
            <small class="muted">{unmatched} visible channels have no guide data. Fuzzy matches are never used until you approve them.</small>
          </div>
          <Icon name="chevronRight" />
        </button>
      )}

      <h2 class="section-title">Playlists</h2>
      <div class="cards" data-group="pl-cards">
        {playlists.length === 0 && <p class="muted">No playlists yet.</p>}
        {playlists.map((p) => (
          <div class={`card source-card ${p.enabled ? '' : 'disabled'}`}>
            <div class="source-head">
              <Icon name={p.kind === 'url' ? 'link' : 'file'} size="1.6rem" />
              <div class="source-title">
                <b>{p.name}</b>
                <small class="muted">{p.kind === 'url' ? redactUrl(p.url) : p.fileName}</small>
              </div>
              {!p.enabled && <span class="pill muted">Disabled</span>}
            </div>
            <div class="source-meta">
              <span>{(p.channelCount ?? 0).toLocaleString()} channels</span>
              {p.userAgent && <span>Connects as {CLIENT_IDENTITIES.find((c) => c.ua === p.userAgent)?.label ?? 'custom player'}</span>}
              <span>Updated {ago(p.lastImportAt)}</span>
            </div>
            {p.lastImportError && <p class="error-text small"><Icon name="warn" size="1em" /> Last refresh failed: {p.lastImportError}</p>}
            <div class="row gap-sm wrap">
              {p.kind === 'url' ? (
                <Button small icon="refresh" disabled={busy} onClick={() => void doRefreshOne(() => refreshPlaylist(p))}>Refresh</Button>
              ) : (
                <FileRefresh accept=".m3u,.m3u8,.txt" label="Re-import file" onFile={(f) => void doRefreshOne(() => refreshPlaylist(p, f))} />
              )}
              <Button small icon={p.enabled ? 'hidden' : 'check'} onClick={() => void togglePlaylist(p)}>{p.enabled ? 'Disable' : 'Enable'}</Button>
              <Button small variant="danger" icon="close" onClick={() => setConfirm({ kind: 'pl', item: p })}>Remove</Button>
            </div>
          </div>
        ))}
      </div>

      <div class="row space-between">
        <h2 class="section-title">Program guides (XMLTV)</h2>
        <Button small icon="add" onClick={() => navigate('wizard')}>Add with a playlist</Button>
      </div>
      <AddGuideInline />
      <div class="cards" data-group="epg-cards">
        {epg.length === 0 && <p class="muted">No guide sources. Channels will show “Program information unavailable”.</p>}
        {epg.map((s) => (
          <div class={`card source-card ${s.enabled ? '' : 'disabled'}`}>
            <div class="source-head">
              <Icon name="guide" size="1.6rem" />
              <div class="source-title">
                <b>{s.name}</b>
                <small class="muted">{s.kind === 'url' ? redactUrl(s.url) : s.fileName}</small>
              </div>
              {!s.enabled && <span class="pill muted">Disabled</span>}
            </div>
            <div class="source-meta">
              <span>{(s.channelCount ?? 0).toLocaleString()} guide channels</span>
              <span>{(s.programmeCount ?? 0).toLocaleString()} programs</span>
              <span>Last successful update: {ago(s.lastRefreshAt)}</span>
              {s.coverageEnd && <span>Guide data until {when(s.coverageEnd)}</span>}
            </div>
            {s.lastError && <p class="error-text small"><Icon name="warn" size="1em" /> Last update failed ({ago(s.lastAttemptAt)}): {s.lastError}. The previous guide data is still in use.</p>}
            <div class="row gap-sm wrap">
              {s.kind === 'url' ? (
                <Button small icon="refresh" disabled={busy} onClick={() => void doRefreshOne(() => refreshEpg(s))}>Update now</Button>
              ) : (
                <FileRefresh accept=".xml,.gz,.xmltv" label="Re-import file" onFile={(f) => void doRefreshOne(() => refreshEpg(s, f))} />
              )}
              <Button small icon={s.enabled ? 'hidden' : 'check'} onClick={() => void toggleEpg(s)}>{s.enabled ? 'Disable' : 'Enable'}</Button>
              <Button small variant="danger" icon="close" onClick={() => setConfirm({ kind: 'epg', item: s })}>Remove</Button>
            </div>
          </div>
        ))}
      </div>

      {confirm && (
        <Modal title={`Remove ${confirm.item.name}?`} onClose={() => setConfirm(null)}>
          <p>
            {confirm.kind === 'pl'
              ? 'The channels from this playlist will be removed from LTTV. Your source playlist itself is not changed. Favorites and names you set are kept in case you add it again.'
              : 'Guide data from this source will be deleted from this device.'}
          </p>
          <div class="row gap modal-actions">
            <Button variant="danger" data-autofocus onClick={() => {
              const c = confirm;
              setConfirm(null);
              void (c.kind === 'pl' ? deletePlaylist(c.item.id) : deleteEpgSource(c.item.id)).then(() => toast('Removed', 'success'));
            }}>Remove</Button>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
          </div>
        </Modal>
      )}
      {setupOpen && <SetupServerModal onClose={() => setSetupOpen(false)} />}
    </section>
  );
}

function AddGuideInline() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return <Button small icon="add" onClick={() => setOpen(true)}>Add guide only</Button>;
  const go = async () => {
    setBusy(true);
    try {
      const { addEpgSource } = await import('../app/state');
      const input = file ? { file } : { url: url.trim() };
      if (!file && !/^https?:\/\//i.test(url.trim())) throw new Error('Enter a guide URL starting with http:// or https://, or choose a file.');
      const { summary } = await addEpgSource({ name: '', input });
      toast(`Guide added: ${summary.programmes.toLocaleString()} programs`, 'success');
      await rematchAndReload(false);
      await reloadAll();
      setOpen(false);
    } catch (e) {
      toast((e as Error).message, 'error', 8000);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="card form inline-form" data-group="add-guide">
      <label class="field">
        <span>XMLTV URL</span>
        <input class="f input" data-autofocus type="url" value={url} placeholder="https://…/guide.xml.gz" onInput={(e) => setUrl((e.target as HTMLInputElement).value)} />
      </label>
      <label class="field">
        <span>…or a file</span>
        <input class="f input" type="file" accept=".xml,.gz,.xmltv" onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] ?? null)} />
      </label>
      <div class="row gap">
        <Button variant="primary" disabled={busy} icon={busy ? undefined : 'check'} onClick={() => void go()}>{busy ? 'Loading guide…' : 'Add guide'}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

