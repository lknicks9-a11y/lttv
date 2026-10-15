import { h, Fragment } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { withClientFallback, addPlaylist, addEpgSource, navigate, rematchAndReload, reloadAll, repo, useApp, getState, deletePlaylist, deleteEpgSource } from '../app/state';
import type { EpgImportSummary, PlaylistImportSummary } from '../core/pipeline';
import type { JobProgress } from '../app/importer';
import type { EpgSource, PlaylistSource } from '../core/types';
import { redactUrl } from '../core/util';
import { Button, Icon, Toggle, fmtBytes } from './common';
import { onBack, focusFirst } from '../app/nav';
import { isNative } from '../app/platform';
import { checkXtreamLogin, loadXtreamPlaylist } from '../app/xtream-login';
import { chooseOutput, normalizeServer, parseXtreamUrl, xtreamUrls, type XtreamAccount, type XtreamLogin } from '../core/xtream';
import type { InputSource } from '../app/importer';

type Step = 'source' | 'checking' | 'guide' | 'guide-loading' | 'matching' | 'summary' | 'error';

export function ImportWizard() {
  const existingEpg = useApp((s) => s.epgSources);
  const [step, setStep] = useState<Step>('source');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'xtream' | 'url' | 'file'>('xtream');
  const [url, setUrl] = useState('');
  const [server, setServer] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [output, setOutput] = useState<'m3u8' | 'ts'>(isNative ? 'ts' : 'm3u8');
  const [account, setAccount] = useState<XtreamAccount | null>(null);
  /** Client identity the provider accepted (undefined = LTTV's own). */
  const [ua, setUa] = useState<string | undefined>(undefined);
  const retryNote = (label: string) => setProgress({ phase: `Provider refused the connection — retrying as ${label}` });
  const [file, setFile] = useState<File | null>(null);
  const [skipVod, setSkipVod] = useState(true);
  const [epgMode, setEpgMode] = useState<'url' | 'file' | 'existing' | 'none'>('url');
  const [epgUrl, setEpgUrl] = useState('');
  const [epgFile, setEpgFile] = useState<File | null>(null);
  const [useExisting, setUseExisting] = useState<string[]>([]);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [error, setError] = useState<{ message: string; retry: Step } | null>(null);
  const [plRes, setPlRes] = useState<{ playlist: PlaylistSource; summary: PlaylistImportSummary } | null>(null);
  const [epgRes, setEpgRes] = useState<{ source: EpgSource; summary: EpgImportSummary } | null>(null);
  const [matchSummary, setMatchSummary] = useState<{ total: number; matched: number; pending: number; unmatched: number } | null>(null);

  const rootRef = useRef<HTMLElement>(null);
  // Each step replaces the content: move focus to its first control so the remote never gets lost.
  useLayoutEffect(() => {
    requestAnimationFrame(() => {
      const card = rootRef.current?.querySelector<HTMLElement>('.card');
      if (card && !card.contains(document.activeElement)) focusFirst(card);
    });
  }, [step]);

  useEffect(() => onBack(() => {
    if (step === 'guide') setStep('source');
    else navigate('sources', { replace: true });
    return true;
  }), [step]);

  const validUrl = (u: string) => /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(u.trim());

  const runPlaylist = async () => {
    setError(null);
    setAccount(null);
    let input: InputSource;
    let guideUrl = '';
    let detectedUa = ua;
    let xtreamLogin: XtreamLogin | undefined;
    let maxConnections: number | undefined;
    if (mode === 'xtream') {
      if (!server.trim() || !username.trim() || !password.trim()) {
        setError({ message: 'Enter the server address, username and password from your provider.', retry: 'source' });
        return;
      }
      let login: XtreamLogin;
      try {
        login = { server: normalizeServer(server), username, password, output };
      } catch (e) {
        setError({ message: (e as Error).message, retry: 'source' });
        return;
      }
      setStep('checking');
      setProgress({ phase: 'Signing in to your provider' });
      try {
        const { result: acc, ua: okUa } = await withClientFallback(ua, (u) => checkXtreamLogin(login, u), retryNote);
        setUa(okUa);
        detectedUa = okUa;
        setAccount(acc);
        maxConnections = acc.maxConnections && acc.maxConnections > 0 ? acc.maxConnections : undefined;
        if (!acc.ok) throw new Error(acc.message ?? 'Login failed.');
        login.output = chooseOutput(output, acc.formats);
      } catch (e) {
        const st = (e as { status?: number }).status;
        const msg = st && st >= 600
          ? `Your provider refused the sign-in check (player_api.php answered code ${st}), even when LTTV identified as VLC and other common players. That decision is made on the provider's side for your connection. The usual causes are: all your allowed connections are in use (close the app on other devices, wait 2–3 minutes), your internet address or VPN is blocked, or the provider requires new devices/apps to be approved. Ask Strong 8K support (or your provider) about "code ${st}" and whether third-party players are allowed.`
          : (e as Error).message;
        setError({ message: msg, retry: 'source' });
        setStep('error');
        setProgress(null);
        return;
      }
      setProgress({ phase: 'Loading channel list from your provider' });
      try {
        const { result } = await withClientFallback(detectedUa, (u) => loadXtreamPlaylist(login, u, (phase) => setProgress({ phase })), retryNote);
        input = { file: new File([result.text], 'provider.m3u') };
        xtreamLogin = login;
      } catch (e) {
        setError({ message: (e as Error).message, retry: 'source' });
        setStep('error');
        setProgress(null);
        return;
      }
      guideUrl = xtreamUrls(login).epg;
    } else if (mode === 'url') {
      // A pasted provider link with username/password works as-is; also offer its guide.
      const parsed = parseXtreamUrl(url);
      if (parsed?.server && parsed.username && parsed.password) guideUrl = xtreamUrls(parsed as XtreamLogin).epg;
      input = { url: url.trim() };
    } else {
      input = { file: file! };
    }
    if (mode === 'url' && !validUrl(url)) {
      setError({ message: 'Enter a full playlist URL starting with http:// or https://', retry: 'source' });
      return;
    }
    if (mode === 'file' && !file) {
      setError({ message: 'Choose a playlist file (.m3u or .m3u8).', retry: 'source' });
      return;
    }
    setStep('checking');
    setProgress({ phase: 'Connecting' });
    try {
      // If retrying after a failure, remove the half-added playlist first.
      if (plRes) await deletePlaylist(plRes.playlist.id).catch(() => undefined);
      const plName = name || (mode === 'xtream' ? `${username} @ ${normalizeServer(server).replace(/^https?:\/\//, '')}` : '');
      const { result: res, ua: okUa } = 'url' in input
        ? await withClientFallback(detectedUa, (u) => addPlaylist({ name: plName, input: { url: (input as { url: string }).url, headers: u ? { 'User-Agent': u } : undefined }, skipVod }, setProgress), retryNote)
        : { result: await addPlaylist({ name: plName, input, skipVod, xtream: xtreamLogin, userAgent: detectedUa, maxConnections }, setProgress), ua: undefined };
      if (okUa) setUa(okUa);
      setPlRes(res);
      if (!epgUrl) setEpgUrl(res.summary.epgUrls[0] || guideUrl);
      if (existingEpg.length && !res.summary.epgUrls.length) {
        setEpgMode('existing');
        setUseExisting(existingEpg.map((e) => e.id));
      }
      setStep('guide');
    } catch (e) {
      setError({ message: (e as Error).message, retry: 'source' });
      setStep('error');
    } finally {
      setProgress(null);
    }
  };

  const runGuide = async () => {
    setError(null);
    if (epgMode === 'url' && epgUrl.trim() && !validUrl(epgUrl)) {
      setError({ message: 'Enter a full guide URL starting with http:// or https://', retry: 'guide' });
      return;
    }
    try {
      let src: EpgSource | null = null;
      if ((epgMode === 'url' && epgUrl.trim()) || (epgMode === 'file' && epgFile)) {
        setStep('guide-loading');
        setProgress({ phase: 'Connecting' });
        const gName = name ? `${name} guide` : '';
        const { result: res } = epgMode === 'url'
          ? await withClientFallback(ua, (u) => addEpgSource({ name: gName, input: { url: epgUrl.trim(), headers: u ? { 'User-Agent': u } : undefined } }, setProgress), retryNote)
          : { result: await addEpgSource({ name: gName, input: { file: epgFile! } }, setProgress) };
        setEpgRes(res);
        src = res.source;
      }
      const ids = src ? [src.id] : epgMode === 'existing' ? useExisting : [];
      if (plRes) await repo.savePlaylist({ ...(await repo.listPlaylists()).find((p) => p.id === plRes.playlist.id)!, epgIds: ids });
      setStep('matching');
      await rematchAndReload(false);
      await reloadAll();
      const s = getState();
      const mine = s.lineup.filter((c) => c.playlistId === plRes?.playlist.id);
      setMatchSummary({
        total: mine.length,
        matched: mine.filter((c) => c.matchStatus === 'auto' || c.matchStatus === 'approved').length,
        pending: mine.filter((c) => c.matchStatus === 'pending').length,
        unmatched: mine.filter((c) => c.matchStatus === 'unmatched' || c.matchStatus === 'rejected').length,
      });
      setStep('summary');
    } catch (e) {
      setError({ message: (e as Error).message, retry: 'guide' });
      setStep('error');
    } finally {
      setProgress(null);
    }
  };

  const discard = async () => {
    if (epgRes) await deleteEpgSource(epgRes.source.id);
    if (plRes) await deletePlaylist(plRes.playlist.id);
    navigate('sources', { replace: true });
  };

  const steps = ['Playlist', 'Guide', 'Summary'];
  const stepIdx = step === 'source' || step === 'checking' ? 0 : step === 'summary' ? 2 : step === 'error' ? (error?.retry === 'source' ? 0 : 1) : 1;

  return (
    <section class="screen wizard" ref={rootRef}>
      <header class="screen-head">
        <div>
          <h1>Add a playlist</h1>
          <ol class="stepper">
            {steps.map((s, i) => (
              <li class={i === stepIdx ? 'current' : i < stepIdx ? 'done' : ''}>
                <span>{i < stepIdx ? <Icon name="check" size="1em" /> : i + 1}</span> {s}
              </li>
            ))}
          </ol>
        </div>
      </header>

      {step === 'source' && (
        <div class="card form" data-group="wizard">
          <label class="field">
            <span>Playlist name</span>
            <input class="f input" data-autofocus value={name} placeholder="e.g. My TV service" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
          <div class="seg" role="radiogroup" aria-label="Source type">
            <button type="button" role="radio" aria-checked={mode === 'xtream'} class={`f seg-btn ${mode === 'xtream' ? 'on' : ''}`} onClick={() => setMode('xtream')}>
              <Icon name="star" /> Username &amp; password
            </button>
            <button type="button" role="radio" aria-checked={mode === 'url'} class={`f seg-btn ${mode === 'url' ? 'on' : ''}`} onClick={() => setMode('url')}>
              <Icon name="link" /> From URL
            </button>
            <button type="button" role="radio" aria-checked={mode === 'file'} class={`f seg-btn ${mode === 'file' ? 'on' : ''}`} onClick={() => setMode('file')}>
              <Icon name="file" /> From file
            </button>
          </div>
          {mode === 'xtream' ? (
            <div class="xtream-form">
              <p class="muted">Most IPTV services (“Xtream Codes” login) give you a server address, a username and a password. Enter them exactly as your provider sent them.</p>
              <label class="field">
                <span>Server address</span>
                <input class="f input" type="url" inputMode="url" autoComplete="off" spellcheck={false} value={server} placeholder="http://line.example.com:8080" onInput={(e) => setServer((e.target as HTMLInputElement).value)} />
              </label>
              <div class="xtream-row">
                <label class="field">
                  <span>Username</span>
                  <input class="f input" autoComplete="username" autoCapitalize="off" spellcheck={false} value={username} onInput={(e) => setUsername((e.target as HTMLInputElement).value)} />
                </label>
                <label class="field">
                  <span>Password</span>
                  <input class="f input" type="password" autoComplete="current-password" autoCapitalize="off" spellcheck={false} value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
                </label>
              </div>
              <div class="seg" role="radiogroup" aria-label="Stream format">
                <button type="button" role="radio" aria-checked={output === 'm3u8'} class={`f seg-btn ${output === 'm3u8' ? 'on' : ''}`} onClick={() => setOutput('m3u8')}>HLS (best for computers)</button>
                <button type="button" role="radio" aria-checked={output === 'ts'} class={`f seg-btn ${output === 'ts' ? 'on' : ''}`} onClick={() => setOutput('ts')}>MPEG-TS (best for Fire TV)</button>
              </div>
              <small class="muted">Your login is stored only on this device. LTTV checks it with your provider, then loads your channels and their TV guide automatically.</small>
            </div>
          ) : mode === 'url' ? (
            <label class="field">
              <span>M3U / M3U8 playlist URL</span>
              <input class="f input" type="url" inputMode="url" autoComplete="off" spellcheck={false} value={url} placeholder="https://provider.example/get.php?…&type=m3u_plus" onInput={(e) => setUrl((e.target as HTMLInputElement).value)} />
              <small class="muted">Your URL is stored only on this device and is never shown in full in logs or diagnostics.</small>
            </label>
          ) : (
            <label class="field">
              <span>Playlist file</span>
              <input class="f input" type="file" accept=".m3u,.m3u8,.txt,audio/x-mpegurl,application/vnd.apple.mpegurl" onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] ?? null)} />
              {file && <small class="muted">{file.name} · {fmtBytes(file.size)}</small>}
              {isNative && <small class="muted">Tip: on Fire TV it’s easier to send files from your phone with Sources → Phone/computer setup.</small>}
            </label>
          )}
          <Toggle label="Live TV only" hint="Skip on-demand movie and series entries found in many provider playlists" checked={skipVod} onChange={setSkipVod} />
          <p class="hint">Only add playlists you are authorized to use. LTTV doesn’t provide channels or content.</p>
          {error && <p class="error-text"><Icon name="warn" /> {error.message}</p>}
          <div class="row gap modal-actions">
            <Button variant="primary" icon="chevronRight" onClick={() => void runPlaylist()}>{mode === 'xtream' ? 'Sign in & load channels' : 'Check playlist'}</Button>
            <Button variant="ghost" onClick={() => navigate('sources', { replace: true })}>Cancel</Button>
          </div>
        </div>
      )}

      {(step === 'checking' || step === 'guide-loading' || step === 'matching') && (
        <div class="card busy" aria-live="polite">
          <span class="spinner big" />
          <h2>{step === 'checking' ? 'Reading your playlist…' : step === 'guide-loading' ? 'Loading the program guide…' : 'Matching channels to the guide…'}</h2>
          {progress && (
            <p class="muted">
              {progress.phase}
              {progress.bytes ? ` · ${fmtBytes(progress.bytes)}${progress.total ? ` of ${fmtBytes(progress.total)}` : ''}` : ''}
              {progress.items ? ` · ${progress.items.toLocaleString()} entries` : ''}
            </p>
          )}
          {progress?.total && progress.bytes ? (
            <div class="progress progress-lg"><div class="progress-fill" style={{ width: `${Math.min(100, (progress.bytes / progress.total) * 100)}%` }} /></div>
          ) : null}
          <p class="hint">Large guides can take a minute. You can keep using the app; this runs in the background.</p>
        </div>
      )}

      {step === 'guide' && plRes && (
        <div class="card form" data-group="wizard">
          <p class="success-text">
            {account?.expires ? <span class="muted">Subscription active until {new Date(account.expires).toLocaleDateString()}{account.maxConnections ? ` · ${account.maxConnections} connection${account.maxConnections > 1 ? 's' : ''}` : ''}.</span> : null}
            <Icon name="check" /> Found <b>{plRes.summary.channels.toLocaleString()}</b> channels in {plRes.summary.groups.length} groups
            {plRes.summary.skippedVod ? ` (skipped ${plRes.summary.skippedVod.toLocaleString()} on-demand entries)` : ''}.
          </p>
          <h3>Program guide (XMLTV) — optional</h3>
          {plRes.summary.epgUrls.length > 0 && <p class="muted">Your playlist suggests a guide: {redactUrl(plRes.summary.epgUrls[0])}</p>}
          <div class="seg" role="radiogroup" aria-label="Guide source">
            <button type="button" class={`f seg-btn ${epgMode === 'url' ? 'on' : ''}`} onClick={() => setEpgMode('url')}><Icon name="link" /> URL</button>
            <button type="button" class={`f seg-btn ${epgMode === 'file' ? 'on' : ''}`} onClick={() => setEpgMode('file')}><Icon name="file" /> File</button>
            {existingEpg.length > 0 && <button type="button" class={`f seg-btn ${epgMode === 'existing' ? 'on' : ''}`} onClick={() => setEpgMode('existing')}><Icon name="guide" /> Existing</button>}
            <button type="button" class={`f seg-btn ${epgMode === 'none' ? 'on' : ''}`} onClick={() => setEpgMode('none')}><Icon name="close" /> No guide</button>
          </div>
          {epgMode === 'url' && (
            <label class="field">
              <span>XMLTV guide URL (.xml or .xml.gz)</span>
              <input class="f input" data-autofocus type="url" inputMode="url" spellcheck={false} value={epgUrl} placeholder="https://provider.example/xmltv.php?…" onInput={(e) => setEpgUrl((e.target as HTMLInputElement).value)} />
            </label>
          )}
          {epgMode === 'file' && (
            <label class="field">
              <span>XMLTV file</span>
              <input class="f input" type="file" accept=".xml,.gz,.xmltv,text/xml,application/xml,application/gzip" onChange={(e) => setEpgFile((e.target as HTMLInputElement).files?.[0] ?? null)} />
            </label>
          )}
          {epgMode === 'existing' && (
            <div class="stack">
              {existingEpg.map((s) => (
                <Toggle label={s.name} hint={`${(s.channelCount ?? 0).toLocaleString()} guide channels`} checked={useExisting.includes(s.id)} onChange={(v) => setUseExisting((l) => (v ? [...l, s.id] : l.filter((x) => x !== s.id)))} />
              ))}
              <small class="muted">All enabled guides are used for matching; this just records which ones belong to this playlist.</small>
            </div>
          )}
          {epgMode === 'none' && <p class="muted">Channels will show “Program information unavailable”. You can add a guide later in Sources.</p>}
          {error && <p class="error-text"><Icon name="warn" /> {error.message}</p>}
          <div class="row gap modal-actions">
            <Button variant="primary" icon="chevronRight" onClick={() => void runGuide()}>{epgMode === 'none' ? 'Continue without guide' : 'Load guide'}</Button>
            <Button variant="ghost" onClick={() => void discard()}>Cancel import</Button>
          </div>
        </div>
      )}

      {step === 'error' && error && (
        <div class="card form">
          <h2 class="error-text"><Icon name="warn" /> Import failed</h2>
          <p>{error.message}</p>
          <ul class="muted tips">
            <li>Check the URL for typos and that your subscription is active.</li>
            <li>Some providers block requests from unknown apps; try again in a few minutes.</li>
            <li>If the file is very large, make sure the device has free storage.</li>
          </ul>
          <div class="row gap modal-actions">
            <Button variant="primary" icon="refresh" data-autofocus onClick={() => void (error.retry === 'source' ? runPlaylist() : runGuide())}>Retry</Button>
            <Button onClick={() => setStep(error.retry === 'source' ? 'source' : 'guide')}>Edit</Button>
            <Button variant="ghost" onClick={() => void discard()}>Cancel</Button>
          </div>
        </div>
      )}

      {step === 'summary' && plRes && (
        <div class="card form">
          <h2><Icon name="check" /> {plRes.playlist.name} is ready</h2>
          <div class="stats">
            <div class="stat"><b>{plRes.summary.channels.toLocaleString()}</b><span>channels</span></div>
            <div class="stat"><b>{plRes.summary.groups.length}</b><span>groups</span></div>
            <div class="stat"><b>{(matchSummary?.matched ?? 0).toLocaleString()}</b><span>with guide</span></div>
            <div class="stat"><b>{(matchSummary?.pending ?? 0).toLocaleString()}</b><span>to review</span></div>
            <div class="stat"><b>{(matchSummary?.unmatched ?? 0).toLocaleString()}</b><span>no guide</span></div>
            {epgRes && <div class="stat"><b>{epgRes.summary.programmes.toLocaleString()}</b><span>programs</span></div>}
          </div>
          {plRes.summary.warnings.length > 0 && (
            <details class="warnings">
              <summary class="f">{plRes.summary.warnings.length} warning(s)</summary>
              <ul>{plRes.summary.warnings.slice(0, 50).map((w) => <li>{w.line ? `Line ${w.line}: ` : ''}{w.message}</li>)}</ul>
            </details>
          )}
          <p class="muted">Your lineup is saved. Channel names were tidied (originals are kept) and categories come from your playlist groups.</p>
          <div class="row gap modal-actions">
            <Button variant="primary" icon="live" data-autofocus onClick={() => navigate('home', { replace: true })}>Start watching</Button>
            <Button icon="channels" onClick={() => navigate('channels', { replace: true })}>Review lineup</Button>
            {(matchSummary?.pending ?? 0) > 0 && <Button icon="link" onClick={() => navigate('matches', { replace: true })}>Review {matchSummary!.pending} guide matches</Button>}
            <Button variant="ghost" onClick={() => void discard()}>Discard import</Button>
          </div>
        </div>
      )}
    </section>
  );
}
