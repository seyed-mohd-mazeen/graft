import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const worktrees = require('../lib/worktrees.js');

// A scripted `exec` matching claudeRunner's non-throwing runner:
// (cmd, args, opts) => {code, stdout, stderr}. `routes` maps a matcher to a
// result so each test states only the git behaviour it cares about.
function fakeExec(routes = [], calls = []) {
  return async (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts && opts.cwd });
    for (const [match, result] of routes) {
      if (match(args)) return { code: 0, stdout: '', stderr: '', ...result };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
}

const sub = (name) => (args) => args[0] === name;
const has = (...parts) => (args) => parts.every((p) => args.includes(p));

test('pathFor puts each ticket in its own directory beside the repo', () => {
  const repo = path.resolve('/projects/my-repo');
  assert.equal(
    worktrees.pathFor(repo, 'ABC-123'),
    path.join(path.dirname(repo), '.ticket-runner-worktrees', 'my-repo', 'ABC-123')
  );
});

test('a ticket key cannot escape the worktree root', () => {
  // A key is normally Jira-shaped, but a path segment built from unvalidated
  // input is exactly how a traversal gets in.
  assert.equal(worktrees.safeSegment('ABC-123'), 'ABC-123', 'normal keys are untouched');
  assert.equal(worktrees.safeSegment('../../etc'), 'etc');
  assert.equal(worktrees.safeSegment('a/b'), 'a-b');
  assert.equal(worktrees.safeSegment('a\\b'), 'a-b');
  assert.equal(worktrees.safeSegment('..'), 'ticket');
  assert.equal(worktrees.safeSegment(''), 'ticket');

  const root = worktrees.rootFor(path.resolve('/projects/repo'));
  for (const evil of ['../../../escape', 'a/../../b', '..\\..\\win']) {
    const p = worktrees.pathFor(path.resolve('/projects/repo'), evil);
    assert.equal(path.dirname(p), root, 'always lands directly under the worktree root');
    assert.ok(!p.includes('..'), 'no traversal survives');
  }
});

test('isWorktreeDir recognises our own checkouts', () => {
  assert.ok(worktrees.isWorktreeDir('/x/.ticket-runner-worktrees/repo/ABC-1'));
  assert.ok(!worktrees.isWorktreeDir('/x/repo'));
});

test('resolveStartPoint prefers origin/base when a remote exists', async () => {
  const calls = [];
  const exec = fakeExec(
    [
      [sub('remote'), { code: 0, stdout: 'git@example.com:x/y.git' }],
      [sub('fetch'), { code: 0 }],
      [has('refs/remotes/origin/main'), { code: 0 }],
    ],
    calls
  );
  const { startPoint, notes } = await worktrees.resolveStartPoint(exec, '/repo', 'main');
  assert.equal(startPoint, 'origin/main');
  assert.deepEqual(notes, []);
  assert.ok(calls.some((c) => c.args[0] === 'fetch'));
  // A fetch touches no working tree; the old code ran `pull --ff-only`, which did.
  assert.ok(!calls.some((c) => c.args[0] === 'pull'));
  assert.ok(!calls.some((c) => c.args[0] === 'checkout'));
});

test('a repo with no remote still resolves a start point', async () => {
  // `git pull --ff-only` made this configuration impossible to implement at all,
  // even though project selection happily accepted it.
  const exec = fakeExec([
    [sub('remote'), { code: 128, stderr: 'no such remote' }],
    [has('refs/heads/main'), { code: 0 }],
  ]);
  const { startPoint, notes } = await worktrees.resolveStartPoint(exec, '/repo', 'main');
  assert.equal(startPoint, 'main');
  assert.match(notes.join(' '), /No 'origin' remote/);
});

test('a failed fetch degrades to the local base branch instead of failing', async () => {
  const exec = fakeExec([
    [sub('remote'), { code: 0, stdout: 'origin-url' }],
    [sub('fetch'), { code: 1, stderr: 'network down' }],
    [has('refs/heads/develop'), { code: 0 }],
  ]);
  const { startPoint, notes } = await worktrees.resolveStartPoint(exec, '/repo', 'develop');
  assert.equal(startPoint, 'develop');
  assert.match(notes.join(' '), /Could not fetch/);
});

