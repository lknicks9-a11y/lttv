import { ChannelName } from './ChannelName';
import { ProgDesc } from './ProgDesc';
import { h, Fragment } from 'preact';
import { useApp, setState, tune, channelByKey } from '../app/state';
import { Modal, Button, ChannelLogo, Progress } from './common';
import { day, range, duration, progress, remaining } from './fmt';

export function ProgrammeDetail() {
  const detail = useApp((s) => s.detail)!;
  const now = useApp((s) => s.now);
  const ch = channelByKey(detail.channelKey);
  const p = detail.programme;
  const close = () => setState({ detail: undefined });
  if (!ch) return null;
  const airing = !!p && p.start <= now && p.stop > now;
  return (
    <Modal title={p?.title ?? ch.name} onClose={close} wide>
      <div class="detail">
        <div class="detail-ch">
          <ChannelLogo ch={ch} src={ch.logo} name={ch.name} />
          <span class="ch-num">{ch.number}</span>
          <ChannelName ch={ch} />
        </div>
        {p && (
          <>
            <div class="detail-meta">
              <span>{day(p.start)}</span>
              <span>{range(p)}</span>
              <span>{duration(p)}</span>
              {p.episode && <span>{p.episode}</span>}
              {p.rating && <span class="tag">{p.rating}</span>}
              {p.isNew && <span class="tag accent">New</span>}
              {p.live && <span class="tag accent">Live</span>}
            </div>
            {airing && (
              <div class="detail-progress">
                <Progress value={progress(p, now)} class="progress-lg" />
                <span class="muted">{remaining(p, now)}</span>
              </div>
            )}
            {p.subTitle && <h3 class="detail-sub">{p.subTitle}</h3>}
            <ProgDesc p={p} ch={ch} class="detail-desc" />
            {p.categories?.length ? <p class="tags">{p.categories.map((c) => <span class="tag">{c}</span>)}</p> : null}
            {!airing && p.start > now && <p class="hint">This program hasn’t started yet. LTTV plays live channels only; it doesn’t record.</p>}
          </>
        )}
        <div class="row gap modal-actions">
          <Button variant="primary" icon="play" data-autofocus onClick={() => { close(); void tune(ch.key, { fullscreen: true }); }}>
            {airing ? 'Watch now' : 'Watch channel'}
          </Button>
          <Button icon="channels" onClick={() => setState({ detail: undefined, channelMenu: ch.key })}>Channel options</Button>
          <Button variant="ghost" onClick={close}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
