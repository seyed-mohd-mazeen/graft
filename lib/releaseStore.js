const fs = require('fs');
const path = require('path');
const { writeJsonAtomic, readJson } = require('./jsonFile');

// Durable history of finished release runs. One JSON file per run under
// data/releases/, written once a run reaches a terminal state (done/error/
// cancelled). Unlike pendingStore.js there is no resume path here: a release
// run is a short, deterministic sequence of git calls rather than a
// multi-turn session, so a run interrupted by a server restart is simply
// gone — whatever had already been pushed to origin stays pushed, since push
// only ever happens once, at the very end, after every branch has been
// attempted.
const DATA_DIR = path.join(__dirname, '..', 'data', 'releases');

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function fileFor(id) {
  return path.join(DATA_DIR, `${id}.json`);
}

function save(record) {
  ensureDir();
  writeJsonAtomic(fileFor(record.id), record);
  return record;
}

function get(id) {
  return readJson(fileFor(id), null);
}

// Newest first, for the "Recent releases" list.
function list() {
  ensureDir();
  const out = [];
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (!name.endsWith('.json')) continue;
    const rec = readJson(path.join(DATA_DIR, name), null);
    if (!rec || !rec.id) continue;
    out.push(rec);
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