test('a base branch that exists nowhere is a clear error', async () => {
  const exec = fakeExec([
    [sub('remote'), { code: 1 }],
    [sub('rev-parse'), { code: 1 }],
  ]);
  await assert.rejects(() => worktrees.resolveStartPoint(exec, '/repo', 'nope'), /does not exist locally or on origin/);
});

test('add creates a branch from the resolved start point', async () => {
  const calls = [];
  const exec = fakeExec(
    [
      [sub('worktree'), { code: 0, stdout: '' }],
      [sub('remote'), { code: 1 }],
      [has('refs/heads/feature/me/ABC-1'), { code: 1 }], // branch does not exist yet
      [has('refs/heads/main'), { code: 0 }],
    ],
    calls
  );
  const result = await worktrees.add(exec, {
    repoPath: process.cwd(),
    baseBranch: 'main',
    branch: 'feature/me/ABC-1',
    ticketKey: 'ABC-1',
  });
  assert.ok(result.created);
  assert.equal(result.branch, 'feature/me/ABC-1');
  const addCall = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'add');
  assert.ok(addCall, 'a worktree was added');
  assert.deepEqual(addCall.args.slice(0, 3), ['worktree', 'add', '-b']);
  assert.equal(addCall.args[addCall.args.length - 1], 'main', 'branched from the resolved start point');
});

test('add reuses an existing worktree so a resumed run continues in place', async () => {
  const dest = worktrees.pathFor(process.cwd(), 'ABC-9');
  const exec = fakeExec([
    [sub('worktree'), { code: 0, stdout: `worktree ${dest}\nbranch refs/heads/feature/me/ABC-9\n` }],
  ]);
  const result = await worktrees.add(exec, {
    repoPath: process.cwd(),
    baseBranch: 'main',
    branch: 'feature/me/ABC-9',
    ticketKey: 'ABC-9',
  });
  assert.equal(result.created, false);
  assert.equal(result.branch, 'feature/me/ABC-9');
  assert.match(result.notes.join(' '), /Reusing existing worktree/);
});

test('add refuses to double-checkout a branch already sitting in the main repo, with a clear fix', async () => {
  // The exact bug this guards against: a ticket implemented before worktrees
  // existed leaves its branch checked out directly in the user's main repo.
  // `git worktree add` on that branch elsewhere fails with raw stderr — this
  // must be caught up front with an actionable message instead.
  const repo = process.cwd();
  const branch = 'feature/me/ABC-5';
  const calls = [];
  const exec = fakeExec(
    [
      [
        sub('worktree'),
        {
          code: 0,
          stdout: `worktree ${repo}\nHEAD abc\nbranch refs/heads/${branch}\n\n` + `worktree /elsewhere/ABC-9\nHEAD def\nbranch refs/heads/feature/me/ABC-9\n\n`,
        },
      ],
      [has(`refs/heads/${branch}`), { code: 0 }], // branch exists
      [sub('status'), { code: 0, stdout: '' }], // main repo is clean
    ],
    calls
  );

  await assert.rejects(
    () => worktrees.add(exec, { repoPath: repo, baseBranch: 'main', branch, ticketKey: 'ABC-5' }),
    (err) => {
      assert.match(err.message, /already checked out in your main repository/);
      assert.ok(err.message.includes(repo), 'names the exact path');
      assert.match(err.message, /git checkout main/);
      return true;
    }
  );
  assert.ok(
    !calls.some((c) => c.args[0] === 'worktree' && c.args[1] === 'add'),
    'never attempts the doomed git worktree add'
  );
});

test('the main-repo conflict message flags uncommitted changes rather than a bare git-checkout instruction', async () => {
  const repo = process.cwd();
  const branch = 'feature/me/ABC-6';
  const exec = fakeExec([
    [sub('worktree'), { code: 0, stdout: `worktree ${repo}\nbranch refs/heads/${branch}\n` }],
    [has(`refs/heads/${branch}`), { code: 0 }],
    [sub('status'), { code: 0, stdout: ' M dirty-file.txt\n' }],
  ]);

  await assert.rejects(
    () => worktrees.add(exec, { repoPath: repo, baseBranch: 'main', branch, ticketKey: 'ABC-6' }),
    (err) => {
      assert.match(err.message, /uncommitted changes/);
      return true;
    }
  );
});

