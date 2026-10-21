import { currentAccount, renameAccount } from '../app/accounts';
import { notifyAccountsChanged } from './Accounts';
import { addEpgSource, addPlaylist, rematchAndReload, reloadAll, repo, toast, withClientFallback } from '../app/state';
import { checkXtreamLogin, loadXtreamPlaylist } from '../app/xtream-login';
import { chooseOutput, normalizeServer, xtreamUrls, type XtreamLogin } from '../core/xtream';

/**
 * Handles items sent from the Fire TV "Phone/computer setup" LAN page.
 * Uploaded files are held by the native host and fetched from api/upload/<id>.
 */
interface Submission {
  type: 'playlist' | 'epg' | 'settings' | 'xtream' | 'account';
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
  if (s.account?.trim()) {
    const acc = currentAccount();
    if (acc.name !== s.account.trim()) {
      renameAccount(acc.id, s.account);
      notifyAccountsChanged();
      if (s.type === 'account') toast(`Account renamed to ${s.account.trim()}`, 'success');
    }
  }
  if (s.type === 'account') return;
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
      toast('Signing in to your provider…', 'info', 6000);
      const { result: acc, ua } = await withClientFallback(undefined, (u) => checkXtreamLogin(login, u));
      if (!acc.ok) throw new Error(acc.message ?? 'Login failed.');
      login.output = chooseOutput('ts', acc.formats);
      const urls = xtreamUrls(login);
      const headers = ua ? { 'User-Agent': ua } : undefined;
      const { text } = await loadXtreamPlaylist(login, ua);
      const { summary } = await addPlaylist({ name: s.name || `${login.username} @ ${login.server.replace(/^https?:\/\//, '')}`, input: { file: new File([text], 'provider.m3u') }, xtream: login, userAgent: ua });
      toast(`Playlist added: ${summary.channels.toLocaleString()} channels. Loading the TV guide…`, 'success', 6000);
      try {
        const { summary: g } = await addEpgSource({ name: 'Provider guide', input: { url: urls.epg, headers } });
        toast(`Guide added: ${g.programmes.toLocaleString()} programs`, 'success');
      } catch (e) {
        toast('Channels added, but the provider guide could not be loaded: ' + (e as Error).message, 'error', 10000);
      }
      await rematchAndReload(false);
      await reloadAll();
      return;
    }
    const input = s.uploadId ? { file: await uploadedFile(s.uploadId, s.fileName ?? 'upload') } : s.url ? { url: s.url } : null;
    if (!input) throw new Error('Nothing to import.');
    toast(`Received ${s.type === 'epg' ? 'guide' : 'playlist'} from your device. Importing…`, 'info', 6000);
    if (s.type === 'epg') {
      const { summary } = await addEpgSource({ name: s.name ?? '', input });
      toast(`Guide added: ${summary.programmes.toLocaleString()} programs`, 'success');
    } else {
      const { summary } = await addPlaylist({ name: s.name ?? '', input, skipVod: s.skipVod !== false });
      toast(`Playlist added: ${summary.channels.toLocaleString()} channels`, 'success');
      if (s.epg && /^https?:\/\//i.test(s.epg.trim())) {
        try {
          const { summary: g } = await addEpgSource({ name: '', input: { url: s.epg.trim() } });
          toast(`Guide added: ${g.programmes.toLocaleString()} programs`, 'success');
        } catch (e) {
          toast('Playlist added, but the guide could not be loaded: ' + (e as Error).message, 'error', 10000);
        }
      }
    }
    await rematchAndReload(false);
    await reloadAll();
  } catch (e) {
    toast('Import from your device failed: ' + (e as Error).message, 'error', 10000);
  }
}
