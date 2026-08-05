import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A repo path must be configured for the implement phase to run; git is faked
// below via __setDeps, so any non-empty path works.
process.env.REPO_PATH = process.env.REPO_PATH || process.cwd();
process.env.BASE_BRANCH = process.env.BASE_BRANCH || 'main';

import runner from '../lib/claudeRunner.js';
import settingsModule from '../lib/settings.js';

// Let async transitions (spawn 'close' on nextTick -> post* -> finalize) settle.
const settle = () => new Promise((r) => setTimeout(r, 30));

// A fake Claude child process that emits a session id, a success result, then
// closes cleanly — enough to drive the plan/implement phases without the CLI.
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 4242;
  child.kill = () => {};
  process.nextTick(() => {
    child.stdout.emit('data', JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-xyz' }) + '\n');
    child.stdout.emit('data', JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok text', num_turns: 2 }) + '\n');
    child.emit('close', 0);
  });
  return child;
}

const savedRecords = new Map();
const fakeStore = {
  save: (rec) => savedRecords.set(rec.id, rec),
  get: (id) => savedRecords.get(id) || null,
  list: () => [...savedRecords.values()],
  remove: (id) => savedRecords.delete(id),
};

// Non-throwing async git fake, matching the shape of the real deps.execFile:
// (cmd, args, opts) => Promise<{code, stdout, stderr}>. Clean tree, every
// command "succeeds" — enough to drive the state machine without real git.
const cleanExecFile = async () => ({ code: 0, stdout: '', stderr: '' });

// No-op Telegram fake. Critical for isolation: settings.js reads the real
// data/settings.json on disk, so if this machine has ever configured a real
// bot token there, an unmocked `notify` would send real Telegram messages
// every test run. Individual tests override this to inspect calls instead.
const noopNotify = async () => ({ ok: false, skipped: true });

// Worktree fake. The real module touches the filesystem (mkdir/symlink), which
// would litter the machine with directories on every test run.
const worktreeCalls = [];
const fakeWorktrees = {
  add: async (_exec, opts) => {
    worktreeCalls.push(opts);
    return { path: `/fake/worktrees/${opts.ticketKey}`, branch: opts.branch, notes: [], created: true };
  },
  remove: async () => ({ removed: true }),
  list: async () => [],
  isMerged: async () => false,
  rootFor: (repo) => `${repo}/.ticket-runner-worktrees`,
  linkDependencies: () => ({ linked: true }),
  dependenciesStale: () => false,
};

// No-op Jira-comment fake, for the same reason as noopNotify: settings.js
// reads the real data/settings.json, so if commentOnJira has ever been turned
// on there, an unmocked call would try to post a real comment on every test run.
const noopJiraComment = async () => {};

// Inject fakes: no real CLI, no real git, no disk writes, no real Telegram or
// Jira-comment calls.
runner.__setDeps({
  spawn: () => fakeChild(),
  execFile: cleanExecFile,
  store: fakeStore,
  pendingStore: { save() {}, remove() {}, list: () => [] },
  worktrees: fakeWorktrees,
  notify: noopNotify,
  jiraComment: noopJiraComment,
});

const ticket = { key: 'TST-1', summary: 'Test ticket', type: 'Task', description: 'do a thing' };

test('startTask drafts a plan and parks at awaiting-approval', async () => {
  const id = runner.startTask(ticket);
  await settle();
  const snap = runner.snapshot(runner.getTask(id));
  assert.equal(snap.phase, 'plan');
  assert.equal(snap.status, 'awaiting-approval');
  assert.equal(snap.plan, 'ok text');
});

test('startTask pins the repo path onto the task at creation time', async () => {
  const id = runner.startTask(ticket);
  await settle();
  const task = runner.getTask(id);
  assert.ok(task.repoPath, 'repoPath must be pinned, not left to be resolved live later');
  assert.equal(task.repoPath, settingsModule.get().repoPath);
});

test('a drafted plan sends a Telegram notification when ready for approval', async () => {
  const calls = [];
  runner.__setDeps({
    notify: async (text) => {
      calls.push(text);
      return { ok: true };
    },
  });
  try {
    runner.startTask(ticket);
    await settle();
    assert.equal(calls.length, 1, 'exactly one notification for the drafted plan');
    assert.match(calls[0], /Plan ready/);
    assert.match(calls[0], new RegExp(ticket.key));
  } finally {
    runner.__setDeps({ notify: noopNotify });
  }
});

test('a finished implementation sends a Telegram notification', async () => {
  const calls = [];
  runner.__setDeps({
    notify: async (text) => {
      calls.push(text);
      return { ok: true };
    },
  });
  try {
    const id = runner.startTask(ticket);
    await settle();
    calls.length = 0; // discard the "plan ready" notification from drafting
    await runner.approveTask(id);
    await settle();
    assert.equal(calls.length, 1, 'exactly one notification for the finished implementation');
    assert.match(calls[0], /Implementation finished/);
    assert.match(calls[0], new RegExp(ticket.key));
  } finally {
    runner.__setDeps({ notify: noopNotify });
  }
});

test('commentOnJira defaults to off: a finished run posts no comment', async () => {
  const calls = [];
  runner.__setDeps({ jiraComment: async (key, body) => calls.push({ key, body }) });
  try {
    const id = runner.startTask(ticket);
    await settle();
    await runner.approveTask(id);
    await settle();
    assert.equal(runner.snapshot(runner.getTask(id)).status, 'done');
    assert.equal(calls.length, 0, 'off by default, like Telegram — configured is not the same as enabled');
  } finally {
    runner.__setDeps({ jiraComment: noopJiraComment });
  }
});

test('commentOnJira, once enabled, posts the branch and summary on a successful run', async () => {
  const calls = [];
  const originalGet = settingsModule.get;
  runner.__setDeps({ jiraComment: async (key, body) => calls.push({ key, body }) });
  settingsModule.get = () => ({ ...originalGet(), commentOnJira: true });
  try {
    const id = runner.startTask(ticket);
    await settle();
    await runner.approveTask(id);
    await settle();
    const task = runner.getTask(id);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].key, ticket.key);
    assert.match(calls[0].body, new RegExp(task.branch));
    assert.match(calls[0].body, /ok text/, "includes Claude's summary");
  } finally {
    settingsModule.get = originalGet;
    runner.__setDeps({ jiraComment: noopJiraComment });
  }
});

