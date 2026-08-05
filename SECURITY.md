# Security Policy

Graft runs Claude Code with write access to whatever repository you point it
at, and the dashboard itself has **no authentication** — it's designed to run
on `localhost`, for you alone.

## Scope

Things worth a security report:

- A way the dashboard could be reached, driven, or have data extracted from
  it by someone other than the person running it (e.g. from another process
  on the same machine, or over the network despite the loopback default).
- A way a run could write outside its own worktree, or affect a different
  ticket's worktree or your main checkout.
- A way the `--allowedTools` allowlist in `lib/claudeRunner.js` could be
  bypassed to run `git commit` / `git push`, or an arbitrary shell command
  outside the verification-commands mechanism.
- Anything in `lib/jira.js`, `lib/settings.js`, or `lib/telegram.js` that
  could leak a stored credential (Jira token, Telegram bot token) beyond its
  intended use.

**Not** in scope: the fact that `HOST` *can* be set to a non-loopback address
(that's documented, deliberate, and the server warns loudly on startup), or
that the tool has no login of its own (also deliberate — see the README's
"Important limitations, on purpose" section).

## Reporting

Please **don't** open a public issue for anything above. Instead, email
**mazeen99@outlook.com** with what you found and, if you have one, how to
reproduce it. I'll acknowledge within a few days.

If it's a lower-severity hardening idea rather than an exploitable issue,
a regular GitHub issue is fine.
