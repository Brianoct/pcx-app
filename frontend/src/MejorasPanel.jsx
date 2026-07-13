import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';
import QualityControlRecordsAdmin from './admin/QualityControlRecordsAdmin';

// Mejoras: the monthly standards program. Each work area keeps a standard in
// its daily routine to earn the end-of-month bonus. Phase 1: the initial
// criterion for Microfábrica / Almacén / Admin is low production defects,
// measured from the quality-control records (which moved here from Admin).
const AREAS = [
  {
    key: 'produccion',
    name: 'Producción',
    criterio: 'Pocos defectos de producción',
    detalle: 'Piezas rechazadas en control de calidad sobre el total inspeccionado.'
  },
  {
    key: 'almacen',
    name: 'Almacén',
    criterio: 'Pocos defectos de producción',
    detalle: 'Piezas dañadas en tránsito y diferencias al recibir lotes.'
  },
  {
    key: 'admin',
    name: 'Admin',
    criterio: 'Pocos defectos de producción',
    detalle: 'Acompaña el estándar global de calidad de las líneas Acero y Armonía.'
  },
  {
    key: 'ventas',
    name: 'Ventas',
    criterio: 'Por definir',
    detalle: 'El estándar de esta área se definirá en una siguiente fase.'
  },
  {
    key: 'marketing',
    name: 'Marketing',
    criterio: 'Por definir',
    detalle: 'El estándar de esta área se definirá en una siguiente fase.'
  }
];

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export default function MejorasPanel({ token }) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const [records, setRecords] = useState(null); // null = no access / not loaded

  useEffect(() => {
    let active = true;
    apiRequest(`/api/qc/checks?month=${month}&year=${year}`, { token })
      .then((data) => { if (active) setRecords(Array.isArray(data) ? data : []); })
      .catch(() => { if (active) setRecords(null); });
    return () => { active = false; };
  }, [token, month, year]);

  // Month defect snapshot from the QC records (passed vs rejected pieces).
  const quality = useMemo(() => {
    if (!Array.isArray(records)) return null;
    let passed = 0;
    let rejected = 0;
    for (const r of records) {
      const qty = Number(r.quantity || 0);
      if (r.result === 'passed') passed += qty;
      else if (r.result === 'rejected') rejected += qty;
    }
    const total = passed + rejected;
    return {
      passed,
      rejected,
      total,
      defectPct: total > 0 ? (rejected / total) * 100 : null
    };
  }, [records]);

  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;

  return (
    <div className="container prod-page">
      <div className="card plan-intro">
        <h2 className="plan-title">Mejoras — Bono mensual por estándares</h2>
        <p className="plan-sub">
          Cada área mantiene un estándar en su rutina diaria para ganar el bono a fin de mes.
          El trabajo del día a día hace crecer las líneas <strong>Acero</strong> y <strong>Armonía</strong>;
          esta sección se irá ampliando por fases para abrir nuevas etapas del negocio.
        </p>
      </div>

      {quality && quality.total > 0 && (
        <div className="mejoras-quality">
          <div className="mejoras-quality-stat">
            <span className="mejoras-quality-value">{quality.defectPct.toFixed(1)}%</span>
            <span className="mejoras-quality-label">defectos de producción · {monthLabel}</span>
          </div>
          <div className="mejoras-quality-detail">
            {quality.rejected} rechazadas de {quality.total} piezas inspeccionadas en control de calidad.
          </div>
        </div>
      )}

      <div className="mejoras-areas">
        {AREAS.map((area) => {
          const defined = area.criterio !== 'Por definir';
          return (
            <div key={area.key} className={`mejoras-area ${defined ? '' : 'is-pending'}`}>
              <div className="mejoras-area-name">{area.name}</div>
              <div className={`mejoras-area-criterio ${defined ? '' : 'is-pending'}`}>{area.criterio}</div>
              <div className="mejoras-area-detalle">{area.detalle}</div>
              <div className="mejoras-area-status">
                {defined ? 'Estándar inicial · umbral del bono por definir' : 'Se definirá en una próxima fase'}
              </div>
            </div>
          );
        })}
      </div>

      {Array.isArray(records) && (
        <div className="mejoras-records">
          <QualityControlRecordsAdmin token={token} />
        </div>
      )}
    </div>
  );
}
