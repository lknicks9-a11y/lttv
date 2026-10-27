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
  const city = t.city.length > 11 ? t.city.split(' ').slice(-1)[0] : t.city;
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
  };
}

export const TEAM_VAR_NAMES = ['--bg', '--bg-2', '--panel', '--panel-2', '--panel-3', '--line', '--team-1', '--team-2', '--team-glow', '--team-stripe', '--team-stroke', '--team-city', '--team-jersey'];