test('commentOnJira, once enabled, also posts on a failed run — but never for a planning-only failure', async () => {
  const calls = [];
  const originalGet = settingsModule.get;
  settingsModule.get = () => ({ ...originalGet(), commentOnJira: true });
  runner.__setDeps({ jiraComment: async (key, body) => calls.push({ key, body }) });
  try {
    // A plan-phase failure never reaches finalizeTask's implement-only comment
    // logic — confirms the gate is on the *implementation* outcome, not just
    // "commentOnJira is true".
    runner.__setDeps({
      spawn: () => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.pid = 1;
        child.kill = () => {};
        process.nextTick(() => child.emit('close', 1));
        return child;
      },
    });
    const id = runner.startTask(ticket);
    await settle();
    assert.equal(runner.snapshot(runner.getTask(id)).status, 'error');
    assert.equal(calls.length, 0, 'no comment for a planning failure — nothing was ever implemented');
  } finally {
    settingsModule.get = originalGet;
    runner.__setDeps({ jiraComment: noopJiraComment, spawn: () => fakeChild() });
  }
});

test('approveTask runs the implementation through to done and saves history', async () => {
  const id = runner.startTask(ticket);
  await settle();
  const result = await runner.approveTask(id);
  assert.ok(result.task);
  await settle();
  const snap = runner.snapshot(runner.getTask(id));
  assert.equal(snap.phase, 'implement');
  assert.equal(snap.status, 'done');
  assert.equal(snap.summary, 'ok text');
  const rec = fakeStore.get(id);
  assert.ok(rec, 'implementation saved to history');
  assert.equal(rec.sessionId, 'sess-xyz', 'session id persisted for later iteration');
  assert.ok(rec.repoPath, 'repo path persisted so a later iterate uses the same repo');
});

test('approveTask on an unknown id returns an error', async () => {
  const result = await runner.approveTask('does-not-exist');
  assert.equal(result.code, 404);
});

test('approveTask is rejected once the task has left awaiting-approval', async () => {
  const id = runner.startTask(ticket);
  await settle();
  await runner.approveTask(id);
  const second = await runner.approveTask(id);
  assert.equal(second.code, 409, 'cannot approve twice');
});

