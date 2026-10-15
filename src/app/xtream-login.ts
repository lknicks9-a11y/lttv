import { FetchError, openRemote } from './platform';
import { parseAccount, xtreamApiUrl, xtreamToM3U, xtreamUrls, type XtreamAccount, type XtreamCategory, type XtreamLogin, type XtreamStream } from '../core/xtream';

async function getText(url: string, userAgent?: string): Promise<string> {
  const { stream } = await openRemote(url, undefined, userAgent ? { 'User-Agent': userAgent } : undefined);
  return new Response(stream).text();
}

/** Ask the provider's player_api.php whether the login works (status, expiry, connections). */
export async function checkXtreamLogin(login: XtreamLogin, userAgent?: string): Promise<XtreamAccount> {
  const text = await getText(xtreamUrls(login).account, userAgent);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    if (/^\s*#EXTM3U/.test(text)) return { ok: true }; // some panels don't support player_api but the login works
    return { ok: false, message: 'The server didn’t answer like an IPTV provider. Check the server address (including the :port).' };
  }
  return parseAccount(json);
}

/**
 * Load the channel list. First through the app API (what TiviMate/IPTV Smarters use),
 * then, if that isn't available, the classic get.php playlist download.
 * Returns M3U text plus which method worked.
 */
export async function loadXtreamPlaylist(login: XtreamLogin, userAgent?: string, onPhase?: (s: string) => void): Promise<{ text: string; method: 'api' | 'get.php' }> {
  let apiError: Error | undefined;
  try {
    onPhase?.('Loading channel list from your provider');
    const [catsText, streamsText] = await Promise.all([
      getText(xtreamApiUrl(login, 'get_live_categories'), userAgent),
      getText(xtreamApiUrl(login, 'get_live_streams'), userAgent),
    ]);
    const cats = JSON.parse(catsText) as XtreamCategory[];
    const streams = JSON.parse(streamsText) as XtreamStream[];
    if (Array.isArray(streams) && streams.length) return { text: xtreamToM3U(login, Array.isArray(cats) ? cats : [], streams), method: 'api' };
    apiError = new Error('The provider returned no live channels through its app API.');
  } catch (e) {
    apiError = e as Error;
  }
  onPhase?.('Downloading playlist (get.php)');
  try {
    const text = await getText(xtreamUrls(login).playlist, userAgent);
    if (!/#EXTINF/i.test(text)) throw new Error('The provider’s playlist download was empty.');
    return { text, method: 'get.php' };
  } catch (e) {
    const status = (e as FetchError).status ?? (apiError as FetchError)?.status;
    throw new FetchError(`Couldn’t get the channel list. App API: ${apiError?.message ?? 'failed'} Playlist download: ${(e as Error).message}`, status);
  }
}
