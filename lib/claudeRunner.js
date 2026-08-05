const childProcess = require('child_process');
const { promisify } = require('util');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const store = require('./store');
const pendingStore = require('./pendingStore');
const settings = require('./settings');
const telegram = require('./telegram');
const jira = require('./jira');
const worktrees = require('./worktrees');
const claudeBin = require('./claudeBin');

const execFileAsync = promisify(childProcess.execFile);

// Non-throwing async execFile: resolves to {code, stdout, stderr[, message]}
// instead of rejecting, so callers decide for themselves which nonzero exit
// codes are real errors (e.g. `git diff --no-index` exits 1 when it finds a
// difference — that's success, not failure, for our purposes).
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

// Repo + base branch come from runtime settings (chosen in the Settings tab),
// so switching projects doesn't require an env change or restart. Each task
// pins its own repoPath/baseBranch at creation time (see startTask) so that
// switching the project in Settings mid-run can never redirect an in-flight
// (or paused/resumable) task's git or Claude calls to a different repo.
const repoPath = () => settings.get().repoPath;
const baseBranch = () => settings.get().baseBranch || 'main';
function taskRepoPath(task) {
  return (task && task.repoPath) || repoPath();
}
function taskBaseBranch(task) {
  return (task && task.baseBranch) || baseBranch();
}

// Where a task's work actually happens. Implementation runs in the task's own
// git worktree; planning (read-only) and any pre-worktree step fall back to the
// main checkout.
function taskWorkDir(task) {
  return (task && task.worktreePath) || taskRepoPath(task);
}

// Injectable side-effect dependencies. Production wires the reals; tests swap
// in fakes via __setDeps() so the task state machine can be exercised without
// the real Claude CLI, git, or disk. See test/claudeRunner.test.mjs.
const deps = {
  spawn: childProcess.spawn,
  execFile: runExecFile,
  store,
  pendingStore,
  worktrees,
  notify: (text) => telegram.sendMessage(text),
  jiraComment: (key, body) => jira.addComment(key, body),
};
function __setDeps(overrides) {
  Object.assign(deps, overrides);
}

// Turn budgets live in settings so they can be tuned without patching source.
const maxTurns = () => settings.maxTurns();
const planMaxTurns = () => settings.planMaxTurns();

// Tools Claude may use while planning (read-only: it must not touch the working tree).
const PLAN_TOOLS = 'Read,Grep,Glob';
// Always-available implementation tools (writes allowed, no shell).
const BASE_IMPLEMENT_TOOLS = ['Read', 'Write', 'Edit', 'Grep', 'Glob'];
// Historical default, used when a project has configured no commands of its own.
const DEFAULT_BASH_TOOLS = ['Bash(npm run lint*)', 'Bash(npm run test*)', 'Bash(npm test*)'];

// A run's log is streamed incrementally and also replayed on reconnect, so it is
// capped: an unbounded array is re-serialised into every pendingStore write and
// every full snapshot.
const MAX_LOG_ENTRIES = 1500;
const LOG_TRIM_TO = 1000;

// Turn a configured command into an --allowedTools pattern.
//
// The value reaches the CLI inside a comma-separated list, and grants shell
// access, so anything that could end the pattern early, split the list, or chain
// a second command is refused outright rather than sanitised into something
// subtly different from what the user typed.
const UNSAFE_COMMAND_CHARS = /[,)(&|;`$<>%\n\r"']/;

function bashPattern(command) {
  const cmd = (command || '').trim();
  if (!cmd) return null;
  if (UNSAFE_COMMAND_CHARS.test(cmd)) return null;
  return `Bash(${cmd}*)`;
}

// The --allowedTools value for an implementation run in a given repo.
function implementTools(repo) {
  const { lint, test } = settings.commandsFor(repo);
  const configured = [bashPattern(lint), bashPattern(test)].filter(Boolean);
  const bash = configured.length ? configured : DEFAULT_BASH_TOOLS;
  return [...BASE_IMPLEMENT_TOOLS, ...bash].join(',');
}

// Human-readable list of the verification commands a run may use, for the prompt.
function verificationSection(repo) {
  const { lint, test } = settings.commandsFor(repo);
  const lines = [];
  if (lint) lines.push(`- Lint: \`${lint}\``);
  if (test) lines.push(`- Tests: \`${test}\``);
  if (!lines.length) return '';
  return `\n\nVerification commands available in this project — run them before you finish and fix anything they flag:\n${lines.join(
    '\n'
  )}\n`;
}

// In-memory task store. Every non-terminal task is also mirrored to disk so a
// restart doesn't lose a drafted plan, a paused run, or an interrupted one.
const tasks = new Map();

