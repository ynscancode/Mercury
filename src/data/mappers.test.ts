import { describe, expect, it } from 'vitest';
import {
  calEventFromRow,
  categoryFromRow,
  fromInstant,
  fromTimeStr,
  settingsFromRow,
  settingsToRow,
  taskFromRow,
  taskToRow,
  toInstant,
  toTimeStr,
  type SettingsRow,
  type TaskRow,
} from './mappers';
import { makeTask } from '@/domain/task';
import { DEFAULT_SETTINGS } from '@/domain/types';

const baseRow: TaskRow = {
  id: 't1',
  user_id: 'u1',
  title: 'Write report',
  category_id: 'c1',
  notes: '',
  planned_start: null,
  planned_start_time: null,
  target_finish: null,
  target_finish_time: null,
  due: null,
  due_time: null,
  est_min: 0,
  logged_min: 0,
  est_source: null,
  logged_source: null,
  progress: 0,
  progress_before: null,
  actual_start: null,
  completed_at: null,
  timer_start: null,
  priority_mode: 'auto',
  priority_manual: null,
  last_notified_priority: null,
  deleted_at: null,
  archived_at: null,
  source_event: null,
  notion_id: null,
  backed_up_at: null,
  is_example: false,
  created_at: null,
  updated_at: null,
};

describe('toTimeStr', () => {
  // Postgres hands back HH:MM:SS; <input type="time"> wants HH:MM.
  it('trims seconds off a Postgres time', () => {
    expect(toTimeStr('17:30:00')).toBe('17:30');
    expect(toTimeStr('08:00:00.000')).toBe('08:00');
  });
  it('passes through a value that is already HH:MM', () => {
    expect(toTimeStr('17:30')).toBe('17:30');
  });
  it('maps empty and null to null', () => {
    expect(toTimeStr(null)).toBeNull();
    expect(toTimeStr('')).toBeNull();
    expect(toTimeStr('nonsense')).toBeNull();
  });
  it('round-trips through fromTimeStr', () => {
    expect(toTimeStr(fromTimeStr('09:05'))).toBe('09:05');
    expect(fromTimeStr(null)).toBeNull();
  });
});

describe('toInstant', () => {
  it('parses an ISO timestamp to epoch ms', () => {
    expect(toInstant('2026-03-05T09:00:00.000Z')).toBe(Date.UTC(2026, 2, 5, 9));
  });
  it('maps null and unparseable values to null', () => {
    expect(toInstant(null)).toBeNull();
    expect(toInstant('not a date')).toBeNull();
  });
  it('round-trips through fromInstant', () => {
    const ms = Date.UTC(2026, 2, 5, 9, 30);
    expect(toInstant(fromInstant(ms))).toBe(ms);
  });
});

describe('taskFromRow', () => {
  it('maps a minimal row', () => {
    const t = taskFromRow(baseRow);
    expect(t).toMatchObject({
      id: 't1',
      title: 'Write report',
      categoryId: 'c1',
      notes: '',
      estMin: 0,
      progress: 0,
      priorityMode: 'auto',
      priorityManual: null,
    });
  });

  it('trims every time column', () => {
    const t = taskFromRow({
      ...baseRow,
      due: '2026-03-05',
      due_time: '17:30:00',
      planned_start: '2026-03-04',
      planned_start_time: '08:00:00',
      target_finish: '2026-03-05',
      target_finish_time: '12:00:00',
    });
    expect(t.dueTime).toBe('17:30');
    expect(t.plannedStartTime).toBe('08:00');
    expect(t.targetFinishTime).toBe('12:00');
  });

  // numeric can arrive as a string depending on the driver path.
  it('coerces numerics that arrive as strings', () => {
    const t = taskFromRow({
      ...baseRow,
      est_min: '240',
      logged_min: '95.5',
      progress: '40',
    });
    expect(t.estMin).toBe(240);
    expect(t.loggedMin).toBe(95.5);
    expect(t.progress).toBe(40);
  });

  it('defaults missing numerics to zero rather than NaN', () => {
    const t = taskFromRow({
      ...baseRow,
      est_min: null,
      logged_min: null,
      progress: null,
    });
    expect(t.estMin).toBe(0);
    expect(t.loggedMin).toBe(0);
    expect(t.progress).toBe(0);
  });

  it('maps a pinned priority', () => {
    const t = taskFromRow({
      ...baseRow,
      priority_mode: 'manual',
      priority_manual: 'high',
    });
    expect(t.priorityMode).toBe('manual');
    expect(t.priorityManual).toBe('high');
  });

  it('ignores an unrecognised priority level', () => {
    const t = taskFromRow({ ...baseRow, priority_manual: 'urgent' });
    expect(t.priorityManual).toBeNull();
  });

  it('maps soft delete and archive timestamps', () => {
    const t = taskFromRow({
      ...baseRow,
      deleted_at: '2026-03-05T09:00:00Z',
      archived_at: '2026-03-06T09:00:00Z',
    });
    expect(t.deletedAt).toBe(Date.UTC(2026, 2, 5, 9));
    expect(t.archivedAt).toBe(Date.UTC(2026, 2, 6, 9));
  });
});

