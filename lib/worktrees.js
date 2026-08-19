const fs = require('fs');
const path = require('path');

// Per-ticket git worktrees.
//
// Every implementation runs in its own checkout of the repo, on its own branch,
// sharing the main repo's .git object store. That buys three things the old
// single-checkout design could not offer:
//
//  1. Real parallelism. Two tickets implement at once without colliding. The
//     old code held a lock only across branch setup, so a second ticket could
//     be approved while the first was still exploring (working tree still
//     clean) — moving HEAD out from under a live run, so its edits landed on
//     the wrong branch.
//  2. Your checkout is never touched. No `checkout base` + `pull` on the repo
//     you have open in an editor, and no leaving you on a branch you didn't ask
//     for.
//  3. Correctly scoped diffs. `git status` in a worktree reports only that
//     ticket's changes, instead of every dirty file in one shared tree.
//
// Layout, as a sibling of the repo so it never shows up in the repo's own status:
//   <parent>/.ticket-runner-worktrees/<repo-name>/<TICKET-KEY>
const WORKTREE_DIR_NAME = '.ticket-runner-worktrees';

// Release-run scratch worktrees live under a separate sibling dir, not
// WORKTREE_DIR_NAME, so they never show up in listWorktrees() (which filters
// by rootFor(repo)) or the ticket-oriented Worktrees page — they aren't tied
// to a ticket and aren't meant to be managed from there.
const RELEASE_DIR_NAME = '.ticket-runner-release';

// Ticket keys are Jira-shaped (PROJ-123), but never trust that for a path
// segment — a key containing a separator or '..' would escape the worktree root.
function safeSegment(name) {
  const cleaned = String(name || '')
    .replace(/[^A-Za-z0-9._-]+/g, '-') // separators and anything unexpected
    .replace(/\.{2,}/g, '.') // no '..' traversal sequences
    .replace(/^[-.]+|[-.]+$/g, '') // no leading/trailing dots or dashes
    .slice(0, 80);
  return cleaned || 'ticket';
}

// Root that holds every worktree for one repo.
function rootFor(repoPath) {
  const resolved = path.resolve(repoPath);
  return path.join(path.dirname(resolved), WORKTREE_DIR_NAME, path.basename(resolved));
}

// Where a given ticket's worktree lives.
function pathFor(repoPath, ticketKey) {
  return path.join(rootFor(repoPath), safeSegment(ticketKey));
}

// Root that holds every release-run scratch worktree for one repo.
function releaseRootFor(repoPath) {
  const resolved = path.resolve(repoPath);
  return path.join(path.dirname(resolved), RELEASE_DIR_NAME, path.basename(resolved));
}

// Where a given release run's scratch worktree lives.
function releasePathFor(repoPath, runId) {
  return path.join(releaseRootFor(repoPath), safeSegment(runId));
}

// True if `dir` is (or is inside) any repo's worktree root, ticket or release.
// Used to keep the project scanner from offering worktrees as selectable
// projects.
function isWorktreeDir(dir) {
  const segments = path.resolve(dir).split(/[\\/]/);
  return segments.includes(WORKTREE_DIR_NAME) || segments.includes(RELEASE_DIR_NAME);
}

// --- git plumbing -------------------------------------------------------
//
// Every function takes an `exec(cmd, args, opts) => {code, stdout, stderr}`
// (the non-throwing runner from claudeRunner) so this module stays testable
// without shelling out.

async function git(exec, repo, args) {
  const res = await exec('git', args, { cwd: repo, encoding: 'utf8' });
  if (res.code !== 0) {
    throw new Error(res.message || res.stderr || `git ${args.join(' ')} exited with code ${res.code}`);
  }
  return res.stdout;
}

