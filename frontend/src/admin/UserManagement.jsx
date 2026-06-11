import { useState, useEffect } from 'react';
import { ACCESS_LABELS, buildAccessForUser, ROLE_OPTIONS } from '../roleAccess';
import { apiRequest } from '../apiClient';
import { useOutbox } from '../OutboxProvider';
import { useToast } from '../ui/toastContext';

const ROLE_SELECT_OPTIONS = ROLE_OPTIONS.map((role) => ({
  value: role,
  label: role === 'Almacen Lider'
    ? 'Almacén Líder'
    : role === 'Almacen'
      ? 'Almacén'
      : role
}));

// User management component
function UserManagement({ token }) {
  const toast = useToast();
  const { enqueueWrite } = useOutbox();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    display_name: '',
    role: 'Ventas',
    city: 'Santa Cruz',
    phone: '',
    panel_access: buildAccessForUser('Ventas')
  });
  const [editModal, setEditModal] = useState(null); // { userId, email, role, city, phone, panel_access }

  const refreshUsers = async () => {
    const data = await apiRequest('/api/users', { token });
    setUsers(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        await refreshUsers();
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, [token]);

  const handleAddUser = async (e) => {
    e.preventDefault();

    if (newUser.phone && !/^\d{8}$/.test(newUser.phone)) {
      toast.error('El teléfono debe tener exactamente 8 dígitos numéricos.');
      return;
    }

    try {
      const payload = { ...newUser };
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Crear usuario ${payload.email || ''}`.trim(),
          path: '/api/users',
          options: {
            method: 'POST',
            body: payload,
            retries: 0
          },
          meta: { email: payload.email || '', role: payload.role || '' }
        });
        toast.info('Sin conexión: creación de usuario en cola para sincronizar.');
      } else {
        await apiRequest('/api/users', {
          method: 'POST',
          token,
          body: payload
        });
      }
      toast.success('Usuario agregado con éxito');
      await refreshUsers();
      setNewUser({
        email: '',
        password: '',
        display_name: '',
        role: 'Ventas',
        city: 'Santa Cruz',
        phone: '',
        panel_access: buildAccessForUser('Ventas')
      });
    } catch (err) {
      toast.error('Error: ' + err.message);
    }
  };

  const handleUpdateRole = async (userId, newRole) => {
    try {
      const payload = {
        role: newRole,
        panel_access: buildAccessForUser(newRole)
      };
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Actualizar rol usuario #${userId} -> ${newRole}`,
          path: `/api/users/${userId}`,
          options: {
            method: 'PATCH',
            body: payload,
            retries: 0
          },
          meta: { userId, role: newRole }
        });
        setUsers((prev) => prev.map((u) => (
          u.id === userId ? { ...u, role: newRole, panel_access: payload.panel_access } : u
        )));
        toast.info('Sin conexión: cambio de rol en cola para sincronizar.');
        return;
      }
      await apiRequest(`/api/users/${userId}`, {
        method: 'PATCH',
        token,
        body: payload
      });
      toast.success('Rol actualizado');
      await refreshUsers();
    } catch (err) {
      toast.error('Error: ' + err.message);
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('¿Desactivar este usuario? No podrá iniciar sesión ni aparecer en listas activas, pero su historial se conservará.')) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Desactivar usuario #${userId}`,
          path: `/api/users/${userId}`,
          options: {
            method: 'DELETE',
            retries: 0
          },
          meta: { userId }
        });
        setUsers((prev) => prev.map((u) => (
          u.id === userId ? { ...u, is_active: false } : u
        )));
        toast.info('Sin conexión: desactivación de usuario en cola para sincronizar.');
        return;
      }
      await apiRequest(`/api/users/${userId}`, {
        method: 'DELETE',
        token
      });
      toast.success('Usuario desactivado');
      await refreshUsers();
    } catch (err) {
      toast.error('Error: ' + err.message);
    }
  };

  const handleSetUserActivation = async (userId, isActive) => {
    const actionLabel = isActive ? 'reactivar' : 'desactivar';
    if (!window.confirm(`¿Seguro que deseas ${actionLabel} este usuario?`)) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `${isActive ? 'Reactivar' : 'Desactivar'} usuario #${userId}`,
          path: `/api/users/${userId}/activation`,
          options: {
            method: 'PATCH',
            body: { is_active: isActive },
            retries: 0
          },
          meta: { userId, is_active: isActive }
        });
        setUsers((prev) => prev.map((u) => (
          u.id === userId ? { ...u, is_active: isActive } : u
        )));
        toast.info(`Sin conexión: ${isActive ? 'reactivación' : 'desactivación'} en cola para sincronizar.`);
        return;
      }
      await apiRequest(`/api/users/${userId}/activation`, {
        method: 'PATCH',
        token,
        body: { is_active: isActive }
      });
      toast.success(`Usuario ${isActive ? 'reactivado' : 'desactivado'}`);
      await refreshUsers();
    } catch (err) {
      toast.error('Error: ' + err.message);
    }
  };

  const openEditModal = (user) => {
    setEditModal({
      userId: user.id,
      email: user.email,
      display_name: user.display_name || '',
      originalRole: user.role,
      role: user.role,
      city: user.city || '',
      phone: user.phone || '',
      panel_access: buildAccessForUser(user.role, user.panel_access),
      showPanelOverride: false
    });
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();

    if (editModal.phone && !/^\d{8}$/.test(editModal.phone)) {
      toast.error('El teléfono debe tener exactamente 8 dígitos numéricos.');
      return;
    }

    try {
      const roleChanged = String(editModal.role || '') !== String(editModal.originalRole || '');
      const shouldSendPanelAccess = Boolean(editModal.showPanelOverride) || roleChanged;
      const payload = {
        role: editModal.role,
        city: editModal.city,
        phone: editModal.phone,
        display_name: String(editModal.display_name || '').trim() || null
      };
      if (shouldSendPanelAccess) {
        payload.panel_access = editModal.panel_access;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Editar usuario #${editModal.userId}`,
          path: `/api/users/${editModal.userId}`,
          options: {
            method: 'PATCH',
            body: payload,
            retries: 0
          },
          meta: { userId: editModal.userId, role: payload.role || '' }
        });
        setUsers((prev) => prev.map((u) => (
          u.id === editModal.userId
            ? {
                ...u,
                role: payload.role,
                city: payload.city,
                phone: payload.phone,
                display_name: payload.display_name,
                panel_access: payload.panel_access || u.panel_access
              }
            : u
        )));
        setEditModal(null);
        toast.info('Sin conexión: edición de usuario en cola para sincronizar.');
        return;
      }
      await apiRequest(`/api/users/${editModal.userId}`, {
        method: 'PATCH',
        token,
        body: payload
      });
      toast.success('Usuario actualizado con éxito');
      await refreshUsers();
      setEditModal(null);
    } catch (err) {
      toast.error('Error: ' + err.message);
    }
  };

  // Filter input to only allow digits and max 8
  const handlePhoneChange = (e) => {
    const value = e.target.value.replace(/\D/g, '');
    if (value.length <= 8) {
      setNewUser({ ...newUser, phone: value });
    }
  };

  const handleEditPhoneChange = (e) => {
    const value = e.target.value.replace(/\D/g, '');
    if (value.length <= 8) {
      setEditModal({ ...editModal, phone: value });
    }
  };

  const handleNewRoleChange = (role) => {
    setNewUser({
      ...newUser,
      role,
      panel_access: buildAccessForUser(role)
    });
  };

  const handleNewAccessToggle = (field) => {
    setNewUser((prev) => ({
      ...prev,
      panel_access: {
        ...(prev.panel_access || buildAccessForUser(prev.role)),
        [field]: !(prev.panel_access || buildAccessForUser(prev.role))[field]
      }
    }));
  };

  const handleEditRoleChange = (role) => {
    setEditModal((prev) => ({
      ...prev,
      role,
      panel_access: buildAccessForUser(role)
    }));
  };

  const handleEditAccessToggle = (field) => {
    setEditModal((prev) => ({
      ...prev,
      panel_access: {
        ...(prev.panel_access || buildAccessForUser(prev.role)),
        [field]: !(prev.panel_access || buildAccessForUser(prev.role))[field]
      }
    }));
  };

  const toggleEditPanelOverride = () => {
    setEditModal((prev) => (
      prev
        ? { ...prev, showPanelOverride: !prev.showPanelOverride }
        : prev
    ));
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '50px' }}>Cargando usuarios...</div>;
  if (error) return <div style={{ color: '#f87171', textAlign: 'center', padding: '50px' }}>Error: {error}</div>;

  return (
    <div>
      {/* Add new user form */}
      <div style={{ background: '#1e293b', padding: '24px', borderRadius: '14px', marginBottom: '28px', border: '1px solid rgba(71, 85, 105, 0.5)' }}>
        <h3 style={{ marginBottom: '16px' }}>Agregar Nuevo Usuario</h3>
        <form onSubmit={handleAddUser}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#94a3b8' }}>Email</label>
              <input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                required
                style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#0f172a', color: 'white', border: '1px solid #334155' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#94a3b8' }}>Contraseña</label>
              <input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                required
                style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#0f172a', color: 'white', border: '1px solid #334155' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#94a3b8' }}>Nombre visible</label>
              <input
                type="text"
                value={newUser.display_name || ''}
                onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })}
                placeholder="Ej: Wendy"
                style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#0f172a', color: 'white', border: '1px solid #334155' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#94a3b8' }}>Teléfono (8 dígitos)</label>
              <input
                type="tel"
                value={newUser.phone}
                onChange={handlePhoneChange}
                placeholder="Ej: 77778888"
                maxLength={8}
                pattern="\d{8}"
                title="Solo números, exactamente 8 dígitos"
                style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#0f172a', color: 'white', border: '1px solid #334155' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#94a3b8' }}>Rol</label>
              <select
                value={newUser.role}
                onChange={(e) => handleNewRoleChange(e.target.value)}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#0f172a', color: 'white', border: '1px solid #334155' }}
              >
                {ROLE_SELECT_OPTIONS.map((roleOption) => (
                  <option key={roleOption.value} value={roleOption.value}>
                    {roleOption.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#94a3b8' }}>Ciudad</label>
              <input
                type="text"
                value={newUser.city}
                onChange={(e) => setNewUser({ ...newUser, city: e.target.value })}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#0f172a', color: 'white', border: '1px solid #334155' }}
              />
            </div>
          </div>

          <div style={{ marginTop: '18px' }}>
            <h4 style={{ marginBottom: '10px', color: '#f1f5f9' }}>Acceso por panel</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
              {ACCESS_LABELS.map((field) => (
                <label
                  key={field.key}
                  style={{
                    display: 'flex',
                    gap: '9px',
                    alignItems: 'center',
                    color: '#e2e8f0',
                    border: '1px solid #334155',
                    borderRadius: '10px',
                    padding: '10px 12px',
                    background: '#111b2d'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(newUser.panel_access?.[field.key])}
                    onChange={() => handleNewAccessToggle(field.key)}
                  />
                  {field.label}
                </label>
              ))}
            </div>
          </div>

          <button type="submit" style={{ width: '100%', padding: '14px', background: '#f87171', color: 'white', border: 'none', borderRadius: '10px', marginTop: '22px', fontWeight: '700' }}>
            Agregar Usuario
          </button>
        </form>
      </div>

      {/* Users list */}
      <h3 style={{ marginBottom: '20px' }}>Lista de Usuarios</h3>
      {users.length === 0 ? (
        <p>No hay usuarios.</p>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid rgba(71, 85, 105, 0.45)', borderRadius: '12px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1000px' }}>
            <thead>
              <tr style={{ background: '#0f172a' }}>
                <th style={{ padding: '12px' }}>Nombre visible</th>
                <th style={{ padding: '12px' }}>Email</th>
                <th style={{ padding: '12px' }}>Teléfono</th>
                <th style={{ padding: '12px' }}>Rol</th>
                <th style={{ padding: '12px' }}>Estado</th>
                <th style={{ padding: '12px' }}>Ciudad</th>
                <th style={{ padding: '12px' }}>Creado</th>
                <th style={{ padding: '12px' }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '12px' }}>{user.display_name || String(user.email || '').split('@')[0] || '—'}</td>
                  <td style={{ padding: '12px' }}>{user.email}</td>
                  <td style={{ padding: '12px' }}>
                    {user.phone ? `+591 ${user.phone}` : '—'}
                  </td>
                  <td style={{ padding: '12px' }}>
                    <select
                      value={user.role}
                      onChange={(e) => handleUpdateRole(user.id, e.target.value)}
                      disabled={!user.is_active}
                      style={{ padding: '6px', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
                    >
                      {ROLE_SELECT_OPTIONS.map((roleOption) => (
                        <option key={roleOption.value} value={roleOption.value}>
                          {roleOption.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '12px' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '4px 10px',
                      borderRadius: '999px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      background: user.is_active ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.18)',
                      color: user.is_active ? '#34d399' : '#f87171',
                      border: user.is_active ? '1px solid rgba(52,211,153,0.45)' : '1px solid rgba(248,113,113,0.45)'
                    }}>
                      {user.is_active ? 'Activo' : 'Desactivado'}
                    </span>
                  </td>
                  <td style={{ padding: '12px' }}>{user.city || '—'}</td>
                  <td style={{ padding: '12px' }}>{new Date(user.created_at).toLocaleString('es-BO')}</td>
                  <td style={{ padding: '12px' }}>
                    <button
                      onClick={() => openEditModal(user)}
                      disabled={!user.is_active}
                      style={{ padding: '8px 12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', marginRight: '8px' }}
                    >
                      Editar
                    </button>
                    {user.is_active ? (
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        style={{ padding: '8px 12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                      >
                        Desactivar
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSetUserActivation(user.id, true)}
                        style={{ padding: '8px 12px', background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                      >
                        Reactivar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit User Modal */}
      {editModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          zIndex: 1000,
          overflowY: 'auto',
          padding: '22px 10px'
        }}>
          <div style={{
            background: '#1e293b',
            borderRadius: '12px',
            width: '90%',
            maxWidth: '820px',
            color: '#f1f5f9',
            border: '1px solid rgba(71, 85, 105, 0.6)',
            maxHeight: 'calc(100vh - 44px)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            <div style={{ padding: '18px 20px 12px', borderBottom: '1px solid rgba(71, 85, 105, 0.45)' }}>
              <h3 style={{ margin: 0, color: '#e11d48' }}>Editar Usuario</h3>
            </div>

            <form onSubmit={handleEditSubmit} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'grid', gap: '14px', padding: '16px 20px', overflowY: 'auto', minHeight: 0 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: '#94a3b8' }}>Email (no editable)</label>
                  <input
                    type="email"
                    value={editModal.email}
                    disabled
                    style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#111827', color: '#6b7280', border: '1px solid #374151' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: '#94a3b8' }}>Nombre visible</label>
                  <input
                    type="text"
                    value={editModal.display_name || ''}
                    onChange={(e) => setEditModal({ ...editModal, display_name: e.target.value })}
                    placeholder="Ej: Wendy"
                    style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#0f172a', color: 'white', border: '1px solid #334155' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: '#94a3b8' }}>Teléfono (8 dígitos)</label>
                  <input
                    type="tel"
                    value={editModal.phone}
                    onChange={handleEditPhoneChange}
                    placeholder="Ej: 77778888"
                    maxLength={8}
                    pattern="\d{8}"
                    title="Solo números, exactamente 8 dígitos"
                    style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#0f172a', color: 'white', border: '1px solid #334155' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: '#94a3b8' }}>Rol</label>
                  <select
                    value={editModal.role}
                    onChange={(e) => handleEditRoleChange(e.target.value)}
                    style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#0f172a', color: 'white', border: '1px solid #334155' }}
                  >
                    {ROLE_SELECT_OPTIONS.map((roleOption) => (
                      <option key={roleOption.value} value={roleOption.value}>
                        {roleOption.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: '#94a3b8' }}>Ciudad</label>
                  <input
                    type="text"
                    value={editModal.city}
                    onChange={(e) => setEditModal({ ...editModal, city: e.target.value })}
                    style={{ width: '100%', padding: '12px', borderRadius: '8px', background: '#0f172a', color: 'white', border: '1px solid #334155' }}
                  />
                </div>
                <div>
                  <div style={{ border: '1px solid #334155', borderRadius: '10px', padding: '12px', background: '#111b2d' }}>
                    <div style={{ color: '#94a3b8', marginBottom: '8px', fontSize: '0.92rem' }}>
                      El acceso principal se administra en <strong>Configuración de Roles</strong>.
                      Personaliza aquí solo si este usuario necesita una excepción.
                    </div>
                    <button
                      type="button"
                      onClick={toggleEditPanelOverride}
                      style={{
                        padding: '8px 12px',
                        background: editModal.showPanelOverride ? '#f59e0b' : '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontWeight: 700,
                        marginBottom: editModal.showPanelOverride ? '10px' : 0
                      }}
                    >
                      {editModal.showPanelOverride ? 'Ocultar personalización' : 'Personalizar acceso por panel'}
                    </button>
                    {editModal.showPanelOverride && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
                        {ACCESS_LABELS.map((field) => (
                          <label
                            key={field.key}
                            style={{
                              display: 'flex',
                              gap: '9px',
                              alignItems: 'center',
                              color: '#e2e8f0',
                              border: '1px solid #334155',
                              borderRadius: '10px',
                              padding: '10px 12px',
                              background: '#0f172a'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(editModal.panel_access?.[field.key])}
                              onChange={() => handleEditAccessToggle(field.key)}
                            />
                            {field.label}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div style={{
                display: 'flex',
                gap: '10px',
                padding: '12px 20px 16px',
                justifyContent: 'flex-end',
                borderTop: '1px solid rgba(71, 85, 105, 0.45)',
                background: '#1e293b'
              }}>
                <button
                  type="button"
                  onClick={() => setEditModal(null)}
                  style={{
                    padding: '10px 18px',
                    background: '#64748b',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '0.95rem'
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '10px 18px',
                    background: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '0.95rem',
                    fontWeight: 700
                  }}
                >
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default UserManagement;
