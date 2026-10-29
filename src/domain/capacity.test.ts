import { describe, expect, it } from 'vitest';
import {
  capacityMin,
  eventBounds,
  freeBlocks,
  longestBlockMin,
  reserveMin,
  resolveUsableFraction,
  segmentsIn,
} from './capacity';
import { DEFAULT_SETTINGS, type CalEvent, type EngineContext } from './types';
import { instantToTime, wallToInstant } from './zone';

const TZ = 'Asia/Singapore';
const S = { ...DEFAULT_SETTINGS, timezone: TZ };
const at = (date: string, time: string) => wallToInstant(date, time, TZ);
const DAY = '2026-03-05'; // a Thursday

function ev(partial: Partial<CalEvent> & { id: string }): CalEvent {
  return {
    accountId: 'acc',
    title: 'Event',
    startsAt: null,
    endsAt: null,
    startDate: null,
    endDate: null,
    allDay: false,
    busy: true,
    usableFraction: null,
    ...partial,
  };
}

function timed(
  id: string,
  from: string,
  to: string,
  extra: Partial<CalEvent> = {},
) {
  return ev({ id, startsAt: at(DAY, from), endsAt: at(DAY, to), ...extra });
}

function ctx(events: CalEvent[] = [], settings = S): EngineContext {
  return { settings, events, accounts: [] };
}

describe('resolveUsableFraction', () => {
  it('treats a short meeting as fully blocking', () => {
    expect(
      resolveUsableFraction(timed('a', '10:00', '10:30'), undefined, S),
    ).toBe(0);
  });

  // The 9-to-6 job: one long event that still contains usable task time.
  it('treats a long event as a porous container', () => {
    expect(
      resolveUsableFraction(timed('a', '09:00', '18:00'), undefined, S),
    ).toBe(0.3);
  });

  it('uses the long-event rule exactly at the threshold', () => {
    expect(
      resolveUsableFraction(timed('a', '09:00', '13:00'), undefined, S),
    ).toBe(0.3);
    expect(
      resolveUsableFraction(timed('a', '09:00', '12:59'), undefined, S),
    ).toBe(0);
  });

  it('leaves all-day events fully usable by default, as the artifact did', () => {
    const holiday = ev({
      id: 'h',
      allDay: true,
      startDate: DAY,
      endDate: '2026-03-06',
    });
    expect(resolveUsableFraction(holiday, undefined, S)).toBe(1);
  });

  it('never blocks an event marked free, whatever its length', () => {
    expect(
      resolveUsableFraction(
        timed('a', '09:00', '18:00', { busy: false }),
        undefined,
        S,
      ),
    ).toBe(1);
  });

  it('prefers a per-event override to every default', () => {
    expect(
      resolveUsableFraction(
        timed('a', '10:00', '10:30', { usableFraction: 0.5 }),
        undefined,
        S,
      ),
    ).toBe(0.5);
  });

  it('prefers a calendar default to the heuristic', () => {
    const account = { id: 'acc', defaultUsableFraction: 0.6 };
    expect(
      resolveUsableFraction(timed('a', '10:00', '10:30'), account, S),
    ).toBe(0.6);
  });

  it('lets a per-event override beat the calendar default', () => {
    const account = { id: 'acc', defaultUsableFraction: 0.6 };
    expect(
      resolveUsableFraction(
        timed('a', '10:00', '10:30', { usableFraction: 0 }),
        account,
        S,
      ),
    ).toBe(0);
  });
});

describe('eventBounds', () => {
  it('treats an all-day end date as exclusive, per the iCal convention', () => {
    const b = eventBounds(
      ev({ id: 'a', allDay: true, startDate: DAY, endDate: '2026-03-06' }),
      TZ,
    );
    expect(b).toEqual({
      start: at(DAY, '00:00'),
      end: at('2026-03-06', '00:00'),
    });
  });

  it('treats a same-day all-day event as one whole day', () => {
    const b = eventBounds(
      ev({ id: 'a', allDay: true, startDate: DAY, endDate: DAY }),
      TZ,
    );
    expect(b?.end).toBe(at('2026-03-06', '00:00'));
  });
});

describe('segmentsIn', () => {
  it('reports a clear window as fully available', () => {
    const segs = segmentsIn(at(DAY, '09:00'), at(DAY, '12:00'), ctx());
    expect(segs).toHaveLength(1);
    expect(segs[0]!.available).toBe(1);
  });

  // Two overlapping meetings must not consume 200% of an hour.
  it('takes the most blocking event where events overlap', () => {
    const c = ctx([
      timed('a', '10:00', '11:00', { usableFraction: 0.5 }),
      timed('b', '10:30', '11:30', { usableFraction: 0 }),
    ]);
    const segs = segmentsIn(at(DAY, '10:00'), at(DAY, '12:00'), c);
    const available = (t: string) =>
      segs.find((s) => s.start <= at(DAY, t) && s.end > at(DAY, t))!.available;
    expect(available('10:15')).toBe(0.5); // porous only
    expect(available('10:45')).toBe(0); // the blocking one wins
    expect(available('11:15')).toBe(0); // blocking only
    expect(available('11:45')).toBe(1); // clear
  });
});

