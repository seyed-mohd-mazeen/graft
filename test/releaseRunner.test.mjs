import { test } from 'node:test';
import assert from 'node:assert/strict';

import runner from '../lib/releaseRunner.js';

// Let the fire-and-forget runSequence() promise chain settle between awaits —
// same idiom as test/claudeRunner.test.mjs's settle().
const settle = () => new Promise((r) => setTimeout(r, 30));

// Non-throwing exec fake — never actually called directly by these tests
// since worktrees.* is faked below too, but startRelease/pushRelease still
// pass it through to a couple of exec() calls (the per-branch `git fetch`).
const cleanExecFile = async () => ({ code: 0, stdout: '', stderr: '' });

function makeFakeWorktrees({ mergeResults = {}, pushResult = { pushed: true } } = {}) {
  const calls = { merge: [], push: [], remove: [] };
  return {
    calls,
    fake: {
      prepareReleaseWorktree: async (_exec, { runId }) => ({
        path: `/fake/release/${runId}`,
        createdFromBase: false,
      }),
      mergeBranch: async (_exec, worktreePath, branchRef) => {
        calls.merge.push(branchRef);
        const branch = branchRef.replace(/^origin\//, '');
        return mergeResults[branch] || { merged: true, sha: `sha-${branch}` };
      },
      pushBranch: async (_exec, worktreePath, destBranch) => {
        calls.push.push({ worktreePath, destBranch });
        return pushResult;
      },
      remove: async (_exec, opts) => {
        calls.remove.push(opts);
        return { removed: true };
      },
    },
  };
}

function makeFakeReleaseStore() {
  const saved = [];
  return { saved, fake: { save: (rec) => saved.push(rec), get: () => null, list: () => [], remove: () => true } };
}

test('merges branches in order and lands on awaiting-push when at least one merges', async () => {
  const { fake: fakeWorktrees, calls } = makeFakeWorktrees();
  const { fake: fakeReleaseStore, saved } = makeFakeReleaseStore();
  runner.__setDeps({ execFile: cleanExecFile, worktrees: fakeWorktrees, releaseStore: fakeReleaseStore });

  const id = runner.startRelease({
    repoPath: '/fake/repo',
    destBranch: 'RELEASE',
    sourceBranches: ['feature/a', 'feature/b'],
  });
  await settle();

  const snap = runner.snapshot(runner.getJob(id));
  assert.equal(snap.status, 'awaiting-push');
  assert.deepEqual(calls.merge, ['origin/feature/a', 'origin/feature/b'], 'merged in the given order');
  assert.deepEqual(
    snap.results.map((r) => [r.branch, r.status]),
    [
      ['feature/a', 'merged'],
      ['feature/b', 'merged'],
    ]
  );
  assert.equal(saved.length, 0, 'not finalized to history until pushed or found to have nothing to push');
});

test('a conflicting branch is skipped without blocking the rest', async () => {
  const { fake: fakeWorktrees, calls } = makeFakeWorktrees({
    mergeResults: { 'feature/b': { merged: false, files: ['shared.js'] } },
  });
  const { fake: fakeReleaseStore } = makeFakeReleaseStore();
  runner.__setDeps({ execFile: cleanExecFile, worktrees: fakeWorktrees, releaseStore: fakeReleaseStore });

  const id = runner.startRelease({
    repoPath: '/fake/repo',
    destBranch: 'RELEASE',
    sourceBranches: ['feature/a', 'feature/b', 'feature/c'],
  });
  await settle();

  const snap = runner.snapshot(runner.getJob(id));
  assert.equal(snap.status, 'awaiting-push', 'still ready to push what did merge');
  assert.deepEqual(calls.merge, ['origin/feature/a', 'origin/feature/b', 'origin/feature/c'], 'c is still attempted');
  assert.deepEqual(
    snap.results.map((r) => [r.branch, r.status]),
    [
      ['feature/a', 'merged'],
      ['feature/b', 'conflict'],
      ['feature/c', 'merged'],
    ]
  );
  assert.deepEqual(snap.results[1].files, ['shared.js']);
  assert.ok(snap.log.some((l) => l.text.includes('feature/b') && l.text.includes('shared.js')));
});

test('status is no-changes and the run finalizes immediately when nothing merges cleanly', async () => {
  const { fake: fakeWorktrees } = makeFakeWorktrees({
    mergeResults: {
      'feature/a': { merged: false, files: ['x.txt'] },
      'feature/b': { merged: false, files: ['y.txt'] },
    },
  });
  const { fake: fakeReleaseStore, saved } = makeFakeReleaseStore();
  runner.__setDeps({ execFile: cleanExecFile, worktrees: fakeWorktrees, releaseStore: fakeReleaseStore });

  const id = runner.startRelease({
    repoPath: '/fake/repo',
    destBranch: 'RELEASE',
    sourceBranches: ['feature/a', 'feature/b'],
  });
  await settle();

  const snap = runner.snapshot(runner.getJob(id));
  assert.equal(snap.status, 'no-changes');
  assert.ok(snap.finishedAt, 'terminal — finalized without waiting for a push decision');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].status, 'no-changes');
});

