-- Mercury initial schema.
--
-- Conventions used throughout:
--   * Every user-owned table carries user_id and an RLS policy of
--     user_id = auth.uid(). Edge Functions use the service role, which
--     bypasses RLS, so there are no permissive policies for server work.
--   * Dates and times are stored as separate date/time columns rather than
--     timestamptz wherever the user typed a calendar date, because "due
--     Friday" is a wall-clock fact and must not shift with a timezone.
--     Machine-generated instants (completed_at, synced_at) are timestamptz.
--   * Rules that the UI enforces are also enforced here as CHECK constraints,
--     so a bug in the client cannot persist an impossible task.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- categories

create table categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 60),
  color       text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

create index categories_user_idx on categories (user_id, sort_order);

-- ------------------------------------------------------------------ settings

create table settings (
  user_id               uuid primary key references auth.users (id) on delete cascade,

  -- Planning
  buffer                numeric(3, 1) not null default 1.5 check (buffer between 1 and 4),
  wake_start            time not null default '08:00',
  wake_end              time not null default '23:00',

  -- Priority rules, all editable (plan section 2.2)
  high_days             integer not null default 3 check (high_days >= 0),
  med_days              integer not null default 14 check (med_days >= 1),
  escalate_when_no_fit  boolean not null default true,
  overdue_always_high   boolean not null default true,
  no_due_priority       text not null default 'low'
                          check (no_due_priority in ('low', 'med', 'none')),

  -- Housekeeping
  archive_days          integer not null default 90 check (archive_days >= 7),
  trash_days            integer not null default 30 check (trash_days >= 1),
  timezone              text not null default 'Asia/Singapore',

  -- Integration bookkeeping
  hidden_calendar_ids   text[] not null default '{}',
  last_backup_at        timestamptz,
  last_backup_error_at  timestamptz,
  last_archive_run_at   timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- The UI refuses to let High be a longer window than Medium; so does the DB.
  constraint settings_priority_window check (high_days < med_days),
  constraint settings_waking_hours check (wake_start < wake_end)
);

-- --------------------------------------------------------------------- tasks

create table tasks (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users (id) on delete cascade,

  title                   text not null check (length(trim(title)) between 1 and 200),
  category_id             uuid references categories (id) on delete set null,
  notes                   text not null default '',

  -- Three independent dates, each with an optional wall-clock time.
  planned_start           date,
  planned_start_time      time,
  target_finish           date,
  target_finish_time      time,
  due                     date,
  due_time                time,

  est_min                 integer not null default 0 check (est_min between 0 and 100000),
  logged_min              numeric(10, 2) not null default 0 check (logged_min >= 0),
  est_source              text check (est_source in ('you', 'ai', 'history')),
  logged_source           text check (logged_source in ('timer', 'chip', 'manual')),

  progress                smallint not null default 0 check (progress between 0 and 100),
  progress_before         smallint check (progress_before between 0 and 100),

  actual_start            timestamptz,
  completed_at            timestamptz,
  timer_start             timestamptz,

  -- Priority: automatic by default, manually pinnable (plan section 2.1).
  priority_mode           text not null default 'auto'
                            check (priority_mode in ('auto', 'manual')),
  priority_manual         text check (priority_manual in ('high', 'med', 'low')),
  -- Priority is otherwise derived, never stored. This column exists only so the
  -- notification scheduler can tell an escalation from a steady state.
  last_notified_priority  text check (last_notified_priority in ('high', 'med', 'low')),

  -- Soft delete and archive are both flags; see the note in docs on why
  -- archiving did not need a second table.
  deleted_at              timestamptz,
  archived_at             timestamptz,

  source_event            text,
  notion_id               text,
  backed_up_at            timestamptz,
  is_example              boolean not null default false,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  search_tsv tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(notes, ''))
  ) stored,

  -- A time without its date is meaningless.
  constraint tasks_planned_start_time_needs_date
    check (planned_start_time is null or planned_start is not null),
  constraint tasks_target_time_needs_date
    check (target_finish_time is null or target_finish is not null),
  constraint tasks_due_time_needs_date
    check (due_time is null or due is not null),

  -- A pinned priority must name a level; an automatic one must not.
  constraint tasks_priority_pin_consistent check (
    (priority_mode = 'auto' and priority_manual is null)
    or (priority_mode = 'manual' and priority_manual is not null)
  ),

  -- A completed task cannot have finished before it started.
  constraint tasks_completed_after_start
    check (completed_at is null or actual_start is null or completed_at >= actual_start),

  -- Completion and full progress travel together.
  constraint tasks_completion_implies_progress
    check (completed_at is null or progress = 100),

  -- Only a started task can have a running timer.
  constraint tasks_timer_needs_start
    check (timer_start is null or actual_start is not null)
);