// Serializes git operations that mutate shared repository state (worktree
// creation and removal register themselves in .git, and concurrent
// `git worktree add` calls can race on that bookkeeping).
//
// Note what this lock no longer has to do: implementations used to share one
// working tree, so correctness depended on never letting two of them overlap —
// and the lock could not provide that, because it was released as soon as the
// branch was set up while the run continued for minutes afterwards. Each run now
// has its own worktree, so overlapping runs are safe by construction.
let gitLock = Promise.resolve();
function withGitLock(fn) {
  const run = gitLock.then(fn, fn);
  gitLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

const HALTED = new Set(['cancelled', 'stopped', 'paused']);
const TERMINAL = new Set(['done', 'error', 'cancelled', 'stopped']);
// Statuses that mean a live child process should exist. Interrupted by a
// restart, these become resumable 'paused' tasks instead of vanishing.
const ACTIVE = new Set(['planning', 'branching', 'running']);

// Keep the on-disk copy in sync: persist any task that has not finished, drop it
// once it reaches a terminal state.
function persistPending(task) {
  try {
    if (TERMINAL.has(task.status)) {
      deps.pendingStore.remove(task.id);
    } else {
      deps.pendingStore.save(task);
    }
  } catch {
    /* best-effort persistence; never crash the run over it */
  }
}

// Load tasks from disk at startup.
//
// Parked tasks ('awaiting-approval' / 'paused') come back as they were. Tasks
// that were mid-run when the process died come back as 'paused': their child
// process is gone, but their Claude session id survived, so Continue resumes the
// conversation instead of silently abandoning the run and the edits it left in
// its worktree.
function hydratePending() {
  for (const rec of deps.pendingStore.list()) {
    if (tasks.has(rec.id)) continue;
    const task = { ...rec, child: null, saved: false, emitter: new EventEmitter() };
    task.emitter.setMaxListeners(0);
    task.log = Array.isArray(task.log) ? task.log : [];
    if (ACTIVE.has(task.status)) {
      task.status = 'paused';
      task.currentActivity = 'Interrupted when the server stopped.';
      task.log.push({
        ts: Date.now(),
        text: task.sessionId
          ? 'Server stopped while this run was active. Press Continue to resume it.'
          : 'Server stopped before this run got going. Press Continue to start it over.',
      });
      tasks.set(rec.id, task);
      persistPending(task); // record the demotion so a second restart is a no-op
      continue;
    }
    tasks.set(rec.id, task);
  }
}

// Raw (non-throwing) git call against an explicit directory.
function execGit(dir, args) {
  return deps.execFile('git', args, { cwd: dir, encoding: 'utf8' });
}

// Throwing git call — use for steps that must succeed.
async function git(dir, args) {
  const res = await execGit(dir, args);
  if (res.code !== 0) {
    throw new Error(res.message || res.stderr || `git ${args.join(' ')} exited with code ${res.code}`);
  }
  return res.stdout;
}

function friendlyToolLine(name, input) {
  switch (name) {
    case 'Read':
      return `Reading ${input?.file_path || ''}`;
    case 'Grep':
      return `Searching for "${input?.pattern || ''}"`;
    case 'Glob':
      return `Listing files matching ${input?.pattern || ''}`;
    case 'Write':
      return `Writing ${input?.file_path || ''}`;
    case 'Edit':
      return `Editing ${input?.file_path || ''}`;
    default:
      if (typeof name === 'string' && name.startsWith('Bash')) {
        const cmd = input?.command || '';
        return `Running: ${cmd.slice(0, 80)}`;
      }
      return `Using ${name}`;
  }
}

function emitUpdate(task) {
  task.emitter.emit('update', metaSnapshot(task));
}

// Append a log line and stream just that line to listeners.
//
// The log used to ride along inside every snapshot, so a long run re-sent its
// entire history on each of hundreds of updates. Subscribers now get one full
// snapshot on connect and an incremental entry per line after that.
function pushLog(task, text) {
  const entry = { ts: Date.now(), text };
  task.log.push(entry);
  if (task.log.length > MAX_LOG_ENTRIES) {
    const dropped = task.log.length - LOG_TRIM_TO;
    task.log = task.log.slice(dropped);
    task.log.unshift({ ts: Date.now(), text: `… ${dropped} earlier log lines trimmed …` });
  }
  task.emitter.emit('log', entry);
}

// Best-effort Telegram notification — reaches you even when the dashboard
// isn't open. Never awaited by callers and never throws into the caller:
// a notification failure must not affect the task it's reporting on.
function notifyTelegram(text) {
  Promise.resolve()
    .then(() => deps.notify(text))
    .then((res) => {
      if (res && !res.ok && !res.skipped) {
        console.warn(`Telegram notification failed: ${res.error}`);
      }
    })
    .catch((err) => console.warn(`Telegram notification failed: ${err.message}`));
}

// Best-effort comment back on the Jira ticket — same non-throwing shape as
// notifyTelegram: a run's own success or failure must never hinge on whether
// this side effect worked.
function commentOnJira(key, text) {
  Promise.resolve()
    .then(() => deps.jiraComment(key, text))
    .catch((err) => console.warn(`Jira comment failed for ${key}: ${err.message}`));
}

// Trim long text (e.g. Claude's summary) for a notification body.
function forNotification(text, max = 500) {
  const s = (text || '').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// Everything about a task except its log.
function metaSnapshot(task) {
  return {
    id: task.id,
    ticketKey: task.ticketKey,
    ticketSummary: task.ticketSummary,
    branch: task.branch,
    worktreePath: task.worktreePath || null,
    model: task.model,
    phase: task.phase,
    status: task.status,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt || null,
    numTurns: task.numTurns,
    maxTurns: task.maxTurns,
    currentActivity: task.currentActivity,
    filesChanged: task.filesChanged,
    referenceFiles: task.referenceFiles || [],
    plan: task.plan,
    summary: task.summary,
    error: task.error || null,
  };
}

// Full snapshot, including the log. Sent once when a client attaches.
function snapshot(task) {
  return { ...metaSnapshot(task), log: task.log };
}

// Prompt block listing reference files the user chose, if any.
function referenceSection(task) {
  const files = task.referenceFiles || [];
  if (!files.length) return '';
  return `\n\nReference files — READ THESE FIRST with the Read tool and follow their conventions, patterns, and style closely so your output matches what is expected:\n${files
    .map((f) => `- ${f}`)
    .join('\n')}\n`;
}

// Ticket context shared by the plan and implement prompts. Comments and links
// are included because that is routinely where the real acceptance criteria are.
function ticketSection(ticket) {
  const parts = [
    `Ticket: ${ticket.key} (${ticket.type})`,
    `Summary: ${ticket.summary}`,
    '',
    'Description:',
    ticket.description || '(no description provided)',
  ];
  if (ticket.parent) {
    parts.push('', `Parent issue: ${ticket.parent.key} — ${ticket.parent.summary}`);
  }
  if (ticket.links && ticket.links.length) {
    parts.push(
      '',
      'Linked issues:',
      ...ticket.links.map((l) => `- ${l.type} ${l.key}: ${l.summary}`)
    );
  }
  if (ticket.comments && ticket.comments.length) {
    parts.push(
      '',
      'Comments on the ticket (oldest first) — these often refine or override the description, so read them carefully:'
    );
    for (const c of ticket.comments) {
      parts.push('', `--- ${c.author}${c.created ? ` on ${c.created}` : ''} ---`, c.body);
    }
  }
  if (ticket.attachments && ticket.attachments.length) {
    parts.push(
      '',
      'Attachments (not downloaded — mention it if one looks essential):',
      ...ticket.attachments.map((a) => `- ${a.filename}${a.mimeType ? ` (${a.mimeType})` : ''}`)
    );
  }
  return parts.join('\n');
}

function startTask(ticket, model = null, referenceFiles = []) {
  const id = crypto.randomUUID();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0); // several browser tabs may watch one task
  const task = {
    id,
    ticketKey: ticket.key,
    ticketSummary: ticket.summary,
    ticket, // kept so the implement phase can reuse it after approval
    model, // CLI --model override, or null for the plan default
    referenceFiles: Array.isArray(referenceFiles) ? referenceFiles : [],
    // Pinned at creation time: a later project switch in Settings must not
    // redirect this task's git/Claude calls to a different repository.
    repoPath: repoPath(),
    baseBranch: baseBranch(),
    branch: null,
    worktreePath: null,
    phase: 'plan',
    status: 'planning',
    startedAt: Date.now(),
    finishedAt: null,
    numTurns: 0,
    maxTurns: planMaxTurns(),
    currentActivity: 'Reviewing the ticket and exploring the codebase...',
    filesChanged: [],
    plan: null,
    summary: null,
    error: null,
    log: [],
    child: null,
    emitter,
  };
  tasks.set(id, task);
  persistPending(task); // on disk from the start, so a crash can't lose the run

  // Draft the plan async; startTask returns immediately with the id. The task
  // will pause at 'awaiting-approval' until the user calls approveTask().
  runPlan(task, ticket).catch((err) => failTask(task, err));

  return id;
}

function failTask(task, err) {
  task.status = 'error';
  task.error = err.message;
  task.finishedAt = Date.now();
  pushLog(task, `Error: ${err.message}`);
  persistPending(task);
  emitUpdate(task);
}

// Approve a drafted plan and kick off the actual implementation.
//
// Returns { task } on success, or { error, code } describing why it can't run
// (same shape as iterateTask()). Worktree setup happens here, under the git
// lock, BEFORE any task-state mutation — so a failure leaves the task in
// 'awaiting-approval' (fully retryable) rather than burning it into an
// unrecoverable 'error' with the drafted plan lost.
//
// There is deliberately no "is the working tree clean?" gate any more. That
// check existed because every run shared one checkout; it both blocked
// legitimate parallel work and failed to prevent the race it was aimed at.
async function approveTask(id) {
  const task = tasks.get(id);
  if (!task) return { error: 'Unknown task', code: 404 };
  if (task.status !== 'awaiting-approval') return { error: 'Task is not waiting for approval.', code: 409 };

  const repo = taskRepoPath(task);
  if (!repo) return { error: 'No project selected. Choose one in Settings before implementing.', code: 400 };

  return withGitLock(async () => {
    // Re-check: another request may have consumed this task while it was queued on the lock.
    if (task.status !== 'awaiting-approval') {
      return { error: 'Task is not waiting for approval.', code: 409 };
    }

    task.currentActivity = 'Preparing an isolated worktree...';
    emitUpdate(task);

    const taskType = /bug/i.test((task.ticket && task.ticket.type) || '') ? 'bugfix' : 'feature';
    const user = (settings.get().jiraEmail || 'user').split('@')[0];
    const branch = `${taskType}/${user}/${task.ticketKey}`;

    try {
      const result = await deps.worktrees.add(deps.execFile, {
        repoPath: repo,
        baseBranch: taskBaseBranch(task),
        branch,
        ticketKey: task.ticketKey,
      });
      for (const note of result.notes) pushLog(task, note);
      task.branch = result.branch || branch;
      task.worktreePath = result.path;
      pushLog(task, `Working in ${result.path}`);

      // Share the main checkout's dependencies so configured lint/test commands
      // work in a freshly created worktree, which contains tracked files only.
      if (result.created) {
        const link = deps.worktrees.linkDependencies(repo, result.path);
        if (link.linked) {
          pushLog(task, 'Linked node_modules from the main checkout so tests can run.');
        } else if (link.reason && link.reason !== 'none-in-main-repo' && link.reason !== 'already-present') {
          pushLog(task, `Could not link node_modules (${link.reason}); dependency-based commands may fail.`);
        }
      }
    } catch (err) {
      task.currentActivity = 'Waiting for your approval';
      pushLog(task, `Could not start implementation: ${err.message}`);
      emitUpdate(task);
      return { error: err.message, code: 409 };
    }

    task.phase = 'implement';
    task.status = 'branching';
    task.maxTurns = maxTurns();
    task.numTurns = 0;
    task.error = null;
    // The planning session was read-only and never received implementation
    // instructions, so it must not be resumed as though it were an
    // implementation in progress: pausing between here and the first
    // implementation turn would otherwise replay the plan session with write
    // tools enabled. A null session id makes resumeTask start the run properly.
    task.sessionId = null;
    pushLog(task, 'Plan approved. Starting implementation...');
    persistPending(task);
    emitUpdate(task);

    runTask(task).catch((err) => failTask(task, err));
    return { task };
  });
}

// Kill the running Claude process (and, on Windows, its child tree). The
// Windows taskkill is fired without waiting on it — we don't depend on its
// result, and blocking here would serve no correctness purpose.
function killChild(task) {
  const child = task.child;
  if (!child) return;
  task.child = null;
  if (process.platform === 'win32' && child.pid) {
    deps.execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], {});
  } else {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already exited */
    }
  }
}

