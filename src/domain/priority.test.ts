import { describe, expect, it } from 'vitest';
import { attention, autoPriority, effectivePriority } from './priority';
import { makeTask } from './task';
import {
  DEFAULT_SETTINGS,
  type CalEvent,
  type EngineContext,
  type Task,
} from './types';
import { wallToInstant } from './zone';

const TZ = 'Asia/Singapore';
const S = { ...DEFAULT_SETTINGS, timezone: TZ };
const at = (d: string, t: string) => wallToInstant(d, t, TZ);
const NOW = at('2026-03-05', '09:00'); // Thursday morning

function ctx(events: CalEvent[] = [], settings = S): EngineContext {
  return { settings, events, accounts: [] };
}

function timed(id: string, date: string, from: string, to: string): CalEvent {
  return {
    id,
    accountId: 'acc',
    title: id,
    startsAt: at(date, from),
    endsAt: at(date, to),
    startDate: null,
    endDate: null,
    allDay: false,
    busy: true,
    usableFraction: null,
  };
}

const task = (p: Partial<Task> = {}) =>
  makeTask({ id: 't1', title: 'Task', ...p });

/**
 * A day of back-to-back two-hour meetings, 09:00 to 23:00. Each is short
 * enough to block fully — a handful of four-hour blocks would instead be read
 * as porous containers and leave most of the day available.
 */
function packedDay(): CalEvent[] {
  const out: CalEvent[] = [];
  for (let h = 9; h < 23; h += 2) {
    const two = (n: number) => `${String(n).padStart(2, '0')}:00`;
    out.push(timed(`m${h}`, '2026-03-05', two(h), two(h + 2)));
  }
  return out;
}

describe('autoPriority', () => {
  it('has no opinion about a completed task', () => {
    expect(
      autoPriority(task({ completedAt: NOW, progress: 100 }), ctx(), NOW),
    ).toBeNull();
  });

  it('calls an overdue task High', () => {
    const t = task({ due: '2026-03-04' });
    expect(autoPriority(t, ctx(), NOW)).toEqual({
      level: 'high',
      why: 'Overdue',
    });
  });

  it('respects the overdue rule being switched off', () => {
    const t = task({ due: '2026-03-04' });
    const v = autoPriority(t, ctx([], { ...S, overdueAlwaysHigh: false }), NOW);
    expect(v?.level).toBe('high'); // still High, now via the "due within 3 days" rule
    expect(v?.why).toContain('Due within');
  });

  describe('day thresholds', () => {
    it('is High inside the high window', () => {
      expect(autoPriority(task({ due: '2026-03-07' }), ctx(), NOW)?.level).toBe(
        'high',
      );
    });

    it('is Medium between the two windows', () => {
      expect(autoPriority(task({ due: '2026-03-14' }), ctx(), NOW)?.level).toBe(
        'med',
      );
    });

    it('is Low beyond the medium window', () => {
      expect(autoPriority(task({ due: '2026-04-30' }), ctx(), NOW)?.level).toBe(
        'low',
      );
    });

    it('moves the boundary when the setting moves', () => {
      const wide = ctx([], { ...S, highDays: 10 });
      expect(autoPriority(task({ due: '2026-03-12' }), ctx(), NOW)?.level).toBe(
        'med',
      );
      expect(autoPriority(task({ due: '2026-03-12' }), wide, NOW)?.level).toBe(
        'high',
      );
    });
  });

  describe('tasks with no due date', () => {
    it('is Low by default', () => {
      expect(autoPriority(task(), ctx(), NOW)).toEqual({
        level: 'low',
        why: 'No due date',
      });
    });

    it('can be configured to Medium', () => {
      expect(
        autoPriority(task(), ctx([], { ...S, noDuePriority: 'med' }), NOW)
          ?.level,
      ).toBe('med');
    });

    it('can be configured to have no priority at all', () => {
      expect(
        autoPriority(task(), ctx([], { ...S, noDuePriority: 'none' }), NOW),
      ).toBeNull();
    });
  });

  describe('the "no longer fits" escalation', () => {
    // Due in 11 days, so nominally Low — but it needs more hours than exist.
    const big = task({ due: '2026-03-16', estMin: 60 * 200 });

    it('escalates to High when the work cannot fit in the capacity left', () => {
      const v = autoPriority(big, ctx(), NOW);
      expect(v?.level).toBe('high');
      expect(v?.why).toContain('free before it');
    });

    it('does not escalate when the rule is switched off', () => {
      const v = autoPriority(
        big,
        ctx([], { ...S, escalateWhenNoFit: false }),
        NOW,
      );
      expect(v?.level).toBe('med');
    });

    it('discounts progress already made', () => {
      const half = task({ due: '2026-03-16', estMin: 60 * 200, progress: 95 });
      expect(autoPriority(half, ctx(), NOW)?.level).toBe('med');
    });
  });
});

