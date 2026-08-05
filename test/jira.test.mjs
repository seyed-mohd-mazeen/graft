import { test } from 'node:test';
import assert from 'node:assert/strict';
// lib/jira.js is CommonJS; default import gives module.exports.
import jira from '../lib/jira.js';
import settingsModule from '../lib/settings.js';

const { htmlToText, textToAdf, addComment } = jira;

test('returns empty string for falsy input', () => {
  assert.equal(htmlToText(''), '');
  assert.equal(htmlToText(null), '');
  assert.equal(htmlToText(undefined), '');
});

test('strips tags and keeps text', () => {
  assert.equal(htmlToText('<p>Hello <b>world</b></p>'), 'Hello world');
});

test('converts <br> and </p> into line breaks', () => {
  assert.equal(htmlToText('a<br>b'), 'a\nb');
  assert.equal(htmlToText('<p>one</p><p>two</p>'), 'one\n\ntwo');
});

test('turns <li> into bullet lines', () => {
  const out = htmlToText('<ul><li>first</li><li>second</li></ul>');
  assert.ok(out.includes('- first'));
  assert.ok(out.includes('- second'));
});

test('decodes common HTML entities', () => {
  assert.equal(htmlToText('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;'), 'a & b <c> "d" \'e\'');
});

test('collapses 3+ blank lines and trims', () => {
  assert.equal(htmlToText('<p>a</p><p></p><p></p><p>b</p>'), 'a\n\nb');
});

// The description is the brief Claude works from, so structure that carries
// meaning has to survive the conversion rather than being flattened away.

test('keeps a link’s destination, not just its text', () => {
  assert.equal(
    htmlToText('<p>See the <a href="https://example.com/spec">spec</a> first.</p>'),
    'See the spec (https://example.com/spec) first.'
  );
});

test('does not duplicate a link whose text is already the URL', () => {
  assert.equal(htmlToText('<a href="https://x.dev">https://x.dev</a>'), 'https://x.dev');
});

test('anchors without a useful href degrade to their text', () => {
  assert.equal(htmlToText('<a href="#local">jump</a>'), 'jump');
});

test('code blocks stay fenced and keep their indentation', () => {
  const out = htmlToText('<p>Do:</p><pre><code>if (x) {\n    go();\n}</code></pre>');
  assert.match(out, /```\nif \(x\) \{\n    go\(\);\n\}\n```/);
});

test('inline code is marked as code', () => {
  assert.equal(htmlToText('<p>call <code>doThing()</code> twice</p>'), 'call `doThing()` twice');
});

test('table rows stay readable as rows', () => {
  const html = '<table><tr><td>name</td><td>type</td></tr><tr><td>id</td><td>int</td></tr></table>';
  const out = htmlToText(html);
  assert.match(out, /name \| type/);
  assert.match(out, /id \| int/);
});

test('images are named rather than vanishing', () => {
  assert.equal(htmlToText('<img src="https://x/y/diagram.png" alt="flow diagram">'), '[image: flow diagram]');
  assert.equal(htmlToText('<img src="https://x/y/shot.png">'), '[image: shot.png]');
});

test('decodes numeric and hex entities', () => {
  assert.equal(htmlToText('&#8212; &#x2014; &hellip;'), '— — …');
});

test('an unknown entity is left as written rather than mangled', () => {
  assert.equal(htmlToText('&notanentity; x'), '&notanentity; x');
});

test('entities cannot smuggle a tag back in', () => {
  // Decoding happens after tag stripping, so an encoded tag stays inert text.
  assert.equal(htmlToText('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'), '<script>alert(1)</script>');
});

test('headings and rules become block separators', () => {
  assert.equal(htmlToText('<h2>Title</h2><p>body</p>'), 'Title\n\nbody');
  assert.match(htmlToText('<p>a</p><hr><p>b</p>'), /a\n+---\nb/);
});

// ---- textToAdf / addComment --------------------------------------------
//
// The v3 comment API takes Atlassian Document Format, not plain text — these
// cover the conversion, and that addComment posts it to the right place
// without ever touching the real network in a test run.

test('textToAdf: blank-line-separated text becomes one paragraph per block', () => {
  const doc = textToAdf('First paragraph.\n\nSecond paragraph.');
  assert.equal(doc.type, 'doc');
  assert.equal(doc.version, 1);
  assert.equal(doc.content.length, 2);
  assert.deepEqual(doc.content[0], { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph.' }] });
  assert.deepEqual(doc.content[1], { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph.' }] });
});

test('textToAdf: a single newline within a paragraph becomes a hard break, not a new paragraph', () => {
  const doc = textToAdf('Branch: feature/x\nSummary: did the thing');
  assert.equal(doc.content.length, 1, 'one paragraph, not two');
  assert.deepEqual(doc.content[0].content, [
    { type: 'text', text: 'Branch: feature/x' },
    { type: 'hardBreak' },
    { type: 'text', text: 'Summary: did the thing' },
  ]);
});

test('textToAdf: empty input produces a valid empty document, not an error', () => {
  assert.deepEqual(textToAdf(''), { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [] }] });
  assert.deepEqual(textToAdf(undefined), { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [] }] });
});

test('textToAdf: blank lines inside a paragraph run do not produce empty paragraphs', () => {
  const doc = textToAdf('a\n\n\n\nb');
  assert.equal(doc.content.length, 2, 'collapses runs of blank lines rather than emitting an empty paragraph between them');
});

test('addComment posts ADF to the v3 comment endpoint for the right issue', async () => {
  const originalGet = settingsModule.get;
  const originalFetch = globalThis.fetch;
  const calls = [];
  settingsModule.get = () => ({ jiraDomain: 'x.atlassian.net', jiraEmail: 'a@a.com', jiraToken: 'tok' });
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, text: async () => JSON.stringify({ id: '123' }) };
  };
  try {
    await addComment('PROJ-101', 'Implemented on branch feature/x.\n\nAll good.');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://x.atlassian.net/rest/api/3/issue/PROJ-101/comment');
    assert.equal(calls[0].init.method, 'POST');
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.body.type, 'doc');
    assert.equal(sent.body.content.length, 2);
  } finally {
    settingsModule.get = originalGet;
    globalThis.fetch = originalFetch;
  }
});

test('addComment surfaces a failed request as a rejected promise, not a swallowed error', async () => {
  const originalGet = settingsModule.get;
  const originalFetch = globalThis.fetch;
  settingsModule.get = () => ({ jiraDomain: 'x.atlassian.net', jiraEmail: 'a@a.com', jiraToken: 'tok' });
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => 'Forbidden' });
  try {
    await assert.rejects(() => addComment('PROJ-101', 'text'), /Jira request failed \(403\)/);
  } finally {
    settingsModule.get = originalGet;
    globalThis.fetch = originalFetch;
  }
});

