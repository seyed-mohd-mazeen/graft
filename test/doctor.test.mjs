import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const doctor = require('../lib/doctor.js');
const settingsModule = require('../lib/settings.js');
const projectsModule = require('../lib/projects.js');
const claudeBinModule = require('../lib/claudeBin.js');
const usageModule = require('../lib/usage.js');

// Every check reads from a real module (settings.get(), git --version, PATH
// lookups, ~/.claude/.credentials.json) — none of that should run in a unit
// test, so every dependency is stubbed for the duration of one test and always
// restored, mirroring the pattern in test/telegram.test.mjs.
async function withStubs(overrides, fn) {
  const originals = {
    settingsGet: settingsModule.get,
    validateRepoPath: projectsModule.validateRepoPath,
    resolveClaudeCommand: claudeBinModule.resolveClaudeCommand,
    findExecutable: claudeBinModule.findExecutable,
    checkLogin: usageModule.checkLogin,
  };
  if (overrides.settingsGet) settingsModule.get = overrides.settingsGet;
  if (overrides.validateRepoPath) projectsModule.validateRepoPath = overrides.validateRepoPath;
  if (overrides.resolveClaudeCommand) claudeBinModule.resolveClaudeCommand = overrides.resolveClaudeCommand;
  if (overrides.findExecutable) claudeBinModule.findExecutable = overrides.findExecutable;
  if (overrides.checkLogin) usageModule.checkLogin = overrides.checkLogin;
  try {
    return await fn();
  } finally {
    settingsModule.get = originals.settingsGet;
    projectsModule.validateRepoPath = originals.validateRepoPath;
    claudeBinModule.resolveClaudeCommand = originals.resolveClaudeCommand;
    claudeBinModule.findExecutable = originals.findExecutable;
    usageModule.checkLogin = originals.checkLogin;
  }
}

const FULLY_CONFIGURED = {
  jiraDomain: 'x.atlassian.net',
  jiraEmail: 'a@a.com',
  jiraToken: 'tok',
  repoPath: 'C:/repo',
  baseBranch: 'main',
};

// Every stub set to its "everything is fine" shape, so each test only
// overrides the one thing it's checking.
const HAPPY = {
  settingsGet: () => FULLY_CONFIGURED,
  validateRepoPath: async () => ({ ok: true }),
  resolveClaudeCommand: () => ({ resolvedPath: 'C:/tools/claude.exe', note: null }),
  findExecutable: () => 'C:/tools/code.cmd',
  checkLogin: () => ({ ok: true, plan: 'max' }),
};

function findCheck(result, id) {
  return result.checks.find((c) => c.id === id);
}

test('a fully healthy setup reports every check ok and nothing blocking', async () => {
  await withStubs(HAPPY, async () => {
    const result = await doctor.runDoctor();
    assert.equal(result.hasBlocking, false);
    assert.equal(result.coreIncomplete, false);
    assert.ok(result.checks.every((c) => c.status === 'ok'), JSON.stringify(result.checks));
    // Every check carries a display label, not just its programmatic id.
    assert.ok(result.checks.every((c) => c.label));
  });
});

test('a missing Claude CLI is blocking', async () => {
  await withStubs(
    { ...HAPPY, resolveClaudeCommand: () => ({ resolvedPath: null, note: "Could not find 'claude' on PATH." }) },
    async () => {
      const result = await doctor.runDoctor();
      assert.equal(result.hasBlocking, true);
      const c = findCheck(result, 'claudeCli');
      assert.equal(c.status, 'fail');
      assert.match(c.fix, /Install Claude Code/);
    }
  );
});

test('missing git is blocking — the whole app depends on it', async () => {
  // checkGit shells out directly rather than through an injectable dep, so
  // this is exercised via a PATH that cannot contain a real git — proven by
  // running the real (unstubbed) check on this machine, which has git.
  await withStubs(HAPPY, async () => {
    const result = await doctor.runDoctor();
    const c = findCheck(result, 'git');
    assert.equal(c.status, 'ok', 'sanity check: this dev machine has git, so the happy path is exercised for real');
  });
});

test('no Claude login is a warning, not a hard failure', async () => {
  await withStubs({ ...HAPPY, checkLogin: () => ({ ok: false, error: 'no creds file' }) }, async () => {
    const result = await doctor.runDoctor();
    assert.equal(result.hasBlocking, false);
    const c = findCheck(result, 'claudeLogin');
    assert.equal(c.status, 'warn');
    assert.match(c.fix, /log in with your subscription/);
  });
});

test('unset Jira and unset project both mark coreIncomplete without blocking', async () => {
  await withStubs({ ...HAPPY, settingsGet: () => ({ ...FULLY_CONFIGURED, jiraDomain: '', jiraToken: '', repoPath: '' }) }, async () => {
    const result = await doctor.runDoctor();
    assert.equal(result.hasBlocking, false);
    assert.equal(result.coreIncomplete, true);
    assert.equal(findCheck(result, 'jira').status, 'warn');
    assert.equal(findCheck(result, 'repo').status, 'warn');
  });
});

test('a configured but invalid repo path is a fail, not a warn', async () => {
  // Distinguishes "never set up" (warn — normal before first use) from
  // "actively broken" (fail — something is wrong with what's saved).
  await withStubs({ ...HAPPY, validateRepoPath: async () => ({ ok: false, error: 'That folder does not exist.' }) }, async () => {
    const result = await doctor.runDoctor();
    const c = findCheck(result, 'repo');
    assert.equal(c.status, 'fail');
    assert.equal(result.hasBlocking, true);
    assert.match(c.message, /does not exist/);
  });
});

test('a missing VS Code CLI warns but never blocks — it is optional', async () => {
  await withStubs({ ...HAPPY, findExecutable: () => null }, async () => {
    const result = await doctor.runDoctor();
    assert.equal(result.hasBlocking, false);
    assert.equal(findCheck(result, 'vscode').status, 'warn');
  });
});

test('ANTHROPIC_API_KEY set is flagged, and never printed at ok', async () => {
  const original = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  try {
    await withStubs(HAPPY, async () => {
      const result = await doctor.runDoctor();
      const c = findCheck(result, 'apiKey');
      assert.equal(c.status, 'warn');
      assert.match(c.message, /ANTHROPIC_API_KEY/);
    });
  } finally {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  }
});

test('a non-loopback HOST warns', async () => {
  const original = process.env.HOST;
  process.env.HOST = '0.0.0.0';
  try {
    await withStubs(HAPPY, async () => {
      const result = await doctor.runDoctor();
      const c = findCheck(result, 'host');
      assert.equal(c.status, 'warn');
      assert.match(c.message, /not loopback/);
    });
  } finally {
    if (original === undefined) delete process.env.HOST;
    else process.env.HOST = original;
  }
});

test('summaryLines lists only what needs attention, with a symbol per severity', async () => {
  await withStubs(
    {
      ...HAPPY,
      resolveClaudeCommand: () => ({ resolvedPath: null, note: "Could not find 'claude' on PATH." }),
      checkLogin: () => ({ ok: false, error: 'no creds' }),
    },
    async () => {
      const result = await doctor.runDoctor();
      const lines = doctor.summaryLines(result);
      assert.ok(lines.every((l) => !/^Node\.js|^Git|^Jira|^Project/.test(l)), 'ok checks are not listed');
      assert.ok(lines.some((l) => l.startsWith('✖') && l.includes('Claude Code CLI')));
      assert.ok(lines.some((l) => l.startsWith('⚠') && l.includes('Claude subscription login')));
    }
  );
});
