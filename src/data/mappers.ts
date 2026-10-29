/**
 * Row ↔ domain mapping.
 *
 * Two shapes of the same data meet here, and three details bite if they are
 * not handled in one place:
 *
 *   * Postgres `time` columns come back as `HH:MM:SS`, while the domain and
 *     every `<input type="time">` use `HH:MM`.
 *   * `timestamptz` comes back as an ISO string; the domain uses epoch ms so
 *     that arithmetic needs no parsing.
 *   * `numeric` can arrive as a string depending on the driver path, so every
 *     number is coerced rather than trusted.
 */
import type {
  CalEvent,
  CalendarAccount,
  Category,
  DateStr,
  Instant,
  PriorityLevel,
  Settings,
  Task,
  TimeStr,
} from '@/domain/types';
import { DEFAULT_SETTINGS } from '@/domain/types';

export interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  category_id: string | null;
  notes: string | null;
  planned_start: string | null;
  planned_start_time: string | null;
  target_finish: string | null;
  target_finish_time: string | null;
  due: string | null;
  due_time: string | null;
  est_min: number | string | null;
  logged_min: number | string | null;
  est_source: string | null;
  logged_source: string | null;
  progress: number | string | null;
  progress_before: number | string | null;
  actual_start: string | null;
  completed_at: string | null;
  timer_start: string | null;
  priority_mode: string | null;
  priority_manual: string | null;
  last_notified_priority: string | null;
  deleted_at: string | null;
  archived_at: string | null;
  source_event: string | null;
  notion_id: string | null;
  backed_up_at: string | null;
  is_example: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

/** `HH:MM:SS` or `HH:MM` → `HH:MM`. Null stays null. */
export function toTimeStr(v: string | null | undefined): TimeStr | null {
  if (!v) return null;
  const m = /^(\d{2}):(\d{2})/.exec(v);
  return m ? `${m[1]}:${m[2]}` : null;
}

/** `HH:MM` → `HH:MM:00`, which is what Postgres wants. */
export function fromTimeStr(v: TimeStr | null | undefined): string | null {
  return v ? `${v}:00` : null;
}

export function toInstant(v: string | null | undefined): Instant | null {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

export function fromInstant(v: Instant | null | undefined): string | null {
  return v == null ? null : new Date(v).toISOString();
}

function num(v: number | string | null | undefined, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const asDate = (v: string | null | undefined): DateStr | null => v ?? null;

const asLevel = (v: string | null | undefined): PriorityLevel | null =>
  v === 'high' || v === 'med' || v === 'low' ? v : null;

export function taskFromRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    categoryId: row.category_id,
    notes: row.notes ?? '',
    plannedStart: asDate(row.planned_start),
    plannedStartTime: toTimeStr(row.planned_start_time),
    targetFinish: asDate(row.target_finish),
    targetFinishTime: toTimeStr(row.target_finish_time),
    due: asDate(row.due),
    dueTime: toTimeStr(row.due_time),
    estMin: num(row.est_min),
    loggedMin: num(row.logged_min),
    estSource:
      row.est_source === 'you' ||
      row.est_source === 'ai' ||
      row.est_source === 'history'
        ? row.est_source
        : null,
    progress: num(row.progress),
    progressBefore:
      row.progress_before == null ? null : num(row.progress_before),
    actualStart: toInstant(row.actual_start),
    completedAt: toInstant(row.completed_at),
    timerStart: toInstant(row.timer_start),
    priorityMode: row.priority_mode === 'manual' ? 'manual' : 'auto',
    priorityManual: asLevel(row.priority_manual),
    deletedAt: toInstant(row.deleted_at),
    archivedAt: toInstant(row.archived_at),
    createdAt: toInstant(row.created_at) ?? undefined,
  };
}

/** The writable half of a row. `updated_at` is set by a trigger, never here. */
export function taskToRow(
  t: Task,
  userId: string,
): Omit<TaskRow, 'updated_at'> {
  // The database rejects a pinned level in automatic mode and a manual mode
  // with no level, so the pair is normalised rather than passed through.
  const manual =
    t.priorityMode === 'manual' ? (t.priorityManual ?? 'med') : null;
  return {
    id: t.id,
    user_id: userId,
    title: t.title,
    category_id: t.categoryId,
    notes: t.notes,
    planned_start: t.plannedStart,
    planned_start_time: t.plannedStart ? fromTimeStr(t.plannedStartTime) : null,
    target_finish: t.targetFinish,
    target_finish_time: t.targetFinish ? fromTimeStr(t.targetFinishTime) : null,
    due: t.due,
    due_time: t.due ? fromTimeStr(t.dueTime) : null,
    est_min: Math.round(t.estMin),
    logged_min: t.loggedMin,
    est_source: t.estSource ?? null,
    logged_source: null,
    progress: Math.round(t.progress),
    progress_before:
      t.progressBefore == null ? null : Math.round(t.progressBefore),
    actual_start: fromInstant(t.actualStart),
    completed_at: fromInstant(t.completedAt),
    timer_start: fromInstant(t.timerStart),
    priority_mode: manual ? 'manual' : 'auto',
    priority_manual: manual,
    last_notified_priority: null,
    deleted_at: fromInstant(t.deletedAt),
    archived_at: fromInstant(t.archivedAt),
    source_event: null,
    notion_id: null,
    backed_up_at: null,
    is_example: false,
    created_at: fromInstant(t.createdAt ?? null),
  };
}

