const settings = require('./settings');

// Minimal Telegram Bot API client for one-way notifications (plan ready /
// implementation finished or failed). No inbound webhook, no public endpoint:
// this only ever makes outbound HTTPS calls from this machine to Telegram.
//
// Opt-in. Storing a bot token is not the same as asking to be messaged, so
// notifications are sent only when `telegramEnabled` is explicitly turned on —
// which lets you keep working credentials saved while staying quiet. The one
// exception is the Settings "Send test message" button, which is itself an
// explicit request and passes { force: true }.
const API_BASE = 'https://api.telegram.org';

// Credentials are present. Says nothing about whether sending is wanted.
function isConfigured() {
  const { telegramBotToken, telegramChatId } = settings.get();
  return Boolean(telegramBotToken && telegramChatId);
}

// The user has turned notifications on AND the credentials needed to send exist.
function isEnabled() {
  return Boolean(settings.get().telegramEnabled) && isConfigured();
}

// Telegram's own error text for the most common first-time-setup mistake
// ("chat not found") is accurate but not actionable on its own — bots can't
// message a user until that user has messaged the bot at least once. Append
// the fix so it shows up right where the error does (Settings test button,
// server logs from a real notification failure).
function friendlyError(description) {
  if (/chat not found/i.test(description)) {
    return (
      `${description} — open a chat with your bot in Telegram and send it any message ` +
      `(e.g. /start) first; bots can't message you until you've messaged them.`
    );
  }
  return description;
}

// Sends a plain-text message. Resolves to { ok: true } on success,
// { ok: false, skipped: true, reason } when nothing was sent because the feature
// is off or unconfigured, or { ok: false, error } on failure — never throws, so
// callers can fire this as a best-effort side effect without risking the task
// it's reporting on.
async function sendMessage(text, { force = false } = {}) {
  const { telegramBotToken, telegramChatId, telegramEnabled } = settings.get();
  if (!telegramBotToken || !telegramChatId) {
    return { ok: false, skipped: true, reason: 'not-configured' };
  }
  // Credentials alone must not start a stream of messages the user never asked
  // for; only an explicit opt-in (or an explicit test) sends anything.
  if (!telegramEnabled && !force) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  try {
    const res = await fetch(`${API_BASE}/bot${telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      const raw = (data && data.description) || `Telegram API returned ${res.status}`;
      return { ok: false, error: friendlyError(raw) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { isConfigured, isEnabled, sendMessage };
