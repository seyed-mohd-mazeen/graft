const settings = require('./settings');

function authHeader(email, token) {
  const creds = Buffer.from(`${email}:${token}`).toString('base64');
  return `Basic ${creds}`;
}

// `init` follows fetch's own shape ({ method, body }) — GET by default, so
// every existing call site (which only ever reads) is unaffected.
async function jiraFetch(path, init) {
  const { jiraDomain, jiraEmail, jiraToken } = settings.get();
  if (!jiraDomain || !jiraEmail || !jiraToken) {
    throw new Error('Jira is not configured. Add your domain, email, and API token in Settings.');
  }
  const res = await fetch(`https://${jiraDomain}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(jiraEmail, jiraToken),
      Accept: 'application/json',
      ...(init && init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init && init.headers),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Jira request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  // A successful comment POST returns a body; some Jira write endpoints
  // return 204 with none — tolerate that rather than throwing on empty JSON.
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// Decode the HTML entities Jira's rendered fields contain, including numeric
// ones. Applied after tag stripping so an entity can never reintroduce a tag.
function decodeEntities(text) {
  const named = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    hellip: '…',
    mdash: '—',
    ndash: '–',
    laquo: '«',
    raquo: '»',
    rsquo: '’',
    lsquo: '‘',
    ldquo: '“',
    rdquo: '”',
  };
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(named, key) ? named[key] : m;
    });
}

// Strip the HTML Jira gives us in renderedFields down to readable plain text.
//
// Structure is preserved rather than flattened, because this text is the brief
// Claude works from. Blindly deleting every tag used to throw away the parts
// that carry the most meaning: a link's href (so "see the spec" lost the URL
// entirely), code-block boundaries (so snippets merged into the prose and lost
// their indentation), and table cell separation (so rows ran together).
function htmlToText(html) {
  if (!html) return '';

  let text = String(html);

  // Code blocks become fenced blocks, so Claude can tell code from prose.
  text = text
    .replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_, code) => `\n\n\`\`\`\n${code}\n\`\`\`\n\n`)
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => `\n\n\`\`\`\n${code}\n\`\`\`\n\n`)
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => `\`${code}\``);

  // Keep the destination of links: "text (https://…)", skipping the noise when
  // the label already is the URL.
  text = text.replace(/<a\b[^>]*?href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const clean = label.replace(/<[^>]+>/g, '').trim();
    if (!href || href.startsWith('#')) return clean;
    return clean && clean !== href ? `${clean} (${href})` : href;
  });

  // Images carry their alt text or filename rather than disappearing silently.
  text = text.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = /alt\s*=\s*["']([^"']*)["']/i.exec(tag);
    const src = /src\s*=\s*["']([^"']*)["']/i.exec(tag);
    const label = (alt && alt[1]) || (src && src[1].split('/').pop()) || 'image';
    return `[image: ${label}]`;
  });

  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|tr|blockquote)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    // Cell boundaries, so table rows stay readable as rows.
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ' | ')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<[^>]+>/g, '');

  text = decodeEntities(text);

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function getMyTickets() {
  const jql = encodeURIComponent(
    'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC'
  );
  const data = await jiraFetch(
    `/rest/api/3/search/jql?jql=${jql}&fields=summary,status,issuetype,priority,updated&maxResults=50`
  );
  // Tolerate a response without an `issues` array rather than throwing a
  // TypeError that surfaces as an opaque 500.
  const issues = Array.isArray(data && data.issues) ? data.issues : [];
  return issues.map((issue) => {
    const fields = issue.fields || {};
    return {
      key: issue.key,
      summary: fields.summary,
      status: fields.status?.name || 'Unknown',
      type: fields.issuetype?.name || 'Task',
      priority: fields.priority?.name || null,
      updated: fields.updated,
    };
  });
}

// Comments, oldest first. Fetched separately from the issue because that is the
// endpoint that renders them to HTML, and because a comment-thread failure
// should degrade the ticket rather than fail it.
async function getComments(key, limit = 20) {
  try {
    const data = await jiraFetch(
      `/rest/api/3/issue/${encodeURIComponent(key)}/comment?maxResults=${limit}&orderBy=created&expand=renderedBody`
    );
    const comments = Array.isArray(data && data.comments) ? data.comments : [];
    return comments
      .map((c) => ({
        author: c.author?.displayName || 'Unknown',
        created: c.created ? String(c.created).slice(0, 10) : null,
        body: htmlToText(c.renderedBody),
      }))
      .filter((c) => c.body);
  } catch {
    return [];
  }
}

function mapLinks(issueLinks) {
  const out = [];
  for (const link of issueLinks || []) {
    const outward = link.outwardIssue;
    const inward = link.inwardIssue;
    const other = outward || inward;
    if (!other) continue;
    const type = outward ? link.type?.outward : link.type?.inward;
    out.push({
      key: other.key,
      summary: other.fields?.summary || '',
      type: type || 'relates to',
    });
  }
  return out;
}

// Plain text -> the Atlassian Document Format the v3 comment API requires.
// Blank lines start a new paragraph; single newlines within one become a hard
// break, so a multi-line comment (branch name, then a summary) reads the same
// as it was written instead of running together.
function textToAdf(text) {
  const paragraphs = String(text || '').split(/\n{2,}/);
  const content = paragraphs
    .map((p) => p.trim())
    .filter(Boolean)
    .map((para) => {
      const lines = para.split('\n');
      const inline = [];
      lines.forEach((line, i) => {
        if (i > 0) inline.push({ type: 'hardBreak' });
        if (line) inline.push({ type: 'text', text: line });
      });
      return { type: 'paragraph', content: inline };
    });
  return { type: 'doc', version: 1, content: content.length ? content : [{ type: 'paragraph', content: [] }] };
}

// Post a comment to a ticket — used to close the loop when a run finishes
// (branch name + Claude's summary), gated behind its own opt-in setting so it
// never fires unless explicitly turned on.
async function addComment(key, bodyText) {
  await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
    method: 'POST',
    body: JSON.stringify({ body: textToAdf(bodyText) }),
  });
}

async function getTicket(key) {
  const data = await jiraFetch(
    `/rest/api/3/issue/${encodeURIComponent(
      key
    )}?fields=summary,description,issuetype,priority,status,parent,issuelinks,attachment,labels&expand=renderedFields`
  );
  const fields = data.fields || {};
  const parent = fields.parent
    ? { key: fields.parent.key, summary: fields.parent.fields?.summary || '' }
    : null;

  return {
    key: data.key,
    summary: fields.summary,
    type: fields.issuetype?.name || 'Task',
    priority: fields.priority?.name || null,
    status: fields.status?.name || 'Unknown',
    description: htmlToText(data.renderedFields?.description),
    labels: Array.isArray(fields.labels) ? fields.labels : [],
    parent,
    links: mapLinks(fields.issuelinks),
    attachments: (fields.attachment || []).map((a) => ({
      filename: a.filename,
      mimeType: a.mimeType || null,
    })),
    comments: await getComments(key),
  };
}

module.exports = { getMyTickets, getTicket, getComments, addComment, htmlToText, textToAdf };
