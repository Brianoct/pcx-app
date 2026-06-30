const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveAiProvider,
  isAiConfigured,
  getActiveAiProviderInfo,
  resolveTranscriptionProvider,
  isTranscriptionConfigured,
  resolveVisionProvider,
  isVisionConfigured,
  aiChatCompletion
} = require('../lib/aiProvider');

const AI_ENV_KEYS = [
  'AI_PROVIDER', 'AI_API_KEY', 'AI_API_URL', 'AI_MODEL',
  'GROK_API_KEY', 'GROK_API_URL', 'GROK_MODEL',
  'OPENAI_API_KEY', 'OPENAI_API_URL', 'OPENAI_MODEL',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_API_URL', 'ANTHROPIC_MODEL', 'ANTHROPIC_VERSION'
];

const withEnv = (overrides, fn) => {
  const snapshot = {};
  for (const key of AI_ENV_KEYS) {
    snapshot[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const key of AI_ENV_KEYS) {
      if (snapshot[key] === undefined) delete process.env[key];
      else process.env[key] = snapshot[key];
    }
  }
};

test('defaults to grok (OpenAI-compatible) for backward compatibility', () => {
  withEnv({ GROK_API_KEY: 'k-grok' }, () => {
    const cfg = resolveAiProvider();
    assert.equal(cfg.kind, 'grok');
    assert.equal(cfg.api, 'openai');
    assert.equal(cfg.apiKey, 'k-grok');
    assert.equal(cfg.model, 'grok-2-latest');
    assert.ok(cfg.url.includes('x.ai'));
    assert.equal(isAiConfigured(), true);
  });
});

test('isAiConfigured is false with no key', () => {
  withEnv({}, () => {
    assert.equal(isAiConfigured(), false);
  });
});

test('selects OpenAI provider with its defaults', () => {
  withEnv({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k-oai' }, () => {
    const cfg = resolveAiProvider();
    assert.equal(cfg.kind, 'openai');
    assert.equal(cfg.api, 'openai');
    assert.equal(cfg.apiKey, 'k-oai');
    assert.ok(cfg.url.includes('openai.com'));
    assert.equal(cfg.model, 'gpt-4o-mini');
  });
});

test('selects Anthropic provider (and claude alias) with messages API', () => {
  withEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k-ant' }, () => {
    const cfg = resolveAiProvider();
    assert.equal(cfg.kind, 'anthropic');
    assert.equal(cfg.api, 'anthropic');
    assert.ok(cfg.url.includes('anthropic.com'));
    assert.ok(cfg.model.startsWith('claude'));
    assert.ok(cfg.anthropicVersion);
  });
  withEnv({ AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'k-ant' }, () => {
    assert.equal(resolveAiProvider().kind, 'anthropic');
  });
});

test('generic AI_API_KEY overrides provider-specific keys', () => {
  withEnv({ AI_PROVIDER: 'openai', AI_API_KEY: 'k-generic', OPENAI_API_KEY: 'k-oai' }, () => {
    assert.equal(resolveAiProvider().apiKey, 'k-generic');
  });
});

test('AI_MODEL and AI_API_URL override provider defaults', () => {
  withEnv({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k', AI_MODEL: 'gpt-x', AI_API_URL: 'https://proxy/v1/chat' }, () => {
    const cfg = resolveAiProvider();
    assert.equal(cfg.model, 'gpt-x');
    assert.equal(cfg.url, 'https://proxy/v1/chat');
  });
});

test('getActiveAiProviderInfo reports provider/model/configured', () => {
  withEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }, () => {
    const info = getActiveAiProviderInfo();
    assert.equal(info.provider, 'anthropic');
    assert.equal(info.configured, true);
    assert.ok(info.model);
  });
});

test('transcription resolves from AI_TRANSCRIBE_API_KEY or OPENAI_API_KEY (Whisper default)', () => {
  withEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }, () => {
    // anthropic chat key alone does not enable transcription
    assert.equal(isTranscriptionConfigured(), false);
  });
  withEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k-oai' }, () => {
    const cfg = resolveTranscriptionProvider();
    assert.equal(cfg.apiKey, 'k-oai');
    assert.ok(cfg.url.includes('audio/transcriptions'));
    assert.equal(cfg.model, 'whisper-1');
    assert.equal(isTranscriptionConfigured(), true);
  });
  withEnv({ AI_TRANSCRIBE_API_KEY: 'k-tr', AI_TRANSCRIBE_MODEL: 'gpt-4o-transcribe' }, () => {
    const cfg = resolveTranscriptionProvider();
    assert.equal(cfg.apiKey, 'k-tr');
    assert.equal(cfg.model, 'gpt-4o-transcribe');
  });
});

