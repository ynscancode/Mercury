import { describe, expect, it } from 'vitest';
import { weekLoad } from './load';
import { makeTask } from './task';
import { DEFAULT_SETTINGS, type EngineContext, type Task } from './types';
import { wallToInstant } from './zone';

const TZ = 'Asia/Singapore';
const S = { ...DEFAULT_SETTINGS, timezone: TZ };
const ctx: EngineContext = { settings: S, events: [], accounts: [] };
const MON = '2026-03-02';
const NOW = wallToInstant(MON, '08:00', TZ);
const task = (p: Partial<Task>) =>
  makeTask({ id: p.id ?? 't', title: 'T', ...p });

const plannedOn = (rows: ReturnType<typeof weekLoad>, date: string) =>
  rows.find((r) => r.date === date)!.planned;

describe('weekLoad', () => {
  it('gives every clear day a full waking capacity', () => {
    const rows = weekLoad([], ctx, MON, 7, NOW);
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.capacity === 900)).toBe(true);
    expect(rows.every((r) => r.planned === 0)).toBe(true);
  });

  it('counts only the hours left in today', () => {
    const midday = wallToInstant(MON, '14:00', TZ);
    const rows = weekLoad([], ctx, MON, 2, midday);
    expect(rows[0]!.capacity).toBe(540); // 14:00–23:00
    expect(rows[1]!.capacity).toBe(900);
  });

  it('puts a task that fits in one day on its deadline', () => {
    const rows = weekLoad(
      [task({ due: '2026-03-04', estMin: 120 })],
      ctx,
      MON,
      7,
      NOW,
    );
    expect(plannedOn(rows, '2026-03-04')).toBe(120);
    expect(plannedOn(rows, '2026-03-03')).toBe(0);
  });

  // The artifact's failure: a 20-hour task due Friday showed Friday 20 hours
  // over and every earlier day empty.
  it('spreads a multi-day task back across the days before its deadline', () => {
    const rows = weekLoad(
      [task({ due: '2026-03-06', estMin: 20 * 60 })],
      ctx,
      MON,
      7,
      NOW,
    );
    expect(plannedOn(rows, '2026-03-06')).toBe(900); // Friday, filled
    expect(plannedOn(rows, '2026-03-05')).toBe(300); // Thursday takes the rest
    expect(plannedOn(rows, '2026-03-04')).toBe(0);
    expect(rows.every((r) => r.overBy === 0)).toBe(true);
  });

  it('discounts progress already made', () => {
    const rows = weekLoad(
      [task({ due: '2026-03-06', estMin: 20 * 60, progress: 50 })],
      ctx,
      MON,
      7,
      NOW,
    );
    expect(rows.reduce((s, r) => s + r.planned, 0)).toBe(600);
  });

  it('reports the overflow when the work cannot fit before the deadline', () => {
    // 40 hours due Tuesday: two days of capacity is 1800 minutes.
    const rows = weekLoad(
      [task({ due: '2026-03-03', estMin: 40 * 60 })],
      ctx,
      MON,
      7,
      NOW,
    );
    const tue = rows.find((r) => r.date === '2026-03-03')!;
    expect(tue.overBy).toBeGreaterThan(0);
    expect(tue.planned).toBe(40 * 60 - 900); // Monday absorbed one full day
  });

  it('never schedules earlier than a planned start', () => {
    const rows = weekLoad(
      [
        task({
          due: '2026-03-06',
          plannedStart: '2026-03-05',
          estMin: 20 * 60,
        }),
      ],
      ctx,
      MON,
      7,
      NOW,
    );
    expect(plannedOn(rows, '2026-03-04')).toBe(0);
    expect(plannedOn(rows, '2026-03-05')).toBeGreaterThan(0);
  });

  it('prefers the target date to the due date when both are set', () => {
    const rows = weekLoad(
      [task({ due: '2026-03-06', targetFinish: '2026-03-04', estMin: 120 })],
      ctx,
      MON,
      7,
      NOW,
    );
    expect(plannedOn(rows, '2026-03-04')).toBe(120);
    expect(plannedOn(rows, '2026-03-06')).toBe(0);
  });

  it('lets an earlier deadline claim a day before a later one', () => {
    const rows = weekLoad(
      [
        task({ id: 'a', due: '2026-03-03', estMin: 900 }),
        task({ id: 'b', due: '2026-03-04', estMin: 900 }),
      ],
      ctx,
      MON,
      7,
      NOW,
    );
    expect(plannedOn(rows, '2026-03-03')).toBe(900);
    expect(plannedOn(rows, '2026-03-04')).toBe(900);
    expect(rows.every((r) => r.overBy === 0)).toBe(true);
  });

  it('ignores completed, deleted and estimate-less tasks', () => {
    const rows = weekLoad(
      [
        task({
          id: 'a',
          due: '2026-03-04',
          estMin: 120,
          completedAt: NOW,
          progress: 100,
        }),
        task({ id: 'b', due: '2026-03-04', estMin: 120, deletedAt: NOW }),
        task({ id: 'c', due: '2026-03-04', estMin: 0 }),
      ],
      ctx,
      MON,
      7,
      NOW,
    );
    expect(rows.every((r) => r.planned === 0)).toBe(true);
  });

  it('ignores tasks with no date at all', () => {
    const rows = weekLoad([task({ estMin: 300 })], ctx, MON, 7, NOW);
    expect(rows.every((r) => r.planned === 0)).toBe(true);
  });

  it('pulls a deadline beyond the window onto the last day shown', () => {
    const rows = weekLoad(
      [task({ due: '2026-04-20', estMin: 120 })],
      ctx,
      MON,
      7,
      NOW,
    );
    expect(plannedOn(rows, '2026-03-08')).toBe(120);
  });
});
