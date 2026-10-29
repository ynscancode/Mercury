/**
 * One-line capture: turning "IB report, Fri 5pm, ~3h, #school" into a task.
 *
 * Rule-based and deliberately so — this is the path that must work with no
 * API key, no network and no model. AI fill layers on top of whatever this
 * understood and is forbidden from overwriting it.
 *
 * Ported from the artifact, with dates handled as `YYYY-MM-DD` strings
 * throughout so the parser is timezone-free: "Friday" means the same calendar
 * day whether it is resolved on a phone or in a UTC function.
 */
import type { Category, DateStr, TimeStr } from './types';
import { addDays, daysBetween } from './zone';

const DOWS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const MONS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const SIZE_WORDS =
  /(\d+)\s*(slides?|pages?|words?|questions?|qns?|chapters?|readings?|problems?|cases?)\b/i;

export interface CaptureResult {
  title: string;
  due: DateStr | null;
  dueTime: TimeStr | null;
  estMin: number | null;
  categoryId: string | null;
  notes: string[];
  /** Which fields the text actually stated, as opposed to being defaulted. */
  found: {
    due: boolean;
    time: boolean;
    est: boolean;
    category: boolean;
    size: boolean;
  };
  /** The matched size phrase, e.g. "40 slides". A hint, not an estimate. */
  size: string | null;
  raw: string;
}

const EMPTY_FOUND = {
  due: false,
  time: false,
  est: false,
  category: false,
  size: false,
};

/** Day of week for a calendar date, 0 = Sunday. No zone needed. */
export function dowOf(date: DateStr): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The next occurrence of a weekday.
 *
 * `next` means the one in the following ISO week, so "next Friday" said on a
 * Friday is eight days away rather than seven. A bare weekday never means
 * today: "Friday" on a Friday is the Friday coming.
 */
export function nextDow(
  target: number,
  mode: '' | 'this' | 'next',
  base: DateStr,
): DateStr {
  const cur = dowOf(base);
  if (mode === 'next') {
    const iso = (d: number) => (d + 6) % 7;
    const nextMonday = addDays(base, 7 - iso(cur));
    return addDays(nextMonday, iso(target));
  }
  let delta = (target - cur + 7) % 7;
  if (delta === 0 && mode !== 'this') delta = 7;
  return addDays(base, delta);
}

/**
 * Build a date from a day and month, inferring the year. A date more than a
 * month in the past is read as next year — "3 Jan" said in December means the
 * January coming, not the one gone.
 */
