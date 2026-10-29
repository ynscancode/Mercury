# Phase 2b — architecture spec (tech-lead)

> Written 2026-10-29 by the engineering director's tech-lead. Saved verbatim
> from its report as a checkpoint; nothing in it has been implemented yet. Where
> it conflicts with the other spec, `docs/continue-here.md` records the ruling.
> Scratch-build paths it mentions were temporary and no longer exist.

The phase 2b spec is complete below; one board entry is appended (`tech-lead-20261029T082930`) and nothing is committed. I ran two build checks in the scratchpad against the repo's Vite 8.3.5 / Rolldown. The demo gate is dropped from the production build while the control build keeps it (§5), and a build plugin can write `sw.js` with the hashed asset list (§10). Two things I could not verify are listed in the confidence check at the end.

**Decisions you need to know:**
- **Sync is deferred as one block:** realtime, the offline banner, retrying failed writes and any auto-refresh go together into a follow-up batch (Q1).
- **Designer override:** the editor sheet uses a flex column (head / body / foot, only the body scrolls), not the designer's sticky header and footer. It looks the same and KB-0046 cannot occur.
- **Editor is edits-over-live with an explicit Save,** not live patching, because the database constraints reject half-finished states.
- **Two new store fields** on undo entries (`id`, `kind`) and an optional undo argument on `patchTask` (§12).
- **PWA:** hand-written service worker, no vite-plugin-pwa.
- **Tests:** no jsdom; pure helpers plus Playwright.

---

# Phase 2b architecture spec (Mercury views)

Baseline is unchanged. Existing facts this spec relies on: `setTasks` already protects tasks whose write is in flight, `patchTask` is `(id, patch)`, and the `react-hooks/purity`, `set-state-in-effect` and `refs` lint rules are on. That means no `Date.now()` and no `ref.current` reads during render, and no synchronous setState in an effect body.

## 1. Routing
- **Hand-rolled router, no dependency.** The only routes are `/`, `/task/:id` and `/task/new`; a router library (wouter is about 2 kB, react-router is far more) buys nothing at that size.
- **The tab is not in the URL.** It is stored in localStorage under `mercury.tab`, using the same try/catch pattern as `theme.ts`. Default is `'tasks'` because Dashboard is a placeholder until phase 3 (Q2).
- `src/app/router.ts`:
  ```ts
  export type Route = { kind: 'home' } | { kind: 'task'; id: string } | { kind: 'new' };
  export function parseLocation(pathname: string, hash: string): Route;
  export function routePath(r: Route): string; // '/', '/task/<encodeURIComponent(id)>', '/task/new'
  ```
  - `hash === '#add'` on any path gives `new`.
  - `/task/new` gives `new`.
  - `/task/<seg>` (trailing slash allowed, segment decoded) gives `task`.
  - Anything else gives `home`.
  - Never rewrite the URL for other hashes: Supabase's implicit OAuth flow returns `#access_token=…`.
- `src/app/useRoute.ts`:
  - `useRoute(): Route` uses `useSyncExternalStore` over `popstate`, `hashchange` and a custom `mercury:navigate` event.
  - `navigate(r, {replace?})` pushes `history.state = { mercury: true }` (or replaces).
  - `closeTaskRoute()` calls `history.back()` if `history.state?.mercury`, otherwise `replaceState('/')`. This stops Back from reopening a sheet that came from a deep link.
- **`#add` now:** at boot, an exact `#add` becomes `replaceState('/task/new')`, which opens the new-task editor. Phase 8 changes this to focus the capture bar.
- **`vercel.json` is needed** (devops owns it):
  ```json
  { "rewrites": [{ "source": "/task/:id", "destination": "/index.html" }],
    "headers": [
      { "source": "/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
      { "source": "/assets/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] } ] }
  ```
  The rewrite is deliberately narrow. A catch-all would answer a stale `/assets/x.js` with HTML (status 200), which is a confusing failure after a deploy. The Vite dev server and `vite preview` already fall back to index.html.

## 2. Store binding
- `src/app/StoreProvider.tsx`:
  - `StoreContext = createContext<AppStore | null>(null)`
  - `useAppStore<T>(sel: (s: AppState & AppActions) => T): T` returns `useStore(api, sel)` from `'zustand'`
  - `useAppStoreApi(): AppStore` is for `getState()` inside event handlers.
- **One store per signed-in user,** created with `useState(() => createAppStore(backend.persistence))` inside `<Workspace key={userId}>`. A different user remounts it; signing out unmounts it.
- **Selector rules** (code reviewers enforce these):
  1. A selector returns a primitive or an existing reference only: `s.tasks`, `s.settings`, `s.categories`, `s.undoStack`, `s.tasks[id]`, `s.error`, or an action.
  2. Never return a new object or array from a selector. Zustand 5 then re-renders forever ("getSnapshot should be cached"). Derive with `useMemo`; `useShallow` from `zustand/react/shallow` is a last resort.
  3. `useEngineContext(): EngineContext` is a `useMemo` over three separate selectors (settings, events, accounts).
  4. `TaskRow` is `React.memo` with props `{ task, ctx, now, category }`, which are all stable references. It computes its own row model with `useMemo`.
  5. Only the timer leaf components subscribe to the 1 s clock (§3).
- `src/app/selectors.ts`: `export function selectRunningId(s: AppState): string | null` returns a primitive, so it is cheap to subscribe to.

