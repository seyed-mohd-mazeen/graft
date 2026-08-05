// Best-effort subscription-usage reader.
//
// This uses the SAME undocumented endpoint that Claude Code's interactive
// `/usage` command queries (api.anthropic.com/api/oauth/usage). It is NOT a
// supported/public API and may change or disappear on any Claude Code update.
//
// We read the OAuth access token straight from Claude Code's credentials file
// and never write to it: the refresh token rotates, and rewriting the file
// could invalidate the CLI's own login. When the short-lived access token has
// expired we simply report 'expired' — running any task (or Claude Code
// itself) refreshes the token on disk, after which usage works again.

const fs = require('fs');
const os = require('os');
const path = require('path');

const CRED_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

// credPath defaults to the real credentials file; tests pass a throwaway one
// instead, so exercising checkLogin() never has to touch (or risk corrupting)
// this machine's actual Claude Code login.
function readOauth(credPath = CRED_PATH) {
  const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  const oauth = cred.claudeAiOauth;
  if (!oauth || !oauth.accessToken) throw new Error('No OAuth token in credentials file');
  return oauth;
}

function round(n) {
  return typeof n === 'number' ? Math.round(n) : null;
}

// Local-only, no network call: does a Claude Code login exist on this machine?
// Used by the setup/doctor check, which needs a fast, offline-friendly signal
// rather than a round trip to the usage endpoint.
function checkLogin(credPath = CRED_PATH) {
  try {
    const oauth = readOauth(credPath);
    return { ok: true, plan: oauth.subscriptionType || null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Reduce the raw endpoint payload to the few bars the UI shows.
function normalize(data, oauth) {
  const session = data.five_hour || {};
  const weekly = data.seven_day || {};

  // Any per-model / per-surface weekly limits that are currently in effect
  // (e.g. a separate weekly Opus cap). Skipped when inactive to avoid clutter.
  const scoped = (data.limits || [])
    .filter((l) => l.scope && l.is_active && l.percent != null)
    .map((l) => ({
      label: l.scope?.model?.display_name
        ? `${l.scope.model.display_name} (weekly)`
        : l.kind || 'scoped',
      percent: round(l.percent),
      resetsAt: l.resets_at || null,
    }));

  const bars = [
    { label: 'Session (5h)', percent: round(session.utilization), resetsAt: session.resets_at || null },
    { label: 'Weekly', percent: round(weekly.utilization), resetsAt: weekly.resets_at || null },
    ...scoped,
  ].filter((b) => b.percent != null);

  return {
    available: true,
    plan: oauth.subscriptionType || null,
    bars,
    fetchedAt: Date.now(),
  };
}

async function getUsage() {
  let oauth;
  try {
    oauth = readOauth();
  } catch {
    return { available: false, reason: 'no-credentials', message: 'Could not read Claude credentials.' };
  }

  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${oauth.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'User-Agent': 'graft/1.0',
      },
    });
    if (res.status === 401 || res.status === 403) {
      return {
        available: false,
        reason: 'expired',
        message: 'Token expired — run a task or use Claude Code to refresh it.',
      };
    }
    if (!res.ok) {
      return { available: false, reason: 'error', message: `Usage endpoint returned ${res.status}.` };
    }
    return normalize(await res.json(), oauth);
  } catch (err) {
    return { available: false, reason: 'error', message: err.message };
  }
}

module.exports = { getUsage, checkLogin };
