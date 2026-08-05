import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const usage = require('../lib/usage.js');

// checkLogin() reads ~/.claude/.credentials.json by default — this machine's
// real Claude Code login, shared with every other tool that uses it. These
// tests never touch that file: checkLogin() takes an optional path override
// specifically so this can be exercised against a disposable one instead.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-runner-creds-'));
const credPath = path.join(dir, '.credentials.json');

test.after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test('checkLogin is offline — it does not depend on the network', async () => {
  // Fails loudly if checkLogin ever grows a fetch() call: the doctor/setup
  // check needs a fast, always-available signal, not a round trip.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('checkLogin must not call fetch');
  };
  try {
    usage.checkLogin(credPath); // must not throw or hang
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('checkLogin reports ok when a valid credentials file exists', () => {
  fs.writeFileSync(credPath, JSON.stringify({ claudeAiOauth: { accessToken: 'tok', subscriptionType: 'max' } }));
  assert.deepEqual(usage.checkLogin(credPath), { ok: true, plan: 'max' });
});

test('checkLogin reports ok with no plan name when subscriptionType is absent', () => {
  fs.writeFileSync(credPath, JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } }));
  assert.deepEqual(usage.checkLogin(credPath), { ok: true, plan: null });
});

test('checkLogin reports not-ok when the credentials file is missing', () => {
  const missing = path.join(dir, 'does-not-exist.json');
  const result = usage.checkLogin(missing);
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('checkLogin reports not-ok when the file has no access token', () => {
  fs.writeFileSync(credPath, JSON.stringify({ claudeAiOauth: {} }));
  assert.equal(usage.checkLogin(credPath).ok, false);
});

test('checkLogin reports not-ok on unparseable JSON, without throwing', () => {
  fs.writeFileSync(credPath, '{ not json');
  assert.doesNotThrow(() => usage.checkLogin(credPath));
  assert.equal(usage.checkLogin(credPath).ok, false);
});

test('checkLogin still defaults to the real credentials path when called with no argument', () => {
  // Not exercising file contents (that would touch the real file) — just
  // confirming the default parameter didn't silently break and start
  // requiring an explicit path.
  assert.doesNotThrow(() => usage.checkLogin());
});
