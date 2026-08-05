import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff } from '../public/diff.js';

const MODIFIED = `diff --git a/src/app.js b/src/app.js
index 111..222 100644
--- a/src/app.js
+++ b/src/app.js
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 module.exports = { a };
`;

test('parses a modified file with correct add/del counts', () => {
  const files = parseDiff(MODIFIED);
  assert.equal(files.length, 1);
  const f = files[0];
  assert.equal(f.changeType, 'modified');
  assert.equal(f.displayPath, 'src/app.js');
  assert.equal(f.additions, 2);
  assert.equal(f.deletions, 1);
  assert.equal(f.hunks.length, 1);
});

test('tracks old/new line numbers across a hunk', () => {
  const f = parseDiff(MODIFIED)[0];
  const add = f.hunks[0].lines.find((l) => l.type === 'add');
  assert.equal(add.oldNo, null);
  assert.equal(typeof add.newNo, 'number');
  const del = f.hunks[0].lines.find((l) => l.type === 'del');
  assert.equal(del.newNo, null);
  assert.equal(typeof del.oldNo, 'number');
});

test('detects a newly added file', () => {
  const diff = `diff --git a/new.txt b/new.txt
new file mode 100644
index 000..abc
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
`;
  const f = parseDiff(diff)[0];
  assert.equal(f.changeType, 'added');
  assert.equal(f.additions, 2);
});

test('detects a deleted file', () => {
  const diff = `diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index abc..000
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
`;
  const f = parseDiff(diff)[0];
  assert.equal(f.changeType, 'deleted');
  assert.equal(f.deletions, 1);
});

test('detects a rename and formats the display path', () => {
  const diff = `diff --git a/old.js b/new.js
similarity index 100%
rename from old.js
rename to new.js
`;
  const f = parseDiff(diff)[0];
  assert.equal(f.changeType, 'renamed');
  assert.equal(f.displayPath, 'old.js → new.js');
});

test('flags binary files', () => {
  const diff = `diff --git a/logo.png b/logo.png
index 111..222 100644
Binary files a/logo.png and b/logo.png differ
`;
  const f = parseDiff(diff)[0];
  assert.equal(f.binary, true);
});

test('parses multiple files in one diff', () => {
  const files = parseDiff(MODIFIED + MODIFIED.replace(/app\.js/g, 'util.js'));
  assert.equal(files.length, 2);
  assert.deepEqual(files.map((f) => f.displayPath).sort(), ['src/app.js', 'src/util.js']);
});

test('empty / non-diff input yields no files, never throws', () => {
  assert.deepEqual(parseDiff(''), []);
  assert.deepEqual(parseDiff(null), []);
  assert.deepEqual(parseDiff('just some text\nnot a diff'), []);
});
