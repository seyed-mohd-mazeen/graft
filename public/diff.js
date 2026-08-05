// Parse a `git diff` (unified) into structured per-file data.
//
// Pure (no DOM), so it is unit-tested directly in Node — see test/diff.test.mjs.
// The DOM rendering that consumes this lives in app.js (renderDiff/renderFile).
export function parseDiff(text) {
  const files = [];
  const lines = String(text || '').split('\n');
  let file = null;
  let hunk = null;
  let oldNo = 0;
  let newNo = 0;

  const pushFile = () => {
    if (file) files.push(file);
  };

  for (const raw of lines) {
    if (raw.startsWith('diff --git ')) {
      pushFile();
      const m = raw.match(/^diff --git a\/(.+?) b\/(.+)$/);
      file = {
        oldPath: m ? m[1] : null,
        newPath: m ? m[2] : null,
        displayPath: m ? m[2] : raw,
        changeType: 'modified',
        additions: 0,
        deletions: 0,
        binary: false,
        hunks: [],
      };
      hunk = null;
      continue;
    }
    if (!file) continue;

    if (raw.startsWith('new file')) {
      file.changeType = 'added';
      continue;
    }
    if (raw.startsWith('deleted file')) {
      file.changeType = 'deleted';
      continue;
    }
    if (raw.startsWith('rename from') || raw.startsWith('rename to') || raw.startsWith('copy ')) {
      file.changeType = 'renamed';
      if (file.oldPath && file.newPath && file.oldPath !== file.newPath) {
        file.displayPath = `${file.oldPath} → ${file.newPath}`;
      }
      continue;
    }
    if (raw.startsWith('Binary files')) {
      file.binary = true;
      continue;
    }
    if (
      raw.startsWith('index ') ||
      raw.startsWith('--- ') ||
      raw.startsWith('+++ ') ||
      raw.startsWith('old mode') ||
      raw.startsWith('new mode') ||
      raw.startsWith('similarity ') ||
      raw.startsWith('dissimilarity ')
    ) {
      continue;
    }

    if (raw.startsWith('@@')) {
      const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
      oldNo = m ? parseInt(m[1], 10) : 0;
      newNo = m ? parseInt(m[2], 10) : 0;
      hunk = { header: raw, lines: [] };
      file.hunks.push(hunk);
      continue;
    }

    if (!hunk) continue;

    if (raw.startsWith('+')) {
      hunk.lines.push({ type: 'add', text: raw.slice(1), oldNo: null, newNo });
      newNo++;
      file.additions++;
    } else if (raw.startsWith('-')) {
      hunk.lines.push({ type: 'del', text: raw.slice(1), oldNo, newNo: null });
      oldNo++;
      file.deletions++;
    } else if (raw.startsWith('\\')) {
      // "\ No newline at end of file" — attach nothing, just skip.
      continue;
    } else {
      // Context line (leading space, or empty trailing line in the split).
      hunk.lines.push({ type: 'ctx', text: raw.slice(1), oldNo, newNo });
      oldNo++;
      newNo++;
    }
  }
  pushFile();
  return files;
}
