# Phase 2b — visual and interaction spec (ui-ux-designer)

> Written 2026-10-29 by the engineering director's ui-ux-designer. Saved verbatim
> from its report as a checkpoint; nothing in it has been implemented yet. Where
> it conflicts with the other spec, `docs/continue-here.md` records the ruling.
> Scratch-build paths it mentions were temporary and no longer exist.

# Mercury phase 2b: visual and interaction spec

I could not render anything, and the Skill tool wasn't available, so I did the confidence-check by hand. Everything below comes from reading the tokens, base.css, the plan and the code, and none of it has been looked at in a browser. Contrast ratios are hand-computed to about ±0.05, so please re-verify them with a script. I posted the board entry, including a Playwright request, in `C:\Mercury\TEAM-BOARD.md`. The Edit tool wasn't available, so I appended it by rewriting the file. The director's entry is preserved verbatim.

Conventions used throughout:
- **Numbers.** Every number-bearing element gets `.num`, with one exception. `.num` sets `font-family: var(--f-mono)`, which is the body face. For Cormorant figures (focus-bar countdown, group counts in `h3`) use `font-family: var(--f-display); font-variant-numeric: lining-nums tabular-nums; font-feature-settings:'lnum' 1` explicitly, not `.num`.
- **Touch targets.** `@media (pointer:coarse){ .btn{min-height:44px} .chip{min-height:40px} .input,.select{min-height:44px} }`. Today `.chip` is about 31px tall and `.btn` 36px.
- **Form controls.** Use `font-size:16px` on phones to stop iOS zoom.
- **Breakpoint.** 720px. At `min-width:720px` there are top tabs. Below that there is a fixed bottom nav.
- **Stacking order.** Bottom nav 20, focus bar 25, toast 70, scrim 50, sheet 51, confirm dialog 60.
- **Viewport meta.** `index.html` already has `viewport-fit=cover`, so `env()` insets work.
- **Reduced motion.** Under `prefers-reduced-motion: reduce`, turn off all transitions and animations.

## 1. App shell

`.app` stays as it is (max 1080px, 20px inline padding).

**Header** (`header.shell-head`)
- **Desktop:** one row, `display:flex; align-items:center; gap:16px; padding-block:18px 10px`.
  - Items in order: `.brand`, then `.sync` (`flex:1; min-width:0`), then `.search` (`width:280px`), then the Sign out `.btn.ghost`.
- **Phone:** `flex-wrap:wrap`.
  - Row 1: brand, spacer, Sign out.
  - Row 2: search, `flex:1 1 100%; order:3`.
  - Row 3: `.sync`, `flex:1 1 100%; order:4`.
- **`.sync` slot:** 12.5px, `--muted`, one line, `text-overflow:ellipsis`.
  - Example text: "Google Calendar live · 14:32".
  - Pair a 6px dot with the text, `--ok` when live, `--soon` for a snapshot, `--over` for "Not saving". The state is always in the words as well.
  - Wrap it in `role="status"` with `aria-live="polite"`.
  - Put a "Refresh" `.btn.ghost` after it (36px, 44 on touch), placed in the sync slot.
  - Until phase 3 the sync text is only the save state ("Saved", "Saving…", "Not saving"); no calendar text.
- **Theme control:** do not put it in the header. Render it in `footer.shell-foot` at the end of the page.
  - Footer styling: `border-top:1px solid var(--rule); margin-top:32px; padding-top:16px`. An `.eyebrow` "Appearance" label, `ThemeControl`, and the existing "Saved on this device only." line.
  - Settings replaces it in phase 3.

**Desktop tab bar** (`nav.tabs[aria-label="Views"]`, shown at ≥720px)
- `display:flex; gap:28px; border-bottom:1px solid var(--rule)`.
- Each tab is a `<button class="tab">` with `aria-current="page"` on the active one.
  - I deliberately do not use `role=tab`, because these switch views and have no tabpanel association.
  - Wrap the view in `<main id="view" tabindex="-1">` and move focus to its `h2` on switch.
- Tab style: `background:none; border:0; padding:12px 0; min-height:44px; font:500 15px var(--f-body); color:var(--muted); border-bottom:2px solid transparent; margin-bottom:-1px`.
- Hover: `color:var(--ink)`.
- Active: `color:var(--ink); font-weight:600; border-bottom-color:var(--accent)`. That is an accent underline with no fill.
- The active tab is persisted in localStorage.