export interface CategoryRow {
  id: string;
  user_id: string;
  name: string;
  color: string;
  sort_order: number | string | null;
}

export const categoryFromRow = (r: CategoryRow): Category => ({
  id: r.id,
  name: r.name,
  color: r.color,
});

export interface SettingsRow {
  user_id: string;
  buffer: number | string;
  wake_start: string;
  wake_end: string;
  high_days: number | string;
  med_days: number | string;
  escalate_when_no_fit: boolean;
  overdue_always_high: boolean;
  no_due_priority: string;
  long_event_hours: number | string;
  long_event_usable: number | string;
  allday_usable: number | string;
  capacity_factor: number | string;
  night_reserve_enabled: boolean;
  timezone: string;
}

export function settingsFromRow(r: SettingsRow | null | undefined): Settings {
  if (!r) return { ...DEFAULT_SETTINGS };
  const noDue = r.no_due_priority;
  return {
    buffer: num(r.buffer, DEFAULT_SETTINGS.buffer),
    wakeStart: toTimeStr(r.wake_start) ?? DEFAULT_SETTINGS.wakeStart,
    wakeEnd: toTimeStr(r.wake_end) ?? DEFAULT_SETTINGS.wakeEnd,
    highDays: num(r.high_days, DEFAULT_SETTINGS.highDays),
    medDays: num(r.med_days, DEFAULT_SETTINGS.medDays),
    escalateWhenNoFit:
      r.escalate_when_no_fit ?? DEFAULT_SETTINGS.escalateWhenNoFit,
    overdueAlwaysHigh:
      r.overdue_always_high ?? DEFAULT_SETTINGS.overdueAlwaysHigh,
    noDuePriority:
      noDue === 'low' || noDue === 'med' || noDue === 'none'
        ? noDue
        : DEFAULT_SETTINGS.noDuePriority,
    longEventHours: num(r.long_event_hours, DEFAULT_SETTINGS.longEventHours),
    longEventUsable: num(r.long_event_usable, DEFAULT_SETTINGS.longEventUsable),
    alldayUsable: num(r.allday_usable, DEFAULT_SETTINGS.alldayUsable),
    capacityFactor: num(r.capacity_factor, DEFAULT_SETTINGS.capacityFactor),
    nightReserveEnabled:
      r.night_reserve_enabled ?? DEFAULT_SETTINGS.nightReserveEnabled,
    timezone: r.timezone || DEFAULT_SETTINGS.timezone,
  };
}

export function settingsToRow(s: Settings, userId: string): SettingsRow {
  return {
    user_id: userId,
    buffer: s.buffer,
    wake_start: fromTimeStr(s.wakeStart)!,
    wake_end: fromTimeStr(s.wakeEnd)!,
    high_days: s.highDays,
    med_days: s.medDays,
    escalate_when_no_fit: s.escalateWhenNoFit,
    overdue_always_high: s.overdueAlwaysHigh,
    no_due_priority: s.noDuePriority,
    long_event_hours: s.longEventHours,
    long_event_usable: s.longEventUsable,
    allday_usable: s.alldayUsable,
    capacity_factor: s.capacityFactor,
    night_reserve_enabled: s.nightReserveEnabled,
    timezone: s.timezone,
  };
}

export interface CalEventRow {
  id: string;
  account_id: string;
  title: string | null;
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date: string | null;
  all_day: boolean;
  busy: boolean;
  usable_fraction: number | string | null;
  calendar_name: string | null;
}

export const calEventFromRow = (r: CalEventRow): CalEvent => ({
  id: r.id,
  accountId: r.account_id,
  title: r.title ?? '',
  startsAt: toInstant(r.starts_at),
  endsAt: toInstant(r.ends_at),
  startDate: r.start_date,
  endDate: r.end_date,
  allDay: r.all_day,
  busy: r.busy,
  // Null is meaningful here: it means "fall through to the calendar default",
  // so it must not be coerced to zero.
  usableFraction: r.usable_fraction == null ? null : num(r.usable_fraction),
  calendarName: r.calendar_name ?? '',
});

export interface CalendarAccountRow {
  id: string;
  default_usable_fraction: number | string | null;
}

export const calendarAccountFromRow = (
  r: CalendarAccountRow,
): CalendarAccount => ({
  id: r.id,
  defaultUsableFraction:
    r.default_usable_fraction == null ? null : num(r.default_usable_fraction),
});
