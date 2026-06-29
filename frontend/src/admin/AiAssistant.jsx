import { useState } from 'react';
import { apiRequest } from '../apiClient';

// Sales-focused starter questions. The assistant understands free text too;
// these are just quick prompts to make the first experience obvious.
const SUGGESTIONS = [
  '¿Cómo van las ventas este mes?',
  '¿Qué productos se venden más?',
  'Dame el ranking de vendedores',
  'Rendimiento por almacén',
  'Proyección de comisiones por ventas',
  'Dame un panorama integral del negocio'
];

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const formatCell = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toString() : value.toFixed(2);
  }
  const asNumber = Number(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(asNumber)) {
    return Number.isInteger(asNumber) ? asNumber.toString() : asNumber.toFixed(2);
  }
  return String(value);
};

// Minimal, safe markdown renderer (no dangerouslySetInnerHTML): supports
// headings, bold, bullet lists, markdown tables, and plain paragraphs.
const renderInline = (text, keyPrefix) => {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    const boldMatch = /^\*\*([^*]+)\*\*$/.exec(part);
    if (boldMatch) return <strong key={`${keyPrefix}-b-${idx}`}>{boldMatch[1]}</strong>;
    return <span key={`${keyPrefix}-t-${idx}`}>{part}</span>;
  });
};

const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isTableDivider = (line) => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');
const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

const renderMarkdown = (markdown) => {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let listBuffer = [];
  let i = 0;

  const flushList = () => {
    if (listBuffer.length > 0) {
      const items = [...listBuffer];
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="ai-md-list">
          {items.map((item, idx) => (
            <li key={`li-${blocks.length}-${idx}`}>{renderInline(item, `li-${blocks.length}-${idx}`)}</li>
          ))}
        </ul>
      );
      listBuffer = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flushList();
      const header = splitRow(line);
      const bodyRows = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i]) && !isTableDivider(lines[i])) {
        bodyRows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push(
        <div className="admin-ai-table-wrap" key={`tbl-${blocks.length}`}>
          <table className="admin-ai-table">
            <thead>
              <tr>{header.map((h, idx) => <th key={`th-${blocks.length}-${idx}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rIdx) => (
                <tr key={`tr-${blocks.length}-${rIdx}`}>
                  {header.map((_, cIdx) => <td key={`td-${blocks.length}-${rIdx}-${cIdx}`}>{row[cIdx] ?? ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flushList();
      blocks.push(
        <p key={`h-${blocks.length}`} className="ai-md-heading">{renderInline(headingMatch[2], `h-${blocks.length}`)}</p>
      );
      i += 1;
      continue;
    }

    const bulletMatch = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      listBuffer.push(bulletMatch[1]);
      i += 1;
      continue;
    }

    if (line.trim() === '') {
      flushList();
      i += 1;
      continue;
    }

    flushList();
    blocks.push(
      <p key={`p-${blocks.length}`} className="ai-md-paragraph">{renderInline(line, `p-${blocks.length}`)}</p>
    );
    i += 1;
  }

  flushList();
  return blocks;
};

function AiAssistant({ token }) {
  const now = new Date();
  const [question, setQuestion] = useState('');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const yearOptions = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y -= 1) yearOptions.push(y);

  const ask = async (text) => {
    const finalQuestion = String(text ?? question).trim();
    if (!finalQuestion) {
      setError('Escribe una pregunta para el asistente.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const payload = await apiRequest('/api/ai/assistant', {
        method: 'POST',
        token,
        body: { question: finalQuestion, month, year },
        timeoutMs: 45000,
        retries: 0
      });
      setResult(payload);
    } catch (err) {
      setError(err?.message || 'No se pudo ejecutar el asistente IA.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    ask();
  };

  const handleTextareaKeyDown = (e) => {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!loading) ask();
    }
  };

  const dataRows = Array.isArray(result?.data?.rows) ? result.data.rows : [];
  const dataColumns = dataRows.length > 0 ? Object.keys(dataRows[0]) : [];

  return (
    <div className="admin-ai-card">
      <div className="admin-ai-result-head">
        <h3 style={{ margin: 0 }}>Asistente IA (beta privada)</h3>
        <span>Solo visible para tu cuenta. Pregunta en español sobre el negocio.</span>
      </div>

      <div className="admin-ai-toolbar">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="admin-ai-pill"
            disabled={loading}
            onClick={() => { setQuestion(suggestion); ask(suggestion); }}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <form className="admin-ai-form" onSubmit={handleSubmit}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleTextareaKeyDown}
          placeholder="Ej.: ¿Cómo van las ventas este mes y qué productos lideran?"
          disabled={loading}
        />
        <p style={{ margin: 0, fontSize: '0.74rem', color: '#78716c' }}>
          Enter para enviar · Shift+Enter para nueva línea
        </p>
        <div className="admin-ai-controls">
          <label htmlFor="ai-month" style={{ fontSize: '0.82rem', color: '#57534e' }}>Periodo</label>
          <select id="ai-month" value={month} onChange={(e) => setMonth(Number(e.target.value))} disabled={loading}>
            {MONTHS.map((label, idx) => <option key={label} value={idx + 1}>{label}</option>)}
          </select>
          <select id="ai-year" value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={loading}>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button type="submit" className="btn" disabled={loading}>
            {loading ? 'Analizando…' : 'Preguntar'}
          </button>
        </div>
      </form>

      {error && <div className="admin-ai-error">{error}</div>}

      {result && (
        <div style={{ display: 'grid', gap: '12px' }}>
          <div className="admin-ai-result-head">
            <strong>{result.intent_label || 'Análisis'}</strong>
            <span>
              {result.period?.label || 'Periodo actual'}
              {result.provider === 'fallback' ? ' · resumen base (sin IA generativa)' : ' · IA'}
            </span>
          </div>

          {result.provider === 'fallback' && (
            <div className="admin-ai-error" style={{ color: '#92400e', background: 'rgba(251, 191, 36, 0.14)', borderColor: 'rgba(251, 191, 36, 0.5)' }}>
              Modo sin IA generativa: se muestran resúmenes de datos predefinidos. Para responder
              preguntas libres, configura <strong>GROK_API_KEY</strong> en el backend.
            </div>
          )}

          <div className="ai-md-body">{renderMarkdown(result.summary)}</div>

          {dataColumns.length > 0 && (
            <div>
              <div className="admin-ai-result-head" style={{ marginBottom: '6px' }}>
                <strong>{result.data?.title || 'Datos'}</strong>
                <span>{dataRows.length} fila(s)</span>
              </div>
              <div className="admin-ai-table-wrap">
                <table className="admin-ai-table">
                  <thead>
                    <tr>{dataColumns.map((col) => <th key={col}>{col}</th>)}</tr>
                  </thead>
                  <tbody>
                    {dataRows.slice(0, 50).map((row, rIdx) => (
                      <tr key={`data-${rIdx}`}>
                        {dataColumns.map((col) => <td key={`data-${rIdx}-${col}`}>{formatCell(row[col])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {Array.isArray(result.excluded_sensitive_fields) && result.excluded_sensitive_fields.length > 0 && (
            <p style={{ fontSize: '0.74rem', color: '#78716c', margin: 0 }}>
              Privacidad: se excluyen datos sensibles de clientes ({result.excluded_sensitive_fields.join(', ')}).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default AiAssistant;
