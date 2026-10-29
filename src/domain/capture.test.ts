import { describe, expect, it } from 'vitest';
import { dowOf, makeDate, nextDow, parseCapture } from './capture';
import type { Category } from './types';

const CATS: Category[] = [
  { id: 'work', name: 'Work', color: '#000000' },
  { id: 'school', name: 'School', color: '#000000' },
  { id: 'personal', name: 'Personal', color: '#000000' },
  { id: 'cca', name: 'Club CCA', color: '#000000' },
];

// A frozen Thursday, so every weekday case is deterministic.
const TODAY = '2026-03-05';
const p = (raw: string, now = '09:00') => parseCapture(raw, CATS, TODAY, now);

describe('dowOf', () => {
  it('knows the reference day is a Thursday', () => {
    expect(dowOf(TODAY)).toBe(4);
  });
});

describe('nextDow', () => {
  it('finds the coming weekday', () => {
    expect(nextDow(5, '', TODAY)).toBe('2026-03-06'); // Friday
    expect(nextDow(1, '', TODAY)).toBe('2026-03-09'); // Monday
  });

  // Worth knowing: a bare weekday never means today.
  it('means a week away when the weekday is today', () => {
    expect(nextDow(4, '', TODAY)).toBe('2026-03-12');
  });

  it('"this" allows today', () => {
    expect(nextDow(4, 'this', TODAY)).toBe(TODAY);
  });

  it('"next" means the following ISO week', () => {
    expect(nextDow(5, 'next', TODAY)).toBe('2026-03-13');
    expect(nextDow(1, 'next', TODAY)).toBe('2026-03-09');
  });
});

describe('makeDate', () => {
  it('builds a date in the current year', () => {
    expect(makeDate(15, 2, null, TODAY)).toBe('2026-03-15');
  });

  it('rolls a well-past date into next year', () => {
    // 3 January, said in March, means the January coming.
    expect(makeDate(3, 0, null, TODAY)).toBe('2027-01-03');
  });

  it('keeps a recently-past date in this year', () => {
    expect(makeDate(1, 2, null, TODAY)).toBe('2026-03-01');
  });

  it('honours an explicit year, including two digits', () => {
    expect(makeDate(15, 2, 2028, TODAY)).toBe('2028-03-15');
    expect(makeDate(15, 2, 28, TODAY)).toBe('2028-03-15');
  });

  it('rejects impossible dates', () => {
    expect(makeDate(31, 1, null, TODAY)).toBeNull(); // 31 February
    expect(makeDate(0, 2, null, TODAY)).toBeNull();
    expect(makeDate(32, 2, null, TODAY)).toBeNull();
  });
});

describe('parseCapture — relative dates', () => {
  const cases: Array<[string, string]> = [
    ['Essay today', TODAY],
    ['Essay tdy', TODAY],
    ['Essay tonight', TODAY],
    ['Essay tomorrow', '2026-03-06'],
    ['Essay tmr', '2026-03-06'],
    ['Essay tml', '2026-03-06'],
    ['Essay tmrw', '2026-03-06'],
    ['Essay friday', '2026-03-06'],
    ['Essay fri', '2026-03-06'],
    ['Essay this friday', '2026-03-06'],
    ['Essay next friday', '2026-03-13'],
    ['Essay in 3 days', '2026-03-08'],
    ['Essay in 2 weeks', '2026-03-19'],
  ];
  for (const [input, due] of cases) {
    it(`"${input}" → ${due}`, () => {
      const r = p(input);
      expect(r.due).toBe(due);
      expect(r.found.due).toBe(true);
      expect(r.title).toBe('Essay');
    });
  }
});

describe('parseCapture — absolute dates', () => {
  const cases: Array<[string, string]> = [
    ['Essay 15/3', '2026-03-15'],
    ['Essay 15.3', '2026-03-15'],
    ['Essay 15/3/28', '2028-03-15'],
    ['Essay 15mar', '2026-03-15'],
    ['Essay 15 march', '2026-03-15'],
    ['Essay 15th march', '2026-03-15'],
    ['Essay march 15', '2026-03-15'],
    ['Essay mar 15th', '2026-03-15'],
  ];
  for (const [input, due] of cases) {
    it(`"${input}" → ${due}`, () => {
      expect(p(input).due).toBe(due);
    });
  }
});

