# Daybook — build plan

## Context

Daybook exists today as a single 1,580-line HTML artifact on claude.ai
(`claude.ai/artifact/26RRtWxSkTsQ8LAsjP6cD6`). It is not a sketch — it is a working,
opinionated task tracker with a complete domain model: automatic priority, calendar-aware
free-time maths, "start now" pressure detection, estimate-accuracy analytics, live timers,
a one-line capture parser, AI form-fill, a Notion backup pipeline and a calendar-to-task
inbox.

Its ceiling is the artifact runtime. Everything durable depends on four injected
capabilities — `window.claude.use('db' | 'user' | 'mcp' | 'sample')`. That means: data lives
in a claude.ai-scoped store, Google Calendar and Notion arrive through Claude's MCP
connectors, AI fill runs on Claude's sampling quota, the calendar scan is performed by Claude
in a chat rather than by a job, and the whole app is one unversioned, untested, untyped file
that cannot run anywhere else.

This plan rebuilds Daybook as a real application in `ynscancode/daybook` (currently an empty
repo) at **full feature parity first**, then opens the door to the capabilities the artifact
could never have. Decisions already made: React + TypeScript + Vite in this repo; Supabase
for data and auth; Google Calendar, Notion backup, AI fill and the
calendar-to-task scan all carried over; Apple Calendar preferred over Google if it can be made
to work; AI fill built now but shipped without an API key.

---

## 1. Capability inventory (the parity contract)

This is the authoritative list of what "all the capabilities I've included so far" means,
read off the artifact source. Nothing here is optional.

### Shell and interaction
- Four views — Dashboard, Tasks, Calendar, Insights — with the active tab persisted.
- Top tab bar on desktop; fixed bottom navigation on phones, with safe-area insets.
- Light and dark themes via `prefers-color-scheme`, overridable by `data-theme`.
- Header sync status line that names the live state ("Google Calendar live · 14:32",
  "Calendar snapshot Mon 13 Oct", "Not saving") plus a manual Refresh.
- Modal bottom sheets with focus trapping, Escape, backdrop dismissal.
- Toasts; a "how long did it take?" chip prompt.
- `#add` deep link that opens with the capture box focused — the home-screen shortcut.
- A 1-second tick for running timers and a 5-minute silent re-render so relative times
  ("in 3h", "2d overdue") never go stale.
- Re-render preserves in-progress input values, focus and text selection.

### Task model
`id, title, cat, notes, createdAt, updatedAt, plannedStart(+Time), target(+Time), due(+Time),
estMin, loggedMin, estSource('you'|'ai'), loggedSource, progress(0–100 step 5), progressBefore,
actualStart, completedAt, timerStart, example, sourceEvent, notionId, backedUpAt, archived`

Three dates with distinct meanings — **planned start** (when you mean to begin), **target
finish** (when you aim to be done), **due** (the hard deadline) — each with an optional time
and sensible defaults (`23:59` for due/target, day-start for planned start).

### Derived logic — the part that makes Daybook Daybook
- `status()` → todo / doing / done, inferred from `actualStart`, `progress`, `completedAt`.
- `remMin` = estimate × (1 − progress), `logged` = logged + any running timer.
- **Automatic priority**, never manual: High when overdue, *or* when remaining estimate ≥ time
  left before the deadline, *or* due within `highDays`; Medium within `medDays`; else Low.
  Every priority carries a human-readable reason ("Needs 4h, only 2h 10m left before it's due").
- **Attention detection** — `over` (overdue), `start` (not begun and remaining × buffer exceeds
  the time left, or the planned start has passed), `risk` (in progress but will not fit) —
  each with its own explanation sentence.
- **Calendar-aware free time**: `busyList` → `freeMin` → `freeBlocks`, computed inside waking
  hours minus busy events, used by attention, the dashboard, the week-load bars and AI fill.
- `fitText()` — on adding a task, states which free block it fits into
  ("fits Thu 30 Oct 14:00–17:00"), or that no single gap is large enough and it needs
  two or more sessions.