## 3. Clock
- `src/app/clock.ts` (node-testable, no DOM access at import time):
  ```ts
  export interface ClockChannel { subscribe(cb: () => void): () => void; get(): Instant }
  export interface Clock { now(): Instant; slow: ClockChannel; fast: ClockChannel; bump(): void }
  export function createClock(o?: { read?: () => Instant; slowMs?: number; fastMs?: number;
    doc?: { visibilityState: string; addEventListener(t: 'visibilitychange', f: () => void): void; removeEventListener(t: 'visibilitychange', f: () => void): void } }): Clock;
  export const appClock: Clock; // createClock({ doc: globalThis.document })
  ```
  - Each channel's interval runs only while it has at least one subscriber. `get()` returns the value cached at the last tick; it is set to `read()` on first subscribe.
  - The fast channel ticks every 1000 ms. It runs only while a timer runs, because only the timer UI subscribes to it.
  - The slow channel ticks every 300 000 ms. It also refreshes when the page becomes visible again and on `bump()`.
  - **Workspace calls `store.subscribe(() => appClock.bump())`.** After any action the slow `now` is at least as new as any instant just written. Without this, a just-completed task would look "completed in the future" to the sanity checker for up to 5 minutes.
- `src/app/useNow.ts`:
  - `useSlowNow(): Instant` (for rows, grouping, the editor, the priority preview)
  - `useTickNow(): Instant` (only for `FocusBar` and `RunningChip`)
  - Both use `useSyncExternalStore`.
- **Event handlers read `appClock.now()`.** Render never reads the clock directly, and domain functions keep taking `now` as an argument.

## 4. Data loading (signed-in path)
- `src/data/load.ts`:
  ```ts
  export interface InitialData { tasks: Task[]; categories: Category[]; settings: Settings }
  export async function loadInitial(client: SupabaseClient, userId: string): Promise<InitialData>;
  export function assembleInitial(rows: { tasks: TaskRow[]; categories: CategoryRow[]; settings: SettingsRow | null }): InitialData; // pure, tested
  export function loadErrorMessage(e: unknown, online: boolean): string;
  ```
  - **Tasks:** an explicit column list matching `TaskRow`, never `select('*')`, which would ship the `search_tsv` vector. Filter `.eq('user_id', userId).is('deleted_at', null)`, which matches the partial indexes. Order by `created_at` then `id`, and page with `.range()` in chunks of 1000 until a short page arrives, because PostgREST silently stops at 1000 rows. Archived rows are loaded; views filter `archivedAt`.
  - **Categories:** `.order('sort_order').order('name')`. The mapper drops `sort_order`, so the query order is the authority.
  - **Settings:** `.maybeSingle()`. No row gives `settingsFromRow(null)`, i.e. the defaults. A new user has no settings row (no trigger creates one), so that path must work.
  - The three queries run with `Promise.all`. `assembleInitial` also drops any row with `deleted_at` set, defensively.
- `src/app/backend.ts`:
  ```ts
  export interface Backend { persistence: Persistence; load(): Promise<InitialData> }
  export function createSupabaseBackend(client: SupabaseClient, userId: string): Backend;
  ```
  The `Persistence` port stays write-only, so the existing store tests are untouched.
- `src/app/Workspace.tsx`:
  ```ts
  export function Workspace(p: { backend: Backend; account: { email?: string }; demo?: boolean }): JSX.Element;
  ```
  - Load state is `'loading' | 'ready' | { error: string }`, kept in component state, not the store.
  - The effect calls `backend.load()`. In `.then` it calls `setTasks`, `setCategories`, `setSettings`, then marks ready.
  - Retry sets `loading` in the click handler and bumps an attempt counter that the effect depends on.
  - While loading or in error, render the existing `.gate` screen (with Retry). The shell renders only when ready, so deep links never race the load.
  - Offline launch reaches the gate with "You're offline…" and Retry. That is what "offline shell" means here.
- **Deferred (Q1):** realtime, the offline banner, failed-write retry, and any auto or manual refresh. Without retry, a refresh silently drops a failed local write. They form one design problem and should be one batch. Write errors keep surfacing through the existing `store.error` banner (dismiss calls `clearError`).

## 5. Dev-only demo path
- **Gate, used literally in `src/App.tsx` at module scope (KB-0018: only literal `import.meta.env.*` reads are inlined):**
  ```ts
  const DemoApp = import.meta.env.DEV && import.meta.env.MODE === 'demo' ? lazy(() => import('@/dev/DemoApp')) : null;
  ```
  - In `App()`, after `useSession()`: `if (DemoApp) return <Suspense fallback={<Loading/>}><DemoApp/></Suspense>;`, placed before the `ConfigNotice` check.
  - Demo mode ignores Supabase even when it is configured, so visual checks are deterministic.
  - Add the script `"dev:demo": "vite --mode demo"` (frontend owns `package.json`). This avoids env files (`.env.*` is gitignored) and works the same in PowerShell and bash.
- **Why it cannot ship:** a production build sets `DEV` to the literal `false` and the dead branch, including the dynamic import, is dropped. A `?demo` URL parameter was rejected because navigation drops it.
- **I verified this in a scratch build with the repo's Vite 8.3.5 / Rolldown:**
  - `vite build` has no demo chunk and the sentinel is absent.
  - `vite build --mode demo` is also clean (`DEV` is still false).
  - Positive control: `NODE_ENV=development vite build --mode demo` emits `demo-*.js` and grep finds the sentinel.
