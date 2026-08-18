import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projects = require('../lib/projects.js');
const worktrees = require('../lib/worktrees.js');

const execFileAsync = promisify(execFileCb);

// A throwaway parent folder containing: a real repo, a plain folder, and one of
// the app's own per-ticket worktrees.
async function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-runner-projects-'));
  const repo = path.join(root, 'real-repo');
  fs.mkdirSync(repo);
  const git = (args, cwd = repo) => execFileAsync('git', args, { cwd, encoding: 'utf8' });
  await git(['init', '-q', '-b', 'trunk', '.']);
  await git(['config', 'user.email', 'a@a.com']);
  await git(['config', 'user.name', 'a']);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'hi\n');
  fs.writeFileSync(path.join(repo, 'src.js'), 'x\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'init']);

  fs.mkdirSync(path.join(root, 'not-a-repo'));

  // A worktree of the repo, placed where the app puts them.
  const wtPath = worktrees.pathFor(repo, 'ABC-1');
  fs.mkdirSync(path.dirname(wtPath), { recursive: true });
  await git(['worktree', 'add', '-q', '-b', 'feature/x/ABC-1', wtPath]);

  return { root, repo, wtPath, git };
}

test('listProjects finds real repos and ignores plain folders', async () => {
  const { root, repo } = await makeFixture();
  try {
    const found = await projects.listProjects(root);
    assert.deepEqual(
      found.map((p) => p.name),
      ['real-repo']
    );
    assert.equal(found[0].path, repo);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listProjects never offers the app’s own worktrees as projects', async () => {
  const { root, wtPath } = await makeFixture();
  try {
    // The worktree root sits beside the repo, so a scan of the parent folder
    // would otherwise surface every in-progress ticket as a selectable project.
    const parentOfWorktrees = path.dirname(path.dirname(wtPath));
    const found = await projects.listProjects(parentOfWorktrees);
    assert.ok(
      !found.some((p) => p.path.includes(worktrees.WORKTREE_DIR_NAME)),
      'worktree checkouts are excluded'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('detectBaseBranch falls back to the checked-out branch for a remote-less repo', async () => {
  const { root, repo } = await makeFixture();
  try {
    // No origin, and none of main/master/develop/trunk exist as *local* branches
    // except 'trunk', which this fixture uses.
    assert.equal(await projects.detectBaseBranch(repo), 'trunk');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('detectBaseBranch returns main for something that is not a repo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-runner-norepo-'));
  try {
    assert.equal(await projects.detectBaseBranch(dir), 'main');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listBranches lists local and remote-tracking branches, deduped', async () => {
  const { root, repo, git } = await makeFixture();
  try {
    await git(['branch', 'develop']);
    await git(['remote', 'add', 'origin', repo]);
    await git(['fetch', 'origin', '-q']);
    const branches = await projects.listBranches(repo);
    // The fixture's own worktree checkout (feature/x/ABC-1) is a local branch
    // of this same repo too, so it's listed alongside develop and trunk.
    assert.deepEqual(branches, ['develop', 'feature/x/ABC-1', 'trunk']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listBranches returns an empty list for something that is not a repo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-runner-norepo-'));
  try {
    assert.deepEqual(await projects.listBranches(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('searchRepoFiles filters tracked files and caches the listing', async () => {
  const { root, repo } = await makeFixture();
  try {
    const all = await projects.searchRepoFiles(repo, '');
    assert.deepEqual(all.sort(), ['src.js', 'tracked.txt']);
    assert.deepEqual(await projects.searchRepoFiles(repo, 'src'), ['src.js']);
    assert.deepEqual(await projects.searchRepoFiles(repo, 'SRC'), ['src.js'], 'case-insensitive');
    assert.deepEqual(await projects.searchRepoFiles(repo, 'nothing-matches'), []);
    assert.deepEqual(await projects.searchRepoFiles('', 'x'), [], 'no repo selected');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('concurrent searches share one git invocation', async () => {
  const { root, repo } = await makeFixture();
  try {
    // Typeahead fires several lookups at once; they must not each shell out.
    const results = await Promise.all([
      projects.searchRepoFiles(repo, 's'),
      projects.searchRepoFiles(repo, 't'),
      projects.searchRepoFiles(repo, ''),
    ]);
    assert.deepEqual(results[0], ['src.js']);
    assert.deepEqual(results[1], ['tracked.txt']);
    assert.equal(results[2].length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validateRepoPath rejects missing paths, files, and non-repos', async () => {
  const { root, repo } = await makeFixture();
  try {
    assert.deepEqual(await projects.validateRepoPath(repo), { ok: true });

    const missing = await projects.validateRepoPath(path.join(root, 'nope'));
    assert.equal(missing.ok, false);
    assert.match(missing.error, /does not exist/);

    const plain = await projects.validateRepoPath(path.join(root, 'not-a-repo'));
    assert.equal(plain.ok, false);
    assert.match(plain.error, /not a git repository/);

    const file = await projects.validateRepoPath(path.join(repo, 'src.js'));
    assert.equal(file.ok, false);
    assert.match(file.error, /not a folder/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
