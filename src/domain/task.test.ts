import { describe, expect, it } from 'vitest';
import {
  dueAt,
  isLive,
  isOpen,
  loggedMin,
  makeTask,
  planDay,
  plannedStartAt,
  remainingMin,
  status,
  targetAt,
} from './task';
import { DEFAULT_SETTINGS, type Task } from './types';
import { wallToInstant } from './zone';

const TZ = 'Asia/Singapore';
const S = { ...DEFAULT_SETTINGS, timezone: TZ };
const at = (d: string, t: string) => wallToInstant(d, t, TZ);
const t = (p: Partial<Task> = {}) => makeTask({ id: 'x', title: 'X', ...p });

describe('status', () => {
  it('is todo for an untouched task', () => expect(status(t())).toBe('todo'));
  it('is doing once started', () =>
    expect(status(t({ actualStart: 1 }))).toBe('doing'));
  it('is doing once progress is above zero even without a start', () =>
    expect(status(t({ progress: 10 }))).toBe('doing'));
  it('is done once completed, whatever else is set', () =>
    expect(status(t({ completedAt: 1, actualStart: 1, progress: 100 }))).toBe(
      'done',
    ));
});

describe('date resolution', () => {
  it('defaults a due time to the end of the day', () => {
    expect(dueAt(t({ due: '2026-03-05' }), TZ)).toBe(at('2026-03-05', '23:59'));
  });

  it('uses an explicit due time', () => {
    expect(dueAt(t({ due: '2026-03-05', dueTime: '09:00' }), TZ)).toBe(
      at('2026-03-05', '09:00'),
    );
  });

  it('is null without a date', () => {
    expect(dueAt(t(), TZ)).toBeNull();
    expect(targetAt(t(), TZ)).toBeNull();
    expect(plannedStartAt(t(), S, TZ)).toBeNull();
  });

  // A planned start at midnight would be useless; the day's start is meant.
  it('defaults a planned start to the start of your day', () => {
    expect(plannedStartAt(t({ plannedStart: '2026-03-05' }), S, TZ)).toBe(
      at('2026-03-05', '08:00'),
    );
  });

  it('follows the wake setting for that default', () => {
    const early = { ...S, wakeStart: '06:30' };
    expect(plannedStartAt(t({ plannedStart: '2026-03-05' }), early, TZ)).toBe(
      at('2026-03-05', '06:30'),
    );
  });
});

describe('remainingMin', () => {
  it('is the whole estimate at zero progress', () =>
    expect(remainingMin(t({ estMin: 240 }))).toBe(240));
  it('scales linearly with progress', () =>
    expect(remainingMin(t({ estMin: 240, progress: 25 }))).toBe(180));
  it('is zero at full progress', () =>
    expect(remainingMin(t({ estMin: 240, progress: 100 }))).toBe(0));
  it('is zero for a completed task whatever its progress', () =>
    expect(remainingMin(t({ estMin: 240, progress: 40, completedAt: 1 }))).toBe(
      0,
    ));
  it('clamps progress outside 0–100', () => {
    expect(remainingMin(t({ estMin: 240, progress: -10 }))).toBe(240);
    expect(remainingMin(t({ estMin: 240, progress: 150 }))).toBe(0);
  });
});

describe('loggedMin', () => {
  const now = at('2026-03-05', '10:00');
  it('is the stored value with no timer running', () =>
    expect(loggedMin(t({ loggedMin: 30 }), now)).toBe(30));
  it('adds the running timer', () =>
    expect(
      loggedMin(t({ loggedMin: 30, timerStart: now - 15 * 60_000 }), now),
    ).toBe(45));
  it('never subtracts for a timer started in the future', () =>
    expect(loggedMin(t({ loggedMin: 30, timerStart: now + 60_000 }), now)).toBe(
      30,
    ));
});

describe('planDay', () => {
  it('prefers the target to the deadline', () =>
    expect(planDay(t({ due: '2026-03-06', targetFinish: '2026-03-04' }))).toBe(
      '2026-03-04',
    ));
  it('falls back to the deadline', () =>
    expect(planDay(t({ due: '2026-03-06' }))).toBe('2026-03-06'));
  it('is null with neither', () => expect(planDay(t())).toBeNull());
});

describe('isLive and isOpen', () => {
  it('treats a soft-deleted task as neither live nor open', () => {
    expect(isLive(t({ deletedAt: 1 }))).toBe(false);
    expect(isOpen(t({ deletedAt: 1 }))).toBe(false);
  });
  it('treats a completed task as live but not open', () => {
    expect(isLive(t({ completedAt: 1 }))).toBe(true);
    expect(isOpen(t({ completedAt: 1 }))).toBe(false);
  });
  it('treats an archived task as live but not open', () => {
    expect(isOpen(t({ archivedAt: 1 }))).toBe(false);
  });
});