### Dashboard
Hero date with a live subline (events today · free time left · N tasks need attention) ·
capture bar · stat strip (Overdue / Start now / Due in 72h / In progress) · two focus cards
(Next start, highlighter-yellow when it is now; Next deadline, red inside 24h) · calendar
inbox · today's agenda merging events and tasks with a "Now 14:32" rule and dimmed past rows ·
prioritised panels (Overdue, Start now, Due in 72h, In progress, Up next, "You're clear") ·
a four-line Insights preview · and the next-7-days work-versus-free-time bars that flag
"Over by 2h 30m".

### Tasks
Category chips · status filter (open / not started / in progress / completed / all) · sort
(due / priority / planned start / newest) · grouping into Overdue, Today, Next 7 days, Later,
No due date, Completed. Each row: round completion toggle, priority pill and coloured left
edge, Start and Due chips with live countdowns, category dot, logged-of-estimate, target,
progress bar, the attention reason, and a per-row timer button. Plus a 5-task example loader
and one-click removal.

### Calendar
Week grid with prev / this / next navigation. Per day: all-day and timed events, a free-time
pill, and task pills labelled Due / Target / Start. Event source tagging and sync provenance
notes.

### Insights
Period (this week / last 4 weeks / all time) and category filter. Eight KPIs: completion rate,
on-time rate, target-hit rate, **estimate accuracy as median actual ÷ estimate — split between
your estimates and the AI's**, average start delay in days, hours logged, median start-to-finish,
overdue now. A generated "what stands out" narrative ("Tasks take 1.4× your estimate — pad by
about 40%", "School tasks run 32% over estimate"). Hours-by-category bars. An estimate-accuracy
dot plot on a 0–2.5× scale against a 1× reference line. An 8-week completed-per-week column
chart split by on-time versus late. A completed-tasks table with estimate, actual, % of
estimate, elapsed, start delay and on-time. Archived tasks still count toward every figure.

### Timers
Exactly one timer runs at a time — starting one stops the others and logs their time. A sticky
focus bar shows the task, counts *down* the remaining estimate (or up when no estimate is set),
fills a progress bar, and turns red the moment you pass the estimate. Row chips update every
second. Completing a task with no logged time prompts "How long did it take?" with duration
chips.

### Task editor
Every field in a two-column sheet, with: a live priority preview and its reason; two-way
status ↔ progress binding (drag to 100% marks it done, above 0% marks it in progress);
Started and Completed datetime fields that are set automatically, shown only when relevant,
and remain editable; a **time sanity checker** that catches logged-time-exceeds-elapsed,
completed-before-started and future dates, and offers one-tap repairs ("End at 16:45",
"Log 2h 15m"); a facts strip; two-tap delete; and a Mark done shortcut.

### One-line capture
A rule-based parser — no AI required — that understands `today / tdy / tonight`,
`tomorrow / tmr / tml / tmrw`, `this|next <weekday>`, bare weekdays, `in 3 days|weeks`,
`15/3`, `15.3.26`, `15Mar`, `15 March`, `March 15`, `noon / midnight / eod`, `5pm`, `5:30pm`,
`17:30`, `1730`, `~3h`, `2h30m`, `45min`, `#tag` categories, categories by name or prefix,
comma and semicolon segments, `due|by|before` splitting, and size words
("40 slides", "12 questions") as estimate hints. Live chips show exactly which of
due / time / estimate / category were understood. Unparsed remainder becomes notes. Category
is guessed locally from word overlap with past tasks.

### AI fill
On capture, a quick-tier model call receives the current time, the raw note, the fields already
parsed (**which it is forbidden to overwrite**), the category list, the user's actual free slots
before the deadline, and similar past tasks with estimated-versus-actual times. It returns
title, category, due, due time, estimate, planned start, target finish and notes. Every field
is validated (date format, time format, estimate between 5 and 2,400 minutes, planned start and
target not after due, neither in the past). AI-filled fields are tinted yellow and labelled
"suggested"; editing one clears the mark. There is a retry button, a status line, and graceful
degradation when AI is unavailable. `estSource` is recorded so Insights can score your estimates
against the model's.

### Calendar inbox and the morning scan
Proposed tasks found in the calendar, each with kind (task / unsure / event), title, date,
category, estimate, recurrence note, source calendar and a reason. Actions: Add to Daybook
(prefills the editor and links `sourceEvent`), Not a task, tick-off, and promoting something
from the "treated as events" list back to a task. Handled items are never re-flagged.
Recurring events are summarised rather than proposed individually, and the panel shows when
the last scan ran.

In the artifact the scan is not code — Claude reads the calendar in a chat and writes
`scanstate` and `inbox` rows into the artifact store by hand. In the real build it becomes a
scheduled job (see `inbox-scan` below), which is the one capability that gets genuinely more
capable in the port rather than merely ported.

### Settings
Categories — add, rename inline, pick from an 8-colour palette, delete with automatic
reassignment of orphaned tasks. Archive-after-N-days. Notion backup status with Back up now and
Back up & archive now. The quick-add link with copy-to-clipboard and Add-to-Home-Screen
instructions. Per-calendar visibility toggles. Planning rules: start-now buffer (1–4×), High and
Medium day thresholds (validated so High < Medium), day start and day end.

### Persistence
Realtime subscriptions on tasks, settings, calendar, inbox, scan state and archive. A
**per-task-id serialised write queue** so concurrent edits to one task cannot interleave.
Writes buffered before auth resolves, then flushed. Specific error messages for quota
exhaustion and offline. A read-only banner when not signed in. Completed tasks archived into
per-month documents.

### Notion backup and archive
Creates pages for tasks with no `notionId` in batches of 25; updates any task whose
`updatedAt` is newer than its `backedUpAt`. Maps every field including computed priority and
proper datetime properties. **Archiving only ever happens after a successful backup** — a
failed backup archives nothing. Deleting a task marks its Notion row Status = Deleted with a
deletion date; failures are queued and retried on the next run. Runs automatically at most once
per 20 hours, 6 seconds after load. Every error code maps to a specific sentence.

---

## 2. Target architecture

```
ynscancode/daybook
├─ src/
│  ├─ domain/          pure TypeScript — zero imports from React or Supabase
│  │   ├─ task.ts          status, dueTs, targetTs, startTs, remMin, logged
│  │   ├─ priority.ts      autoPri, attention
│  │   ├─ freetime.ts      busyList, freeMin, freeBlocks, fitText
│  │   ├─ capture.ts       parseCapture, matchAt, catByWords
│  │   ├─ metrics.ts       metrics, insightLines
│  │   └─ format.ts        fmtDur, fmtClock, relDue, shortWhen, countdown
│  ├─ store/           Zustand store + per-id write queue + realtime wiring
│  ├─ data/            Supabase client, typed row ↔ domain mappers
│  ├─ ui/              components; styles ported from the artifact's token system
│  ├─ views/           Dashboard, Tasks, Calendar, Insights, Settings
│  └─ ai/              capture → prompt → validate → apply
├─ supabase/
│  ├─ migrations/      schema + RLS
│  └─ functions/
│      ├─ calendar-sync/   iCloud CalDAV (primary) | Google OAuth (fallback)
│      ├─ notion-backup/   backup + archive + pending deletes
│      ├─ ai-fill/         Anthropic proxy; returns {disabled:true} with no key
│      └─ inbox-scan/      calendar → proposed tasks (phase 8)
└─ docs/
```

**Why a pure `domain/` layer.** All of the logic worth protecting is already written as pure
functions over plain objects. Extracting it unchanged means it can be unit-tested exhaustively
with Vitest — the artifact has no tests at all, and bugs in `autoPri`, `attention` or `freeMin`
are exactly the bugs that silently mislead you about your own deadlines.

**Why Zustand, not TanStack Query.** The artifact's model is one store plus `render()`, with
every view a pure function of state. Zustand preserves that shape and the optimistic-write
queue ports directly from `chain()`. Query's cache keys would add indirection for no gain when
Supabase realtime is already the source of truth.

**Why keep the CSS.** The existing stylesheet is a proper token system — semantic custom
properties, correct dark mode under both `prefers-color-scheme` and `data-theme`, tabular
figures, safe-area handling. It ports as `tokens.css` plus co-located component CSS. Rewriting
it in Tailwind would cost days and lose the design.

### Schema (Postgres, RLS on `auth.uid()` for every table)

| Table | Purpose |
|---|---|
| `tasks` | the model above; `updated_at` trigger; indexes on `(user_id, due)`, `(user_id, completed_at)` |
| `task_archive` | completed tasks past the threshold; still queried by Insights |
| `categories` | id, name, colour, sort order |
| `settings` | one row per user: buffer, highDays, medDays, wakeStart, wakeEnd, archiveDays, hiddenCals, lastBackupAt, lastArchiveRun |
| `calendar_accounts` | provider (`icloud` / `icloud_ics` / `google`), credential reference in Vault, per-calendar visibility |
| `calendar_events` | server-maintained event cache: start, end, all_day, title, calendar, busy, provider |
| `inbox_items` | proposed tasks with kind, reason, status, `task_id` |
| `scan_state` | last scan time, recurring-event summary |
| `notion_pending_deletes` | retry queue, promoted out of the settings blob |

Secrets — the Apple app-specific password, the Notion token, the Anthropic key — live in
Supabase Vault and are read only inside Edge Functions. They never reach the browser.

### Calendar: a provider interface, Apple first

The artifact already normalises every event to
`{id, title, start, end, allDay, cal, busy, src}`, so the interface is implied by existing code.
Three implementations behind it:

1. **`icloud-caldav` — primary.** Server-side CalDAV against `caldav.icloud.com` using
   `tsdav@2.3.3` (native TypeScript, runs on Deno, so it fits an Edge Function). Authentication
   is the Apple Account email plus an **app-specific password**, because Apple publishes no
   OAuth calendar API — CalDAV is the only route. Discovery via PROPFIND, then
   `fetchCalendars()` and `fetchCalendarObjects()`, skipping the inbox, outbox and notification
   collections. Read-only is sufficient: Daybook only consumes events for free/busy.
2. **`icloud-ics` — zero-credential fallback.** Apple's per-calendar public share link, fetched
   and parsed server-side. No credentials at all, but read-only, only for calendars you
   explicitly publish, and Apple refreshes those links lazily (15 minutes to several hours).
3. **`google` — the known-good fallback.** Standard OAuth, the same multi-calendar selection and
   10-minute refresh the artifact has today.

**Risks to accept with Apple, stated plainly.** An app-specific password is a long-lived
credential rather than a scoped token; changing your Apple ID password invalidates *every* app
password on the account at once, so the app needs a clear "iCloud needs reconnecting" state and
a re-entry path. CalDAV cannot be called from a browser — this must be server-side. Apple's
CalDAV is undocumented by Apple and has historically been rate-limit-prone. The provider
interface exists precisely so that discovering this is a one-file swap, not a rewrite. Build
`icloud-caldav` first; if its sync proves unreliable in week-long use, flip to `google` with
no other change.

One happy consequence: because a job maintains `calendar_events` and the client subscribes to
it, the artifact's awkward split between "live Google" and "stale iCloud snapshot taken on
13 Oct" disappears. There is one event source, always server-fresh, and the `srctag` /
snapshot-provenance UI can go.

### The inbox scan

`inbox-scan` runs daily, after `calendar-sync` has refreshed `calendar_events`, and classifies
each upcoming event into task / unsure / event. Classification is **heuristic first, with AI as
an optional enhancement** — the same posture as capture, so the scan works from day one with no
API key:

- **Rejected as events** — anything recurring (standing meetings, classes, lectures, gym),
  anything whose attendee count or organiser marks it as someone else's meeting, all-day
  informational entries (holidays, birthdays, travel), and any transparent / free-marked event.
- **Proposed as tasks** — imperative or deliverable-shaped titles ("Submit IB report",
  "Q3 deck due", "Essay deadline"), events whose title carries a deadline word
  (due / submit / deadline / hand in / dateline), and short solo entries that read as
  reminders rather than meetings.
- **Flagged unsure** — everything plausible but ambiguous, surfaced with the reason that
  triggered it so a single tap resolves it.
- **Estimates and categories** reuse existing logic: the keyless estimator's median of similar
  past tasks for duration, and `guessCatLocal` word overlap for category, with the event's own
  duration as a floor.
- **Idempotency** is the thing to get right. Each item is keyed on a stable event identity
  (provider UID plus occurrence date), so re-scanning never re-proposes something you already
  ticked off, added or dismissed. Status (`open` / `added` / `dismissed` / `event`) persists per
  key, and the artifact's promise — "ticked items aren't flagged again" — holds across every
  future scan.
- **With an API key present**, the same event batch is additionally passed to the model for
  classification and titling, which mainly improves the unsure bucket and turns calendar
  shorthand into clean task titles. Without one, the heuristics stand alone.

The job writes `inbox_items` and `scan_state`; the client subscribes to both, so the panel
appears without a refresh.

### AI fill without a key

The entire pipeline gets built — prompt construction with free slots and similar past tasks,
the strict validator, the yellow "suggested" field marking, the retry, the `estSource`
tracking. The `ai-fill` function simply returns `{disabled: true}` while no key is configured,
and the UI takes the degradation path the artifact already has ("AI fill is off for this view.
Filled what I could from your text."). Adding a key later is a one-line secret, no code change.

Worth doing in the meantime: a **keyless estimator**. `similarPast()` already finds comparable
completed tasks with estimated-versus-actual times; taking their median actual gives a genuinely
useful estimate suggestion with no model call at all. It is labelled as coming from your own
history, not from AI.

---

## 3. Phases

Each phase ends with something runnable. Phase 2 is the first point at which Daybook is usable
for real work.

| # | Phase | Contents | Done when |
|---|---|---|---|
| 0 | Scaffold | Vite + React + TS, ESLint, Prettier, Vitest, GitHub Actions; Supabase project and local CLI; migrations for every table with RLS; Google sign-in | `npm run dev` serves an authenticated empty shell; `npm test` green |
| 1 | Domain | Port `task`, `priority`, `freetime`, `capture`, `metrics`, `format` as pure modules; **unit tests first** — autoPri at every boundary, attention across the buffer, freeMin against overlapping and all-day events, and ~60 capture-parser cases drawn from the formats listed above | 100% of the exported domain surface covered; no React or Supabase import anywhere under `domain/` |
| 2 | Core app | Token CSS, shell, tabs, bottom nav, sheets, toasts; Tasks view with filters, sorting, grouping, rows; the full editor including the time sanity checker; timers with the focus bar and single-timer rule; store, write queue, realtime, offline banner | You can run your real task list on it |
| 3 | Dashboard + Calendar | Stat strip, focus cards, agenda with the now line, priority panels, week-load bars; week-grid calendar reading `calendar_events`; Settings with categories, planning rules, calendar visibility | Dashboard matches the artifact's at identical data |
| 4 | Calendar sync | `calendar-sync` Edge Function; `icloud-caldav` provider; credential capture and Vault storage; 10-minute schedule; reconnect states; `google` provider behind the same interface | Real iCloud events drive free-time maths end to end |
| 5 | Insights + archive | All eight KPIs, narrative lines, both charts, the completed table; archive table and its inclusion in metrics | Figures match hand-computed values on seeded data |
| 6 | Notion | `notion-backup` function: batched creates, delta updates, archive-only-after-success, deletion marking, retry queue, 20-hour auto-run, per-error messaging | A task edited here appears correctly in Notion; a forced failure archives nothing |
| 7 | Capture + AI | Capture bar with live chips, `fitText` on add, local category guess, keyless estimator; full AI pipeline returning `{disabled:true}` | Every parser format works; adding a key activates AI with no code change |
| 8 | Inbox + scan | `inbox_items` and `scan_state` tables; the inbox panel with add / not-a-task / tick-off / promote-to-task; the `inbox-scan` scheduled job with heuristic classification, stable per-occurrence keys and idempotent re-scans; recurring-event summarisation; optional AI classification when a key exists | A morning scan of a real calendar proposes the right tasks, and re-running it never re-proposes a handled item |
| 9 | Ship | PWA manifest and service worker, `#add` shortcut, deploy, offline shell | Installs on iPhone; the home-screen shortcut opens capture focused |

### Data migration — not needed
Confirmed: the artifact holds no tasks worth keeping. No export or import step, and no
migration script. The new app starts from an empty database, and the 5-task example loader
(itself part of parity) covers any need for demo data.

---

## 4. Beyond parity

Flagged, not assumed. "A full task tracker" could reasonably mean some of these; none are in
the phases above and none will be built without your say-so.

- **Recurring tasks.** The artifact detects recurrence in calendar events but can never create a
  repeating task. The most conspicuous gap for a real tracker.
- **Subtasks or checklists**, with progress rolling up from children.
- **Search** across titles and notes — there is none today.
- **Undo.** Deletion is two-tap confirm with no recovery; a soft-delete trash plus undo toast is
  strictly safer.
- **Manual priority override.** Priority is 100% automatic by design, which is a real strength,
  but there is no way to pin something urgent that the rules do not see.
- **Time blocking.** `fitText` already computes which free block a task fits into — actually
  *writing* that block to your calendar is a small step with a large payoff.
- **Reminders and push notifications**, for planned starts and approaching deadlines.
- Multiple tags alongside the single category; dependencies and blocked-by; multi-select bulk
  edit; keyboard shortcuts beyond Escape; attachments and links; CSV and ICS export; full
  offline-first with background sync.

---

## 5. Verification

**Domain (phase 1, and continuously).** Vitest unit tests are the backbone. Table-driven cases
for `autoPri` at each threshold boundary and for the "remaining ≥ time left" escalation; for
`attention` either side of the buffer multiplier; for `freeMin` and `freeBlocks` against
overlapping events, all-day events, transparent events and waking-hour edges; for the capture
parser across every format in the inventory, with a frozen clock; for `metrics` against
hand-computed fixtures. `npm test` in CI on every push.

**Integration (phase 2 onward).** Supabase local with seeded users. Assert that RLS actually
denies cross-user reads — attempt to read another user's tasks and require failure. Verify the
per-id write queue serialises by firing concurrent edits to one task and checking the final row.
Verify realtime by writing from a second client and asserting the first re-renders.

**Calendar sync (phase 4).** Against a real iCloud account with an app-specific password:
confirm event counts and times match Calendar.app including all-day and multi-day events;
confirm free-time figures match hand calculation for one known day; confirm a deliberately
wrong password surfaces the reconnect state rather than silently showing an empty week; confirm
the 10-minute refresh picks up an event added on the phone.

**Notion (phase 6).** Round-trip a task and compare every property in Notion. Then force a
failure — revoke the token mid-run — and assert that **nothing was archived** and that the
error message names the cause. Delete a task offline and confirm the pending-delete queue
retries.

**Inbox scan (phase 8).** Against a real calendar week: assert that recurring entries, holidays
and other people's meetings are not proposed, and that deadline-shaped entries are. Then the
idempotency test that matters most — tick off, add and dismiss one item each, re-run the scan,
and assert none of the three reappears and that `scan_state` advances. Re-run again with an
event's time changed and assert it is treated as the same occurrence, not a new proposal.

**Parity (before shipping).** Load identical data into both the artifact and the new app side by
side and compare, screen by screen: the stat strip, each dashboard panel's membership and order,
every task row's chips and reason text, each week-load bar, and all eight Insight KPIs. Any
divergence is a bug in the port, not an improvement, unless deliberately noted.

**End to end (phase 9).** Playwright, pre-installed in this environment: sign in → capture
"IB report, Fri 5pm, ~3h, #school" → assert the parsed chips → save → assert the row's priority
pill, due chip and fit text → start the timer → assert the focus bar counts down → complete →
assert the "how long" prompt → assert the Insights completion rate moves.
