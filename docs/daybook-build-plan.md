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
repo) at **full feature parity first** (section 1), then adds the capabilities the artifact
could never have (section 2): a manual escape hatch over automatic priority, priority rules you
can edit, search, recoverable deletion, a notification engine delivering over both web push and
Telegram, and a Telegram bot that also accepts new tasks by text or photo. Decisions already made: React + TypeScript + Vite in this repo; Supabase
for data and auth; Google Calendar, Notion backup, AI fill and the calendar-to-task scan all
carried over; Apple Calendar preferred over Google if it can be made to work; AI fill built now
but shipped without an API key; web push to the installed iPhone PWA and Telegram as
two complementary notification channels. Nothing from the
artifact's data needs migrating.

One theme runs through section 2. Every new feature is powered by rules the app already
computes — priority, attention, free time, capacity — so the work is mostly about **surfacing
and persisting** what the engine already knows, not inventing new logic. The exceptions are
photo intake, which needs a vision model, and the dedupe ledger, which is genuinely new
machinery.

---

## 1. Capability inventory (the parity contract)

This is the authoritative list of what "all the capabilities I've included so far" means,
read off the artifact source. Nothing here is optional.

### Shell and interaction
- Four views — Dashboard, Tasks, Calendar, Insights — with the active tab persisted.
- Top tab bar on desktop; fixed bottom navigation on phones, with safe-area insets.
- **Appearance control: Match device / Light / Dark**, stored per device in `localStorage`
  rather than synced, so a phone used at night and a laptop at a desk can differ. `auto`
  removes the attribute so `prefers-color-scheme` takes over; the other two pin it.
- Header sync status line that names the live state ("Google Calendar live · 14:32",
  "Calendar snapshot Mon 13 Oct", "Not saving") plus a manual Refresh.
- Modal bottom sheets with focus trapping, Escape, backdrop dismissal.
- Toasts; a "how long did it take?" chip prompt.
- `#add` deep link that opens with the capture box focused — the home-screen shortcut.
- A 1-second tick for running timers and a 5-minute silent re-render so relative times
  ("in 3h", "2d overdue") never go stale.
- Re-render preserves in-progress input values, focus and text selection.

### Design system — "colour block"
The artifact was reskinned, so the visual language is now: **Archivo Black** headings, set
uppercase and tight; **Archivo** for body; JetBrains Mono for every figure. Flat
lime / tomato / yellow / sky / pink blocks, thick ink outlines (2–2.5px) and **hard offset
shadows with no blur**. Buttons press like physical keys — lifting on hover, sinking on
press — and the primary button throws a lime shadow instead of a grey one.

Two groups of colour behave differently on purpose, and the port must preserve the
distinction: the `--b-*` block colours are **identical in light and dark**, because they are
the skin's signature; the `-weak` tints, which sit under text, do flip. A separate `--line`
and `--sh` pair draws outlines and shadows, because in dark mode the outline inverts to
near-white while the shadow stays black — so they cannot share a token with `--rule`, which
is the hairline between rows.

Consequence for phase 5: chart marks carry ink outlines (`stroke: var(--line)`), so the
Insights charts are drawn as outlined blocks rather than flat fills.

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

## 2. Additions beyond the artifact

Section 1 is parity. This section is new capability, and it changes the shape of the build in
three places: priority stops being purely derived, deletion stops being destructive, and the
app gains a server-side scheduler plus a second front end in the form of a Telegram bot.

### 2.1 Manual priority override
- `priorityMode` per task — `auto` (the default) or `manual`.
- When manual, `priorityManual` holds High / Medium / Low and wins everywhere priority is
  used: rows, sorting, grouping, Notion, notifications.
- The editor's priority box becomes a four-way control: **Auto** (showing the computed level
  and its reason) · High · Med · Low.
- Pinning a level keeps the computed one visible as "Auto would say Medium", so overriding
  never costs you the information.
- A pinned task carries a small marker on its priority pill, so you can see at a glance that it
  is no longer tracking its deadline. One tap returns it to Auto.
- Consequence worth knowing: a pinned task will not escalate on its own. Overdue and at-risk
  detection still fire, since those are separate signals, but the pill stops moving. The marker
  exists so this never surprises you.

