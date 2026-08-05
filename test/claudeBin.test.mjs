import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const claudeBin = require('../lib/claudeBin.js');

const { quoteArg, buildWindowsCommandLine, findExecutable, resolveCommand, resolveClaudeCommand, spawnArgsFor } = claudeBin;

test('quoteArg leaves simple tokens alone', () => {
  assert.equal(quoteArg('-p'), '-p');
  assert.equal(quoteArg('stream-json'), 'stream-json');
  assert.equal(quoteArg('Read,Write,Edit'), 'Read,Write,Edit');
});

test('quoteArg quotes values containing spaces or cmd metacharacters', () => {
  assert.equal(quoteArg('Bash(npm run lint*)'), '"Bash(npm run lint*)"');
  assert.equal(quoteArg('a b'), '"a b"');
  assert.equal(quoteArg('a&b'), '"a&b"');
  assert.equal(quoteArg(''), '""');
});

test('quoteArg escapes embedded quotes', () => {
  assert.equal(quoteArg('say "hi"'), '"say \\"hi\\""');
  assert.equal(quoteArg('a\\"b'), '"a\\\\\\"b"');
});

test('quoteArg doubles trailing backslashes when it quotes', () => {
  // Inside quotes a trailing backslash would escape the closing quote and
  // swallow it; unquoted it is an ordinary character and must be left alone.
  assert.equal(quoteArg('C:\\path with space\\'), '"C:\\path with space\\\\"');
  assert.equal(quoteArg('C:\\path\\'), 'C:\\path\\', 'no quoting needed, so no escaping applied');
});

test('buildWindowsCommandLine wraps the whole command for cmd.exe /s', () => {
  // cmd /s strips exactly the outer pair of quotes, leaving the inner quoting
  // intact for the target program to parse.
  assert.equal(
    buildWindowsCommandLine('C:\\bin\\claude.cmd', ['-p', '--max-turns', '30']),
    '""C:\\bin\\claude.cmd" -p --max-turns 30"'
  );
  // A path with spaces is the case that actually needs the inner quotes.
  assert.equal(
    buildWindowsCommandLine('C:\\Program Files\\c\\claude.cmd', ['-p']),
    '""C:\\Program Files\\c\\claude.cmd" -p"'
  );
});

test('findExecutable resolves through PATH and PATHEXT on Windows', () => {
  const present = new Set(['C:\\tools\\claude.exe']);
  const found = findExecutable('claude', {
    platform: 'win32',
    env: { PATH: 'C:\\nope;C:\\tools', PATHEXT: '.COM;.EXE;.CMD' },
    exists: (p) => present.has(p),
  });
  assert.equal(found, 'C:\\tools\\claude.exe');
});

