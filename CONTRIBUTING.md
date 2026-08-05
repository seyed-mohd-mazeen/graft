# Contributing to Graft

Thanks for taking a look — contributions, bug reports, and platform testing
are all welcome.

## Getting set up

```bash
git clone https://github.com/seyed-mohd-mazeen/ticket-runner.git
cd ticket-runner
npm install
cp .env.example .env   # fill in your own Jira + repo details, see README
npm test               # should pass before you change anything
npm start               # runs the dashboard at http://localhost:4177
```

You don't need write access to a real Jira project to work on most of the
codebase — `lib/` and `public/` are covered by unit tests that mock the
network boundary (see `test/*.test.mjs`). You only need real Jira/Claude
credentials to exercise the app end-to-end.

## Project layout

- `server.js` — Express app, all HTTP routes and SSE streaming.
- `lib/` — the actual logic: Jira client, Claude Code process management,
  git worktree handling, settings persistence, the setup-check ("doctor"),
  Telegram notifications. Each file has a matching `test/<name>.test.mjs`.
- `public/` — the frontend: plain HTML/CSS/JS, no build step, no framework.
  `app.js` is the whole client; `style.css` is the design system.
- `test/` — `node --test`, no other test runner or framework involved.

## Before opening a pull request

1. **Run the test suite:** `npm test`. All tests should pass — if you're
   fixing a bug, add a test that fails before your fix and passes after.
2. **Keep changes focused.** Small, single-purpose PRs are much easier to
   review than one that mixes a bug fix with a refactor.
3. **Match the existing style.** No linter is enforced yet, but look at the
   surrounding code — this project favors small pure functions in `lib/`,
   comments that explain *why* rather than *what*, and tests that name the
   actual bug they guard against (see `test/claudeBin.test.mjs` for examples).
4. **Don't add a build step.** The frontend is intentionally plain
   JS/HTML/CSS with no bundler — that's a deliberate choice, not an oversight.

## What's especially useful right now

- **Real macOS/Linux testing.** The code path for resolving the `claude` CLI
  on POSIX is unit-tested but has never been run against a real Mac or Linux
  install. If you hit a rough edge there, a bug report (or a fix) is very
  welcome.
- **Anything in `AUDIT.md` or `FEATURES.md`** that's still open.

## Reporting bugs

Open a GitHub issue with:
- What you expected vs. what happened.
- Your OS and Node version (`node -v`).
- What **Settings → Setup status** reports, if the dashboard even loads.

## Security

This tool runs Claude with write access to whatever repo you point it at, and
the dashboard itself has no authentication — it's designed to run on
`localhost` only. If you find a way it could be tricked into acting outside
its intended worktree, or a way the dashboard could be reached or driven by
someone other than the person running it, please open an issue (or, if it's
sensitive, contact the maintainer directly first) rather than a public PR with
exploit details.
