-- CHECK-constraint assertions (must_fail comes from 01_helpers.sql): the client enforces these rules too, but a bug
-- in the client must not be able to persist an impossible task.
\set ON_ERROR_STOP on

begin;
insert into auth.users (id, email)
  values ('33333333-3333-3333-3333-333333333333', 'c@example.com');


-- A time with no date.
select must_fail($$
  insert into tasks (user_id, title, due_time)
  values ('33333333-3333-3333-3333-333333333333', 'x', '17:00')
$$, 'due_time without due');

-- An automatic priority that also pins a level.
select must_fail($$
  insert into tasks (user_id, title, priority_mode, priority_manual)
  values ('33333333-3333-3333-3333-333333333333', 'x', 'auto', 'high')
$$, 'auto mode with a pinned level');

-- A manual priority with no level.
select must_fail($$
  insert into tasks (user_id, title, priority_mode)
  values ('33333333-3333-3333-3333-333333333333', 'x', 'manual')
$$, 'manual mode without a level');

-- Completed before started.
select must_fail($$
  insert into tasks (user_id, title, progress, actual_start, completed_at)
  values ('33333333-3333-3333-3333-333333333333', 'x', 100,
          '2026-10-29T10:00:00Z', '2026-10-29T09:00:00Z')
$$, 'completion before start');

-- Completed without full progress.
select must_fail($$
  insert into tasks (user_id, title, progress, completed_at)
  values ('33333333-3333-3333-3333-333333333333', 'x', 40, now())
$$, 'completion with partial progress');

-- A running timer on a task that never started.
select must_fail($$
  insert into tasks (user_id, title, timer_start)
  values ('33333333-3333-3333-3333-333333333333', 'x', now())
$$, 'timer without a start');

-- An empty title.
select must_fail($$
  insert into tasks (user_id, title)
  values ('33333333-3333-3333-3333-333333333333', '   ')
$$, 'blank title');

-- High priority window must be shorter than Medium.
select must_fail($$
  insert into settings (user_id, high_days, med_days)
  values ('33333333-3333-3333-3333-333333333333', 20, 10)
$$, 'high_days >= med_days');

-- An all-day event carrying instants instead of dates.
insert into calendar_accounts (id, user_id, provider)
  values ('44444444-4444-4444-4444-444444444444',
          '33333333-3333-3333-3333-333333333333', 'icloud_caldav');
select must_fail($$
  insert into calendar_events (user_id, account_id, provider_uid, all_day, starts_at, ends_at)
  values ('33333333-3333-3333-3333-333333333333',
          '44444444-4444-4444-4444-444444444444', 'u1', true, now(), now())
$$, 'all-day event with timestamps');

-- The dedupe ledger must reject a repeat even when task_id is null, which is
-- the digest case and the reason for NULLS NOT DISTINCT.
insert into notifications_sent (user_id, type, threshold)
  values ('33333333-3333-3333-3333-333333333333', 'digest', '2026-10-29');
select must_fail($$
  insert into notifications_sent (user_id, type, threshold)
  values ('33333333-3333-3333-3333-333333333333', 'digest', '2026-10-29')
$$, 'duplicate digest notification with null task_id');

-- The inbox must reject a re-proposal of the same calendar occurrence.
insert into inbox_items (user_id, event_key, title, kind)
  values ('33333333-3333-3333-3333-333333333333', 'uid-1:2026-10-30', 'Submit', 'task');
select must_fail($$
  insert into inbox_items (user_id, event_key, title, kind)
  values ('33333333-3333-3333-3333-333333333333', 'uid-1:2026-10-30', 'Submit', 'task')
$$, 'duplicate inbox item for the same occurrence');

rollback;
