const {
  ADMIN_AI_SENSITIVE_FIELDS,
  buildAdminAiExpandedDataset,
  detectAdminAiIntent,
  generateAdminAiSummary
} = require('./adminAi');
const { runAdminAnalyticsQuery, formatPeriodLabel } = require('./adminAnalytics');

// Shared "ask your business a question" flow:
//   1. detect the intent from the question text,
//   2. pull the focused dataset for that intent,
//   3. always include the wider business snapshot as context,
//   4. ask the model for an executive summary (or fall back to a template).
// Returns a serializable payload used by both the admin stats endpoint and the
// gated AI assistant endpoint. Sensitive customer fields are never included.
const answerAdminAiQuestion = async ({ question, month, year }) => {
  const intent = detectAdminAiIntent(question);
  const dataset = await runAdminAnalyticsQuery({ queryKey: intent.key, month, year });
  const expandedContext = intent.key === 'full_business_snapshot'
    ? dataset
    : await buildAdminAiExpandedDataset({ month, year });
  const periodLabel = formatPeriodLabel(month, year);
  const summaryPayload = await generateAdminAiSummary({
    question,
    intentLabel: intent.label,
    periodLabel,
    datasetTitle: dataset.title,
    rows: dataset.rows || [],
    expandedContextTitle: expandedContext?.title,
    expandedContextRows: expandedContext?.rows || []
  });

  return {
    intent_key: intent.key,
    intent_label: intent.label,
    period: {
      month: Number.isInteger(Number.parseInt(month, 10)) ? Number.parseInt(month, 10) : null,
      year: Number.isInteger(Number.parseInt(year, 10)) ? Number.parseInt(year, 10) : null,
      label: periodLabel
    },
    summary: summaryPayload.summary,
    provider: summaryPayload.provider,
    excluded_sensitive_fields: ADMIN_AI_SENSITIVE_FIELDS,
    data: {
      title: dataset.title,
      rows: Array.isArray(dataset.rows) ? dataset.rows : []
    }
  };
};

module.exports = {
  answerAdminAiQuestion
};