test('approveTask keeps the plan retryable when worktree setup fails', async () => {
  const id = runner.startTask(ticket);
  await settle();

  let attempts = 0;
  runner.__setDeps({
    worktrees: {
      ...fakeWorktrees,
      add: async (exec, opts) => {
        attempts++;
        if (attempts === 1) throw new Error('git worktree add exploded');
        return fakeWorktrees.add(exec, opts);
      },
    },
  });

  try {
    const first = await runner.approveTask(id);
    assert.equal(first.code, 409, 'rejected because the worktree could not be created');
    assert.equal(
      runner.snapshot(runner.getTask(id)).status,
      'awaiting-approval',
      'plan survives — task is not burned into an unrecoverable error'
    );

    const second = await runner.approveTask(id);
    assert.ok(second.task, 'retrying succeeds using the same drafted plan');
    await settle();
    assert.equal(runner.snapshot(runner.getTask(id)).status, 'done');
  } finally {
    runner.__setDeps({ worktrees: fakeWorktrees });
  }
});

test('two tickets implement in parallel, each in its own worktree and branch', async () => {
  const a = { key: 'TST-100', summary: 'first', type: 'Task', description: 'a' };
  const b = { key: 'TST-200', summary: 'second', type: 'Bug', description: 'b' };

  const idA = runner.startTask(a);
  const idB = runner.startTask(b);
  await settle();

  worktreeCalls.length = 0;
  // Approve both without either finishing: the old design rejected the second
  // approve (or, worse, moved HEAD out from under the first run).
  const [resA, resB] = await Promise.all([runner.approveTask(idA), runner.approveTask(idB)]);
  assert.ok(resA.task, 'first ticket started');
  assert.ok(resB.task, 'second ticket started concurrently');

  const taskA = runner.getTask(idA);
  const taskB = runner.getTask(idB);
  assert.notEqual(taskA.worktreePath, taskB.worktreePath, 'each run gets its own checkout');
  assert.notEqual(taskA.branch, taskB.branch, 'each run gets its own branch');
  assert.match(taskA.branch, /^feature\//, 'a Task becomes a feature branch');
  assert.match(taskB.branch, /^bugfix\//, 'a Bug becomes a bugfix branch');
  await settle();
});

test('approve never checks out or pulls in the user’s own checkout', async () => {
  const id = runner.startTask(ticket);
  await settle();

  const gitCalls = [];
  runner.__setDeps({
    execFile: async (cmd, args, opts) => {
      gitCalls.push({ cmd, args, cwd: opts && opts.cwd });
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  try {
    const result = await runner.approveTask(id);
    assert.ok(result.task);
    await settle();
    const subcommands = gitCalls.filter((c) => c.cmd === 'git').map((c) => c.args[0]);
    // `pull --ff-only` made remote-less (and diverged) repos impossible to
    // implement at all; `checkout` moved the user off their own branch.
    assert.ok(!subcommands.includes('pull'), 'no pull: it blocked repos without a remote');
    assert.ok(!subcommands.includes('checkout'), 'no checkout: the main working tree is never touched');
  } finally {
    runner.__setDeps({ execFile: cleanExecFile });
  }
});

test('switching the configured project mid-task does not redirect an in-flight task', async () => {
  const id = runner.startTask(ticket);
  await settle();
  const task = runner.getTask(id);
  const originalRepo = task.repoPath;
  assert.ok(originalRepo);

  worktreeCalls.length = 0;
  const originalGet = settingsModule.get;
  try {
    // Simulate the user switching projects in Settings while this task is
    // still in flight — this must not change which repo the task works in.
    settingsModule.get = () => ({ ...originalGet(), repoPath: 'C:/some/other/repo' });

    const result = await runner.approveTask(id);
    assert.ok(result.task, 'approve still succeeds');
    assert.equal(worktreeCalls.length, 1);
    assert.equal(
      worktreeCalls[0].repoPath,
      originalRepo,
      "the worktree must be created in the task's pinned repo, not the live setting"
    );
  } finally {
    settingsModule.get = originalGet;
  }
  await settle(); // let the background implementation finish before the next test
});

test('cancelTask marks the task cancelled', async () => {
  const id = runner.startTask(ticket);
  await settle();
  assert.equal(runner.cancelTask(id).status, 'cancelled');
});

test('pauseTask only pauses actively-running work', async () => {
  const id = runner.startTask(ticket);
  await settle(); // awaiting-approval is not "active"
  assert.equal(runner.pauseTask(id).status, 'awaiting-approval');
});

test('iterateTask rejects unknown tasks and non-implement phases', async () => {
  assert.deepEqual(await runner.iterateTask('nope', 'fix'), { error: 'Unknown task', code: 404 });
  const id = runner.startTask(ticket);
  await settle(); // still in the plan phase
  assert.equal((await runner.iterateTask(id, 'fix')).code, 409);
});

test('iterateTask continues a finished implementation', async () => {
  const id = runner.startTask(ticket);
  await settle();
  await runner.approveTask(id);
  await settle(); // done
  const r = await runner.iterateTask(id, 'use the shared helper');
  assert.ok(r.task, 'iteration started');
  await settle();
  assert.equal(runner.snapshot(runner.getTask(id)).status, 'done');
});

test('revisePlan rejects unknown tasks, an approved plan, and a plan still drafting', async () => {
  assert.deepEqual(await runner.revisePlan('nope', 'fix'), { error: 'Unknown task', code: 404 });

  // Already moved into the implement phase — nothing left to revise.
  const approved = runner.startTask(ticket);
  await settle();
  await runner.approveTask(approved);
  await settle();
  assert.equal((await runner.revisePlan(approved, 'fix')).code, 409);

  // Still drafting — not yet at a decision point.
  const drafting = runner.startTask(ticket);
  runner.getTask(drafting).status = 'planning';
  assert.equal((await runner.revisePlan(drafting, 'fix')).code, 409);
  await settle();
});

test('revisePlan resumes the same session and lands back at awaiting-approval', async () => {
  const id = runner.startTask(ticket);
  await settle();
  const task = runner.getTask(id);
  const sessionBefore = task.sessionId;
  assert.ok(sessionBefore, 'the initial draft produced a session');
  task.numTurns = 6; // simulate turns already spent drafting

  const resumeArgs = [];
  runner.__setDeps({
    spawn: (file, args) => {
      resumeArgs.push(args);
      return fakeChild();
    },
  });
  try {
    const r = await runner.revisePlan(id, 'also cover the empty-list case');
    assert.ok(r.task, 'revision started');
    assert.equal(task.status, 'planning', 'moves back into drafting immediately');
    assert.equal(task.numTurns, 0, 'a fresh sub-run starts its own turn count');
    await settle();
    const snap = runner.snapshot(runner.getTask(id));
    assert.equal(snap.status, 'awaiting-approval', 'lands back at a decision point');
    assert.equal(task.sessionId, sessionBefore, 'continues the same Claude session, not a new one');
    const spawnedArgs = resumeArgs[resumeArgs.length - 1];
    assert.ok(spawnedArgs.includes('--resume'), 'resumed rather than starting over');
    assert.ok(spawnedArgs.includes(sessionBefore));
    assert.ok(spawnedArgs.includes('Read,Grep,Glob'), 'still read-only during revision — no write tools granted');
  } finally {
    runner.__setDeps({ spawn: () => fakeChild() });
  }
  await settle();
});

test('revisePlan refuses when there is no saved session to continue', async () => {
  const id = runner.startTask(ticket);
  await settle();
  const task = runner.getTask(id);
  task.sessionId = null; // e.g. a plan drafted before session tracking existed
  assert.equal((await runner.revisePlan(id, 'fix')).code, 409);
});

test('iterateTask rehydrates a finished run from history after a restart', async () => {
  // Simulate a record left by a previous server process, with no live task.
  const recId = 'rec-restart-123';
  fakeStore.save({
    id: recId, ticketKey: 'TST-9', ticketSummary: 'old', branch: 'feature/x/TST-9',
    status: 'done', sessionId: 'sess-old', filesChanged: [], summary: 'prev',
    repoPath: process.env.REPO_PATH,
  });
  assert.equal(runner.getTask(recId), undefined, 'not live in memory');
  const r = await runner.iterateTask(recId, 'more changes');
  assert.ok(r.task, 'rehydrated and started');
  await settle();
  assert.equal(runner.snapshot(runner.getTask(recId)).status, 'done');
});

test('iterateTask refuses a record that has no saved session', async () => {
  fakeStore.save({ id: 'rec-nosession', ticketKey: 'TST-8', status: 'done', branch: 'b', filesChanged: [] });
  assert.equal((await runner.iterateTask('rec-nosession', 'x')).code, 409);
});

test('cancelTask leaves a finished run alone', async () => {
  const id = runner.startTask(ticket);
  await settle();
  await runner.approveTask(id);
  await settle();
  assert.equal(runner.snapshot(runner.getTask(id)).status, 'done');
  // Without a terminal guard this rewrote a completed run into 'cancelled',
  // discarding its result and desyncing it from its saved record.
  assert.equal(runner.cancelTask(id).status, 'done');
});

test('a stopped run is recorded so its worktree changes stay findable', async () => {
  const id = runner.startTask(ticket);
  await settle();
  await runner.approveTask(id);
  const task = runner.getTask(id);
  // Force it back to running so stopTask has something live to halt.
  task.status = 'running';
  const stopped = await runner.stopTask(id);
  assert.equal(stopped.status, 'stopped');
  const rec = fakeStore.get(id);
  assert.ok(rec, 'stopped runs are saved, not silently dropped');
  assert.equal(rec.status, 'stopped');
  assert.ok(rec.worktreePath, 'the record points at the worktree holding the changes');
  await settle();
});

test('a plan-phase stop records nothing and reports no files changed', async () => {
  const id = runner.startTask(ticket);
  const task = runner.getTask(id);
  task.status = 'planning'; // still drafting
  const stopped = await runner.stopTask(id);
  assert.equal(stopped.status, 'stopped');
  assert.deepEqual(stopped.filesChanged, [], 'a planning run has no changes of its own');
  // Inspecting the shared checkout here would have reported the user's own
  // uncommitted edits as though this task had made them.
  assert.equal(fakeStore.get(id), null, 'no record for a run that never implemented');
  await settle();
});

test('every run hands the store an immutable diff snapshot to append', async () => {
  // claudeRunner's half of the contract: each finished run submits a
  // `diffSnapshot` alongside the cumulative `diff`, so the store can accumulate
  // one entry per run instead of overwriting the previous run's diff. The
  // appending itself is store.js's job — see test/store.test.mjs.
  const saved = [];
  runner.__setDeps({ store: { ...fakeStore, save: (rec) => saved.push(rec) } });
  try {
    const id = runner.startTask(ticket);
    await settle();
    await runner.approveTask(id);
    await settle();

    assert.equal(saved.length, 1);
    assert.ok(saved[0].diffSnapshot, 'a per-run snapshot accompanies the record');
    assert.equal(saved[0].diffSnapshot.status, 'done');
    assert.ok('diff' in saved[0], 'the cumulative branch diff is stored too');
  } finally {
    runner.__setDeps({ store: fakeStore });
  }
});

test('pausing before implementation starts does not resume the read-only plan session', async () => {
  const id = runner.startTask(ticket);
  await settle();
  const task = runner.getTask(id);
  const planSession = task.sessionId;
  assert.ok(planSession, 'the plan phase produced a session');

  await runner.approveTask(id);
  // Approving clears the plan session precisely so this window is safe: the plan
  // conversation was read-only and never received implementation instructions,
  // so resuming it with write tools and "continue where you left off" was wrong.
  assert.equal(task.sessionId, null, 'the plan session is not carried into the implement phase');

  const resumeArgs = [];
  runner.__setDeps({
    spawn: (file, args) => {
      resumeArgs.push(args);
      return fakeChild();
    },
  });
  try {
    task.status = 'paused';
    task.child = null;
    runner.resumeTask(id);
    await settle();
    const resumed = resumeArgs[resumeArgs.length - 1] || [];
    assert.ok(!resumed.includes('--resume'), 'starts the implementation properly instead of resuming a stale session');
  } finally {
    runner.__setDeps({ spawn: () => fakeChild() });
  }
  await settle();
});

test('an interrupted run is rehydrated as resumable rather than lost', async () => {
  // A run that was mid-flight when the process died is persisted as 'running';
  // startup must bring it back as something the user can continue.
  // Record the status at save time: pendingStore receives the live task object,
  // which keeps mutating, so holding the reference would prove nothing.
  const parked = [];
  runner.__setDeps({
    pendingStore: {
      save: (t) => parked.push({ id: t.id, status: t.status }),
      remove() {},
      list: () => [],
    },
  });
  try {
    const id = runner.startTask(ticket);
    await settle();
    assert.ok(
      parked.some((t) => t.id === id && t.status === 'planning'),
      'an active run is written to disk while it runs, not only once it parks'
    );
  } finally {
    runner.__setDeps({ pendingStore: { save() {}, remove() {}, list: () => [] } });
  }
});

test('shutdown parks live runs so no orphaned Claude process is left behind', async () => {
  const killed = [];
  runner.__setDeps({
    execFile: async (cmd, args, opts) => {
      if (cmd === 'taskkill') killed.push(args);
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  try {
    const id = runner.startTask(ticket);
    const task = runner.getTask(id);
    task.status = 'running';
    task.child = { pid: 999, kill: () => killed.push(['sigterm']) };

    const parked = await runner.shutdown();
    assert.ok(parked.includes(id), 'the live run was parked');
    assert.equal(runner.getTask(id).status, 'paused', 'parked as resumable, not abandoned');
    assert.equal(killed.length, 1, 'its child process was killed');
  } finally {
    runner.__setDeps({ execFile: cleanExecFile });
  }
  await settle();
});

test('implementTools grants configured commands and rejects unsafe ones', () => {
  // The value lands inside a comma-separated --allowedTools list and grants
  // shell access, so anything that could split the list or chain a second
  // command must be refused rather than sanitised.
  assert.equal(runner.bashPattern('npm test'), 'Bash(npm test*)');
  assert.equal(runner.bashPattern('pytest -q'), 'Bash(pytest -q*)');
  assert.equal(runner.bashPattern('npm test && rm -rf /'), null, 'no chaining');
  assert.equal(runner.bashPattern('npm test, Bash(rm*)'), null, 'no list splitting');
  assert.equal(runner.bashPattern('echo $(whoami)'), null, 'no substitution');
  assert.equal(runner.bashPattern(''), null);

  // With nothing configured, the historical npm defaults still apply.
  const tools = runner.implementTools('C:/no/commands/configured');
  assert.match(tools, /Bash\(npm test\*\)/);
  assert.match(tools, /^Read,Write,Edit,Grep,Glob,/);
});

test('getDiff reflects tracked and untracked changes without mutating the index', async () => {
  const execFileAsync = promisify(execFileCb);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-runner-diff-'));
  const git = (args) => execFileAsync('git', args, { cwd: dir, encoding: 'utf8' });

  await git(['init', '-q', '.']);
  await git(['config', 'user.email', 'a@a.com']);
  await git(['config', 'user.name', 'a']);
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'line1\n');
  await git(['add', 'tracked.txt']);
  await git(['commit', '-qm', 'init']);
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'line1\nline2\n');
  fs.writeFileSync(path.join(dir, 'untracked.txt'), 'new content\n');

  async function realExecFile(cmd, args, opts) {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, opts);
      return { code: 0, stdout, stderr };
    } catch (err) {
      return { code: typeof err.code === 'number' ? err.code : 1, stdout: err.stdout || '', stderr: err.stderr || '', message: err.message };
    }
  }

  try {
    runner.__setDeps({ execFile: realExecFile });
    const fakeTask = { repoPath: dir, log: [], emitter: new EventEmitter() };
    const diff = await runner.getDiff(fakeTask);

    assert.match(diff, /diff --git a\/tracked\.txt b\/tracked\.txt/);
    assert.match(diff, /\+line2/);
    assert.match(diff, /diff --git a\/untracked\.txt b\/untracked\.txt/);
    assert.match(diff, /new file mode/);
    assert.match(diff, /\+new content/);

    // The index must be untouched by just viewing the diff.
    const statusAfter = await git(['status', '--porcelain']);
    assert.ok(statusAfter.stdout.includes('?? untracked.txt'), 'untracked file must remain untracked');
  } finally {
    runner.__setDeps({ execFile: cleanExecFile });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