### 2.2 Editable priority rules
Today the day thresholds are editable and the rest is hardcoded. All of it moves into Settings:
- High if due within N days · Medium if due within N days · start-now buffer multiplier
  (these three already exist).
- **Toggle:** escalate to High when the remaining estimate no longer fits before the deadline.
- **Toggle:** overdue is always High.
- **Choice:** what a task with no due date gets — Low, Medium, or no priority at all.
- A live preview in Settings showing how many of your current tasks would sit at each level
  under the edited rules, so the effect is visible before you save.

Deliberately *not* building a general rules builder — per-category weights, custom expressions,
boolean conditions. That is a large UI for a personal tracker, and the six controls above cover
the real cases. Easy to extend later if it turns out they do not.

### 2.3 Search
- Instant and as-you-type, across title, notes and category.
- `/` or Cmd/Ctrl-K focuses it from anywhere.
- Open tasks are searched client-side with no round trip; the query extends to completed and
  archived tasks server-side, using Postgres full-text plus trigram matching so typos and
  partial words still hit.
- Scope toggle: open only, or everything including the archive.
- Results use the row rendering you already know — priority, countdowns, attention reason.
- Escape clears and restores your previous filters.

### 2.4 Undo and safe deletion
- Deletion becomes **soft** — a `deletedAt` timestamp. Deleted tasks disappear from every view
  and from all Insights figures, but the row survives.
- **Double confirmation**, as asked: the Delete button arms on first tap, then a dialog names
  the task and states what will happen before anything is removed.
- An **Undo** toast immediately afterwards, restoring in one tap.
- A **Trash** list in Settings holding everything deleted in the last 30 days, with Restore and
  Delete permanently.
- Hard deletion after 30 days, run by the same job that archives.
- Notion stays truthful: a soft delete marks the Notion row Deleted, and restoring flips it back
  to its real status rather than leaving a lie in the backup.
- Undo also covers **completing** a task and **clearing a timer**, since those are the other two
  actions that silently destroy state.

### 2.5 Notifications
The rules engine already knows when something deserves attention. Notifications are that
knowledge, pushed.

| Type | Fires when |
|---|---|
| Morning digest | Daily at your chosen time: due today, start now, overdue count, and whether today is already over capacity |
| Start now | A planned start arrives, or remaining work stops fitting before the deadline |
| Due soon | Configurable lead times before a deadline (default 24h and 2h) |
| Became overdue | A deadline passes with the task unfinished |
| Priority escalated | Computed priority rises — Low→Medium, Medium→High — with the reason |
| At risk | An in-progress task can no longer fit before its deadline |
| Day over capacity | Planned work for a day exceeds the free time left in it |
| Scan results | The morning calendar scan found tasks worth confirming |
| Evening wrap *(optional)* | What you logged, what slipped, tomorrow's first start |

Controls: per-type on/off, per-category mute, digest time, lead times, and **quiet hours that
reuse your existing day-start and day-end** so nothing arrives at 3am — anything firing inside
quiet hours queues to the next window. Snooze directly from the notification.

Two consequences worth stating plainly:
- **Priority is currently computed and never stored.** Detecting an *escalation* means
  persisting the last level you were told about, per task, so the scheduler can recompute and
  compare. A new column and a small ledger, not a redesign.
- **A `notifications_sent` ledger is mandatory**, keyed on task + type + threshold. Without it a
  scheduler running every few minutes will tell you the same thing over and over, which is the
  most common way notification systems become unusable and then muted forever.

The pure `domain/` layer pays for itself here: the same priority and free-time code runs
unchanged inside a scheduled Deno function, so the server can never disagree with the UI about
whether something is High.

### 2.6 Channels

Two first-class channels with complementary strengths, plus email for the digest.

**Web push** to the iPhone home-screen PWA. This is the channel that feels like a real app: a
notification on the lock screen, in Notification Centre, respecting Focus modes, with a count
badge on the app icon. Tapping it opens straight to the task. Its weakness is that it cannot
reliably carry **action buttons** on iOS (see 2.8), so it is a glance-and-tap channel.

**Telegram**, which is the opposite: no action-button limitation at all. Inline keyboards work
perfectly, so this is where **Add / Edit / Discard**, snooze and mark-done live — and it is
two-way, so it doubles as an input method. It also survives everything that can break a push
subscription.

