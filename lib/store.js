const fs = require('fs');
const path = require('path');
const { writeJsonAtomic, readJson } = require('./jsonFile');

// Durable record of implemented tickets. One JSON file per run under data/,
// so a server restart (which clears the in-memory task map) doesn't lose the
// history of what was changed. Fine for a single-user local tool.
//
// Every terminal run is recorded, not just successful ones: a stopped or failed
// run still left real edits in a real worktree, and dropping it from disk made
// that work invisible (you couldn't find the branch again from the dashboard).
const DATA_DIR = path.join(__dirname, '..', 'data', 'implementations');

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function fileFor(id) {
  return path.join(DATA_DIR, `${id}.json`);
}

// Persist a run record, merging over any record already stored under this id.
//
// Merging matters because iterating on a finished run reuses the run's id: a
// blind overwrite replaced the original captured diff with the (much smaller)
// diff of just the latest iteration. `diffs` accumulates one snapshot per run
// so nothing is ever lost, and fields the caller omits keep their prior value.
function save(record) {
  ensureDir();
  const existing = get(record.id) || {};
  const merged = { ...existing, ...record };

  const priorDiffs = Array.isArray(existing.diffs) ? existing.diffs : [];
  const snapshot = record.diffSnapshot;
  merged.diffs = snapshot ? [...priorDiffs, snapshot] : priorDiffs;
  delete merged.diffSnapshot;

  // Keep the run's original start time even though later iterations re-save it.
  if (existing.startedAt) merged.startedAt = existing.startedAt;

  writeJsonAtomic(fileFor(record.id), merged);
  return merged;
}

// Full record for one implementation, or null if unknown.
function get(id) {
  return readJson(fileFor(id), null);
}

// Lightweight list for the board — metadata only, newest first, no diff text.
function list() {
  ensureDir();
  const out = [];
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (!name.endsWith('.json')) continue;
    const rec = readJson(path.join(DATA_DIR, name), null);
    // Skip unreadable/corrupt files rather than failing the whole list.
    if (!rec || !rec.id) continue;
    out.push({
      id: rec.id,
      ticketKey: rec.ticketKey,
      ticketSummary: rec.ticketSummary,
      branch: rec.branch,
      // Carried so the board can distinguish a finished run from one that was
      // stopped or errored, instead of filing all three under "Done".
      status: rec.status || 'done',
      finishedAt: rec.finishedAt,
      worktreePath: rec.worktreePath || null,
      fileCount: Array.isArray(rec.filesChanged) ? rec.filesChanged.length : 0,
      iterations: Array.isArray(rec.diffs) ? rec.diffs.length : 0,
    });
  }
  out.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  return out;
}

function remove(id) {
  try {
    fs.unlinkSync(fileFor(id));
    return true;
  } catch {
    return false;
  }
}

module.exports = { save, get, list, remove };