-- Indexes are partial on "live" rows, which is what every view queries.
create index tasks_due_idx on tasks (user_id, due)
  where deleted_at is null and archived_at is null;
create index tasks_open_idx on tasks (user_id)
  where deleted_at is null and archived_at is null and completed_at is null;
create index tasks_completed_idx on tasks (user_id, completed_at desc)
  where deleted_at is null;
create index tasks_timer_idx on tasks (user_id)
  where timer_start is not null;
create index tasks_trash_idx on tasks (user_id, deleted_at)
  where deleted_at is not null;
create index tasks_search_idx on tasks using gin (search_tsv);
create index tasks_title_trgm_idx on tasks using gin (title gin_trgm_ops);
create index tasks_notion_idx on tasks (user_id, notion_id)
  where notion_id is not null;

-- --------------------------------------------------------- calendar accounts

create table calendar_accounts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  provider        text not null
                    check (provider in ('icloud_caldav', 'icloud_ics', 'google')),
  display_name    text not null default '',
  -- Name of the Supabase Vault secret holding the credential. The credential
  -- itself never lives in this table.
  credential_ref  text,
  status          text not null default 'ok'
                    check (status in ('ok', 'needs_reauth', 'error')),
  status_message  text,
  last_sync_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index calendar_accounts_user_idx on calendar_accounts (user_id);

-- ----------------------------------------------------------- calendar events

create table calendar_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  account_id     uuid not null references calendar_accounts (id) on delete cascade,

  provider_uid   text not null,
  -- Set for one occurrence of a recurring series; null for a single event.
  occurrence     date,

  calendar_id    text not null default '',
  calendar_name  text not null default '',
  title          text not null default '',

  -- A timed event uses the timestamptz pair; an all-day event uses the date
  -- pair. Exactly one pair is populated, which keeps all-day events off the
  -- timezone-shift bug entirely.
  starts_at      timestamptz,
  ends_at        timestamptz,
  start_date     date,
  end_date       date,
  all_day        boolean not null default false,

  busy           boolean not null default true,
  synced_at      timestamptz not null default now(),

  constraint calendar_events_shape check (
    (all_day = false
      and starts_at is not null and ends_at is not null
      and start_date is null and end_date is null)
    or
    (all_day = true
      and start_date is not null and end_date is not null
      and starts_at is null and ends_at is null)
  ),
  constraint calendar_events_ordered check (
    (all_day = false and ends_at >= starts_at)
    or (all_day = true and end_date >= start_date)
  ),

  unique nulls not distinct (account_id, provider_uid, occurrence)
);

create index calendar_events_window_idx on calendar_events (user_id, starts_at, ends_at)
  where all_day = false;
create index calendar_events_allday_idx on calendar_events (user_id, start_date)
  where all_day = true;

-- ---------------------------------------------------------------- scan state

create table scan_state (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  last_scan_at      timestamptz,
  last_error        text,
  recurring_events  text[] not null default '{}'
);

-- --------------------------------------------------------------- inbox items

create table inbox_items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,

  -- Stable identity of the calendar occurrence this came from. The unique
  -- constraint below is what makes re-scanning idempotent, so a ticked-off
  -- item can never be proposed twice.
  event_key      text not null,

  title          text not null,
  kind           text not null check (kind in ('task', 'unsure', 'event')),
  reason         text not null default '',

  due            date,
  due_time       time,
  category_id    uuid references categories (id) on delete set null,
  est_min        integer check (est_min >= 0),
  repeat_note    text,
  calendar_name  text not null default '',
  notes          text not null default '',

  status         text not null default 'open'
                   check (status in ('open', 'added', 'dismissed', 'event')),
  task_id        uuid references tasks (id) on delete set null,
  handled_at     timestamptz,
  created_at     timestamptz not null default now(),

  unique (user_id, event_key)
);

create index inbox_open_idx on inbox_items (user_id, due)
  where status = 'open';

-- --------------------------------------------------------------- task drafts