test('findExecutable prefers a real Windows extension over a same-named extensionless file', () => {
  // VS Code's real install ships exactly this: an extensionless POSIX shebang
  // script (for git-bash/WSL) sitting next to `code.cmd` in the same directory.
  // `where.exe` lists both; neither cmd.exe's own resolution nor CreateProcess
  // will ever actually launch the extensionless one — but the bare name used
  // to be tried FIRST here, so it "won" simply for existing, and got treated
  // as a plain executable instead of the real, runnable .cmd shim.
  const present = new Set(['C:\\vscode\\bin\\code', 'C:\\vscode\\bin\\code.cmd']);
  const found = findExecutable('code', {
    platform: 'win32',
    env: { PATH: 'C:\\vscode\\bin', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
    exists: (p) => present.has(p),
  });
  // Not '...\\code' (the extensionless one) — some variant of '...\\code.cmd'.
  // Which case wins depends on PATHEXT-variant iteration order (immaterial —
  // a real filesystem is case-insensitive anyway); what matters is that it's
  // a `.cmd` match, found before the bare fallback is ever reached.
  assert.match(found, /code\.cmd$/i);
});

test('findExecutable still falls back to a bare name when no extensioned version exists', () => {
  const present = new Set(['C:\\tools\\weirdbinary']);
  const found = findExecutable('weirdbinary', {
    platform: 'win32',
    env: { PATH: 'C:\\tools', PATHEXT: '.EXE' },
    exists: (p) => present.has(p),
  });
  assert.equal(found, 'C:\\tools\\weirdbinary');
});

test('findExecutable returns null when nothing matches', () => {
  assert.equal(
    findExecutable('claude', {
      platform: 'win32',
      env: { PATH: 'C:\\nope', PATHEXT: '.EXE' },
      exists: () => false,
    }),
    null
  );
});

test('a native .exe is spawned directly with the prompt in argv', () => {
  // This is the path that already worked; it must stay byte-for-byte the same.
  const res = resolveClaudeCommand({
    platform: 'win32',
    env: { PATH: 'C:\\tools', PATHEXT: '.EXE' },
    exists: (p) => p === 'C:\\tools\\claude.exe',
  });
  assert.equal(res.promptOnStdin, false);
  assert.equal(res.verbatim, false);
  assert.equal(res.file, 'C:\\tools\\claude.exe');

  const { file, args, options } = spawnArgsFor(['-p', 'my prompt'], res);
  assert.equal(file, 'C:\\tools\\claude.exe');
  assert.deepEqual(args, ['-p', 'my prompt']);
  assert.deepEqual(options, {});
});

test('a .cmd shim is driven through cmd.exe with the prompt on stdin', () => {
  // CreateProcess cannot execute a batch file, so an npm-global install used to
  // fail with ENOENT on every run. A multi-line prompt cannot be embedded in a
  // cmd.exe command line safely, so it goes down stdin instead.
  const res = resolveClaudeCommand({
    platform: 'win32',
    env: { PATH: 'C:\\npm', PATHEXT: '.EXE;.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    exists: (p) => p === 'C:\\npm\\claude.cmd',
  });
  assert.equal(res.promptOnStdin, true);
  assert.equal(res.verbatim, true);
  assert.equal(res.file, 'C:\\Windows\\System32\\cmd.exe');
  assert.match(res.note, /\.cmd shim/);

  const { args, options } = spawnArgsFor(['-p', '--max-turns', '30'], res);
  assert.deepEqual(args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(args[3], '""C:\\npm\\claude.cmd" -p --max-turns 30"');
  assert.equal(options.windowsVerbatimArguments, true);
});

test('non-Windows platforms always spawn the bare name, found or not', () => {
  // Node's spawn() resolves a bare name against PATH itself on POSIX, so `file`
  // must stay the plain name regardless of what the lookup below finds — that
  // lookup exists only to produce a diagnostic (see lib/doctor.js), not to
  // change how the process is actually launched.
  const found = resolveClaudeCommand({ platform: 'linux', env: { PATH: '/usr/local/bin' }, exists: (p) => p === '/usr/local/bin/claude' });
  assert.equal(found.file, 'claude');
  assert.equal(found.promptOnStdin, false);
  assert.equal(found.verbatim, false);
  assert.equal(found.resolvedPath, '/usr/local/bin/claude');
  assert.equal(found.note, null);

  const missing = resolveClaudeCommand({ platform: 'linux', env: { PATH: '/usr/local/bin' }, exists: () => false });
  assert.equal(missing.file, 'claude', 'spawn behaviour is unchanged even when the CLI cannot be found');
  assert.equal(missing.resolvedPath, null);
  assert.match(missing.note, /Could not find 'claude' on PATH/);
});

test('a POSIX lookup never affects the args actually spawned with', () => {
  const resolution = resolveClaudeCommand({ platform: 'darwin', env: { PATH: '/opt/nope' }, exists: () => false });
  const { file, args, options } = spawnArgsFor(['-p', 'my prompt', '--max-turns', '30'], resolution);
  assert.equal(file, 'claude');
  assert.deepEqual(args, ['-p', 'my prompt', '--max-turns', '30']);
  assert.deepEqual(options, {});
});

test('CLAUDE_CLI_PATH overrides the looked-up binary', () => {
  const res = resolveClaudeCommand({
    platform: 'win32',
    env: { CLAUDE_CLI_PATH: 'D:\\custom\\claude.exe', PATH: '', PATHEXT: '.EXE' },
    exists: (p) => p === 'D:\\custom\\claude.exe',
  });
  assert.equal(res.file, 'D:\\custom\\claude.exe');
});

test('a missing binary keeps the plain name so the spawn reports ENOENT', () => {
  const res = resolveClaudeCommand({
    platform: 'win32',
    env: { PATH: 'C:\\nope', PATHEXT: '.EXE' },
    exists: () => false,
  });
  assert.equal(res.file, 'claude');
  assert.match(res.note, /Could not find/);
});

// resolveCommand() is the generic version resolveClaudeCommand builds on,
// used for any other CLI this app shells out to (currently: `code`, for
// "Open in VS Code" — see lib/claudeRunner.js's spawnVSCode). Unlike
// resolveClaudeCommand it never sets promptOnStdin, since only Claude's
// multi-line prompt needs that treatment.

test('resolveCommand: a directly-executable binary is used as-is, promptOnStdin always false', () => {
  const res = resolveCommand('code', {
    platform: 'win32',
    env: { PATH: 'C:\\tools', PATHEXT: '.EXE' },
    exists: (p) => p === 'C:\\tools\\code.exe',
  });
  assert.equal(res.file, 'C:\\tools\\code.exe');
  assert.equal(res.verbatim, false);
  assert.equal(res.promptOnStdin, false);
});

test('resolveCommand: a .cmd shim goes through cmd.exe, but never sets promptOnStdin', () => {
  // `code` on a real Windows install is almost always a .cmd shim (VS Code's
  // "Install code in PATH" creates one) — this is the common case in practice,
  // not the exotic one.
  const res = resolveCommand('code', {
    platform: 'win32',
    env: { PATH: 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\bin', PATHEXT: '.EXE;.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    exists: (p) => p === 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd',
  });
  assert.equal(res.verbatim, true);
  assert.equal(res.promptOnStdin, false, 'only claude needs stdin — code takes one plain positional argument');
  assert.match(res.note, /\.cmd shim/);
});

test('resolveCommand reports a clear note when the CLI cannot be found, on every platform', () => {
  const win = resolveCommand('code', { platform: 'win32', env: { PATH: 'C:\\nope', PATHEXT: '.EXE' }, exists: () => false });
  assert.match(win.note, /Could not find 'code' on PATH/);
  const posix = resolveCommand('code', { platform: 'darwin', env: { PATH: '/nope' }, exists: () => false });
  assert.match(posix.note, /Could not find 'code' on PATH/);
});

// The actual bug: a worktree path (which sits right next to the repo, and so
// inherits any space in the repo's own parent folder — e.g. a project checked
// out under "My Projects") was being opened via
// `spawn('code', [dir], { shell: true })`. Node does not quote array-form
// arguments for the shell it hands them to, so that path silently split into
// two arguments at the space, and `code` opened two bogus blank tabs instead
// of the real folder — see the resolveCommand()+spawnArgsFor() pipeline this
// exercises instead, now used by spawnVSCode.
test('a directory containing a space survives as ONE argument through resolveCommand + spawnArgsFor', () => {
  const dir = 'C:\\Users\\dev\\My Projects\\.ticket-runner-worktrees\\my-app\\PROJ-101';

  // Case 1: `code` is a .cmd shim (the realistic case on a real Windows install).
  const shimRes = resolveCommand('code', {
    platform: 'win32',
    env: { PATH: 'C:\\vscode\\bin', PATHEXT: '.EXE;.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    exists: (p) => p === 'C:\\vscode\\bin\\code.cmd',
  });
  const shimSpawn = spawnArgsFor([dir], shimRes);
  assert.equal(shimSpawn.args.length, 4, '/d, /s, /c, and exactly one command-line string — the path never became two argv entries');
  assert.ok(
    shimSpawn.args[3].includes('"C:\\Users\\dev\\My Projects\\.ticket-runner-worktrees\\my-app\\PROJ-101"'),
    'the whole path is quoted as one token, not split at the space'
  );
  assert.equal(shimSpawn.options.windowsVerbatimArguments, true);

  // Case 2: `code` resolves to a real .exe — spawned directly, no shell at all,
  // so Node passes argv elements straight through with no re-parsing to break.
  const exeRes = resolveCommand('code', {
    platform: 'win32',
    env: { PATH: 'C:\\vscode\\bin', PATHEXT: '.EXE' },
    exists: (p) => p === 'C:\\vscode\\bin\\code.exe',
  });
  const exeSpawn = spawnArgsFor([dir], exeRes);
  assert.deepEqual(exeSpawn.args, [dir], 'exactly one argument — the full path, untouched');
  assert.deepEqual(exeSpawn.options, {}, 'no shell involved for a real .exe');
});