describe('taskToRow', () => {
  it('round-trips a fully populated task', () => {
    const original = makeTask({
      id: 't1',
      title: 'Write report',
      categoryId: 'c1',
      notes: 'draft first',
      plannedStart: '2026-03-04',
      plannedStartTime: '08:00',
      targetFinish: '2026-03-05',
      targetFinishTime: '12:00',
      due: '2026-03-06',
      dueTime: '17:30',
      estMin: 240,
      loggedMin: 95,
      progress: 40,
      actualStart: Date.UTC(2026, 2, 4, 9),
      priorityMode: 'manual',
      priorityManual: 'high',
    });
    const back = taskFromRow({
      ...taskToRow(original, 'u1'),
      updated_at: null,
    } as TaskRow);
    expect(back).toMatchObject({
      title: 'Write report',
      plannedStartTime: '08:00',
      targetFinishTime: '12:00',
      dueTime: '17:30',
      estMin: 240,
      loggedMin: 95,
      progress: 40,
      priorityMode: 'manual',
      priorityManual: 'high',
    });
  });

  // The database rejects both halves of an inconsistent pin, so the mapper
  // normalises rather than passing a contradiction through.
  it('drops a stale pinned level when the mode is automatic', () => {
    const row = taskToRow(
      makeTask({
        id: 't',
        title: 'T',
        priorityMode: 'auto',
        priorityManual: 'high',
      }),
      'u1',
    );
    expect(row.priority_mode).toBe('auto');
    expect(row.priority_manual).toBeNull();
  });

  it('supplies a level when the mode is manual but none was set', () => {
    const row = taskToRow(
      makeTask({
        id: 't',
        title: 'T',
        priorityMode: 'manual',
        priorityManual: null,
      }),
      'u1',
    );
    expect(row.priority_mode).toBe('manual');
    expect(row.priority_manual).toBe('med');
  });

  // A time without its date violates a CHECK constraint.
  it('drops a time whose date is absent', () => {
    const row = taskToRow(
      makeTask({ id: 't', title: 'T', due: null, dueTime: '17:00' }),
      'u1',
    );
    expect(row.due_time).toBeNull();
  });

  it('writes times back in the Postgres format', () => {
    const row = taskToRow(
      makeTask({ id: 't', title: 'T', due: '2026-03-05', dueTime: '17:30' }),
      'u1',
    );
    expect(row.due_time).toBe('17:30:00');
  });
});

describe('settings mapping', () => {
  const row: SettingsRow = {
    user_id: 'u1',
    buffer: '1.2',
    wake_start: '08:00:00',
    wake_end: '23:00:00',
    high_days: 3,
    med_days: 14,
    escalate_when_no_fit: true,
    overdue_always_high: true,
    no_due_priority: 'low',
    long_event_hours: '4.0',
    long_event_usable: '0.30',
    allday_usable: '1.00',
    capacity_factor: '1.00',
    night_reserve_enabled: true,
    timezone: 'Asia/Singapore',
  };

  it('maps a row, coercing numerics and trimming times', () => {
    const s = settingsFromRow(row);
    expect(s).toMatchObject({
      buffer: 1.2,
      wakeStart: '08:00',
      wakeEnd: '23:00',
      longEventUsable: 0.3,
      capacityFactor: 1,
      timezone: 'Asia/Singapore',
    });
  });

  it('falls back to defaults when no row exists yet', () => {
    expect(settingsFromRow(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('ignores an unrecognised no-due-date choice', () => {
    expect(
      settingsFromRow({ ...row, no_due_priority: 'nonsense' }).noDuePriority,
    ).toBe('low');
  });

  it('round-trips', () => {
    expect(settingsFromRow(settingsToRow(DEFAULT_SETTINGS, 'u1'))).toEqual(
      DEFAULT_SETTINGS,
    );
  });
});

describe('calendar mapping', () => {
  it('keeps a null usable fraction null, since null means "use the default"', () => {
    const e = calEventFromRow({
      id: 'e1',
      account_id: 'a1',
      title: 'Standup',
      starts_at: '2026-03-05T01:00:00Z',
      ends_at: '2026-03-05T01:30:00Z',
      start_date: null,
      end_date: null,
      all_day: false,
      busy: true,
      usable_fraction: null,
      calendar_name: 'Work',
    });
    expect(e.usableFraction).toBeNull();
    expect(e.startsAt).toBe(Date.UTC(2026, 2, 5, 1));
  });

  it('coerces a usable fraction of zero rather than treating it as absent', () => {
    const e = calEventFromRow({
      id: 'e1',
      account_id: 'a1',
      title: '',
      starts_at: null,
      ends_at: null,
      start_date: '2026-03-05',
      end_date: '2026-03-06',
      all_day: true,
      busy: true,
      usable_fraction: '0.00',
      calendar_name: null,
    });
    expect(e.usableFraction).toBe(0);
  });

  it('maps a category row', () => {
    expect(
      categoryFromRow({
        id: 'c1',
        user_id: 'u',
        name: 'Work',
        color: '#3D6CD6',
        sort_order: 0,
      }),
    ).toEqual({ id: 'c1', name: 'Work', color: '#3D6CD6' });
  });
});
