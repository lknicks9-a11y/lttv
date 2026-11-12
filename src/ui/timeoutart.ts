// The timeout screen's built-in pictures and music, made for LTTV (nothing borrowed): four drawn scenes and a
// slow beat generated on the spot. They work on every device with nothing to set up. Your own pictures and songs,
// if you add them, take their place.
const W = 1600;
const H = 900;
const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${body}</svg>`)}`;

// 1. The court from above, lit from the middle.
const court = svg(`
<defs><radialGradient id="l" cx="50%" cy="45%" r="65%"><stop offset="0" stop-color="#c98a4b"/><stop offset=".55" stop-color="#6e4324"/><stop offset="1" stop-color="#1c1009"/></radialGradient>
<pattern id="p" width="46" height="900" patternUnits="userSpaceOnUse"><rect width="46" height="900" fill="none"/><path d="M45.500 0v900" stroke="#000" stroke-opacity=".13"/></pattern></defs>
<rect width="${W}" height="${H}" fill="url(#l)"/><rect width="${W}" height="${H}" fill="url(#p)"/>
<g fill="none" stroke="#fff3e2" stroke-opacity=".62" stroke-width="7">
<rect x="70" y="60" width="1460" height="780"/><path d="M800 60v780"/><circle cx="800" cy="450" r="118"/>
<path d="M70 150h150a330 330 0 0 1 0 600H70M1530 150h-150a330 330 0 0 0 0 600h150"/>
<rect x="70" y="330" width="300" height="240"/><rect x="1230" y="330" width="300" height="240"/>
<path d="M370 360a90 90 0 0 1 0 180M1230 360a90 90 0 0 0 0 180"/></g>
<circle cx="800" cy="450" r="38" fill="#e2632a"/><path d="M762 450h76M800 412v76" stroke="#3a1608" stroke-width="4"/>`);

// 2. The rim and net against the arena dark.
const hoop = svg(`
<defs><radialGradient id="b" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="#22345c"/><stop offset=".6" stop-color="#0c1224"/><stop offset="1" stop-color="#05070d"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#b)"/>
<g fill="#fff" fill-opacity=".1">${Array.from({ length: 26 }, (_, i) => `<circle cx="${(i * 311) % W}" cy="${40 + ((i * 173) % 300)}" r="${10 + ((i * 7) % 26)}"/>`).join('')}</g>
<rect x="520" y="170" width="560" height="350" rx="14" fill="#fff" fill-opacity=".07" stroke="#fff" stroke-opacity=".7" stroke-width="8"/>
<rect x="705" y="330" width="190" height="130" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="7"/>
<ellipse cx="800" cy="520" rx="132" ry="26" fill="none" stroke="#ff6a2b" stroke-width="13"/>
<g fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="4">${[-110, -66, -22, 22, 66, 110].map((x) => `<path d="M${800 + x} 532 L${800 + x * 0.55} 720"/>`).join('')}
<path d="M690 580q110 34 220 0M705 630q95 30 190 0M720 680q80 26 160 0M735 720q65 20 130 0"/></g>`);

// 3. The ball, close.
const ball = svg(`
<defs><radialGradient id="o" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#ffab5e"/><stop offset=".6" stop-color="#d9531c"/><stop offset="1" stop-color="#6b210a"/></radialGradient>
<linearGradient id="d" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#17110f"/><stop offset="1" stop-color="#050505"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#d)"/>
<circle cx="1120" cy="560" r="470" fill="url(#o)"/>
<g fill="none" stroke="#2a0f05" stroke-width="15" stroke-linecap="round">
<path d="M650 560h940M1120 90v940"/><path d="M800 215c190 170 190 520 0 690M1440 215c-190 170-190 520 0 690"/></g>`);

// 4. The arena lights, out of focus.
const lights = svg(`
<defs><linearGradient id="n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101a33"/><stop offset="1" stop-color="#04050a"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#n)"/>
${Array.from({ length: 60 }, (_, i) => `<circle cx="${(i * 269 + 80) % W}" cy="${(i * 151 + 60) % 620}" r="${14 + ((i * 13) % 46)}" fill="${['#ffd9a8', '#9cc4ff', '#ffffff', '#ff9d5c'][i % 4]}" fill-opacity="${0.06 + ((i * 5) % 12) / 100}"/>`).join('')}
<path d="M0 760q800-120 1600 0v140H0z" fill="#000" fill-opacity=".55"/>`);

export const TIMEOUT_ART = [court, hoop, ball, lights];

/**
 * The built-in music: a slow four-chord beat (kick, snare, hats, a low bass and a soft pad) made with the device's
 * sound synthesizer, so there is no file and nobody else's song. Returns the function that fades it out and stops it.
 */
export function startBeat(): () => void {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return () => undefined;
  const ac = new AC();
  const out = ac.createGain();
  out.gain.value = 0;
  out.connect(ac.destination);
  out.gain.linearRampToValueAtTime(0.5, ac.currentTime + 2.5);
  void ac.resume().catch(() => undefined);

  const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const tone = (type: OscillatorType, f0: number, f1: number, t: number, dur: number, vol: number, cutoff?: number) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.04, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (cutoff) {
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      o.connect(f).connect(g);
    } else o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  };
  const hit = (t: number, dur: number, vol: number, type: BiquadFilterType, freq: number) => {
    const s = ac.createBufferSource();
    s.buffer = noise;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t);
    s.stop(t + dur + 0.02);
  };

  const BEAT = 60 / 82;
  // A minor, F, C, G: bass note and the chord over it.
  const BARS: [number, number[]][] = [[55, [220, 261.63, 329.63]], [43.65, [174.61, 220, 261.63]], [65.41, [196, 261.63, 329.63]], [49, [196, 246.94, 293.66]]];
  let bar = 0;
  let next = ac.currentTime + 0.2;
  const schedule = () => {
    while (next < ac.currentTime + 1.2) {
      const [bass, chord] = BARS[bar % BARS.length];
      for (let b = 0; b < 4; b++) {
        const t = next + b * BEAT;
        if (b === 0 || b === 2) tone('sine', 130, 44, t, 0.32, 0.9); // kick
        if (b === 2 && bar % 2) tone('sine', 130, 44, t + BEAT * 0.75, 0.25, 0.6);
        if (b === 1 || b === 3) hit(t, 0.17, 0.32, 'bandpass', 1900); // snare
        hit(t, 0.04, 0.09, 'highpass', 7000); // hats
        hit(t + BEAT / 2, 0.04, 0.06, 'highpass', 7000);
      }
      tone('sine', bass, bass, next, BEAT * 3.6, 0.5); // bass
      for (const f of chord) {
        tone('triangle', f, f, next, BEAT * 3.9, 0.07, 1400);
        tone('sawtooth', f * 1.004, f * 1.004, next, BEAT * 3.9, 0.025, 900);
      }
      next += BEAT * 4;
      bar++;
    }
  };
  schedule();
  const timer = window.setInterval(schedule, 400);
  return () => {
    window.clearInterval(timer);
    try {
      out.gain.cancelScheduledValues(ac.currentTime);
      out.gain.setValueAtTime(out.gain.value, ac.currentTime);
      out.gain.linearRampToValueAtTime(0, ac.currentTime + 0.8);
    } catch {
      /* closing anyway */
    }
    window.setTimeout(() => void ac.close().catch(() => undefined), 1000);
  };
}
