import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayOfWeek,
  daysBetween,
  instantToDate,
  instantToTime,
  isDateStr,
  isTimeStr,
  startOfDay,
  wallToInstant,
} from './zone';

const SG = 'Asia/Singapore'; // UTC+8, no daylight saving
const NY = 'America/New_York'; // has daylight saving — the interesting case
const UTC = 'UTC';

describe('isDateStr', () => {
  it('accepts real dates', () => {
    for (const d of ['2026-01-01', '2028-02-29', '2026-12-31']) {
      expect(isDateStr(d)).toBe(true);
    }
  });

  it('rejects malformed and impossible dates', () => {
    for (const d of [
      '2026-1-1',
      '26-01-01',
      '2026-13-01',
      '2026-00-10',
      '2026-02-31',
      '2026-02-29', // 2026 is not a leap year
      '2027-02-29',
      '',
      null,
      undefined,
      20260101,
    ]) {
      expect(isDateStr(d)).toBe(false);
    }
  });
});

describe('isTimeStr', () => {
  it('accepts valid times including both midnights', () => {
    for (const t of ['00:00', '09:05', '23:59', '12:00']) {
      expect(isTimeStr(t)).toBe(true);
    }
  });

  it('rejects out-of-range and malformed times', () => {
    for (const t of ['24:00', '9:05', '23:60', '0800', '', null]) {
      expect(isTimeStr(t)).toBe(false);
    }
  });
});

describe('wallToInstant', () => {
  it('resolves a Singapore wall time to the right instant', () => {
    // 2026-03-05 09:00 +08:00 === 01:00 UTC
    expect(wallToInstant('2026-03-05', '09:00', SG)).toBe(
      Date.UTC(2026, 2, 5, 1, 0),
    );
  });

  it('is the identity in UTC', () => {
    expect(wallToInstant('2026-03-05', '09:00', UTC)).toBe(
      Date.UTC(2026, 2, 5, 9, 0),
    );
  });

  it('handles midnight, the value a bare date resolves to', () => {
    expect(wallToInstant('2026-03-05', '00:00', SG)).toBe(
      Date.UTC(2026, 2, 4, 16, 0),
    );
  });

  it('handles 23:59, the default due time', () => {
    expect(wallToInstant('2026-03-05', '23:59', SG)).toBe(
      Date.UTC(2026, 2, 5, 15, 59),
    );
  });

  // The second correction pass exists for exactly these two days.
  it('is correct the day before a daylight-saving spring forward', () => {
    // US DST begins 2026-03-08. On 03-07, New York is still UTC-5.
    expect(wallToInstant('2026-03-07', '12:00', NY)).toBe(
      Date.UTC(2026, 2, 7, 17, 0),
    );
  });

  it('is correct the day after a spring forward', () => {
    // On 03-09, New York is UTC-4.
    expect(wallToInstant('2026-03-09', '12:00', NY)).toBe(
      Date.UTC(2026, 2, 9, 16, 0),
    );
  });

  it('is correct after an autumn fall back', () => {
    // US DST ends 2026-11-01; on 11-02 New York is back to UTC-5.
    expect(wallToInstant('2026-11-02', '12:00', NY)).toBe(
      Date.UTC(2026, 10, 2, 17, 0),
    );
  });

  it('round-trips every hour of a day', () => {
    for (let h = 0; h < 24; h++) {
      const t = `${String(h).padStart(2, '0')}:30`;
      const ms = wallToInstant('2026-06-15', t, SG);
      expect(instantToTime(ms, SG)).toBe(t);
      expect(instantToDate(ms, SG)).toBe('2026-06-15');
    }
  });
});

describe('instantToDate', () => {
  // The bug this guards: an evening task in Singapore is already "tomorrow"
  // in UTC, so a server computing dates without the zone shows the wrong day.
  it('reports the local date, not the UTC one', () => {
    const ms = Date.UTC(2026, 2, 5, 17, 0); // 05 Mar 17:00 UTC
    expect(instantToDate(ms, UTC)).toBe('2026-03-05');
    expect(instantToDate(ms, SG)).toBe('2026-03-06'); // already next day in SG
  });
});

describe('dayOfWeek', () => {
  it('reports the local weekday', () => {
    // 2026-03-05 is a Thursday.
    expect(dayOfWeek(wallToInstant('2026-03-05', '12:00', SG), SG)).toBe(4);
  });

  it('can differ from the UTC weekday near midnight', () => {
    const ms = wallToInstant('2026-03-06', '01:00', SG); // Fri 01:00 SG
    expect(dayOfWeek(ms, SG)).toBe(5); // Friday locally
    expect(dayOfWeek(ms, UTC)).toBe(4); // still Thursday in UTC
  });
});

describe('startOfDay', () => {
  it('is midnight in the given zone', () => {
    const ms = startOfDay('2026-03-05', SG);
    expect(instantToTime(ms, SG)).toBe('00:00');
    expect(instantToDate(ms, SG)).toBe('2026-03-05');
  });
});

describe('addDays', () => {
  it('moves forward and backward', () => {
    expect(addDays('2026-03-05', 1)).toBe('2026-03-06');
    expect(addDays('2026-03-05', -1)).toBe('2026-03-04');
    expect(addDays('2026-03-05', 0)).toBe('2026-03-05');
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles leap and non-leap Februaries', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // 2028 is a leap year
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01'); // 2026 is not
  });
});

describe('daysBetween', () => {
  it('counts whole calendar days in both directions', () => {
    expect(daysBetween('2026-03-05', '2026-03-08')).toBe(3);
    expect(daysBetween('2026-03-08', '2026-03-05')).toBe(-3);
    expect(daysBetween('2026-03-05', '2026-03-05')).toBe(0);
  });

  // Counting hours instead of calendar days would give 0 across a DST change.
  it('is unaffected by daylight saving', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
  });
});