- **Reviewer check (KB-0015, run both):**
  ```
  npm run build && grep -rl "mercury-demo-seed" dist/ ; echo "exit $?"   # must print nothing, exit 1
  NODE_ENV=development npx vite build --mode demo --outDir "<scratch>/demo-ctrl" --emptyOutDir && grep -rl "mercury-demo-seed" "<scratch>/demo-ctrl"  # must match
  ```
- **Files** (never imported statically from outside `src/dev/`):
  - `src/dev/DemoApp.tsx` (default export) renders `<Workspace backend={{persistence: createMemoryPersistence(), load: async () => buildSeed(Date.now(), deviceTz)}} account={{email:'demo'}} demo/>`. `deviceTz` is `Intl.DateTimeFormat().resolvedOptions().timeZone`.
  - `demo` shows a "Demo data, nothing is saved" banner carrying `data-demo={DEMO_SENTINEL}` and hides Sign out.
  - `src/dev/memoryPersistence.ts`: `createMemoryPersistence(): Persistence`, whose methods resolve on a `setTimeout(0)`.
  - `src/dev/seed.ts`: `export const DEMO_SENTINEL = 'mercury-demo-seed'` and `export function buildSeed(now: Instant, tz: string): InitialData` (pure).
- **Seed contents:**
  - Settings: `{...DEFAULT_SETTINGS, timezone: tz}`.
  - Ids: fixed UUIDs `00000000-0000-4000-8000-0000000000NN`, so Playwright can deep-link.
  - `createdAt`: `now - k days`, staggered so the "newest" sort means something.
  - Dates come from `instantToDate(now, tz)` plus `addDays`. The "today" task uses `dueTime: null` (end of day) and the passed planned start uses yesterday, so nothing changes group with the time of day.
  - Categories: School, Work, Personal. Colours come from the designer's palette; any `#rrggbb` passes the DB check.

  | # | Title (shortened) | What it exercises |
  |---|---|---|
  | 1 | Lab report: titration write-up | overdue (due −1d 17:00), in progress (progress 30, actualStart −2d, logged 40), est 120 |
  | 2 | Reply to supervisor about the draft | today (end of day), est 20 |
  | 3 | Essay draft, section 2 | next 7 days (+3), in progress, est 240 / logged 60 / progress 25: the timer-with-estimate task |
  | 4 | Problem set 4 | +5, plannedStart yesterday, so the "start" attention signal fires |
  | 5 | "Prepare the slides, speaker notes and printed handout for Thursday's quarterly department review meeting" | long title (KB-0047), +2 09:00, est 360 |
  | 6 | Read chapters 6–8 | later (+20), est 180 |
  | 7 | Renew passport | later (+40), pinned High (auto would say Low) |
  | 8 | Sort out the photo library | no due date, no estimate |
  | 9 | Learn the new keyboard shortcuts | no due date, uncategorised, est 45 |
  | 10 | Return library books | +1, est 0, logged 0: completing it triggers the "How long?" prompt |
  | 11 | Book flights home | completed −1d, est 20 / logged 25 |
  | 12 | Submit lab safety form | completed late (due −3d, done −2d) |

  No timer runs at seed time.
- `seed.test.ts` asserts that all six groups are non-empty under the "all" filter at three fixed `now` values (00:30, 12:00, 23:30 local, two zones). It also asserts one pinned task, one title longer than 80 characters, and every category hex matching `^#[0-9A-Fa-f]{6}$`.

## 6. Pure view-logic modules
All of these are clock-free (they take `now`), have no React import, and are tested in vitest's node environment. They sit next to their feature in `src/views/*`, not in `src/domain`.

**Grouping: `src/views/tasks/grouping.ts`**
```ts
export type GroupKey = 'overdue' | 'today' | 'week' | 'later' | 'none' | 'done';
export const GROUP_ORDER: readonly GroupKey[];        // the order above
export const GROUP_LABEL: Record<GroupKey, string>;   // Overdue, Today, Next 7 days, Later, No due date, Completed
export function groupOf(t: Task, now: Instant, tz: string): GroupKey;
export function groupTasks(sorted: readonly Task[], now: Instant, tz: string): Array<{ key: GroupKey; tasks: Task[] }>;
```
Rules, in order:
1. `completedAt != null` gives `done`.
2. `due == null` gives `none`.
3. `dueAt(t, tz) < now` gives `overdue`. This is the same comparison `priority.ts` uses, so a task due today at 09:00 viewed at 14:00 is Overdue.
4. Otherwise `n = daysBetween(instantToDate(now, tz), t.due)`:
   - `n <= 0` gives `today`
   - `1..7` gives `week` (tomorrow through today+7)
   - `> 7` gives `later`

These are calendar-day comparisons, so they are correct across a DST change. `groupTasks` keeps input order and omits empty groups, except that `done` is always re-sorted by `completedAt` descending.

**Filters: `src/views/tasks/filters.ts`**
```ts
export type StatusFilter = 'open' | 'todo' | 'doing' | 'done' | 'all';
export interface TaskFilters { status: StatusFilter; categoryId: string | null } // null = all
export function matchesStatus(t: Task, f: StatusFilter): boolean;
export function matchesCategory(t: Task, categoryId: string | null): boolean;
export function visibleTasks(tasks: readonly Task[], f: TaskFilters): Task[];
```
- Every filter first requires `deletedAt == null && archivedAt == null`.
- `open` means `completedAt == null`; `todo`, `doing` and `done` compare against `status(t)`; `all` keeps everything.
- Default is `open`, with all categories. There is no "uncategorised" chip.

