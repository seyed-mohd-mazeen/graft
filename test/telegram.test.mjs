import { test } from 'node:test';
import assert from 'node:assert/strict';
// lib/telegram.js is CommonJS; default import gives module.exports.
import telegram from '../lib/telegram.js';
import settingsModule from '../lib/settings.js';

// Swap settings.get() and global fetch for the duration of one test, always
// restoring in a finally so other tests (and the real data/settings.json)
// are never affected.
async function withStubs({ settingsValue, fetchImpl }, fn) {
  const originalGet = settingsModule.get;
  const originalFetch = globalThis.fetch;
  settingsModule.get = () => settingsValue;
  globalThis.fetch = fetchImpl;
  try {
    await fn();
  } finally {
    settingsModule.get = originalGet;
    globalThis.fetch = originalFetch;
  }
}

// Enabled + fully configured, the normal "notifications are on" state.
const on = { telegramBotToken: 'tok', telegramChatId: '123', telegramEnabled: true };

test('isConfigured is false unless both a bot token and chat id are set', async () => {
  await withStubs({ settingsValue: { telegramBotToken: '', telegramChatId: '' }, fetchImpl: originalFetchUnused }, async () => {
    assert.equal(telegram.isConfigured(), false);
  });
  await withStubs({ settingsValue: { telegramBotToken: 't', telegramChatId: '' }, fetchImpl: originalFetchUnused }, async () => {
    assert.equal(telegram.isConfigured(), false);
  });
  await withStubs({ settingsValue: { telegramBotToken: 't', telegramChatId: 'c' }, fetchImpl: originalFetchUnused }, async () => {
    assert.equal(telegram.isConfigured(), true);
  });
});
// Placeholder fetch for the cases above — never actually called.
async function originalFetchUnused() {
  throw new Error('fetch should not be called here');
}

// The feature is opt-in: storing a bot token is not the same as asking to be
// messaged, so isConfigured() and isEnabled() are deliberately different things.

test('isEnabled requires the opt-in as well as credentials', async () => {
  await withStubs({ settingsValue: { telegramBotToken: 't', telegramChatId: 'c' }, fetchImpl: originalFetchUnused }, async () => {
    assert.equal(telegram.isConfigured(), true);
    assert.equal(telegram.isEnabled(), false, 'credentials alone must not enable it');
  });
  await withStubs({ settingsValue: { ...on }, fetchImpl: originalFetchUnused }, async () => {
    assert.equal(telegram.isEnabled(), true);
  });
  // Enabled but unconfigured cannot send, so it is not enabled in any useful sense.
  await withStubs(
    { settingsValue: { telegramBotToken: '', telegramChatId: '', telegramEnabled: true }, fetchImpl: originalFetchUnused },
    async () => {
      assert.equal(telegram.isEnabled(), false);
    }
  );
});

test('sendMessage sends nothing while the feature is off', async () => {
  await withStubs(
    { settingsValue: { telegramBotToken: 'tok', telegramChatId: '123' }, fetchImpl: originalFetchUnused },
    async () => {
      const result = await telegram.sendMessage('hello');
      assert.deepEqual(result, { ok: false, skipped: true, reason: 'disabled' });
    }
  );
  // Explicitly disabled is treated the same as never enabled.
  await withStubs(
    { settingsValue: { ...on, telegramEnabled: false }, fetchImpl: originalFetchUnused },
    async () => {
      assert.equal((await telegram.sendMessage('hello')).skipped, true);
    }
  );
});

test('the test button can send while the feature is still off', async () => {
  // Pressing "Send test message" is itself an explicit request, and being able
  // to verify credentials before opting in is the order you'd actually want.
  let called = 0;
  await withStubs(
    {
      settingsValue: { telegramBotToken: 'tok', telegramChatId: '123', telegramEnabled: false },
      fetchImpl: async () => {
        called++;
        return { ok: true, json: async () => ({ ok: true }) };
      },
    },
    async () => {
      assert.deepEqual(await telegram.sendMessage('test', { force: true }), { ok: true });
      assert.equal(called, 1);
    }
  );
});

test('force still cannot send without credentials', async () => {
  await withStubs(
    { settingsValue: { telegramBotToken: '', telegramChatId: '' }, fetchImpl: originalFetchUnused },
    async () => {
      assert.deepEqual(await telegram.sendMessage('test', { force: true }), {
        ok: false,
        skipped: true,
        reason: 'not-configured',
      });
    }
  );
});

test('sendMessage skips without configured credentials, never calling fetch', async () => {
  await withStubs(
    { settingsValue: { telegramBotToken: '', telegramChatId: '', telegramEnabled: true }, fetchImpl: originalFetchUnused },
    async () => {
      const result = await telegram.sendMessage('hello');
      assert.deepEqual(result, { ok: false, skipped: true, reason: 'not-configured' });
    }
  );
});

test('sendMessage resolves ok:true on a successful Telegram response', async () => {
  await withStubs(
    {
      settingsValue: { ...on },
      fetchImpl: async (url) => {
        assert.match(url, /\/bottok\/sendMessage$/);
        return { ok: true, json: async () => ({ ok: true }) };
      },
    },
    async () => {
      const result = await telegram.sendMessage('hello');
      assert.deepEqual(result, { ok: true });
    }
  );
});

test('sendMessage enriches "chat not found" with an actionable hint', async () => {
  await withStubs(
    {
      settingsValue: { ...on },
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        json: async () => ({ ok: false, description: 'Bad Request: chat not found' }),
      }),
    },
    async () => {
      const result = await telegram.sendMessage('hello');
      assert.equal(result.ok, false);
      assert.match(result.error, /chat not found/);
      assert.match(result.error, /send it any message/);
    }
  );
});

test('sendMessage passes through other API errors unmodified', async () => {
  await withStubs(
    {
      settingsValue: { ...on, telegramBotToken: 'bad-token' },
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ ok: false, description: 'Unauthorized' }),
      }),
    },
    async () => {
      const result = await telegram.sendMessage('hello');
      assert.deepEqual(result, { ok: false, error: 'Unauthorized' });
    }
  );
});

test('sendMessage reports network failures without throwing', async () => {
  await withStubs(
    {
      settingsValue: { ...on },
      fetchImpl: async () => {
        throw new Error('getaddrinfo ENOTFOUND api.telegram.org');
      },
    },
    async () => {
      const result = await telegram.sendMessage('hello');
      assert.equal(result.ok, false);
      assert.match(result.error, /ENOTFOUND/);
    }
  );
});
