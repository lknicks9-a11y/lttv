import type { EpgChannel, Programme } from './types';
import { isForeignScript } from './lang';
import { parseXmltvTime, type NaiveTimePolicy } from './time';

/** Decode the XML entities that appear in XMLTV files. */
export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e: string) => {
    const l = e.toLowerCase();
    if (l === 'amp') return '&';
    if (l === 'lt') return '<';
    if (l === 'gt') return '>';
    if (l === 'quot') return '"';
    if (l === 'apos') return "'";
    if (l === 'nbsp') return ' ';
    const code = l.startsWith('#x') ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m;
    try {
      return String.fromCodePoint(code);
    } catch {
      return m;
    }
  });
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
  return out;
}

function text(inner: string): string {
  let s = inner;
  if (s.indexOf('<![CDATA[') >= 0) s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, c: string) => c.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
  s = s.replace(/<[^>]+>/g, ' ');
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

interface Child {
  tag: string;
  attrs: Record<string, string>;
  inner: string;
}

/** Iterate direct children of an element body (one level, tolerant). */
function children(body: string): Child[] {
  const out: Child[] = [];
  const re = /<([A-Za-z][\w:-]*)((?:\s+[^>]*?)?)\s*(\/>|>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const tag = m[1];
    const attrs = parseAttrs(m[2] || '');
    if (m[3] === '/>') {
      out.push({ tag, attrs, inner: '' });
      continue;
    }
    const close = `</${tag}>`;
    // Handle nesting of the same tag name (rare) by counting.
    let depth = 1;
    let pos = re.lastIndex;
    let end = -1;
    while (depth > 0) {
      const nextClose = body.indexOf(close, pos);
      if (nextClose < 0) break;
      const nextOpen = body.indexOf(`<${tag}`, pos);
      if (nextOpen >= 0 && nextOpen < nextClose && /[\s>/]/.test(body[nextOpen + tag.length + 1] || '')) {
        depth++;
        pos = nextOpen + tag.length + 1;
      } else {
        depth--;
        pos = nextClose + close.length;
        if (depth === 0) end = nextClose;
      }
    }
    if (end < 0) {
      // Unclosed element: take the rest as text and stop.
      out.push({ tag, attrs, inner: body.slice(re.lastIndex) });
      break;
    }
    out.push({ tag, attrs, inner: body.slice(re.lastIndex, end) });
    re.lastIndex = end + close.length;
  }
  return out;
}

/** Turn xmltv_ns ("1.4.0/1") / onscreen ("S02E05") episode numbers into "S2 E5". */
export function formatEpisode(system: string | undefined, value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (system === 'xmltv_ns') {
    const [s, e, p] = v.split('.').map((x) => x.trim());
    const num = (x: string | undefined) => {
      if (!x) return undefined;
      const n = parseInt(x.split('/')[0], 10);
      return Number.isFinite(n) ? n + 1 : undefined;
    };
    const sn = num(s), en = num(e);
    const parts: string[] = [];
    if (sn) parts.push(`S${sn}`);
    if (en) parts.push(`E${en}`);
    const pn = p ? parseInt(p.split('/')[0], 10) : NaN;
    const pt = p && p.includes('/') ? parseInt(p.split('/')[1], 10) : NaN;
    if (Number.isFinite(pn) && Number.isFinite(pt) && pt > 1) parts.push(`Part ${pn + 1}/${pt}`);
    return parts.length ? parts.join(' ') : undefined;
  }
  const m = /S(\d+)\s*[.:]?\s*E(\d+)/i.exec(v);
  if (m) return `S${+m[1]} E${+m[2]}`;
  if (system === 'dd_progid' || system === 'thetvdb.com' || system === 'imdb.com') return undefined;
  return v.length <= 24 ? v : undefined;
}

export interface XmltvParserOptions {
  policy?: NaiveTimePolicy;
  /** Drop programmes that end before this instant (UTC ms). */
  minStop?: number;
  /** Drop programmes that start after this instant (UTC ms). */
  maxStart?: number;
  /** Preferred language for titles/descriptions (e.g. "en"). First available otherwise. */
  lang?: string;
  /** Max description length kept (memory guard on low-end devices). */
  maxDescLength?: number;
  onChannel?: (c: EpgChannel) => void;
  onProgramme?: (p: Programme) => void;
}

export interface XmltvStats {
  channels: number;
  programmes: number;
  droppedOutOfWindow: number;
  invalid: number;
  bytes: number;
  sawTvRoot: boolean;
}

/**
 * Incremental XMLTV parser. Feed it text chunks of any size with `push()`;
 * complete <channel> and <programme> elements are emitted as soon as they
 * are available, so memory use stays proportional to one element, not the
 * whole file. Works the same in browsers, Web Workers and Node.
 */
export class XmltvParser {
  private buf = '';
  private pos = 0;
  readonly stats: XmltvStats = { channels: 0, programmes: 0, droppedOutOfWindow: 0, invalid: 0, bytes: 0, sawTvRoot: false };
  private checkedStart = false;

