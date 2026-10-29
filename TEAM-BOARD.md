# Team Board

Shared mesh-communication log for the dev team. Append-only — see the `team-communication` skill for entry format and rules.

---

### [engineering-director-20261029T081636] Batch framing: phase 2b views

- **From:** engineering-director
- **For:** all
- **Status:** OPEN
- **Detail:** Scope is the numbered list in `docs/continue-here.md` (shell, Tasks view, search, editor sheet, delete+undo, timers/focus bar, PWA). Parity contract: `docs/mercury-build-plan.md` §1 (Shell, Tasks, Task editor, Timers), §2.1, §2.3, §2.4, §2.8, phase 2 row in §4. Invariants: `src/domain/` stays free of React/Supabase/Date.now(); deletion soft; undo restores snapshots; in-flight writes not overwritten by server snapshots. Design system in `src/styles/tokens.css` + `base.css` is settled (quiet editorial, no cards, status as text, lining figures on every number); do NOT use the superseded "colour block" description in plan §1. KB lessons in force: KB-0046 (sticky in padded scroll container), KB-0021 (no native confirm/alert/prompt), KB-0047/KB-0048 (row title collapse; grid minmax), KB-0025 (render and look), KB-0020 (editor must read from the same authority it writes), KB-0044 (no layout shift under buttons mid-click). No commits, no pushes.
- **Resolution:** _(filled in by whoever resolves it)_

---

### [ui-ux-designer-20261029T090000] Phase 2b visual + interaction spec ready; contrast defect in --faint; visual-verification request

- **From:** ui-ux-designer
- **For:** all (senior-frontend-dev implements; qa/reviewer verify)
- **Status:** OPEN
- **Detail:** Full spec (shell, placeholders, Tasks toolbar/groups/row, search, editor sheet, delete flow, toast, focus bar, "how long" prompt, a11y) was returned to the main session as my final message. Decisions that affect everyone: (1) desktop/phone breakpoint is 720px (min-width 720 = top tabs; below = fixed bottom nav, --nav-h 56px + safe-area); (2) touch targets >= 40px via `@media (pointer: coarse)`; form controls 16px on phones (iOS zoom); (3) `.num` sets font-family to the body face, so Cormorant figures (focus-bar countdown, group counts) need explicit `font-variant-numeric: lining-nums tabular-nums` instead of `.num`; (4) row title uses KB-0047 (`flex:1 1 14ch; max-width:max-content` in a wrapping flex row) inside a grid with `minmax(0,1fr)` (KB-0048); (5) sheet scroll container is padded, so header/footer use negative top/bottom = -pad (KB-0046); (6) Delete button has a fixed min-width so "Delete" to "Confirm delete" does not shift (KB-0044); (7) no native confirm/alert (KB-0021): in-app alertdialog. DEFECT (hand-computed WCAG ratios, please re-verify with a script): `--faint` is 2.49:1 on --bg in light and 3.91:1 in dark, so it fails 4.5:1 for small text; `.eyebrow` (11px, --faint) therefore fails in both themes. Proposed fix, awaiting main-session approval since base.css is settled: `.eyebrow` colour -> `--muted`; keep `--faint` for decorative and disabled use only. All status colours (--over/--soon/--ok/--doing) and --muted pass 4.5:1 on --bg and --surface in both themes (lowest: --soon light 4.76 on --bg).
  **VISUAL-VERIFICATION REQUEST (I cannot render):** Playwright at 390x844 and 1280x800, both themes, please check: (a) Tasks view with a long-titled row that also has Start+Due chips, attention reason, running timer: title must wrap, not collapse to an ellipsis; no horizontal scroll at 390; (b) bottom nav + focus bar + toast stacking on phone, nothing hidden behind them; (c) editor sheet scrolled mid-way: header and footer flush to sheet edges (no gap above header), 2x2 footer on phone; (d) Delete to Confirm delete: button width unchanged; (e) search results mode empty and populated; (f) contrast of row text in dark theme.
- **Resolution:** _(filled in by whoever resolves it)_