// Discard a task that is waiting for approval (or otherwise abandon it).
function cancelTask(id) {
  const task = tasks.get(id);
  if (!task) return null;
  // A finished run must not be rewritten into 'cancelled' — that would discard
  // its result and, for a saved run, desync it from its history record.
  if (TERMINAL.has(task.status)) return task;
  killChild(task);
  task.status = 'cancelled';
  task.finishedAt = Date.now();
  task.currentActivity = 'Cancelled.';
  pushLog(task, 'Task cancelled before implementation.');
  persistPending(task);
  emitUpdate(task);
  return task;
}

// Stop a task for good (drafting or implementing). Any partial file edits are
// left in its worktree for review; the task cannot be resumed.
async function stopTask(id) {
  const task = tasks.get(id);
  if (!task) return null;
  if (TERMINAL.has(task.status)) return task;
  killChild(task);
  task.status = 'stopped';
  task.currentActivity = 'Stopped.';
  pushLog(task, 'Stopped by user.');
  // Recorded like any other terminal run: the edits it left behind are real, and
  // dropping them from history made the branch impossible to find again.
  await finalizeTask(task);
  return task;
}

// Pause active work. The process is killed but the Claude session id is kept,
// so resumeTask() can continue the same conversation later.
function pauseTask(id) {
  const task = tasks.get(id);
  if (!task) return null;
  if (!ACTIVE.has(task.status)) return task;
  killChild(task);
  task.status = 'paused';
  task.currentActivity = 'Paused.';
  pushLog(task, task.sessionId ? 'Paused by user.' : 'Paused (note: no session yet — resume will start this phase over).');
  persistPending(task);
  emitUpdate(task);
  return task;
}