test('pushRelease refuses to push before the merge phase has finished', async () => {
  const { fake: fakeWorktrees } = makeFakeWorktrees();
  const { fake: fakeReleaseStore } = makeFakeReleaseStore();
  runner.__setDeps({ execFile: cleanExecFile, worktrees: fakeWorktrees, releaseStore: fakeReleaseStore });

  const id = runner.startRelease({
    repoPath: '/fake/repo',
    destBranch: 'RELEASE',
    sourceBranches: ['feature/a'],
  });
  // Deliberately not awaiting settle() — the job is still 'running'.
  const result = await runner.pushRelease(id);
  assert.equal(result.error, 'This release run is not ready to push.');
  assert.equal(result.code, 409);
});

test('pushRelease pushes, records the last merged sha, and removes the scratch worktree', async () => {
  const { fake: fakeWorktrees, calls } = makeFakeWorktrees();
  const { fake: fakeReleaseStore, saved } = makeFakeReleaseStore();
  runner.__setDeps({ execFile: cleanExecFile, worktrees: fakeWorktrees, releaseStore: fakeReleaseStore });

  const id = runner.startRelease({
    repoPath: '/fake/repo',
    destBranch: 'RELEASE',
    sourceBranches: ['feature/a', 'feature/b'],
  });
  await settle();

  const { job, error } = await runner.pushRelease(id);
  assert.equal(error, undefined);
  assert.equal(job.status, 'done');
  assert.equal(job.pushedSha, 'sha-feature/b', 'the last branch merged, not the first');
  assert.equal(calls.push.length, 1);
  assert.equal(calls.push[0].destBranch, 'RELEASE');
  assert.equal(calls.remove.length, 1, 'the scratch worktree is cleaned up after a successful push');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].status, 'done');
});

test('a rejected push surfaces the error and leaves the job pushable again', async () => {
  const { fake: fakeWorktrees, calls } = makeFakeWorktrees({
    pushResult: { pushed: false, error: 'remote: protected branch hook declined' },
  });
  const { fake: fakeReleaseStore } = makeFakeReleaseStore();
  runner.__setDeps({ execFile: cleanExecFile, worktrees: fakeWorktrees, releaseStore: fakeReleaseStore });

  const id = runner.startRelease({
    repoPath: '/fake/repo',
    destBranch: 'RELEASE',
    sourceBranches: ['feature/a'],
  });
  await settle();

  const result = await runner.pushRelease(id);
  assert.match(result.error, /protected branch hook declined/);
  assert.equal(runner.snapshot(runner.getJob(id)).status, 'awaiting-push', 'not discarded — can retry after fixing permissions');
  assert.equal(calls.remove.length, 0, 'the worktree is kept so the merges do not need to be redone');
});

test('discardRelease removes the scratch worktree and marks the job cancelled without pushing', async () => {
  const { fake: fakeWorktrees, calls } = makeFakeWorktrees();
  const { fake: fakeReleaseStore, saved } = makeFakeReleaseStore();
  runner.__setDeps({ execFile: cleanExecFile, worktrees: fakeWorktrees, releaseStore: fakeReleaseStore });

  const id = runner.startRelease({
    repoPath: '/fake/repo',
    destBranch: 'RELEASE',
    sourceBranches: ['feature/a'],
  });
  await settle();

  const { job } = await runner.discardRelease(id);
  assert.equal(job.status, 'cancelled');
  assert.equal(calls.remove.length, 1);
  assert.equal(calls.push.length, 0);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].status, 'cancelled');
});