**Sort: `src/views/tasks/sort.ts`**
```ts
export type SortKey = 'due' | 'priority' | 'planned' | 'newest';
export function sortTasks(tasks: readonly Task[], key: SortKey, ctx: EngineContext, now: Instant): Task[];
```
Compute each task's key once (`effectivePriority` runs capacity maths), then sort. Ties always end with `title.localeCompare`, then `id`.

| Key | Primary | Ties |
|---|---|---|
| `due` (default) | `dueAt`, earliest first, no due date last | priority |
| `priority` | `RANK[effectivePriority.level]`, no level last | `dueAt`, nulls last |
| `planned` | `plannedStartAt`, nulls last | `dueAt`, nulls last |
| `newest` | `createdAt` newest first, missing last | — |

**Row model: `src/views/tasks/rowModel.ts`**
```ts
export function rowModel(t: Task, ctx: EngineContext, now: Instant, category: Category | null): RowModel;
```
- `RowModel` holds `status`, `priority: PriorityVerdict|null`, `attention: Attention|null`, `due: {at, countdown: dueCountdown(at,now), when: shortWhen(...), over}|null`, `start: {at, when, past}|null`, `target: string|null`, `category`, `logged: fmtDur(loggedMin(t,now))`, `est: fmtDur|null`, `progress`, `running`.
- Everything comes from domain functions, nothing is reimplemented.
- Category colour reaches CSS as `style={{'--cat': hex}}`.

**Search: `src/views/search/searchMode.ts`**
```ts
export type SearchScopeKey = 'open' | 'all';
export function toSearchScope(k: SearchScopeKey): SearchScope; // open → {}; all → { includeCompleted: true, includeArchived: true }
export function searchResults(tasks: readonly Task[], q: string, k: SearchScopeKey, cats: readonly Category[], tz: string): Task[]; // wraps searchTasks
```
- **No save/restore of filters is needed, by design.** Results replace the main area of whatever tab is active. They ignore the filters, and the filter bar is hidden while searching, so the filters are never changed.
- Escape (or picking a tab) clears the query and leaves the user exactly where they were, which is what plan §2.3 asks for.
- Server-side full-text search over the archive is deferred. Client-side search already covers archived rows because they are loaded.

**Shell state: `src/app/shellState.ts`** (a `useReducer` in `Shell`, no second store)
```ts
export interface ShellState { tab: Tab; filters: TaskFilters; sort: SortKey; query: string; scope: SearchScopeKey; durationPromptId: string | null }
export type ShellAction = { type: 'tab'; tab: Tab } | { type: 'filters'; filters: Partial<TaskFilters> } | { type: 'sort'; sort: SortKey }
  | { type: 'query'; query: string } | { type: 'scope'; scope: SearchScopeKey } | { type: 'search-exit' }
  | { type: 'prompt-duration'; id: string } | { type: 'prompt-dismiss' };
export function shellReducer(s: ShellState, a: ShellAction): ShellState;  // 'tab' also clears query
export function initialShellState(tab: Tab): ShellState;
```
- `src/app/tabs.ts`: `TABS`, `type Tab`, `readStoredTab(storage?)` and `storeTab(tab, storage?)`. The localStorage write happens in an effect, not in the reducer.
- `src/app/shortcuts.ts`:
  ```ts
  export function shortcutFor(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; targetEditable: boolean; modalOpen: boolean }): 'search' | null;
  ```
  - `/` works only when the target is not editable.
  - Cmd/Ctrl-K works anywhere; the caller calls `preventDefault`.
  - Nothing fires while a modal is open; the background is inert then.

**Editor draft: `src/views/editor/draft.ts`**
```ts
export function mergeView(live: Task, edits: Partial<Task>): Task;
export function editsBetween(live: Task, next: Task): Partial<Task>; // keys where next[k] !== live[k]
export function isDirty(edits: Partial<Task>): boolean;
export function blankTask(id: string, now: Instant): Task;           // makeTask({ id, title: '', createdAt: now })
export function validateForSave(view: Task): string[];               // blocking errors only
```
`validateForSave` blocks on:
- a trimmed title outside 1–200 characters
- `estMin` outside 0–100000
- `loggedMin < 0`
- completed before started

These mirror the DB constraints.

**Status ↔ progress: `src/views/editor/binding.ts`**

Each function takes the merged view and returns the next full Task. The editor then stores `editsBetween(live, next)`.
```ts
export function applyProgress(view: Task, p: number, now: Instant): Task;
export function applyStatus(view: Task, s: TaskStatus, now: Instant): Task;
export type PriorityChoice = 'auto' | PriorityLevel;
export function priorityChoiceOf(t: Task): PriorityChoice;
export function applyPriorityChoice(view: Task, c: PriorityChoice): Task; // auto → {auto, null}; level → {manual, level}
export function applyDate(view: Task, field: 'due' | 'targetFinish' | 'plannedStart', date: DateStr | null): Task; // null also clears its time
```
- **`applyProgress`:** first clamp to 0–100 and round to steps of 5.
  - `100` and not done: `withCompleted(view, now)`. This stops the timer and records `progressBefore`.
  - Between 0 and 100: un-complete if done (`withUncompleted`, then set `progress = p`), and set `actualStart ??= now`.
  - `0`: set progress only.
- **`applyStatus`:**
  - `done` gives `withCompleted`.
  - `doing` un-completes if needed and sets `actualStart ??= now`.
  - `todo` gives `{progress: 0, progressBefore: null, actualStart: null, completedAt: null}`. It does nothing while `timerStart != null` (the UI disables that option, because the DB requires a running timer to have a start).