// Resume a paused task, continuing in the same phase.
function resumeTask(id) {
  const task = tasks.get(id);
  if (!task || task.status !== 'paused') return null;

  if (task.phase === 'plan') {
    task.status = 'planning';
    task.currentActivity = 'Resuming plan drafting...';
    pushLog(task, 'Resuming plan drafting...');
    persistPending(task);
    emitUpdate(task);
    if (!task.sessionId) {
      // Nothing to continue — draft from scratch (needs the ticket).
      if (!task.ticket) {
        failTask(task, new Error('This task has no saved session or ticket data to restart from.'));
        return task;
      }
      runPlan(task, task.ticket).catch((err) => failTask(task, err));
      return task;
    }
    const prompt =
      'Continue drafting the implementation plan where you left off. Stay read-only — do not modify any files — and finish with the full structured plan.';
    spawnClaude(task, { prompt, allowedTools: PLAN_TOOLS, resumeSession: task.sessionId })
      .then((code) => postPlan(task, code))
      .catch((err) => failTask(task, err));
    return task;
  }

  task.status = 'running';
  task.currentActivity = 'Resuming implementation...';
  pushLog(task, 'Resuming implementation...');
  persistPending(task);
  emitUpdate(task);

  // No session means the run never actually started (paused during worktree
  // setup, or interrupted before Claude emitted anything). Start it properly
  // with the full ticket + plan prompt rather than resuming the wrong session
  // with a "continue where you left off" instruction.
  if (!task.sessionId) {
    if (!task.ticket) {
      failTask(task, new Error('This run has no saved session or ticket data to restart from.'));
      return task;
    }
    runTask(task).catch((err) => failTask(task, err));
    return task;
  }

  const prompt =
    "Continue implementing the ticket where you left off. Do NOT run 'git commit' or 'git push'. When done, summarize what you changed.";
  spawnClaude(task, {
    prompt,
    allowedTools: implementTools(taskRepoPath(task)),
    resumeSession: task.sessionId,
  })
    .then((code) => postImplement(task, code))
    .catch((err) => failTask(task, err));
  return task;
}

// Reconstruct an in-memory task from a saved implementation record so a
// finished run can be resumed after the server (which holds the live task map)
// has restarted.
function rehydrateFromRecord(rec) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  return {
    id: rec.id,
    ticketKey: rec.ticketKey,
    ticketSummary: rec.ticketSummary,
    ticket: rec.ticket || null,
    model: rec.model || null,
    repoPath: rec.repoPath || repoPath(),
    baseBranch: rec.baseBranch || baseBranch(),
    branch: rec.branch || null,
    worktreePath: rec.worktreePath || null,
    phase: 'implement',
    status: rec.status || 'done',
    startedAt: rec.startedAt || Date.now(),
    finishedAt: rec.finishedAt || null,
    numTurns: 0,
    maxTurns: maxTurns(),
    currentActivity: '',
    filesChanged: rec.filesChanged || [],
    referenceFiles: rec.referenceFiles || [],
    plan: null,
    summary: rec.summary || null,
    error: null,
    sessionId: rec.sessionId || null,
    log: [],
    child: null,
    emitter,
  };
}

