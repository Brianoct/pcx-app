import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../apiClient';
import CustomerHub from './CustomerHub';

// Embudo de ventas (estilo Pipedrive): cada cliente con venta abierta es un
// trato (tarjeta) en la columna de su etapa. Arrastra para cambiar de etapa;
// toca una tarjeta para abrir su ficha completa (CustomerHub).

const OPEN_STAGES = ['contactado', 'cotizado', 'negociando'];
const STAGE_META = {
  contactado: { label: 'Contactado' },
  cotizado: { label: 'Cotizado' },
  negociando: { label: 'Negociando' },
  cliente: { label: '✅ Ganado (mes)' },
  perdido: { label: '❌ Perdido (mes)' }
};
const BOARD_STAGES = ['contactado', 'cotizado', 'negociando', 'cliente', 'perdido'];
const LOST_REASONS = ['Precio', 'Sin respuesta', 'Compró a la competencia', 'Ya no necesita', 'Otro'];
const ROT_WARN_DAYS = 7;
const ROT_BAD_DAYS = 14;
const MAX_CARDS_PER_COLUMN = 40;

const money = (value) => `${Math.round(Number(value || 0)).toLocaleString('es-BO')} Bs`;
const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const OWNER_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#6366f1'];
const ownerColor = (name = '') => {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return OWNER_COLORS[hash % OWNER_COLORS.length];
};

const boliviaToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());

const followUpChip = (card, today) => {
  if (!card.follow_up_at) return { className: 'is-none', text: '⚠ Sin siguiente paso' };
  const note = card.follow_up_note ? ` · ${card.follow_up_note}` : '';
  if (card.follow_up_at < today) {
    const days = Math.round((new Date(today) - new Date(card.follow_up_at)) / 86400000);
    return { className: 'is-overdue', text: `Vencida · hace ${days} día${days === 1 ? '' : 's'}${note}` };
  }
  if (card.follow_up_at === today) return { className: 'is-today', text: `Hoy${note}` };
  const short = new Date(`${card.follow_up_at}T12:00:00`).toLocaleDateString('es-BO', { weekday: 'short', day: 'numeric' });
  return { className: 'is-next', text: `${short}${note}` };
};

