/**
 * Task accessors: turning the stored shape into the questions the rest of the
 * engine asks. Every wall-clock field is resolved against an explicit zone.
 */
import type { Instant, Settings, Task, TaskStatus } from './types';
import { wallToInstant } from './zone';

/** A due or target date with no time means the end of that day. */
export const END_OF_DAY = '23:59';

export function status(t: Task): TaskStatus {
  if (t.completedAt != null) return 'done';
  if (t.actualStart != null || t.progress > 0) return 'doing';
  return 'todo';
}

export function dueAt(t: Task, tz: string): Instant | null {
  return t.due ? wallToInstant(t.due, t.dueTime ?? END_OF_DAY, tz) : null;
}

export function targetAt(t: Task, tz: string): Instant | null {
  return t.targetFinish
    ? wallToInstant(t.targetFinish, t.targetFinishTime ?? END_OF_DAY, tz)
    : null;
}

/** A planned start with no time means the start of your day, not midnight. */
export function plannedStartAt(
  t: Task,
  settings: Settings,
  tz: string,
): Instant | null {
  return t.plannedStart
    ? wallToInstant(
        t.plannedStart,
        t.plannedStartTime ?? settings.wakeStart,
        tz,
      )
    : null;
}

/**
 * Work still to do, in minutes. Assumes progress is linear in time: 50% of a
 * four-hour task means two hours remain. That trusts a slider, but the slider
 * is the only signal there is.
 */
export function remainingMin(t: Task): number {
  if (t.completedAt != null) return 0;
  return Math.max(0, t.estMin * (1 - clampProgress(t.progress) / 100));
}

/** Logged time including any currently-running timer. */
export function loggedMin(t: Task, now: Instant): number {
  const running = t.timerStart != null ? (now - t.timerStart) / 60_000 : 0;
  return t.loggedMin + Math.max(0, running);
}

/** The day a task's work is nominally attributed to. */
export function planDay(t: Task): string | null {
  return t.targetFinish ?? t.due ?? null;
}

export const isLive = (t: Task): boolean => t.deletedAt == null;
export const isOpen = (t: Task): boolean =>
  isLive(t) && t.completedAt == null && t.archivedAt == null;

function clampProgress(p: number): number {
  return Math.min(100, Math.max(0, p));
}

/** A task with every optional field defaulted — convenient in tests and seeds. */
export function makeTask(
  partial: Partial<Task> & { id: string; title: string },
): Task {
  return {
    categoryId: null,
    notes: '',
    plannedStart: null,
    plannedStartTime: null,
    targetFinish: null,
    targetFinishTime: null,
    due: null,
    dueTime: null,
    estMin: 0,
    loggedMin: 0,
    progress: 0,
    progressBefore: null,
    actualStart: null,
    completedAt: null,
    timerStart: null,
    priorityMode: 'auto',
    priorityManual: null,
    deletedAt: null,
    archivedAt: null,
    ...partial,
  };
}

/* ---------- transitions ----------
   Pure: each returns a new task rather than mutating, so the store can keep a
   snapshot of the previous value for undo without copying defensively. */

/** Fold a running timer's elapsed time into the logged total. */
export function withTimerStopped(t: Task, now: Instant): Task {
  if (t.timerStart == null) return t;
  const elapsed = Math.max(0, (now - t.timerStart) / 60_000);
  return { ...t, loggedMin: t.loggedMin + elapsed, timerStart: null };
}

export function withTimerStarted(t: Task, now: Instant): Task {
  if (t.timerStart != null) return t;
  return { ...t, timerStart: now, actualStart: t.actualStart ?? now };
}

/** Completing stops the clock and backfills a start, so elapsed time is real. */
export function withCompleted(t: Task, now: Instant): Task {
  const stopped = withTimerStopped(t, now);
  return {
    ...stopped,
    progressBefore: t.progress < 100 ? t.progress : stopped.progressBefore,
    progress: 100,
    completedAt: now,
    actualStart: stopped.actualStart ?? now,
  };
}

/** Un-completing restores the progress the task had before it was finished. */
export function withUncompleted(t: Task): Task {
  return {
    ...t,
    completedAt: null,
    progress: Math.min(99, t.progressBefore ?? 0),
    progressBefore: null,
  };
}

export const withSoftDeleted = (t: Task, now: Instant): Task => ({
  ...t,
  deletedAt: now,
});
export const withRestored = (t: Task): Task => ({ ...t, deletedAt: null });