**Phone bottom nav** (same `nav`, below 720px)
- `position:fixed; inset:auto 0 0 0; z-index:20; background:var(--bg); border-top:1px solid var(--rule)`.
- `display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); padding-bottom:env(safe-area-inset-bottom)`.
- Buttons: `min-height:56px`, `font:500 13px`, `--muted`, text only (there is no icon set).
- Active: `color:var(--ink); font-weight:600; box-shadow:inset 0 2px 0 var(--accent)`.
- Define `--nav-h:56px` on phones and `0px` on desktop.
- **Content clearance:** `.app{ padding-bottom: calc(var(--nav-h) + var(--focus-h,0px) + 16px) }`.
  - Do not add the safe-area inset to this. `body` already pads it.
  - Set `--focus-h:56px` on `.app` while a timer runs, phone only.

## 2. Placeholder views (Dashboard, Calendar, Insights)

Use a `section.panel` with the real shell around it.
- An `.eyebrow` reading "Coming in phase 3" (Calendar and Dashboard) or "Coming in phase 5" (Insights).
- `h2` with the view name.
- `.lede` with one honest sentence of what will live there. For example: "Dashboard: what to start now, what's due soon, and how much free time you have."
- A `.muted` line: "Your tasks are already available."
- A `.btn` "Go to Tasks".
- No skeletons or fake numbers. Please confirm the phase numbers against §4 of the plan; I only inferred them from your brief.

## 3. Tasks toolbar

**View heading row.** This is a flex row, baseline-aligned.
- `h2` "Tasks".
- A `.muted .num` count "12 open".
- A spacer.
- `New task` as `.btn.primary`. It stays on the same row at 390px.

**Toolbar** (`.toolbar`)
- `border-bottom:1px solid var(--rule); padding:12px 0; display:grid; gap:10px`.
- Each row is `.tool-row`: `display:grid; grid-template-columns:56px minmax(0,1fr); column-gap:12px; align-items:start`.
  - Its label is an `.eyebrow` with `padding-top:8px`. Use `--muted` (see §12).
  - The control area is `.chips`, which wraps, so there is no horizontal scroll at 390px. The chips area is about 282px wide there.

| Row | Control | Notes |
|---|---|---|
| Category | Chips: "All" plus one per category | Colour dot: `<i class="dot">`, 8px circle, `background:<category colour>`. Dots are the only filled shape allowed. Single-select, with `aria-pressed` on the chips like `ThemeControl`. |
| Status | Chips: Open, Not started, In progress, Completed, All | Default is Open. Wraps to two lines at 390px. |
| Sort | Native `<select class="select">` (Due, Priority, Planned start, Newest) | Native arrow kept for iOS reliability. Style it: `border:1px solid var(--rule); background:var(--surface); border-radius:var(--r); padding:7px 12px; min-height:36px`. |

- **Desktop:** at ≥720px, Status and Sort share one row. Sort is pushed right with `margin-left:auto`.
- The chips pressed state is the existing ink fill. All single-selects reuse it.

## 4. Group headers

- Each group is a `section.panel` (ink top rule) with `margin-top:24px`.
- Its header is `h3.group-head` with `display:flex; align-items:baseline; gap:10px`.
  - The text is Cormorant 600 20px.
  - The count is a `span.num` at 13px, 500, `--muted`.
- The Overdue title is `--over`; every other title is `--ink`.
- Order: Overdue, Today, Next 7 days, Later, No due date, Completed.
- Empty groups are omitted.
- Completed is not collapsible.
- Empty list (no tasks at all): `.lede` "Nothing here yet" plus a "New task" button.
- Empty list under filters: "No tasks match these filters" plus a ghost "Clear filters" button.

## 5. Task row

**Markup.** `ul.rows` > `li.row`.

**Container**
- Grid: `display:grid; grid-template-columns:40px minmax(0,1fr) 40px; column-gap:8px`.
  - Both outer columns are fixed at 40px, so the timer going idle to running never shifts anything (KB-0044, KB-0048).
