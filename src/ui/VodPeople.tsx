// Cast & crew on a movie or show's page: round photos you can open for a short biography.
import { h } from 'preact';
import { useState } from 'preact/hooks';
import { usePerson } from '../app/vodmeta';
import { Modal } from './common';

const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const names = (s?: string) => (s ?? '').split(/[,;/]|\band\b/).map((x) => x.trim()).filter((x) => x.length > 2 && x.length < 40);

function Face({ name, role, onOpen }: { name: string; role: string; onOpen: () => void }) {
  const p = usePerson(name);
  const [bad, setBad] = useState(false);
  return (
    <button type="button" class="f person" onClick={onOpen} aria-label={`${name}, ${role}`}>
      <span class="person-face">{p?.photo && !bad ? <img src={p.photo} alt="" loading="lazy" onError={() => setBad(true)} /> : initials(name)}</span>
      <span class="person-name">{name}</span>
      <small class="muted">{role}</small>
    </button>
  );
}

function PersonCard({ name, role, onClose }: { name: string; role: string; onClose: () => void }) {
  const p = usePerson(name);
  return (
    <Modal title={name} onClose={onClose} class="person-card">
      <div class="person-card-body">
        <span class="person-photo">{p?.photo ? <img src={p.photo} alt="" /> : initials(name)}</span>
        <div class="person-card-text">
          <small class="watch-card-ch">{role}</small>
          {p?.about && <div class="person-about">{p.about}</div>}
          {p === undefined ? <p class="muted row gap"><span class="spinner" /> Loading…</p> : p?.bio ? <p class="person-bio">{p.bio}</p> : <p class="muted">No biography found for {name}.</p>}
          {p?.bio && <p class="hint">Biography: Wikipedia.</p>}
          <div class="row gap modal-actions"><button type="button" class="f btn" data-autofocus onClick={onClose}>Close</button></div>
        </div>
      </div>
    </Modal>
  );
}

export function CastRow({ cast, director }: { cast?: string; director?: string }) {
  const [open, setOpen] = useState<{ name: string; role: string } | null>(null);
  const seen = new Set<string>();
  const people = [...names(cast).map((name) => ({ name, role: 'Cast' })), ...names(director).map((name) => ({ name, role: 'Director' }))].filter((x) => !seen.has(x.name.toLowerCase()) && !!seen.add(x.name.toLowerCase())).slice(0, 14);
  if (!people.length) return null;
  return (
    <section class="vod-row vod-people">
      <h2 class="vod-row-title">Cast &amp; crew</h2>
      <div class="vod-strip" data-group="vod-people" data-hlock>
        {people.map((x) => <Face key={x.name} name={x.name} role={x.role} onOpen={() => setOpen(x)} />)}
      </div>
      {open && <PersonCard name={open.name} role={open.role} onClose={() => setOpen(null)} />}
    </section>
  );
}