// Iterate on a finished implementation: continue the same Claude session with
// the reviewer's feedback so it refines the existing changes.
// Returns { task } on success, or { error, code } describing why it can't run.
async function iterateTask(id, feedback) {
  let task = tasks.get(id);
  if (!task) {
    // Not live in memory — try the saved history record (e.g. after a restart).
    const rec = deps.store.get(id);
    if (!rec) return { error: 'Unknown task', code: 404 };
    if (!rec.sessionId) {
      return { error: 'This run predates session tracking and can’t be continued.', code: 409 };
    }
    const repo = rec.repoPath || repoPath();
    if (!repo) {
      return { error: 'No project selected. Choose one in Settings before continuing this run.', code: 400 };
    }
    // Re-establish the run's worktree so we build on the same changes. Because
    // each run owns its worktree there is no branch to check out in the shared
    // checkout and no clean-tree precondition to satisfy.
    if (!rec.branch) {
      return { error: 'This run has no recorded branch, so there is nothing to continue.', code: 409 };
    }
    const prepared = await withGitLock(async () => {
      try {
        return await deps.worktrees.add(deps.execFile, {
          repoPath: repo,
          baseBranch: rec.baseBranch || baseBranch(),
          branch: rec.branch,
          ticketKey: rec.ticketKey,
        });
      } catch (err) {
        return { error: `Could not reopen the worktree for ${rec.branch}: ${err.message}`, code: 409 };
      }
    });
    if (prepared.error) return prepared;
    task = rehydrateFromRecord({ ...rec, repoPath: repo, worktreePath: prepared.path });
    tasks.set(id, task);
  }
  if (task.phase !== 'implement') {
    return { error: 'Only implemented tasks can be iterated on.', code: 409 };
  }
  if (!TERMINAL.has(task.status)) {
    return { error: 'Task is still in progress.', code: 409 };
  }
  if (task.status === 'cancelled') {
    return { error: 'This run was cancelled and cannot be continued.', code: 409 };
  }
  if (!task.sessionId) {
    return { error: 'No saved Claude session to continue for this run.', code: 409 };
  }

  task.status = 'running';
  task.numTurns = 0;
  task.finishedAt = null;
  task.error = null;
  task.saved = false;
  task.currentActivity = 'Applying your feedback…';
  pushLog(task, `Iterating on feedback: ${feedback.slice(0, 200)}`);
  persistPending(task);
  emitUpdate(task);

  const prompt = `The reviewer has reviewed your implementation and is requesting changes. Apply the following feedback, continuing to work on the same branch and building on the changes already in the working tree.

Feedback:
${feedback}

Instructions:
- Do NOT run 'git commit', 'git push', or any command that stages/commits changes.
- When done, summarize what you changed in this iteration and flag anything you're unsure about.`;

  spawnClaude(task, {
    prompt,
    allowedTools: implementTools(taskRepoPath(task)),
    resumeSession: task.sessionId,
  })
    .then((code) => postImplement(task, code))
    .catch((err) => failTask(task, err));

  return { task };
}

// Revise a drafted plan with reviewer feedback before it's approved — the
// plan-phase equivalent of iterateTask(). Only ever a live, in-memory task:
// unlike a finished implementation, an awaiting-approval plan is never
// persisted as a history record (see store.js), so there is nothing to
// rehydrate from after a restart — only pendingStore, which already restores
// it as a live task with its session intact.
async function revisePlan(id, feedback) {
  const task = tasks.get(id);
  if (!task) return { error: 'Unknown task', code: 404 };
  if (task.phase !== 'plan') {
    return { error: 'Only a plan awaiting approval can be revised.', code: 409 };
  }
  if (task.status !== 'awaiting-approval') {
    return { error: 'This plan is not waiting for a decision.', code: 409 };
  }
  if (!task.sessionId) {
    return { error: 'No saved Claude session to continue for this plan.', code: 409 };
  }

  task.status = 'planning';
  task.numTurns = 0;
  task.error = null;
  task.currentActivity = 'Redrafting the plan with your feedback…';
  pushLog(task, `Revising the plan: ${feedback.slice(0, 200)}`);
  persistPending(task);
  emitUpdate(task);

  const prompt = `The reviewer looked at your draft plan and is requesting changes before approving it. This is still a PLANNING step — stay read-only, do NOT make any changes yet.

Feedback:
${feedback}

Revise the plan to address this feedback, then finish with the full updated plan using the same structure as before:
  1. Overview — a short paragraph on the approach.
  2. Files to change — a bullet per file, each stating the exact path and what will change in it.
  3. Files to add — a bullet per new file, each stating the path and its purpose.
  4. Step-by-step — the concrete steps you will take, in order.
  5. Tests / verification — how the change will be checked.
  6. Risks & open questions — anything you are unsure about.`;

  spawnClaude(task, { prompt, allowedTools: PLAN_TOOLS, resumeSession: task.sessionId })
    .then((code) => postPlan(task, code))
    .catch((err) => failTask(task, err));

  return { task };
}

// Read-only planning phase: Claude explores the repo and drafts a detailed
// plan without touching the working tree. Ends at 'awaiting-approval'.
//
// This runs in the main checkout, which is safe precisely because
// implementations no longer touch it: a plan is always drafted against a clean
// base rather than against another ticket's half-finished edits.
async function runPlan(task, ticket) {
  const prompt = `You are drafting an implementation plan for the following Jira ticket. This is a PLANNING step only — do NOT make any changes yet.

${ticketSection(ticket)}
${referenceSection(task)}
Instructions:
- Explore the codebase (Read/Grep/Glob only) to understand how it is structured and which parts this ticket touches.
- Do NOT edit, write, or create any files. Do NOT run any commands. This is read-only.
- Produce a DETAILED plan of the work as your final message, using this structure:
  1. Overview — a short paragraph on the approach.
  2. Files to change — a bullet per file, each stating the exact path and what will change in it.
  3. Files to add — a bullet per new file, each stating the path and its purpose.
  4. Step-by-step — the concrete steps you will take, in order.
  5. Tests / verification — how the change will be checked.
  6. Risks & open questions — anything you are unsure about.
- Be specific: name real files, functions, and symbols you found while exploring. Do not be vague.`;

  const code = await spawnClaude(task, { prompt, allowedTools: PLAN_TOOLS });
  postPlan(task, code);
}