- `padding:12px 8px; margin-inline:-8px; border-bottom:1px solid var(--rule)`.
- Hover: `background:color-mix(in srgb,var(--sunken) 55%,transparent)`.

**Column 1: completion toggle**
- `button.row-check`, `role="checkbox"`, `aria-checked`, `aria-label="Mark {title} done"`.
- The hit area is 40x40. It holds a 20px circle with a 1.5px `--muted` border and no fill.
- Hover: border `--ink`.
- Checked: border `--ok` and a 2px `--ok` check-mark stroke, still unfilled.

**Column 2: body**
- Line 1, `.row-top`: `display:flex; flex-wrap:wrap; align-items:baseline; gap:2px 10px`.
  - `.prio`: `flex:none; font:600 11px/1 var(--f-body); letter-spacing:.12em; text-transform:uppercase`.
    - High is `--over`, Med is `--soon`, Low is `--muted`. Low is `--muted` rather than `--ok` because green reads as "good".
    - Pinned: a 4px diamond after the word (`::after` with `background:currentColor`, rotated 45°, margin-left 5px), plus `<span class="sr-only">, set by you</span>` and `title="Priority set by you"`.
  - `button.row-title`:
    - Resets: `background:none; border:0; text-align:left; padding:0`.
    - Type: `font:600 15.5px/1.3 var(--f-body)`.
    - **KB-0047:** `flex:1 1 14ch; min-width:0; max-width:max-content`, `overflow-wrap:anywhere`, clamped to 2 lines (`display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden`).
    - It is the only shrinkable item. When the title's 14ch floor can't sit beside the chips, they wrap down; the title never collapses to "…".
    - A click opens the editor. The title button is the one tab stop, and clicking elsewhere on the row also works for mouse users.
  - `.row-when`: `display:flex; gap:6px; flex:none`. At ≥720px add `margin-left:auto` so the chips right-align.
    - Each `.when` chip is `font:500 12px/1.4; padding:1px 6px; border:1px solid var(--rule); border-radius:var(--r); color:var(--muted); white-space:nowrap`, with `.num`.
    - Text: "Start in 3h", "Due 2d 4h".
    - Due within 24h: `--soon` text and border.
    - Overdue "2d overdue": `--over` text, `border-color:var(--over)`, `background:var(--over-weak)`. This is a faint tint only.
    - Start due or passed on an unbegun task: `--soon` text and `--soon-weak` background.
    - Hide the Start chip once the task is begun.
- Line 2, `.row-meta`: `display:flex; flex-wrap:wrap; gap:2px 12px; margin-top:4px; font-size:12.5px; color:var(--muted)`. Every item is `flex:none` and `.num` where numeric. The items are:
  - The category dot plus name.
  - "1h 10m / 3h" for logged of estimate.
  - "Target Thu 14:00".
  - "40%".
  - When the timer runs, "Running 0:42:10" in `--accent`, 600, ticking each second.
- Line 3: progress bar.
  - Shown only when progress > 0.
  - `height:3px; margin-top:8px; background:var(--rule); border-radius:var(--r)`, with an `--accent` fill.
  - It is `aria-hidden="true"`; the percentage in line 2 carries the meaning.
- Line 4, `.row-why`: `margin-top:6px; font-size:12.5px/1.4`.
  - Starts with a bold 11px uppercase label ("Overdue", "Start now", "At risk"), then the sentence.
  - Colour by kind: over is `--over`, risk is `--over`, start is `--soon`.
  - Red means something will be missed. Amber means act now to avoid it. The label carries the kind, so colour is never the only signal.

**Column 3: timer**
- `button.row-timer`: 40x40 (44 on touch). Outline: `1px solid var(--rule)`, `border-radius:50%`.
- Idle: a 10px play triangle in `--muted` (CSS border triangle), with `aria-label="Start timer for {title}"`.
- Hover: border and glyph go to `--ink`.
- Running: border and a 9px stop square go to `--accent`, with `aria-label="Stop timer for {title}"`.
- Elapsed lives in the meta line, not in the button. That keeps the column fixed-width. Do not announce ticks; the elapsed text has no live region.

**Completed rows**
- Title is `--muted` with `text-decoration:line-through` (decoration colour `--faint`).
- Do not reduce opacity.
- Hide the priority mark, the When chips, the reason and the timer.
- The meta line keeps the category, the "logged / estimate" and "Done Thu 23 Oct".

