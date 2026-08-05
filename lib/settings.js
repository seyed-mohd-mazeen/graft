const fs = require('fs');
const path = require('path');
const { writeJsonAtomic, readJson } = require('./jsonFile');

// Runtime configuration the user can change from the Settings tab, persisted to
// disk so it survives restarts. Environment variables act as the initial
// defaults; anything saved in the app overrides them.
const FILE = path.join(__dirname, '..', 'data', 'settings.json');

// Turn budgets. Not exposed in the UI, but read from settings so they can be
// tuned by editing data/settings.json instead of patching source.
const DEFAULT_MAX_TURNS = 30;
const DEFAULT_PLAN_MAX_TURNS = 20;

let cache = null;
let cacheMtimeMs = 0;

function envDefaults() {
  return {
    jiraDomain: process.env.JIRA_DOMAIN || '',
    jiraEmail: process.env.JIRA_EMAIL || '',
    jiraToken: process.env.JIRA_API_TOKEN || '',
    projectsRoot: '', // parent folder that contains project repos
    repoPath: process.env.REPO_PATH || '', // the selected project
    baseBranch: process.env.BASE_BRANCH || 'main',
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
    // Opt-in, and off by default: having a bot token saved is not the same as
    // asking to be messaged. Nothing is sent until this is explicitly enabled.
    telegramEnabled: process.env.TELEGRAM_ENABLED === 'true',
    // Same opt-in pattern: posting to a Jira ticket is visible to everyone
    // watching it, so it needs its own explicit switch rather than firing
    // just because Jira happens to be configured.
    commentOnJira: process.env.COMMENT_ON_JIRA === 'true',
    // Per-repo lint/test commands Claude is allowed to run, keyed by repo path:
    //   { "C:/path/to/repo": { lint: "npm run lint", test: "npm test" } }
    // Kept per project because the right command differs per codebase, and a
    // global default would grant a repo permission to run another's tooling.
    projectCommands: {},
    maxTurns: DEFAULT_MAX_TURNS,
    planMaxTurns: DEFAULT_PLAN_MAX_TURNS,
  };
}

// mtime of the settings file, or 0 when it does not exist.
function fileMtime() {
  try {
    return fs.statSync(FILE).mtimeMs;
  } catch {
    return 0;
  }
}

// Reload whenever the file has changed underneath us. Without this the cache is
// permanent for the process lifetime, so hand-editing data/settings.json (a
// natural thing to do when debugging config) appears to do nothing until the
// server is restarted.
function load() {
  const mtime = fileMtime();
  if (cache && mtime === cacheMtimeMs) return cache;
  const persisted = readJson(FILE, {}) || {};
  cache = { ...envDefaults(), ...persisted };
  cacheMtimeMs = mtime;
  return cache;
}

function get() {
  return { ...load() };
}

// Merge a partial update, persist, and return the new settings.
function update(partial) {
  const next = { ...load(), ...partial };
  try {
    writeJsonAtomic(FILE, next);
  } catch (err) {
    throw new Error(`Could not save settings: ${err.message}`);
  }
  cache = next;
  cacheMtimeMs = fileMtime();
  return { ...next };
}

// Positive integer turn budgets, falling back to the defaults when the saved
// value is missing or nonsense (0, negative, a string, NaN).
function turnBudget(key, fallback) {
  const raw = load()[key];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function maxTurns() {
  return turnBudget('maxTurns', DEFAULT_MAX_TURNS);
}

function planMaxTurns() {
  return turnBudget('planMaxTurns', DEFAULT_PLAN_MAX_TURNS);
}

// The lint/test commands configured for one repo (both optional).
function commandsFor(repoPath) {
  const all = load().projectCommands || {};
  const entry = repoPath ? all[repoPath] : null;
  return {
    lint: (entry && typeof entry.lint === 'string' ? entry.lint : '').trim(),
    test: (entry && typeof entry.test === 'string' ? entry.test : '').trim(),
  };
}

// Replace one repo's commands, leaving every other repo's untouched.
function setCommandsFor(repoPath, { lint, test }) {
  const all = { ...(load().projectCommands || {}) };
  all[repoPath] = { lint: (lint || '').trim(), test: (test || '').trim() };
  return update({ projectCommands: all });
}

module.exports = {
  get,
  update,
  maxTurns,
  planMaxTurns,
  commandsFor,
  setCommandsFor,
  DEFAULT_MAX_TURNS,
  DEFAULT_PLAN_MAX_TURNS,
};