create table task_drafts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  source            text not null
                      check (source in ('telegram_text', 'telegram_photo', 'web')),
  raw_input         text not null default '',
  parsed            jsonb not null default '{}'::jsonb,
  photo_file_id     text,
  status            text not null default 'pending'
                      check (status in ('pending', 'confirmed', 'discarded', 'expired')),
  confirmed_task_id uuid references tasks (id) on delete set null,
  created_at        timestamptz not null default now(),
  -- An unconfirmed proposal expires so a stale tap cannot create a task.
  expires_at        timestamptz not null default now() + interval '24 hours'
);

create index task_drafts_pending_idx on task_drafts (user_id, created_at desc)
  where status = 'pending';

-- --------------------------------------------------- notification preferences

create table notification_prefs (
  user_id               uuid primary key references auth.users (id) on delete cascade,
  digest_time           time not null default '07:30',
  evening_wrap_enabled  boolean not null default false,
  evening_wrap_time     time not null default '21:00',
  -- Minutes before a deadline at which to warn. Default 24h and 2h.
  due_lead_minutes      integer[] not null default '{1440,120}',
  -- Quiet hours default to null, meaning "reuse settings.wake_start/wake_end".
  quiet_start           time,
  quiet_end             time,
  muted_category_ids    uuid[] not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Per-type enablement and channel routing (plan section 2.6).
create table notification_routes (
  user_id   uuid not null references auth.users (id) on delete cascade,
  type      text not null check (type in (
              'digest', 'evening_wrap', 'start_now', 'due_soon', 'overdue',
              'priority_escalated', 'at_risk', 'over_capacity', 'scan_results'
            )),
  enabled   boolean not null default true,
  channels  text[] not null default '{push}'
              check (channels <@ array['push', 'telegram', 'email']::text[]),
  primary key (user_id, type)
);

-- The dedupe ledger. The unique constraint IS the guarantee: a second attempt
-- to send the same notification fails on insert rather than relying on the
-- scheduler remembering. NULLS NOT DISTINCT matters because digest rows carry
-- no task_id, and without it every digest would look unique.
create table notifications_sent (
  id         bigserial primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  task_id    uuid references tasks (id) on delete cascade,
  type       text not null,
  threshold  text not null default '',
  channels   text[] not null default '{}',
  sent_at    timestamptz not null default now(),
  unique nulls not distinct (user_id, task_id, type, threshold)
);

create index notifications_sent_recent_idx on notifications_sent (user_id, sent_at desc);

-- -------------------------------------------------------- push subscriptions

create table push_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  endpoint       text not null unique,
  p256dh         text not null,
  auth_secret    text not null,
  user_agent     text not null default '',
  failure_count  integer not null default 0,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);

create index push_subscriptions_user_idx on push_subscriptions (user_id);

-- ------------------------------------------------------------------ telegram

-- Nonces are minted before the chat is known, so binding is two tables.
create table telegram_link_nonces (
  nonce       text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '15 minutes',
  used_at     timestamptz
);

create table telegram_links (
  chat_id    bigint primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  username   text,
  bound_at   timestamptz not null default now()
);

create index telegram_links_user_idx on telegram_links (user_id);

-- ------------------------------------------------- notion deletion retry queue

create table notion_pending_deletes (
  notion_page_id  text primary key,
  user_id         uuid not null references auth.users (id) on delete cascade,
  deleted_at      timestamptz not null,
  attempts        integer not null default 0,
  last_error      text,
  created_at      timestamptz not null default now()
);

-- ------------------------------------------------------------ updated_at trigger

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tasks_updated_at before update on tasks
  for each row execute function set_updated_at();
create trigger settings_updated_at before update on settings
  for each row execute function set_updated_at();
create trigger notification_prefs_updated_at before update on notification_prefs
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------- RLS

-- Every table is owner-only. Policies are written per command rather than as
-- FOR ALL so that an insert cannot smuggle in another user's user_id.
do $$
declare t text;
begin
  foreach t in array array[
    'categories', 'settings', 'tasks', 'calendar_accounts', 'calendar_events',
    'scan_state', 'inbox_items', 'task_drafts', 'notification_prefs',
    'notification_routes', 'notifications_sent', 'push_subscriptions',
    'telegram_link_nonces', 'telegram_links', 'notion_pending_deletes'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select using (user_id = auth.uid())',
      t || '_select_own', t);
    execute format(
      'create policy %I on %I for insert with check (user_id = auth.uid())',
      t || '_insert_own', t);
    execute format(
      'create policy %I on %I for update using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_update_own', t);
    execute format(
      'create policy %I on %I for delete using (user_id = auth.uid())',
      t || '_delete_own', t);
  end loop;
end $$;