export function makeDate(
  day: number,
  month: number,
  year: number | null,
  base: DateStr,
): DateStr | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const baseYear = Number(base.slice(0, 4));
  let y = year == null ? baseYear : year < 100 ? 2000 + year : year;
  const valid = (yy: number): DateStr | null => {
    const probe = new Date(Date.UTC(yy, month, day));
    if (probe.getUTCMonth() !== month || probe.getUTCDate() !== day)
      return null;
    return `${String(yy).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  let out = valid(y);
  if (out && year == null && daysBetween(base, out) < -30) {
    y += 1;
    out = valid(y);
  }
  return out;
}

type Detail =
  | { len: number; kind: 'date'; value: DateStr }
  | { len: number; kind: 'time'; value: TimeStr }
  | { len: number; kind: 'est'; value: number }
  | { len: number; kind: 'cat'; value: string };

interface MatchCtx {
  today: DateStr;
  categories: readonly Category[];
  /** Looser rules inside trailing segments, where `1730` means a time. */
  loose: boolean;
}

const hhmm = (h: number, m: number): TimeStr =>
  `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/** Try to read one detail starting at token `i`. */
export function matchAt(
  tk: readonly string[],
  i: number,
  ctx: MatchCtx,
): Detail | null {
  const a = (tk[i] ?? '').toLowerCase().replace(/[.!]+$/, '');
  const b = (tk[i + 1] ?? '').toLowerCase();
  const c = (tk[i + 2] ?? '').toLowerCase();
  const base = ctx.today;
  let m: RegExpMatchArray | null;

  // Leading prepositions just introduce the real detail.
  if (
    ['due', 'by', 'before', 'on', 'at', '~'].includes(a) &&
    tk[i + 1] != null
  ) {
    const r = matchAt(tk, i + 1, ctx);
    if (r) return { ...r, len: r.len + 1 };
  }

  if (['today', 'tdy', 'tonight'].includes(a))
    return { len: 1, kind: 'date', value: base };
  if (['tomorrow', 'tmr', 'tml', 'tmrw', 'tmw', 'tomorow'].includes(a)) {
    return { len: 1, kind: 'date', value: addDays(base, 1) };
  }
  if ((a === 'this' || a === 'next') && DOWS[b] != null) {
    return { len: 2, kind: 'date', value: nextDow(DOWS[b]!, a, base) };
  }
  if (DOWS[a] != null)
    return { len: 1, kind: 'date', value: nextDow(DOWS[a]!, '', base) };
  if (a === 'in' && /^\d+$/.test(b) && /^(days?|weeks?)$/.test(c)) {
    return {
      len: 3,
      kind: 'date',
      value: addDays(base, Number(b) * (c[0] === 'w' ? 7 : 1)),
    };
  }
  if ((m = a.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/))) {
    const d = makeDate(
      Number(m[1]),
      Number(m[2]) - 1,
      m[3] ? Number(m[3]) : null,
      base,
    );
    if (d) return { len: 1, kind: 'date', value: d };
  }
  if ((m = a.match(/^(\d{1,2})([a-z]{3,9})$/)) && MONS[m[2]!] != null) {
    const d = makeDate(Number(m[1]), MONS[m[2]!]!, null, base);
    if (d) return { len: 1, kind: 'date', value: d };
  }
  if (/^\d{1,2}(st|nd|rd|th)?$/.test(a) && MONS[b] != null) {
    const d = makeDate(parseInt(a, 10), MONS[b]!, null, base);
    if (d) return { len: 2, kind: 'date', value: d };
  }
  if (MONS[a] != null && /^\d{1,2}(st|nd|rd|th)?$/.test(b)) {
    const d = makeDate(parseInt(b, 10), MONS[a]!, null, base);
    if (d) return { len: 2, kind: 'date', value: d };
  }

  const cw = categoryByWords(a.replace(/^#/, ''), b, ctx.categories);
  if (cw) return { len: cw.len, kind: 'cat', value: cw.id };

  if (a === 'noon') return { len: 1, kind: 'time', value: '12:00' };
  if (a === 'midnight' || a === 'eod')
    return { len: 1, kind: 'time', value: '23:59' };
  if ((m = a.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/))) {
    const h = (Number(m[1]) % 12) + (m[3] === 'pm' ? 12 : 0);
    if (Number(m[1]) <= 12 && (!m[2] || Number(m[2]) < 60)) {
      return { len: 1, kind: 'time', value: hhmm(h, Number(m[2] ?? 0)) };
    }
  }
  if ((m = a.match(/^(\d{1,2})(?::(\d{2}))?$/)) && (b === 'am' || b === 'pm')) {
    const h = (Number(m[1]) % 12) + (b === 'pm' ? 12 : 0);
    if (Number(m[1]) <= 12)
      return { len: 2, kind: 'time', value: hhmm(h, Number(m[2] ?? 0)) };
  }
  if ((m = a.match(/^([01]?\d|2[0-3]):([0-5]\d)$/))) {
    return { len: 1, kind: 'time', value: hhmm(Number(m[1]), Number(m[2])) };
  }
  if (ctx.loose && (m = a.match(/^([01]\d|2[0-3])([0-5]\d)$/))) {
    return { len: 1, kind: 'time', value: hhmm(Number(m[1]), Number(m[2])) };
  }

  if ((m = a.match(/^~?(\d+(?:\.\d+)?)(h|hr|hrs|hour|hours)$/))) {
    return { len: 1, kind: 'est', value: Math.round(Number(m[1]) * 60) };
  }
  if ((m = a.match(/^~?(\d+)h(\d{1,2})m?$/))) {
    return { len: 1, kind: 'est', value: Number(m[1]) * 60 + Number(m[2]) };
  }
  if ((m = a.match(/^~?(\d+)(m|min|mins|minutes)$/))) {
    return { len: 1, kind: 'est', value: Number(m[1]) };
  }
  if (
    (m = a.match(/^~?(\d+(?:\.\d+)?)$/)) &&
    /^(h|hr|hrs|hour|hours)$/.test(b)
  ) {
    return { len: 2, kind: 'est', value: Math.round(Number(m[1]) * 60) };
  }
  if ((m = a.match(/^~?(\d+)$/)) && /^(m|min|mins|minutes)$/.test(b)) {
    return { len: 2, kind: 'est', value: Number(m[1]) };
  }
  return null;
}

function categoryByWords(
  a: string,
  b: string,
  categories: readonly Category[],
): { id: string; len: number } | null {
  const exact = categories.find(
    (c) => c.name.toLowerCase() === a || c.id.toLowerCase() === a,
  );
  if (exact) return { id: exact.id, len: 1 };
  if (b) {
    const two = categories.find((c) => c.name.toLowerCase() === `${a} ${b}`);
    if (two) return { id: two.id, len: 2 };
  }
  if (a.length >= 4) {
    const prefix = categories.find((c) => c.name.toLowerCase().startsWith(a));
    if (prefix) return { id: prefix.id, len: 1 };
  }
  return null;
}

function categoryFromTag(
  tag: string,
  categories: readonly Category[],
): Category | undefined {
  const t = tag.toLowerCase();
  return (
    categories.find(
      (c) => c.id.toLowerCase() === t || c.name.toLowerCase() === t,
    ) ??
    categories.find(
      (c) =>
        c.name.toLowerCase().startsWith(t) ||
        t.startsWith(c.name.toLowerCase()),
    )
  );
}

function applyDetail(res: CaptureResult, d: Detail): void {
  if (d.kind === 'date' && !res.due) {
    res.due = d.value;
    res.found.due = true;
  } else if (d.kind === 'time' && !res.dueTime) {
    res.dueTime = d.value;
    res.found.time = true;
  } else if (d.kind === 'est' && res.estMin == null) {
    res.estMin = d.value;
    res.found.est = true;
  } else if (d.kind === 'cat' && !res.categoryId) {
    res.categoryId = d.value;
    res.found.category = true;
  }
}

export function parseCapture(
  raw: string,
  categories: readonly Category[],
  today: DateStr,
  nowTime: TimeStr = '00:00',
): CaptureResult {
  const res: CaptureResult = {
    title: '',
    due: null,
    dueTime: null,
    estMin: null,
    categoryId: null,
    notes: [],
    found: { ...EMPTY_FOUND },
    size: null,
    raw: raw ?? '',
  };
  let text = (raw ?? '').trim();
  if (!text) return res;

  // #tags are category hints wherever they appear.
  text = text.replace(
    /(^|\s)#([A-Za-z][\w-]*)/g,
    (_all, space: string, tag: string) => {
      const c = categoryFromTag(tag, categories);
      if (c && !res.categoryId) {
        res.categoryId = c.id;
        res.found.category = true;
      }
      return space;
    },
  );

  // Everything after a comma or semicolon is detail, not title.
  const segs = text.split(/\s*[,;]\s*/).filter(Boolean);
  let head = segs.shift() ?? '';
  const dm = head.match(/\s+(?:due|by|before)\s+(.+)$/i);
  if (dm && dm.index != null) {
    segs.unshift(dm[1]!);
    head = head.slice(0, dm.index);
  }

  for (const seg of segs) {
    const tk = seg.split(/\s+/);
    const left: string[] = [];
    for (let i = 0; i < tk.length;) {
      const r = matchAt(tk, i, { today, categories, loose: true });
      if (r) {
        applyDetail(res, r);
        i += r.len;
      } else {
        left.push(tk[i]!);
        i++;
      }
    }
    if (left.length) res.notes.push(left.join(' '));
  }

  // Peel details off the end of the title, longest match first.
  let tk = head.split(/\s+/).filter(Boolean);
  for (let guard = 0; guard < 8 && tk.length > 1; guard++) {
    let hit: Detail | null = null;
    for (let len = Math.min(3, tk.length - 1); len >= 1; len--) {
      const r = matchAt(tk, tk.length - len, {
        today,
        categories,
        loose: false,
      });
      if (r && r.len === len) {
        hit = r;
        break;
      }
    }
    if (!hit) break;
    // "Email to work" is not a category — a preposition before it means the
    // word belongs to the title.
    if (
      hit.kind === 'cat' &&
      /^(to|for|at|in|from|of|with|after|before|the|my|a)$/i.test(
        tk[tk.length - hit.len - 1] ?? '',
      )
    ) {
      break;
    }
    applyDetail(res, hit);
    tk = tk.slice(0, tk.length - hit.len);
  }

  const sz = (raw ?? '').match(SIZE_WORDS);
  if (sz) {
    res.found.size = true;
    res.size = sz[0];
  }

  const title = tk
    .join(' ')
    .replace(/\s+(due|by|before|at|on)$/i, '')
    .trim();
  res.title = title ? title[0]!.toUpperCase() + title.slice(1) : '';

  // A bare time means today if it is still ahead, otherwise tomorrow.
  if (res.dueTime && !res.due) {
    res.due = res.dueTime > nowTime ? today : addDays(today, 1);
  }
  if (res.due && !res.dueTime) res.dueTime = '23:59';
  return res;
}