- **Started and Completed fields:** Started is shown when status is not `todo` and cannot be cleared (to un-start, choose "Not started"). Completed is shown when done; clearing it acts like `applyStatus('doing')`.
- **Logged field:** read-only, with "Timer running", while `timerStart != null`.
- **`src/views/editor/fields.ts`:**
  ```ts
  export function toLocalInput(ms: Instant | null, tz: string): string;    // 'YYYY-MM-DDTHH:MM' in settings.timezone, NOT the browser zone
  export function fromLocalInput(v: string, tz: string): Instant | null;
  export function parseDuration(text: string): number | null;               // '', '90', '90m', '1h', '1h30', '1h 30m', '1.5h', '1:30' → minutes; '' → 0; junk → null
  ```

**Sanity checker: `src/views/editor/sanity.ts`**
```ts
export type SanityKind = 'started-in-future' | 'completed-in-future' | 'completed-before-started' | 'logged-exceeds-elapsed';
export interface SanityRepair { label: string; patch: Partial<Task> }
export interface SanityIssue { kind: SanityKind; message: string; blocking: boolean; repairs: SanityRepair[] }
export function checkTimes(view: Task, now: Instant, tz: string): SanityIssue[];
```
- `GRACE = 60_000` ms and `TOL = 1` minute.
- `when(ms)` formats as `HH:MM` if the date is today in `tz`, otherwise `` `${fmtDay(date)} HH:MM` ``.
- `logged = loggedMin(view, now)`.

| Kind | Condition | Repairs (label → patch) | Blocks Save? |
|---|---|---|---|
| started-in-future | `actualStart > now + GRACE` | "Start at {when(now)}" → `{actualStart: now}` | no |
| completed-in-future | `completedAt > now + GRACE` | "End at {when(now)}" → `{completedAt: now}` | no |
| completed-before-started | both set and `completedAt < actualStart` | "Start at {when(c − logged·60000)}" → `{actualStart: completedAt − logged·60000}`; "End at {when(s + logged·60000)}" → `{completedAt: actualStart + logged·60000}`, offered only if that is ≤ now | **yes** (the DB constraint would reject it) |
| logged-exceeds-elapsed | `actualStart` set, the previous issue absent; `end = completedAt ?? now`, `elapsed = (end − actualStart)/60000`, and `logged > elapsed + TOL` | "Log {fmtDur(elapsed)}" → `{loggedMin: max(0, floor(elapsed) − runningMin)}`, not offered while a timer runs; "Start at {when(end − logged·60000)}" → `{actualStart: end − logged·60000}` | no |

The required test property: applying each repair's patch and re-running `checkTimes` no longer reports that kind. A known-good task reports nothing.

**Focus bar: `src/views/timer/focus.ts`**
```ts
export interface FocusDisplay { mode: 'down' | 'up'; seconds: number; label: string; fraction: number | null; over: boolean }
export function focusDisplay(t: Task, now: Instant): FocusDisplay;
```
- `logged = loggedMin(t, now)`.
- With `estMin > 0`: mode `down`, `over = logged > estMin`, `seconds = |estMin − logged|·60`, label `(over ? '+' : '') + fmtClock(seconds)`, `fraction = min(1, logged/estMin)`.
- With no estimate: mode `up`, `seconds = logged·60`, `fraction = null`, `over = false`.
- The countdown basis is estimate minus logged, not the progress-adjusted remaining time (Q9).

**"How long did it take?": `src/views/timer/durationChips.ts`**
```ts
export function needsDurationPrompt(t: Task): boolean;   // completedAt != null && t.loggedMin < 1
export function durationChipOptions(estMin: number): Array<{ min: number; label: string; isEstimate: boolean }>;
export function durationPatch(t: Task, min: number): Partial<Task>;
```
- Options are `[15,30,45,60,90,120,180,240]` plus the estimate rounded to 5 (at least 5) when it is above 0, sorted and de-duplicated. Labels use `fmtDur`.
- `durationPatch` sets `loggedMin: min`. If `actualStart === completedAt` (the start was back-filled at completion) it also sets `actualStart = completedAt − min·60000`, so logged time never exceeds elapsed.

**Undo text: `src/views/undo/undoToast.ts`**
```ts
export function undoText(e: UndoEntry): string;   // delete → `Deleted "<title>"`, complete → `Completed "<title>"`, timer-stop → 'Timer stopped', timer-switch → `Switched to "<last snapshot title>"`; fallback e.label
export function nextToast(lastShownId: number, stack: readonly UndoEntry[]): UndoEntry | null; // latest if latest.id > lastShownId
```

## 7. Layout and CSS
```
src/App.tsx            gates (demo → ConfigNotice → Loading → SignIn → <SupabaseWorkspace>); first import '@/styles/base.css'
src/app/               backend.ts Workspace.tsx StoreProvider.tsx clock.ts useNow.ts router.ts useRoute.ts
                       shellState.ts tabs.ts shortcuts.ts selectors.ts actions.ts Shell.tsx Header.tsx TabBar.tsx shell.css
src/views/tasks/       TasksView.tsx Toolbar.tsx TaskRow.tsx grouping.ts filters.ts sort.ts rowModel.ts tasks.css
src/views/search/      SearchBox.tsx SearchResults.tsx searchMode.ts search.css
src/views/editor/      EditorSheet.tsx PriorityControl.tsx SanityNotice.tsx draft.ts binding.ts sanity.ts fields.ts editor.css
src/views/timer/       FocusBar.tsx RunningChip.tsx DurationPrompt.tsx focus.ts durationChips.ts timer.css
src/views/undo/        UndoToast.tsx undoToast.ts
src/views/placeholder/ PlaceholderView.tsx   (Dashboard / Calendar / Insights: "arrives in phase N")
src/ui/                ThemeControl.tsx (stays in the header until phase 3) Sheet.tsx ConfirmDialog.tsx ui.css
src/data/load.ts       src/dev/* (dev only)    src/pwa/* (devops)
```
- **`src/app/actions.ts`:** `useTaskActions()` returns stable callbacks that read `appClock.now()`: `complete`, `uncomplete`, `startTimer`, `stopTimer`, `remove`, `restore`, `logDuration`.
  - `complete` dispatches `prompt-duration` when `needsDurationPrompt` is true after completion.
  - Rows, the focus bar and the editor all use these; no component calls store mutations with its own clock.
