// Admin → Paneles: activa el Inicio especializado de cada área y configura
// las metas de ventas que alimentan el Panel de Ventas.
import { useEffect, useState } from 'react';
import { apiRequest } from '../apiClient';
import { useToast } from '../ui/toastContext';

const PANELS = [
  {
    key: 'panel_ventas',
    label: 'Panel de Ventas',
    icon: '💼',
    detail: 'Inicio del área comercial: KPIs, embudo, seguimientos y metas. Activa también la página Clientes (CRM).',
    available: true
  },
  { key: 'panel_marketing', label: 'Panel de Marketing', icon: '📣', detail: 'Próximamente.', available: false },
  { key: 'panel_produccion', label: 'Panel de Producción', icon: '🏭', detail: 'Próximamente.', available: false },
  { key: 'panel_almacen', label: 'Panel de Almacén', icon: '📦', detail: 'Próximamente.', available: false }
];

const GOAL_FIELDS = [
  { key: 'monthly_target_bs', label: 'Meta mensual (Bs)', step: 100 },
  { key: 'monthly_units_min', label: 'Ventas mínimas / mes', step: 1 },
  { key: 'monthly_units_expected', label: 'Meta esperada / mes', step: 1 },
  { key: 'monthly_units_high', label: 'Sobresaliente (bono)', step: 1 },
  { key: 'monthly_new_customers', label: 'Clientes nuevos / mes', step: 1 },
  { key: 'daily_followups', label: 'Seguimientos diarios', step: 1 }
];

export default function PanelsAdmin({ token }) {
  const toast = useToast();
  const [features, setFeatures] = useState(null);
  const [goals, setGoals] = useState(null);
  const [goalDraft, setGoalDraft] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest('/api/features', { token }),
      apiRequest('/api/admin/sales-goals', { token })
    ])
      .then(([featuresRes, goalsRes]) => {
        if (!active) return;
        setFeatures(featuresRes?.features || {});
        setGoals(goalsRes?.goals || null);
        setGoalDraft(goalsRes?.goals || {});
      })
      .catch((err) => { if (active) toast.error(err.message || 'No se pudo cargar la configuración'); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const toggle = async (panel) => {
    if (!panel.available || busy) return;
    setBusy(true);
    try {
      const data = await apiRequest('/api/admin/features', {
        method: 'PATCH',
        token,
        body: { key: panel.key, enabled: !features[panel.key] }
      });
      setFeatures(data?.features || {});
      toast.success(data?.message || 'Actualizado');
      toast.info?.('Recarga la página para ver el cambio en el menú.');
    } catch (err) {
      toast.error(err.message || 'No se pudo actualizar');
    } finally {
      setBusy(false);
    }
  };

  const saveGoals = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const body = {};
      for (const field of GOAL_FIELDS) {
        const value = Number(goalDraft[field.key]);
        if (Number.isFinite(value)) body[field.key] = value;
      }
      const data = await apiRequest('/api/admin/sales-goals', { method: 'PATCH', token, body });
      setGoals(data?.goals || null);
      setGoalDraft(data?.goals || {});
      toast.success('Metas guardadas');
    } catch (err) {
      toast.error(err.message || 'No se pudieron guardar las metas');
    } finally {
      setBusy(false);
    }
  };

  if (!features) return <p className="dashboard-muted">Cargando paneles…</p>;

  return (
    <div className="panels-admin">
      <h3 className="panels-title">Paneles por área</h3>
      <p className="panels-sub">
        Cada área puede tener su propio Inicio con la información que le importa. Actívalos aquí; el Inicio genérico sigue disponible para el resto.
      </p>

      <div className="panels-grid">
        {PANELS.map((panel) => {
          const on = Boolean(features[panel.key]);
          return (
            <div key={panel.key} className={`panels-card ${!panel.available ? 'is-soon' : ''} ${on ? 'is-on' : ''}`}>
              <div className="panels-card-head">
                <span className="panels-card-name">{panel.icon} {panel.label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  className={`panels-switch ${on ? 'is-on' : ''}`}
                  disabled={!panel.available || busy}
                  onClick={() => toggle(panel)}
                >
                  <span className="panels-switch-knob" />
                </button>
              </div>
              <p className="panels-card-detail">{panel.detail}</p>
              {panel.available && (
                <span className={`panels-state ${on ? 'is-on' : ''}`}>{on ? 'Activado' : 'Desactivado'}</span>
              )}
            </div>
          );
        })}
      </div>

      {goals && (
        <div className="panels-goals card">
          <div className="panels-goals-head">
            <div>
              <h4>Metas de ventas</h4>
              <p className="panels-sub">Alimentan el Panel de Ventas: cumplimiento por vendedor y del equipo.</p>
            </div>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={saveGoals}>Guardar metas</button>
          </div>
          <div className="panels-goals-grid">
            {GOAL_FIELDS.map((field) => (
              <label key={field.key} className="panels-goal-field">
                {field.label}
                <input
                  type="number"
                  min="0"
                  step={field.step}
                  value={goalDraft[field.key] ?? ''}
                  onChange={(e) => setGoalDraft({ ...goalDraft, [field.key]: e.target.value })}
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
