const fs = require('fs');
const path = require('path');

// Locating the `claude` CLI and invoking it correctly on every platform.
//
// `spawn('claude', ...)` without a shell works only when the OS can execute the
// file directly. On Windows, CreateProcess resolves `.exe`/`.com` but cannot run
// a `.cmd`/`.bat` shim at all — and an npm-global install of Claude Code is
// exactly such a shim. That is the same trap the VS Code launcher in
// claudeRunner already works around with `shell: true`; we cannot copy that fix
// here because `shell: true` makes Node join argv without quoting, and our argv
// carries a multi-line prompt full of quotes and shell metacharacters.
//
// So: prefer a directly-executable binary (today's working path, byte-for-byte
// unchanged), and fall back to driving the shim through cmd.exe with a command
// line we build and quote ourselves.

// Quote one argument for the Windows command-line parser (the MS C runtime
// rules that CreateProcess consumers implement): wrap in quotes when the value
// contains whitespace or a cmd.exe metacharacter, double up the backslashes
// that precede a quote, and escape embedded quotes.
function quoteArg(arg) {
  const s = String(arg);
  if (s === '') return '""';
  if (!/[\s"^&|<>()%!]/.test(s)) return s;

  let out = '"';
  let slashes = 0;
  for (const ch of s) {
    if (ch === '\\') {
      slashes++;
      continue;
    }
    if (ch === '"') {
      out += '\\'.repeat(slashes * 2 + 1) + '"';
      slashes = 0;
      continue;
    }
    out += '\\'.repeat(slashes) + ch;
    slashes = 0;
  }
  // Trailing backslashes would otherwise escape the closing quote.
  return `${out}${'\\'.repeat(slashes * 2)}"`;
}

// Build the string that follows `cmd.exe /d /s /c`.
//
// `/s` makes cmd.exe strip exactly the first and last character of the rest of
// the line when both are quotes, and otherwise leave the command alone — so
// wrapping the whole command in one extra pair of quotes is what stops cmd from
// re-parsing (and mangling) the inner quoting.
function buildWindowsCommandLine(file, args) {
  // The executable is always quoted, not just when it contains a space: that
  // keeps the outer wrapping unambiguous and matches the form cmd.exe documents.
  const parts = [`"${String(file).replace(/"/g, '')}"`, ...args.map(quoteArg)];
  return `"${parts.join(' ')}"`;
}

// First existing candidate for `name` on PATH. `exists` is injectable so the
// resolution logic can be unit-tested without touching the real filesystem.
function findExecutable(name, { platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  const isWin = platform === 'win32';
  // Join/resolve with the path style of the platform being checked, not
  // whatever the host OS happens to be. `path.join`/`path.resolve` (the
  // unqualified, host-dependent module) always use the *actual* runtime OS's
  // separator no matter what `platform` says — so simulating Linux from a
  // Windows caller (exactly what the cross-platform unit tests do) silently
  // joined paths with backslashes and every `exists` lookup missed.
  const p = isWin ? path.win32 : path.posix;

  // PATHEXT is conventionally uppercase while the files on disk are usually
  // lowercase. A real Windows filesystem is case-insensitive so either spelling
  // resolves, but don't rely on that — try both.
  const exts = isWin
    ? [
        ...new Set(
          (env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
            .split(';')
            .filter(Boolean)
            .flatMap((e) => [e, e.toLowerCase(), e.toUpperCase()]),
        ),
      ]
    : [''];

  // Extensions before the bare name on Windows. A directory can (and, for VS
  // Code specifically, always does) contain both a `.cmd` shim AND a same-named
  // extensionless POSIX shebang script for git-bash/WSL use — `where.exe` lists
  // both, but neither cmd.exe's own command resolution nor CreateProcess's
  // PATHEXT search will ever actually launch the extensionless one. Trying it
  // first found and "resolved" that unrunnable script instead of the real
  // `.cmd`. The bare name is kept as a last-resort fallback (e.g. a renamed
  // .exe with no extension), just no longer preferred over a real one.
  const candidatesFor = (base) => (isWin ? [...exts.map((e) => base + e), base] : [base]);

  if (name.includes('/') || name.includes('\\')) {
    return candidatesFor(p.resolve(name)).find((c) => exists(c)) || null;
  }

  const sep = isWin ? ';' : ':';
  for (const dir of (env.PATH || env.Path || '').split(sep)) {
    if (!dir) continue;
    const hit = candidatesFor(p.join(dir, name)).find((c) => exists(c));
    if (hit) return hit;
  }
  return null;
}

// How to spawn any named CLI on this platform:
//   { file, prefixArgs, verbatim, promptOnStdin, resolvedPath, note }
//
// Generic version of the claude-specific resolution below — used for any CLI
// that might be a directly-executable binary or a .cmd/.bat shim (an
// npm-global install being the common case of the latter). `promptOnStdin` is
// always false here; only resolveClaudeCommand's multi-line-prompt handling
// needs it.
//
// This deliberately never uses `spawn(..., { shell: true })` as its answer:
// that resolves a shim, but Node does not quote array-form arguments for the
// shell it hands them to — a path containing a space (as this app's own
// worktrees always will, since it places them next to the repo) silently
// splits into multiple arguments. `spawnArgsFor` below carries the same
// hand-built, tested quoting used for `claude` instead.
function resolveCommand(name, { platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  const direct = { file: name, prefixArgs: [], verbatim: false, promptOnStdin: false, resolvedPath: null, note: null };

  if (platform !== 'win32') {
    // POSIX spawn already resolves a bare name against PATH itself, so `file`
    // stays the plain name either way — this lookup changes no spawn behaviour.
    // It exists only so a missing CLI is caught here, with a clear note, by
    // whatever calls this before it's actually needed (see lib/doctor.js),
    // instead of surfacing as a bare ENOENT with no context.
    const resolved = findExecutable(name, { platform, env, exists });
    if (!resolved) return { ...direct, note: `Could not find '${name}' on PATH.` };
    return { ...direct, resolvedPath: resolved };
  }

  const resolved = findExecutable(name, { platform, env, exists });
  if (!resolved) {
    // Nothing found: keep the plain name so the spawn produces the familiar
    // ENOENT, which is a clearer signal than anything we could invent.
    return { ...direct, note: `Could not find '${name}' on PATH.` };
  }

  const ext = path.extname(resolved).toLowerCase();
  if (ext === '.exe' || ext === '.com') {
    return { ...direct, file: resolved, resolvedPath: resolved };
  }

  return {
    file: env.ComSpec || 'cmd.exe',
    prefixArgs: ['/d', '/s', '/c'],
    verbatim: true,
    promptOnStdin: false,
    resolvedPath: resolved,
    note: `Using the ${ext} shim at ${resolved} via cmd.exe.`,
  };
}

// promptOnStdin is the important addition here versus resolveCommand(). A
// directly-spawnable binary takes the prompt in argv exactly as before. A
// cmd.exe shim cannot: there is no reliable way to embed a multi-line prompt
// containing quotes and `%` in a cmd.exe command line, so on that path the
// prompt goes down stdin instead (`claude -p` with `--input-format text`
// reads it from there).
function resolveClaudeCommand({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  const name = env.CLAUDE_CLI_PATH || 'claude';
  const resolved = resolveCommand(name, { platform, env, exists });
  if (!resolved.verbatim) return resolved;
  const ext = path.extname(resolved.resolvedPath).toLowerCase();
  return {
    ...resolved,
    promptOnStdin: true,
    note: `Using the ${ext} shim at ${resolved.resolvedPath} via cmd.exe; the prompt is sent on stdin.`,
  };
}

// Final { file, args, options } for child_process.spawn, given the CLI args.
function spawnArgsFor(cliArgs, resolution) {
  if (!resolution.verbatim) {
    return { file: resolution.file, args: [...resolution.prefixArgs, ...cliArgs], options: {} };
  }
  const commandLine = buildWindowsCommandLine(resolution.resolvedPath, cliArgs);
  return {
    file: resolution.file,
    args: [...resolution.prefixArgs, commandLine],
    options: { windowsVerbatimArguments: true },
  };
}

module.exports = { quoteArg, buildWindowsCommandLine, findExecutable, resolveCommand, resolveClaudeCommand, spawnArgsFor };
