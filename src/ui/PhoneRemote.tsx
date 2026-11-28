// Settings → Phone remote (desktop): the QR code / address / code the phone uses to pair with this computer.
import { h, Fragment } from 'preact';
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
  if (!info) return <AccountPhone />; // Fire TV, a plain browser without the helper, or turned off (--no-remote)
  const url = info.urls[0];
  return (
    <>
    <AccountPhone />
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
    </>
  );
}

/** The phone page for your account: works anywhere (not only on the same Wi-Fi), for every LTTV app on this TV. */
const PHONE_PAGE = 'https://lknicks9-a11y.github.io/lttv/phone.html';
function AccountPhone() {
  return (
    <div class="card settings-section" data-group="set-phone">
      <h3>LTTV on your phone</h3>
      <div class="setup setup-split">
        <Qr text={PHONE_PAGE} />
        <div class="setup-steps">
          <p><b>1.</b> Scan the code with your phone’s camera, or open <span class="setup-url">{PHONE_PAGE.replace('https://', '')}</span>.</p>
          <p><b>2.</b> Sign in with the same LTTV account as this TV.</p>
          <p class="muted">Pick this TV (LTTV, League Pass, Blitz…) to use your phone as its remote, start or stop what it plays, or watch on the phone — at home or away. On iPhone, Share → Add to Home Screen makes it an app.</p>
        </div>
      </div>
    </div>
  );
}
