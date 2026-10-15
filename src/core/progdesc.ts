// Descriptions for what's on when the guide has a title but no description.
// Pure helpers (no network): title cleanup, game descriptions from the schedule,
// and checks that a TVmaze / Wikipedia answer is really the same programme.
import type { Game, ScheduleLeague } from './schedule';
import { broadcastSummary } from './streamfinder';

export type DescSource = 'guide' | 'schedule' | 'tvmaze' | 'wikipedia' | 'note';

export interface ProgDescription {
  text: string;
  source: DescSource;
  /** Link for attribution (TVmaze / Wikipedia page). */
  url?: string;
}

/** "New: The Late Show (2024) [HD]" -> "The Late Show". */
export function searchTitle(title: string): string {
  return title
    .replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ')
    .replace(/^\s*(new|live|premiere|season premiere|series premiere|all new|encore)\s*[:\-–]\s*/i, '')
    .replace(/\s*\((new|live|hd|4k|uhd|repeat|rpt|\d{4}|cc|subtitled|en|es)\)\s*/gi, ' ')
    .replace(/\s+[-–:|]\s*s\d{1,2}\s*e\d{1,3}.*$/i, '')
    .replace(/\s+s\d{1,2}\s*e\d{1,3}\b.*$/i, '')
    .replace(/\s+(hd|fhd|uhd|4k)$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Comparable form of a title: accents, punctuation and a leading "The" removed. */
export function titleKey(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the /, '')
    .trim();
}

/** "S2 E5" / "S02E05" -> { season, number }. */
export function episodeNumbers(ep: string | undefined): { season: number; number: number } | undefined {
  const m = /s\s*(\d{1,2})\s*e\s*(\d{1,3})/i.exec(ep ?? '');
  return m ? { season: Number(m[1]), number: Number(m[2]) } : undefined;
}

export function stripHtml(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Accept a TVmaze show only when its name is the programme's title. */
export function tvmazeShowMatches(show: unknown, title: string): show is { id: number; name: string; summary?: string; url?: string } {
  const s = show as { id?: unknown; name?: unknown } | null;
  return !!s && typeof s.id === 'number' && typeof s.name === 'string' && titleKey(s.name) === titleKey(title);
}

/** Accept a Wikipedia summary only for the same title and a film/TV article. */
export function wikiMatches(page: unknown, title: string, kind: 'film' | 'tv'): page is { title: string; extract: string; description?: string; content_urls?: { desktop?: { page?: string } } } {
  const p = page as { type?: string; title?: string; extract?: string; description?: string } | null;
  if (!p || p.type === 'disambiguation' || typeof p.extract !== 'string' || p.extract.length < 40 || typeof p.title !== 'string') return false;
  if (titleKey(p.title) !== titleKey(title)) return false;
  const what = `${p.description ?? ''} ${p.extract.slice(0, 300)}`;
  return kind === 'film' ? /\bfilm\b|\bmovie\b/i.test(what) : /\b(television|tv series|talk show|sitcom|news (program|programme|show)|reality|game show|series)\b/i.test(what);
}

/** Shorten long summaries to a couple of sentences. */
export function shorten(text: string, max = 420): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (end > 120 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…').trim();
}

const START_WORD: Record<ScheduleLeague['sport'], string> = {
  baseball: 'First pitch', football: 'Kickoff', soccer: 'Kickoff', basketball: 'Tip-off', hockey: 'Puck drop',
};

/** A description of a game from the schedule: matchup, records, stakes, venue, score, TV. */
export function gameDescription(g: Game, sport: ScheduleLeague['sport'], leagueName: string, clock: (t: number) => string): string {
  const team = (t: Game['home']) => (t.record ? `${t.name} (${t.record})` : t.name);
  const parts: string[] = [];
  parts.push(`${leagueName}: ${team(g.away)} ${g.neutral ? 'vs' : 'at'} ${team(g.home)}.`);
  if (g.note) parts.push(`${g.note}.`);
  if (g.venue) parts.push(`At ${g.venue}.`);
  if (g.state === 'in') parts.push(`Live now: ${g.away.abbr} ${g.away.score ?? 0}, ${g.home.abbr} ${g.home.score ?? 0} (${g.detail || 'in progress'}).`);
  else if (g.state === 'post') parts.push(`Final: ${g.away.abbr} ${g.away.score ?? ''}, ${g.home.abbr} ${g.home.score ?? ''}.`);
  else if (!/postpon|cancel|delay|suspend/i.test(g.detail)) parts.push(`${START_WORD[sport]} ${clock(g.start)}.`);
  else parts.push(`${g.detail}.`);
  const tv = broadcastSummary(g);
  if (tv) parts.push(`TV: ${tv}.`);
  return parts.join(' ');
}