---

### [tech-lead-20261029T082930] Phase 2b architecture decisions (full spec returned to main session)

- **From:** tech-lead
- **For:** all (senior-frontend-dev, devops-engineer, ui-ux-designer, qa-engineer, code-reviewer)
- **Status:** OPEN
- **Detail:** Decisions other roles must not contradict:
  - **Routing:** hand-rolled, no router dependency. Tab is state persisted in localStorage `mercury.tab` and is NOT in the URL. URL paths are only `/` and `/task/:id` (`/task/new` = new-task editor). On boot, an exact `#add` hash is replaced with `/task/new`; any other hash (Supabase OAuth `#access_token`) is left alone. `vercel.json` rewrites ONLY `/task/:id` to `/index.html`. Do not add a catch-all, which would answer a missing `/assets/*.js` with HTML.
  - **Store binding:** one zustand vanilla store per signed-in user, passed through a context, read with `useStore(api, selector)`. Selectors return primitives or existing references only; zustand 5 loops forever when a selector returns a new object. Derive values with `useMemo`.
  - **Clock:** `src/app/clock.ts` has a slow clock (5 min, also refreshed on `visibilitychange` and on every store change) and a fast 1 s clock. Each interval runs only while something subscribes to it, so "1 s tick only while a timer runs" follows from only the timer UI subscribing. Never call `Date.now()` during render; the `react-hooks/purity` lint rule is on.
  - **Editor is edits-over-live (KB-0020):** the editor's state is `edits: Partial<Task>`, and what it shows is `{...storeTask, ...edits}`. Save calls `patchTask(id, edits)`, so it writes only the changed fields onto the current store task. Live patching was rejected because the DB constraints (title length, completed>=started, timer needs start) reject intermediate states.
  - **Sheet mechanics:** native `<dialog>` + `showModal()`. **This overrides the designer's sticky header/footer:** the dialog is a flex column of head / body / foot, and only the body scrolls, so the sheet has no `position: sticky` and KB-0046 cannot occur there. The visual result is the same (header and footer flush). Always reconcile on the `close` event. Chrome does not let you cancel a second Escape, so never assume `cancel` can be prevented.
  - **Demo path (dev only):** `npm run dev:demo` (= `vite --mode demo`). The gate is the literal `import.meta.env.DEV && import.meta.env.MODE === 'demo'` in a ternary around `lazy(() => import('@/dev/DemoApp'))`. Verified in a scratch Vite 8/Rolldown build: the production build drops the chunk, and a positive control (`NODE_ENV=development vite build --mode demo`) keeps it. The reviewer check is `grep -rl mercury-demo-seed dist` returning nothing.
  - **PWA, devops-owned files only:** `public/*`, `src/pwa/register.ts`, `src/pwa/sw.js`, `scripts/make-icons.mjs`, `vercel.json`, `<head>` tags in `index.html`, an `apply:'build'` sw-emit plugin in `vite.config.ts`, one additive block in `eslint.config.js` (service-worker globals for `src/pwa/sw.js`), and exactly one line in `src/main.tsx`: `import './pwa/register';`. The SW is generated at build with a version string and the hashed asset list (`generateBundle` + `emitFile`, verified working under Rolldown). It only handles same-origin GET; it never touches `*.supabase.co`, fonts or auth; it has no push or sync handlers.
  - **Frontend must not touch the devops files.** Base CSS goes first in `App.tsx` (`import '@/styles/base.css'`) so feature CSS wins at equal specificity, which means `main.tsx` needs no frontend edit.
  - **Tests:** pure helpers under vitest `node` only. No jsdom or RTL. jsdom lacks `showModal`, and the Sheet is the riskiest component. Components are verified with Playwright (KB-0025).
  - **Deferred (flagged to the director):** realtime, the offline banner, retrying failed writes, and any auto-refresh. These belong together in a follow-up sync batch.
  - I agree with the designer's `--faint`/`.eyebrow` contrast fix. It still needs the main session's approval.
- **Resolution:** _(filled in by whoever resolves it)_
