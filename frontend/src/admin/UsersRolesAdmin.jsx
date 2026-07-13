import { useState } from 'react';
import UserManagement from './UserManagement';
import RoleConfiguration from './RoleConfiguration';

// Usuarios and Roles merged into one place: managing the team and deciding
// what each role can see are the same job. Two focused sub-views instead of
// two top-level tabs.
function UsersRolesAdmin({ token }) {
  const [view, setView] = useState('equipo');

  return (
    <div>
      <div className="admin-subtabs" role="tablist" aria-label="Usuarios y permisos">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'equipo'}
          className={`admin-subtab ${view === 'equipo' ? 'is-active' : ''}`}
          onClick={() => setView('equipo')}
        >
          Equipo
          <small>Altas, edición y estado</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'permisos'}
          className={`admin-subtab ${view === 'permisos' ? 'is-active' : ''}`}
          onClick={() => setView('permisos')}
        >
          Permisos por rol
          <small>Qué paneles ve cada rol</small>
        </button>
      </div>

      {view === 'equipo' ? (
        <>
          <p className="admin-subtab-hint">
            ¿Quieres cambiar qué paneles ve todo un rol (Ventas, Almacén, Microfábrica…)?
            Hazlo una sola vez en <button type="button" className="admin-subtab-link" onClick={() => setView('permisos')}>Permisos por rol</button> en
            lugar de usuario por usuario.
          </p>
          <UserManagement token={token} />
        </>
      ) : (
        <>
          <p className="admin-subtab-hint">
            Esto define la plantilla de cada rol. Con “Aplicar a usuarios existentes” el cambio
            impacta de inmediato a todo el equipo de ese rol; los usuarios nuevos siempre nacen
            con esta plantilla. Para un permiso puntual de una sola persona, edítala en <button type="button" className="admin-subtab-link" onClick={() => setView('equipo')}>Equipo</button>.
          </p>
          <RoleConfiguration token={token} />
        </>
      )}
    </div>
  );
}

export default UsersRolesAdmin;
