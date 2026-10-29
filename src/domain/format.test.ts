import { describe, expect, it } from 'vitest';
import {
  countdown,
  fmtClock,
  fmtDay,
  fmtDur,
  pct,
  ratio,
  relDay,
  relDue,
  shortWhen,
} from './format';
import { wallToInstant } from './zone';

const TZ = 'Asia/Singapore';
const at = (d: string, t: string) => wallToInstant(d, t, TZ);
const NOW = at('2026-03-05', '09:00');

describe('fmtDur', () => {
  it('formats minutes, hours and mixtures', () => {
    expect(fmtDur(0)).toBe('0m');
    expect(fmtDur(45)).toBe('45m');
    expect(fmtDur(60)).toBe('1h');
    expect(fmtDur(90)).toBe('1h 30m');
    expect(fmtDur(1440)).toBe('24h');
  });
  it('rounds and never goes negative', () => {
    expect(fmtDur(89.6)).toBe('1h 30m');
    expect(fmtDur(-10)).toBe('0m');
    expect(fmtDur(NaN)).toBe('0m');
  });
});

describe('fmtClock', () => {
  it('pads minutes and seconds', () => {
    expect(fmtClock(0)).toBe('0:00:00');
    expect(fmtClock(61)).toBe('0:01:01');
    expect(fmtClock(3661)).toBe('1:01:01');
  });
});

describe('countdown', () => {
  it('coarsens as the distance grows', () => {
    expect(countdown(30 * 60_000)).toBe('30m');
    expect(countdown(90 * 60_000)).toBe('1h 30m');
    expect(countdown(3 * 86_400_000)).toBe('3d');
    expect(countdown(3.5 * 86_400_000)).toBe('3d 12h');
  });
});

describe('relDue', () => {
  it('names the near days', () => {
    expect(relDue(at('2026-03-05', '17:00'), NOW, TZ)).toBe('today 17:00');
    expect(relDue(at('2026-03-06', '17:00'), NOW, TZ)).toBe('tomorrow 17:00');
    expect(relDue(at('2026-03-04', '17:00'), NOW, TZ)).toBe('yesterday 17:00');
  });
  it('uses the weekday within the coming week', () => {
    expect(relDue(at('2026-03-08', '17:00'), NOW, TZ)).toBe('Sun 17:00');
  });
  it('falls back to a date further out', () => {
    expect(relDue(at('2026-04-02', '17:00'), NOW, TZ)).toBe('Thu 2 Apr 17:00');
  });
  // 23:59 is the default, so printing it would be noise.
  it('drops an end-of-day time', () => {
    expect(relDue(at('2026-03-06', '23:59'), NOW, TZ)).toBe('tomorrow');
  });
});

describe('shortWhen', () => {
  it('abbreviates for chips', () => {
    expect(shortWhen(at('2026-03-05', '17:00'), NOW, TZ)).toBe('Today 17:00');
    expect(shortWhen(at('2026-03-06', '09:30'), NOW, TZ)).toBe('Tmr 09:30');
    expect(shortWhen(at('2026-03-04', '09:30'), NOW, TZ)).toBe('Yest 09:30');
    expect(shortWhen(at('2026-03-08', '09:30'), NOW, TZ)).toBe('Sun 09:30');
    expect(shortWhen(at('2026-04-02', '09:30'), NOW, TZ)).toBe('2 Apr 09:30');
  });
});

describe('relDay and fmtDay', () => {
  it('names days relative to today', () => {
    expect(relDay('2026-03-05', '2026-03-05', TZ)).toBe('today');
    expect(relDay('2026-03-06', '2026-03-05', TZ)).toBe('tomorrow');
    expect(relDay('2026-03-04', '2026-03-05', TZ)).toBe('yesterday');
    expect(relDay('2026-03-01', '2026-03-05', TZ)).toBe('4 days ago');
  });
  it('formats an absolute day', () => {
    expect(fmtDay('2026-03-05', TZ)).toBe('Thu 5 Mar');
  });
});

describe('pct and ratio', () => {
  it('format or dash out', () => {
    expect(pct(0.756)).toBe('76%');
    expect(pct(null)).toBe('—');
    expect(ratio(1.4)).toBe('1.40×');
    expect(ratio(null)).toBe('—');
  });
});
