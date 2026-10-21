import { AccountsSection } from './Accounts';
import { SetupServerModal } from './PhoneSetup';
import { h, Fragment } from 'preact';
import { canUpdateInApp, checkForUpdate, currentBuild, versionOf, installUpdate } from '../app/updates';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp, updateSettings, repo, reloadAll, toast, pruneExpired, getState, loadGuide, stopPlayback, player } from '../app/state';
import type { Settings } from '../core/types';
import { Choice, Toggle, Button, Modal } from './common';
import { SORT_OPTIONS } from './Channels';
import { ColorPicker } from './ColorPicker';
import { native, serverCaps, isTV } from '../app/platform';
import { redactUrl } from '../core/util';
import { isValidTimeZone } from '../core/time';
import { clock, when } from './fmt';


const COMMON_ZONES = ['', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo', 'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome', 'Europe/Athens', 'Europe/Istanbul', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];

function zoneOptions(current: string) {
  const sys = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = COMMON_ZONES.includes(current) ? COMMON_ZONES : [...COMMON_ZONES, current];
  return zones.filter((z) => z === '' || isValidTimeZone(z)).map((z) => ({ value: z, label: z === '' ? `Device (${sys})` : z }));
}

export function SettingsScreen() {
  const s = useApp((st) => st.settings);
  const set = (p: Partial<Settings>) => void updateSettings(p);
  const [diag, setDiag] = useState<string>('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [phoneSetup, setPhoneSetup] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      const st = getState();
      const caps = await serverCaps();
      let storage = '';
      try {
        const est = await navigator.storage?.estimate?.();
        if (est?.usage) storage = `${(est.usage / 1048576).toFixed(1)} MB used`;
      } catch {
        /* ignore */
      }
      const cov = st.guide.coverage();
      const lines = [
        `LTTV ${native ? native.appVersion() : caps.version || 'web'} · ${native ? native.platform() : caps.platform}`,
        native ? `Device: ${native.deviceInfo()}` : `Browser: ${navigator.userAgent}`,
        `Screen: ${window.innerWidth}×${window.innerHeight} CSS px @${window.devicePixelRatio}x · TV mode: ${isTV ? 'yes' : 'no'}`,
        `Helper: proxy ${caps.proxy ? 'available' : 'not available'} · ffmpeg ${caps.ffmpeg ? 'available' : 'not found'}`,
        `Playback: ${player.isNative ? 'native ExoPlayer' : 'browser (hls.js)'} · state ${player.status.state}${player.status.via ? ' via ' + player.status.via : ''}`,
        `Channels: ${st.lineup.length} (${st.lineup.filter((c) => c.hidden).length} hidden) · Guide channels loaded: ${st.guide.size}`,
        `Guide coverage: ${cov ? `${when(cov.start)} → ${when(cov.end)}` : 'none'}`,
        `Storage: ${storage || 'unknown'}`,
        ...st.playlists.map((p) => `Playlist "${p.name}": ${p.kind === 'url' ? redactUrl(p.url) : p.fileName} · ${p.channelCount ?? 0} ch · ${p.lastImportError ? 'ERROR ' + p.lastImportError : 'ok'}`),
        ...st.epgSources.map((e) => `Guide "${e.name}": ${e.kind === 'url' ? redactUrl(e.url) : e.fileName} · ${e.programmeCount ?? 0} programs · last ok ${e.lastRefreshAt ? new Date(e.lastRefreshAt).toISOString() : 'never'}${e.lastError ? ' · ERROR ' + e.lastError : ''}`),
        `Time zone: ${s.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone} · now ${clock(Date.now())}`,
      ];
      setDiag(lines.join('\n'));
    })();
  }, [s]);

  const exportSettings = async (includeSources: boolean) => {
    const data = await repo.exportSettings();
    if (!includeSources) {
      data.playlists = data.playlists.map((p) => ({ ...p, url: undefined }));
      data.epgSources = data.epgSources.map((e) => ({ ...e, url: undefined }));
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lttv-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  return (
    <section class="screen settings">
      {phoneSetup && <SetupServerModal onClose={() => setPhoneSetup(false)} />}
      <header class="screen-head"><h1>Settings</h1></header>
      <div class="settings-grid">
        <div class="card settings-section" data-group="set-colors">
          <h3>Colors</h3>
          <ColorPicker value={s.accent} onChange={(v) => set({ accent: v })} />
          <Choice label="Theme" value={s.theme} options={[{ value: 'a7', label: 'A7 (cosmic glow)' }, { value: 'luxury', label: 'Luxury (black & gold)' }, { value: 'aero', label: 'Aero (glass)' }, { value: 'dark', label: 'Dark' }, { value: 'darker', label: 'Black (OLED)' }, { value: 'contrast', label: 'High contrast' }]} onChange={(v) => set({ theme: v })} />
        </div>

        <AccountsSection onPhoneSetup={() => setPhoneSetup(true)} />

        <div class="card settings-section" data-group="set-display">
          <h3>Display</h3>
          <Choice label="Start on" value={s.startupScreen} options={[
            { value: 'home', label: 'Live TV' }, { value: 'guide', label: 'Guide' }, { value: 'channels', label: 'Channels' }, { value: 'last-channel', label: 'Last channel (full screen)' },
          ]} onChange={(v) => set({ startupScreen: v })} />
          <Choice label="Guide time span" value={s.guideHoursVisible} options={[{ value: 1.5, label: '1.5 hours' }, { value: 2, label: '2 hours' }, { value: 2.5, label: '2.5 hours' }, { value: 3, label: '3 hours' }, { value: 4, label: '4 hours' }]} onChange={(v) => set({ guideHoursVisible: v })} />
          <Toggle label="Show empty categories" checked={s.showEmptyCategories} onChange={(v) => set({ showEmptyCategories: v })} />
        </div>

        <div class="card settings-section" data-group="set-channels">
          <h3>Channels</h3>
          <Choice label="Sort channels by" value={s.sortMode} options={SORT_OPTIONS} onChange={(v) => set({ sortMode: v })} />
          <Toggle label="Channel up/down: favorites only" checked={s.zapFavoritesOnly} onChange={(v) => set({ zapFavoritesOnly: v })} />
        </div>

        <div class="card settings-section" data-group="set-time">
          <h3>Time &amp; guide</h3>
          <Choice label="Time zone" value={s.timeZone} options={zoneOptions(s.timeZone)} onChange={(v) => { set({ timeZone: v }); }} />
          <Choice label="Clock" value={String(s.hour12) as 'auto' | 'true' | 'false'} options={[{ value: 'auto', label: 'Automatic' }, { value: 'true', label: '12-hour' }, { value: 'false', label: '24-hour' }]} onChange={(v) => set({ hour12: v === 'auto' ? 'auto' : v === 'true' })} />
          <Choice label="Guide times without a time zone are" value={s.naiveTimeMode} hint="XMLTV times normally include an offset. Applies on the next guide update." options={[{ value: 'utc', label: 'UTC (XMLTV standard)' }, { value: 'local', label: 'Device local time' }, { value: 'zone', label: 'The selected time zone' }]} onChange={(v) => set({ naiveTimeMode: v, naiveTimeZone: v === 'zone' ? (s.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone) : '' })} />
          <Choice label="Update guide automatically" value={s.epgRefreshHours} options={[{ value: 0, label: 'Manually only' }, { value: 6, label: 'Every 6 hours' }, { value: 12, label: 'Every 12 hours' }, { value: 24, label: 'Daily' }, { value: 72, label: 'Every 3 days' }]} onChange={(v) => set({ epgRefreshHours: v })} />
          <Choice label="Keep past programs for" value={s.epgKeepPastHours} options={[{ value: 1, label: '1 hour' }, { value: 3, label: '3 hours' }, { value: 6, label: '6 hours' }, { value: 12, label: '12 hours' }]} onChange={(v) => set({ epgKeepPastHours: v })} />
          <Toggle label="Use my provider’s guide for missing channels" hint="Asks your provider for the guide of channels the guide file doesn’t cover (Xtream/“username & password” providers)." checked={s.providerGuide !== false} onChange={(v) => set({ providerGuide: v })} />
          <Toggle label="High-quality channel logos" hint="Uses matching transparent logos from the free tv-logos collection (loaded from GitHub) instead of the playlist’s logos." checked={s.hqLogos !== false} onChange={(v) => set({ hqLogos: v })} />
          <Toggle label="Captions" hint="Show subtitles / closed captions on movies, shows and channels that have them (also the CC button in the player)." checked={!!s.captions} onChange={(v) => { set({ captions: v }); player.setCaptions(v); }} />
          <Toggle label="Prefer English guide text" hint="When the guide has a programme in several languages, show the English one; Arabic or other foreign-script text on English channels is replaced with an English description when one can be found." checked={s.preferEnglish !== false} onChange={(v) => set({ preferEnglish: v })} />
          <Toggle label="Show the game on live-event channels" hint="Channels like “NFL 03” or “PPV 2” show what’s streaming on them right now." checked={s.liveEventNames !== false} onChange={(v) => set({ liveEventNames: v })} />
          <Choice label="Auto-approve fuzzy guide matches" value={s.fuzzyAutoApprove} hint="Off is safest: suggestions wait for your approval." options={[{ value: 0, label: 'Never' }, { value: 0.95, label: '≥ 95% confidence' }, { value: 0.9, label: '≥ 90% confidence' }, { value: 0.85, label: '≥ 85% confidence' }]} onChange={(v) => set({ fuzzyAutoApprove: v })} />
        </div>

        <div class="card settings-section" data-group="set-playback">
          <h3>Playback</h3>
          <Choice label="Reconnect attempts" value={s.playbackRetries} options={[0, 1, 2, 3, 5, 8].map((n) => ({ value: n, label: n === 0 ? 'Off' : String(n) }))} onChange={(v) => set({ playbackRetries: v })} />
          <Choice label="Stream timeout" value={s.stallTimeoutSec} options={[8, 10, 15, 20, 30, 45].map((n) => ({ value: n, label: `${n} s` }))} onChange={(v) => set({ stallTimeoutSec: v })} />
          <Choice label="Buffer" value={s.bufferSec} hint={native ? 'Applies to the next channel you tune' : undefined} options={[4, 8, 15, 30].map((n) => ({ value: n, label: `${n} s` }))} onChange={(v) => { set({ bufferSec: v }); if (native) native.setPlayerConfig(JSON.stringify({ bufferSec: v, timeoutSec: s.stallTimeoutSec, rewindMin: s.rewindMin ?? 30 })); }} />
          <Choice label="Live rewind" value={s.rewindMin ?? 30} hint={native ? 'Keeps the last minutes of the channel on this device so you can pause, rewind and fast-forward. Applies to the next channel you tune.' : 'Keeps up to 10 minutes in memory in a browser (the full time on Fire TV).'} options={[0, 5, 15, 30, 60].map((n) => ({ value: n, label: n === 0 ? 'Off' : `${n} min` }))} onChange={(v) => { set({ rewindMin: v }); if (native) native.setPlayerConfig(JSON.stringify({ bufferSec: s.bufferSec, timeoutSec: s.stallTimeoutSec, rewindMin: v })); }} />
          <Choice label="Info overlay hides after" value={s.osdTimeoutSec} options={[3, 5, 8, 15].map((n) => ({ value: n, label: `${n} s` }))} onChange={(v) => set({ osdTimeoutSec: v })} />
          {!native && <Choice label="Route streams through local helper" value={s.streamProxy} hint="Needed for streams that block browsers (CORS) or require special headers." options={[{ value: 'auto', label: 'When needed' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Never' }]} onChange={(v) => set({ streamProxy: v })} />}
          {canUpdateInApp() && (
            <div class="row gap wrap">
              <Button icon="refresh" onClick={() => void checkForUpdate().then((u) => u && installUpdate(u))}>Check for updates</Button>
              <span class="muted">Installed: LTTV {versionOf(currentBuild())}</span>
            </div>
          )}
          <Toggle label="Resume last channel on start" checked={s.autoplayLastChannel} onChange={(v) => set({ autoplayLastChannel: v })} />
        </div>

        <div class="card settings-section" data-group="set-data">
          <h3>Data</h3>
          <div class="row gap wrap">
            {!native && <Button icon="file" onClick={() => void exportSettings(false)}>Export settings</Button>}
            {!native && <Button icon="file" onClick={() => void exportSettings(true)}>Export incl. source URLs</Button>}
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (!f) return;
              try {
                const res = await repo.importSettings(JSON.parse(await f.text()));
                toast(`Imported settings: ${res.playlists} playlists, ${res.epg} guides, ${res.customizations} channel customizations. Use Sources → Refresh all to download them.`, 'success', 9000);
                await reloadAll();
              } catch (err) {
                toast((err as Error).message, 'error');
              }
            }} />
            <Button icon="add" onClick={() => fileRef.current?.click()}>Import settings</Button>
          </div>
          {native && <p class="hint">To copy your setup from the desktop app, export it there and send the file with Settings → Accounts → Set up from phone or computer.</p>}
          <p class="hint">Exports with source URLs contain your playlist addresses (and any credentials in them). Keep that file private.</p>
          <div class="row gap wrap">
            <Button icon="refresh" onClick={async () => { const n = await pruneExpired(); toast(`Removed ${n.toLocaleString()} expired programs`, 'success'); }}>Remove expired programs</Button>
            <Button icon="close" onClick={async () => { await repo.clearGuideCache(); await loadGuide(); toast('Guide cache cleared. Update your guide sources to download it again.', 'success', 7000); }}>Clear guide cache</Button>
            <Button variant="danger" icon="warn" onClick={() => setConfirmReset(true)}>Reset LTTV…</Button>
          </div>
        </div>

        <div class="card settings-section diag" data-group="set-diag">
          <h3>Diagnostics</h3>
          <pre class="diag-text">{diag}</pre>
          <div class="row gap">
            <Button small icon="file" onClick={() => void navigator.clipboard?.writeText(diag).then(() => toast('Copied'), () => toast('Copy not available here'))}>Copy</Button>
          </div>
          <p class="hint">Diagnostics never include full playlist URLs, tokens or passwords.</p>
        </div>
      </div>
      {confirmReset && (
        <Modal title="Reset LTTV?" onClose={() => setConfirmReset(false)}>
          <p>This deletes all playlists, guides, favorites and settings from this device. Your original playlist files and URLs are not affected.</p>
          <div class="row gap modal-actions">
            <Button variant="danger" data-autofocus onClick={async () => { stopPlayback(); await repo.resetAll(); setConfirmReset(false); await reloadAll(); toast('LTTV was reset'); }}>Delete everything</Button>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