describe('effectivePriority', () => {
  it('derives the level when nothing is pinned', () => {
    const v = effectivePriority(task({ due: '2026-03-07' }), ctx(), NOW);
    expect(v).toMatchObject({ level: 'high', pinned: false, auto: 'high' });
  });

  it('lets a manual pin beat the rules', () => {
    const t = task({
      due: '2026-03-07',
      priorityMode: 'manual',
      priorityManual: 'low',
    });
    const v = effectivePriority(t, ctx(), NOW);
    expect(v?.level).toBe('low');
    expect(v?.pinned).toBe(true);
  });

  // Pinning must not cost you the information the rules had.
  it('keeps the derived level visible behind a pin', () => {
    const t = task({
      due: '2026-03-07',
      priorityMode: 'manual',
      priorityManual: 'low',
    });
    const v = effectivePriority(t, ctx(), NOW);
    expect(v?.auto).toBe('high');
    expect(v?.why).toContain('Auto would say High');
  });

  it('ignores a stale pinned level once the mode is back to auto', () => {
    const t = task({
      due: '2026-03-07',
      priorityMode: 'auto',
      priorityManual: 'low',
    });
    expect(effectivePriority(t, ctx(), NOW)?.level).toBe('high');
  });
});

describe('attention', () => {
  it('says nothing about a completed task', () => {
    expect(
      attention(task({ completedAt: NOW, progress: 100 }), ctx(), NOW),
    ).toBeNull();
  });

  it('flags an overdue task', () => {
    const a = attention(task({ due: '2026-03-04' }), ctx(), NOW);
    expect(a?.kind).toBe('over');
    expect(a?.reason).toContain('Was due');
  });

  it('says nothing about a comfortable task', () => {
    expect(
      attention(task({ due: '2026-03-20', estMin: 60 }), ctx(), NOW),
    ).toBeNull();
  });

  it('flags a task whose planned start has passed', () => {
    const t = task({ plannedStart: '2026-03-03', due: '2026-04-01' });
    const a = attention(t, ctx(), NOW);
    expect(a?.kind).toBe('start');
    expect(a?.reason).toContain('Planned start was');
  });

  it('phrases a planned start earlier today differently', () => {
    const t = task({
      plannedStart: '2026-03-05',
      plannedStartTime: '08:00',
      due: '2026-04-01',
    });
    expect(attention(t, ctx(), NOW)?.reason).toBe('Planned to start at 08:00');
  });

  describe('capacity rather than clock time', () => {
    // 4h of work, due 09:00 tomorrow. Wall-clock distance is 24h, which the
    // artifact would have found comfortable. Real capacity is 14h of waking,
    // unbooked time (09:00-23:00 today, plus 08:00-09:00 tomorrow) minus
    // whatever is booked.
    const t = task({ due: '2026-03-06', dueTime: '09:00', estMin: 240 });

    it('is quiet when the capacity genuinely exists', () => {
      expect(attention(t, ctx(), NOW)).toBeNull();
    });

    it('fires once meetings eat the capacity, though the clock has not moved', () => {
      const busyDay = packedDay();
      const a = attention(t, ctx(busyDay), NOW);
      expect(a?.kind).toBe('start');
      expect(a?.reason).toContain('Needs 4h');
    });

    // The long-event rule reaches into attention too, and the effect is large.
    it('stays quiet through a workday, which is porous rather than blocking', () => {
      const workday = [timed('job', '2026-03-05', '09:00', '18:00')];
      expect(attention(t, ctx(workday), NOW)).toBeNull();
    });

    // Sleep is the other half: a clock-based trigger counts it as working time.
    it('does not count the night as ordinary capacity', () => {
      // Due 07:00 tomorrow: only 09:00–23:00 today is waking capacity.
      const overnight = task({
        due: '2026-03-06',
        dueTime: '07:00',
        estMin: 60 * 13,
      });
      const a = attention(overnight, ctx(), NOW);
      expect(a?.kind).toBe('start');
    });
  });

  describe('the night reserve', () => {
    it('offers the night as what is left when capacity runs short', () => {
      const t = task({ due: '2026-03-06', dueTime: '08:00', estMin: 60 * 13 });
      const a = attention(t, ctx(), NOW);
      expect(a?.reason).toContain('if you work through the night');
      expect(a?.impossible).toBe(false);
    });

    // The thing the artifact could never say.
    it('reports a task that no longer fits even with an all-nighter', () => {
      const t = task({ due: '2026-03-06', dueTime: '08:00', estMin: 60 * 40 });
      const a = attention(t, ctx(), NOW);
      expect(a?.impossible).toBe(true);
      expect(a?.reason).toContain('no longer fits');
    });

    it('leaves the night out when night work is switched off', () => {
      // 14h of waking capacity, 9h of night. 16h 40m of work fits only with
      // the night included, so switching it off makes the task impossible.
      const t = task({ due: '2026-03-06', dueTime: '08:00', estMin: 1000 });
      const a = attention(
        t,
        ctx([], { ...S, nightReserveEnabled: false }),
        NOW,
      );
      expect(a?.reason).not.toContain('through the night');
      expect(a?.impossible).toBe(true);
    });
  });

  it('calls a started task at risk rather than telling you to start it', () => {
    const t = task({
      due: '2026-03-06',
      dueTime: '09:00',
      estMin: 240,
      actualStart: NOW - 60_000,
      progress: 5,
    });
    const busy = packedDay();
    expect(attention(t, ctx(busy), NOW)?.kind).toBe('risk');
  });

  it('widens with the buffer setting', () => {
    const t = task({ due: '2026-03-06', dueTime: '09:00', estMin: 60 * 10 });
    expect(attention(t, ctx(), NOW)).toBeNull();
    expect(attention(t, ctx([], { ...S, buffer: 2 }), NOW)?.kind).toBe('start');
  });
});
