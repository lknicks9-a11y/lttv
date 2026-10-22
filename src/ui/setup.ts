import { currentAccount, renameAccount } from '../app/accounts';
import { openCloudAccount, signInWithRefreshToken } from '../app/cloud';
import { notifyAccountsChanged } from './Accounts';
import { addEpgSource, addPlaylist, finishTask, rematchAndReload, reloadAll, repo, showTask, toast, withClientFallback } from '../app/state';
import type { JobProgress } from '../app/importer';
import { checkXtreamLogin, loadXtreamPlaylist } from '../app/xtream-login';
import { chooseOutput, normalizeServer, xtreamUrls, type XtreamLogin } from '../core/xtream';

/**
 * Handles items sent from the Fire TV "Phone/computer setup" LAN page.
 * Uploaded files are held by the native host and fetched from api/upload/<id>.
 */
interface Submission {
  type: 'playlist' | 'epg' | 'settings' | 'xtream' | 'account' | 'session';
  refresh_token?: string;
  /** Name for the account open on the TV. */
  account?: string;
  /** Guide URL sent with a playlist URL. */
  epg?: string;
  server?: string;
  username?: string;
  password?: string;
  name?: string;
  url?: string;
  uploadId?: string;
  fileName?: string;
  skipVod?: boolean;
}

async function uploadedFile(id: string, name: string): Promise<File> {
  const r = await fetch('api/upload/' + encodeURIComponent(id));
  if (!r.ok) throw new Error('Could not read the uploaded file.');
  return new File([await r.blob()], name);
}

export async function handleSetupSubmission(json: string) {
  let s: Submission;
  try {
    s = JSON.parse(json) as Submission;
  } catch {
    return;
  }
  if (s.type === 'session') {
    // Signed in on the phone (Google, Apple or email): this TV signs in too.
    if (!s.refresh_token) return;
    try {
      toast('Signing in…', 'info', 4000);
      openCloudAccount(await signInWithRefreshToken(s.refresh_token));
    } catch (e) {
      toast(`Sign-in didn’t finish: ${(e as Error).message}`, 'error', 8000);
    }
    return;
  }
  if (s.account?.trim()) {
    const acc = currentAccount();
    if (acc.name !== s.account.trim()) {
      renameAccount(acc.id, s.account);
      notifyAccountsChanged();
      if (s.type === 'account') toast(`Account renamed to ${s.account.trim()}`, 'success');
    }
  }
  if (s.type === 'account') return;
  // A progress item stays in the corner until everything is loaded (big playlists take a while on a TV).
  const id = 'phone-import';
  const step = (label: string) => (p?: JobProgress) => showTask({ id, label, progress: p });
  try {
    if (s.type === 'settings' && s.uploadId) {
      const f = await uploadedFile(s.uploadId, s.fileName ?? 'settings.json');
      const res = await repo.importSettings(JSON.parse(await f.text()));
      toast(`Settings imported (${res.playlists} playlists, ${res.epg} guides). Refreshing sources…`, 'success', 8000);
      const { refreshAll } = await import('../app/state');
      await refreshAll();
      return;
    }
    if (s.type === 'xtream') {
      const login: XtreamLogin = { server: normalizeServer(s.server ?? ''), username: s.username ?? '', password: s.password ?? '', output: 'ts' };
      step('Signing in to your provider…')();
      const { result: acc, ua } = await withClientFallback(undefined, (u) => checkXtreamLogin(login, u));
      if (!acc.ok) throw new Error(acc.message ?? 'Login failed.');
      login.output = chooseOutput('ts', acc.formats);
      const urls = xtreamUrls(login);
      const headers = ua ? { 'User-Agent': ua } : undefined;
      step('Downloading your channel list…')();
      const { text } = await loadXtreamPlaylist(login, ua);
      const { summary } = await addPlaylist({ name: s.name || `${login.username} @ ${login.server.replace(/^https?:\/\//, '')}`, input: { file: new File([text], 'provider.m3u') }, xtream: login, userAgent: ua }, step('Loading your channels…'));
      toast(`Playlist added: ${summary.channels.toLocaleString()} channels`, 'success', 4000);
      try {
        const { summary: g } = await addEpgSource({ name: 'Provider guide', input: { url: urls.epg, headers } }, step('Loading the TV guide…'));
        toast(`Guide added: ${g.programmes.toLocaleString()} programs`, 'success');
      } catch (e) {
        toast('Channels added, but the provider guide could not be loaded: ' + (e as Error).message, 'error', 10000);
      }
      step('Matching channels to the guide…')();
      await rematchAndReload(false);
      await reloadAll();
      showTask({ id, label: 'Your channels are ready', done: true });
      finishTask(id, 4000);
      return;
    }
    const input = s.uploadId ? { file: await uploadedFile(s.uploadId, s.fileName ?? 'upload') } : s.url ? { url: s.url } : null;
    if (!input) throw new Error('Nothing to import.');
    if (s.type === 'epg') {
      const { summary } = await addEpgSource({ name: s.name ?? '', input }, step('Loading the TV guide from your phone…'));
      toast(`Guide added: ${summary.programmes.toLocaleString()} programs`, 'success');
    } else {
      const { summary } = await addPlaylist({ name: s.name ?? '', input, skipVod: s.skipVod !== false }, step('Loading the playlist from your phone…'));
      toast(`Playlist added: ${summary.channels.toLocaleString()} channels`, 'success');
      if (s.epg && /^https?:\/\//i.test(s.epg.trim())) {
        try {
          const { summary: g } = await addEpgSource({ name: '', input: { url: s.epg.trim() } }, step('Loading the TV guide…'));
          toast(`Guide added: ${g.programmes.toLocaleString()} programs`, 'success');
        } catch (e) {
          toast('Playlist added, but the guide could not be loaded: ' + (e as Error).message, 'error', 10000);
        }
      }
    }
    step('Matching channels to the guide…')();
    await rematchAndReload(false);
    await reloadAll();
    showTask({ id, label: 'Done — your channels are ready', done: true });
    finishTask(id, 4000);
  } catch (e) {
    showTask({ id, label: 'Couldn’t add what you sent', error: (e as Error).message });
    finishTask(id, 12000);
  }
}
