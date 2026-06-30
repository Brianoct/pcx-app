const { normalizeRole } = require('./rbac');

// Private-beta gate for the AI assistant.
//
// The feature is intentionally locked down so it can be tested by a single
// account before any wider rollout. Access requires BOTH:
//   1. the Admin role, and
//   2. the user's email being present in the AI_BETA_EMAILS allowlist.
//
// AI_BETA_EMAILS is a comma-separated list set as a backend env var, e.g.
//   AI_BETA_EMAILS=brian@pcxind.com
//
// Fail-closed: if AI_BETA_EMAILS is empty/unset, the assistant is disabled for
// everyone (no accidental exposure). To turn it off entirely, blank the var.

const normalizeEmail = (value = '') => String(value || '').trim().toLowerCase();

const getAiBetaEmails = () => {
  const raw = String(process.env.AI_BETA_EMAILS || '');
  return new Set(
    raw
      .split(',')
      .map((entry) => normalizeEmail(entry))
      .filter(Boolean)
  );
};

const isAiAssistantEnabledFor = (user) => {
  if (!user) return false;
  if (normalizeRole(user.role || '') !== 'admin') return false;
  const allowlist = getAiBetaEmails();
  if (allowlist.size === 0) return false;
  return allowlist.has(normalizeEmail(user.email || ''));
};

const requireAiAssistant = async (req, res, next) => {
  // Re-validate against the live DB record instead of trusting the role/email
  // baked into the JWT at login: a demoted admin or changed/removed email loses
  // access immediately rather than at token expiry. `loadUserContext` is
  // lazy-required so this module (and isAiAssistantEnabledFor's unit tests) stay
  // free of a `pg` import at load time.
  try {
    const { loadUserContext } = require('./users');
    const freshUser = req.user?.id ? await loadUserContext(req.user.id) : null;
    if (!isAiAssistantEnabledFor(freshUser)) {
      return res.status(403).json({ error: 'Asistente IA no disponible para esta cuenta' });
    }
    return next();
  } catch (err) {
    console.error('AI access check error:', err);
    return res.status(500).json({ error: 'No se pudo verificar el acceso al asistente IA' });
  }
};

module.exports = {
  getAiBetaEmails,
  isAiAssistantEnabledFor,
  requireAiAssistant
};
