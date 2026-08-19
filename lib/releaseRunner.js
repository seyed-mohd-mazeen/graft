const crypto = require('crypto');
const { EventEmitter } = require('events');
const childProcess = require('child_process');
const { promisify } = require('util');
const settings = require('./settings');
const worktrees = require('./worktrees');
const releaseStore = require('./releaseStore');

const execFileAsync = promisify(childProcess.execFile);

// Sequential branch-into-branch release merges, run in a scratch worktree.
//
// Modeled on claudeRunner.js's task shape (id, status, EventEmitter, log,
// snapshot/metaSnapshot split) but far smaller: no Claude subprocess, just a
// short, deterministic sequence of git calls. A conflicting branch is skipped
// (aborted, recorded, logged) rather than blocking the rest — only a human
// can decide which side of a real conflict should win. Pushing to origin is a
// separate, explicit step (pushRelease) after the merges are reviewed: it's
// the one part of this that's hard to reverse and visible to the whole team.

// Non-throwing async execFile — same shape as claudeRunner.js's runExecFile.
async function runExecFile(cmd, args, opts) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, opts);
    return { code: 0, stdout, stderr };
  } catch (err) {
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      message: err.message,
    };
  }
}

const deps = {
  execFile: runExecFile,
  worktrees,
  releaseStore,
};
function __setDeps(overrides) {
  Object.assign(deps, overrides);
}

// Serializes worktree-registration git calls, same reasoning as claudeRunner's
// gitLock. Kept local rather than shared: release runs are rare and short, so
// the tiny theoretical race with a ticket's worktree op isn't worth coupling
// the two modules together.
let gitLock = Promise.resolve();
function withGitLock(fn) {
  const run = gitLock.then(fn, fn);
  gitLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

const jobs = new Map();

const TERMINAL = new Set(['done', 'error', 'cancelled', 'no-changes']);

function emitUpdate(job) {
  job.emitter.emit('update', metaSnapshot(job));
}

// Append a log line and stream just that line to listeners.
function pushLog(job, text) {
  const entry = { ts: Date.now(), text };
  job.log.push(entry);
  job.emitter.emit('log', entry);
}

function metaSnapshot(job) {
  const { log, emitter, ...rest } = job;
  return rest;
}

function snapshot(job) {
  return { ...metaSnapshot(job), log: job.log };
}

function getJob(id) {
  return jobs.get(id) || null;
}

function listActive() {
  return [...jobs.values()].filter((j) => !TERMINAL.has(j.status)).map(snapshot);
}

function resultFor(job, branch) {
  return job.results.find((r) => r.branch === branch);
}

// Persist the finished record to history. Best-effort: a history-write
// failure must never affect the run it's recording.
function finalizeRecord(job) {
  try {
    deps.releaseStore.save({
      id: job.id,
      repoPath: job.repoPath,
      destBranch: job.destBranch,
      sourceBranches: job.sourceBranches,
      results: job.results,
      pushedSha: job.pushedSha,
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    });
  } catch {
    /* best-effort history; never crash the run over it */
  }
}

function startRelease({ repoPath, destBranch, sourceBranches }) {
  const id = crypto.randomUUID();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0); // several browser tabs may watch one run
  const job = {
    id,
    repoPath,
    destBranch,
    // Pinned at creation time, same reasoning as claudeRunner's tasks: a
    // later Settings change must not redirect an in-flight run.
    baseBranch: settings.get().baseBranch || 'main',
    sourceBranches: [...sourceBranches],
    results: sourceBranches.map((branch) => ({ branch, status: 'pending' })),
    status: 'running',
    worktreePath: null,
    pushedSha: null,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    log: [],
    emitter,
  };
  jobs.set(id, job);

  runSequence(job).catch((err) => {
    job.status = 'error';
    job.error = err.message;
    job.finishedAt = Date.now();
    pushLog(job, `Release run failed: ${err.message}`);
    emitUpdate(job);
    finalizeRecord(job);
  });

  return id;
}

