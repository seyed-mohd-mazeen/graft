const fs = require('fs');
const path = require('path');
const { writeJsonAtomic, readJson } = require('./jsonFile');

// Durable store for tasks that have not reached a terminal state. Two kinds
// live here:
//
//  - Parked on the user: 'awaiting-approval' (a plan is drafted and ready) or
//    'paused'. These have no live process and are resumed on demand.
//  - Actively running: 'planning' / 'branching' / 'running'. Their child process
//    cannot survive a restart, but the Claude session id can — so persisting
//    them means a killed server no longer silently loses the run (and the
//    orphaned edits it left in a worktree). On startup these are rehydrated as
//    'paused' so the user can resume them with full conversation context.
const DATA_DIR = path.join(__dirname, '..', 'data', 'pending');

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function fileFor(id) {
  return path.join(DATA_DIR, `${id}.json`);
}

// The subset of a task that is worth persisting (everything except the live
// EventEmitter / child process handles).
function serialize(task) {
  return {
    id: task.id,
    ticketKey: task.ticketKey,
    ticketSummary: task.ticketSummary,
    ticket: task.ticket,
    model: task.model || null,
    // Persisted so a restart doesn't lose the repo/base-branch this task was
    // pinned to when it was created (see claudeRunner.js's taskRepoPath()).
    repoPath: task.repoPath || null,
    baseBranch: task.baseBranch || null,
    branch: task.branch || null,
    // The isolated worktree this task implements in, so a resumed task keeps
    // writing to its own checkout rather than the user's.
    worktreePath: task.worktreePath || null,
    phase: task.phase,
    status: task.status,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt || null,
    numTurns: task.numTurns,
    maxTurns: task.maxTurns,
    currentActivity: task.currentActivity,
    filesChanged: task.filesChanged || [],
    referenceFiles: task.referenceFiles || [],
    plan: task.plan || null,
    summary: task.summary || null,
    error: task.error || null,
    sessionId: task.sessionId || null,
    log: task.log || [],
  };
}

function save(task) {
  ensureDir();
  writeJsonAtomic(fileFor(task.id), serialize(task));
}

function remove(id) {
  try {
    fs.unlinkSync(fileFor(id));
    return true;
  } catch {
    return false;
  }
}

// All persisted pending tasks (plain objects; caller rehydrates them).
function list() {
  ensureDir();
  const out = [];
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (!name.endsWith('.json')) continue;
    const rec = readJson(path.join(DATA_DIR, name), null);
    // Skip corrupt files rather than failing startup.
    if (rec && rec.id) out.push(rec);
  }
  return out;
}

module.exports = { save, remove, list };