describe('parseCapture — times', () => {
  const cases: Array<[string, string]> = [
    ['Call tomorrow 5pm', '17:00'],
    ['Call tomorrow 5:30pm', '17:30'],
    ['Call tomorrow 5 pm', '17:00'],
    ['Call tomorrow 11am', '11:00'],
    ['Call tomorrow 12pm', '12:00'],
    ['Call tomorrow 12am', '00:00'],
    ['Call tomorrow 17:30', '17:30'],
    ['Call tomorrow noon', '12:00'],
    ['Call tomorrow midnight', '23:59'],
    ['Call tomorrow eod', '23:59'],
  ];
  for (const [input, time] of cases) {
    it(`"${input}" → ${time}`, () => {
      const r = p(input);
      expect(r.dueTime).toBe(time);
      expect(r.found.time).toBe(true);
    });
  }

  it('reads a bare 24-hour number only in a trailing segment', () => {
    expect(p('Report, 1730').dueTime).toBe('17:30');
    // In the title it would swallow "40" from "40 slides", so it is not loose.
    expect(p('Report 1730').found.time).toBe(false);
  });

  it('defaults a stated date to the end of the day', () => {
    expect(p('Essay tomorrow').dueTime).toBe('23:59');
  });

  it('puts a bare time today when it is still ahead', () => {
    expect(p('Call 5pm', '09:00').due).toBe(TODAY);
  });

  it('puts a bare time tomorrow when it has passed', () => {
    expect(p('Call 5pm', '19:00').due).toBe('2026-03-06');
  });
});

describe('parseCapture — durations', () => {
  const cases: Array<[string, number]> = [
    ['Essay ~3h', 180],
    ['Essay 3h', 180],
    ['Essay 3hr', 180],
    ['Essay 3 hours', 180],
    ['Essay 1.5h', 90],
    ['Essay 2h30m', 150],
    ['Essay 2h30', 150],
    ['Essay 45min', 45],
    ['Essay 45 mins', 45],
    ['Essay 90m', 90],
  ];
  for (const [input, est] of cases) {
    it(`"${input}" → ${est}m`, () => {
      const r = p(input);
      expect(r.estMin).toBe(est);
      expect(r.found.est).toBe(true);
    });
  }
});

describe('parseCapture — categories', () => {
  it('reads a #tag anywhere in the line', () => {
    expect(p('IB report #school tomorrow').categoryId).toBe('school');
  });

  it('reads a bare category name at the end', () => {
    expect(p('Expenses work').categoryId).toBe('work');
  });

  it('matches a category by prefix', () => {
    expect(p('Essay schoo').categoryId).toBe('school');
  });

  it('matches a two-word category name', () => {
    expect(p('Rehearsal club cca').categoryId).toBe('cca');
  });

  it('is case-insensitive', () => {
    expect(p('Essay #SCHOOL').categoryId).toBe('school');
  });

  // "Email to work" is about work, not filed under Work.
  it('does not take a category after a preposition', () => {
    const r = p('Send invoice to work');
    expect(r.categoryId).toBeNull();
    expect(r.title).toBe('Send invoice to work');
  });

  it('ignores an unknown tag without breaking the title', () => {
    const r = p('Essay #nonsense tomorrow');
    expect(r.categoryId).toBeNull();
    expect(r.title).toBe('Essay');
  });
});

describe('parseCapture — whole lines', () => {
  it('handles the placeholder example', () => {
    const r = p('IB report, Fri 5pm, ~3h, #school');
    expect(r).toMatchObject({
      title: 'IB report',
      due: '2026-03-06',
      dueTime: '17:00',
      estMin: 180,
      categoryId: 'school',
    });
    expect(r.found).toEqual({
      due: true,
      time: true,
      est: true,
      category: true,
      size: false,
    });
  });

  it('handles "due" as a separator inside the title', () => {
    const r = p('Finish slide deck due next monday 2pm');
    expect(r.title).toBe('Finish slide deck');
    expect(r.due).toBe('2026-03-09');
    expect(r.dueTime).toBe('14:00');
  });

  it('keeps unrecognised trailing text as notes', () => {
    const r = p('Essay, tomorrow, ask Prof Tan about scope');
    expect(r.due).toBe('2026-03-06');
    expect(r.notes).toEqual(['ask Prof Tan about scope']);
  });

  it('capitalises the title', () => {
    expect(p('email supervisor tomorrow').title).toBe('Email supervisor');
  });

  it('strips a dangling preposition from the title', () => {
    expect(p('Revise notes by tomorrow').title).toBe('Revise notes');
  });

  it('records a size phrase as a hint rather than an estimate', () => {
    const r = p('Make 40 slides for the pitch, friday');
    expect(r.found.size).toBe(true);
    expect(r.size).toBe('40 slides');
    expect(r.estMin).toBeNull(); // deliberately not converted
  });

  it('returns an empty result for empty input', () => {
    const r = p('   ');
    expect(r.title).toBe('');
    expect(r.due).toBeNull();
    expect(r.found.due).toBe(false);
  });

  it('keeps a title that is only a date word', () => {
    // One token cannot be consumed as a detail, or nothing would be left.
    expect(p('tomorrow').title).toBe('Tomorrow');
  });

  it('does not let a second date overwrite the first', () => {
    const r = p('Essay, tomorrow, friday');
    expect(r.due).toBe('2026-03-06');
  });

  it('handles several details in one trailing segment', () => {
    const r = p('Deck; fri 5pm ~2h work');
    expect(r).toMatchObject({
      due: '2026-03-06',
      dueTime: '17:00',
      estMin: 120,
      categoryId: 'work',
    });
  });
});
