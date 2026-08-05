import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// store.js resolves its data directory relative to the module, so each test run
// gets a throwaway copy of the module loaded against a temp HOME-like layout.
// Simpler: exercise the real module and clean up the records it writes.
const store = require('../lib/store.js');

const ids = [];
function newId(label) {
  const id = `test-${label}-${process.pid}-${ids.length}`;
  ids.push(id);
  return id;
}

test.after(() => {
  for (const id of ids) store.remove(id);
});

test('save/get/remove round-trips a record', () => {
  const id = newId('roundtrip');
  store.save({ id, ticketKey: 'TST-1', status: 'done', filesChanged: ['M a.txt'] });
  const rec = store.get(id);
  assert.equal(rec.ticketKey, 'TST-1');
  assert.equal(rec.status, 'done');
  assert.ok(store.remove(id));
  assert.equal(store.get(id), null);
});

test('get returns null for an unknown id instead of throwing', () => {
  assert.equal(store.get('definitely-not-a-record'), null);
});

test('save appends each run’s diffSnapshot rather than overwriting the diff', () => {
  const id = newId('snapshots');
  store.save({
    id,
    ticketKey: 'TST-2',
    status: 'done',
    startedAt: 1000,
    diff: 'FIRST-CUMULATIVE',
    diffSnapshot: { at: 1, status: 'done', diff: 'FIRST-RUN' },
  });
  // An iteration reuses the same id. A blind overwrite replaced the original
  // captured diff with the (much smaller) diff of just this latest run.
  store.save({
    id,
    ticketKey: 'TST-2',
    status: 'done',
    startedAt: 5000,
    diff: 'SECOND-CUMULATIVE',
    diffSnapshot: { at: 2, status: 'done', diff: 'SECOND-RUN' },
  });

  const rec = store.get(id);
  assert.equal(rec.diffs.length, 2, 'both runs are retained');
  assert.equal(rec.diffs[0].diff, 'FIRST-RUN');
  assert.equal(rec.diffs[1].diff, 'SECOND-RUN');
  assert.equal(rec.diff, 'SECOND-CUMULATIVE', 'the cumulative diff tracks the latest state');
  assert.equal(rec.startedAt, 1000, "the run's original start time survives later saves");
  assert.ok(!('diffSnapshot' in rec), 'the transient field is not persisted');
});

test('save merges over an existing record instead of replacing it', () => {
  const id = newId('merge');
  store.save({ id, ticketKey: 'TST-3', status: 'error', branch: 'feature/x', sessionId: 'sess-1' });
  store.save({ id, ticketKey: 'TST-3', status: 'done' });
  const rec = store.get(id);
  assert.equal(rec.status, 'done', 'supplied fields win');
  assert.equal(rec.branch, 'feature/x', 'omitted fields keep their prior value');
  assert.equal(rec.sessionId, 'sess-1');
});

test('list exposes status and skips corrupt files', () => {
  const id = newId('list');
  store.save({ id, ticketKey: 'TST-4', status: 'stopped', finishedAt: 42, filesChanged: ['M a', 'M b'] });

  // A crash mid-write used to be able to leave a truncated file behind; the
  // listing must skip it rather than fail entirely.
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'implementations');
  const corrupt = path.join(dir, `test-corrupt-${process.pid}.json`);
  fs.writeFileSync(corrupt, '{ this is not json', 'utf8');

  try {
    const items = store.list();
    const mine = items.find((i) => i.id === id);
    assert.ok(mine, 'the good record is listed');
    // Carried so the board can tell a finished run from a stopped or failed one.
    assert.equal(mine.status, 'stopped');
    assert.equal(mine.fileCount, 2);
    assert.ok(!items.some((i) => i.id === undefined), 'no entries from unreadable files');
  } finally {
    fs.rmSync(corrupt, { force: true });
  }
});

test('writes are atomic: no temp file is left behind', () => {
  const id = newId('atomic');
  store.save({ id, ticketKey: 'TST-5', status: 'done' });
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'implementations');
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes(id) && f.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], 'the temp file is renamed into place, not left around');
});

test('an unwritable target surfaces as an error rather than a truncated file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-runner-json-'));
  const { writeJsonAtomic } = require('../lib/jsonFile.js');
  const target = path.join(tmp, 'nested', 'file.json');
  writeJsonAtomic(target, { ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { ok: true });
  // A value JSON.stringify cannot handle must not clobber the existing file.
  const circular = {};
  circular.self = circular;
  assert.throws(() => writeJsonAtomic(target, circular));
  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { ok: true }, 'previous contents intact');
  fs.rmSync(tmp, { recursive: true, force: true });
});