**Narrow layout (390px).** The text column is about 250px.
- Line 1 usually breaks as: priority + title, then chips on the next line.
- A short title keeps its chips beside it.
- There is no horizontal scroll.

## 6. Search

**Field**
- `.search` wraps an `input[type=search]`.
- Height 36px (44 on touch); `border:1px solid var(--rule)`; `background:var(--surface)`; `border-radius:var(--r)`; `padding:0 36px 0 12px`; 16px font on phones.
- Placeholder: "Search tasks", in `--muted`.
- A `<kbd>` "/" hint is positioned absolutely at the right: 11px, `border:1px solid var(--rule)`, `padding:0 5px`, `--muted`.
  - It is hidden on focus, when the field has text, and under `@media (hover:none)`.
- A clear "×" button (44px hit area, `aria-label="Clear search"`) appears when the field has text.
- Add `aria-keyshortcuts="/ Control+K Meta+K"`.

**Behaviour**
- `/` and Ctrl/Cmd-K focus the field. Ignore `/` while typing in a field.
- Esc clears, blurs, and restores the previous filters, which were kept in state.
- If the user is on another tab, switch to Tasks.
- Open tasks match instantly. The archive query is debounced 250ms.

**Results mode** (non-empty query)
- The toolbar and the groups are replaced by one `section.panel`.
- Its header is `h3` "Results" plus a count (like a group header).
- Scope toggle: `.chips` "Open only" / "Everything", `aria-pressed`. It sits right of the heading and wraps below it at 390px.
- Rows are the same `.row`.
- Matched text is wrapped in `<mark>` styled `background:none; color:inherit; font-weight:700; text-decoration:underline; text-decoration-color:var(--accent); text-underline-offset:3px`.
  - It is not highlighter yellow.
- Archived hits get an "Archived" item in the meta line, in `--muted`.
- While the server query is pending, show a `.muted` "Searching archive…" line with `aria-live=polite`.
- If the server query fails, show a `.banner`: "Archive search is unavailable. Showing open tasks."
- Add a visually hidden `role=status` announcing "7 results".
- **Empty state:** `h3` `No tasks match "xyz"`.
  - Scope "open only": `.muted` "Only open tasks were searched." plus a ghost "Search everything" button.
  - Scope "everything": "Check the spelling or try fewer words."

## 7. Task editor sheet

**Scrim and sheet**
- `.sheet-scrim`: `position:fixed; inset:0; background:var(--scrim); z-index:50; display:flex; justify-content:center`.
  - Desktop: `align-items:center`.
  - Phone: `align-items:flex-end`.
  - A backdrop click closes it, but only when both mousedown and click land on the scrim.
- `.sheet`: `role="dialog" aria-modal="true" aria-labelledby=<h2 id>`.
  - It is itself the scroll container: `overflow-y:auto; overscroll-behavior:contain`.
  - `background:var(--surface); border:1px solid var(--rule); border-radius:var(--r); box-shadow:var(--shadow)`.
  - `--pad-x:24px; --pad-top:20px; --pad-bottom:16px; padding:var(--pad-top) var(--pad-x) var(--pad-bottom)`.
  - **Desktop:** `width:calc(100% - 48px); max-width:720px; max-height:min(88dvh,880px)`.
  - **Phone:** `width:100%; max-height:calc(100dvh - 24px); --pad-x:16px`.
- Opening: translate 12px and fade over 180ms (phone slides up from the bottom over 240ms).
- Lock page scroll, make the app `inert`, trap focus, and return focus to the opener on close.
- Initial focus: the title field.
- Esc: disarm Delete first if it's armed, otherwise close.

**Sticky header** (KB-0046)
- `.sheet-head`: `position:sticky; top:calc(-1 * var(--pad-top)); margin:calc(-1 * var(--pad-top)) calc(-1 * var(--pad-x)) 0; padding:var(--pad-top) var(--pad-x) 12px; background:var(--surface); border-bottom:1px solid var(--rule); z-index:2; display:flex; align-items:flex-start; gap:12px`.
- **Phone grab handle:** a 36x4px `--faint` bar, `border-radius:var(--r)`, centred above the title, `aria-hidden`. It is decorative; dragging to dismiss is optional and not required.
- Contents: an `.eyebrow` "Edit task" or "New task", and an `h2` with the task title (1 line, ellipsis is fine here because the field holds the full text). A close button (`.btn.ghost`, 40x40, ×, `aria-label="Close"`) sits at the right.

