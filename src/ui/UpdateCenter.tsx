// Settings → Update Center: the installed version, the newest one, what's new, and one button that
// downloads the update and opens the install screen (or the download page if the installer won't open).
import { h, Fragment } from 'preact';
import { useEffect } from 'preact/hooks';
import { canUpdateInApp, checkNow, currentBuild, installUpdate, openDownloadPage, reopenInstaller, useUpdateState, versionOf } from '../app/updates';
import { Button, Icon } from './common';

function when(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function UpdateCenter() {
  const { status, latest, available } = useUpdateState();
  // Fresh info whenever the Update Center opens.
  useEffect(() => {
    if (canUpdateInApp() && (!latest || Date.now() - latest.checkedAt > 60_000)) void checkNow();
  }, []);
  if (!canUpdateInApp()) return null;
  const cur = currentBuild();
  const newer = !!available || (!!latest && latest.build > cur);
  const busy = status.phase === 'checking' || status.phase === 'downloading';
  const pct = status.phase === 'downloading' ? Math.max(0, Math.min(100, status.percent ?? 0)) : 0;
  return (
    <div class="card settings-section update-center" data-group="set-updates">
      <h3>Update Center</h3>
      <div class="uc-versions">
        <div class="uc-ver"><small class="muted">Installed</small><b>LTTV {versionOf(cur)}</b></div>
        <Icon name="chevronRight" />
        <div class={`uc-ver ${newer ? 'uc-new' : ''}`}>
          <small class="muted">Latest</small>
          <b>{latest ? `LTTV ${versionOf(latest.build)}` : status.phase === 'checking' ? 'Checking…' : '—'}</b>
          {latest?.publishedAt && <small class="muted">Released {when(latest.publishedAt)}</small>}
        </div>
      </div>
      <p class={`uc-state ${newer ? 'uc-state-new' : ''}`}>
        {status.phase === 'checking' ? 'Checking for updates…'
          : status.phase === 'downloading' ? `Downloading the update… ${pct}%`
          : status.phase === 'installing' ? 'The install screen is open — press “Install”. Your playlists and settings stay.'
          : status.phase === 'permission' ? 'Switch on “Allow from this source” for LTTV, then press Back — the install screen opens by itself.'
          : status.phase === 'browser' ? 'The download page opened in your browser — open the downloaded file there to install.'
          : status.phase === 'error' ? `Update didn’t finish: ${status.error}`
          : newer ? 'A newer version is ready to install.'
          : latest ? 'You have the latest version.' : ''}
      </p>
      {status.phase === 'downloading' && <div class="uc-bar"><div style={{ width: `${pct}%` }} /></div>}
      {latest && latest.notes.length > 0 && (
        <div class="uc-notes">
          <b>What’s new in {versionOf(latest.build)}</b>
          <ul>{latest.notes.slice(0, 8).map((n) => <li>{n}</li>)}</ul>
        </div>
      )}
      <div class="row gap wrap">
        {newer && (
          <Button variant="primary" icon="refresh" disabled={busy} onClick={() => latest && installUpdate({ url: latest.url })}>
            {status.phase === 'downloading' ? `Downloading… ${pct}%` : `Download & install ${latest ? versionOf(latest.build) : ''}`}
          </Button>
        )}
        {(status.phase === 'installing' || status.phase === 'permission' || status.phase === 'error') && newer && (
          <Button icon="play" onClick={reopenInstaller}>Open install screen again</Button>
        )}
        <Button icon="refresh" disabled={busy} onClick={() => void checkNow()}>Check now</Button>
        {newer && <Button variant="ghost" icon="link" onClick={() => openDownloadPage()}>Open download page</Button>}
      </div>
      <p class="hint">LTTV checks for updates every 20 minutes and asks when one is ready. Updates install over this version: playlists, accounts and settings are kept.</p>
    </div>
  );
}
