// Adult (XXX) channels and movie/show categories are left out of LTTV entirely: guide, channels, search,
// Sports, Dual view and Movies & Shows. Careful with names that only look adult: Adult Swim, "adult contemporary".
const ADULT = /(\bxxx\b|\b18\s?\+|\b\+\s?18\b|\badults?\s*only\b|\bfor adults\b|\bporn|\bpr0n\b|\berotic|\bplayboy\b|\bhustler\b|\bbrazzers\b|\bdorcel\b|\bpenthouse\b|\bredlight\b|\bred light\b|\bvivid\b|\bsexy?\b|\bxxl tv\b|\bblue hustler\b|\bpink o\b|\bnaughty\b|\bnsfw\b|\bonlyfans\b|\bhentai\b|\bmilf\b)/i;
const ADULT_WORD = /\badults?\b(?!\s*(swim|contemporary|education|ed\b|learning|animation|cartoons?))/i;

/** A channel group / category / channel name that is adult content. */
export function isAdult(text: string | undefined): boolean {
  if (!text) return false;
  const t = text.normalize('NFKC');
  return ADULT.test(t) || ADULT_WORD.test(t);
}

/** A channel whose group or name is adult content. */
export function isAdultChannel(group: string | undefined, name: string | undefined): boolean {
  return isAdult(group) || isAdult(name);
}