  constructor(private sourceId: string, private opts: XmltvParserOptions = {}) {}

  push(chunk: string): void {
    this.stats.bytes += chunk.length;
    this.buf = this.pos > 0 ? this.buf.slice(this.pos) + chunk : this.buf + chunk;
    this.pos = 0;
    if (!this.checkedStart && this.buf.length > 512) this.checkStart();
    this.drain(false);
  }

  end(): XmltvStats {
    if (!this.checkedStart) this.checkStart();
    this.drain(true);
    this.buf = '';
    if (!this.stats.sawTvRoot && this.stats.channels === 0 && this.stats.programmes === 0) {
      throw new Error('This file does not contain XMLTV guide data (no <tv> element found).');
    }
    return this.stats;
  }

  private checkStart() {
    this.checkedStart = true;
    const head = this.buf.slice(0, 2048).trimStart();
    if (/^#EXTM3U/i.test(head)) throw new Error('This looks like an M3U playlist, not an XMLTV guide.');
    if (/^<!doctype html|^<html/i.test(head)) throw new Error('The guide URL returned a web page (HTML) instead of XMLTV data.');
    if (/<tv[\s>]/.test(this.buf.slice(0, 4096))) this.stats.sawTvRoot = true;
  }

  /** Find the next element of interest. `wait` = an incomplete construct starts at that index. */
  private nextStart(from: number): { idx: number; kind: 'channel' | 'programme' } | { wait: number } | null {
    let i = from;
    for (;;) {
      const lt = this.buf.indexOf('<', i);
      if (lt < 0) return null;
      const c1 = this.buf.charCodeAt(lt + 1);
      // fast path: 'c' or 'p'
      if (c1 === 99 /* c */ && this.buf.startsWith('channel', lt + 1)) {
        const nc = this.buf[lt + 8];
        if (nc === undefined) return { idx: lt, kind: 'channel' }; // incomplete, wait
        if (nc === ' ' || nc === '>' || nc === '\t' || nc === '\n' || nc === '\r') return { idx: lt, kind: 'channel' };
      } else if (c1 === 112 /* p */ && this.buf.startsWith('programme', lt + 1)) {
        const nc = this.buf[lt + 10];
        if (nc === undefined) return { idx: lt, kind: 'programme' };
        if (nc === ' ' || nc === '>' || nc === '\t' || nc === '\n' || nc === '\r') return { idx: lt, kind: 'programme' };
      } else if (c1 === 116 /* t */ && !this.stats.sawTvRoot && /^<tv[\s>]/.test(this.buf.slice(lt, lt + 4))) {
        this.stats.sawTvRoot = true;
      } else if (c1 === 33 /* ! */ && this.buf.startsWith('<!--', lt)) {
        const endC = this.buf.indexOf('-->', lt + 4);
        if (endC < 0) return { wait: lt }; // wait for the rest of the comment
        i = endC + 3;
        continue;
      }
      if (lt + 12 > this.buf.length) return { wait: lt }; // possibly a truncated tag name
      i = lt + 1;
    }
  }

  private drain(final: boolean) {
    for (;;) {
      const found = this.nextStart(this.pos);
      if (found && 'wait' in found) {
        this.pos = found.wait;
        return;
      }
      const start = found;
      if (!start) {
        if (this.pos === 0) {
          // Nothing interesting in buffer; keep only a small tail.
          const keep = Math.min(this.buf.length, 16);
          this.pos = this.buf.length - keep;
          const lt = this.buf.lastIndexOf('<');
          if (lt >= 0 && lt >= this.buf.length - 16) this.pos = lt;
        }
        return;
      }
      const closeTag = start.kind === 'channel' ? '</channel>' : '</programme>';
      const gt = this.buf.indexOf('>', start.idx);
      if (gt < 0) {
        this.pos = start.idx;
        return;
      }
      let endIdx: number;
      let body: string;
      const openTag = this.buf.slice(start.idx, gt + 1);
      if (this.buf[gt - 1] === '/') {
        endIdx = gt + 1;
        body = '';
      } else {
        const close = this.buf.indexOf(closeTag, gt);
        if (close < 0) {
          this.pos = start.idx;
          if (final) this.stats.invalid++;
          return;
        }
        endIdx = close + closeTag.length;
        body = this.buf.slice(gt + 1, close);
      }
      const attrStr = openTag.slice(start.kind === 'channel' ? 8 : 10, openTag.endsWith('/>') ? -2 : -1);
      try {
        if (start.kind === 'channel') this.handleChannel(parseAttrs(attrStr), body);
        else this.handleProgramme(parseAttrs(attrStr), body);
      } catch {
        this.stats.invalid++;
      }
      this.pos = endIdx;
    }
  }

  /**
   * One of several language versions of a title/description: the preferred language
   * (English unless set otherwise), else one written in the Latin alphabet, else the first.
   */
  private pick(nodes: Child[]): Child | undefined {
    if (nodes.length <= 1) return nodes[0];
    const want = (this.opts.lang ?? 'en').toLowerCase();
    if (want) {
      const hit = nodes.find((n) => (n.attrs.lang || '').toLowerCase().startsWith(want));
      if (hit) return hit;
    }
    return nodes.find((n) => !isForeignScript(text(n.inner))) ?? nodes[0];
  }

  private handleChannel(attrs: Record<string, string>, body: string) {
    const id = (attrs.id || '').trim();
    if (!id) {
      this.stats.invalid++;
      return;
    }
    const kids = children(body);
    const names = kids.filter((k) => k.tag === 'display-name').map((k) => text(k.inner)).filter(Boolean);
    const icon = kids.find((k) => k.tag === 'icon')?.attrs.src;
    this.stats.channels++;
    this.opts.onChannel?.({ id, sourceId: this.sourceId, displayNames: [...new Set(names)], icon: icon || undefined });
  }

  private handleProgramme(attrs: Record<string, string>, body: string) {
    const ch = (attrs.channel || '').trim();
    const policy = this.opts.policy ?? { mode: 'utc' };
    const start = parseXmltvTime(attrs.start, policy);
    let stop = parseXmltvTime(attrs.stop, policy);
    if (!ch || !Number.isFinite(start)) {
      this.stats.invalid++;
      return;
    }
    if (!Number.isFinite(stop) || stop <= start) stop = NaN; // fixed later from the next programme
    if (Number.isFinite(stop) && this.opts.minStop !== undefined && stop < this.opts.minStop) {
      this.stats.droppedOutOfWindow++;
      return;
    }
    if (this.opts.maxStart !== undefined && start > this.opts.maxStart) {
      this.stats.droppedOutOfWindow++;
      return;
    }
    const kids = children(body);
    const by = (t: string) => kids.filter((k) => k.tag === t);
    const title = text(this.pick(by('title'))?.inner ?? '') || 'Untitled';
    const sub = text(this.pick(by('sub-title'))?.inner ?? '') || undefined;
    let desc = text(this.pick(by('desc'))?.inner ?? '') || undefined;
    const max = this.opts.maxDescLength ?? 1200;
    if (desc && desc.length > max) desc = desc.slice(0, max - 1).trimEnd() + '…';
    const catNodes = by('category');
    // Prefer the English set of categories when they come in several languages.
    const enCats = catNodes.filter((k) => /^en/i.test(k.attrs.lang || ''));
    const cats = [...new Set((enCats.length ? enCats : catNodes).map((k) => text(k.inner)).filter(Boolean))];
    let episode: string | undefined;
    const eps = by('episode-num');
    for (const sys of ['onscreen', 'xmltv_ns', undefined]) {
      const e = eps.find((k) => (sys ? k.attrs.system === sys : true));
      if (e) {
        episode = formatEpisode(e.attrs.system, text(e.inner));
        if (episode) break;
      }
    }
    const ratingNode = by('rating')[0];
    const rating = ratingNode ? text(children(ratingNode.inner).find((k) => k.tag === 'value')?.inner ?? '') || undefined : undefined;
    const p: Programme = { ch, start, stop, title };
    if (sub) p.subTitle = sub;
    if (desc) p.desc = desc;
    if (cats.length) p.categories = cats;
    if (episode) p.episode = episode;
    const date = text(by('date')[0]?.inner ?? '');
    if (date) p.date = date;
    if (rating) p.rating = rating;
    const icon = by('icon')[0]?.attrs.src;
    if (icon) p.icon = icon;
    if (by('new').length) p.isNew = true;
    if (by('live').length) p.live = true;
    this.stats.programmes++;
    this.opts.onProgramme?.(p);
  }
}

/**
 * Sort a channel's programmes, fill missing stop times from the next start,
 * clip overlaps and drop exact duplicates. Returns a new array.
 */
export function normalizeSchedule(list: Programme[], defaultDurationMs = 30 * 60_000): Programme[] {
  const sorted = [...list].sort((a, b) => a.start - b.start || (a.stop || 0) - (b.stop || 0));
  const out: Programme[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = { ...sorted[i] };
    const next = sorted[i + 1];
    if (!Number.isFinite(p.stop)) p.stop = next && next.start > p.start ? next.start : p.start + defaultDurationMs;
    const prev = out[out.length - 1];
    if (prev) {
      if (prev.start === p.start && prev.title === p.title) continue; // duplicate
      if (prev.stop > p.start) {
        if (p.start > prev.start) prev.stop = p.start; // clip previous
        else continue;
      }
    }
    if (p.stop > p.start) out.push(p);
  }
  return out;
}

/** Convenience: parse a full XMLTV string in one go (tests / small files). */
export function parseXmltv(xml: string, sourceId: string, opts: Omit<XmltvParserOptions, 'onChannel' | 'onProgramme'> = {}) {
  const channels: EpgChannel[] = [];
  const programmes: Programme[] = [];
  const parser = new XmltvParser(sourceId, { ...opts, onChannel: (c) => channels.push(c), onProgramme: (p) => programmes.push(p) });
  parser.push(xml);
  const stats = parser.end();
  return { channels, programmes, stats };
}
