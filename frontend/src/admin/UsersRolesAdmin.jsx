import { useState } from 'react';
import UserManagement from './UserManagement';
import RoleConfiguration from './RoleConfiguration';
import CommissionConfig from './CommissionConfig';
import QualityControlCommissionConfig from './QualityControlCommissionConfig';
import QualityControlRecordsAdmin from './QualityControlRecordsAdmin';
import PayrollPanel from './PayrollPanel';

// Everything about people lives in one hub: the team itself, what each role
// can see, how commissions are earned, and how each person gets paid at the
// end of the month. Four focused sub-views instead of four top-level tabs.
const VIEWS = [
  { key: 'equipo', label: 'Equipo', hint: 'Altas, edición y estado' },
  { key: 'permisos', label: 'Permisos por rol', hint: 'Qué paneles ve cada rol' },
  { key: 'comisiones', label: 'Comisiones', hint: 'Reglas y control de calidad' },
  { key: 'pagos', label: 'Pagos', hint: 'QR para el cierre de mes' }
];

function UsersRolesAdmin({ token, initialView }) {
  const [view, setView] = useState(
    VIEWS.some((v) => v.key === initialView) ? initialView : 'equipo'
  );

  const link = (target, label) => (
    <button type="button" className="admin-subtab-link" onClick={() => setView(target)}>{label}</button>
  );

  return (
    <div>
      <div className="admin-subtabs" role="tablist" aria-label="Usuarios, permisos, comisiones y pagos">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            className={`admin-subtab ${view === v.key ? 'is-active' : ''}`}
            onClick={() => setView(v.key)}
          >
            {v.label}
            <small>{v.hint}</small>
          </button>
        ))}
      </div>

      {view === 'equipo' && (
        <>
          <p className="admin-subtab-hint">
            ¿Quieres cambiar qué paneles ve todo un rol (Ventas, Almacén, Microfábrica…)?
            Hazlo una sola vez en {link('permisos', 'Permisos por rol')} en lugar de usuario
            por usuario. Cuánto gana cada rol se define en {link('comisiones', 'Comisiones')} y
            sus datos para pagarle están en {link('pagos', 'Pagos')}.
          </p>
          <UserManagement token={token} />
        </>
      )}

      {view === 'permisos' && (
        <>
          <p className="admin-subtab-hint">
            Esto define la plantilla de cada rol. Con “Aplicar a usuarios existentes” el cambio
            impacta de inmediato a todo el equipo de ese rol; los usuarios nuevos siempre nacen
            con esta plantilla. Para un permiso puntual de una sola persona, edítala en {link('equipo', 'Equipo')}.
          </p>
          <RoleConfiguration token={token} />
        </>
      )}

      {view === 'comisiones' && (
        <>
          <p className="admin-subtab-hint">
            Reglas de comisión por rol y tarifas por pieza aprobada en control de calidad.
            Cada persona ve su acumulado del mes en la cajita del nav. Al cierre de mes,
            paga usando los datos de {link('pagos', 'Pagos')}.
          </p>
          <div style={{ display: 'grid', gap: '14px' }}>
            <CommissionConfig token={token} />
            <QualityControlCommissionConfig token={token} />
            <QualityControlRecordsAdmin token={token} />
          </div>
        </>
      )}

      {view === 'pagos' && (
        <>
          <p className="admin-subtab-hint">
            QR y datos de pago de cada persona, listos para el <strong>cierre de mes</strong>.
            Las reglas que definen cuánto le toca a cada rol están en {link('comisiones', 'Comisiones')}.
          </p>
          <PayrollPanel token={token} />
        </>
      )}
    </div>
  );
}

export default UsersRolesAdmin;
