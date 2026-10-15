// English-first guide text: spotting programme text in another script (Arabic,
// Cyrillic, Hebrew, CJK\u2026) on channels that broadcast in English, so LTTV can switch
// to an English source for them or say plainly that only foreign text exists.
import type { LineupChannel, Programme } from './types';

/** Countries whose channels broadcast in English. */
export const ENGLISH_COUNTRIES = new Set(['us', 'uk', 'ca', 'au', 'ie', 'nz']);

// Letters outside the Latin alphabet (Greek, Cyrillic, Armenian, Hebrew, Arabic, Indic, Thai, CJK, Hangul\u2026).
const FOREIGN = /[\u0370-\u03ff\u0400-\u052f\u0530-\u058f\u0590-\u05ff\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\u0900-\u0dff\u0e00-\u0e7f\u1100-\u11ff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\ufb50-\ufdff\ufe70-\ufeff]/g;
const LATIN = /[A-Za-z\u00c0-\u024f]/g;

/** Mostly written in a non-Latin script. */
export function isForeignScript(text: string | undefined): boolean {
  if (!text) return false;
  const f = text.match(FOREIGN)?.length ?? 0;
  if (!f) return false;
  const l = text.match(LATIN)?.length ?? 0;
  return f > l;
}

/** The channel broadcasts in English (by its country). */
export function expectsEnglish(ch: Pick<LineupChannel, 'country'>): boolean {
  return !!ch.country && ENGLISH_COUNTRIES.has(ch.country);
}

/** Most of these programmes have foreign-script titles. */
export function mostlyForeign(list: Programme[]): boolean {
  if (!list.length) return false;
  let n = 0;
  for (const p of list) if (isForeignScript(p.title) || (!p.title.trim() && isForeignScript(p.desc))) n++;
  return n * 2 > list.length;
}

/** The programme text can't be shown as English (foreign script on an English channel). */
export function foreignOnEnglish(p: Pick<Programme, 'title' | 'desc'>, ch: Pick<LineupChannel, 'country'> | undefined): boolean {
  return !!ch && expectsEnglish(ch) && (isForeignScript(p.title) || isForeignScript(p.desc));
}

/** Name of the script a text is written in, for messages ("Arabic"). */
export function scriptName(text: string | undefined): string {
  const t = text ?? '';
  if (/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/.test(t)) return 'Arabic';
  if (/[\u0590-\u05ff]/.test(t)) return 'Hebrew';
  if (/[\u0400-\u052f]/.test(t)) return 'Cyrillic';
  if (/[\u0370-\u03ff]/.test(t)) return 'Greek';
  if (/[\u0900-\u0dff]/.test(t)) return 'an Indian script';
  if (/[\u0e00-\u0e7f]/.test(t)) return 'Thai';
  if (/[\u3040-\u30ff]/.test(t)) return 'Japanese';
  if (/[\uac00-\ud7af\u1100-\u11ff]/.test(t)) return 'Korean';
  if (/[\u3400-\u4dbf\u4e00-\u9fff]/.test(t)) return 'Chinese';
  return 'another language';
}
