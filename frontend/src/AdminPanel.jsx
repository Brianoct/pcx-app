// src/AdminPanel.jsx
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AdminDashboard from './AdminDashboard';
import { ACCESS_LABELS, buildAccessForUser, ROLE_OPTIONS } from './roleAccess';
import { apiRequest } from './apiClient';
import { useOutbox } from './OutboxProvider';
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
      alert('El teléfono debe tener exactamente 8 dígitos numéricos.');
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
        alert('Sin conexión: creación de usuario en cola para sincronizar.');
      } else {
        await apiRequest('/api/users', {
          method: 'POST',
          token,
          body: payload
        });
      }
      alert('Usuario agregado con éxito');
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
      alert('Error: ' + err.message);
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
        alert('Sin conexión: cambio de rol en cola para sincronizar.');
        return;
      }
      await apiRequest(`/api/users/${userId}`, {
        method: 'PATCH',
        token,
        body: payload
      });
      alert('Rol actualizado');
      await refreshUsers();
    } catch (err) {
      alert('Error: ' + err.message);
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
        alert('Sin conexión: desactivación de usuario en cola para sincronizar.');
        return;
      }
      await apiRequest(`/api/users/${userId}`, {
        method: 'DELETE',
        token
      });
      alert('Usuario desactivado');
      await refreshUsers();
    } catch (err) {
      alert('Error: ' + err.message);
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
        alert(`Sin conexión: ${isActive ? 'reactivación' : 'desactivación'} en cola para sincronizar.`);
        return;
      }
      await apiRequest(`/api/users/${userId}/activation`, {
        method: 'PATCH',
        token,
        body: { is_active: isActive }
      });
      alert(`Usuario ${isActive ? 'reactivado' : 'desactivado'}`);
      await refreshUsers();
    } catch (err) {
      alert('Error: ' + err.message);
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
      alert('El teléfono debe tener exactamente 8 dígitos numéricos.');
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
        alert('Sin conexión: edición de usuario en cola para sincronizar.');
        return;
      }
      await apiRequest(`/api/users/${editModal.userId}`, {
        method: 'PATCH',
        token,
        body: payload
      });
      alert('Usuario actualizado con éxito');
      await refreshUsers();
      setEditModal(null);
    } catch (err) {
      alert('Error: ' + err.message);
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

function ProductCatalogAdmin({ token }) {
  const { enqueueWrite } = useOutbox();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [newProduct, setNewProduct] = useState({
    sku: '',
    name: '',
    sf: '',
    cf: ''
  });
  const visibleProducts = products.filter((row) => Boolean(row.is_active));
  const inactiveProducts = products.filter((row) => !row.is_active);

  const loadProducts = async () => {
    setLoading(true);
    setMessage('');
    try {
      const data = await apiRequest('/api/product-catalog?include_inactive=1', { token });
      setProducts(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, [token]);

  const onRowField = (sku, field, value) => {
    setProducts((prev) => prev.map((row) => (
      row.sku === sku ? { ...row, [field]: value } : row
    )));
    setMessage('');
  };

  const createProduct = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        sku: String(newProduct.sku || '').toUpperCase().trim(),
        name: String(newProduct.name || '').trim(),
        sf: Number(newProduct.sf || 0),
        cf: Number(newProduct.cf || 0)
      };
      if (!payload.sku || !payload.name) {
        throw new Error('SKU y nombre son requeridos');
      }
      if (!Number.isFinite(payload.sf) || payload.sf < 0 || !Number.isFinite(payload.cf) || payload.cf < 0) {
        throw new Error('Precios SF/CF inválidos');
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Crear producto ${payload.sku}`,
          path: '/api/product-catalog',
          options: {
            method: 'POST',
            body: payload,
            retries: 0
          },
          meta: { sku: payload.sku, name: payload.name }
        });
        setProducts((prev) => [...prev, {
          sku: payload.sku,
          name: payload.name,
          sf: payload.sf,
          cf: payload.cf,
          is_active: true
        }]);
        setMessage('Sin conexión: producto en cola para sincronizar.');
      } else {
        await apiRequest('/api/product-catalog', {
          method: 'POST',
          token,
          body: payload
        });
        setMessage('Producto agregado.');
      }
      setNewProduct({ sku: '', name: '', sf: '', cf: '' });
      if (typeof navigator !== 'undefined' && navigator.onLine !== false) {
        await loadProducts();
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveProduct = async (row) => {
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        name: String(row.name || '').trim(),
        sf: Number(row.sf ?? row.sf_price ?? 0),
        cf: Number(row.cf ?? row.cf_price ?? 0),
        is_active: Boolean(row.is_active)
      };
      if (!payload.name) throw new Error('Nombre requerido');
      if (!Number.isFinite(payload.sf) || payload.sf < 0 || !Number.isFinite(payload.cf) || payload.cf < 0) {
        throw new Error('Precios SF/CF inválidos');
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Editar producto ${row.sku}`,
          path: `/api/product-catalog/${encodeURIComponent(row.sku)}`,
          options: {
            method: 'PATCH',
            body: payload,
            retries: 0
          },
          meta: { sku: row.sku }
        });
        setProducts((prev) => prev.map((item) => (
          item.sku === row.sku ? { ...item, ...payload } : item
        )));
        setMessage(`Sin conexión: cambios de ${row.sku} en cola para sincronizar.`);
      } else {
        await apiRequest(`/api/product-catalog/${encodeURIComponent(row.sku)}`, {
          method: 'PATCH',
          token,
          body: payload
        });
        setMessage(`Producto ${row.sku} actualizado.`);
        await loadProducts();
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (row) => {
    if (!window.confirm(`¿Desactivar producto ${row.sku}?`)) return;
    setSaving(true);
    setMessage('');
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Desactivar producto ${row.sku}`,
          path: `/api/product-catalog/${encodeURIComponent(row.sku)}`,
          options: {
            method: 'DELETE',
            retries: 0
          },
          meta: { sku: row.sku }
        });
        setProducts((prev) => prev.map((item) => (
          item.sku === row.sku ? { ...item, is_active: false } : item
        )));
        setMessage(`Sin conexión: desactivación de ${row.sku} en cola para sincronizar.`);
      } else {
        await apiRequest(`/api/product-catalog/${encodeURIComponent(row.sku)}`, {
          method: 'DELETE',
          token
        });
        setMessage(`Producto ${row.sku} desactivado.`);
        await loadProducts();
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div style={{ background: '#1e293b', padding: '20px', borderRadius: '12px' }}>
        <h3 style={{ marginBottom: '12px' }}>Agregar producto al cotizador</h3>
        <form onSubmit={createProduct} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
          <input
            placeholder="SKU"
            value={newProduct.sku}
            onChange={(e) => setNewProduct((prev) => ({ ...prev, sku: e.target.value.toUpperCase() }))}
            style={{ padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: 'white' }}
          />
          <input
            placeholder="Nombre"
            value={newProduct.name}
            onChange={(e) => setNewProduct((prev) => ({ ...prev, name: e.target.value }))}
            style={{ padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: 'white' }}
          />
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Precio SF"
            value={newProduct.sf}
            onChange={(e) => setNewProduct((prev) => ({ ...prev, sf: e.target.value }))}
            style={{ padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: 'white' }}
          />
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Precio CF"
            value={newProduct.cf}
            onChange={(e) => setNewProduct((prev) => ({ ...prev, cf: e.target.value }))}
            style={{ padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: 'white' }}
          />
          <button
            type="submit"
            disabled={saving}
            style={{ border: 'none', borderRadius: '8px', background: '#3b82f6', color: 'white', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Guardando...' : 'Agregar'}
          </button>
        </form>
      </div>

      {message && (
        <div style={{
          padding: '10px 12px',
          borderRadius: '8px',
          background: message.startsWith('Error') ? 'rgba(127,29,29,0.35)' : 'rgba(6,78,59,0.35)',
          border: message.startsWith('Error') ? '1px solid #ef4444' : '1px solid #10b981',
          color: message.startsWith('Error') ? '#fecaca' : '#bbf7d0'
        }}>
          {message}
        </div>
      )}

      <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px' }}>
        <h3 style={{ marginBottom: '12px' }}>Productos del cotizador</h3>
        {loading ? (
          <p style={{ color: '#94a3b8' }}>Cargando productos...</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: '960px' }}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Nombre</th>
                  <th style={{ textAlign: 'right' }}>SF</th>
                  <th style={{ textAlign: 'right' }}>CF</th>
                  <th>Activo</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8' }}>Sin productos</td></tr>
                ) : products.map((row) => (
                  <tr key={row.sku}>
                    <td>{row.sku}</td>
                    <td>
                      <input
                        value={row.name || ''}
                        onChange={(e) => onRowField(row.sku, 'name', e.target.value)}
                        style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: 'white' }}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={Number(row.sf ?? row.sf_price ?? 0)}
                        onChange={(e) => onRowField(row.sku, 'sf', e.target.value)}
                        style={{ width: '100px', padding: '8px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: 'white', textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={Number(row.cf ?? row.cf_price ?? 0)}
                        onChange={(e) => onRowField(row.sku, 'cf', e.target.value)}
                        style={{ width: '100px', padding: '8px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: 'white', textAlign: 'right' }}
                      />
                    </td>
                    <td>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(row.is_active)}
                          onChange={(e) => onRowField(row.sku, 'is_active', e.target.checked)}
                        />
                        {row.is_active ? 'Sí' : 'No'}
                      </label>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => saveProduct(row)}
                          disabled={saving}
                          style={{ padding: '8px 10px', borderRadius: '8px', border: 'none', background: '#3b82f6', color: 'white', cursor: saving ? 'not-allowed' : 'pointer' }}
                        >
                          Guardar
                        </button>
                        <button
                          onClick={() => deleteProduct(row)}
                          disabled={saving || !row.is_active}
                          style={{ padding: '8px 10px', borderRadius: '8px', border: 'none', background: '#ef4444', color: 'white', cursor: saving ? 'not-allowed' : 'pointer' }}
                        >
                          Desactivar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {inactiveProducts.length > 0 && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px' }}>
          <h4 style={{ marginBottom: '8px' }}>Productos inactivos</h4>
          <p style={{ marginBottom: '10px', color: '#94a3b8' }}>
            Reactiva un producto marcando <strong>Activo</strong> y guardando.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: '860px' }}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Nombre</th>
                  <th style={{ textAlign: 'right' }}>SF</th>
                  <th style={{ textAlign: 'right' }}>CF</th>
                  <th>Activo</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {inactiveProducts.map((row) => (
                  <tr key={`inactive-${row.sku}`}>
                    <td>{row.sku}</td>
                    <td>{row.name}</td>
                    <td style={{ textAlign: 'right' }}>{Number(row.sf ?? row.sf_price ?? 0).toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(row.cf ?? row.cf_price ?? 0).toFixed(2)}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(row.is_active)}
                        onChange={(e) => onRowField(row.sku, 'is_active', e.target.checked)}
                      />
                    </td>
                    <td>
                      <button
                        onClick={() => saveProduct({ ...row, is_active: true })}
                        disabled={saving}
                        style={{ padding: '8px 10px', borderRadius: '8px', border: 'none', background: '#10b981', color: 'white', cursor: saving ? 'not-allowed' : 'pointer' }}
                      >
                        Reactivar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatisticsPanel({ token }) {
  return <AdminDashboard token={token} />;
}

function TimeOffAdminPanel({ token }) {
  const { enqueueWrite } = useOutbox();
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState(null);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [requestsRes, summaryRes] = await Promise.all([
        apiRequest(`/api/timeoff/requests?year=${year}`, { token }),
        apiRequest(`/api/timeoff/summary?year=${year}`, { token })
      ]);
      setRows(Array.isArray(requestsRes) ? requestsRes : []);
      setSummary(Array.isArray(summaryRes) ? summaryRes : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token, year]);

  const updateStatus = async (id, status) => {
    setUpdatingId(id);
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Permiso #${id} -> ${status}`,
          path: `/api/timeoff/requests/${id}/status`,
          options: {
            method: 'PATCH',
            body: { status },
            retries: 0
          },
          meta: { requestId: id, status }
        });
        setRows((prev) => prev.map((row) => (
          row.id === id ? { ...row, status, status_label: status } : row
        )));
        alert('Sin conexión: cambio de estado en cola para sincronizar.');
      } else {
        await apiRequest(`/api/timeoff/requests/${id}/status`, {
          method: 'PATCH',
          token,
          body: { status }
        });
        await loadData();
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Calendario global de permisos</h3>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{ minHeight: '40px', minWidth: '120px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', padding: '8px 10px' }}
          >
            {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <p style={{ marginTop: '8px', color: '#94a3b8' }}>
          Política anual: 14 días de vacaciones pagadas y 5 días de enfermedad pagados por usuario.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h4 style={{ marginBottom: '10px' }}>Resumen por usuario ({year})</h4>
        {loading ? (
          <p style={{ color: '#94a3b8' }}>Cargando resumen...</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: '860px' }}>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Vacaciones aprobadas</th>
                  <th>Restante vacaciones</th>
                  <th>Enfermedad aprobada</th>
                  <th>Restante enfermedad</th>
                  <th>Otros aprobados</th>
                </tr>
              </thead>
              <tbody>
                {summary.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8' }}>Sin datos</td></tr>
                ) : summary.map((row) => (
                  <tr key={row.user_id}>
                    <td>{row.email}</td>
                    <td>{Number(row.vacation_used || 0)}</td>
                    <td>{Math.max(0, Number(row.vacation_remaining || 0))}</td>
                    <td>{Number(row.sick_used || 0)}</td>
                    <td>{Math.max(0, Number(row.sick_remaining || 0))}</td>
                    <td>{Number(row.other_used || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h4 style={{ marginBottom: '10px' }}>Solicitudes ({year})</h4>
        {error && <div style={{ color: '#fca5a5', marginBottom: '10px' }}>{error}</div>}
        {loading ? (
          <p style={{ color: '#94a3b8' }}>Cargando solicitudes...</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: '980px' }}>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Tipo</th>
                  <th>Inicio</th>
                  <th>Fin</th>
                  <th>Días</th>
                  <th>Estado</th>
                  <th>Notas</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: '#94a3b8' }}>No hay solicitudes</td></tr>
                ) : rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.user_email}</td>
                    <td>{row.leave_type_label || row.leave_type}</td>
                    <td>{row.start_date}</td>
                    <td>{row.end_date}</td>
                    <td>{row.total_days}</td>
                    <td>{row.status_label || row.status}</td>
                    <td style={{ maxWidth: '240px', whiteSpace: 'normal', wordBreak: 'break-word' }}>{row.notes || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          className="btn"
                          disabled={updatingId === row.id || row.status === 'approved'}
                          onClick={() => updateStatus(row.id, 'approved')}
                          style={{ minHeight: '34px', padding: '6px 10px', background: '#10b981', color: 'white' }}
                        >
                          Aprobar
                        </button>
                        <button
                          className="btn"
                          disabled={updatingId === row.id || row.status === 'rejected'}
                          onClick={() => updateStatus(row.id, 'rejected')}
                          style={{ minHeight: '34px', padding: '6px 10px', background: '#ef4444', color: 'white' }}
                        >
                          Rechazar
                        </button>
                        <button
                          className="btn"
                          disabled={updatingId === row.id || row.status === 'pending'}
                          onClick={() => updateStatus(row.id, 'pending')}
                          style={{ minHeight: '34px', padding: '6px 10px', background: '#334155', color: 'white' }}
                        >
                          Pendiente
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function QualityControlCommissionConfig({ token }) {
  const { enqueueWrite } = useOutbox();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const loadRows = async () => {
    setLoading(true);
    setMessage('');
    try {
      const data = await apiRequest('/api/qc/commissions', { token });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, [token]);

  const updateRate = (sku, value) => {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
    setRows((prev) => prev.map((row) => (
      row.sku === sku ? { ...row, commission_rate: safe } : row
    )));
  };

  const updateBasePrice = (sku, value) => {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    setRows((prev) => prev.map((row) => (
      row.sku === sku ? { ...row, base_price: safe } : row
    )));
  };

  const saveRows = async () => {
    setSaving(true);
    setMessage('');
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: 'Guardar comisiones QC',
          path: '/api/qc/commissions',
          options: {
            method: 'PATCH',
            body: { rows },
            retries: 0
          },
          meta: { rowCount: rows.length }
        });
        setMessage('Sin conexión: comisiones QC en cola para sincronizar.');
      } else {
        await apiRequest('/api/qc/commissions', {
          method: 'PATCH',
          token,
          body: { rows }
        });
        setMessage('Comisiones por producto guardadas.');
        await loadRows();
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '30px' }}>Cargando comisiones por producto...</div>;

  return (
    <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px' }}>
      <h3 style={{ marginBottom: '10px' }}>Control de calidad — comisión por producto</h3>
      <p style={{ color: '#94a3b8', marginBottom: '14px' }}>
        Define el % por producto para comisión de piezas aprobadas. Aplica a Admin, Almacén Lider, Microfabrica Lider y Microfabrica.
      </p>
      {message && (
        <div style={{
          marginBottom: '12px',
          padding: '10px 12px',
          borderRadius: '8px',
          background: message.startsWith('Error') ? 'rgba(127,29,29,0.35)' : 'rgba(6,78,59,0.35)',
          border: message.startsWith('Error') ? '1px solid #ef4444' : '1px solid #10b981',
          color: message.startsWith('Error') ? '#fecaca' : '#bbf7d0'
        }}>
          {message}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: '940px' }}>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Producto</th>
              <th style={{ textAlign: 'right' }}>Base Bs</th>
              <th style={{ textAlign: 'right' }}>% comisión</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.sku}>
                <td>{row.sku}</td>
                <td>{row.name || row.product_name}</td>
                <td style={{ textAlign: 'right' }}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={Number(row.base_price || 0)}
                    onChange={(e) => updateBasePrice(row.sku, e.target.value)}
                    style={{
                      width: '110px',
                      padding: '6px 8px',
                      borderRadius: '8px',
                      border: '1px solid #334155',
                      background: '#0f172a',
                      color: 'white',
                      textAlign: 'right'
                    }}
                  />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={Number(row.commission_rate || 0)}
                    onChange={(e) => updateRate(row.sku, e.target.value)}
                    style={{
                      width: '110px',
                      padding: '6px 8px',
                      borderRadius: '8px',
                      border: '1px solid #334155',
                      background: '#0f172a',
                      color: 'white',
                      textAlign: 'right'
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: '14px' }}>
        <button
          onClick={saveRows}
          disabled={saving}
          style={{
            padding: '10px 16px',
            borderRadius: '8px',
            border: 'none',
            background: '#3b82f6',
            color: 'white',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontWeight: 600
          }}
        >
          {saving ? 'Guardando...' : 'Guardar comisión por producto'}
        </button>
      </div>
    </div>
  );
}

