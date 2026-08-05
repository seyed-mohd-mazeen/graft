# Graft — Audit & Fix Log

(Written while this project was still called Ticket Runner — kept as Graft's history rather than rewritten.)

Original audit of the codebase, plus what was done about each finding. All 28
items are addressed. Telegram notifications were made opt-in (off by default)
after that. Test suite: **143 passing**, up from 45.

The headline change is that **each ticket is now implemented in its own git
worktree**, on its own branch. That alone resolves the critical concurrency bug,
the remote-less-repo blocker, the branch hijacking, and the diff-scoping
problems — see [README](README.md#how-runs-are-isolated).

---

## Tier 1 — onboarding, before teammates get access

Done. Each item below was one of four priorities identified before opening the
repo up to other developers.

| # | Item | What was built |
|---|---|---|
| 1 | Cross-platform Claude CLI resolution was unverified on Mac/Linux | Found and fixed a real bug this surfaced: [claudeBin.js](lib/claudeBin.js)'s `resolveClaudeCommand()` never actually checked whether `claude` exists on PATH for non-Windows — it just returned the bare name unconditionally, so a missing CLI there would only ever show up as a raw `ENOENT` deep inside a task. Now it resolves the same way Windows does (diagnosis only — the actual spawn behaviour on POSIX is unchanged, since `spawn()` already resolves a bare name against PATH itself). Fixing this test properly also caught a second bug: `findExecutable()`'s path-joining used the *host* OS's path module regardless of the `platform` override, so simulating Linux from a Windows caller silently joined paths with the wrong separator. Both are unit tested; still not run against a real Mac/Linux machine — flagged honestly in the README. |
| 2 | The safety model wasn't visible before entering credentials | Settings' **Safety** card is now first alongside Setup status, and leads with the important sentence in bold: this runs Claude with write access and has no login of its own. |
| 3 | No setup validation — problems surfaced as confusing task failures | New [lib/doctor.js](lib/doctor.js): nine checks (Node version, API-key billing mode, Claude CLI, Claude login, git, VS Code CLI, Jira, project, network exposure), each `ok`/`warn`/`fail` with a plain-language fix. Runs at server startup (console summary) and via `GET /api/doctor` (Settings → **Setup status** card, re-checked automatically after any save that could resolve it; a Board-page banner appears when Jira or a project isn't configured yet, or something is outright broken). |
| 4 | Settings-schema evolution across `git pull` was unverified/undocumented | Already safe by design (`{...defaults, ...persisted}` merge) — documented in the README's new "Updating" section so nobody hesitates to pull. |

---

## Post-Tier-1: "Open in VS Code" opened two blank tabs instead of the folder

Found live, not by review: clicking the button opened VS Code with two empty
untitled tabs named after path fragments, instead of the actual worktree.
Two separate real bugs in [claudeRunner.js](lib/claudeRunner.js)'s
`spawnVSCode` and [claudeBin.js](lib/claudeBin.js), both root-caused and fixed:

1. **`spawn('code', [dir], { shell: true })` silently split the path at every
   space.** Node does not quote array-form arguments for the shell it hands
   them to (Node's own deprecation warning says as much: *"arguments are not
   escaped, only concatenated"*) — and a project folder with a space in its
   name (e.g. `My Projects`) will break on every path it opens. Fixed by extracting
   `resolveCommand()` out of the already-tested `claude`-specific resolver in
   claudeBin.js, so `code` gets the exact same safe, hand-quoted invocation
   `claude` already had — no `shell: true` anywhere any more.
2. **`findExecutable()`'s Windows candidate order tried the bare,
   extensionless name before any real extension.** VS Code's actual install
   ships both a `.cmd` shim *and* a same-named extensionless POSIX shebang
   script (for git-bash/WSL) in the same folder — `where.exe` lists both, but
   neither cmd.exe's own resolution nor `CreateProcess` will ever run the
   extensionless one. The old order picked it anyway, just for existing.
   Extensions are now tried first, with the bare name kept only as a
   last-resort fallback.

Verified three ways: unit tests for both bugs; a from-scratch reproduction
against real git replaying the user's exact scenario; and a throwaway `.cmd`
shim actually executed through real `cmd.exe` with a space-containing path,
confirming the argument survives as one piece and the `.cmd` is chosen over
the extensionless script.

---

## Bugs & gaps — all fixed

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | **Critical** | Two tickets could implement into the same working tree; one run's edits landed on the other's branch. The git lock covered only branch setup, so a second approve while the first run was still exploring (tree still clean) moved `HEAD` out from under it. | Each run gets its own worktree and branch ([lib/worktrees.js](lib/worktrees.js), [approveTask](lib/claudeRunner.js)). Overlapping runs are now safe by construction rather than by a lock that couldn't hold long enough. The clean-tree gate is gone — it blocked legitimate parallel work and never prevented the race it targeted. |
| 2 | **High** | `git pull --ff-only` made repos with no remote (or a diverged/upstream-less base) impossible to implement, even though project selection accepted them. | Replaced with `git fetch` + branching from `origin/<base>` when reachable, else the local base. A fetch touches no working tree; failure degrades to the local branch with a logged note instead of aborting ([resolveStartPoint](lib/worktrees.js)). |
| 3 | **High** | A run killed mid-flight vanished, leaving orphaned edits nobody could find. Only `awaiting-approval`/`paused` were persisted. | Every non-terminal task is persisted, including while running; the session id is written as soon as it appears. On startup, interrupted runs rehydrate as **Paused** so Continue resumes the same conversation ([hydratePending](lib/claudeRunner.js)). |
| 4 | **High** | No shutdown handler — Ctrl+C left `claude` processes still editing files. | `SIGINT`/`SIGTERM` kill every child and park its run ([gracefulExit](server.js), [shutdown](lib/claudeRunner.js)). |
| 5 | **High** | Iterating overwrote the saved diff, losing the original. | `store.save` merges and appends a per-run `diffSnapshot` to a `diffs` array; the history view lists each run separately. Fields the caller omits keep their prior value, and the original `startedAt` survives ([lib/store.js](lib/store.js)). |
| 6 | **High** | `git diff` showed unstaged edits only — staged files silently vanished, and the diff went blank once you committed (exactly when you'd iterate). | Diffed against the merge-base with the base branch ([getDiff](lib/claudeRunner.js)). Verified end-to-end: the diff survives staging *and* committing, and still never mutates the index. |
| 7 | **Medium** | Pausing between Approve and the first implement turn resumed the read-only *planning* session with write tools and a "continue where you left off" prompt. | Approving clears the plan session id; `resumeTask` starts the implementation properly when there's no session to continue. |
| 8 | **Medium** | `postImplement` overwrote Claude's own error text with a bare exit code. | Guarded with `task.error \|\|`, matching `postPlan`. |
| 9 | **Medium** | A Jira error left `tickets` holding an error object, so every later `renderBoard()` threw `tickets.map is not a function` — silently breaking history/live-task rendering and the search box. | Only ever assign an array; the failure renders as a banner and the board still shows parked tasks and past runs ([public/app.js](public/app.js)). |
| 10 | **Medium** | History's "Open in VS Code" opened the currently configured project, not the run's. | New `/api/implementations/:id/open-vscode` resolves the record's own worktree/repo. |
| 11 | **Medium** | Stopped and failed runs were never recorded, so their real changes became invisible. | Every terminal implementation run is saved with its status; the board files them under Implementing with a Stopped/Error pill, and their diff is shown. Planning-phase runs correctly record nothing. |
| 12 | **Medium** | `--allowedTools` was hardcoded to npm, so Claude could not verify anything in a non-Node repo. | Per-project lint/test commands in Settings, granted as `Bash(...)` patterns and named in the prompt. Values that could split the tool list or chain a command are rejected ([bashPattern](lib/claudeRunner.js)). Empty config keeps the npm defaults. |
| 13 | **Medium** | `htmlToText` destroyed link URLs, code-block fencing, and table structure. | Links keep their destination, code blocks stay fenced, table cells stay separated, images are named, and numeric/hex entities decode. Decoding runs after tag stripping so an encoded tag can't reappear. |
| 14 | **Medium** | Comments, attachments, parent and linked issues were never fetched — the acceptance criteria are usually in the comments. | `getTicket` now returns all of them, and they're included in both prompts ([ticketSection](lib/claudeRunner.js)). A comment-fetch failure degrades the ticket instead of failing it. |
| 15 | **Medium** | The whole log rode inside every SSE update (O(n²) traffic) and grew unbounded. | Protocol is now one snapshot on connect, then `{kind:'log'}` per line and log-free `{kind:'update'}` for state. Log is capped server- and client-side. Verified on the wire: no update carries a log. Also adds a heartbeat and proper listener cleanup. |
| 16 | **Medium** | Large diffs froze the tab — one table row per line, no limits. | Files render lazily on expand, capped at 600 lines behind a "Show all N lines" button; many-file diffs start collapsed. |
| 17 | **Medium** | `execFileSync` in `projects.js` blocked the event loop, stalling live streams during a cold `git ls-files`. | Fully async, with concurrent lookups sharing one in-flight git call. |
| 18 | **Medium** | Approve silently switched your checkout to the base branch and left you on a new one. | Never touches your checkout. Verified: your branch *and* your uncommitted work are unchanged after two parallel runs. |
| 19 | **Low** | `escapeHtml` didn't escape quotes but was used inside attributes. | Escapes quotes too, and `<option>` elements are built with DOM APIs instead of interpolated HTML. |
| 20 | **Low** | A non-loopback `HOST` was accepted by the listener but 403'd by the Host allowlist, so the documented escape hatch produced a broken server. | The allowlist follows the actual bind, with a loud startup warning about the exposure. `.env.example` and README say what really happens. |
| 21 | **Low** | `repoPath` was saved without validation; a typo surfaced later as an opaque git error. | Validated as an existing git repository on save, with a specific message for missing / not-a-folder / not-a-repo. |
| 22 | **Low** | Turn budgets were source constants; the README told you to edit the file. | Read from settings with validated fallbacks (0, negative, and non-numeric all fall back to the defaults). No UI, as agreed. |
| 23 | **Low** | All three JSON stores wrote non-atomically — a crash mid-write silently lost settings or a record. | Shared temp-file + rename helper ([lib/jsonFile.js](lib/jsonFile.js)). A failed serialise leaves the previous contents intact. |
| 24 | **Low** | The settings cache never invalidated, so hand-editing `data/settings.json` did nothing until restart. | Reloads on mtime change. |
| 25 | **Low** | Missing guards: `data.issues.map` could throw; `cancelTask` could rewrite a finished run; `express.json` had no limit and returned HTML on a bad body. | All guarded — non-array Jira responses tolerated, `cancelTask` has a terminal guard, 2 MB limit with JSON error responses, plus a JSON catch-all error handler. |
| 26 | **Low** | `spawn('claude')` couldn't run a `.cmd` shim, so npm-global installs failed with ENOENT on every run. | PATH resolution prefers a directly-spawnable binary (**the existing working path is unchanged**); a `.cmd`/`.bat` shim is driven through `cmd.exe` with a hand-built, unit-tested command line and the prompt on stdin ([lib/claudeBin.js](lib/claudeBin.js)). |
| 27 | **Cosmetic** | `renderMarkdown` output was injected into `<p>` elements; model labels were stale. | Those containers are `<div>`s; labels updated to Opus 5 / Sonnet 5 / Haiku 4.5 / Fable 5. |
| 28 | **Gap** | No coverage for `server.js`, `settings.js`, `store.js`, `pendingStore.js`, `projects.js`, `usage.js`. | New suites for worktrees, store/atomic writes, settings, projects, and claudeBin, plus regression tests for items 1–8, 11, 12 and 25. |

### Verification beyond the unit tests

- **Worktrees against real git on Windows** — 27 checks: parallel branches, your
  checkout untouched, scoped diffs, diff surviving stage *and* commit, no index
  mutation, `node_modules` junction, remote-less repo, dirty-refusal vs force
  removal, idempotent re-add, merged detection.
- **SSE on the wire** — 16 checks: message kinds and ordering, no log inside
  updates, approve reporting its worktree, graceful shutdown parking live runs.
- **Live API** — Host/Origin guards, repo validation, unsafe-command rejection,
  malformed-body handling, and a real Jira fetch (5 tickets, enriched payload).

### Two things to know

- A branch checked out in a worktree can't be checked out again in your main
  clone — review it in the worktree, or remove the worktree first.
- Worktrees share `node_modules` with your main checkout via a junction. A run
  that changes `package.json` or a lockfile says so in its log; install inside
  that worktree before trusting its test results.

The `.cmd`-shim path in item 26 is built and unit-tested but not exercised
against a real npm-global install — this machine has a native `claude.exe`, which
takes the unchanged direct-spawn path.

---

## Feature suggestions

Still open, ordered by value. Items 1, 5 and 11 shifted now that worktrees and
per-project commands exist.

| # | Feature | Why it matters | Effort |
|---|---|---|---|
| 1 | **Ticket queue** | Now unblocked: worktrees make parallel runs safe, so approve five plans and walk away. Needs a concurrency cap and a queue view. | Medium |
| 2 | **Revise the plan instead of just approve/cancel** | The review gate is still binary. If a plan is 80% right you either accept the bad 20% or throw away the planning session. A feedback box that re-runs the plan phase with `--resume` closes the loop where it's cheapest — before any code is written. | Low |
| 3 | **Commit + PR from the dashboard** | The last mile is still a terminal trip. A Commit button with a generated conventional-commit message (editable, showing exactly what will be staged), then Push & open PR via `gh pr create` prefilled with the ticket key and summary. | Medium |
| 4 | **Inline diff comments → iterate** | The review surface exists. Let the user click a diff line, leave a comment, and send them all as one structured payload to `iterateTask` — a far better input than a freeform textarea. | Medium |
| 5 | **Run the verification commands independently** | The commands are configured and granted, but only Claude decides to run them. Run them after each run and show a pass/fail badge. A green diff that doesn't compile is the worst outcome this tool can produce. | Low |
| 6 | **Cost & token stats per run** | The `result` event already carries `total_cost_usd`, `duration_ms` and token counts, and they're still discarded. Capture and display them for per-ticket cost and model comparison. | Low |
| 7 | **Jira write-back** | Transition to *In Progress* on approve and *In Review* on finish, and comment with the branch and summary. Make each toggleable — teams differ on bot noise. | Medium |
| 8 | **Approve from Telegram** | Telegram is already outbound-only. An inline Approve/Reject keyboard with long-polled `getUpdates` (no webhook, no public endpoint) lets you unblock a plan from your phone. | Medium |
| 9 | **A real Runs page** | Failed and stopped runs are now recorded, but the board can only show the newest per ticket. One filterable list of every run — with branch, worktree, cost and diff — is the natural home. | Medium |
| 10 | **Editable prompt templates + per-project presets** | Expose the plan/implement prompts with variable interpolation, save per-project reference-file sets, and auto-inject the repo's `CLAUDE.md`. This is what makes output match a given codebase. | Low |
| 11 | **Jira-project → repo mapping** | Derive the repo from the ticket key (`WEB-*` → web repo) instead of one global `repoPath`, so you can't draft a plan against the wrong codebase. | Low |
| 12 | **Auto-install dependencies per worktree** | Optional setup command for worktrees whose ticket changes dependencies, removing the shared-`node_modules` caveat. | Low |
