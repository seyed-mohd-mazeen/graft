const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const worktrees = require('./worktrees');

const execFileAsync = promisify(execFile);

// Discovering the git projects inside a parent folder, and detecting a repo's
// base branch — used by the Settings tab so the user picks a project instead of
// hand-editing paths and branch names.
//
// Everything here is async. It used to use execFileSync, which blocks the whole
// event loop: a cold `git ls-files` on a large repo froze the server — including
// every live progress stream — for as long as git took to answer.

async function git(repoPath, args) {
  const { stdout } = await execFileAsync('git', args, { cwd: repoPath, encoding: 'utf8' });
  return stdout.trim();
}

function isGitRepo(dir) {
  try {
    return fs.existsSync(path.join(dir, '.git'));
  } catch {
    return false;
  }
}

// True when `dir` is a real repository we can work in — a worktree checkout is
// deliberately excluded, so the app's own per-ticket worktrees never show up as
// selectable projects.
async function isSelectableRepo(dir) {
  if (worktrees.isWorktreeDir(dir)) return false;
  try {
    const stat = await fsp.stat(path.join(dir, '.git'));
    // A worktree's .git is a file pointing at the parent repo; a real repo's is
    // a directory.
    return stat.isDirectory();
  } catch {
    return false;
  }
}

// Immediate subdirectories of `root` that are git repositories.
async function listProjects(root) {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isDirectory() && e.name !== worktrees.WORKTREE_DIR_NAME)
    .map((e) => ({ name: e.name, path: path.join(root, e.name) }));

  const checks = await Promise.all(candidates.map((c) => isSelectableRepo(c.path)));
  const out = candidates.filter((_, i) => checks[i]);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Best-effort default/base branch for a repo:
//   1. the remote's default branch (origin/HEAD),
//   2. a common default that exists locally (main/master/develop/trunk),
//   3. the currently checked-out branch,
//   4. 'main' as a last resort.
async function detectBaseBranch(repoPath) {
  try {
    const ref = await git(repoPath, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
    if (ref) return ref.replace(/^origin\//, '');
  } catch {
    /* no origin/HEAD */
  }
  for (const b of ['main', 'master', 'develop', 'trunk']) {
    try {
      await git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]);
      return b;
    } catch {
      /* branch not present */
    }
  }
  try {
    const cur = await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (cur && cur !== 'HEAD') return cur;
  } catch {
    /* detached / not a repo */
  }
  return 'main';
}

// Local and remote-tracking branch names, for the Settings base-branch picker.
// Remote names have their 'origin/' prefix stripped and are deduped against
// locals, since resolveStartPoint() in worktrees.js already knows how to reach
// either — the user just needs to pick a name, not a ref.
async function listBranches(repoPath) {
  const names = new Set();
  try {
    const local = await git(repoPath, ['branch', '--format=%(refname:short)']);
    local.split('\n').map((b) => b.trim()).filter(Boolean).forEach((b) => names.add(b));
  } catch {
    /* not a repo, or no commits yet */
  }
  try {
    const remote = await git(repoPath, ['branch', '-r', '--format=%(refname:short)']);
    remote
      .split('\n')
      .map((b) => b.trim())
      .filter((b) => b && !b.endsWith('/HEAD'))
      .map((b) => b.replace(/^origin\//, ''))
      .forEach((b) => names.add(b));
  } catch {
    /* no origin remote */
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

// Branch names that currently exist on origin, read directly from the remote
// (`git ls-remote`, no fetch, no local ref changes) rather than from
// whatever's already been fetched locally — for pickers where "active branch
// on the remote right now" matters more than what this machine happens to
// have cached.
async function listRemoteBranches(repoPath) {
  try {
    await git(repoPath, ['remote', 'get-url', 'origin']);
  } catch {
    return []; // no origin configured — nothing to list, not an error worth surfacing
  }
  // Deliberately not caught: a real ls-remote failure (auth, network, a
  // renamed/deleted repo) is exactly the kind of thing the release picker
  // needs to show, not hide behind a silent empty list.
  const out = await git(repoPath, ['ls-remote', '--heads', 'origin']);
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^.*refs\/heads\//, ''))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

// Tracked files in a repo, lightly cached so typeahead doesn't re-shell on
// every keystroke. Concurrent callers share one in-flight lookup.
const fileCache = new Map(); // repoPath -> { at, files }
const inFlight = new Map(); // repoPath -> Promise<string[]>
const CACHE_TTL_MS = 30000;

async function repoFiles(repoPath) {
  const cached = fileCache.get(repoPath);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.files;
  if (inFlight.has(repoPath)) return inFlight.get(repoPath);

  const lookup = (async () => {
    let files = [];
    try {
      const out = await git(repoPath, ['ls-files']);
      files = out
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean);
    } catch {
      files = [];
    }
    fileCache.set(repoPath, { at: Date.now(), files });
    inFlight.delete(repoPath);
    return files;
  })();

  inFlight.set(repoPath, lookup);
  return lookup;
}

// Substring search over tracked files, for the reference-file picker.
async function searchRepoFiles(repoPath, query, limit = 40) {
  if (!repoPath) return [];
  const files = await repoFiles(repoPath);
  const q = (query || '').trim().toLowerCase();
  if (!q) return files.slice(0, limit);
  return files.filter((f) => f.toLowerCase().includes(q)).slice(0, limit);
}

// A path is usable as a project only if it exists and is a git repository.
// Validated when settings are saved so a typo surfaces immediately, instead of
// as an opaque git failure inside a task minutes later.
async function validateRepoPath(repoPath) {
  let stat;
  try {
    stat = await fsp.stat(repoPath);
  } catch {
    return { ok: false, error: 'That folder does not exist.' };
  }
  if (!stat.isDirectory()) return { ok: false, error: 'That path is not a folder.' };
  try {
    await fsp.stat(path.join(repoPath, '.git'));
  } catch {
    return { ok: false, error: 'That folder is not a git repository.' };
  }
  return { ok: true };
}

module.exports = {
  isGitRepo,
  listProjects,
  detectBaseBranch,
  listBranches,
  listRemoteBranches,
  searchRepoFiles,
  validateRepoPath,
};
