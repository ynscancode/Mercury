import { describe, expect, it } from 'vitest';
import { computeMetrics, insightLines, mean, median } from './metrics';
import { makeTask } from './task';
import { DEFAULT_SETTINGS, type Category, type Task } from './types';
import { wallToInstant } from './zone';

const TZ = 'Asia/Singapore';
const S = { ...DEFAULT_SETTINGS, timezone: TZ };
const at = (d: string, t: string) => wallToInstant(d, t, TZ);
const NOW = at('2026-03-20', '12:00');
const CATS: Category[] = [
  { id: 'work', name: 'Work', color: '#000000' },
  { id: 'school', name: 'School', color: '#000000' },
];
const t = (p: Partial<Task>) => makeTask({ id: p.id ?? 'x', title: 'X', ...p });
const run = (
  tasks: Task[],
  period: 'week' | '4w' | 'all' = 'all',
  filter = 'all',
) => computeMetrics(tasks, CATS, S, period, filter, NOW);

describe('median and mean', () => {
  it('handle odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(mean([1, 2, 3])).toBe(2);
  });
  it('are null for no data', () => {
    expect(median([])).toBeNull();
    expect(mean([])).toBeNull();
  });
});

describe('computeMetrics', () => {
  it('returns empty, non-crashing metrics with no tasks', () => {
    const m = run([]);
    expect(m.completionRate).toBeNull();
    expect(m.accuracyMedian).toBeNull();
    expect(m.minutesLogged).toBe(0);
  });

  it('measures completion against tasks that were due in the period', () => {
    const m = run([
      t({
        id: 'a',
        due: '2026-03-10',
        completedAt: at('2026-03-10', '10:00'),
        progress: 100,
      }),
      t({ id: 'b', due: '2026-03-11' }),
    ]);
    expect(m.dueIn).toHaveLength(2);
    expect(m.completionRate).toBe(0.5);
  });

  it('measures on-time against the deadline', () => {
    const m = run([
      t({
        id: 'a',
        due: '2026-03-10',
        completedAt: at('2026-03-09', '10:00'),
        progress: 100,
      }),
      t({
        id: 'b',
        due: '2026-03-10',
        completedAt: at('2026-03-11', '10:00'),
        progress: 100,
      }),
    ]);
    expect(m.onTimeRate).toBe(0.5);
    expect(m.onTimeSample).toBe(2);
  });

  it('measures target-hit separately from the deadline', () => {
    const m = run([
      t({
        id: 'a',
        due: '2026-03-12',
        targetFinish: '2026-03-10',
        completedAt: at('2026-03-11', '10:00'),
        progress: 100,
      }),
    ]);
    expect(m.onTimeRate).toBe(1); // beat the deadline
    expect(m.onTargetRate).toBe(0); // missed the target
  });

  it('uses the median for estimate accuracy, so one disaster does not dominate', () => {
    const m = run([
      t({
        id: 'a',
        estMin: 60,
        loggedMin: 60,
        completedAt: NOW - 1000,
        progress: 100,
      }),
      t({
        id: 'b',
        estMin: 60,
        loggedMin: 66,
        completedAt: NOW - 2000,
        progress: 100,
      }),
      t({
        id: 'c',
        estMin: 60,
        loggedMin: 600,
        completedAt: NOW - 3000,
        progress: 100,
      }),
    ]);
    expect(m.accuracyMedian).toBe(1.1);
    expect(m.accuracySample).toBe(3);
  });

  it("scores your estimates separately from the AI's", () => {
    const m = run([
      t({
        id: 'a',
        estMin: 60,
        loggedMin: 120,
        completedAt: NOW - 1000,
        progress: 100,
        estSource: 'you',
      }),
      t({
        id: 'b',
        estMin: 60,
        loggedMin: 60,
        completedAt: NOW - 2000,
        progress: 100,
        estSource: 'ai',
      }),
    ]);
    expect(m.accuracyYours).toBe(2);
    expect(m.accuracyAi).toBe(1);
  });

  it('averages start delay in whole days', () => {
    const m = run([
      t({
        id: 'a',
        plannedStart: '2026-03-10',
        actualStart: at('2026-03-12', '09:00'),
      }),
      t({
        id: 'b',
        plannedStart: '2026-03-10',
        actualStart: at('2026-03-14', '09:00'),
      }),
    ]);
    expect(m.startDelayAvg).toBe(3);
  });

  it('counts tasks overdue right now, excluding completed ones', () => {
    const m = run([
      t({ id: 'a', due: '2026-03-10' }),
      t({ id: 'b', due: '2026-03-10', completedAt: NOW, progress: 100 }),
      t({ id: 'c', due: '2026-03-30' }),
    ]);
    expect(m.overdueNow.map((x) => x.id)).toEqual(['a']);
  });

  it('excludes soft-deleted tasks from every figure', () => {
    const m = run([
      t({
        id: 'a',
        due: '2026-03-10',
        completedAt: NOW,
        progress: 100,
        loggedMin: 60,
        deletedAt: NOW,
      }),
    ]);
    expect(m.done).toHaveLength(0);
    expect(m.minutesLogged).toBe(0);
  });

  // Archiving is a flag, not a separate table, so archived work still counts.
  it('still counts archived tasks', () => {
    const m = run([
      t({
        id: 'a',
        due: '2026-03-10',
        completedAt: at('2026-03-10', '09:00'),
        progress: 100,
        loggedMin: 90,
        archivedAt: NOW,
      }),
    ]);
    expect(m.minutesLogged).toBe(90);
    expect(m.completionRate).toBe(1);
  });

  it('filters by category', () => {
    const tasks = [
      t({
        id: 'a',
        categoryId: 'work',
        completedAt: NOW - 1000,
        progress: 100,
        loggedMin: 60,
      }),
      t({
        id: 'b',
        categoryId: 'school',
        completedAt: NOW - 1000,
        progress: 100,
        loggedMin: 30,
      }),
    ];
    expect(run(tasks, 'all', 'work').minutesLogged).toBe(60);
    expect(run(tasks, 'all').minutesLogged).toBe(90);
  });

  it('breaks hours down by category', () => {
    const m = run([
      t({
        id: 'a',
        categoryId: 'work',
        completedAt: NOW - 1000,
        progress: 100,
        loggedMin: 60,
      }),
      t({
        id: 'b',
        categoryId: 'work',
        completedAt: NOW - 2000,
        progress: 100,
        loggedMin: 30,
      }),
    ]);
    const work = m.byCategory.find((c) => c.category.id === 'work')!;
    expect(work.minutes).toBe(90);
    expect(work.count).toBe(2);
  });

  it('excludes work finished before the period began', () => {
    const old = t({
      id: 'a',
      completedAt: at('2026-01-01', '09:00'),
      progress: 100,
      loggedMin: 60,
    });
    expect(run([old], 'all').done).toHaveLength(1);
    expect(run([old], '4w').done).toHaveLength(0);
  });
});