// Wrap up a planning run (initial or resumed).
function postPlan(task, code) {
  // If the user halted the run (paused/stopped/cancelled), leave it be.
  if (HALTED.has(task.status)) return;
  // The 'result' event normally moves the task to 'awaiting-approval'. Cover
  // the cases where Claude exited without one.
  if (code !== 0 && task.status !== 'awaiting-approval') {
    task.status = 'error';
    task.error = task.error || `Claude Code exited with code ${code}`;
    task.finishedAt = Date.now();
  } else if (task.status === 'planning') {
    task.status = 'awaiting-approval';
  }
  pushLog(task, `Plan ready (${task.status}).`);
  persistPending(task); // save the drafted plan so it survives a restart
  emitUpdate(task);

  if (task.status === 'awaiting-approval') {
    notifyTelegram(
      `📝 Plan ready for review: ${task.ticketKey} — ${task.ticketSummary}\n\nOpen the dashboard to review and approve.`
    );
  } else if (task.status === 'error') {
    notifyTelegram(`⚠️ Drafting failed: ${task.ticketKey} — ${task.ticketSummary}\n\n${forNotification(task.error)}`);
  }
}

// Implementation phase. By the time this runs, approveTask() has already set up
// the task's own worktree (task.worktreePath / task.branch are set).
async function runTask(task) {
  task.status = 'running';
  task.currentActivity = 'Starting Claude Code...';
  emitUpdate(task);

  const ticket = task.ticket;
  const planSection = task.plan
    ? `\n\nYou previously drafted and the reviewer approved this plan. Follow it:\n${task.plan}\n`
    : '';

  const prompt = `Implement the following Jira ticket in this codebase.

${ticketSection(ticket)}
${planSection}${referenceSection(task)}${verificationSection(taskRepoPath(task))}
Instructions:
- Explore the codebase first to find the relevant module(s) before writing code.
- Make the code changes needed to satisfy this ticket.
- Run the verification commands listed above (if any) and fix anything you break.
- Do NOT run 'git commit', 'git push', or any command that stages/commits changes.
  Leave all changes as uncommitted edits in the working tree for human review.
- At the end, summarize what you changed and why, and flag anything you're unsure about.`;

  const code = await spawnClaude(task, { prompt, allowedTools: implementTools(taskRepoPath(task)) });
  await postImplement(task, code);
}

// Wrap up an implementation run (initial or resumed).
async function postImplement(task, code) {
  if (HALTED.has(task.status)) return;
  if (code !== 0 && task.status !== 'done') {
    task.status = 'error';
    // Keep whatever Claude itself reported: the result event carries the actual
    // explanation, and overwriting it with a bare exit code threw away the only
    // useful diagnostic the user had.
    task.error = task.error || `Claude Code exited with code ${code}`;
  }
  await finalizeTask(task);
}

// Spawn Claude Code and stream its events into the task. Resolves with the
// process exit code; the caller decides what a given phase does on close.
// When resumeSession is given, the prior conversation is continued (used to
// resume a paused task with full context intact).
function spawnClaude(task, { prompt, allowedTools, resumeSession }) {
  return new Promise((resolve, reject) => {
    const resolution = claudeBin.resolveClaudeCommand();
    const cliArgs = ['-p'];
    // A directly-executable binary takes the prompt in argv. A cmd.exe shim
    // cannot carry a multi-line prompt safely, so there it goes down stdin.
    if (!resolution.promptOnStdin) cliArgs.push(prompt);
    cliArgs.push(
      '--input-format',
      'text',
      '--output-format',
      'stream-json',
      '--verbose',
      '--allowedTools',
      allowedTools,
      '--max-turns',
      String(task.maxTurns)
    );
    if (resumeSession) cliArgs.push('--resume', resumeSession);
    if (task.model) cliArgs.push('--model', task.model);

    const { file, args, options } = claudeBin.spawnArgsFor(cliArgs, resolution);
    const child = deps.spawn(file, args, {
      cwd: taskWorkDir(task),
      env: process.env,
      ...options,
    });
    task.child = child;

    if (resolution.promptOnStdin && child.stdin) {
      // A broken pipe here just means the CLI exited early; the close handler
      // reports that, so it must not become an unhandled error event.
      child.stdin.on('error', () => {});
      child.stdin.end(prompt);
    }

    let buffer = '';

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // last (possibly incomplete) line stays in buffer
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          // Non-JSON line (shouldn't normally happen) - surface as raw log.
          pushLog(task, line);
          continue;
        }
        // Deliberately outside the parse try/catch: a bug in our own event
        // handling should surface, not be silently logged as CLI output.
        handleEvent(task, event);
      }
    });

    child.stderr.on('data', (chunk) => {
      pushLog(task, `[stderr] ${chunk.toString().trim()}`);
    });

    child.on('close', (code) => {
      task.child = null;
      resolve(code);
    });

    child.on('error', (err) => reject(err));
  });
}