- **CSS rules:**
  - Tokens come only from `tokens.css`, with no colour literals elsewhere.
  - A class used by two or more features goes in `base.css` (or `src/ui/ui.css` beside its primitive). Classes used by one feature live in that feature's CSS, imported by its component and prefixed (`.tasks-`, `.editor-`, `.focus-`, `.shell-`).
  - No CSS modules, to stay consistent with the existing global classes.
  - `base.css` is the first import in `App.tsx`, because `main.tsx` imports `App` before `base.css`, which would otherwise put feature CSS first and let base rules win at equal specificity.
  - Every figure gets lining numerals (see the designer's note on `.num`).
  - Add `--app-pad-x: 20px` to `.app` (same value) so full-bleed sticky elements can use the KB-0046 recipe.
- **Focus bar (KB-0046):** sticky at `top: 0` with `margin-inline: calc(-1 * var(--app-pad-x))` and the padding put back. The status-bar style is `default` (§10), so the top safe-area inset is 0 in standalone portrait. QA must verify at 390×844 with content scrolled.

## 8. Sheet and confirm dialog mechanics
- **Native `<dialog>` with `showModal()`.** It gives the top layer, an inert background, Tab kept inside the dialog, and Escape as a `cancel` event. It is supported on iOS 15.4 and later. Per KB-0026 the browser primitive beats a hand-rolled focus trap.
- **`src/ui/Sheet.tsx`:**
  ```ts
  export function Sheet(p: { open: boolean; onRequestClose(): void; labelledBy: string; initialFocusRef?: RefObject<HTMLElement | null>; children: ReactNode }): JSX.Element;
  ```
  - **Opening:** a layout effect calls `showModal()`, then `initialFocusRef.current?.focus()` explicitly. React's `autoFocus` does not set the attribute that the dialog's focusing steps look for.
  - **Closing:** `!open` calls `dialog.close()`.
  - **Escape:** `cancel` calls `e.preventDefault()` then `onRequestClose()`, so a dirty-check can step in.
  - **Always handle the `close` event as the source of truth** and call `onRequestClose()` if the route still thinks the sheet is open. Chrome closes without a cancellable `cancel` after a second Escape that has no user activation.
  - **Backdrop:** close only when both `pointerdown` and `click` targets are the `<dialog>` element itself. A text selection dragged out to the backdrop must not close the sheet.
  - **Structure (overrides the designer's sticky approach, same look):** `<dialog class="sheet">` (padding 0, `display: flex; flex-direction: column; max-height: 100dvh`) containing `.sheet-head`, `.sheet-body` (`overflow: auto; overscroll-behavior: contain`, padded) and `.sheet-foot`. There is no `position: sticky` inside the sheet, so KB-0046 cannot occur there. If a sticky element is ever added inside `.sheet-body`, use the custom-property recipe.
  - **Scroll lock:** CSS only, `html:has(dialog[open]) { overflow: hidden }`. No `position: fixed` body hack, which loses the scroll position. iOS needs a real-device check.
- **`src/ui/ConfirmDialog.tsx`:**
  ```ts
  export function ConfirmDialog(p: { open: boolean; title: string; body: ReactNode; confirmLabel: string; destructive?: boolean; onConfirm(): void; onCancel(): void }): JSX.Element;
  ```
  - It is a `<dialog role="alertdialog">` opened with `showModal()`. Nesting over the sheet works natively.
  - Initial focus goes to Cancel; Escape and the backdrop cancel.
  - Never use `confirm()`, `alert()` or `prompt()` (KB-0021).
- **Editor semantics (KB-0020): edits over live, with an explicit Save.**
  - State is `edits: Partial<Task>`. What renders is `mergeView(storeTask, edits)`, and the store task comes from `useAppStore(s => s.tasks[id])`, the same authority the editor writes to.
  - For `/task/new`, the base is `blankTask(crypto.randomUUID(), now)`, held in state. Save calls `saveTask(merge)`.
  - For an existing task, Save calls `patchTask(id, edits, completing ? {kind: 'complete', label: 'Task completed', at: now} : undefined)`. Only changed fields land on the current store task, so nothing is clobbered by a stale snapshot. Completing through the editor is undoable, and undo restores the task as it was before the save.
  - Save is disabled while `validateForSave` returns errors.
  - "Mark done" is `applyStatus(view, 'done')` followed by the same Save path; it then closes the sheet and runs the duration-prompt check.
  - Closing with unsaved edits opens `ConfirmDialog` ("Discard changes to "X"?"). Closing without edits is immediate.
  - **Why not live patching:** the DB constraints (title length, completed ≥ started, a running timer needs a start) reject half-finished states. Each keystroke would also queue a full-row upsert, and undo would get no meaningful snapshot.
- **Task not found:** an unknown id, or a task with `deletedAt` set, renders a not-found state in the sheet with Close (and Restore when deleted, via `restoreTask`).
- **Delete:**
  1. The first tap arms the button ("Delete" becomes "Confirm delete"); it disarms after 4 s. The button has a fixed min-width so the label change does not shift it (KB-0044).
  2. The second tap opens a `ConfirmDialog` naming the task.
  3. Confirm calls `deleteTask(id, now)`, then `closeTaskRoute()`, then the toast appears.
- Delete is only available in the editor in 2b; there is no row-level delete.

## 9. Undo toast
- **One toast at a time; the newest replaces the previous one.** It shows `nextToast(lastShownId, undoStack)`. After an undo pops an entry, the older entry underneath is never shown again.
- **Lifetime is 6 s,** paused while the pointer is over it or focus is inside it (WCAG 2.2.1). It sits in a `role="status" aria-live="polite"` region.
- **Undo checks it is still the latest entry:** `if (getState().undoStack.at(-1)?.id === entry.id) undo()`, then hide.
- **Every pushed undo entry is toasted:** complete, delete, timer-stop, timer-switch. The store decides what is undoable.
- **Toasts only appear after dialogs close.** The background is inert while a modal is open, so the delete and Mark-done flows close their dialogs first.
- The duration prompt renders in the same region, above the toast.

## 10. PWA (devops-engineer, in parallel)
- **Hand-written service worker plus a build plugin of about 30 lines. No vite-plugin-pwa.** That plugin pulls in workbox-build and carries a Vite 8 / Rolldown peer-compatibility risk for four caching rules.
- **Plugin, inline in `vite.config.ts`:** `{ name: 'mercury-sw', apply: 'build', generateBundle(_, bundle) { … this.emitFile({ type: 'asset', fileName: 'sw.js', source }) } }`.
  - It reads `src/pwa/sw.js` as text and substitutes `__PRECACHE__` with `['/index.html', ...Object.keys(bundle).filter(f => f.startsWith('assets/')).map(f => '/' + f), '/manifest.webmanifest', icon paths]` and `__VERSION__` with a short hash of that list.
  - `index.html` must be added explicitly; it is not among the bundle keys at that point (I checked). `apply: 'build'` keeps vitest unaffected.
- **`src/pwa/sw.js` behaviour:**
  - `install`: `caches.open('mercury-' + VERSION)`, `addAll(PRECACHE)`, `skipWaiting()`.
  - `activate`: delete every other `mercury-*` cache, then `clients.claim()`.
  - `fetch`: only same-origin GET is handled; everything else (`*.supabase.co`, auth, Google Fonts) passes through without `respondWith`, so it is never cached.
    - `request.mode === 'navigate'`: network first, falling back to the cached `/index.html` on failure. Navigation responses are never written to the cache, so OAuth `?code=` URLs and error pages are never stored.
    - `/assets/*`: cache first, then network, storing only status 200 responses of type `basic`.
    - `/sw.js` itself is never cached.
  - There are no `push`, `sync` or `periodicsync` handlers (§2.8).
  - No "update available" UI: a new deploy takes over on the next launch.
- **`src/pwa/register.ts`:** a side-effect module that, `if (import.meta.env.PROD && 'serviceWorker' in navigator)`, registers `/sw.js` on window `load` and swallows errors.
- **Manifest, `public/manifest.webmanifest`:**
  - `id "/"`, `name/short_name "Mercury"`, `start_url "/"`, `scope "/"`, `display "standalone"`
  - `background_color` and `theme_color` `#f6f5f1` (light `--bg`)
  - icons: 192 and 512 with `purpose any`, plus a 512 maskable with the mark inside the central 80%
  - `shortcuts: [{ name: "Add a task", url: "/#add" }]`
- **`index.html` `<head>` additions only** (leave the theme script alone):
  - `<link rel="manifest">`
  - `<link rel="apple-touch-icon" href="/apple-touch-icon.png">` (180×180, opaque; iOS renders transparency as black)
  - `<meta name="theme-color" content="#f6f5f1" media="(prefers-color-scheme: light)">` and `content="#101113"` for dark
  - `apple-mobile-web-app-capable` and `mobile-web-app-capable` set to `yes`
  - `apple-mobile-web-app-title` `Mercury`
  - `apple-mobile-web-app-status-bar-style` **`default`**
- **Icons:** `scripts/make-icons.mjs`, a one-off script using only Node built-ins (`node:zlib` `deflateSync`, a hand-written CRC32, then IHDR/IDAT/IEND). It draws the designer's mark as simple geometry, supersampled 4×4 for anti-aliasing. The output PNGs are committed to `public/`. No npm script, so `package.json` is untouched. Verify by viewing the PNGs and checking their IHDR dimensions.
- **Files devops owns:**
  - `public/*`, `src/pwa/register.ts`, `src/pwa/sw.js`, `scripts/make-icons.mjs`, `vercel.json`
  - `index.html` `<head>` tags, and the plugin in `vite.config.ts`
  - one additive `eslint.config.js` block: `{ files: ['src/pwa/sw.js'], languageOptions: { globals: globals.serviceworker } }`. It is needed because `js.configs.recommended` lints `.js` files and has no globals there.
  - **exactly one line in `src/main.tsx`: `import './pwa/register';`**
- **Frontend touches none of these files.**
- **Offline check:** `npm run build && npm run preview`, load once, go offline, reload. The shell must render (the gate or "You're offline…"), and CacheStorage must contain only same-origin entries.

## 11. Test strategy
- **No jsdom, happy-dom or Testing Library. Pure helpers only, plus Playwright visual verification** (KB-0025, the designer's checklist, both themes, 390×844 and 1280×800, using `npm run dev:demo`).
  - Dev dependencies would not affect the bundle; the argument is value. Every branch with logic lives in the §6 modules.
  - jsdom does not implement `showModal()`, so the riskiest component (Sheet) would need stubbing and the tests would prove little. Real-browser checks cover it.
- **New test files:**
  - `app/`: `router`, `shellState`, `tabs`, `shortcuts`, `clock` (fake timers: the fast interval exists only while subscribed; bump; visibility), `selectors`
  - `data/`: `load` (`assembleInitial`: null settings gives defaults, order preserved, deleted rows dropped, archived rows kept)
  - `views/tasks/`: `grouping` (today at an earlier time counts as overdue; +7 vs +8; midnight; a DST zone around 2026-11-01 in America/New_York), `filters`, `sort` (nulls last, every tie-break), `rowModel`
  - `views/search/`: `searchMode`
  - `views/editor/`: `binding`, `sanity` (each repair resolves its issue; known-good input stays silent), `draft`, `fields` (datetime-local round-trip in a zone different from the test machine's; `parseDuration`)
  - `views/timer/`: `focus`, `durationChips`
  - `views/undo/`: `undoToast`
  - `dev/`: `seed`
  - `store.test.ts` additions (§12)
- **Gates:** `npm test`, `npm run lint`, `npm run build`, and the §5 dist grep (both halves).

## 12. Required changes to existing code
1. **`src/store/store.ts`:**
   - Add `export type UndoKind = 'complete' | 'delete' | 'timer-switch' | 'timer-stop'`.
   - `UndoEntry` gains `id: number` (a per-store counter starting at 1) and `kind: UndoKind`.
   - `patchTask(id, patch, undo?: { kind: UndoKind; label: string; at: Instant })`: when `undo` is given, push `{ ...undo, id, snapshots: [current] }`.
   - Existing labels are unchanged. The current assertions only check `undoStack` length or emptiness, so they still pass.
   - New tests: ids increase, `kind` is set for each action, and `patchTask` with `undo` pushes a snapshot of the task before the patch.
2. **No `loadAll` or hydrate action** is needed (`setTasks`/`setCategories`/`setSettings` exist, and `setTasks` already protects in-flight tasks). The `Persistence` interface is unchanged; `Backend` wraps it.
3. **`src/App.tsx`:** keep `ConfigNotice`, Loading and `SignIn`. Replace `AppShell` with `SupabaseWorkspace`, which does `useMemo(() => createSupabaseBackend(supabase!, userId), [userId])` and renders `<Workspace key={userId} …>`. Add the demo branch. Make `base.css` the first import. Drop the inline styles.
4. **`package.json`:** add the `dev:demo` script (frontend).
5. **`src/styles/base.css`:** add `--app-pad-x` on `.app`, with the value unchanged.
6. **Not changed:** migrations, `src/domain/`, mappers.

## Open questions for you
1. **Sync batch.** I propose a follow-up "2c sync" (realtime on tasks, settings and categories; an outbox that retries failed writes; the offline banner) before the plan's "run your real task list" milestone. Two reasons:
   - Saves are whole-row upserts, so two devices overwrite each other (last write wins).
   - Failed writes are never retried, and the next reload drops them.
2. **Default tab** for a fresh install is Tasks until Dashboard exists (phase 3). Confirm.
3. **Example loader.** The 5-task loader and one-click removal (Tasks parity) are not in the 2b list; the mapper hardcodes `is_example: false`. The dev seed is not the loader. Defer?
4. **No categories for real users yet.** Category management is in phase 3, so in 2b real users have none and the category filter shows only "All". Acceptable?
5. **Buffer default mismatch.** The DB default is `buffer = 1.5`, `DEFAULT_SETTINGS.buffer` is 1.2. A settings row created from DB defaults behaves differently from having no row. Fixing it needs a new migration (backend's call).
6. **Timezone default.** A user with no settings row gets `Asia/Singapore` regardless of device. Fine for this user; noted.
7. **Faint contrast.** I agree with the designer's `.eyebrow` change (`--faint` to `--muted`); it needs your approval.
8. **Focus-bar basis.** The countdown is estimate minus logged, not the progress-adjusted remaining time. Confirm.
9. **Theme colour when pinned.** The `theme-color` meta follows the device scheme, not a pinned theme. Minor; defer?
10. **Duration source.** `logged_source = 'chip'` is not stored (the mapper writes null and the domain has no field). Insights may want it later; defer.

## Confidence check
- **Verified directly:** every store, domain, mapper, migration, lint and tsconfig claim above, by reading the lines. Demo removal from the production build plus the positive control, and the `generateBundle` emit (including that `index.html` is not in the bundle keys), both by building in the scratchpad with the repo's Vite and Rolldown.
- **Not verified here:**
  - iOS Safari behaviour of `html:has(dialog[open]) { overflow: hidden }` and the `default` status-bar inset. Both need a real-device or WebKit check by QA.
  - The Chrome rule that a second Escape cannot be cancelled. The design handles `close` either way, so it does not depend on this.

Board entry appended to `C:\Mercury\TEAM-BOARD.md` as `[tech-lead-20261029T082930]`. The scratch build experiments are in `C:\Users\isaia\AppData\Local\Temp\claude\C--Mercury\ef12e05d-1406-44d1-8682-56bff2da1374\scratchpad\dce`.