export default function PipelineBoard({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dragId, setDragId] = useState(null);
  const [dropStage, setDropStage] = useState(null);
  const [detailCustomerId, setDetailCustomerId] = useState(null);
  const today = boliviaToday();

  const load = useCallback(() => {
    apiRequest('/api/customers/pipeline', { token })
      .then((res) => { setData(res); setError(''); })
      .catch((err) => setError(err.message || 'No se pudo cargar el embudo'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const cardsByStage = useMemo(() => {
    const map = new Map(BOARD_STAGES.map((s) => [s, []]));
    for (const card of data?.cards || []) {
      if (map.has(card.pipeline_stage)) map.get(card.pipeline_stage).push(card);
    }
    return map;
  }, [data]);

  const moveCard = async (card, stage) => {
    if (!card || card.pipeline_stage === stage) return;
    const body = { pipeline_stage: stage };
    if (stage === 'perdido') {
      const pick = window.prompt(
        `¿Por qué se perdió "${card.name}"?\n(${LOST_REASONS.join(' · ')})`,
        card.lost_reason || ''
      );
      if (pick === null) return;
      body.lost_reason = pick.trim() || 'Sin motivo';
    }
    // Optimistic move so the board feels instant during the meeting.
    setData((prev) => prev && ({
      ...prev,
      cards: prev.cards.map((c) => (c.id === card.id ? { ...c, pipeline_stage: stage, lost_reason: body.lost_reason || null, days_in_stage: 0 } : c))
    }));
    try {
      await apiRequest(`/api/customers/${card.id}`, { method: 'PATCH', token, body });
      load();
    } catch (err) {
      setError(err.message || 'No se pudo mover el trato');
      load();
    }
  };

  if (loading && !data) return <p className="dashboard-muted">Cargando embudo…</p>;

  const summary = data?.summary;

  return (
    <div className="pipe-board-wrap">
      {error && <div className="camp-error">{error}</div>}

      {summary && (
        <div className="pipe-forecast">
          <div className="pipe-fbox">
            <b>{summary.open_count} tratos · {money(summary.open_value)}</b>
            <span>Embudo abierto</span>
          </div>
          <div className="pipe-fbox">
            <b>{money(summary.weighted_forecast)}</b>
            <span>Pronóstico ponderado</span>
          </div>
          <div className={`pipe-fbox ${summary.sin_siguiente_paso + summary.vencidas > 0 ? 'is-risk' : ''}`}>
            <b>{summary.sin_siguiente_paso} sin paso · {summary.vencidas} vencidas</b>
            <span>Riesgo</span>
          </div>
          <div className="pipe-fbox">
            <b>{summary.win_rate === null ? '—' : `${Math.round(summary.win_rate * 100)}%`}</b>
            <span>Tasa de cierre · mes</span>
          </div>
        </div>
      )}

      <div className="pipe-board">
        {BOARD_STAGES.map((stage) => {
          const cards = cardsByStage.get(stage) || [];
          const isOpen = OPEN_STAGES.includes(stage);
          const bucket = summary?.stages?.[stage];
          const closedValue = stage === 'cliente' ? summary?.won_month : stage === 'perdido' ? summary?.lost_month : null;
          const headline = isOpen
            ? `${bucket?.count ?? 0} · ${money(bucket?.value)} · ${Math.round((bucket?.probability || 0) * 100)}%`
            : `${closedValue?.count ?? 0} · ${money(closedValue?.value)}`;
          return (
            <div
              key={stage}
              className={`pipe-col is-${stage} ${dropStage === stage ? 'is-drop' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDropStage(stage); }}
              onDragLeave={() => setDropStage((s) => (s === stage ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setDropStage(null);
                const card = (data?.cards || []).find((c) => c.id === dragId);
                moveCard(card, stage);
                setDragId(null);
              }}
            >
              <div className="pipe-colhead">
                <b>{STAGE_META[stage].label}</b>
                <span>{headline}</span>
              </div>
              {cards.slice(0, MAX_CARDS_PER_COLUMN).map((card) => {
                const chip = isOpen ? followUpChip(card, today) : null;
                const rot = isOpen && card.days_since_activity !== null
                  ? (card.days_since_activity >= ROT_BAD_DAYS ? 'rot-bad' : card.days_since_activity >= ROT_WARN_DAYS ? 'rot-warn' : '')
                  : '';
                const value = stage === 'cliente' ? (card.paid_month_value || card.open_value) : card.open_value;
                return (
                  <div
                    key={card.id}
                    className={`pipe-card ${rot} ${dragId === card.id ? 'is-dragging' : ''}`}
                    draggable
                    onDragStart={() => setDragId(card.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => setDetailCustomerId(card.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="pipe-card-top">
                      <span className="pipe-card-name">{card.name}</span>
                      {value > 0 && <span className="pipe-card-value">{money(value)}</span>}
                    </div>
                    <div className="pipe-card-meta">
                      {chip && <span className={`pipe-chip ${chip.className}`}>{chip.text}</span>}
                      {stage === 'perdido' && card.lost_reason && (
                        <span className="pipe-lost-reason">Motivo: {card.lost_reason}</span>
                      )}
                      {card.owner_name && (
                        <span className="pipe-owner" style={{ background: ownerColor(card.owner_name) }} title={card.owner_name}>
                          {initials(card.owner_name)}
                        </span>
                      )}
                    </div>
                    {rot && (
                      <div className={`pipe-rot ${rot === 'rot-bad' ? 'is-bad' : ''}`}>
                        🕐 {card.days_since_activity} días sin actividad
                      </div>
                    )}
                  </div>
                );
              })}
              {cards.length > MAX_CARDS_PER_COLUMN && (
                <div className="pipe-more">+{cards.length - MAX_CARDS_PER_COLUMN} más…</div>
              )}
              {cards.length === 0 && <div className="pipe-empty">Arrastra tratos aquí</div>}
            </div>
          );
        })}
      </div>

      <p className="pipe-hint">
        Arrastra una tarjeta para cambiarla de etapa · toca una tarjeta para ver su ficha, notas y siguiente paso.
        Al marcar un pedido como <strong>Pagado</strong>, el trato pasa a <strong>Ganado</strong> solo.
      </p>

      <CustomerHub
        token={token}
        open={detailCustomerId !== null}
        onClose={() => { setDetailCustomerId(null); load(); }}
        initialCustomerId={detailCustomerId}
      />
    </div>
  );
}