async function runSequence(job) {
  pushLog(job, `Preparing release worktree for '${job.destBranch}'…`);
  emitUpdate(job);

  const prep = await withGitLock(() =>
    deps.worktrees.prepareReleaseWorktree(deps.execFile, {
      repoPath: job.repoPath,
      destBranch: job.destBranch,
      baseBranch: job.baseBranch,
      runId: job.id,
    })
  );
  job.worktreePath = prep.path;
  pushLog(
    job,
    prep.createdFromBase
      ? `'${job.destBranch}' doesn't exist on origin yet — created from '${job.baseBranch}'.`
      : `Worktree reset to origin/${job.destBranch}.`
  );
  emitUpdate(job);

  for (const branch of job.sourceBranches) {
    const result = resultFor(job, branch);
    result.status = 'running';
    emitUpdate(job);
    pushLog(job, `Merging '${branch}'…`);

    // Best-effort: an unfetchable branch still gets a merge attempt against
    // whatever ref already exists, same tolerance as resolveStartPoint.
    await deps.execFile('git', ['fetch', 'origin', branch, '--quiet'], {
      cwd: job.repoPath,
      encoding: 'utf8',
    });

    const merge = await deps.worktrees.mergeBranch(
      deps.execFile,
      job.worktreePath,
      `origin/${branch}`,
      `Merge ${branch} into ${job.destBranch} (release)`
    );

    if (merge.merged) {
      result.status = 'merged';
      result.sha = merge.sha;
      pushLog(job, `Merged '${branch}'.`);
    } else if (merge.files && merge.files.length) {
      result.status = 'conflict';
      result.files = merge.files;
      pushLog(job, `'${branch}' conflicts with the current release state in: ${merge.files.join(', ')}.`);
    } else {
      result.status = 'conflict';
      result.files = [];
      result.error = merge.error;
      pushLog(job, `Could not merge '${branch}': ${merge.error || 'unknown error'}.`);
    }
    emitUpdate(job);
  }

  const anyMerged = job.results.some((r) => r.status === 'merged');
  job.status = anyMerged ? 'awaiting-push' : 'no-changes';
  pushLog(
    job,
    anyMerged
      ? 'Merging complete. Review the results, then push to origin when ready.'
      : 'No branches merged cleanly — nothing to push.'
  );
  if (!anyMerged) {
    job.finishedAt = Date.now();
    finalizeRecord(job);
  }
  emitUpdate(job);
}

async function pushRelease(id) {
  const job = jobs.get(id);
  if (!job) return { error: 'Unknown release run.', code: 404 };
  if (job.status !== 'awaiting-push') {
    return { error: 'This release run is not ready to push.', code: 409 };
  }

  const result = await withGitLock(() => deps.worktrees.pushBranch(deps.execFile, job.worktreePath, job.destBranch));
  if (!result.pushed) {
    pushLog(job, `Push to origin/${job.destBranch} was rejected: ${result.error}`);
    emitUpdate(job);
    return { error: result.error, code: 502, job };
  }

  const merged = job.results.filter((r) => r.status === 'merged');
  job.pushedSha = merged.length ? merged[merged.length - 1].sha : null;
  job.status = 'done';
  job.finishedAt = Date.now();
  pushLog(job, `Pushed to origin/${job.destBranch}.`);
  emitUpdate(job);
  finalizeRecord(job);

  // The scratch worktree's job is done — a stale local mirror of a branch
  // that keeps moving has no ongoing value, unlike a ticket's worktree.
  await withGitLock(() =>
    deps.worktrees.remove(deps.execFile, { repoPath: job.repoPath, worktreePath: job.worktreePath, force: true })
  );

  return { job };
}

async function discardRelease(id) {
  const job = jobs.get(id);
  if (!job) return { error: 'Unknown release run.', code: 404 };

  if (job.worktreePath) {
    await withGitLock(() =>
      deps.worktrees.remove(deps.execFile, { repoPath: job.repoPath, worktreePath: job.worktreePath, force: true })
    );
  }
  job.status = 'cancelled';
  job.finishedAt = Date.now();
  pushLog(job, 'Release run discarded.');
  emitUpdate(job);
  finalizeRecord(job);
  return { job };
}

module.exports = {
  startRelease,
  pushRelease,
  discardRelease,
  getJob,
  listActive,
  snapshot,
  metaSnapshot,
  __setDeps,
};