describe('capacityMin', () => {
  it('counts a clear waking day', () => {
    // 08:00–23:00 is 15 hours.
    expect(
      capacityMin(at(DAY, '00:00'), at('2026-03-06', '00:00'), ctx()),
    ).toBe(900);
  });

  it('excludes the sleep window entirely', () => {
    // Midnight to 08:00 is sleep, so no ordinary capacity at all.
    expect(capacityMin(at(DAY, '00:00'), at(DAY, '08:00'), ctx())).toBe(0);
  });

  it('subtracts a fully blocking meeting', () => {
    const c = ctx([timed('a', '10:00', '11:00')]);
    expect(capacityMin(at(DAY, '09:00'), at(DAY, '12:00'), c)).toBe(120);
  });

  // The whole point: a nine-hour workday leaves usable time behind.
  it('subtracts only the blocked part of a porous workday', () => {
    const c = ctx([timed('work', '09:00', '18:00')]);
    // 08:00–23:00 = 900 min. The 9h block is 30% usable, so it blocks 70% of
    // 540 = 378 min. 900 - 378 = 522.
    expect(capacityMin(at(DAY, '00:00'), at('2026-03-06', '00:00'), c)).toBe(
      522,
    );
  });

  it('applies the realism factor', () => {
    const c = ctx([], { ...S, capacityFactor: 0.5 });
    expect(capacityMin(at(DAY, '00:00'), at('2026-03-06', '00:00'), c)).toBe(
      450,
    );
  });

  it('is zero for an inverted or empty range', () => {
    expect(capacityMin(at(DAY, '12:00'), at(DAY, '09:00'), ctx())).toBe(0);
    expect(capacityMin(at(DAY, '12:00'), at(DAY, '12:00'), ctx())).toBe(0);
  });

  it('accumulates across several days', () => {
    // 5th, 6th and 7th: three waking days of 15 hours each.
    expect(
      capacityMin(at(DAY, '00:00'), at('2026-03-08', '00:00'), ctx()),
    ).toBe(2700);
  });
});

describe('reserveMin', () => {
  it('measures the night as reserve, not as capacity', () => {
    // 00:00–08:00 on the day itself is eight hours of sleep window.
    expect(reserveMin(at(DAY, '00:00'), at(DAY, '08:00'), ctx())).toBe(480);
  });

  it('counts the evening night from 23:00 onward', () => {
    expect(reserveMin(at(DAY, '22:00'), at('2026-03-06', '02:00'), ctx())).toBe(
      180,
    );
  });

  it('is zero when night work is switched off', () => {
    const c = ctx([], { ...S, nightReserveEnabled: false });
    expect(reserveMin(at(DAY, '00:00'), at(DAY, '08:00'), c)).toBe(0);
  });

  it('still subtracts events that fall inside the night', () => {
    const c = ctx([timed('flight', '02:00', '04:00')]);
    expect(reserveMin(at(DAY, '00:00'), at(DAY, '08:00'), c)).toBe(360);
  });
});

describe('freeBlocks', () => {
  it('returns the clear stretches of a day around a meeting', () => {
    const c = ctx([timed('a', '12:00', '13:00')]);
    const blocks = freeBlocks(at(DAY, '08:00'), at(DAY, '18:00'), 30, c);
    expect(
      blocks.map(([a, b]) => [instantToTime(a, TZ), instantToTime(b, TZ)]),
    ).toEqual([
      ['08:00', '12:00'],
      ['13:00', '18:00'],
    ]);
  });

  it('drops stretches shorter than the minimum asked for', () => {
    const c = ctx([timed('a', '08:20', '09:00')]);
    const blocks = freeBlocks(at(DAY, '08:00'), at(DAY, '10:00'), 30, c);
    expect(blocks).toHaveLength(1); // the 20-minute sliver is not offered
    expect(instantToTime(blocks[0]![0], TZ)).toBe('09:00');
  });

  // Capacity versus schedulability: porous minutes exist but have no position.
  it('yields no block inside a porous event, even though it has capacity', () => {
    const c = ctx([timed('work', '09:00', '18:00')]);
    expect(capacityMin(at(DAY, '09:00'), at(DAY, '18:00'), c)).toBeGreaterThan(
      0,
    );
    const blocks = freeBlocks(at(DAY, '09:00'), at(DAY, '18:00'), 30, c);
    expect(blocks).toEqual([]);
  });

  it('never proposes a slot during the night', () => {
    const blocks = freeBlocks(at(DAY, '00:00'), at(DAY, '08:00'), 30, ctx());
    expect(blocks).toEqual([]);
  });

  it('does not join stretches across a night', () => {
    const blocks = freeBlocks(
      at(DAY, '20:00'),
      at('2026-03-06', '12:00'),
      30,
      ctx(),
    );
    expect(blocks).toHaveLength(2);
  });
});

describe('longestBlockMin', () => {
  it('finds the biggest uninterrupted stretch', () => {
    const c = ctx([timed('a', '11:00', '11:30'), timed('b', '15:00', '15:30')]);
    // 08:00-11:00 = 180, 11:30-15:00 = 210, 15:30-23:00 = 450.
    expect(longestBlockMin(at(DAY, '08:00'), at(DAY, '23:00'), c)).toBe(450);
  });
});
