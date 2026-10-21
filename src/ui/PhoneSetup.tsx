// Fire TV: a temporary page on the home network so a phone or computer can type the provider login,
// playlist/guide URLs or send files; they go to the account that's open on the TV.
import { h } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { native } from '../app/platform';
import { currentAccount } from '../app/accounts';
import { qrMatrix, qrSvgPath } from '../core/qr';
import { Button, Modal } from './common';
import { handleSetupSubmission } from './setup';

function Qr({ text }: { text: string }) {
  const q = useMemo(() => {
    try {
      return qrSvgPath(qrMatrix(text));
    } catch {
      return null;
    }
  }, [text]);
  if (!q) return null;
  return (
    <svg class="setup-qr" viewBox={`0 0 ${q.size} ${q.size}`} shape-rendering="crispEdges" role="img" aria-label="QR code for the setup page">
      <rect width={q.size} height={q.size} fill="#fff" />
      <path d={q.d} fill="#000" />
    </svg>
  );
}

export function SetupServerModal({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<{ url?: string; qr?: string; pin?: string; error?: string } | null>(null);
  useEffect(() => {
    try {
      setInfo(JSON.parse(native!.startSetupServer()));
    } catch (e) {
      setInfo({ error: (e as Error).message });
    }
    window.lttvHost = window.lttvHost ?? ({} as NonNullable<Window['lttvHost']>);
    window.lttvHost.onSetupSubmit = (json: string) => void handleSetupSubmission(json);
    return () => native?.stopSetupServer();
  }, []);
  const acc = currentAccount();
  return (
    <Modal title="Set up from your phone or computer" onClose={onClose} wide>
      {!info ? (
        <p><span class="spinner" /> Starting…</p>
      ) : info.error ? (
        <p class="error-text">{info.error}</p>
      ) : (
        <div class="setup setup-split">
          {info.qr ? <Qr text={info.qr} /> : null}
          <div class="setup-steps">
            <p><b>1.</b> Scan the code with your phone’s camera, or on a phone or computer on the <b>same Wi-Fi</b> open:</p>
            <p class="setup-url">{info.url}</p>
            <p><b>2.</b> PIN (filled in for you when you scan):</p>
            <p class="setup-pin">{info.pin}</p>
            <p><b>3.</b> Enter your provider login (or playlist and guide URLs) and press <b>Send to TV</b>. It’s added to the account <b>{acc.name}</b>.</p>
            <p class="muted">Everything stays on your home network and on this TV. The page stops working when you close this window.</p>
          </div>
        </div>
      )}
      <div class="row gap modal-actions">
        <Button data-autofocus onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}
