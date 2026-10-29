/**
 * Domain types for the Mercury rules engine.
 *
 * Nothing in `src/domain` imports React, Supabase, or touches the clock: every
 * function that needs the current time takes it as an argument. That is what
 * lets the same code decide "is this urgent?" in the browser and inside a
 * scheduled Edge Function without the two ever disagreeing.
 */

/** Calendar date, `YYYY-MM-DD`. A wall-clock fact, not an instant. */
export type DateStr = string;

/** Wall-clock time of day, `HH:MM`, 24-hour. */
export type TimeStr = string;

/** Milliseconds since the epoch. Used for machine-observed instants only. */
export type Instant = number;

export type PriorityLevel = 'high' | 'med' | 'low';
export type TaskStatus = 'todo' | 'doing' | 'done';
export type PriorityMode = 'auto' | 'manual';

export interface Category {
  id: string;
  name: string;
  color: string;
}

export interface Task {
  id: string;
  title: string;
  categoryId: string | null;
  notes: string;

  /** When you mean to begin. */
  plannedStart: DateStr | null;
  plannedStartTime: TimeStr | null;
  /** When you aim to be done. */
  targetFinish: DateStr | null;
  targetFinishTime: TimeStr | null;
  /** The hard deadline. */
  due: DateStr | null;
  dueTime: TimeStr | null;

  estMin: number;
  loggedMin: number;
  progress: number;

  actualStart: Instant | null;
  completedAt: Instant | null;
  timerStart: Instant | null;

  priorityMode: PriorityMode;
  priorityManual: PriorityLevel | null;

  deletedAt: Instant | null;
  archivedAt: Instant | null;

  estSource?: 'you' | 'ai' | 'history' | null;
  createdAt?: Instant;
}

/** A calendar event, normalised across every provider. */
export interface CalEvent {
  id: string;
  accountId: string;
  title: string;
  /** Timed events carry instants; all-day events carry dates. */
  startsAt: Instant | null;
  endsAt: Instant | null;
  startDate: DateStr | null;
  endDate: DateStr | null;
  allDay: boolean;
  /** False for events marked free/transparent: they never block. */
  busy: boolean;
  /** Per-event override of how much of itself stays usable, 0–1. */
  usableFraction: number | null;
  calendarName?: string;
}

export interface CalendarAccount {
  id: string;
  /** Per-calendar default usable fraction; null falls through to the heuristic. */
  defaultUsableFraction: number | null;
}

export interface Settings {
  /** Multiplies the remaining estimate when deciding "start now". */
  buffer: number;

  /** The productive day. Its complement is the sleep window. */
  wakeStart: TimeStr;
  wakeEnd: TimeStr;

  highDays: number;
  medDays: number;
  escalateWhenNoFit: boolean;
  overdueAlwaysHigh: boolean;
  noDuePriority: 'low' | 'med' | 'none';

  /** Capacity model (plan section 2.9). */
  longEventHours: number;
  longEventUsable: number;
  alldayUsable: number;
  capacityFactor: number;
  nightReserveEnabled: boolean;

  /** IANA zone. Every wall-clock date in this app is resolved against it. */
  timezone: string;
}

export const DEFAULT_SETTINGS: Settings = {
  // Lower than the artifact's 1.5 because the trigger now measures capacity
  // rather than wall-clock time, and capacity is always the smaller number.
  buffer: 1.2,
  wakeStart: '08:00',
  wakeEnd: '23:00',
  highDays: 3,
  medDays: 14,
  escalateWhenNoFit: true,
  overdueAlwaysHigh: true,
  noDuePriority: 'low',
  longEventHours: 4,
  longEventUsable: 0.3,
  alldayUsable: 1,
  capacityFactor: 1,
  nightReserveEnabled: true,
  timezone: 'Asia/Singapore',
};

/** Everything the engine needs beyond the task itself. */
export interface EngineContext {
  settings: Settings;
  events: readonly CalEvent[];
  accounts: readonly CalendarAccount[];
}
