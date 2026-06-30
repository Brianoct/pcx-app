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

const isAiConfigured = () => Boolean(resolveAiProvider().apiKey);

const getActiveAiProviderInfo = () => {
  const cfg = resolveAiProvider();
  return { provider: cfg.kind, model: cfg.model, configured: Boolean(cfg.apiKey) };
};

// ── Audio transcription (speech-to-text) ─────────────────────────────────────
// Uses an OpenAI-compatible transcription endpoint (Whisper). Anthropic/Grok do
// not transcribe audio, so this resolves its own key (AI_TRANSCRIBE_API_KEY,
// else OPENAI_API_KEY, else AI_API_KEY when the active provider is openai).
const resolveTranscriptionProvider = () => {
  const providerKind = String(process.env.AI_PROVIDER || 'grok').trim().toLowerCase();
  const apiKey = firstNonEmpty(
    process.env.AI_TRANSCRIBE_API_KEY,
    process.env.OPENAI_API_KEY,
    providerKind === 'openai' ? process.env.AI_API_KEY : ''
  );
  return {
    apiKey,
    url: firstNonEmpty(process.env.AI_TRANSCRIBE_URL, 'https://api.openai.com/v1/audio/transcriptions'),
    model: firstNonEmpty(process.env.AI_TRANSCRIBE_MODEL, 'whisper-1')
  };
};

const isTranscriptionConfigured = () => Boolean(resolveTranscriptionProvider().apiKey);

const transcribeAudio = async ({ buffer, filename = 'audio.ogg', mimeType = 'audio/ogg' }) => {
  const cfg = resolveTranscriptionProvider();
  if (!cfg.apiKey) {
    const err = new Error('Transcripción de audio no configurada');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }
  const form = new FormData();
  form.append('model', cfg.model);
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  const response = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: form
  });
  if (!response.ok) {
    throw new Error(`transcription HTTP ${response.status}: ${await safeErrorText(response)}`);
  }
  const payload = await response.json().catch(() => null);
  return String(payload?.text || '').trim();
};

// ── Image understanding (vision) ─────────────────────────────────────────────
// Reuses the active chat provider but allows a vision-capable model override
// (AI_VISION_MODEL). Defaults: openai gpt-4o-mini and anthropic claude-3-5-sonnet
// are vision-capable out of the box; grok needs a vision model override.
const resolveVisionProvider = () => {
  const base = resolveAiProvider();
  return {
    ...base,
    apiKey: firstNonEmpty(process.env.AI_VISION_API_KEY, base.apiKey),
    model: firstNonEmpty(process.env.AI_VISION_MODEL, base.model)
  };
};

const isVisionConfigured = () => Boolean(resolveVisionProvider().apiKey);

const aiVisionDescribe = async ({ base64, mimeType = 'image/jpeg', prompt = '', maxTokens = 400 }) => {
  const cfg = resolveVisionProvider();
  if (!cfg.apiKey) {
    const err = new Error('Visión de imágenes no configurada');
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
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } }
          ]
        }]
      })
    });
    if (!response.ok) {
      throw new Error(`${cfg.kind} vision HTTP ${response.status}: ${await safeErrorText(response)}`);
    }
    const payload = await response.json();
    return Array.isArray(payload?.content)
      ? payload.content.map((block) => String(block?.text || '')).join('').trim()
      : '';
  }

  // OpenAI-compatible (openai, grok-vision)
  const response = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
        ]
      }]
    })
  });
  if (!response.ok) {
    throw new Error(`${cfg.kind} vision HTTP ${response.status}: ${await safeErrorText(response)}`);
  }
  const payload = await response.json();
  return String(payload?.choices?.[0]?.message?.content || '').trim();
};

// Single chat-completion entry point used across the app.
// Returns { content, provider, model }. Throws on missing key or HTTP error.
const aiChatCompletion = async ({ system = '', user = '', temperature = 0.3, maxTokens = 700, json = false }) => {
  const cfg = resolveAiProvider();
  if (!cfg.apiKey) {
    const err = new Error('Proveedor de IA no configurado');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }

  if (cfg.api === 'anthropic') {
    // Force valid JSON via tool-use (works across Claude models; assistant
    // message prefill is rejected by some models, e.g. claude-sonnet-4-6).
    const body = {
      model: cfg.model,
      max_tokens: maxTokens,
      temperature,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: user }]
    };
    if (json) {
      body.tools = [{
        name: 'emitir_json',
        description: 'Devuelve la respuesta solicitada como un único objeto JSON.',
        input_schema: { type: 'object', additionalProperties: true }
      }];
      body.tool_choice = { type: 'tool', name: 'emitir_json' };
    }
    const response = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'x-api-key': cfg.apiKey,
        'anthropic-version': cfg.anthropicVersion,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`${cfg.kind} HTTP ${response.status}: ${await safeErrorText(response)}`);
    }
    const payload = await response.json();
    const blocks = Array.isArray(payload?.content) ? payload.content : [];
    let content;
    if (json) {
      const toolBlock = blocks.find((block) => block?.type === 'tool_use');
      content = toolBlock && toolBlock.input ? JSON.stringify(toolBlock.input) : '';
    } else {
      content = blocks.map((block) => String(block?.text || '')).join('').trim();
    }
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
      ...(json ? { response_format: { type: 'json_object' } } : {}),
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
  aiChatCompletion,
  resolveTranscriptionProvider,
  isTranscriptionConfigured,
  transcribeAudio,
  resolveVisionProvider,
  isVisionConfigured,
  aiVisionDescribe
};
