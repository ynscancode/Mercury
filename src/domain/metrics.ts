/**
 * Insights: how reliably you finish, and how your time compares with what you
 * planned. Ported from the artifact.
 *
 * Estimate accuracy uses the median rather than the mean throughout, so one
 * catastrophic task does not rewrite the picture.
 */
import { fmtDur, ratio } from './format';
import { dueAt, remainingMin, targetAt } from './task';
import type { Category, Instant, Settings, Task } from './types';
import { daysBetween, instantToDate } from './zone';

export type Period = 'week' | '4w' | 'all';

export interface CategoryMetric {
  category: Category;
  count: number;
  minutes: number;
  /** Median of actual ÷ estimate, or null without enough data. */
  accuracy: number | null;
  sample: number;
}

export interface Metrics {
  done: Task[];
  dueIn: Task[];
  completionRate: number | null;
  onTimeRate: number | null;
  onTimeSample: number;
  onTargetRate: number | null;
  onTargetSample: number;
  accuracyMedian: number | null;
  accuracyYours: number | null;
  accuracyAi: number | null;
  accuracySample: number;
  startDelayAvg: number | null;
  elapsedMedian: number | null;
  minutesLogged: number;
  overdueNow: Task[];
  byCategory: CategoryMetric[];
}

export function periodStart(p: Period, now: Instant, tz: string): Instant {
  if (p === 'all') return 0;
  const today = instantToDate(now, tz);
  if (p === 'week') {
    const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    return now - (dow * 86_400_000 + msIntoDay(now, today));
  }
  return now - 27 * 86_400_000 - msIntoDay(now, today);
}

function msIntoDay(now: Instant, today: string): number {
  return now - Date.parse(`${today}T00:00:00Z`) >= 0
    ? (now - Date.parse(`${today}T00:00:00Z`)) % 86_400_000
    : 0;
}

export function computeMetrics(
  tasks: readonly Task[],
  categories: readonly Category[],
  settings: Settings,
  period: Period,
  categoryFilter: string | 'all',
  now: Instant,
): Metrics {
  const tz = settings.timezone;
  const since = periodStart(period, now, tz);
  const live = tasks.filter(
    (t) =>
      t.deletedAt == null &&
      (categoryFilter === 'all' || t.categoryId === categoryFilter),
  );

  const done = live.filter(
    (t) => t.completedAt != null && t.completedAt >= since,
  );
  const dueIn = live.filter((t) => {
    const d = dueAt(t, tz);
    return d != null && d >= since && d <= now;
  });

  const withDue = done.filter((t) => dueAt(t, tz) != null);
  const onTime = withDue.filter((t) => t.completedAt! <= dueAt(t, tz)!);
  const withTarget = done.filter((t) => t.targetFinish != null);
  const onTarget = withTarget.filter((t) => t.completedAt! <= targetAt(t, tz)!);

  const accuracy = done
    .filter((t) => t.estMin > 0 && t.loggedMin > 0)
    .map((t) => ({ task: t, r: t.loggedMin / t.estMin }));

  const delays = live
    .filter(
      (t) =>
        t.plannedStart != null &&
        t.actualStart != null &&
        t.actualStart >= since,
    )
    .map((t) =>
      daysBetween(t.plannedStart!, instantToDate(t.actualStart!, tz)),
    );

  const elapsed = done
    .filter((t) => t.actualStart != null)
    .map((t) => t.completedAt! - t.actualStart!);

  const overdueNow = live.filter((t) => {
    if (t.completedAt != null || t.archivedAt != null) return false;
    const d = dueAt(t, tz);
    return d != null && d < now;
  });

  const byCategory = categories.map((category) => {
    const d = done.filter((t) => t.categoryId === category.id);
    const a = accuracy.filter((x) => x.task.categoryId === category.id);
    return {
      category,
      count: d.length,
      minutes: d.reduce((sum, t) => sum + t.loggedMin, 0),
      accuracy: a.length ? median(a.map((x) => x.r)) : null,
      sample: a.length,
    };
  });

  return {
    done,
    dueIn,
    completionRate: dueIn.length
      ? dueIn.filter((t) => t.completedAt != null).length / dueIn.length
      : null,
    onTimeRate: withDue.length ? onTime.length / withDue.length : null,
    onTimeSample: withDue.length,
    onTargetRate: withTarget.length
      ? onTarget.length / withTarget.length
      : null,
    onTargetSample: withTarget.length,
    accuracyMedian: median(accuracy.map((x) => x.r)),
    accuracyYours: median(
      accuracy.filter((x) => x.task.estSource !== 'ai').map((x) => x.r),
    ),
    accuracyAi: median(
      accuracy.filter((x) => x.task.estSource === 'ai').map((x) => x.r),
    ),
    accuracySample: accuracy.length,
    startDelayAvg: mean(delays),
    elapsedMedian: median(elapsed),
    minutesLogged: done.reduce((sum, t) => sum + t.loggedMin, 0),
    overdueNow,
    byCategory,
  };
}