describe('insightLines', () => {
  it('nudges you to log time when there is nothing to measure', () => {
    expect(insightLines(run([])).join(' ')).toContain('Run the timer');
  });

  it('tells you how much to pad when tasks run long', () => {
    const m = run([
      t({
        id: 'a',
        estMin: 60,
        loggedMin: 84,
        completedAt: NOW - 1000,
        progress: 100,
      }),
      t({
        id: 'b',
        estMin: 60,
        loggedMin: 84,
        completedAt: NOW - 2000,
        progress: 100,
      }),
    ]);
    expect(insightLines(m).join(' ')).toContain('Pad estimates by about 40%');
  });

  it('says so when estimates are on target', () => {
    const m = run([
      t({
        id: 'a',
        estMin: 60,
        loggedMin: 60,
        completedAt: NOW - 1000,
        progress: 100,
      }),
    ]);
    expect(insightLines(m).join(' ')).toContain('on target');
  });

  it('names the category that misses worst', () => {
    const m = run([
      t({
        id: 'a',
        categoryId: 'school',
        estMin: 60,
        loggedMin: 120,
        completedAt: NOW - 1000,
        progress: 100,
      }),
      t({
        id: 'b',
        categoryId: 'school',
        estMin: 60,
        loggedMin: 120,
        completedAt: NOW - 2000,
        progress: 100,
      }),
    ]);
    expect(insightLines(m).join(' ')).toContain(
      'School tasks run 100% over estimate',
    );
  });

  it('reports overdue work', () => {
    const m = run([t({ id: 'a', due: '2026-03-01' })]);
    expect(insightLines(m).join(' ')).toContain('1 task is overdue');
  });
});
