/**
 * The capacity model (plan section 2.9).
 *
 * Two ideas drive everything here:
 *
 *   1. An event does not necessarily block all of its own time. A nine-hour
 *      workday still contains usable task time; a thirty-minute meeting does
 *      not. Each event carries the fraction of itself that stays usable.
 *
 *   2. Capacity is not schedulability. A porous event yields usable *minutes*
 *      but no usable *block*, because nothing records which parts of it are
 *      free. So porous time counts toward "are there enough hours" and never
 *      toward "here is exactly when" — otherwise the app would offer you a
 *      slot in the middle of a meeting.
 *
 * Sleep is handled as reserve rather than absence: night hours are real time
 * you can choose to spend, so they are measured, but they are never folded
 * into ordinary capacity.
 */
import type {
  CalEvent,
  CalendarAccount,
  DateStr,
  EngineContext,
  Instant,
  Settings,
} from './types';
import { addDays, instantToDate, wallToInstant } from './zone';

const MIN = 60_000;

/** A stretch of time and how much of it is available for task work. */
export interface Segment {
  start: Instant;
  end: Instant;
  /** 0 = entirely blocked, 1 = entirely free. */
  available: number;
}

/**
 * How much of an event remains usable: a per-event override first, then the
 * calendar's default, then the heuristic that long events are containers
 * rather than appointments.
 */
export function resolveUsableFraction(
  ev: CalEvent,
  account: CalendarAccount | undefined,
  s: Settings,
): number {
  if (!ev.busy) return 1;
  if (ev.usableFraction != null) return clamp01(ev.usableFraction);
  if (account?.defaultUsableFraction != null) {
    return clamp01(account.defaultUsableFraction);
  }
  if (ev.allDay) return clamp01(s.alldayUsable);
  const hours = eventLengthMs(ev) / 3_600_000;
  return hours >= s.longEventHours ? clamp01(s.longEventUsable) : 0;
}

/** Event bounds as instants, with all-day end dates treated as exclusive. */
export function eventBounds(
  ev: CalEvent,
  tz: string,
): { start: Instant; end: Instant } | null {
  if (ev.allDay) {
    if (!ev.startDate) return null;
    const endExclusive =
      ev.endDate && ev.endDate > ev.startDate
        ? ev.endDate
        : addDays(ev.startDate, 1);
    return {
      start: wallToInstant(ev.startDate, '00:00', tz),
      end: wallToInstant(endExclusive, '00:00', tz),
    };
  }
  if (ev.startsAt == null || ev.endsAt == null) return null;
  return { start: ev.startsAt, end: ev.endsAt };
}

function eventLengthMs(ev: CalEvent): number {
  if (ev.allDay) {
    if (!ev.startDate) return 0;
    const end =
      ev.endDate && ev.endDate > ev.startDate
        ? ev.endDate
        : addDays(ev.startDate, 1);
    // Date arithmetic only — no zone needed for a duration in whole days.
    return (
      Date.parse(`${end}T00:00:00Z`) -
        Date.parse(`${ev.startDate}T00:00:00Z`) || 0
    );
  }
  if (ev.startsAt == null || ev.endsAt == null) return 0;
  return Math.max(0, ev.endsAt - ev.startsAt);
}

/**
 * Split `[from, to)` into segments carrying their available fraction.
 *
 * Where events overlap, the most blocking one wins rather than their blocking
 * being summed: two overlapping meetings do not consume 200% of an hour.
 */
export function segmentsIn(
  from: Instant,
  to: Instant,
  ctx: EngineContext,
): Segment[] {
  if (to <= from) return [];
  const tz = ctx.settings.timezone;
  const accounts = new Map(ctx.accounts.map((a) => [a.id, a]));

  const blocks: Array<{ start: Instant; end: Instant; blocked: number }> = [];
  for (const ev of ctx.events) {
    const bounds = eventBounds(ev, tz);
    if (!bounds) continue;
    const start = Math.max(bounds.start, from);
    const end = Math.min(bounds.end, to);
    if (end <= start) continue;
    const blocked =
      1 - resolveUsableFraction(ev, accounts.get(ev.accountId), ctx.settings);
    if (blocked > 0) blocks.push({ start, end, blocked });
  }

  const edges = new Set<Instant>([from, to]);
  for (const b of blocks) {
    edges.add(b.start);
    edges.add(b.end);
  }
  const points = [...edges].sort((a, b) => a - b);

  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    if (end <= start) continue;
    let blocked = 0;
    for (const b of blocks) {
      if (b.start < end && b.end > start)
        blocked = Math.max(blocked, b.blocked);
    }
    out.push({ start, end, available: 1 - blocked });
  }
  return out;
}

/** The waking stretches of each day overlapping `[from, to)`. */
export function wakingWindows(
  from: Instant,
  to: Instant,
  s: Settings,
): Array<[Instant, Instant]> {
  return dayWindows(from, to, s, s.wakeStart, s.wakeEnd);
}