async function refExists(exec, repo, ref) {
  const res = await exec('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: repo, encoding: 'utf8' });
  return res.code === 0;
}

// True when the repo has at least one remote configured.
async function hasRemote(exec, repo, remote = 'origin') {
  const res = await exec('git', ['remote', 'get-url', remote], { cwd: repo, encoding: 'utf8' });
  return res.code === 0;
}

// Best starting point for a new branch: the remote's tip of the base branch if
// we can reach it, otherwise the local base branch.
//
// Deliberately never runs `git pull --ff-only`. The old code did, which meant a
// repo with no remote — or a base branch with no upstream, or one that had
// diverged — could never be implemented at all, even though the rest of the app
// supports remote-less repos. `git fetch` touches no working tree, so it is safe
// to run while other tasks are mid-run, and a failure here is non-fatal: we just
// branch from the local base and say so.
async function resolveStartPoint(exec, repo, baseBranch) {
  const notes = [];
  if (await hasRemote(exec, repo)) {
    const fetched = await exec('git', ['fetch', 'origin', baseBranch, '--quiet'], { cwd: repo, encoding: 'utf8' });
    if (fetched.code !== 0) {
      notes.push(`Could not fetch origin/${baseBranch}; branching from your local ${baseBranch}.`);
    } else if (await refExists(exec, repo, `refs/remotes/origin/${baseBranch}`)) {
      return { startPoint: `origin/${baseBranch}`, notes };
    }
  } else {
    notes.push(`No 'origin' remote; branching from your local ${baseBranch}.`);
  }

  if (await refExists(exec, repo, `refs/heads/${baseBranch}`)) {
    return { startPoint: baseBranch, notes };
  }
  throw new Error(
    `Base branch '${baseBranch}' does not exist locally or on origin. Set the correct base branch in Settings.`
  );
}

// Worktrees registered with this repo: [{ path, branch }].
async function list(exec, repo) {
  const res = await exec('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' });
  if (res.code !== 0) return [];
  const out = [];
  let current = null;
  for (const line of res.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) out.push(current);
      current = { path: line.slice('worktree '.length).trim(), branch: null };
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    }
  }
  if (current) out.push(current);
  return out;
}

// Share the main checkout's node_modules with a worktree.
//
// A fresh worktree contains only tracked files, so node_modules (gitignored) is
// absent and any configured test/lint command fails until dependencies exist.
// A junction/symlink is instant and costs no disk, at the cost of the two
// checkouts sharing one dependency tree — see dependenciesStale() for the case
// where that assumption breaks.
function linkDependencies(repoPath, worktreePath, dirName = 'node_modules') {
  const source = path.join(repoPath, dirName);
  const target = path.join(worktreePath, dirName);
  if (!fs.existsSync(source)) return { linked: false, reason: 'none-in-main-repo' };
  if (fs.existsSync(target)) return { linked: false, reason: 'already-present' };
  try {
    // 'junction' is the only link type Windows allows without elevation, and it
    // is directory-only — exactly what we need. Ignored on POSIX.
    fs.symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
    return { linked: true };
  } catch (err) {
    return { linked: false, reason: err.message };
  }
}

// Whether a run has invalidated the shared dependency tree by editing a
// manifest or lockfile. The junction points at the main repo's node_modules, so
// a ticket that changes dependencies is testing against the wrong ones.
const MANIFEST_RE = /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/i;

function dependenciesStale(changedPaths) {
  return (changedPaths || []).some((p) => MANIFEST_RE.test(String(p).replace(/^..\s+/, '').trim()));
}