function CommissionConfig({ token }) {
  const { enqueueWrite } = useOutbox();
  const [settings, setSettings] = useState({
    ventas_lider_percent: 5,
    ventas_top_percent: 12,
    ventas_regular_percent: 8,
    almacen_percent: 5,
    marketing_lider_percent: 5
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const loadSettings = async () => {
      setLoading(true);
      setMessage('');
      try {
        const data = await apiRequest('/api/commission/settings', { token });
        setSettings({
          ventas_lider_percent: Number(data.ventas_lider_percent ?? 5),
          ventas_top_percent: Number(data.ventas_top_percent ?? 12),
          ventas_regular_percent: Number(data.ventas_regular_percent ?? 8),
          almacen_percent: Number(data.almacen_percent ?? 5),
          marketing_lider_percent: Number(data.marketing_lider_percent ?? 5)
        });
      } catch (err) {
        setMessage(`Error: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, [token]);

  const handlePercentChange = (key, value) => {
    const parsed = Number(value);
    const safe = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
    setSettings((prev) => ({ ...prev, [key]: safe }));
    setMessage('');
  };

  const saveSettings = async () => {
    setSaving(true);
    setMessage('');
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: 'Guardar configuración de comisiones',
          path: '/api/commission/settings',
          options: {
            method: 'PATCH',
            body: { settings },
            retries: 0
          }
        });
        setMessage('Sin conexión: configuración de comisiones en cola para sincronizar.');
      } else {
        const data = await apiRequest('/api/commission/settings', {
          method: 'PATCH',
          token,
          body: { settings }
        });
        setSettings({
          ventas_lider_percent: Number(data.settings?.ventas_lider_percent ?? settings.ventas_lider_percent),
          ventas_top_percent: Number(data.settings?.ventas_top_percent ?? settings.ventas_top_percent),
          ventas_regular_percent: Number(data.settings?.ventas_regular_percent ?? settings.ventas_regular_percent),
          almacen_percent: Number(data.settings?.almacen_percent ?? settings.almacen_percent),
          marketing_lider_percent: Number(data.settings?.marketing_lider_percent ?? settings.marketing_lider_percent)
        });
        setMessage('Configuración de comisiones guardada.');
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px' }}>Cargando comisiones...</div>;
  }

  const rows = [
    { key: 'ventas_lider_percent', label: 'Ventas Lider (% sobre ventas de equipo + propias)' },
    { key: 'ventas_top_percent', label: 'Ventas top (% sobre ventas propias)' },
    { key: 'ventas_regular_percent', label: 'Asesor de ventas (% sobre ventas propias)' },
    { key: 'almacen_percent', label: 'Almacen (% sobre ventas del almacén local)' },
    { key: 'marketing_lider_percent', label: 'Marketing Lider (% sobre total de ventas)' }
  ];

  return (
    <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px' }}>
      <h3 style={{ marginBottom: '12px' }}>Comisiones por Rol</h3>
      <p style={{ color: '#94a3b8', marginBottom: '16px' }}>
        Aquí defines los porcentajes configurables de comisión. Los cambios impactan el cálculo en tiempo real.
      </p>

      <div style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
        {rows.map((row) => (
          <div
            key={row.key}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(280px, 1fr) 140px',
              gap: '12px',
              alignItems: 'center',
              border: '1px solid #334155',
              borderRadius: '10px',
              padding: '10px 12px'
            }}
          >
            <span style={{ color: '#e2e8f0' }}>{row.label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifySelf: 'end' }}>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={settings[row.key]}
                onChange={(e) => handlePercentChange(row.key, e.target.value)}
                style={{
                  width: '88px',
                  padding: '8px',
                  borderRadius: '8px',
                  border: '1px solid #334155',
                  background: '#0f172a',
                  color: 'white',
                  textAlign: 'right'
                }}
              />
              <span style={{ color: '#94a3b8' }}>%</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ color: '#94a3b8', fontSize: '0.92rem', lineHeight: 1.5, marginBottom: '14px' }}>
        <div>• Almacen Lider: compensación por pieza / control de calidad (modelo contractual).</div>
        <div>• Marketing: compensación por contrato.</div>
        <div>• Microfabrica Lider y Microfabrica: ingreso por piezas fabricadas por producto (mensual).</div>
      </div>

      {message && (
        <div style={{
          marginBottom: '12px',
          padding: '10px 12px',
          borderRadius: '8px',
          background: message.startsWith('Error') ? 'rgba(127,29,29,0.35)' : 'rgba(6,78,59,0.35)',
          border: message.startsWith('Error') ? '1px solid #ef4444' : '1px solid #10b981',
          color: message.startsWith('Error') ? '#fecaca' : '#bbf7d0'
        }}>
          {message}
        </div>
      )}

      <button
        onClick={saveSettings}
        disabled={saving}
        style={{
          padding: '10px 16px',
          borderRadius: '8px',
          border: 'none',
          background: '#3b82f6',
          color: 'white',
          cursor: saving ? 'not-allowed' : 'pointer',
          fontWeight: 600
        }}
      >
        {saving ? 'Guardando...' : 'Guardar comisiones'}
      </button>
    </div>
  );
}

function RoleConfiguration({ token }) {
  const { enqueueWrite } = useOutbox();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState('Ventas');
  const [saving, setSaving] = useState(false);
  const [applyToExistingUsers, setApplyToExistingUsers] = useState(true);
  const [message, setMessage] = useState('');

  const loadDefaults = async () => {
    setLoading(true);
    setMessage('');
    try {
      const data = await apiRequest('/api/roles/access-defaults', { token });
      setRows(data);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDefaults();
  }, [token]);

  useEffect(() => {
    if (rows.length > 0 && !rows.some((row) => row.role === selectedRole)) {
      setSelectedRole(rows[0].role);
    }
  }, [rows, selectedRole]);

  const toggleRoleAccess = (role, key) => {
    setRows((prev) => prev.map((row) => (
      row.role === role
        ? {
            ...row,
            panel_access: {
              ...(row.panel_access || {}),
              [key]: !row.panel_access?.[key]
            }
          }
        : row
    )));
  };

  const saveRole = async (role) => {
    const row = rows.find((r) => r.role === role);
    if (!row) return;
    setSaving(true);
    setMessage('');
    try {
      const payload = { panel_access: row.panel_access, apply_to_users: applyToExistingUsers };
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: applyToExistingUsers
            ? `Guardar y aplicar rol ${role}`
            : `Guardar configuración rol ${role}`,
          path: `/api/roles/access-defaults/${encodeURIComponent(role)}`,
          options: {
            method: 'PATCH',
            body: payload,
            retries: 0
          },
          meta: { role, applyToUsers: applyToExistingUsers }
        });
        const baseMsg = `Sin conexión: configuración del rol ${role} en cola para sincronizar.`;
        setMessage(applyToExistingUsers ? `${baseMsg} Se aplicará a usuarios al sincronizar.` : baseMsg);
      } else {
        const data = await apiRequest(`/api/roles/access-defaults/${encodeURIComponent(role)}`, {
          method: 'PATCH',
          token,
          body: payload
        });
        const updatedUsers = Number(data?.updated_users || 0);
        const baseMsg = `Configuración guardada para rol ${role}.`;
        setMessage(applyToExistingUsers ? `${baseMsg} Aplicada a ${updatedUsers} usuario(s).` : baseMsg);
        await loadDefaults();
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px' }}>Cargando configuración de roles...</div>;
  }

  return (
    <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px' }}>
      <h3 style={{ marginBottom: '12px' }}>Configuración de Roles</h3>
      <p style={{ color: '#94a3b8', marginBottom: '16px' }}>
        Edita los paneles por rol y guarda con un solo clic. Puedes guardar solo la plantilla o guardar y aplicar a todos los usuarios del rol.
      </p>

      {message && (
        <div style={{
          marginBottom: '14px',
          padding: '10px 12px',
          borderRadius: '8px',
          background: message.startsWith('Error') ? 'rgba(127,29,29,0.35)' : 'rgba(6,78,59,0.35)',
          border: message.startsWith('Error') ? '1px solid #ef4444' : '1px solid #10b981',
          color: message.startsWith('Error') ? '#fecaca' : '#bbf7d0'
        }}>
          {message}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ border: '1px solid #334155', borderRadius: '10px', padding: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <strong>Rol</strong>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                style={{
                  minWidth: '220px',
                  minHeight: '40px',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  border: '1px solid #334155',
                  background: '#0f172a',
                  color: '#e2e8f0'
                }}
              >
                {rows.map((row) => (
                  <option key={row.role} value={row.role}>{row.role}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <label style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                color: '#cbd5e1',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '8px 10px',
                background: 'rgba(15,23,42,0.7)'
              }}>
                <input
                  type="checkbox"
                  checked={applyToExistingUsers}
                  onChange={(e) => setApplyToExistingUsers(e.target.checked)}
                />
                Aplicar a usuarios existentes
              </label>
              <button
                onClick={() => saveRole(selectedRole)}
                disabled={saving}
                style={{ padding: '9px 14px', borderRadius: '8px', border: 'none', background: '#3b82f6', color: 'white', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 700 }}
              >
                {saving ? 'Guardando...' : 'Guardar configuración'}
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '8px' }}>
            {ACCESS_LABELS.map((field) => {
              const activeRow = rows.find((row) => row.role === selectedRole);
              return (
                <label
                  key={`${selectedRole}-${field.key}`}
                  style={{
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'center',
                    color: '#cbd5e1',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    background: 'rgba(15,23,42,0.7)'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(activeRow?.panel_access?.[field.key])}
                    onChange={() => toggleRoleAccess(selectedRole, field.key)}
                  />
                  {field.label}
                </label>
              );
            })}
          </div>

          <div style={{ marginTop: '10px', color: '#94a3b8', fontSize: '0.9rem' }}>
            Consejo: activa <strong>Aplicar a usuarios existentes</strong> si quieres que el cambio impacte inmediatamente a todo el equipo de ese rol.
          </div>
        </div>
      )}
    </div>
  );
}

function AdminPanel({ token }) {
  const location = useLocation();
  const navigate = useNavigate();
  const tabKeys = ['usuarios', 'productos', 'roles', 'comisiones', 'calendario', 'estadisticas'];
  const resolveTab = (searchText = '') => {
    const tab = new URLSearchParams(searchText).get('tab');
    return tabKeys.includes(tab) ? tab : 'usuarios';
  };
  const [activeTab, setActiveTab] = useState(() => resolveTab(location.search));
  const tabs = [
    { key: 'usuarios', label: 'Usuarios' },
    { key: 'productos', label: 'Productos Cotizador' },
    { key: 'roles', label: 'Configuración de Roles' },
    { key: 'comisiones', label: 'Comisiones' },
    { key: 'calendario', label: 'Calendario' },
    { key: 'estadisticas', label: 'Estadísticas' }
  ];

  useEffect(() => {
    const nextTab = resolveTab(location.search);
    if (nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
  }, [location.search, activeTab]);

  const changeTab = (nextTab) => {
    const safeTab = tabKeys.includes(nextTab) ? nextTab : 'usuarios';
    setActiveTab(safeTab);
    navigate(`/admin?tab=${safeTab}`, { replace: false });
  };

  return (
    <div style={{ padding: '24px 16px 16px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '10px',
        marginBottom: '16px'
      }}>
        <h2 style={{ margin: 0 }}>Panel Admin</h2>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#94a3b8', fontSize: '0.92rem' }}>Sección</span>
          <select
            value={activeTab}
            onChange={(e) => changeTab(e.target.value)}
            style={{
              minWidth: '220px',
              minHeight: '40px',
              padding: '8px 10px',
              borderRadius: '8px',
              border: '1px solid #334155',
              background: '#0f172a',
              color: '#e2e8f0'
            }}
          >
            {tabs.map((tab) => (
              <option key={tab.key} value={tab.key}>{tab.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        {activeTab === 'usuarios' && <UserManagement token={token} />}
        {activeTab === 'productos' && <ProductCatalogAdmin token={token} />}
        {activeTab === 'roles' && <RoleConfiguration token={token} />}
        {activeTab === 'comisiones' && (
          <div style={{ display: 'grid', gap: '14px' }}>
            <CommissionConfig token={token} />
            <QualityControlCommissionConfig token={token} />
          </div>
        )}
        {activeTab === 'calendario' && <TimeOffAdminPanel token={token} />}
        {activeTab === 'estadisticas' && <StatisticsPanel token={token} />}
      </div>
    </div>
  );
}

export default AdminPanel;