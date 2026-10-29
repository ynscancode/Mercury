# Mercury

A calendar-aware task tracker. It reads your calendar, works out how much time
you actually have, and tells you which task needs starting now — rather than
just listing what is due.

The full design, the capability inventory and the phased build plan live in
[`docs/mercury-build-plan.md`](docs/mercury-build-plan.md).

## Status

**Phase 1 — the rules engine.** The domain layer is complete and tested: 237
unit tests across time zones, the capacity model, priority, attention, the
capture parser, week load and insights. Phase 0's scaffold, schema and
authentication are in place beneath it. The application views arrive in
phase 2.

## Stack

| Layer                | Choice                                                             |
| -------------------- | ------------------------------------------------------------------ |
| Frontend             | React 19 + TypeScript + Vite, deployed as a static build to Vercel |
| Data, auth, realtime | Supabase (Postgres) — project region Singapore                     |
| Server work          | Supabase Edge Functions, co-located with the database              |
| Scheduling           | `pg_cron`, which schedules per-minute on the free tier             |

Server code lives in Supabase rather than on Vercel for three reasons: Vercel
Cron on the Hobby plan runs at most once per day, which cannot drive the
notification engine; Vercel functions default to US East while the database is
in Singapore; and keeping it in Supabase means every secret lives in one Vault
rather than being split across two platforms.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in from Supabase → Project Settings → API
npm run dev
```

The app runs without configuration — it renders setup instructions instead of
a blank screen — so `npm run dev` is useful before a Supabase project exists.

### Connecting Supabase

1. Create a project at [supabase.com](https://supabase.com), **region
   Singapore (`ap-southeast-1`)** so it sits next to its server code.
2. Put the project URL and anon key in `.env.local`. Both are safe in the
   browser: the anon key is public by design and every table is guarded by
   row-level security.
3. Apply the schema. Either paste
   `supabase/migrations/20261029090000_init.sql` into the SQL editor, or use
   the Supabase CLI:
   ```bash
   supabase link --project-ref <your-ref>
   supabase db push
   ```
4. Enable the Google provider under Authentication → Providers, and add your
   deployed URL plus `http://localhost:5173` to the redirect allow list.
   Vercel preview deployments get unique URLs, so add a wildcard if you want
   sign-in to work on previews.

## Scripts

| Command           | What it does                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `npm run dev`     | Dev server on :5173                                                                            |
| `npm run build`   | Typecheck, then production build                                                               |
| `npm test`        | Unit tests (Vitest)                                                                            |
| `npm run lint`    | ESLint                                                                                         |
| `npm run format`  | Prettier, writing in place                                                                     |
| `npm run db:test` | Apply every migration to a throwaway Postgres and assert the constraints and RLS policies hold |

## Testing the database

`npm run db:test` is not a lint of the SQL — it creates a real database,
applies every migration, and then asserts behaviour:

- **`supabase/test/02_rls.sql`** signs in as two users and proves neither can
  read, update, delete or forge the other's rows.
- **`supabase/test/03_constraints.sql`** attempts eleven impossible writes — a
  due time with no due date, a task completed before it started, an automatic
  priority that also pins a level, a duplicate entry in the notification dedupe
  ledger — and fails if any of them is accepted.

Both suites have been mutation-tested: widening a policy or dropping a
constraint makes them fail, which is the only evidence that a passing run
means anything.

`supabase/test/00_bootstrap.sql` is a local stand-in for the `auth` schema and
roles that Supabase provides. It is never deployed.

## Repository layout

```
src/
  domain/   pure TypeScript rules engine — no React, no Supabase imports
  lib/      configuration and the Supabase client
  auth/     session handling
  styles/   design tokens and base styles
supabase/
  migrations/  the real schema, applied to your project
  test/        local-only harness and assertions
scripts/       database helpers used by npm run db:test
docs/          the build plan
```

### The rules engine

`src/domain` holds everything that decides what the app says:

| Module        | What it owns                                             |
| ------------- | -------------------------------------------------------- |
| `zone.ts`     | wall-clock ↔ instant conversion against an IANA timezone |
| `task.ts`     | status, the three dates, remaining work, logged time     |
| `capacity.ts` | porous events, capacity vs schedulability, night reserve |
| `priority.ts` | automatic and pinned priority, the attention signals     |
| `capture.ts`  | the one-line parser                                      |
| `load.ts`     | spreading work across the days that can hold it          |
| `metrics.ts`  | completion, on-time, estimate accuracy, insight lines    |

`src/domain` is deliberately free of framework imports. The same priority and
free-time code has to run in the browser and inside a scheduled Edge Function,
so the server can never disagree with the UI about whether a task is urgent.
