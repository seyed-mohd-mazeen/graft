import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'settings.json');

// These tests mutate the real settings file, so preserve and restore it.
const original = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : null;

test.after(() => {
  if (original === null) fs.rmSync(FILE, { force: true });
  else fs.writeFileSync(FILE, original, 'utf8');
});

const settings = require('../lib/settings.js');

test('update merges a partial patch and persists it', () => {
  settings.update({ baseBranch: 'develop' });
  assert.equal(settings.get().baseBranch, 'develop');
  const onDisk = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  assert.equal(onDisk.baseBranch, 'develop');
});

test('get returns a copy, so callers cannot mutate the cache', () => {
  const a = settings.get();
  a.baseBranch = 'tampered';
  assert.notEqual(settings.get().baseBranch, 'tampered');
});

test('an external edit to the file is picked up without a restart', () => {
  settings.update({ baseBranch: 'first' });
  assert.equal(settings.get().baseBranch, 'first');

  // Hand-editing data/settings.json is a natural thing to do when debugging
  // config; with a permanent in-process cache it silently did nothing.
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  raw.baseBranch = 'edited-by-hand';
  // Bump mtime explicitly: the write can land inside the same millisecond.
  fs.writeFileSync(FILE, JSON.stringify(raw, null, 2), 'utf8');
  const later = new Date(Date.now() + 2000);
  fs.utimesSync(FILE, later, later);

  assert.equal(settings.get().baseBranch, 'edited-by-hand');
});

test('turn budgets fall back to defaults when unset or nonsense', () => {
  settings.update({ maxTurns: undefined, planMaxTurns: undefined });
  assert.equal(settings.maxTurns(), settings.DEFAULT_MAX_TURNS);
  assert.equal(settings.planMaxTurns(), settings.DEFAULT_PLAN_MAX_TURNS);

  settings.update({ maxTurns: 0, planMaxTurns: -5 });
  assert.equal(settings.maxTurns(), settings.DEFAULT_MAX_TURNS, '0 is not a usable budget');
  assert.equal(settings.planMaxTurns(), settings.DEFAULT_PLAN_MAX_TURNS);

  settings.update({ maxTurns: 'twelve' });
  assert.equal(settings.maxTurns(), settings.DEFAULT_MAX_TURNS);

  settings.update({ maxTurns: 45, planMaxTurns: 12.7 });
  assert.equal(settings.maxTurns(), 45, 'a valid override is honoured');
  assert.equal(settings.planMaxTurns(), 12, 'fractional budgets are floored');
});

test('verification commands are stored per repo, not globally', () => {
  settings.update({ projectCommands: {} });
  settings.setCommandsFor('C:/repos/alpha', { lint: 'npm run lint', test: 'npm test' });
  settings.setCommandsFor('C:/repos/beta', { lint: '', test: 'pytest -q' });

  assert.deepEqual(settings.commandsFor('C:/repos/alpha'), { lint: 'npm run lint', test: 'npm test' });
  assert.deepEqual(settings.commandsFor('C:/repos/beta'), { lint: '', test: 'pytest -q' });
  // One repo's tooling must never be granted to another.
  assert.deepEqual(settings.commandsFor('C:/repos/gamma'), { lint: '', test: '' });
  assert.deepEqual(settings.commandsFor(''), { lint: '', test: '' });
  assert.deepEqual(settings.commandsFor(undefined), { lint: '', test: '' });
});

test('commandsFor trims whitespace and tolerates non-string values', () => {
  settings.update({ projectCommands: { 'C:/r': { lint: '  npm run lint  ', test: 42 } } });
  assert.deepEqual(settings.commandsFor('C:/r'), { lint: 'npm run lint', test: '' });
});

test('setCommandsFor leaves other repos untouched', () => {
  settings.update({ projectCommands: {} });
  settings.setCommandsFor('C:/a', { lint: 'a-lint', test: 'a-test' });
  settings.setCommandsFor('C:/b', { lint: 'b-lint', test: 'b-test' });
  settings.setCommandsFor('C:/a', { lint: 'a-lint-2', test: 'a-test-2' });
  assert.deepEqual(settings.commandsFor('C:/b'), { lint: 'b-lint', test: 'b-test' });
  assert.deepEqual(settings.commandsFor('C:/a'), { lint: 'a-lint-2', test: 'a-test-2' });
});
