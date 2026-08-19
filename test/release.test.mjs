import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const worktrees = require('../lib/worktrees.js');

// Same scripted-`exec` convention as test/worktrees.test.mjs.
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

test('releasePathFor puts each run in its own directory beside the repo, separate from ticket worktrees', () => {
  const repo = path.resolve('/projects/my-repo');
  assert.equal(
    worktrees.releasePathFor(repo, 'run-1'),
    path.join(path.dirname(repo), '.ticket-runner-release', 'my-repo', 'run-1')
  );
  assert.notEqual(worktrees.releaseRootFor(repo), worktrees.rootFor(repo));
});

test('isWorktreeDir also recognises release scratch dirs', () => {
  assert.ok(worktrees.isWorktreeDir('/x/.ticket-runner-release/repo/run-1'));
});

test('mergeBranch reports a clean merge with the new HEAD sha', async () => {
  const calls = [];
  const exec = fakeExec(
    [
      [sub('merge'), { code: 0 }],
      [has('rev-parse', 'HEAD'), { code: 0, stdout: 'abc123\n' }],
    ],
    calls
  );
  const result = await worktrees.mergeBranch(exec, '/scratch/run-1', 'origin/feature/x', 'Merge feature/x');
  assert.deepEqual(result, { merged: true, sha: 'abc123' });
  const mergeCall = calls.find((c) => c.args[0] === 'merge');
  assert.deepEqual(mergeCall.args, ['merge', '--no-ff', '-m', 'Merge feature/x', 'origin/feature/x']);
});

test('mergeBranch aborts and reports the conflicted files on a conflict', async () => {
  const calls = [];
  const exec = fakeExec(
    [
      [has('merge', '--abort'), { code: 0 }],
      [sub('merge'), { code: 1, stderr: 'CONFLICT (content): Merge conflict in a.txt' }],
      [has('diff', '--name-only', '--diff-filter=U'), { code: 0, stdout: 'a.txt\nb.txt\n' }],
    ],
    calls
  );
  const result = await worktrees.mergeBranch(exec, '/scratch/run-1', 'origin/feature/y', 'Merge feature/y');
  assert.deepEqual(result, { merged: false, files: ['a.txt', 'b.txt'] });
  assert.ok(
    calls.some((c) => c.args[0] === 'merge' && c.args.includes('--abort')),
    'aborts the merge so the worktree is left clean'
  );
});

test('mergeBranch surfaces a non-conflict failure too, instead of silently reporting no files', async () => {
  const exec = fakeExec([
    [has('merge', '--abort'), { code: 0 }],
    [sub('merge'), { code: 128, stderr: 'fatal: not something we can merge' }],
    [has('diff', '--name-only', '--diff-filter=U'), { code: 0, stdout: '' }],
  ]);
  const result = await worktrees.mergeBranch(exec, '/scratch/run-1', 'origin/feature/z', 'Merge feature/z');
  assert.equal(result.merged, false);
  assert.deepEqual(result.files, []);
  assert.match(result.error, /not something we can merge/);
});

test('pushBranch pushes HEAD to the destination branch by explicit refspec', async () => {
  const calls = [];
  const exec = fakeExec([[sub('push'), { code: 0 }]], calls);
  const result = await worktrees.pushBranch(exec, '/scratch/run-1', 'RELEASE-sprint42');
  assert.deepEqual(result, { pushed: true });
  const pushCall = calls.find((c) => c.args[0] === 'push');
  assert.deepEqual(pushCall.args, ['push', 'origin', 'HEAD:refs/heads/RELEASE-sprint42']);
});

test('pushBranch surfaces a protected-branch rejection verbatim', async () => {
  const exec = fakeExec([
    [sub('push'), { code: 1, stderr: 'remote: protected branch hook declined' }],
  ]);
  const result = await worktrees.pushBranch(exec, '/scratch/run-1', 'RELEASE-sprint42');
  assert.equal(result.pushed, false);
  assert.match(result.error, /protected branch hook declined/);
});

test('prepareReleaseWorktree resets an existing scratch worktree to origin when the destination branch exists remotely', async () => {
  const repo = process.cwd();
  const dest = worktrees.releasePathFor(repo, 'run-1');
  const calls = [];
  const exec = fakeExec(
    [
      [sub('fetch'), { code: 0 }],
      [has('refs/remotes/origin/RELEASE'), { code: 0 }],
      [sub('worktree'), { code: 0, stdout: `worktree ${dest}\nbranch refs/heads/RELEASE\n` }],
      [sub('reset'), { code: 0 }],
      [sub('clean'), { code: 0 }],
    ],
    calls
  );
  const result = await worktrees.prepareReleaseWorktree(exec, {
    repoPath: repo,
    destBranch: 'RELEASE',
    baseBranch: 'main',
    runId: 'run-1',
  });
  assert.equal(result.path, dest);
  assert.equal(result.createdFromBase, false);
  const resetCall = calls.find((c) => c.args[0] === 'reset');
  assert.deepEqual(resetCall.args, ['reset', '--hard', 'origin/RELEASE']);
  assert.equal(resetCall.cwd, dest, 'resets inside the scratch worktree, not the main repo');
});

test('prepareReleaseWorktree creates a brand-new destination branch from the base branch when it does not exist on origin yet', async () => {
  const repo = process.cwd();
  const calls = [];
  const exec = fakeExec(
    [
      [sub('fetch'), { code: 1 }], // nothing to fetch yet — branch is brand new
      [has('refs/remotes/origin/RELEASE-sprint42'), { code: 1 }],
      [sub('worktree'), { code: 0, stdout: '' }], // no existing worktrees registered
      [has('refs/heads/RELEASE-sprint42'), { code: 1 }], // no local branch either
      [has('refs/heads/main'), { code: 0 }],
      [has('remote', 'get-url'), { code: 0, stdout: 'git@example.com:x/y.git' }],
    ],
    calls
  );
  try {
    const result = await worktrees.prepareReleaseWorktree(exec, {
      repoPath: repo,
      destBranch: 'RELEASE-sprint42',
      baseBranch: 'main',
      runId: 'run-2',
    });
    assert.equal(result.createdFromBase, true);
    const addCall = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'add');
    assert.deepEqual(addCall.args.slice(0, 3), ['worktree', 'add', '-b']);
    assert.equal(addCall.args[addCall.args.length - 1], 'main', 'branched from the resolved base branch');
  } finally {
    // This path (unlike the "existing worktree" case above) actually creates
    // a directory on disk via mkdirSync, since exec is faked but fs is not.
    fs.rmSync(worktrees.releaseRootFor(repo), { recursive: true, force: true });
  }
});