// Create (or adopt) the worktree for a ticket. Idempotent: an existing worktree
// at the expected path is reused, which is what makes a resumed or iterated run
// continue in the same checkout.
async function add(exec, { repoPath, baseBranch, branch, ticketKey }) {
  const dest = pathFor(repoPath, ticketKey);
  const notes = [];

  const worktreeList = await list(exec, repoPath);
  const existing = worktreeList.find((w) => path.resolve(w.path) === path.resolve(dest));
  if (existing) {
    notes.push(`Reusing existing worktree at ${dest}.`);
    return { path: dest, branch: existing.branch || branch, notes, created: false };
  }

  // A stale directory with no worktree registration (e.g. removed by hand)
  // would make `git worktree add` fail; clear it if it is empty.
  if (fs.existsSync(dest)) {
    try {
      fs.rmdirSync(dest);
    } catch {
      throw new Error(`${dest} already exists and is not an empty directory. Remove it and try again.`);
    }
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (await refExists(exec, repoPath, `refs/heads/${branch}`)) {
    // git refuses to check the same branch out in two places — including the
    // user's own main checkout, which is exactly where an older, pre-worktree
    // run of this same ticket can have left it (or anywhere else someone
    // checked it out by hand). `git worktree list` already includes the main
    // checkout as its first entry, so this catches that case for free.
    //
    // Detecting it here means a real, actionable message ("here's where it's
    // checked out, here's the command to free it") instead of `git worktree
    // add`'s raw stderr surfacing straight through to the UI.
    const conflict = worktreeList.find((w) => w.branch === branch);
    if (conflict) {
      throw new Error(await describeCheckoutConflict(exec, { conflict, repoPath, branch, baseBranch }));
    }
    notes.push(`Branch ${branch} already exists; checking it out in a new worktree.`);
    await git(exec, repoPath, ['worktree', 'add', dest, branch]);
  } else {
    const { startPoint, notes: startNotes } = await resolveStartPoint(exec, repoPath, baseBranch);
    notes.push(...startNotes, `Creating branch ${branch} from ${startPoint}...`);
    await git(exec, repoPath, ['worktree', 'add', '-b', branch, dest, startPoint]);
  }

  return { path: dest, branch, notes, created: true };
}

// A clear explanation of where a branch is already checked out and how to
// free it, distinguishing the common case (the user's own main repo) from a
// stray worktree, and flagging uncommitted changes so nobody's told to
// `git checkout` blindly into something that would clash with local edits.
async function describeCheckoutConflict(exec, { conflict, repoPath, branch, baseBranch }) {
  const isMainRepo = path.resolve(conflict.path) === path.resolve(repoPath);
  const status = await exec('git', ['status', '--porcelain'], { cwd: conflict.path, encoding: 'utf8' });
  const dirty = status.code === 0 && status.stdout.trim();
  const dirtyNote = dirty ? ` That checkout currently has uncommitted changes — commit or stash them first.` : '';

  if (isMainRepo) {
    return (
      `Branch ${branch} is already checked out in your main repository at ${conflict.path}. ` +
      `Switch it to a different branch there (e.g. \`git checkout ${baseBranch}\`) and try again.${dirtyNote}`
    );
  }
  return (
    `Branch ${branch} is already checked out at ${conflict.path}. ` +
    `Remove that worktree (or switch its branch) and try again.${dirtyNote}`
  );
}

// Set up (or refresh) the scratch worktree a release run merges into.
//
// Unlike add(), this isn't about a named ticket branch: the point of this
// worktree is to always reflect destBranch's true current state before
// merging, never whatever a prior run (or anything else) left lying around
// locally — so an existing scratch worktree is hard-reset to the resolved
// target every time, rather than reused as-is. If destBranch doesn't exist on
// origin yet, it is created fresh from the repo's base branch, covering a
// brand-new per-sprint release branch.
async function prepareReleaseWorktree(exec, { repoPath, destBranch, baseBranch, runId }) {
  const dest = releasePathFor(repoPath, runId);

  await exec('git', ['fetch', 'origin', destBranch, '--quiet'], { cwd: repoPath, encoding: 'utf8' });
  const remoteExists = await refExists(exec, repoPath, `refs/remotes/origin/${destBranch}`);

  let target = `origin/${destBranch}`;
  let createdFromBase = false;
  if (!remoteExists) {
    const { startPoint } = await resolveStartPoint(exec, repoPath, baseBranch);
    target = startPoint;
    createdFromBase = true;
  }

  const worktreeList = await list(exec, repoPath);
  const existing = worktreeList.find((w) => path.resolve(w.path) === path.resolve(dest));

  if (existing) {
    await git(exec, dest, ['reset', '--hard', target]);
    await exec('git', ['clean', '-fd'], { cwd: dest, encoding: 'utf8' });
    return { path: dest, createdFromBase };
  }

  if (fs.existsSync(dest)) {
    try {
      fs.rmdirSync(dest);
    } catch {
      throw new Error(`${dest} already exists and is not an empty directory. Remove it and try again.`);
    }
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  // Same conflict as add(): git refuses to check the same branch out twice,
  // including in the user's own main checkout.
  const conflict = worktreeList.find((w) => w.branch === destBranch);
  if (conflict) {
    throw new Error(await describeCheckoutConflict(exec, { conflict, repoPath, branch: destBranch, baseBranch }));
  }

  if (await refExists(exec, repoPath, `refs/heads/${destBranch}`)) {
    await git(exec, repoPath, ['worktree', 'add', dest, destBranch]);
    await git(exec, dest, ['reset', '--hard', target]);
  } else {
    await git(exec, repoPath, ['worktree', 'add', '-b', destBranch, dest, target]);
  }

  return { path: dest, createdFromBase };
}

// Remove a worktree. Refuses to discard uncommitted work unless `force` is set.
async function remove(exec, { repoPath, worktreePath, force = false }) {
  if (!worktreePath) return { removed: false, reason: 'no-worktree' };

  if (!force) {
    const status = await exec('git', ['status', '--porcelain'], { cwd: worktreePath, encoding: 'utf8' });
    if (status.code === 0 && status.stdout.trim()) {
      return {
        removed: false,
        reason: 'dirty',
        error: 'This worktree still has uncommitted changes. Commit them, or remove it with force.',
      };
    }
  }

  const args = ['worktree', 'remove', worktreePath];
  if (force) args.push('--force');
  const res = await exec('git', args, { cwd: repoPath, encoding: 'utf8' });
  if (res.code !== 0) {
    return { removed: false, reason: 'git-error', error: res.stderr || res.message || 'git worktree remove failed' };
  }
  // Drop the administrative record for any worktree whose directory is gone.
  await exec('git', ['worktree', 'prune'], { cwd: repoPath, encoding: 'utf8' });
  return { removed: true };
}

// Merge branchRef into whatever is checked out in worktreePath. On a clean
// merge, returns the new HEAD sha. On conflict, collects the conflicted file
// list and aborts the merge so the worktree is left clean — the caller skips
// this branch and continues with the rest, rather than fixing it automatically
// (only a human can decide which side of a real conflict should win).
async function mergeBranch(exec, worktreePath, branchRef, message) {
  const res = await exec('git', ['merge', '--no-ff', '-m', message, branchRef], {
    cwd: worktreePath,
    encoding: 'utf8',
  });
  if (res.code === 0) {
    const sha = (await git(exec, worktreePath, ['rev-parse', 'HEAD'])).trim();
    return { merged: true, sha };
  }
  const diff = await exec('git', ['diff', '--name-only', '--diff-filter=U'], {
    cwd: worktreePath,
    encoding: 'utf8',
  });
  const files = diff.stdout
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
  await exec('git', ['merge', '--abort'], { cwd: worktreePath, encoding: 'utf8' });
  return files.length
    ? { merged: false, files }
    : { merged: false, files: [], error: res.stderr || res.message || `git merge exited with code ${res.code}` };
}

// Push the worktree's current HEAD to origin/<destBranch>. An explicit
// refspec (rather than a bare `git push origin <destBranch>`) works
// regardless of what local branch name the worktree happens to have checked
// out.
async function pushBranch(exec, worktreePath, destBranch) {
  const res = await exec('git', ['push', 'origin', `HEAD:refs/heads/${destBranch}`], {
    cwd: worktreePath,
    encoding: 'utf8',
  });
  if (res.code === 0) return { pushed: true };
  return { pushed: false, error: res.stderr || res.message || 'git push failed' };
}

// True once `branch` is fully contained in `baseBranch` — i.e. the work has
// landed and the worktree is safe to clean up. Used to flag (never to delete).
async function isMerged(exec, repoPath, branch, baseBranch) {
  if (!branch || !baseBranch) return false;
  const target = (await refExists(exec, repoPath, `refs/remotes/origin/${baseBranch}`))
    ? `origin/${baseBranch}`
    : baseBranch;
  if (!(await refExists(exec, repoPath, target))) return false;
  const res = await exec('git', ['merge-base', '--is-ancestor', branch, target], {
    cwd: repoPath,
    encoding: 'utf8',
  });
  return res.code === 0;
}

module.exports = {
  WORKTREE_DIR_NAME,
  RELEASE_DIR_NAME,
  rootFor,
  pathFor,
  releaseRootFor,
  releasePathFor,
  isWorktreeDir,
  safeSegment,
  resolveStartPoint,
  list,
  add,
  remove,
  isMerged,
  linkDependencies,
  dependenciesStale,
  prepareReleaseWorktree,
  mergeBranch,
  pushBranch,
};
