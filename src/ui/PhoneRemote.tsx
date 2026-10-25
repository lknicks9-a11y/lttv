// Settings → Phone remote (desktop): the QR code / address / code the phone uses to pair with this computer.
import { h } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { native } from '../app/platform';
import { qrMatrix, qrSvgPath } from '../core/qr';

interface Info {
  pin: string;
  port: number;
  enabled: boolean;
  urls: string[];
}

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
    <svg class="setup-qr" viewBox={`0 0 ${q.size} ${q.size}`} shape-rendering="crispEdges" role="img" aria-label="QR code for the phone remote">
      <rect width={q.size} height={q.size} fill="#fff" />
      <path d={q.d} fill="#000" />
    </svg>
  );
}

export function PhoneRemoteSettings() {
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  useEffect(() => {
    if (native) return setInfo(null);
    fetch('api/remote/info', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Info | null) => setInfo(j && j.enabled ? j : null))
      .catch(() => setInfo(null));
  }, []);
  if (!info) return null; // Fire TV, a plain browser without the helper, or turned off (--no-remote)
  const url = info.urls[0];
  return (
    <div class="card settings-section" data-group="set-remote">
      <h3>Phone remote</h3>
      {url ? (
        <div class="setup setup-split">
          <Qr text={url} />
          <div class="setup-steps">
            <p><b>1.</b> On a phone on the <b>same Wi-Fi</b>, scan the code with the camera.</p>
            <p><b>2.</b> Or open <span class="setup-url">{url.replace(/\?k=.*/, '')}</span> and type the code <b class="setup-pin">{info.pin}</b>.</p>
            <p class="muted">The phone becomes a remote for LTTV on this computer: arrows and OK, channels, and the games in each Multiview tile. Keep LTTV open here. The first time, Windows may ask to allow LTTV on private networks — allow it.</p>
          </div>
        </div>
      ) : (
        <p class="muted">This computer isn’t on a network right now, so a phone can’t reach it.</p>
      )}
    </div>
  );
}
