const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveAiProvider,
  isAiConfigured,
  getActiveAiProviderInfo,
  resolveTranscriptionProvider,
  isTranscriptionConfigured,
  resolveVisionProvider,
  isVisionConfigured
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
