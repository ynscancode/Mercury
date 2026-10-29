/** Human-readable durations, dates and relative times. Pure and zone-aware. */
import type { DateStr, Instant } from './types';
import { dayOfWeek, daysBetween, instantToDate, instantToTime } from './zone';

export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const DOW_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
export const MONTH = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;
export const MONTH_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** `90` → `1h 30m`. Rounds, never shows a bare `0m` for a positive value. */
export function fmtDur(min: number): string {
  const m = Math.max(0, Math.round(min || 0));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

/** `3661` → `1:01:01`. For a running timer, where seconds matter. */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${pad(m)}:${pad(s % 60)}`;
}

/** Coarse distance, for countdowns: `45m`, `3h 20m`, `2d 4h`. */
export function countdown(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return h + 'h' + (m % 60 ? ` ${m % 60}m` : '');
  const d = Math.floor(h / 24);
  return d + 'd' + (h % 24 ? ` ${h % 24}h` : '');
}

/** `Thu 5 Mar` */
export function fmtDay(date: DateStr, tz: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  void tz;
  return `${DOW[dow]} ${d} ${MONTH[m - 1]}`;
}

/** Wall-clock time of an instant: `17:30`. */
export const fmtTime = instantToTime;

/** `today`, `tomorrow`, `3 days ago`, else `Thu 5 Mar`. */
export function relDay(date: DateStr, today: DateStr, tz: string): string {
  const n = daysBetween(today, date);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n < 0) return `${-n} days ago`;
  return fmtDay(date, tz);
}

/**
 * A deadline as a person would say it: `today 17:00`, `tomorrow`, `Fri 09:00`.
 * The time is dropped when it is the end-of-day default, which carries no
 * information and only adds noise.
 */
export function relDue(ms: Instant, now: Instant, tz: string): string {
  const date = instantToDate(ms, tz);
  const time = instantToTime(ms, tz);
  const suffix = time === '23:59' ? '' : ` ${time}`;
  const n = daysBetween(instantToDate(now, tz), date);
  if (n === 0) return `today${suffix}`;
  if (n === 1) return `tomorrow${suffix}`;
  if (n === -1) return `yesterday${suffix}`;
  if (n > 1 && n < 7) return `${DOW[dayOfWeek(ms, tz)]}${suffix}`;
  return `${fmtDay(date, tz)}${suffix}`;
}

/** Compact form for chips: `Today 17:00`, `Tmr 09:00`, `5 Mar 09:00`. */
export function shortWhen(ms: Instant, now: Instant, tz: string): string {
  const date = instantToDate(ms, tz);
  const time = instantToTime(ms, tz);
  const n = daysBetween(instantToDate(now, tz), date);
  if (n === 0) return `Today ${time}`;
  if (n === 1) return `Tmr ${time}`;
  if (n === -1) return `Yest ${time}`;
  if (n > 1 && n < 7) return `${DOW[dayOfWeek(ms, tz)]} ${time}`;
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTH[m - 1]} ${time}`;
}

export const pct = (x: number | null): string =>
  x == null ? '—' : `${Math.round(x * 100)}%`;

export const ratio = (x: number | null): string =>
  x == null ? '—' : `${x.toFixed(2)}×`;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
