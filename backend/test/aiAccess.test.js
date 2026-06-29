const test = require('node:test');
const assert = require('node:assert/strict');
const { isAiAssistantEnabledFor, getAiBetaEmails } = require('../lib/aiAccess');

const withEnv = (value, fn) => {
  const previous = process.env.AI_BETA_EMAILS;
  if (value === undefined) {
    delete process.env.AI_BETA_EMAILS;
  } else {
    process.env.AI_BETA_EMAILS = value;
  }
  try {
    fn();
  } finally {
    if (previous === undefined) {
      delete process.env.AI_BETA_EMAILS;
    } else {
      process.env.AI_BETA_EMAILS = previous;
    }
  }
};

test('AI assistant is disabled when allowlist is empty (fail closed)', () => {
  withEnv('', () => {
    assert.equal(isAiAssistantEnabledFor({ role: 'Admin', email: 'brian@pcxind.com' }), false);
  });
  withEnv(undefined, () => {
    assert.equal(isAiAssistantEnabledFor({ role: 'Admin', email: 'brian@pcxind.com' }), false);
  });
});

test('AI assistant requires the admin role even when email is allowlisted', () => {
  withEnv('brian@pcxind.com', () => {
    assert.equal(isAiAssistantEnabledFor({ role: 'Ventas', email: 'brian@pcxind.com' }), false);
    assert.equal(isAiAssistantEnabledFor({ role: 'Almacen Lider', email: 'brian@pcxind.com' }), false);
  });
});

test('AI assistant allows allowlisted admin, rejects other admins', () => {
  withEnv('brian@pcxind.com', () => {
    assert.equal(isAiAssistantEnabledFor({ role: 'Admin', email: 'brian@pcxind.com' }), true);
    assert.equal(isAiAssistantEnabledFor({ role: 'Admin', email: 'someone@else.com' }), false);
  });
});

test('AI assistant email match is case and whitespace insensitive', () => {
  withEnv(' BRIAN@PCXIND.COM , other@pcxind.com ', () => {
    assert.equal(isAiAssistantEnabledFor({ role: 'admin', email: '  Brian@PcxInd.com ' }), true);
    assert.equal(getAiBetaEmails().size, 2);
  });
});

test('AI assistant handles missing user gracefully', () => {
  withEnv('brian@pcxind.com', () => {
    assert.equal(isAiAssistantEnabledFor(null), false);
    assert.equal(isAiAssistantEnabledFor(undefined), false);
    assert.equal(isAiAssistantEnabledFor({ role: 'Admin' }), false);
  });
});
