// Settings → Movies & Shows: your Watchmode API key (home rows from Watchmode's US, English lists).
import { h } from 'preact';
import { useState } from 'preact/hooks';
import { updateSettings, useApp, toast } from '../app/state';
import { clearWatchmodeCache, testWatchmodeKey } from '../app/watchmode';
import { resetVodHome } from '../app/vod';
import { Button } from './common';

export function WatchmodeSettings() {
  const saved = useApp((s) => s.settings.watchmodeKey ?? '');
  const [key, setKey] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    const k = key.trim();
    setBusy(true);
    setMsg(null);
    try {
      if (k) {
        const n = await testWatchmodeKey(k);
        setMsg({ ok: true, text: `Key works — ${n} US streaming services found. Movies & Shows now use Watchmode’s lists.` });
      } else setMsg({ ok: true, text: 'Key removed — Movies & Shows use Apple’s US charts.' });
      await updateSettings({ watchmodeKey: k || undefined });
      await clearWatchmodeCache();
      resetVodHome();
    } catch (e) {
      setMsg({ ok: false, text: `That key didn’t work: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="card settings-section" data-group="set-watchmode">
      <h3>Movies &amp; Shows</h3>
      <p class="hint">With your own Watchmode API key (free at watchmode.com), the Movies and Shows home pages use Watchmode’s US, English-language lists — Popular, New, Popular on Netflix / Hulu / Max / Disney+ and more, and genres — showing the titles your provider has. Lists refresh every 3 days.</p>
      <label class="field">
        <span>Watchmode API key</span>
        <input class="f input" type="password" autoComplete="off" spellcheck={false} value={key} placeholder="Paste your key" onInput={(e) => setKey((e.target as HTMLInputElement).value)} />
      </label>
      {msg && <p class={msg.ok ? 'ok-text' : 'error-text'}>{msg.text}</p>}
      <div class="row gap wrap">
        <Button variant="primary" icon="check" disabled={busy} onClick={() => void save()}>{busy ? 'Checking…' : 'Save & test'}</Button>
        {saved && <Button icon="refresh" disabled={busy} onClick={() => void clearWatchmodeCache().then(() => { resetVodHome(); toast('Movies & Shows lists will refresh next time you open them.', 'success'); })}>Refresh lists now</Button>}
      </div>
      <p class="hint">Your key stays on this device (and in your account if you sign in); it isn’t built into the app.</p>
    </div>
  );
}
