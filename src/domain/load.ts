/**
 * Week load: how much work each day is actually carrying, against how much
 * capacity it has.
 *
 * The artifact attributed a task's whole remaining estimate to its target
 * date, so a twenty-hour task due Friday showed Friday twenty hours over and
 * Monday to Thursday empty — exactly backwards for the multi-session work the
 * engine already detects. Here the work is spread across the days that have
 * the capacity to hold it.
 *
 * Spreading runs backwards from the deadline, filling each day up to its
 * remaining capacity. Scheduling as late as it can still be done is what makes
 * the over-capacity signal honest: it shows the crunch where the crunch will
 * actually land, rather than smoothing it away into days you have not reached.
 */
import { capacityMin } from './capacity';
import { planDay, remainingMin } from './task';
import type { DateStr, EngineContext, Instant, Task } from './types';
import { addDays, startOfDay } from './zone';

export interface DayLoad {
  date: DateStr;
  /** Ordinary capacity for the day, from now onward if it is today. */
  capacity: number;
  /** Work spread onto this day, including any that could not fit anywhere. */
  planned: number;
  /** Minutes by which planned exceeds capacity; zero when it fits. */
  overBy: number;
}

export function weekLoad(
  tasks: readonly Task[],
  ctx: EngineContext,
  from: DateStr,
  dayCount: number,
  now: Instant,
): DayLoad[] {
  const tz = ctx.settings.timezone;
  const days: DateStr[] = [];
  for (let i = 0; i < dayCount; i++) days.push(addDays(from, i));
  const last = days[days.length - 1]!;

  const capacity = new Map<DateStr, number>();
  for (const d of days) {
    // Today only counts from now on — hours already gone are not capacity.
    const start = Math.max(startOfDay(d, tz), now);
    const end = startOfDay(addDays(d, 1), tz);
    capacity.set(d, Math.max(0, capacityMin(start, end, ctx)));
  }

  const allocated = new Map<DateStr, number>(days.map((d) => [d, 0]));

  const scheduled = tasks
    .filter(
      (t) =>
        t.completedAt == null && t.deletedAt == null && remainingMin(t) > 0,
    )
    .map((t) => ({ task: t, day: planDay(t) }))
    .filter((x): x is { task: Task; day: DateStr } => x.day != null)
    // Earlier deadlines claim their days first, since they have less room to move.
    .sort((a, b) => a.day.localeCompare(b.day));

  for (const { task, day } of scheduled) {
    let remaining = remainingMin(task);
    const earliest = maxDate(from, task.plannedStart ?? from);
    // A deadline past the window still pulls work into the window's last day.
    const latest = minDate(day, last);
    if (latest < earliest) {
      // The whole window is after the deadline: show it on the first day.
      bump(allocated, from, remaining);
      continue;
    }
    for (let d = latest; d >= earliest; d = addDays(d, -1)) {
      if (remaining <= 0) break;
      const free = (capacity.get(d) ?? 0) - (allocated.get(d) ?? 0);
      if (free <= 0) continue;
      const take = Math.min(free, remaining);
      bump(allocated, d, take);
      remaining -= take;
    }
    // Whatever still will not fit lands on the deadline, where it will hurt.
    if (remaining > 0) bump(allocated, latest, remaining);
  }

  return days.map((date) => {
    const cap = capacity.get(date) ?? 0;
    const planned = allocated.get(date) ?? 0;
    return { date, capacity: cap, planned, overBy: Math.max(0, planned - cap) };
  });
}

function bump(map: Map<DateStr, number>, key: DateStr, by: number): void {
  if (!map.has(key)) return;
  map.set(key, (map.get(key) ?? 0) + by);
}

const maxDate = (a: DateStr, b: DateStr): DateStr => (a >= b ? a : b);
const minDate = (a: DateStr, b: DateStr): DateStr => (a <= b ? a : b);
