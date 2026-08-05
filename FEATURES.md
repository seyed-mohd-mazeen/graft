# Recommended Features

Curated from a full feature review of Graft — these three are the
highest value-to-effort picks and a good starting set before tackling the
larger backlog.

## 1. Board search & filter

**What:** A search/filter bar on the Board page — filter by ticket key,
summary text, type, and priority.

**Why:** There's currently no way to narrow the board down; with more than a
handful of tickets (or once history accumulates in the Done column) finding a
specific one means scrolling and scanning. This is also the fix for the
existing gap where Jira's ticket fetch is capped at 50 results with no
pagination — a filter makes that cap far less painful even before pagination
is added.

**Effort:** Low. Pure front-end change in [app.js](public/app.js) — filter the
in-memory `tickets`/`activeTasks`/`implByKey` keys before rendering columns,
plus a small input control in [index.html](public/index.html).

## 2. Desktop notifications for approval / done

**What:** A browser/OS notification (via the Notifications API) fired when a
task reaches `awaiting-approval` or a terminal state (`done`, `error`,
`stopped`).

**Why:** This is the single biggest quality-of-life gap for long-running
tasks. Right now you have to keep the tab open and watch the progress view —
tab away for even a few minutes and you'll miss the moment a plan needs your
approval, or return to a run that finished 20 minutes ago. A notification
lets you start a ticket and go do something else.

**Effort:** Low–medium. Request `Notification` permission once (e.g. from
Settings), then fire a notification from the existing SSE `onmessage` handler
in [app.js](public/app.js) whenever a task's status crosses into
`awaiting-approval` or a terminal state.

## 3. Auto-comment on Jira when a run finishes

**What:** When an implementation finishes, post a comment back to the Jira
ticket with the branch name and Claude's summary (using the Jira REST API's
add-comment endpoint).

**Why:** High value if your team lives in Jira for status/reviews — it closes
the loop without requiring anyone to open this dashboard, and gives
reviewers/PMs visibility into what happened and where, straight from the
ticket they're already watching.

**Effort:** Medium. Add an `addComment(key, body)` call to
[lib/jira.js](lib/jira.js), invoke it from `finalizeTask` in
[lib/claudeRunner.js](lib/claudeRunner.js) when a run reaches `done`, and add
an opt-out toggle in Settings for anyone who doesn't want Jira noise on every
run.

---

Want any of these spec'd out further or implemented next?
