import type { CategoryId, LineupChannel, Programme } from './types';
import type { GuideIndex } from './guide';
import { CATEGORY_LABELS } from './normalize';

export interface SearchFilters {
  category?: CategoryId | 'all';
  favoritesOnly?: boolean;
  withGuideOnly?: boolean;
}

export interface ChannelHit {
  channel: LineupChannel;
  score: number;
  field: 'name' | 'original' | 'number' | 'category' | 'group';
}

export interface ProgrammeHit {
  channel: LineupChannel;
  programme: Programme;
  airingNow: boolean;
}

function fold(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function scoreText(hay: string, q: string): number {
  const h = fold(hay);
  if (!h) return 0;
  if (h === q) return 100;
  if (h.startsWith(q)) return 80;
  const words = h.split(/[^\p{L}\p{N}]+/u);
  if (words.some((w) => w.startsWith(q))) return 60;
  if (h.includes(q)) return 40;
  // all query words present
  const qw = q.split(/\s+/).filter(Boolean);
  if (qw.length > 1 && qw.every((w) => h.includes(w))) return 30;
  return 0;
}

export function searchChannels(list: LineupChannel[], query: string, f: SearchFilters = {}, guide?: GuideIndex): ChannelHit[] {
  const q = fold(query.trim());
  const pool = list.filter((c) =>
    !c.hidden &&
    (!f.favoritesOnly || c.favorite) &&
    (!f.category || f.category === 'all' || c.category === f.category) &&
    (!f.withGuideOnly || (guide?.has(c.epgChannelId) && (c.matchStatus === 'auto' || c.matchStatus === 'approved'))));
  if (!q) return [];
  const hits: ChannelHit[] = [];
  for (const c of pool) {
    let best = 0;
    let field: ChannelHit['field'] = 'name';
    const tryF = (s: number, fl: ChannelHit['field']) => {
      if (s > best) {
        best = s;
        field = fl;
      }
    };
    if (/^\d+$/.test(q) && String(c.number) === q) tryF(110, 'number');
    tryF(scoreText(c.name, q), 'name');
    if (c.originalName !== c.name) tryF(scoreText(c.originalName, q) - 5, 'original');
    tryF(scoreText(CATEGORY_LABELS[c.category], q) - 30, 'category');
    if (c.group) tryF(scoreText(c.group, q) - 25, 'group');
    if (best > 0) hits.push({ channel: c, score: best + (c.favorite ? 3 : 0), field });
  }
  return hits.sort((a, b) => b.score - a.score || a.channel.number - b.channel.number).slice(0, 200);
}

/**
 * Search programme titles (and episode subtitles) currently airing or
 * upcoming. Only channels with a usable (auto/approved) guide match are searched.
 */
export function searchProgrammes(list: LineupChannel[], guide: GuideIndex, query: string, now: number, f: SearchFilters = {}, limit = 100): ProgrammeHit[] {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const hits: (ProgrammeHit & { s: number })[] = [];
  for (const c of list) {
    if (c.hidden || !c.epgChannelId || !(c.matchStatus === 'auto' || c.matchStatus === 'approved')) continue;
    if (f.favoritesOnly && !c.favorite) continue;
    if (f.category && f.category !== 'all' && c.category !== f.category) continue;
    for (const p of guide.get(c.epgChannelId)) {
      if (p.stop <= now) continue;
      const s = Math.max(scoreText(p.title, q), p.subTitle ? scoreText(p.subTitle, q) - 20 : 0);
      if (s > 0) hits.push({ channel: c, programme: p, airingNow: p.start <= now, s });
    }
  }
  hits.sort((a, b) => Number(b.airingNow) - Number(a.airingNow) || b.s - a.s || a.programme.start - b.programme.start);
  return hits.slice(0, limit).map(({ s: _s, ...h }) => h);
}
