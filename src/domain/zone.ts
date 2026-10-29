/**
 * Wall-clock ↔ instant conversion against an IANA timezone.
 *
 * The artifact used the browser's local timezone implicitly, which is correct
 * on a phone and wrong in a scheduled function running in UTC: "due Friday"
 * would resolve to a different instant on the server than in the UI, and the
 * notification engine would fire against the wrong boundary. Passing the zone
 * explicitly removes that whole class of bug.
 */
import type { DateStr, Instant, TimeStr } from './types';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isDateStr(v: unknown): v is DateStr {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Reject 31 February and friends by round-tripping through UTC.
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function isTimeStr(v: unknown): v is TimeStr {
  return typeof v === 'string' && TIME_RE.test(v);
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

function partsIn(ms: Instant, tz: string): Parts {
  const out: Record<string, number> = {};
  for (const p of formatterFor(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year ?? 1970,
    month: out.month ?? 1,
    day: out.day ?? 1,
    // Some engines report midnight as hour 24 under h23; normalise it.
    hour: (out.hour ?? 0) % 24,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

/** Offset of `tz` at this instant, in ms (positive east of Greenwich). */
function offsetAt(ms: Instant, tz: string): number {
  const p = partsIn(ms, tz);
  const asUTC = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUTC - ms;
}

/**
 * The instant at which the given wall-clock time occurs in `tz`.
 *
 * Two passes: guess using the offset at the naive instant, then correct using
 * the offset at the guessed instant. That second pass is what makes the
 * function right across a daylight-saving transition.
 */
export function wallToInstant(
  date: DateStr,
  time: TimeStr,
  tz: string,
): Instant {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const first = naive - offsetAt(naive, tz);
  return naive - offsetAt(first, tz);
}

/** The calendar date on which this instant falls in `tz`. */
export function instantToDate(ms: Instant, tz: string): DateStr {
  const p = partsIn(ms, tz);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The wall-clock time of day of this instant in `tz`. */
export function instantToTime(ms: Instant, tz: string): TimeStr {
  const p = partsIn(ms, tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Day of week in `tz`, 0 = Sunday. */
export function dayOfWeek(ms: Instant, tz: string): number {
  const p = partsIn(ms, tz);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** Midnight that begins the given date in `tz`. */
export function startOfDay(date: DateStr, tz: string): Instant {
  return wallToInstant(date, '00:00', tz);
}

/** `date` shifted by `n` calendar days. Pure string maths — no zone needed. */
export function addDays(date: DateStr, n: number): DateStr {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + n));
  return `${String(shifted.getUTCFullYear()).padStart(4, '0')}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

/** Whole calendar days from `a` to `b`, positive when `b` is later. */
export function daysBetween(a: DateStr, b: DateStr): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
}
