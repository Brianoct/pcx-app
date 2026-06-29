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

const requireAiAssistant = (req, res, next) => {
  if (!isAiAssistantEnabledFor(req.user)) {
    return res.status(403).json({ error: 'Asistente IA no disponible para esta cuenta' });
  }
  next();
};

module.exports = {
  getAiBetaEmails,
  isAiAssistantEnabledFor,
  requireAiAssistant
};