function handleEvent(task, event) {
  // Capture the session id (emitted on the init/system and result events) so a
  // paused or interrupted task can later be resumed with its full context.
  if (event.session_id && event.session_id !== task.sessionId) {
    task.sessionId = event.session_id;
    persistPending(task); // once per run: makes the run resumable after a crash
  }

  if (event.type === 'assistant' && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === 'tool_use') {
        task.currentActivity = friendlyToolLine(block.name, block.input);
        pushLog(task, task.currentActivity);
      } else if (block.type === 'text' && block.text?.trim()) {
        pushLog(task, block.text.trim());
      }
    }
    emitUpdate(task);
  } else if (event.type === 'result') {
    task.numTurns = event.num_turns ?? task.numTurns;
    // If the user halted the run, a late result event must not revive it.
    if (HALTED.has(task.status)) return;
    if (task.phase === 'plan') {
      task.plan = event.result || null;
      task.status = event.is_error ? 'error' : 'awaiting-approval';
      if (event.is_error) task.error = event.result || 'Claude Code reported an error while planning.';
    } else {
      task.summary = event.result || null;
      task.status = event.is_error ? 'error' : 'done';
      if (event.is_error) task.error = event.result || 'Claude Code reported an error.';
    }
    emitUpdate(task);
  }
}

async function finalizeTask(task) {
  task.finishedAt = Date.now();
  if (task.status === 'running') task.status = 'done';

  // Only an implementation run has changes of its own. A planning run works in
  // the main checkout, so inspecting the tree here would report the user's own
  // uncommitted edits as though this task had made them.
  const implemented = task.phase === 'implement' && Boolean(task.worktreePath);
  if (!implemented) {
    task.filesChanged = [];
    persistPending(task);
    pushLog(task, `Finished (${task.status}).`);
    emitUpdate(task);
    return;
  }

  try {
    // Scoped to this task's worktree, so it reports only this ticket's changes.
    const changed = (await git(taskWorkDir(task), ['status', '--short'])).trim();
    task.filesChanged = changed ? changed.split('\n') : [];
  } catch {
    task.filesChanged = [];
  }

  // Warn when this run changed dependency manifests: the worktree's
  // node_modules is a link to the main checkout's, so it no longer matches.
  if (deps.worktrees.dependenciesStale(task.filesChanged)) {
    pushLog(
      task,
      'This run changed a dependency manifest. node_modules is shared with your main checkout, so install dependencies inside the worktree before trusting test results.'
    );
  }

  // Record every terminal run, not just successful ones: a stopped or failed
  // run still left real edits in a real worktree, and only saving 'done' made
  // that work unfindable from the dashboard.
  {
    try {
      const diff = await getDiff(task);
      deps.store.save({
        id: task.id,
        ticketKey: task.ticketKey,
        ticketSummary: task.ticketSummary,
        ticket: task.ticket || null,
        branch: task.branch,
        // Persisted so later actions (iterate, open in VS Code) operate on the
        // repo and worktree this run actually used, not whatever project happens
        // to be configured at that later time.
        repoPath: task.repoPath || null,
        baseBranch: task.baseBranch || null,
        worktreePath: task.worktreePath || null,
        status: task.status,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
        numTurns: task.numTurns,
        summary: task.summary,
        error: task.error || null,
        filesChanged: task.filesChanged,
        referenceFiles: task.referenceFiles || [],
        // Cumulative state of the branch...
        diff,
        // ...plus one immutable snapshot per run, so iterating never overwrites
        // what an earlier run produced.
        diffSnapshot: {
          at: task.finishedAt,
          status: task.status,
          summary: task.summary || null,
          diff,
        },
        // Persisted so a finished run can be iterated on later (even after a
        // restart): the Claude session is resumable by id, plus the branch and
        // model needed to continue it. See iterateTask().
        sessionId: task.sessionId || null,
        model: task.model || null,
      });
      task.saved = true;
    } catch (err) {
      pushLog(task, `Could not save implementation record: ${err.message}`);
    }
  }

  persistPending(task); // finished — remove the parked on-disk copy
  pushLog(task, `Finished (${task.status}). Branch: ${task.branch}`);
  emitUpdate(task);

  if (task.status === 'done') {
    notifyTelegram(
      `✅ Implementation finished: ${task.ticketKey} — ${task.ticketSummary}\n` +
        `Branch: ${task.branch}\n\n${forNotification(task.summary)}`
    );
  } else if (task.status === 'error') {
    notifyTelegram(
      `❌ Implementation failed: ${task.ticketKey} — ${task.ticketSummary}\n\n${forNotification(task.error)}`
    );
  }

  if (settings.get().commentOnJira) {
    if (task.status === 'done') {
      commentOnJira(
        task.ticketKey,
        `Implemented on branch ${task.branch}.\n\n${forNotification(task.summary, 1500)}`
      );
    } else if (task.status === 'error') {
      commentOnJira(
        task.ticketKey,
        `The implementation attempt on branch ${task.branch} failed.\n\n${forNotification(task.error, 1500)}`
      );
    }
  }
}

function getTask(id) {
  return tasks.get(id);
}

// Snapshots of tasks that are still in flight, so a freshly loaded page can
// reconnect to work that is already running (survives a browser reload).
function listActive() {
  const active = [];
  for (const task of tasks.values()) {
    // Include paused tasks so a reloaded page can reconnect and resume them.
    if (!TERMINAL.has(task.status)) {
      active.push(snapshot(task));
    }
  }
  return active;
}

// The commit this run branched from, so the diff covers the whole branch.
async function diffBase(dir, base) {
  for (const ref of [`origin/${base}`, base]) {
    const res = await execGit(dir, ['merge-base', 'HEAD', ref]);
    if (res.code === 0 && res.stdout.trim()) return res.stdout.trim();
  }
  return null;
}

