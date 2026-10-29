# Continuing Mercury

Paste the prompt below into a fresh Claude Code session started **inside the
cloned repository**. It is written to stand alone.

---

## The prompt

> I'm continuing work on **Mercury**, a calendar-aware task tracker. The repo is
> already cloned and you're in it. Start by reading `docs/mercury-build-plan.md`
> — it holds the full design, the capability inventory and the phased build
> plan — and `README.md` for the stack and scripts.
>
> **Where things stand.** Phases 0, 1 and 2a are done and pushed on branch
> `claude/brave-ride-2frhfa`, which is also the default branch:
>
> - **Phase 0** — Vite + React 19 + TypeScript scaffold, ESLint, Prettier,
>   Vitest, GitHub Actions. The full Postgres schema with row-level security
>   lives in `supabase/migrations/`, with SQL tests in `supabase/test/` that
>   `npm run db:test` applies to a real throwaway database. Google sign-in and
>   three gate screens (unconfigured / signed-out / signed-in) are in place.
> - **Phase 1** — the rules engine in `src/domain/`: timezone-explicit date
>   handling, the capacity model, automatic and pinned priority, the attention
>   signals, the one-line capture parser, week-load spreading and insights.
>   Pure TypeScript — no React, no Supabase, no reading the clock.
> - **Phase 2a** — the skin-independent half of the app layer: the per-task
>   write queue (`src/data/queue.ts`), row↔domain mappers
>   (`src/data/mappers.ts`), search (`src/domain/search.ts`), and the store with
>   optimistic mutations, the single-timer rule and undo (`src/store/store.ts`).
>
> **316 tests pass.** Run `npm test`, `npm run lint` and `npm run build` before
> you start, to confirm the baseline.
>
> **What's next is phase 2b: the views.** The design system is already ported
> into `src/styles/tokens.css` and `src/styles/base.css` from the source
> artifact, so match it rather than inventing styling. Build, roughly in order:
>
> 1. App shell — header, the four tabs (Dashboard, Tasks, Calendar, Insights),
>    desktop tab bar and fixed bottom navigation on phones, routing including
>    `/task/:id` deep links and the `#add` shortcut.
> 2. Tasks view — category and status filters, sorting, deadline grouping
>    (Overdue / Today / Next 7 days / Later / No due date / Completed), and the
>    task row with its priority mark, countdown chips, progress and attention
>    reason.
> 3. Search UI over the existing `searchTasks`, focused with `/` or Cmd-K.
> 4. Task editor sheet — all fields, the live priority preview, status↔progress
>    binding, the time sanity checker with its one-tap repairs, and the
>    four-way priority control (Auto / High / Med / Low).
> 5. Delete: arm, then a confirm dialog naming the task, then the undo toast.
>    The store already has `deleteTask`, `restoreTask` and `undo`.
> 6. Timers — the sticky focus bar counting down the estimate, turning red past
>    it, and the "how long did it take?" prompt after completing untimed work.
> 7. PWA manifest and service worker so it installs on an iPhone.
>
> Wire the views to the store; don't reimplement logic that `src/domain` already
> owns.
>
> **Things that are deliberate — please don't undo them:**
>
> - `src/domain/` must keep zero imports from React, Supabase or `Date.now()`.
>   Every function takes `now` as an argument, because the same code runs in a
>   scheduled Edge Function and the server must never disagree with the UI.
> - Time is measured as **capacity** (waking, unbooked, porosity-adjusted), not
>   wall-clock distance to a deadline. Sleep is tracked separately as reserve.
> - Deletion is soft. Nothing is hard-deleted outside the 30-day trash sweep.
> - Undo restores snapshots; it does not invert operations.
> - A server snapshot must not overwrite a task whose own write is in flight.
>
> **Before any push**, run `npm test`, `npm run lint`, `npm run build` and
> `npm run db:test`. Work on `claude/brave-ride-2frhfa`.
>
> To run it against real data you'll need a Supabase project — the README has
> the steps, and the app shows setup instructions rather than a blank screen
> until it's configured.

---

## Setting up locally

```bash
npm install
cp .env.example .env.local   # fill in from Supabase → Project Settings → API
npm test
npm run dev
```

`npm run db:test` additionally needs a local PostgreSQL 16 installation; it
creates and drops its own throwaway database.