**Sticky footer**
- `.sheet-foot`: `position:sticky; bottom:calc(-1 * var(--pad-bottom)); margin:16px calc(-1 * var(--pad-x)) calc(-1 * var(--pad-bottom)); padding:12px var(--pad-x) calc(12px + env(safe-area-inset-bottom)); background:var(--surface); border-top:1px solid var(--rule); z-index:2`.
- DOM order: Mark done, Delete, Cancel, Save.
- **Desktop:** flex row. Mark done and Delete are left, a spacer follows, then Cancel (`.btn.ghost`) and Save (`.btn.primary`) are right.
- **Phone:** `display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px` in a 2x2 reading order (Mark done, Delete / Cancel, Save), so visual order equals tab order. All buttons are 44px tall.
- Mark done becomes "Reopen" when the task is already done.
- Save is not disabled for an invalid title. On click it focuses the title field and shows an inline error (`aria-invalid`, `aria-describedby`). It shows "Saving…" and is disabled only while the write is in flight.

**Fields**
- **Grid:** `.fields{display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px 20px}` at ≥720px, and one column below that.
- Full-width cells (`.span-2`): title, notes, progress, status, priority block, sanity warnings, facts.
- Labels: 11px eyebrow style but in `--muted`.
- `.input`: `min-height:40px; border:1px solid var(--rule); background:var(--bg); border-radius:var(--r); padding:8px 10px`.
  - Focus: `border-color:var(--accent)` plus the base outline.
- Date + time pairs: `display:grid; grid-template-columns:minmax(0,1fr) minmax(0,110px); gap:8px`.
- Order:
  1. Title (span 2)
  2. Category | Estimate (text, e.g. "2h 30m", with a `.muted` hint)
  3. Planned start (date + time) | Target finish (date + time)
  4. Due (date + time) | Logged (text)
  5. Notes (span 2, textarea, `min-height:96px`, vertical resize)
  6. Progress
  7. Status
  8. Started | Completed (shown only when relevant)
  9. Priority block
  10. Sanity warnings
  11. Facts strip
- **Progress:** an `input[type=range] min=0 max=100 step=5` with `aria-valuetext="40 percent"`.
  - Value shown as a `.num` "40%" beside the label.
  - Track: 3px `--rule` with the filled portion in `--accent` (use a `--pct` custom property in a linear-gradient).
  - Thumb: 20px circle, `--surface` with a 2px `--accent` border, with a 44px touch area via padding.
- **Status:** `.chips.seg` with Not started / In progress / Done.
  - `.seg` is a joined variant of `.chip`: `gap:0`, `.chip+.chip{margin-left:-1px}`, only the outer corners rounded.
  - The pressed state is the existing ink fill.
  - Status and progress bind both ways: dragging to 100% sets Done, and above 0% sets In progress.
- **Priority block:**
  - Live preview: the level word in Cormorant 600 22px in its status colour, then a 13px `--muted` reason sentence. For example: "Needs 4h, only 2h 10m left before it's due".
  - `.chips.seg` with four options: "Auto" (its label includes the computed level as small coloured text, e.g. "Auto · High"), High, Med, Low.
  - While pinned, the preview shows the pinned diamond and "Set by you", plus a line "Auto would say Medium. {reason}" and a ghost button "Back to Auto".
- **Sanity checker:** `div.sanity[aria-live=polite]`, one `.banner` per warning.
  - `display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center`.
  - Message `flex:1 1 220px`, then the repair button (`.btn`, 36px, 44 on touch, e.g. "End at 16:45", "Log 2h 15m").
  - The warning types come from the plan: logged time exceeds elapsed, completed before started, and future dates.
  - The error variant `.banner.over` is `background:var(--over-weak); color:var(--over)`.
- **Facts strip:** `dl.facts`.
  - `display:flex; flex-wrap:wrap; gap:4px 20px; border-top:1px solid var(--rule); padding-top:12px`.
  - Each `dt` is an 11px `--muted` label and each `dd` is a 13px `.num`.
  - Items: Created, Updated, Estimate source, Elapsed, Remaining.