// Unified diff of everything this run changed, including new (untracked) files.
//
// Diffed against the merge-base with the base branch rather than the working
// tree alone. A plain `git diff` shows only unstaged edits, so it silently lost
// anything the user had staged, and went completely blank the moment they
// committed the work — which is exactly when they'd iterate on it.
//
// This never mutates the git index (an earlier version staged untracked files
// with `git add -N .` then `git reset -q`, which could race with the user's own
// `git add`): tracked changes come from `git diff <base-commit>`, and each
// untracked file is diffed individually against /dev/null via `--no-index`,
// which reads the working tree only.
async function getDiff(task) {
  const dir = taskWorkDir(task);
  try {
    const base = await diffBase(dir, taskBaseBranch(task));
    // Without a base ref (e.g. a repo with no commits yet) fall back to HEAD,
    // which still includes staged changes.
    const tracked = await git(dir, ['diff', '--no-color', base || 'HEAD']);

    const statusOut = await git(dir, ['status', '--porcelain', '--untracked-files=all', '-z']);
    const untrackedFiles = statusOut
      .split('\0')
      .filter((entry) => entry.startsWith('?? '))
      .map((entry) => entry.slice(3))
      .filter(Boolean);

    let untrackedDiff = '';
    for (const file of untrackedFiles) {
      const res = await execGit(dir, ['diff', '--no-color', '--no-index', '--', '/dev/null', file]);
      // --no-index exits 1 when it (correctly) finds a difference; only >1 is a real failure.
      if (res.code > 1) {
        pushLog(task, `Could not diff untracked file ${file}: ${res.message || res.stderr || 'unknown error'}`);
        continue;
      }
      untrackedDiff += res.stdout;
    }
    return tracked + untrackedDiff;
  } catch (err) {
    pushLog(task, `Could not compute diff: ${err.message}`);
    return '';
  }
}

// ---- Worktree housekeeping --------------------------------------------

// Worktrees for the configured repo, annotated with whether their branch has
// already landed in the base branch (so the UI can flag ones safe to clean up).
async function listWorktrees(repo = repoPath(), base = baseBranch()) {
  if (!repo) return [];
  const root = deps.worktrees.rootFor(repo);
  const all = await deps.worktrees.list(deps.execFile, repo);
  const ours = all.filter((w) => w.path && w.path.startsWith(root));
  return Promise.all(
    ours.map(async (w) => ({
      ...w,
      merged: await deps.worktrees.isMerged(deps.execFile, repo, w.branch, base),
    }))
  );
}

// Remove a run's worktree. Never automatic: uncommitted work is only discarded
// when the caller explicitly forces it.
async function removeWorktree({ worktreePath, repo = repoPath(), force = false }) {
  return withGitLock(() => deps.worktrees.remove(deps.execFile, { repoPath: repo, worktreePath, force }));
}

function spawnVSCode(dir, onError) {
  // Not `shell: true`: Node does not quote array-form arguments for the shell
  // it hands them to, so a directory containing a space — e.g. worktrees
  // under a "My Projects" folder — silently split into two arguments. `code`
  // then received "C:\Users\you\My" and "Projects\...\PROJ-101" as separate
  // paths, neither of which existed, and opened two blank untitled tabs named
  // after them instead of the real folder. claudeBin's resolver + quoter (already proven for the
  // `claude` CLI, which has the exact same "resolve a possible .cmd shim"
  // problem) handles this correctly instead.
  const resolution = claudeBin.resolveCommand('code');
  const { file, args, options } = claudeBin.spawnArgsFor([dir], resolution);
  const child = deps.spawn(file, args, { detached: true, stdio: 'ignore', ...options });
  // An unhandled 'error' event on a ChildProcess would crash the whole server, so swallow it.
  child.on('error', onError);
  child.unref();
}

function openInVSCode(task) {
  spawnVSCode(taskWorkDir(task), (err) => {
    pushLog(
      task,
      `Could not open VS Code (${err.message}). Make sure the 'code' command is installed ` +
        `(VS Code: Ctrl+Shift+P -> "Shell Command: Install 'code' command in PATH").`
    );
  });
}

// Open a directory without needing a live in-memory task (used by the history
// view, which may outlive the server process that ran the task).
function openDir(dir) {
  const target = dir || repoPath();
  if (!target) return { ok: false, error: 'No project selected.' };
  spawnVSCode(target, (err) => {
    console.warn(`Could not open VS Code: ${err.message}`);
  });
  return { ok: true, path: target };
}

// Stop every live child process and park its task so the run is resumable.
//
// Without this, quitting the server left orphaned `claude` processes still
// editing files in the background with no dashboard left to observe them.
async function shutdown() {
  const parked = [];
  for (const task of tasks.values()) {
    if (!task.child && !ACTIVE.has(task.status)) continue;
    killChild(task);
    task.status = 'paused';
    task.currentActivity = 'Interrupted by server shutdown.';
    task.log.push({ ts: Date.now(), text: 'Server shutting down — run interrupted. Press Continue to resume it.' });
    persistPending(task);
    parked.push(task.id);
  }
  return parked;
}

// Load any parked tasks from a previous run so they're immediately actionable.
hydratePending();

module.exports = {
  startTask,
  approveTask,
  cancelTask,
  stopTask,
  pauseTask,
  resumeTask,
  iterateTask,
  revisePlan,
  getTask,
  listActive,
  snapshot,
  metaSnapshot,
  __setDeps,
  openInVSCode,
  openDir,
  getDiff,
  listWorktrees,
  removeWorktree,
  shutdown,
  implementTools,
  bashPattern,
};
