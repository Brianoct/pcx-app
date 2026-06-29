// Provider-agnostic AI text generation.
//
// The active provider is chosen with the AI_PROVIDER env var:
//   - grok       (xAI, OpenAI-compatible)  [default, backward compatible]
//   - openai     (OpenAI chat completions)
//   - anthropic  (Anthropic Claude messages API)   alias: claude
//
// Keys resolve in this order: AI_API_KEY (generic) → provider-specific key.
// Model/URL can be overridden with AI_MODEL / AI_API_URL, or provider-specific
// vars. Existing GROK_API_KEY / GROK_API_URL / GROK_MODEL keep working.

const firstNonEmpty = (...values) => {
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
};

const resolveAiProvider = () => {
  const kind = String(process.env.AI_PROVIDER || 'grok').trim().toLowerCase();
  const genericKey = String(process.env.AI_API_KEY || '').trim();

  if (kind === 'openai') {
    return {
      kind: 'openai',
      api: 'openai',
      apiKey: firstNonEmpty(genericKey, process.env.OPENAI_API_KEY),
      url: firstNonEmpty(process.env.AI_API_URL, process.env.OPENAI_API_URL, 'https://api.openai.com/v1/chat/completions'),
      model: firstNonEmpty(process.env.AI_MODEL, process.env.OPENAI_MODEL, 'gpt-4o-mini')
    };
  }

  if (kind === 'anthropic' || kind === 'claude') {
    return {
      kind: 'anthropic',
      api: 'anthropic',
      apiKey: firstNonEmpty(genericKey, process.env.ANTHROPIC_API_KEY),
      url: firstNonEmpty(process.env.AI_API_URL, process.env.ANTHROPIC_API_URL, 'https://api.anthropic.com/v1/messages'),
      model: firstNonEmpty(process.env.AI_MODEL, process.env.ANTHROPIC_MODEL, 'claude-3-5-sonnet-latest'),
      anthropicVersion: firstNonEmpty(process.env.ANTHROPIC_VERSION, '2023-06-01')
    };
  }

  // Default: grok (xAI), OpenAI-compatible API.
  return {
    kind: 'grok',
    api: 'openai',
    apiKey: firstNonEmpty(genericKey, process.env.GROK_API_KEY),
    url: firstNonEmpty(process.env.AI_API_URL, process.env.GROK_API_URL, 'https://api.x.ai/v1/chat/completions'),
    model: firstNonEmpty(process.env.AI_MODEL, process.env.GROK_MODEL, 'grok-2-latest')
  };
};

// Best-effort read of a provider's error body so failures are actionable
// (e.g. invalid model, auth error) instead of a bare status code.
const safeErrorText = async (response) => {
  try {
    const text = (await response.text()) || '';
    return text.replace(/\s+/g, ' ').trim().slice(0, 300);
  } catch {
    return '';
  }
};

const isAiConfigured = () => Boolean(resolveAiProvider().apiKey);

const getActiveAiProviderInfo = () => {
  const cfg = resolveAiProvider();
  return { provider: cfg.kind, model: cfg.model, configured: Boolean(cfg.apiKey) };
};

// Single chat-completion entry point used across the app.
// Returns { content, provider, model }. Throws on missing key or HTTP error.
const aiChatCompletion = async ({ system = '', user = '', temperature = 0.3, maxTokens = 700 }) => {
  const cfg = resolveAiProvider();
  if (!cfg.apiKey) {
    const err = new Error('Proveedor de IA no configurado');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }

  if (cfg.api === 'anthropic') {
    const response = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'x-api-key': cfg.apiKey,
        'anthropic-version': cfg.anthropicVersion,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: user }]
      })
    });
    if (!response.ok) {
      throw new Error(`${cfg.kind} HTTP ${response.status}: ${await safeErrorText(response)}`);
    }
    const payload = await response.json();
    const content = Array.isArray(payload?.content)
      ? payload.content.map((block) => String(block?.text || '')).join('').trim()
      : '';
    return { content, provider: cfg.kind, model: cfg.model };
  }

  // OpenAI-compatible (openai, grok)
  const response = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: user }
      ]
    })
  });
  if (!response.ok) {
    throw new Error(`${cfg.kind} HTTP ${response.status}: ${await safeErrorText(response)}`);
  }
  const payload = await response.json();
  const content = String(payload?.choices?.[0]?.message?.content || '').trim();
  return { content, provider: cfg.kind, model: cfg.model };
};

module.exports = {
  resolveAiProvider,
  isAiConfigured,
  getActiveAiProviderInfo,
  aiChatCompletion
};
