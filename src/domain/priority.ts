/**
 * Priority and attention — the two signals that decide what the app shouts
 * about.
 *
 * Priority answers "how much does this matter?" and is automatic unless
 * pinned. Attention answers "does this need you right now?" and is never
 * pinned, because it is about time running out rather than importance.
 *
 * Both measure time as *capacity* (waking, unbooked, porosity-adjusted) rather
 * than wall-clock distance to the deadline. Clock time counts sleep and
 * meetings as hours you could work, which is precisely why a clock-based
 * trigger stays quiet in the situations it exists to catch.
 */
import { capacityMin, reserveMin } from './capacity';
import { countdown, fmtDur, relDay, relDue } from './format';
import { dueAt, plannedStartAt, remainingMin, status } from './task';
import type { EngineContext, Instant, PriorityLevel, Task } from './types';
import { instantToDate, instantToTime } from './zone';

const DAY_MS = 86_400_000;

export interface PriorityVerdict {
  level: PriorityLevel;
  why: string;
  /** True when the level was pinned by hand rather than derived. */
  pinned: boolean;
  /** What the rules would have said. Kept visible even when pinned. */
  auto: PriorityLevel | null;
}

/** The level the rules derive, ignoring any manual pin. */
export function autoPriority(
  t: Task,
  ctx: EngineContext,
  now: Instant,
): { level: PriorityLevel; why: string } | null {
  if (t.completedAt != null) return null;
  const s = ctx.settings;
  const due = dueAt(t, s.timezone);

  if (due == null) {
    if (s.noDuePriority === 'none') return null;
    return { level: s.noDuePriority, why: 'No due date' };
  }

  if (due < now && s.overdueAlwaysHigh) {
    return { level: 'high', why: 'Overdue' };
  }

  const remaining = remainingMin(t);
  if (s.escalateWhenNoFit && remaining > 0 && due > now) {
    const capacity = capacityMin(now, due, ctx);
    if (capacity < remaining) {
      return {
        level: 'high',
        why: `Needs ${fmtDur(remaining)}, only ${fmtDur(capacity)} free before it's due`,
      };
    }
  }

  const left = due - now;
  if (left <= s.highDays * DAY_MS) {
    return {
      level: 'high',
      why: `Due within ${s.highDays} day${s.highDays === 1 ? '' : 's'}`,
    };
  }
  if (left <= s.medDays * DAY_MS) {
    return { level: 'med', why: `Due within ${s.medDays} days` };
  }
  return { level: 'low', why: `Due in more than ${s.medDays} days` };
}

/**
 * The level the app actually uses: a manual pin beats the rules everywhere,
 * but the derived level stays visible so pinning never costs information.
 */
export function effectivePriority(
  t: Task,
  ctx: EngineContext,
  now: Instant,
): PriorityVerdict | null {
  const auto = autoPriority(t, ctx, now);
  if (t.priorityMode === 'manual' && t.priorityManual) {
    return {
      level: t.priorityManual,
      why: auto ? `Pinned. Auto would say ${LABEL[auto.level]}` : 'Pinned',
      pinned: true,
      auto: auto?.level ?? null,
    };
  }
  if (!auto) return null;
  return { level: auto.level, why: auto.why, pinned: false, auto: auto.level };
}

export const LABEL: Record<PriorityLevel, string> = {
  high: 'High',
  med: 'Medium',
  low: 'Low',
};

export const RANK: Record<PriorityLevel, number> = { high: 0, med: 1, low: 2 };

export type AttentionKind = 'over' | 'start' | 'risk';

export interface Attention {
  kind: AttentionKind;
  reason: string;
  /**
   * True when capacity *plus* the night reserve is still not enough: the task
   * cannot be finished even by working through the night. The artifact could
   * only ever say "start now"; this is the thing it had no way to say.
   */
  impossible: boolean;
}

export function attention(
  t: Task,
  ctx: EngineContext,
  now: Instant,
): Attention | null {
  if (t.completedAt != null) return null;
  const s = ctx.settings;
  const tz = s.timezone;
  const due = dueAt(t, tz);

  if (due != null && due < now) {
    return {
      kind: 'over',
      reason: `Was due ${relDue(due, now, tz)}`,
      impossible: false,
    };
  }

  const remaining = remainingMin(t);
  let tight = false;
  let impossible = false;
  let capacity = 0;
  let reserve = 0;

  if (due != null && remaining > 0) {
    capacity = capacityMin(now, due, ctx);
    reserve = reserveMin(now, due, ctx);
    tight = capacity < remaining * s.buffer;
    impossible = capacity + reserve < remaining;
  }

  const state = status(t);
  if (state === 'todo') {
    if (tight) {
      return {
        kind: 'start',
        reason: tightReason(remaining, capacity, reserve, s.buffer, impossible),
        impossible,
      };
    }
    const planned = plannedStartAt(t, s, tz);
    if (planned != null && planned <= now && t.plannedStart) {
      const today = instantToDate(now, tz);
      const clock = instantToTime(planned, tz);
      return {
        kind: 'start',
        reason:
          t.plannedStart === today
            ? `Planned to start at ${clock}`
            : `Planned start was ${relDay(t.plannedStart, today, tz)} ${clock}`,
        impossible: false,
      };
    }
    return null;
  }

  if (tight) {
    return {
      kind: 'risk',
      reason: tightReason(remaining, capacity, reserve, s.buffer, impossible),
      impossible,
    };
  }
  return null;
}

/**
 * The sentence that explains the squeeze. Night reserve appears only when it
 * is decisive — either because it is what is left, or because not even it is
 * enough — so the all-nighter is surfaced as a decision rather than noise.
 */
function tightReason(
  remaining: number,
  capacity: number,
  reserve: number,
  buffer: number,
  impossible: boolean,
): string {
  const needs = `Needs ${fmtDur(remaining)}`;
  if (impossible) {
    return reserve > 0
      ? `${needs}. Only ${fmtDur(capacity)} free before you sleep and ${fmtDur(reserve)} of night left — it no longer fits.`
      : `${needs}, only ${fmtDur(capacity)} free before it's due — it no longer fits.`;
  }
  const padded = `${fmtDur(remaining * buffer)} with buffer`;
  if (reserve > 0) {
    return `${needs} (${padded}), ${fmtDur(capacity)} free before you sleep, ${fmtDur(reserve)} more if you work through the night.`;
  }
  return `${needs} (${padded}), only ${fmtDur(capacity)} free before it's due.`;
}

/** Time until a deadline, phrased for a chip. */
export function dueCountdown(due: Instant, now: Instant): string {
  return due < now
    ? `${countdown(now - due)} overdue`
    : `in ${countdown(due - now)}`;
}