So they are not redundant, and the split is deliberate:

| | Web push | Telegram |
|---|---|---|
| Lock-screen glance, app badge | ✅ the better channel | — |
| Deep link into a task | ✅ | ✅ |
| Buttons on the notification itself | ✗ unreliable on iOS | ✅ inline keyboards |
| Creating tasks by text or photo | — | ✅ |
| Survives uninstall, storage eviction, permission loss | ✗ | ✅ |

**Per-type channel routing** in Settings, since the right channel differs by notification: the
morning digest suits push plus email; an imminent deadline is worth both; priority escalation is
push-only noise-wise; anything needing a decision (confirm a scanned task, snooze) belongs in
Telegram where the buttons work.

**Email**, digest only — cheap, and a sane fallback if Telegram is down. Not for time-sensitive
alerts.

### 2.7 Telegram bot

**Setup and binding.** Bot created through BotFather, token held in Supabase Vault. Linking uses
a one-time deep link (`t.me/<bot>?start=<nonce>`) so the chat is tied to your account, and the
bot ignores every message from an unbound chat. The webhook is registered with Telegram's
`secret_token` and the function rejects any request lacking the matching header — without that,
anyone who learns the URL can post fake updates into your task list.

**Text input.** A plain message runs through **the same capture parser the web app uses**, so
`tmr 5pm`, `~3h` and `#school` behave identically in both places. The bot replies with what it
understood plus an inline keyboard: **Add · Edit · Discard**. Nothing is created without that
tap — the gate you asked for. Edit offers two routes: reply in natural language ("due friday
instead, 2h") to amend the draft, or tap through to the web editor prefilled.

**Photo input.** Send a photo of an assignment brief, a syllabus, a whiteboard or a printed
timetable. The bot fetches the largest available size, passes it to a vision model, and extracts
task details. Because one photo often contains several tasks, it proposes a **list** — each item
individually confirmable, dismissable and editable before it is added. Same gate: nothing enters
Daybook unconfirmed.

**Commands.** A small, memorable set rather than a CLI: `/today`, `/next`, `/overdue`,
`/done <n>`, `/timer <n>`, `/snooze`, `/link`, `/help`.

**Drafts** live in their own table with an expiry, so an unconfirmed proposal from three days ago
cannot be added by a stray tap.

Three things to be clear-eyed about:
- **Photo intake needs an API key.** Text capture works keyless because the parser is
  rule-based; vision has no offline substitute. Until a key exists the bot says so plainly and
  offers to attach the photo to a task you fill in yourself, rather than failing quietly.
- **Task titles will pass through Telegram's servers**, and photos sent for extraction reach the
  model provider. Both are reasonable, and both should be a conscious choice rather than a
  surprise discovered later.
- **Rate limits** are roughly one message per second per chat, so the digest and any multi-task
  photo reply must batch into one message rather than firing one per item.

### 2.9 The capacity model — two corrections to the artifact's free-time maths

Both of these came out of reviewing the engine against how the day actually works,
rather than how a calendar describes it. They change what the engine computes, so
they are settled before the domain layer is written.

#### A calendar event does not block all of its own time

The artifact treats every timed event as fully blocking and every all-day event as not
blocking at all. Neither extreme survives contact with a real schedule: a 9-to-6 job is a
single nine-hour event that still contains plenty of usable task time, while an all-day
"Conference in KL" blocks the day completely and an all-day "Public Holiday" blocks nothing.

Each event therefore carries a **usable fraction** — how much of itself remains available —
and contributes `duration × (1 − usable_fraction)` of blocked time. Resolution order:

1. A per-event override, set from the calendar or inbox.
2. A per-calendar default, so a work calendar is configured once rather than per event.
3. A heuristic, so it is useful with no configuration at all: events at or beyond
   `long_event_hours` (default 4) are treated as containers and take `long_event_usable`
   (default 0.30); shorter events block fully; all-day events take `allday_usable`
   (default 1.00).

The defaults reproduce the artifact's current behaviour exactly for short and all-day
events, so this generalises rather than changes anything by surprise.

**Capacity is not the same as schedulability, and the split matters.** A porous event
yields usable *minutes* but no usable *block*, because nothing says which parts of it are
free. So porous time counts toward "do you have enough hours" (`freeMin`, the load bars,
priority) but never toward "here is exactly when" (`freeBlocks`, `fitText`, AI slot
suggestions). Without that split the app would cheerfully promise "fits Thursday
09:00–12:00" in the middle of a workday meeting.

A separate `capacity_factor` (default 1.00, so opt-in) scales ordinary free time down to
something a person will really work, since meals, travel and rest live in the gaps a
calendar does not record.

#### Sleep is reserve, not absence

Night hours must not simply vanish — an all-nighter is a real option and the app should
know about it. But they must not count as ordinary capacity either, or nothing is urgent
until a 7am deadline is seven hours away and six of those are spent asleep.

So free time is computed as **two figures**:

- **Ordinary capacity** — waking, unbooked, porosity-adjusted. This drives the start-now
  trigger, the load bars and everything that asks "is there enough time".
- **Night reserve** — the hours reachable only by cutting into sleep. Tracked separately,
  never folded into capacity, and surfaced exactly when it becomes decisive.

The reason strings get materially better as a result:

> Needs 4h. 2h free before you sleep, 9h more if you work through the night.

And the engine gains something it could not previously express: when
`capacity + reserve < remaining`, the task **cannot be finished even with an all-nighter**.
The artifact can only ever say "start now"; it has no way to say "this is no longer
possible, so cut the scope or move the deadline". That is carried as a flag on the existing
attention signal rather than a new state, keeping the `over` / `start` / `risk` machine
as it is.

#### The start-now trigger switches basis

Following from both: `attention()` moves off raw wall-clock time
(`free = (due - now)`) and onto ordinary capacity (`freeMin(now, due)`). Clock time counts
sleep and meetings as working hours, which is why the trigger currently stays quiet in
exactly the situations it exists to catch.

Capacity is always smaller than clock time, so the trigger fires **earlier and more often**.
The default buffer therefore drops from 1.5 to **1.2** — the old multiplier was compensating
for a measure that was too generous, and keeping both would make everything urgent at once.
Buffer stays a setting, so it is tunable from the first day of real use.

#### Week-load bars spread work across free blocks

A task's remaining estimate is distributed backwards from its target date into the days
that actually have capacity, instead of landing entirely on the target day. A 20-hour task
due Friday currently shows Friday "Over by 12h" with Monday to Thursday empty, which is
precisely backwards for the multi-session work the engine already detects. The spreading
logic is also what a future time-blocking feature would need.

---

### 2.8 Web push on iOS — the constraints that shape the build

iOS web push works, and has since 16.4, but it is hedged by platform rules that are not
negotiable. They are listed here because three of them change the design rather than merely
inconvenience it.

**Installation is mandatory.** Push only exists for a web app added to the Home Screen. In an
ordinary Safari tab `Notification` is undefined and `pushManager.subscribe()` has no path to a
subscription. From iOS 26 any site added to the Home Screen with "Open as Web App" enabled (the
default) qualifies, but the install step is still manual — there is no prompt we can trigger.
*Design consequence:* the Enable-notifications control only appears when the app detects it is
running installed (`display-mode: standalone`); in a browser tab it is replaced by
Add-to-Home-Screen instructions rather than a button that cannot work.

**Permission must come from a real tap.** It has to be requested inside a click handler. Calls
from `setTimeout`, `DOMContentLoaded` or any automatic code fail — `subscribe()` throws
`NotAllowedError` and `requestPermission()` resolves to "denied" without ever prompting.
*Design consequence:* an explicit button, never an on-load prompt. One shot, so the button sits
behind a short explanation of what will be sent.

**Every push must display a notification — this is the big one.** Subscriptions must be created
with `userVisibleOnly: true`, and WebKit **revokes an origin's push subscription** after
repeated pushes that show nothing. That rules out two things:
- No silent pushes for background data sync. Combined with iOS having no Background Sync,
  Periodic Background Sync or Background Fetch at all, the offline story stays an offline
  *shell* — the app cannot quietly refresh itself while closed.
- **Quiet hours and deduplication must be enforced server-side, before a push is sent.** The
  tempting client-side design — push arrives, service worker decides whether to show it — is
  exactly the pattern that gets the subscription revoked. This is why the `notifications_sent`
  ledger and the quiet-hours window live in `notify-run` and not in the service worker.

**Declarative Web Push** (iOS and iPadOS 18.4+) is the more robust transport and worth using: a
JSON payload keyed `web_push: 8030` with a `notification` object, displayed **without the
service worker having to run**. `title` and `navigate` are both required and the message is
**silently dropped** if either is missing, so the payload builder validates before sending. A tap
still launches the service worker and dispatches `notificationclick`. The plan sends **one
payload carrying both shapes** — declarative keys for Safari, which every other browser's push
handler simply ignores as extra keys — so there is one code path rather than per-browser
branching.

**Action buttons are the open question.** Declarative payloads appear to accept `actions`, each
with its own `navigate`, but this is unconfirmed on iOS by any Apple-authored source. The plan
therefore **does not depend on them**: the primary tap deep-links to the task, which is useful on
its own, and every interactive affordance (snooze, mark done, confirm a scanned task) is routed
to Telegram, where inline keyboards are certain. If iOS action buttons prove reliable during
phase 6, they become a bonus rather than a repair.

**Subscriptions are fragile and must be treated as disposable.** Removing and re-adding the PWA
invalidates them, and storage can be evicted after long inactivity. So: subscriptions are stored
per device in `push_subscriptions` (you may install on more than one), the sender **prunes any
endpoint returning 404 or 410**, and the client verifies its subscription on launch and silently
re-subscribes if it has gone. Without this a dead endpoint sits there failing forever.

**Smaller facts that still matter.** Payloads cap at roughly 4KB, so a notification carries a
task id and a deep link rather than task content. Badging via `navigator.setAppBadge()` works but
only once notification permission is granted — wired to the existing attention count, so the app
icon shows how many tasks are overdue or need starting. Push is standard VAPID, so no Apple
developer account or APNs certificate is needed.

**One implementation risk to retire early.** Sending web push means VAPID (an ES256 JWT) plus
`aes128gcm` payload encryption, and the usual Node library for this is `web-push`, while Supabase
Edge Functions run Deno. Either it loads cleanly via an `npm:` specifier or the signing and
encryption get done directly, which is well-documented but fiddly. This gets a spike at the top
of phase 6, before anything is built on it — it is the one piece of the notification work that
could need a different home.

*Sourcing note: these behaviours come from WebKit release notes, Apple's WWDC25 Declarative Web
Push session and several third-party summaries. The install, gesture and `userVisibleOnly` rules
are consistent across every source; iOS action-button support is the one claim no Apple source
confirmed, which is why nothing depends on it.*

---

## 3. Target architecture

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
│      ├─ inbox-scan/      calendar → proposed tasks, heuristic-first
│      ├─ notify-run/      scheduled: evaluate rules, dedupe, dispatch
│      ├─ notify-digest/   scheduled: morning digest, evening wrap
│      ├─ telegram-hook/   inbound webhook: text, photos, commands, callbacks
│      └─ push-send/       VAPID + aes128gcm; declarative + legacy payload in one
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
| `tasks` | the model above plus `priority_mode`, `priority_manual`, `deleted_at`, `last_notified_priority`; `updated_at` trigger; indexes on `(user_id, due)`, `(user_id, completed_at)`, a partial index excluding soft-deleted rows, and a GIN index over title+notes for search |
| ~~`task_archive`~~ | **Dropped in phase 0.** Archiving exists in the artifact because the claude.ai store had a quota; Postgres does not, and a personal tracker will not outgrow one table. It became an `archived_at` flag on `tasks`, which removes a class of sync bug and makes "archived tasks still count in Insights" true by default rather than by join. `archive_days` now only controls when the flag is set and the row leaves the default views. |
| `categories` | id, name, colour, sort order |
| `settings` | one row per user: buffer, highDays, medDays, wakeStart, wakeEnd, archiveDays, hiddenCals, lastBackupAt, lastArchiveRun, **capacity model (`long_event_hours`, `long_event_usable`, `allday_usable`, `capacity_factor`, `night_reserve_enabled`)** |
| `calendar_accounts` | provider (`icloud` / `icloud_ics` / `google`), credential reference in Vault, per-calendar visibility, **default usable fraction** |
| `calendar_events` | server-maintained event cache: start, end, all_day, title, calendar, busy, provider, **`usable_fraction`** |
| `inbox_items` | proposed tasks with kind, reason, status, `task_id` |
| `scan_state` | last scan time, recurring-event summary |
| `notion_pending_deletes` | retry queue, promoted out of the settings blob |
| `notification_prefs` | per-type toggles **and per-type channel routing**, digest time, lead times, quiet hours, muted categories |
| `notifications_sent` | dedupe ledger keyed on task + type + threshold |
| `telegram_links` | chat_id ↔ user_id binding, link nonces, bound-at |
| `push_subscriptions` | one row per installed device: endpoint, keys, user agent, last-seen; pruned on 404/410 |
| `task_drafts` | unconfirmed proposals from the bot, with source (text / photo) and expiry |

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

## 4. Phases

Each phase ends with something runnable. Phase 2 is the first point at which Daybook is usable
for real work.

| # | Phase | Contents | Done when |
|---|---|---|---|
| 0 | Scaffold | Vite + React + TS, ESLint, Prettier, Vitest, GitHub Actions; Supabase project and local CLI; migrations for every table with RLS; Google sign-in | `npm run dev` serves an authenticated empty shell; `npm test` green |
| 1 | Domain | Port `task`, `priority`, `freetime`, `capture`, `metrics`, `format` as pure modules, now including **effective priority** (manual override beating auto), **configurable rules** read from settings rather than hardcoded, and **the capacity model of section 2.9** — porous events, capacity versus schedulability, night reserve, and the start-now trigger on capacity rather than clock time; **unit tests first** — every priority boundary, attention across the buffer, freeMin against overlapping and all-day events, ~60 capture-parser cases | 100% of the exported domain surface covered; no React or Supabase import anywhere under `domain/` |
| 2 | Core app | Token CSS, shell, tabs, bottom nav, sheets, toasts; Tasks view with filters, sorting, grouping, rows; **search**; the full editor including the time sanity checker and the **four-way priority control**; **soft delete with double confirmation and undo**; timers with the focus bar and single-timer rule; store, write queue, realtime, offline banner; **PWA manifest, service worker and installability, moved early so it lives on your home screen from here on**; task deep-link routes (`/task/:id`) that notifications will later target | You can install it on your phone and run your real task list on it, and nothing you do is unrecoverable |
| 3 | Dashboard + Calendar + Settings | Stat strip, focus cards, agenda with the now line, priority panels, week-load bars; week-grid calendar reading `calendar_events`; Settings with categories, **editable priority rules and their live preview**, planning rules, calendar visibility, **Trash** | Dashboard matches the artifact's at identical data; editing a priority rule visibly re-sorts the list |
| 4 | Calendar sync | `calendar-sync` Edge Function; `icloud-caldav` provider; credential capture and Vault storage; 10-minute schedule; reconnect states; `google` provider behind the same interface | Real iCloud events drive free-time maths end to end |
| 5 | Insights + archive | All eight KPIs, narrative lines, both charts, the completed table; archive table and its inclusion in metrics; soft-deleted rows excluded everywhere | Figures match hand-computed values on seeded data |
| 6 | Notifications + both channels | **Opens with the VAPID/`aes128gcm`-in-Deno spike, before anything depends on it.** Then `notification_prefs` (including per-type channel routing), `notifications_sent`, `telegram_links`, `push_subscriptions`; `notify-run` and `notify-digest` on pg_cron; the domain layer running server-side so server and UI never disagree; **quiet hours and dedupe enforced server-side, as iOS requires**; snooze. **Web push**: gesture-gated opt-in shown only when installed, combined declarative + legacy payload, endpoint pruning on 404/410, client-side re-subscribe, app-icon badging from the attention count. **Telegram**: secret-token webhook verification, nonce binding, outbound delivery, inbound text through the shared parser, the Add/Edit/Discard gate, command set | A real deadline produces exactly one well-timed message on the channel you chose; a push arriving in quiet hours was never sent rather than suppressed; a task typed into Telegram only lands after you tap Add |
| 7 | Notion | `notion-backup` function: batched creates, delta updates, archive-only-after-success, deletion and restoration marking, retry queue, 20-hour auto-run, per-error messaging | A task edited here appears correctly in Notion; a forced failure archives nothing; a restore un-marks it |
| 8 | Capture + AI | Capture bar with live chips, `fitText` on add, local category guess, keyless estimator; full AI pipeline returning `{disabled:true}`; **Telegram photo intake** with multi-task extraction, per-item confirmation and honest keyless degradation | Every parser format works; adding a key activates AI fill and photo intake with no code change |
| 9 | Inbox + scan | `inbox_items` and `scan_state`; the inbox panel with add / not-a-task / tick-off / promote-to-task; the `inbox-scan` scheduled job with heuristic classification, stable per-occurrence keys and idempotent re-scans; recurring-event summarisation; optional AI classification when a key exists | A morning scan of a real calendar proposes the right tasks, and re-running it never re-proposes a handled item |
| 10 | Ship | Custom domain, deploy, offline shell hardening, `#add` shortcut, icon set and splash screens; install and notification-permission onboarding | Installs cleanly on iPhone, the home-screen shortcut opens capture focused, and push survives a reinstall |

### Data migration — not needed
Confirmed: the artifact holds no tasks worth keeping. No export or import step, and no
migration script. The new app starts from an empty database, and the 5-task example loader
(itself part of parity) covers any need for demo data.

---

## 5. Beyond parity

Flagged, not assumed. None are in the phases above; none get built without your say-so.

- **Recurring tasks.** Now the largest remaining gap, and more valuable than before: the scan
  recognises recurring *events* and notifications will fire on schedules, yet nothing can create
  a repeating *task*. A weekly reading or a monthly report still has to be re-entered by hand.
- **Subtasks or checklists**, with progress rolling up from children.
- **Time blocking.** `fitText` already computes which free block a task fits into; actually
  *writing* that block back to your calendar is a small step with a large payoff — and it would
  make the start-now notification far more actionable.
- **Multiple tags** alongside the single category.
- **Dependencies and blocked-by**, so a task cannot demand attention before its predecessor is
  done.
- **Multi-select bulk edit** — reschedule or recategorise several tasks at once.
- **Keyboard shortcuts** beyond search and Escape.
- **Attachments and links** on a task (the Telegram photo path makes this more tempting, since
  the source image is often worth keeping).
- **CSV and ICS export.**
- **Full offline-first** with background sync and conflict resolution, rather than an offline
  shell.

---

## 6. Verification

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

**Priority and deletion (phase 2–3).** Assert manual override beats auto everywhere priority is
consumed — row, sort, group, Notion payload, notification eligibility — and that reverting to
Auto restores the computed level. Edit each priority rule and assert the whole list re-sorts and
the Settings preview counts match. For deletion: soft-delete a task and assert it leaves every
view *and* every Insights figure while the row persists; undo and assert full restoration;
let the 30-day window lapse and assert hard deletion; confirm a restore un-marks the Notion row
rather than leaving it Deleted.

**Notifications (phase 6).** The dedupe ledger is the thing most likely to fail in a way you
only notice after it has annoyed you, so test it hardest: run the scheduler repeatedly over
unchanged data and assert exactly zero repeat sends. Assert a notification firing inside quiet
hours queues to the next window rather than being dropped or delivered. Assert priority
escalation fires once per transition, not once per scheduler tick, and that a manually pinned
task produces no escalation messages. Assert snooze suppresses for exactly its interval. Use a
frozen clock throughout.

**Web push (phase 6).** Most of this can only be tested on a real iPhone with the app actually
installed, so it is hands-on rather than automated. Assert the opt-in button is absent in a
Safari tab and present once installed. Assert permission is granted from a tap and that no
on-load prompt exists. Then the rule that protects the subscription: assert **every** push the
server sends results in a visible notification, and that a notification due inside quiet hours
was never dispatched rather than dispatched-and-hidden — a unit test on `notify-run` plus a
live check. Assert a declarative payload missing `title` or `navigate` is rejected by the
builder rather than silently dropped by iOS. Assert tapping a notification deep-links to the
right task. Remove and re-add the PWA, then assert the stale endpoint is pruned on its next
404/410 and the client re-subscribes on launch. Assert the app badge matches the attention
count.

**Telegram (phase 6, 8).** Post a forged update with no secret-token header and assert rejection.
Post from an unbound chat and assert it is ignored. Send a message with a parseable task and
assert **nothing is written to `tasks`** until the Add callback arrives — the gate is the whole
point, so it gets an explicit negative test. Assert an expired draft cannot be confirmed. Assert
a multi-task photo reply arrives as one batched message, not one per item, and that with no API
key the bot explains itself instead of failing silently.

**Parity (before shipping).** Load identical data into both the artifact and the new app side by
side and compare, screen by screen: the stat strip, each dashboard panel's membership and order,
every task row's chips and reason text, each week-load bar, and all eight Insight KPIs. Any
divergence is a bug in the port, not an improvement, unless deliberately noted.

**End to end (phase 9).** Playwright, pre-installed in this environment: sign in → capture
"IB report, Fri 5pm, ~3h, #school" → assert the parsed chips → save → assert the row's priority
pill, due chip and fit text → start the timer → assert the focus bar counts down → complete →
assert the "how long" prompt → assert the Insights completion rate moves.

---

## 7. Hosting and environments

**Frontend on Vercel. All server code in Supabase.** The split is not arbitrary — one platform
limit decides it.

**Vercel Cron on the Hobby plan runs at most once per day**, sub-daily schedules are rejected at
deploy time, and even the daily run is only guaranteed within its scheduled hour. Per-minute
scheduling requires Pro. The notification engine has to evaluate "is anything due in two hours,
has anything escalated, has a planned start arrived" every few minutes, so Vercel Cron cannot
drive it on the free plan. Supabase `pg_cron` schedules per-minute on the free tier, which is
what section 3 already assumed. *(Both figures come from third-party write-ups rather than
official docs — worth confirming before paying for Pro on the strength of them.)*

Three further reasons to keep the backend in Supabase even where Vercel could host it:

1. **Co-location.** The Supabase project belongs in Singapore (`ap-southeast-1`). Vercel
   functions default to US East, so a Vercel-hosted route querying the database would cross the
   Pacific twice per call. Edge Functions run beside the database.
2. **One secrets store.** The Apple app-specific password, Notion token, Anthropic key and
   Telegram bot token all live in Supabase Vault — not split across Vault and Vercel env vars.
3. **Vercel then holds no secrets at all**, only the Supabase anon key, which is public by
   design and bounded by row-level security.

**Stay on Vite; do not switch to Next.js.** The only reasons to switch are Vercel API routes or
server rendering, and neither applies: the backend lives in Supabase, and the app is private and
auth-gated so there is no SEO case. A Vite SPA deploys to Vercel as static output.

**Alternatives considered.** Cloudflare Pages is equivalent for static hosting with a more
generous free tier, but offers nothing extra once the backend is in Supabase. Netlify is a wash.
Fly.io or Railway would only earn their keep if a long-running process were needed, and none is.
Nothing justifies moving off Vercel.

### Environment setup

| Decision | Why it matters now |
|---|---|
| **Custom domain from day one** | The quick-add home-screen link and the PWA's identity both bake in the URL. Changing it later breaks every shortcut already added to a phone. |
| **Separate Telegram bot token for dev** | Otherwise the first scheduler test against seeded data fires a dozen messages into the real chat. Pair it with a second Supabase project for dev and preview. |
| **Wildcard redirect URL in Supabase Auth** | Vercel preview deployments get unique URLs, and Auth rejects sign-in from any domain not on the allowlist, so previews break without it. |
| **Keepalive if the project goes quiet** | Supabase pauses a free project after roughly 7 days of inactivity, and a paused database cannot run its own cron to wake itself. Daily use makes this moot; a trivial GitHub Actions ping covers a quiet week. |
| **Telegram webhook points at Supabase** | The `telegram-hook` function URL, not the Vercel domain — the bot talks to the backend directly. |

### Deployment shape

```
Vercel (static, global CDN)          Supabase (Singapore)
├─ Vite SPA build                    ├─ Postgres + RLS + Realtime
└─ PWA manifest + service worker     ├─ Auth (Google)
                                     ├─ Vault (every secret)
                                     ├─ pg_cron + pg_net  → scheduled invocations
                                     └─ Edge Functions
                                         calendar-sync · notion-backup · ai-fill
                                         inbox-scan · notify-run · notify-digest
                                         telegram-hook
```

`pg_cron` runs in UTC only, so every schedule is stored in UTC and converted for display
against your timezone — relevant for the morning digest and quiet hours, which are expressed in
local time. It also does not retry a failed invocation, so each scheduled function records its
own run outcome and the next tick picks up anything missed.
