// Lightweight, safe Markdown -> HTML for Claude's plan / summary text so it
// renders as formatted headings, lists, and bold instead of a raw wall of
// asterisks and hashes. Everything is HTML-escaped before formatting.
//
// Pure (no DOM), so it is unit-tested directly in Node — see test/markdown.test.mjs.
export function renderMarkdown(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

  const lines = String(src || '').split('\n');
  let html = '';
  let list = null; // 'ul' | 'ol'
  let para = [];
  let inCode = false;
  let code = [];

  const flushPara = () => {
    if (para.length) { html += `<p>${para.map(inline).join('<br>')}</p>`; para = []; }
  };
  const closeList = () => {
    if (list) { html += list === 'ul' ? '</ul>' : '</ol>'; list = null; }
  };

  for (const raw of lines) {
    const t = raw.trim();

    if (t.startsWith('```')) {
      if (inCode) { html += `<pre class="md-code">${esc(code.join('\n'))}</pre>`; code = []; inCode = false; }
      else { flushPara(); closeList(); inCode = true; }
      continue;
    }
    if (inCode) { code.push(raw); continue; }

    if (!t) { flushPara(); closeList(); continue; }

    const h = t.match(/^(#{1,6})\s+(.+)$/);
    if (h) { flushPara(); closeList(); html += `<h4 class="md-h">${inline(h[2])}</h4>`; continue; }

    const ul = t.match(/^[-*]\s+(.+)$/);
    if (ul) {
      flushPara();
      if (list !== 'ul') { closeList(); html += '<ul class="md-list">'; list = 'ul'; }
      html += `<li>${inline(ul[1])}</li>`;
      continue;
    }

    const ol = t.match(/^(\d+)[.)]\s+(.+)$/);
    if (ol) {
      flushPara();
      if (list !== 'ol') { closeList(); html += `<ol class="md-list" start="${ol[1]}">`; list = 'ol'; }
      html += `<li>${inline(ol[2])}</li>`;
      continue;
    }

    closeList();
    para.push(t);
  }
  if (inCode) html += `<pre class="md-code">${esc(code.join('\n'))}</pre>`;
  flushPara();
  closeList();
  return html || '<p></p>';
}
