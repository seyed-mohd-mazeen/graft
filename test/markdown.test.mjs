import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../public/markdown.js';

test('escapes HTML before formatting (no injection)', () => {
  const out = renderMarkdown('<script>alert(1)</script>');
  assert.ok(!out.includes('<script>'), 'raw script tag must not survive');
  assert.ok(out.includes('&lt;script&gt;'));
});

test('renders bold and inline code', () => {
  const out = renderMarkdown('Touch **file.js** and run `npm test`');
  assert.ok(out.includes('<strong>file.js</strong>'));
  assert.ok(out.includes('<code>npm test</code>'));
});

test('renders headings as md-h', () => {
  const out = renderMarkdown('## Summary');
  assert.ok(out.includes('<h4 class="md-h">Summary</h4>'));
});

test('renders unordered lists', () => {
  const out = renderMarkdown('- one\n- two');
  assert.ok(out.includes('<ul class="md-list">'));
  assert.equal((out.match(/<li>/g) || []).length, 2);
  assert.ok(out.includes('</ul>'));
});

test('preserves ordered-list starting number', () => {
  const out = renderMarkdown('3. third item');
  assert.ok(out.includes('<ol class="md-list" start="3">'));
  assert.ok(out.includes('<li>third item</li>'));
});

test('fenced code blocks are escaped and wrapped', () => {
  const out = renderMarkdown('```\nconst x = 1 < 2;\n```');
  assert.ok(out.includes('<pre class="md-code">'));
  assert.ok(out.includes('1 &lt; 2'));
  assert.ok(!out.includes('```'));
});

test('separates paragraphs on blank lines', () => {
  const out = renderMarkdown('first\n\nsecond');
  assert.equal((out.match(/<p>/g) || []).length, 2);
});

test('empty input yields an empty paragraph, never throws', () => {
  assert.equal(renderMarkdown(''), '<p></p>');
  assert.equal(renderMarkdown(null), '<p></p>');
  assert.equal(renderMarkdown(undefined), '<p></p>');
});

test('closes an open list before a following paragraph', () => {
  const out = renderMarkdown('- a\n\ntrailing text');
  assert.ok(out.indexOf('</ul>') < out.indexOf('<p>'), 'list closes before paragraph');
});
