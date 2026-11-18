// League Pass / Blitz secret settings (Down, Down, Up, Up, Left): add the timeout screen's photos and songs from a
// phone (kept on this TV), see what the app has, and look again.
import { h } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { native } from '../app/platform';
import { useApp } from '../app/state';
import { APP_MODE } from '../app/appmode';
import { qrMatrix, qrSvgPath } from '../core/qr';
import { refreshTimeoutMedia, timeoutTvStatus } from './Timeout';
import { Button, Modal } from './common';

export function PassSettings({ onClose }: { onClose: () => void }) {
  const name = APP_MODE === 'blitz' ? 'Blitz' : 'League Pass';
  const computer = useApp((s) => s.settings.timeoutMedia ?? '');
  const [addr, setAddr] = useState('');
  const [counts, setCounts] = useState({ images: 0, audio: 0 });
  const [status, setStatus] = useState(timeoutTvStatus());
  const count = () => {
    try {
      const j = JSON.parse(native?.localTimeoutFiles?.() || '{}') as { images?: string[]; audio?: string[] };
      setCounts({ images: j.images?.length ?? 0, audio: j.audio?.length ?? 0 });
    } catch {
      /* none */
    }
  };
  const lookAgain = () => void refreshTimeoutMedia().then(() => setStatus(timeoutTvStatus()));
  useEffect(() => {
    count();
    lookAgain();
    const host = window.lttvHost;
    if (host) host.onLocalMedia = () => { count(); lookAgain(); };
    return () => {
      if (host) host.onLocalMedia = undefined;
      native?.stopMediaServer?.();
    };
  }, []);
  const qr = useMemo(() => (addr ? qrSvgPath(qrMatrix(addr)) : null), [addr]);
  return (
    <Modal title={`${name} settings`} onClose={onClose} wide class="pass-settings">
      <h3>Photos &amp; songs for the timeout screen</h3>
      <p class="muted">They show and play when no game is on. Add them from your phone or computer on the same Wi-Fi; they're kept on this TV.</p>
      <p><b>{counts.images}</b> photos and <b>{counts.audio}</b> songs added from your phone.</p>
      <p class="muted">Songs come from your computer’s “timeout” folder when it’s on (exactly the songs in it); songs from your phone are only used when there are none there.</p>
      {(counts.audio > 0 || counts.images > 0) && (
        <div class="row gap">
          {counts.audio > 0 && <Button small icon="close" onClick={() => { native?.clearLocalTimeout?.('audio'); count(); lookAgain(); }}>Remove phone songs</Button>}
          {counts.images > 0 && <Button small icon="close" onClick={() => { native?.clearLocalTimeout?.('images'); count(); lookAgain(); }}>Remove phone photos</Button>}
        </div>
      )}
      {addr ? (
        <div class="row gap pass-qr">
          {qr && <svg viewBox={`0 0 ${qr.size} ${qr.size}`} width="180" height="180" style={{ background: '#fff', padding: '8px', borderRadius: '10px' }}><path d={qr.d} fill="#000" /></svg>}
          <div>
            <p>Scan this, or open on your phone:</p>
            <p class="pass-addr">{addr}</p>
            <p class="muted">Pick photos and songs there — they appear here as they arrive.</p>
          </div>
        </div>
      ) : (
        <Button variant="primary" icon="phone" data-autofocus onClick={() => {
          const a = native?.startMediaServer?.() ?? '';
          setAddr(a || 'This TV isn’t on Wi-Fi right now.');
        }}>Add from your phone</Button>
      )}
      <h3>What {name} has now</h3>
      <p>{status || 'Looking…'}</p>
      <p class="muted">Also used: the copy LTTV keeps on this TV{computer ? `, and your computer at ${computer}` : ''}.</p>
      <div class="row gap modal-actions">
        <Button icon="refresh" onClick={lookAgain}>Look again</Button>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