/** The "what stands out" lines. Plain strings; the UI decides the emphasis. */
export function insightLines(m: Metrics): string[] {
  const out: string[] = [];
  if (m.dueIn.length) {
    const finished = m.dueIn.filter((t) => t.completedAt != null).length;
    out.push(
      `${finished} of ${m.dueIn.length} tasks due in this period are done (${Math.round((m.completionRate ?? 0) * 100)}%).`,
    );
  }
  if (m.onTimeSample) {
    out.push(
      `${Math.round((m.onTimeRate ?? 0) * 100)}% of completed tasks were finished before their deadline.`,
    );
  }
  if (m.accuracySample && m.accuracyMedian != null) {
    const r = m.accuracyMedian;
    if (r > 1.05) {
      out.push(
        `Tasks take ${ratio(r)} your estimate (median of ${m.accuracySample}). Pad estimates by about ${Math.round((r - 1) * 100)}%.`,
      );
    } else if (r < 0.95) {
      out.push(
        `Tasks take ${ratio(r)} your estimate (median of ${m.accuracySample}). You are overestimating slightly.`,
      );
    } else {
      out.push(
        `Your estimates are on target: ${ratio(r)} median across ${m.accuracySample} tasks.`,
      );
    }
    const worst = m.byCategory
      .filter((c) => c.accuracy != null && c.sample >= 2)
      .sort((a, b) => Math.abs(b.accuracy! - 1) - Math.abs(a.accuracy! - 1))[0];
    if (worst && Math.abs(worst.accuracy! - 1) >= 0.15) {
      out.push(
        `${worst.category.name} tasks run ${Math.round(Math.abs(worst.accuracy! - 1) * 100)}% ${worst.accuracy! > 1 ? 'over' : 'under'} estimate.`,
      );
    }
  } else {
    out.push(
      'Run the timer on a few tasks, or log time when you finish, to see how your estimates hold up.',
    );
  }
  if (m.startDelayAvg != null && m.startDelayAvg >= 0.5) {
    out.push(
      `You start tasks ${m.startDelayAvg.toFixed(1)} days after the planned start on average.`,
    );
  }
  if (m.overdueNow.length) {
    out.push(
      `${m.overdueNow.length} task${m.overdueNow.length === 1 ? ' is' : 's are'} overdue right now.`,
    );
  }
  if (!out.length) {
    out.push(
      'Complete a few tasks and your completion and timing stats will appear here.',
    );
  }
  return out;
}

/** Total remaining work across open tasks, for a capacity summary. */
export function totalRemaining(tasks: readonly Task[]): string {
  const sum = tasks
    .filter((t) => t.completedAt == null && t.deletedAt == null)
    .reduce((acc, t) => acc + remainingMin(t), 0);
  return fmtDur(sum);
}

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function mean(xs: readonly number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
