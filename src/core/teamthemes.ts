// NBA city themes: each team's colors on the whole app, its city's name across the background and an original
// jersey drawing in those colors (no team logos or wordmarks). Theme ids are "nba-<abbr>".

export interface TeamTheme {
  id: string;
  city: string;
  team: string;
  /** Main, second and trim colors. */
  c: [string, string, string];
}

const T = (abbr: string, city: string, team: string, c1: string, c2: string, c3: string): TeamTheme => ({ id: `nba-${abbr}`, city, team, c: [c1, c2, c3] });

export const NBA_THEMES: TeamTheme[] = [
  T('atl', 'Atlanta', 'Hawks', '#E03A3E', '#C1D32F', '#26282A'),
  T('bos', 'Boston', 'Celtics', '#007A33', '#BA9653', '#FFFFFF'),
  T('bkn', 'Brooklyn', 'Nets', '#1A1A1A', '#FFFFFF', '#707271'),
  T('cha', 'Charlotte', 'Hornets', '#1D1160', '#00788C', '#A1A1A4'),
  T('chi', 'Chicago', 'Bulls', '#CE1141', '#000000', '#FFFFFF'),
  T('cle', 'Cleveland', 'Cavaliers', '#860038', '#FDBB30', '#041E42'),
  T('dal', 'Dallas', 'Mavericks', '#00538C', '#B8C4CA', '#002B5E'),
  T('den', 'Denver', 'Nuggets', '#0E2240', '#FEC524', '#8B2131'),
  T('det', 'Detroit', 'Pistons', '#C8102E', '#1D42BA', '#BEC0C2'),
  T('gsw', 'San Francisco', 'Warriors', '#1D428A', '#FFC72C', '#FFFFFF'),
  T('hou', 'Houston', 'Rockets', '#CE1141', '#000000', '#C4CED4'),
  T('ind', 'Indiana', 'Pacers', '#002D62', '#FDBB30', '#BEC0C2'),
  T('lac', 'Los Angeles', 'Clippers', '#C8102E', '#1D428A', '#BEC0C2'),
  T('lal', 'Los Angeles', 'Lakers', '#552583', '#FDB927', '#000000'),
  T('mem', 'Memphis', 'Grizzlies', '#5D76A9', '#12173F', '#F5B112'),
  T('mia', 'Miami', 'Heat', '#98002E', '#F9A01B', '#000000'),
  T('mil', 'Milwaukee', 'Bucks', '#00471B', '#EEE1C6', '#0077C0'),
  T('min', 'Minneapolis', 'Timberwolves', '#0C2340', '#236192', '#78BE20'),
  T('nop', 'New Orleans', 'Pelicans', '#0C2340', '#C8102E', '#85714D'),
  T('nyk', 'New York', 'Knicks', '#006BB6', '#F58426', '#BEC0C2'),
  T('okc', 'Oklahoma City', 'Thunder', '#007AC1', '#EF3B24', '#002D62'),
  T('orl', 'Orlando', 'Magic', '#0077C0', '#C4CED4', '#000000'),
  T('phi', 'Philadelphia', '76ers', '#006BB6', '#ED174C', '#002B5C'),
  T('phx', 'Phoenix', 'Suns', '#1D1160', '#E56020', '#F9AD1B'),
  T('por', 'Portland', 'Trail Blazers', '#E03A3E', '#000000', '#FFFFFF'),
  T('sac', 'Sacramento', 'Kings', '#5A2D81', '#63727A', '#000000'),
  T('sas', 'San Antonio', 'Spurs', '#1A1A1A', '#C4CED4', '#8A8D8F'),
  T('tor', 'Toronto', 'Raptors', '#CE1141', '#000000', '#A1A1A4'),
  T('uta', 'Salt Lake City', 'Jazz', '#3E2680', '#000000', '#F9A01B'),
  T('was', 'Washington', 'Wizards', '#002B5C', '#E31837', '#C4CED4'),
];

/** What fits across a jersey. */
const SHORT_CITY: Record<string, string> = { 'Oklahoma City': 'OKC', 'San Francisco': 'The Town', 'Salt Lake City': 'Utah', 'Los Angeles': 'L.A.', 'New Orleans': 'NOLA', Philadelphia: 'Philly', Minneapolis: 'Minnesota', Washington: 'D.C.', 'San Antonio': 'San Antonio', Sacramento: 'Sacramento' };

export function teamTheme(id: string): TeamTheme | undefined {
  return NBA_THEMES.find((t) => t.id === id);
}

const rgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
};
const hex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
/** a → b by t (0..1). */
export const mix = (a: string, b: string, t: number) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const lum = (h: string) => {
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb(h);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const sat = (h: string) => {
  const [r, g, b] = rgb(h);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max ? (max - min) / max : 0;
};

/** The team color that reads best as a highlight on a dark screen (brightened if it's too dark). */
export function teamAccent(t: TeamTheme): string {
  const pick = [...t.c].filter((c) => sat(c) > 0.25).sort((a, b) => sat(b) * Math.min(lum(b), 0.5) - sat(a) * Math.min(lum(a), 0.5))[0] ?? t.c[1];
  let a = pick;
  for (let i = 0; i < 6 && lum(a) < 0.12; i++) a = mix(a, '#ffffff', 0.18);
  return a;
}

/** An original jersey drawing in the team's colors with the city across the chest. */
export function jerseySvg(t: TeamTheme): string {
  const [c1, c2, c3] = t.c;
  const trim = lum(c1) < 0.03 && lum(c2) < 0.03 ? c3 : c2;
  const text = lum(c1) > 0.5 ? '#111111' : trim;
  const city = SHORT_CITY[t.city] ?? t.city;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240">
<path d="M62 8 Q100 44 138 8 L168 18 Q156 58 164 84 L164 232 L36 232 L36 84 Q44 58 32 18 Z" fill="${c1}" stroke="${trim}" stroke-width="5"/>
<path d="M62 8 Q100 44 138 8" fill="none" stroke="${trim}" stroke-width="9"/>
<path d="M32 18 Q44 58 36 84" fill="none" stroke="${trim}" stroke-width="7"/><path d="M168 18 Q156 58 164 84" fill="none" stroke="${trim}" stroke-width="7"/>
<rect x="36" y="88" width="9" height="144" fill="${c3}"/><rect x="155" y="88" width="9" height="144" fill="${c3}"/>
<text x="100" y="100" font-family="Georgia, serif" font-style="italic" font-weight="700" font-size="${city.length > 8 ? 19 : 24}" fill="${text}" text-anchor="middle">${city}</text>
<text x="100" y="178" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="64" fill="${c3 === c1 ? trim : c3}" stroke="${trim}" stroke-width="2.5" text-anchor="middle">0</text>
<rect x="36" y="214" width="128" height="7" fill="${trim}"/>
</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * A superfan's room in the team's colors: painted wall with a stripe, wood floor, framed jerseys, a city pennant,
 * a shelf of game balls and a trophy, a foam finger and a banner (all original drawings, no team logos).
 */
export function roomSvg(t: TeamTheme): string {
  const [c1, c2, c3] = t.c;
  const dark1 = lum(c1) < 0.02;
  const wall = dark1 ? mix(c2, '#000000', 0.8) : mix(c1, '#000000', 0.55);
  const wall2 = mix(wall, '#000000', 0.35);
  const stripe = dark1 ? c3 : c2;
  const city = t.city.toUpperCase();
  const short = SHORT_CITY[t.city] ?? t.city;
  const jersey = (x: number, y: number, s: number, body: string, trim: string, num: string, rot: number) => `
<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
<rect x="-18" y="-14" width="236" height="278" rx="6" fill="#2a1d12" stroke="#c9a35a" stroke-width="5"/>
<rect x="-6" y="-2" width="212" height="254" fill="${mix(wall, '#000000', 0.5)}"/>
<path d="M62 8 Q100 44 138 8 L168 18 Q156 58 164 84 L164 232 L36 232 L36 84 Q44 58 32 18 Z" fill="${body}" stroke="${trim}" stroke-width="5"/>
<path d="M62 8 Q100 44 138 8" fill="none" stroke="${trim}" stroke-width="9"/>
<rect x="36" y="88" width="9" height="144" fill="${trim}"/><rect x="155" y="88" width="9" height="144" fill="${trim}"/>
<text x="100" y="100" font-family="Georgia, serif" font-style="italic" font-weight="700" font-size="${short.length > 8 ? 18 : 23}" fill="${lum(body) > 0.5 ? '#111' : trim}" text-anchor="middle">${short}</text>
<text x="100" y="182" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="66" fill="${lum(body) > 0.5 ? '#111' : trim}" text-anchor="middle">${num}</text>
</g>`;
  const ball = (x: number, y: number, r: number) => `<g transform="translate(${x} ${y})"><circle r="${r}" fill="#d9772b" stroke="#3a1f0c" stroke-width="3"/><path d="M-${r} 0 H${r} M0 -${r} V${r} M-${r * 0.7} -${r * 0.7} Q0 0 -${r * 0.7} ${r * 0.7} M${r * 0.7} -${r * 0.7} Q0 0 ${r * 0.7} ${r * 0.7}" stroke="#3a1f0c" stroke-width="2.5" fill="none"/></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${wall}"/><stop offset="1" stop-color="${wall2}"/></linearGradient>
<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a4f2a"/><stop offset="1" stop-color="#3b2413"/></linearGradient>
<radialGradient id="l" cx="0.5" cy="0" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity="0.18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="1600" height="900" fill="url(#w)"/>
<rect y="300" width="1600" height="26" fill="${stripe}" opacity="0.85"/><rect y="334" width="1600" height="8" fill="${c3}" opacity="0.6"/>
<rect y="700" width="1600" height="200" fill="url(#f)"/>
${Array.from({ length: 16 }, (_, i) => `<line x1="${i * 110}" y1="700" x2="${i * 110 - 60}" y2="900" stroke="#2a180b" stroke-width="3" opacity="0.6"/>`).join('')}
<rect y="692" width="1600" height="12" fill="#24160b"/>
<path d="M90 120 L470 160 L90 200 Z" fill="${stripe}"/><rect x="78" y="112" width="14" height="96" fill="#d8d8d8"/>
<text x="110" y="168" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${city.length > 9 ? 22 : 30}" fill="${dark1 ? '#111' : c1}" transform="rotate(3 110 168)">${city}</text>
${jersey(560, 70, 1.05, c1, stripe, '1', -2)}${jersey(860, 50, 1.2, dark1 ? '#f2f2f2' : '#ffffff', dark1 ? '#111' : c1, '23', 1)}${jersey(1200, 80, 1.05, stripe, dark1 ? '#ffffff' : c1, '7', 3)}
<rect x="120" y="470" width="420" height="16" rx="3" fill="#5a3a1e"/><rect x="130" y="486" width="12" height="40" fill="#3a2614"/><rect x="518" y="486" width="12" height="40" fill="#3a2614"/>
${ball(190, 432, 38)}${ball(282, 440, 30)}
<g transform="translate(380 330)"><path d="M0 0 H90 Q88 70 45 88 Q2 70 0 0 Z" fill="#e2b84a" stroke="#8a6a1c" stroke-width="3"/><path d="M0 12 Q-30 14 -26 40 Q-20 62 8 58" fill="none" stroke="#e2b84a" stroke-width="8"/><path d="M90 12 Q120 14 116 40 Q110 62 82 58" fill="none" stroke="#e2b84a" stroke-width="8"/><rect x="36" y="88" width="18" height="30" fill="#c99a2e"/><rect x="14" y="118" width="62" height="22" rx="3" fill="#2a1d12"/></g>
<g transform="translate(1430 520) rotate(-12)"><rect x="-40" y="0" width="80" height="150" rx="16" fill="${stripe}"/><rect x="-14" y="-90" width="28" height="110" rx="14" fill="${stripe}"/><text x="0" y="90" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="46" fill="${dark1 ? '#111' : c1}" text-anchor="middle">#1</text></g>
<g transform="translate(70 560)"><rect width="300" height="110" rx="8" fill="${c1}" stroke="${stripe}" stroke-width="6"/><text x="150" y="70" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="40" fill="${stripe}" text-anchor="middle">LET'S GO</text></g>
<rect width="1600" height="900" fill="url(#l)"/>
</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** CSS custom properties for a team theme. */
export function teamThemeVars(t: TeamTheme): Record<string, string> {
  const [c1, c2] = t.c;
  const base = lum(c1) < 0.02 ? mix(c2, '#000000', 0.9) : mix(c1, '#000000', 0.86);
  return {
    '--bg': mix(base, '#000000', 0.25),
    '--bg-2': base,
    '--panel': mix(base, '#ffffff', 0.05),
    '--panel-2': mix(base, '#ffffff', 0.1),
    '--panel-3': mix(base, '#ffffff', 0.16),
    '--line': mix(base, '#ffffff', 0.18),
    '--team-1': c1,
    '--team-2': c2,
    '--team-glow': `${mix(c1, '#000000', 0.2)}99`,
    '--team-stripe': `${c2}22`,
    '--team-stroke': `${lum(c1) < 0.02 ? c2 : c1}66`,
    '--team-city': JSON.stringify(t.city.toUpperCase()),
    '--team-jersey': jerseySvg(t),
    '--team-room': roomSvg(t),
  };
}

export const TEAM_VAR_NAMES = ['--bg', '--bg-2', '--panel', '--panel-2', '--panel-3', '--line', '--team-1', '--team-2', '--team-glow', '--team-stripe', '--team-stroke', '--team-city', '--team-jersey', '--team-room'];
