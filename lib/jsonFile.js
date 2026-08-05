const fs = require('fs');
const path = require('path');

// Crash-safe JSON persistence shared by settings.js, store.js and pendingStore.js.
//
// A plain fs.writeFileSync truncates the target before writing, so a crash (or a
// full disk) mid-write leaves a half-written file behind. Because every reader
// here treats unparseable JSON as "absent", that silently loses whatever the
// file held — your Jira token, a saved implementation, a parked plan. Writing to
// a sibling temp file and renaming makes the swap atomic: readers see either the
// old contents or the new ones, never a truncated mix.
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Same directory as the target: rename() is only atomic within a filesystem.
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* nothing to clean up */
    }
    throw err;
  }
}

// Parse a JSON file, returning `fallback` when it is missing or unreadable.
function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = { writeJsonAtomic, readJson };
