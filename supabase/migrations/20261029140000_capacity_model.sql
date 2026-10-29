-- Capacity model: porous events and sleep as reserve.
--
-- Two corrections to the artifact's free-time maths, both from how the day
-- actually works rather than how a calendar describes it.
--
-- 1. An event does not necessarily block all of its own time. A 9-to-6 job is
--    one nine-hour event that still contains usable task time, while a
--    thirty-minute meeting blocks every one of its minutes. Each event now
--    carries the fraction of itself that remains usable.
--
-- 2. Sleep is not unavailable, it is expensive. Night hours stay available as
--    reserve, so an all-nighter remains a thing the app can tell you about,
--    but they do not count as ordinary capacity — otherwise nothing is urgent
--    until a 7am deadline is seven hours away and six of those are asleep.

-- --------------------------------------------------------- porous events

-- 0 = blocks all of its time (a meeting). 1 = blocks none of it (a holiday).
alter table calendar_events
  add column usable_fraction numeric(3, 2) not null default 0
    check (usable_fraction between 0 and 1);

-- All-day events were previously skipped entirely when computing busy time.
-- That is the same as being fully usable, so the existing behaviour is now
-- expressed in the model rather than hidden in a filter — and an all-day
-- "Conference in KL" can finally be marked as blocking, which it never could be.
update calendar_events set usable_fraction = 1 where all_day;

comment on column calendar_events.usable_fraction is
  'Fraction of this event''s duration still available for task work. '
  'Blocked minutes = duration * (1 - usable_fraction).';

-- A whole calendar can carry a default, so a work calendar is configured once
-- rather than per event. Null means fall back to the heuristic in settings.
alter table calendar_accounts
  add column default_usable_fraction numeric(3, 2)
    check (default_usable_fraction between 0 and 1);

-- ------------------------------------------------- capacity settings

alter table settings
  -- Events at or beyond this length are treated as containers rather than
  -- appointments, and take the usable fraction below instead of blocking fully.
  add column long_event_hours numeric(4, 1) not null default 4.0
    check (long_event_hours > 0),
  add column long_event_usable numeric(3, 2) not null default 0.30
    check (long_event_usable between 0 and 1),
  add column allday_usable numeric(3, 2) not null default 1.00
    check (allday_usable between 0 and 1),

  -- Capacity is further discounted because a free hour is not a worked hour:
  -- meals, travel and rest live in the gaps the calendar does not record.
  add column capacity_factor numeric(3, 2) not null default 1.00
    check (capacity_factor between 0.1 and 1),

  -- Hours reachable only by cutting into sleep. Counted separately, never
  -- folded into ordinary capacity, and surfaced when they become decisive.
  add column night_reserve_enabled boolean not null default true;

comment on column settings.capacity_factor is
  'Scales ordinary free time to something a person will really work. '
  '1.00 keeps the artifact''s behaviour; lower is more conservative.';
