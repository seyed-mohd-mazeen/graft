const childProcess = require('child_process');
const { promisify } = require('util');
const settings = require('./settings');
const projects = require('./projects');
const claudeBin = require('./claudeBin');
const usage = require('./usage');

const execFileAsync = promisify(childProcess.execFile);

// Setup diagnostics, run at startup and exposed via GET /api/doctor.
//
// Without this, a broken piece of setup (Claude CLI not on PATH, not logged
// in, git missing, no Jira token) only surfaces once someone clicks
// "Implement" and gets a confusing failure deep inside a task. Every teammate
// who clones this repo does their own independent setup — this is the thing
// that tells them what's wrong, in plain language, before they hit it.
//
// Each check returns { id, status: 'ok' | 'warn' | 'fail', message, fix? }.
// 'fail' means the app cannot function at all (no Claude CLI, no git).
// 'warn' means a feature is unavailable until fixed (no Jira, no project
// selected, VS Code CLI missing) but the rest of the app still works.

function ok(id, message) {
  return { id, status: 'ok', message };
}
function warn(id, message, fix) {
  return { id, status: 'warn', message, fix };
}
function fail(id, message, fix) {
  return { id, status: 'fail', message, fix };
}

const MIN_NODE_MAJOR = 18;

function checkNode() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    return fail(
      'node',
      `Node ${process.versions.node} is older than the required v${MIN_NODE_MAJOR}+.`,
      'Install a current Node.js LTS release from nodejs.org and restart the server.'
    );
  }
  return ok('node', `Node ${process.versions.node}`);
}

function checkApiKey() {
  if (process.env.ANTHROPIC_API_KEY) {
    return warn(
      'apiKey',
      'ANTHROPIC_API_KEY is set in this environment.',
      'Claude Code will bill against API credits instead of your subscription while it is set. Remove it from your shell profile or .env unless that is what you want.'
    );
  }
  return ok('apiKey', 'Billing against your Claude subscription (no API key override).');
}

// Uses the exact same resolution claudeRunner spawns with, so this check can
// never say "found" while a real run says "not found" (or vice versa).
function checkClaudeCli() {
  const resolution = claudeBin.resolveClaudeCommand();
  if (resolution.note && /Could not find/.test(resolution.note)) {
    return fail(
      'claudeCli',
      "Could not find the 'claude' CLI on PATH.",
      'Install Claude Code (https://claude.com/claude-code) and confirm `claude --version` works in a terminal, then restart this server.'
    );
  }
  return ok('claudeCli', resolution.resolvedPath ? `Found at ${resolution.resolvedPath}` : 'Found on PATH.');
}

function checkClaudeLogin() {
  const result = usage.checkLogin();
  if (!result.ok) {
    return warn(
      'claudeLogin',
      "Could not confirm a Claude Code subscription login.",
      'Run `claude` in a terminal and log in with your subscription (not an API key) before implementing a ticket.'
    );
  }
  return ok('claudeLogin', result.plan ? `Logged in (${result.plan} plan).` : 'Logged in.');
}

async function checkGit() {
  try {
    const { stdout } = await execFileAsync('git', ['--version']);
    return ok('git', stdout.trim());
  } catch {
    return fail(
      'git',
      'git is not installed, or not on PATH.',
      'Install Git and confirm `git --version` works in a terminal, then restart this server.'
    );
  }
}

// Soft check: only needed for the "Open in VS Code" button, so a miss is a
// warning, never a fail.
function checkVSCode() {
  const found = claudeBin.findExecutable('code');
  if (!found) {
    return warn(
      'vscode',
      "The 'code' command is not on PATH.",
      'Optional — only needed for the "Open in VS Code" button. In VS Code: Cmd/Ctrl+Shift+P → "Shell Command: Install \'code\' command in PATH".'
    );
  }
  return ok('vscode', `Found at ${found}`);
}

function checkJira(s) {
  if (!s.jiraDomain || !s.jiraEmail || !s.jiraToken) {
    return warn('jira', 'Jira is not configured.', 'Add your domain, email, and API token in Settings before the board can load tickets.');
  }
  return ok('jira', `Connected as ${s.jiraEmail} on ${s.jiraDomain}.`);
}

async function checkRepo(s) {
  if (!s.repoPath) {
    return warn('repo', 'No project selected.', 'Choose a project in Settings before implementing a ticket.');
  }
  const check = await projects.validateRepoPath(s.repoPath);
  if (!check.ok) {
    return fail('repo', `The configured project is invalid: ${check.error}`, 'Re-select a project in Settings.');
  }
  return ok('repo', s.repoPath);
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function checkHost() {
  const host = process.env.HOST || '127.0.0.1';
  if (!LOOPBACK_HOSTS.has(host)) {
    return warn(
      'host',
      `HOST=${host} is not loopback — this server is reachable beyond your own machine.`,
      'This server runs Claude with write access to your repos and has no login of its own. Only do this if you understand the exposure.'
    );
  }
  return ok('host', 'Bound to loopback only — not reachable from the network.');
}

// Display labels, kept separate from the ids used for programmatic access
// (e.g. deciding whether the "finish setup" banner should show).
const LABELS = {
  node: 'Node.js',
  apiKey: 'Billing mode',
  claudeCli: 'Claude Code CLI',
  claudeLogin: 'Claude subscription login',
  git: 'Git',
  vscode: 'VS Code CLI',
  jira: 'Jira',
  repo: 'Project',
  host: 'Network exposure',
};

async function runDoctor() {
  const s = settings.get();
  const results = await Promise.all([
    checkNode(),
    checkApiKey(),
    checkClaudeCli(),
    checkClaudeLogin(),
    checkGit(),
    checkVSCode(),
    checkJira(s),
    checkRepo(s),
    checkHost(),
  ]);
  const checks = results.map((c) => ({ ...c, label: LABELS[c.id] || c.id }));
  return {
    checks,
    hasBlocking: checks.some((c) => c.status === 'fail'),
    // The board can't do anything useful without these two, even though
    // neither one is a hard 'fail' on its own (you might still be reading
    // the app before configuring anything).
    coreIncomplete: checks.some((c) => (c.id === 'jira' || c.id === 'repo') && c.status !== 'ok'),
  };
}

// Plain-text lines for the startup console log — everything except a clean 'ok'.
function summaryLines({ checks }) {
  return checks
    .filter((c) => c.status !== 'ok')
    .map((c) => `${c.status === 'fail' ? '✖' : '⚠'} ${c.label}: ${c.message}${c.fix ? ` — ${c.fix}` : ''}`);
}

module.exports = { runDoctor, summaryLines };