## 8. Delete flow

1. **Arm.** The footer Delete button reads "Delete…". It is `.btn` with `--over` text. It has `min-width:9.5em` so "Confirm delete" fits without any size change (KB-0044).
   - The armed state: text "Confirm delete", `border-color:var(--over)`, `background:var(--over-weak)`.
   - It disarms after 4s, on blur, or on Esc.
   - A visually hidden `role=status` announces "Press again to confirm delete".
2. **Confirm.** The second tap opens the in-app dialog (KB-0021).
   - `role="alertdialog"` with a scrim, z-index 60, centred on desktop and phone, `max-width:400px; width:calc(100% - 32px); padding:24px`.
   - `h2` "Delete this task?".
   - Body: "“{title}” will be moved to Trash and kept for 30 days. You can undo straight afterwards."
   - Buttons: Cancel (`.btn.ghost`, initial focus) and "Delete task" (`.btn`, `--over` text and border, never filled). They sit side by side on phones in a `minmax(0,1fr)` grid.
   - Esc closes the dialog only.
   - Do not promise a Trash screen in the copy before Settings has one.
3. **Undo.** On confirm, the dialog and the sheet close, and an Undo toast appears: "Deleted “{title}” · Undo".

## 9. Toast

- Region: `div.toast-region[role=status][aria-live=polite]`, `position:fixed; z-index:70`.
  - **Desktop:** bottom-centred, `bottom:calc(16px + env(safe-area-inset-bottom))`.
  - **Phone:** `left:16px; right:16px; bottom:calc(var(--nav-h) + var(--focus-h,0px) + env(safe-area-inset-bottom) + 12px)`, so it clears the nav and focus bar.
- Toast: `background:var(--ink); color:var(--bg); border-radius:var(--r); box-shadow:var(--shadow); padding:12px 16px; min-height:48px; max-width:420px; display:flex; gap:16px; align-items:center`.
  - This matches the existing `.btn.primary` inversion. It is the only solid ink surface and is transient.
- The message is 14px. Undo is a `button` styled `color:var(--bg); font-weight:600; text-decoration:underline`, with a 44px hit area.
- **Lifetime:** undo toasts last 6s. Plain info toasts last 4s. Errors are `role=alert` with a Dismiss button and do not auto-dismiss.
  - Hovering or focusing a toast pauses its timer.
- **Stacking:** maximum 3 visible, 8px gap, newest at the bottom. Older ones are dropped, oldest first.
- Undo also covers completing a task and clearing a timer (§2.4).

## 10. Focus bar

Shown only while a timer runs.
- `.focusbar`: `background:var(--bg); border-top:1px solid var(--ink)`.
- **Desktop:** `position:sticky; top:0; z-index:25`, between the tab bar and the content, with `border-bottom:1px solid var(--rule)`.
- **Phone:** `position:fixed; left:0; right:0; bottom:calc(var(--nav-h) + env(safe-area-inset-bottom)); z-index:25; min-height:var(--focus-h)`. Set `--focus-h:56px`.
- **Content** (grid `minmax(0,1fr) auto auto`, gap 12, `padding:8px 20px`, centre-aligned):
  - Title: `button`, 14px/600, `--ink`, one line, ellipsis (a label, fine to truncate), `title` attribute set. A click opens the editor.
  - Countdown: Cormorant 600 24px with the explicit lining/tabular settings, `min-width:7.5ch`.
    - "1:48:10" plus a 12px `--muted` suffix "left" (remaining estimate).
    - With no estimate, it counts up with the suffix "elapsed".
    - Past the estimate: "+0:12:30" in `--over` with the suffix "over". Use the sign as well as colour.
  - Stop: `.btn` with a stop square and "Stop", 44px tall.
- **Progress bar:** 3px along the bottom edge. Track `--rule`, fill `--accent`, switching to `--over` when past the estimate.
  - It is `aria-hidden`; the countdown text carries the meaning.
- The countdown has `role="timer"` and `aria-live="off"`. Announce "Over estimate" once, in a `role=status`.

## 11. "How long did it take?" prompt