test('a branch already checked out in some OTHER worktree (not the main repo) gets its own message', async () => {
  const repo = process.cwd();
  const branch = 'feature/me/ABC-7';
  const strayPath = '/some/other/worktree/ABC-7-old';
  const exec = fakeExec([
    [
      sub('worktree'),
      { code: 0, stdout: `worktree ${repo}\nbranch refs/heads/main\n\n` + `worktree ${strayPath}\nbranch refs/heads/${branch}\n\n` },
    ],
    [has(`refs/heads/${branch}`), { code: 0 }],
    [sub('status'), { code: 0, stdout: '' }],
  ]);

  await assert.rejects(
    () => worktrees.add(exec, { repoPath: repo, baseBranch: 'main', branch, ticketKey: 'ABC-7' }),
    (err) => {
      assert.match(err.message, /already checked out at/);
      assert.ok(!err.message.includes('main repository'), 'distinct wording from the main-repo case');
      assert.ok(err.message.includes(strayPath));
      return true;
    }
  );
});

test('list parses git worktree porcelain output', async () => {
  const exec = fakeExec([
    [
      sub('worktree'),
      {
        code: 0,
        stdout:
          'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n' +
          'worktree /repo/../.ticket-runner-worktrees/repo/ABC-1\nHEAD def\nbranch refs/heads/feature/me/ABC-1\n\n',
      },
    ],
  ]);
  const list = await worktrees.list(exec, '/repo');
  assert.equal(list.length, 2);
  assert.equal(list[0].branch, 'main');
  assert.equal(list[1].branch, 'feature/me/ABC-1');
});

test('remove refuses to discard uncommitted work unless forced', async () => {
  const dirty = fakeExec([[sub('status'), { code: 0, stdout: ' M src/app.js\n' }]]);
  const blocked = await worktrees.remove(dirty, { repoPath: '/repo', worktreePath: '/wt' });
  assert.equal(blocked.removed, false);
  assert.equal(blocked.reason, 'dirty');
  assert.match(blocked.error, /uncommitted changes/);

  const calls = [];
  const forced = fakeExec([[sub('status'), { code: 0, stdout: ' M src/app.js\n' }]], calls);
  const done = await worktrees.remove(forced, { repoPath: '/repo', worktreePath: '/wt', force: true });
  assert.equal(done.removed, true);
  const removeCall = calls.find((c) => c.args[1] === 'remove');
  assert.ok(removeCall.args.includes('--force'));
});

test('isMerged reports whether a branch has landed in the base', async () => {
  const merged = fakeExec([
    [has('refs/remotes/origin/main'), { code: 1 }],
    [has('refs/heads/main'), { code: 0 }],
    [sub('rev-parse'), { code: 0 }],
    [sub('merge-base'), { code: 0 }],
  ]);
  assert.equal(await worktrees.isMerged(merged, '/repo', 'feature/x', 'main'), true);

  const notMerged = fakeExec([
    [sub('rev-parse'), { code: 0 }],
    [sub('merge-base'), { code: 1 }],
  ]);
  assert.equal(await worktrees.isMerged(notMerged, '/repo', 'feature/x', 'main'), false);
  assert.equal(await worktrees.isMerged(notMerged, '/repo', null, 'main'), false);
});

test('dependenciesStale flags runs that changed a manifest or lockfile', () => {
  // node_modules is shared with the main checkout via a junction, so a run that
  // changes dependencies is testing against the wrong ones.
  assert.ok(worktrees.dependenciesStale(['M  package.json']));
  assert.ok(worktrees.dependenciesStale(['A  pnpm-lock.yaml']));
  assert.ok(worktrees.dependenciesStale(['M  packages/api/package.json']));
  assert.ok(!worktrees.dependenciesStale(['M  src/app.js', 'A  README.md']));
  assert.ok(!worktrees.dependenciesStale([]));
  assert.ok(!worktrees.dependenciesStale(undefined));
});