/**
 * The sleeping stretches overlapping `[from, to)` — the complement of the
 * waking window, which runs from the end of one day into the next.
 */
export function sleepWindows(
  from: Instant,
  to: Instant,
  s: Settings,
): Array<[Instant, Instant]> {
  const tz = s.timezone;
  const out: Array<[Instant, Instant]> = [];
  for (const day of daysSpanning(from, to, tz)) {
    const start = wallToInstant(day, s.wakeEnd, tz);
    const end = wallToInstant(addDays(day, 1), s.wakeStart, tz);
    const a = Math.max(start, from);
    const b = Math.min(end, to);
    if (b > a) out.push([a, b]);
  }
  // The night that began the day before `from` can still overlap the window.
  const first = daysSpanning(from, to, tz)[0];
  if (first) {
    const prev = addDays(first, -1);
    const a = Math.max(wallToInstant(prev, s.wakeEnd, tz), from);
    const b = Math.min(wallToInstant(first, s.wakeStart, tz), to);
    if (b > a) out.unshift([a, b]);
  }
  return out;
}

function dayWindows(
  from: Instant,
  to: Instant,
  s: Settings,
  startTime: string,
  endTime: string,
): Array<[Instant, Instant]> {
  const tz = s.timezone;
  const out: Array<[Instant, Instant]> = [];
  for (const day of daysSpanning(from, to, tz)) {
    const a = Math.max(wallToInstant(day, startTime, tz), from);
    const b = Math.min(wallToInstant(day, endTime, tz), to);
    if (b > a) out.push([a, b]);
  }
  return out;
}

function daysSpanning(from: Instant, to: Instant, tz: string): DateStr[] {
  if (to <= from) return [];
  const out: DateStr[] = [];
  let day = instantToDate(from, tz);
  const last = instantToDate(to, tz);
  // Guard against a pathological range rather than looping forever.
  for (let i = 0; i < 800; i++) {
    out.push(day);
    if (day >= last) break;
    day = addDays(day, 1);
  }
  return out;
}

function minutesOf(
  windows: Array<[Instant, Instant]>,
  ctx: EngineContext,
): number {
  let total = 0;
  for (const [a, b] of windows) {
    for (const seg of segmentsIn(a, b, ctx)) {
      total += ((seg.end - seg.start) / MIN) * seg.available;
    }
  }
  return total;
}

/**
 * Ordinary capacity: waking, unbooked, porosity-adjusted minutes between two
 * instants, scaled by the realism factor. This is what "do I have enough
 * time?" means everywhere in the app.
 */
export function capacityMin(
  from: Instant,
  to: Instant,
  ctx: EngineContext,
): number {
  if (to <= from) return 0;
  const raw = minutesOf(wakingWindows(from, to, ctx.settings), ctx);
  return raw * clamp01(ctx.settings.capacityFactor || 1);
}

/**
 * Night reserve: minutes reachable only by working through the sleep window.
 * Never added to capacity — reported alongside it, so the app can say an
 * all-nighter is what is left rather than pretending the hours were never
 * there.
 */
export function reserveMin(
  from: Instant,
  to: Instant,
  ctx: EngineContext,
): number {
  if (to <= from || !ctx.settings.nightReserveEnabled) return 0;
  return minutesOf(sleepWindows(from, to, ctx.settings), ctx);
}

/**
 * Contiguous waking stretches with nothing scheduled in them at all.
 *
 * Deliberately stricter than `capacityMin`: a partly-usable event yields no
 * block, because its usable minutes have no known position. These are the
 * slots the app is willing to point at and say "do it then".
 */
export function freeBlocks(
  from: Instant,
  to: Instant,
  minLengthMin: number,
  ctx: EngineContext,
): Array<[Instant, Instant]> {
  const out: Array<[Instant, Instant]> = [];
  for (const [a, b] of wakingWindows(from, to, ctx.settings)) {
    let runStart: Instant | null = null;
    let runEnd: Instant | null = null;
    for (const seg of segmentsIn(a, b, ctx)) {
      if (seg.available >= 1) {
        if (runStart == null) runStart = seg.start;
        runEnd = seg.end;
      } else if (runStart != null && runEnd != null) {
        pushIfLongEnough(out, runStart, runEnd, minLengthMin);
        runStart = null;
        runEnd = null;
      }
    }
    if (runStart != null && runEnd != null) {
      pushIfLongEnough(out, runStart, runEnd, minLengthMin);
    }
  }
  return out;
}

/** The longest single uninterrupted stretch available, in minutes. */
export function longestBlockMin(
  from: Instant,
  to: Instant,
  ctx: EngineContext,
): number {
  let best = 0;
  for (const [a, b] of freeBlocks(from, to, 0, ctx)) {
    best = Math.max(best, (b - a) / MIN);
  }
  return best;
}

function pushIfLongEnough(
  out: Array<[Instant, Instant]>,
  a: Instant,
  b: Instant,
  minLengthMin: number,
): void {
  if ((b - a) / MIN >= minLengthMin) out.push([a, b]);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
