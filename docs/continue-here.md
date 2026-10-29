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
> **Where things stand.** Phases 0, 1 and 2a are done on branch
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
> **Phase 2b (the views) is specified but not implemented.** No source file has
> changed since 2a. The `engineering-director` subagent ran its tech-lead and
> ui-ux-designer, then paused at my request before any implementation. Their
> full specs are in `docs/phase-2b/tech-lead-spec.md` and
> `docs/phase-2b/design-spec.md`; the team board with the condensed decisions
> is `TEAM-BOARD.md` at the repo root (three entries, all OPEN).
>
> **316 tests pass.** Run `npm test`, `npm run lint` and `npm run build` before
> you start, to confirm the baseline.
>
> **Resume by handing phase 2b back to the `engineering-director`** for the
> build, passing it both spec files, the board, and the rulings and open
> decisions below so it does not re-derive them. Its planned sequence: the
> senior-frontend-dev implements from both specs while the devops-engineer does
> the PWA files in parallel; then QA and security review in parallel; then a
> Playwright pass (Tasks view, editor, delete dialog + undo toast, focus bar —
> light and dark, 390px and 1280px); then the technical writer updates the
> docs, and the board is archived.
>
> Phase 2b scope, in order: (1) app shell — header, four tabs, desktop tab bar
> and phone bottom nav, `/task/:id` and `#add` routing; (2) Tasks view —
> filters, sorting, deadline grouping, the task row; (3) search UI over
> `searchTasks`, focused with `/` or Cmd-K; (4) task editor sheet with the live
> priority preview, status↔progress binding, time sanity checker and four-way
> priority control; (5) delete: arm, confirm dialog, undo toast; (6) timers and
> the sticky focus bar, plus the "how long did it take?" prompt; (7) PWA
> manifest and service worker.
>
> **Conflicts between the two specs — the director's rulings (tech-lead wins
> on all five):**
>
> 1. Editor sheet is a native `<dialog>` laid out as a flex column (head /
>    scrolling body / foot) — no `position: sticky`, so KB-0046 cannot occur.
> 2. One toast at a time (6 s, paused on hover/focus), not a stack of three.
> 3. Theme control lives in the header, not a page footer.
> 4. Closing the editor with unsaved edits asks "Discard changes?" in an in-app
>    dialog.
> 5. While searching, the filter bar is hidden rather than saved and restored.
>
> **Open decisions for me (the user) — ask before implementing; the director's
> recommendation is in brackets:**
>
> 1. Change `.eyebrow` in `src/styles/base.css` from `--faint` to `--muted`.
>    `--faint` is ~2.5:1 in light and ~3.9:1 in dark, failing 4.5:1 for small
>    text. It edits the settled design system. [Yes — both specialists agree;
>    re-verify ratios with a script first.]
> 2. Defer realtime sync, failed-write retry and the offline banner to a
>    separate "2c" batch. Until then a failed save is lost on reload, and two
>    devices overwrite each other. [Yes, defer.]
> 3. Default tab is Tasks until the Dashboard exists. [Yes.]
> 4. Defer the 5-task example loader (not on the handoff list). [Yes.]
> 5. Placeholder copy: "Coming in phase 3" for Dashboard and Calendar,
>    "Coming in phase 5" for Insights. [Yes.]
> 6. The focus bar counts down estimate − logged, not the progress-adjusted
>    remaining. [Yes.]
> 7. Low priority shown in `--muted` rather than green. [Yes.]
> 8. Designer's smaller questions: Completed group always expanded? Bottom nav
>    text-only (no icon set exists)? Ink-inverted toast acceptable as the one
>    solid block? [Expanded; text-only; yes.]
>
> Flagged, not in scope: the database defaults `settings.buffer` to 1.5 while
> `DEFAULT_SETTINGS` in the domain uses 1.2. Fixing it needs a migration.
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
> - The design system in `src/styles/tokens.css` and `base.css` is settled —
>   quiet editorial, no cards, status as text, lining figures on every number.
>   The "colour block" description in the build plan §1 is superseded.
> - The dev-only demo path (`npm run dev:demo`) must be dropped from the
>   production build: `npm run build && grep -rl mercury-demo-seed dist/` must
>   find nothing.
>
> **Environment notes.** Playwright MCP works from the director's process, so
> it can take the screenshots itself. Each Playwright session creates
> `.playwright-mcp/` at the repo root — delete it before `npm run format:check`.
> PostgreSQL is not installed on the Windows machine, so `npm run db:test`
> cannot run there; say so rather than skipping it silently. That checkout also
> has `core.autocrlf=true`, so `npm run format:check` flags ~49 files purely
> for CRLF line endings; `npx prettier --check --end-of-line crlf .` is the
> meaningful local check (git stores LF, so CI is unaffected).
>
> **Before any push**, run `npm test`, `npm run lint`, `npm run build` and
> `npm run db:test`. Work on `claude/brave-ride-2frhfa`. Don't commit or push
> unless I ask.
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