test('vision reuses the active provider with optional model override', () => {
  withEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }, () => {
    const cfg = resolveVisionProvider();
    assert.equal(cfg.api, 'anthropic');
    assert.equal(cfg.apiKey, 'k');
    assert.equal(isVisionConfigured(), true);
  });
  withEnv({ AI_PROVIDER: 'grok', GROK_API_KEY: 'k', AI_VISION_MODEL: 'grok-2-vision' }, () => {
    const cfg = resolveVisionProvider();
    assert.equal(cfg.model, 'grok-2-vision');
    assert.equal(cfg.api, 'openai');
  });
});

// ── aiChatCompletion network path (fetch is mocked) ──────────────────────────

const withEnvAsync = async (overrides, fn) => {
  const snapshot = {};
  for (const key of AI_ENV_KEYS) {
    snapshot[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const key of AI_ENV_KEYS) {
      if (snapshot[key] === undefined) delete process.env[key];
      else process.env[key] = snapshot[key];
    }
  }
};

const withFetch = async (impl, fn) => {
  const original = global.fetch;
  global.fetch = impl;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
};

const fakeResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body)
});

test('aiChatCompletion (anthropic) omits sampling params and parses text blocks', async () => {
  let captured = null;
  await withEnvAsync({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k-ant' }, async () => {
    await withFetch(
      async (url, init) => {
        captured = { url, init, body: JSON.parse(init.body) };
        return fakeResponse(200, { content: [{ type: 'text', text: 'hola mundo' }] });
      },
      async () => {
        const res = await aiChatCompletion({ system: 'sys', user: 'hi', temperature: 0.9 });
        assert.equal(res.content, 'hola mundo');
        assert.equal(res.provider, 'anthropic');
      }
    );
  });
  // Current Claude models reject sampling params with a 400 — must not be sent.
  assert.equal(captured.body.temperature, undefined);
  assert.equal(captured.body.top_p, undefined);
  assert.equal(captured.body.top_k, undefined);
  assert.equal(captured.init.headers['x-api-key'], 'k-ant');
  assert.equal(captured.body.system, 'sys');
  assert.ok(captured.url.includes('anthropic.com'));
});

test('aiChatCompletion (anthropic, json) forces tool-use and parses tool_use input', async () => {
  let captured = null;
  await withEnvAsync({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k-ant' }, async () => {
    await withFetch(
      async (url, init) => {
        captured = JSON.parse(init.body);
        return fakeResponse(200, { content: [{ type: 'tool_use', input: { ok: true, n: 2 } }] });
      },
      async () => {
        const res = await aiChatCompletion({ user: 'give json', json: true });
        assert.deepEqual(JSON.parse(res.content), { ok: true, n: 2 });
      }
    );
  });
  assert.ok(Array.isArray(captured.tools) && captured.tools.length === 1);
  assert.equal(captured.tool_choice.type, 'tool');
});

test('aiChatCompletion (openai/grok, json) sends response_format and parses choices', async () => {
  let captured = null;
  await withEnvAsync({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k-oai' }, async () => {
    await withFetch(
      async (url, init) => {
        captured = { init, body: JSON.parse(init.body) };
        return fakeResponse(200, { choices: [{ message: { content: '{"x":1}' } }] });
      },
      async () => {
        const res = await aiChatCompletion({ user: 'hi', json: true, temperature: 0.4 });
        assert.equal(res.content, '{"x":1}');
        assert.equal(res.provider, 'openai');
      }
    );
  });
  assert.equal(captured.body.response_format.type, 'json_object');
  // temperature is valid on the OpenAI-compatible path and should be forwarded.
  assert.equal(captured.body.temperature, 0.4);
  assert.equal(captured.init.headers.Authorization, 'Bearer k-oai');
});

test('aiChatCompletion throws on a non-2xx provider response', async () => {
  await withEnvAsync({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k-ant' }, async () => {
    await withFetch(
      async () => fakeResponse(400, { error: { message: 'bad model' } }),
      async () => {
        await assert.rejects(
          () => aiChatCompletion({ user: 'hi' }),
          /HTTP 400/
        );
      }
    );
  });
});

test('aiChatCompletion throws AI_NOT_CONFIGURED when no key is set', async () => {
  await withEnvAsync({}, async () => {
    await assert.rejects(
      () => aiChatCompletion({ user: 'hi' }),
      (err) => err.code === 'AI_NOT_CONFIGURED'
    );
  });
});