Shown after completing a task with no logged time.
- A non-modal prompt in the toast region, stacked above the undo toast.
- It is not the ink toast: `background:var(--surface); border:1px solid var(--rule); border-top:2px solid var(--ink); box-shadow:var(--shadow); padding:12px 16px; max-width:420px`, because the pressed-chip ink fill would be invisible on an ink toast.
- Content: a 14px question, "How long did “{title}” take?" (1 line, truncated).
- Chips (40px): "As estimated (3h)" if an estimate exists, then 15m, 30m, 1h, 2h, 3h, "Other…", wrapping at 390px.
  - "Other…" swaps the chips for a small text input ("1h 20m") and a Log button. Enter submits and Esc skips.
- A ghost "Skip" button, right-aligned.
- Lifetime 20s, with hover and focus pausing. If completion was triggered by the keyboard, move focus to the first chip, and restore it on dismiss.

## 12. Accessibility

**Contrast**

Hand-computed, WCAG 2.x, text vs ground:

| Colour | Light on --bg | Light on --surface | Dark on --bg | Dark on --surface |
|---|---|---|---|---|
| --over | 5.50 | 6.02 | 7.42 | 6.92 |
| --soon | 4.76 | 5.21 | 9.65 | 8.99 |
| --ok | 5.86 | 6.41 | 9.41 | 8.77 |
| --doing | 5.04 | 5.51 | 8.79 | 8.20 |
| --muted | 5.68 | 6.21 | 8.10 | 7.55 |
| --accent | 8.63 | n/a | 9.14 | n/a |
| --faint | **2.49 FAIL** | **2.72 FAIL** | **3.91 FAIL** | **3.65 FAIL** |

- Status colours and `--muted` pass 4.5:1 for small text in both themes. The lowest is `--soon` in light at 4.76.
- Text on tints:
  - `--soon` on `--soon-weak` in light is 4.59, which passes narrowly. Keep the banner at 13px or above.
  - `--over` on `--over-weak` is 5.06 in light and 6.29 in dark.
- `--faint` fails 4.5:1 in both themes. It is acceptable only for decorative or non-informational uses: the grab handle, strike-through decoration, disabled text, the unchecked-toggle ring if `--muted` is not used, and large text.
  - In dark it passes the 3:1 bar for UI components and large text.
  - **Defect:** `.eyebrow` is 11px `--faint` in base.css, so it fails everywhere. My fix: set `.eyebrow` to `--muted`. For the toolbar and form labels I specify `--muted` locally regardless.
- **Placeholders** use `--muted`.

**Other**
- Nav is `<nav aria-label="Views">` with `aria-current="page"`.
- Toggles are `role="checkbox"` with `aria-checked`; chip groups have `role="group"` with a label and use `aria-pressed`.
- Progress is `aria-hidden` with the percentage in text; the slider uses `aria-valuetext`.
- Colour is never the only signal: the priority word, the reason label, the "overdue" word, and the "+" sign on the focus bar.
- Form controls are 16px on phones. Touch targets are at least 40px (44 for primary actions).
- Focus is visible everywhere via base.css `:focus-visible` (2px `--accent` outline, 2px offset). The row title button has an outline too.
- All overlays trap focus, close on Esc, and return focus to the opener.

## Open questions for you

1. Phase numbers for the placeholders: I used Dashboard and Calendar as phase 3 and Insights as phase 5. Please confirm.
2. May I change `.eyebrow` in base.css to `--muted`? base.css is settled, so I haven't touched it. The alternative is darkening `--faint` to about #6a6e75 (4.69:1 on `--bg` in light), which would erase its hierarchy against `--muted`.
3. Dirty-sheet close: should Esc, Cancel or the backdrop with unsaved changes ask "Discard changes?" (in-app, per KB-0021), or discard silently? I did not specify a prompt.
4. Completed group: always expanded, or collapsed by default under "All"? I specified always expanded.
5. Low priority colour: I chose `--muted`. Say if you want `--ok` or `--doing`.
6. Bottom nav is text-only, because the repo has no icon set. Do you want to introduce icons?
7. The ink-inverted toast is the one solid block in the system. I think it is justified as transient, but flag it if you disagree.

Files: `C:\Mercury\TEAM-BOARD.md` is the only file I changed.
