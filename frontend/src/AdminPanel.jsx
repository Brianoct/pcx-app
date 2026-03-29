// src/AdminPanel.jsx
import { useState, useEffect } from 'react';
import AdminDashboard from './AdminDashboard';
import { ACCESS_LABELS, buildAccessForUser, ROLE_LABELS, ROLE_OPTIONS } from './roleAccess';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// User management component
function UserManagement({ token }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    role: 'Ventas',
    city: 'Santa Cruz',
    phone: '',
    panel_access: buildAccessForUser('Ventas')
  });
  const [editModal, setEditModal] = useState(null); // { userId, email, role, city, phone, panel_access }

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/users`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('No se pudo cargar usuarios');
        const data = await res.json();
        setUsers(data);
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
      const res = await fetch(`${API_BASE}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(newUser)
      });
      if (!res.ok) throw new Error('No se pudo agregar usuario');
      alert('Usuario agregado con éxito');
      const refreshRes = await fetch(`${API_BASE}/api/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setUsers(await refreshRes.json());
      setNewUser({
        email: '',
        password: '',
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
      const res = await fetch(`${API_BASE}/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          role: newRole,
          panel_access: buildAccessForUser(newRole)
        })
      });
      if (!res.ok) throw new Error('No se pudo actualizar rol');
      alert('Rol actualizado');
      const refreshRes = await fetch(`${API_BASE}/api/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setUsers(await refreshRes.json());
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('¿Eliminar este usuario y TODAS sus cotizaciones asociadas? Esto es irreversible.')) return;
    try {
      const res = await fetch(`${API_BASE}/api/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('No se pudo eliminar usuario');
      alert('Usuario eliminado');
      const refreshRes = await fetch(`${API_BASE}/api/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setUsers(await refreshRes.json());
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const openEditModal = (user) => {
    setEditModal({
      userId: user.id,
      email: user.email,
      role: user.role,
      city: user.city || '',
      phone: user.phone || '',
      panel_access: buildAccessForUser(user.role, user.panel_access)
    });
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();

    if (editModal.phone && !/^\d{8}$/.test(editModal.phone)) {
      alert('El teléfono debe tener exactamente 8 dígitos numéricos.');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/users/${editModal.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          role: editModal.role,
          city: editModal.city,
          phone: editModal.phone,
          panel_access: editModal.panel_access
        })
      });
      if (!res.ok) throw new Error('No se pudo actualizar usuario');
      alert('Usuario actualizado con éxito');
      const refreshRes = await fetch(`${API_BASE}/api/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setUsers(await refreshRes.json());
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

  if (loading) return <div style={{ textAlign: 'center', padding: '50px' }}>Cargando usuarios...</div>;
  if (error) return <div style={{ color: '#f87171', textAlign: 'center', padding: '50px' }}>Error: {error}</div>;

  return (
    <div>
      {/* Add new user form */}
      <div style={{ background: '#1e293b', padding: '24px', borderRadius: '12px', marginBottom: '32px' }}>
        <h3 style={{ marginBottom: '20px' }}>Agregar Nuevo Usuario</h3>
        <form onSubmit={handleAddUser}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
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
                <option value="Ventas">Ventas</option>
                <option value="Ventas Lider">Ventas Líder</option>
                <option value="Marketing">Marketing</option>
                <option value="Marketing Lider">Marketing Líder</option>
                <option value="Admin">Admin</option>
                <option value="Almacen Lider">Almacén Líder</option>
                <option value="Almacen">Almacén</option>
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

          <div style={{ marginTop: '20px' }}>
            <h4 style={{ marginBottom: '10px', color: '#f1f5f9' }}>Acceso por panel</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px' }}>
              {ACCESS_LABELS.map((field) => (
                <label key={field.key} style={{ display: 'flex', gap: '8px', alignItems: 'center', color: '#cbd5e1' }}>
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

          <button type="submit" style={{ width: '100%', padding: '14px', background: '#f87171', color: 'white', border: 'none', borderRadius: '8px', marginTop: '24px', fontWeight: '600' }}>
            Agregar Usuario
          </button>
        </form>
      </div>

      {/* Users list */}
      <h3 style={{ marginBottom: '20px' }}>Lista de Usuarios</h3>
      {users.length === 0 ? (
        <p>No hay usuarios.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1000px' }}>
          <thead>
            <tr style={{ background: '#0f172a' }}>
              <th style={{ padding: '12px' }}>Email</th>
              <th style={{ padding: '12px' }}>Teléfono</th>
              <th style={{ padding: '12px' }}>Rol</th>
              <th style={{ padding: '12px' }}>Ciudad</th>
              <th style={{ padding: '12px' }}>Creado</th>
              <th style={{ padding: '12px' }}>Acción</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id} style={{ borderBottom: '1px solid #334155' }}>
                <td style={{ padding: '12px' }}>{user.email}</td>
                <td style={{ padding: '12px' }}>
                  {user.phone ? `+591 ${user.phone}` : '—'}
                </td>
                <td style={{ padding: '12px' }}>
                  <select
                    value={user.role}
                    onChange={(e) => handleUpdateRole(user.id, e.target.value)}
                    style={{ padding: '6px', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
                  >
                    <option value="Ventas">Ventas</option>
                    <option value="Ventas Lider">Ventas Líder</option>
                    <option value="Marketing">Marketing</option>
                    <option value="Marketing Lider">Marketing Líder</option>
                    <option value="Admin">Admin</option>
                    <option value="Almacen Lider">Almacén Líder</option>
                    <option value="Almacen">Almacén</option>
                  </select>
                </td>
                <td style={{ padding: '12px' }}>{user.city || '—'}</td>
                <td style={{ padding: '12px' }}>{new Date(user.created_at).toLocaleString('es-BO')}</td>
                <td style={{ padding: '12px' }}>
                  <button
                    onClick={() => openEditModal(user)}
                    style={{ padding: '8px 12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', marginRight: '8px' }}
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleDeleteUser(user.id)}
                    style={{ padding: '8px 12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Edit User Modal */}
      {editModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: '#1e293b',
            padding: '32px',
            borderRadius: '12px',
            width: '90%',
            maxWidth: '500px',
            color: '#f1f5f9'
          }}>
            <h3 style={{ margin: '0 0 24px', color: '#e11d48' }}>Editar Usuario</h3>

            <form onSubmit={handleEditSubmit}>
              <div style={{ display: 'grid', gap: '16px' }}>
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
                    <option value="Ventas">Ventas</option>
                    <option value="Ventas Lider">Ventas Líder</option>
                    <option value="Marketing">Marketing</option>
                    <option value="Marketing Lider">Marketing Líder</option>
                    <option value="Admin">Admin</option>
                    <option value="Almacen Lider">Almacén Líder</option>
                    <option value="Almacen">Almacén</option>
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
                  <label style={{ display: 'block', marginBottom: '8px', color: '#94a3b8' }}>Acceso por panel</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '8px' }}>
                    {ACCESS_LABELS.map((field) => (
                      <label key={field.key} style={{ display: 'flex', gap: '8px', alignItems: 'center', color: '#cbd5e1' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(editModal.panel_access?.[field.key])}
                          onChange={() => handleEditAccessToggle(field.key)}
                        />
                        {field.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '16px', marginTop: '32px', justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={() => setEditModal(null)}
                  style={{
                    padding: '12px 32px',
                    background: '#64748b',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '1.1rem'
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '12px 32px',
                    background: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '1.1rem'
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

function StatisticsPanel({ token }) {
  return <AdminDashboard token={token} />;
}

function CommissionConfig({ token }) {
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
        const res = await fetch(`${API_BASE}/api/commission/settings`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'No se pudo cargar configuración de comisiones');
        }
        const data = await res.json();
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
      const res = await fetch(`${API_BASE}/api/commission/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ settings })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'No se pudo guardar configuración');
      }
      const data = await res.json();
      setSettings({
        ventas_lider_percent: Number(data.settings?.ventas_lider_percent ?? settings.ventas_lider_percent),
        ventas_top_percent: Number(data.settings?.ventas_top_percent ?? settings.ventas_top_percent),
        ventas_regular_percent: Number(data.settings?.ventas_regular_percent ?? settings.ventas_regular_percent),
        almacen_percent: Number(data.settings?.almacen_percent ?? settings.almacen_percent),
        marketing_lider_percent: Number(data.settings?.marketing_lider_percent ?? settings.marketing_lider_percent)
      });
      setMessage('Configuración de comisiones guardada.');
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
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingRole, setSavingRole] = useState(null);
  const [applyingRole, setApplyingRole] = useState(null);
  const [message, setMessage] = useState('');

  const loadDefaults = async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/roles/access-defaults`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('No se pudo cargar configuración de roles');
      const data = await res.json();
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
    setSavingRole(role);
    setMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/roles/access-defaults/${encodeURIComponent(role)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ panel_access: row.panel_access })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'No se pudo guardar configuración del rol');
      }
      setMessage(`Configuración guardada para rol ${role}.`);
      await loadDefaults();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSavingRole(null);
    }
  };

  const applyRoleDefaultsToUsers = async (role) => {
    if (!window.confirm(`¿Aplicar la configuración por defecto del rol "${role}" a todos los usuarios con ese rol?`)) return;
    setApplyingRole(role);
    setMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/roles/access-defaults/${encodeURIComponent(role)}/apply`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'No se pudo aplicar configuración a usuarios');
      }
      const data = await res.json();
      setMessage(`Aplicado a ${data.updated_users ?? 0} usuario(s) del rol ${role}.`);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setApplyingRole(null);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px' }}>Cargando configuración de roles...</div>;
  }

  return (
    <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px' }}>
      <h3 style={{ marginBottom: '12px' }}>Configuración de Roles</h3>
      <p style={{ color: '#94a3b8', marginBottom: '16px' }}>
        Edita los paneles por defecto por rol. Luego puedes aplicar esa configuración a todos los usuarios del rol.
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

      <div style={{ display: 'grid', gap: '12px' }}>
        {rows.map((row) => (
          <div key={row.role} style={{ border: '1px solid #334155', borderRadius: '10px', padding: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' }}>
              <strong>{row.role}</strong>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => saveRole(row.role)}
                  disabled={savingRole === row.role}
                  style={{ padding: '8px 12px', borderRadius: '6px', border: 'none', background: '#3b82f6', color: 'white', cursor: 'pointer' }}
                >
                  {savingRole === row.role ? 'Guardando...' : 'Guardar rol'}
                </button>
                <button
                  onClick={() => applyRoleDefaultsToUsers(row.role)}
                  disabled={applyingRole === row.role}
                  style={{ padding: '8px 12px', borderRadius: '6px', border: 'none', background: '#10b981', color: 'white', cursor: 'pointer' }}
                >
                  {applyingRole === row.role ? 'Aplicando...' : 'Aplicar a usuarios'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px' }}>
              {ACCESS_LABELS.map((field) => (
                <label key={`${row.role}-${field.key}`} style={{ display: 'flex', gap: '8px', alignItems: 'center', color: '#cbd5e1' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(row.panel_access?.[field.key])}
                    onChange={() => toggleRoleAccess(row.role, field.key)}
                  />
                  {field.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminPanel({ token }) {
  const [activeTab, setActiveTab] = useState('usuarios');

  return (
    <div style={{ padding: '24px 16px 16px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: '8px',
        marginBottom: '24px',
        borderBottom: '2px solid #334155',
        paddingBottom: '4px',
        position: 'sticky',
        top: '68px',
        zIndex: 15,
        background: '#0f172a'
      }}>
        <button onClick={() => setActiveTab('usuarios')} style={{ padding: '14px 40px', background: 'transparent', color: activeTab === 'usuarios' ? '#f87171' : '#94a3b8', border: 'none', borderBottom: activeTab === 'usuarios' ? '4px solid #f87171' : '4px solid transparent', fontSize: '1.2rem', fontWeight: activeTab === 'usuarios' ? '600' : '500', cursor: 'pointer' }}>
          Usuarios
        </button>
        <button onClick={() => setActiveTab('roles')} style={{ padding: '14px 40px', background: 'transparent', color: activeTab === 'roles' ? '#f87171' : '#94a3b8', border: 'none', borderBottom: activeTab === 'roles' ? '4px solid #f87171' : '4px solid transparent', fontSize: '1.2rem', fontWeight: activeTab === 'roles' ? '600' : '500', cursor: 'pointer' }}>
          Configuración de Roles
        </button>
        <button onClick={() => setActiveTab('comisiones')} style={{ padding: '14px 40px', background: 'transparent', color: activeTab === 'comisiones' ? '#f87171' : '#94a3b8', border: 'none', borderBottom: activeTab === 'comisiones' ? '4px solid #f87171' : '4px solid transparent', fontSize: '1.2rem', fontWeight: activeTab === 'comisiones' ? '600' : '500', cursor: 'pointer' }}>
          Comisiones
        </button>
        <button onClick={() => setActiveTab('estadisticas')} style={{ padding: '14px 40px', background: 'transparent', color: activeTab === 'estadisticas' ? '#f87171' : '#94a3b8', border: 'none', borderBottom: activeTab === 'estadisticas' ? '4px solid #f87171' : '4px solid transparent', fontSize: '1.2rem', fontWeight: activeTab === 'estadisticas' ? '600' : '500', cursor: 'pointer' }}>
          Estadísticas
        </button>
      </div>

      <div>
        {activeTab === 'usuarios' && <UserManagement token={token} />}
        {activeTab === 'roles' && <RoleConfiguration token={token} />}
        {activeTab === 'comisiones' && <CommissionConfig token={token} />}
        {activeTab === 'estadisticas' && <StatisticsPanel token={token} />}
      </div>
    </div>
  );
}

export default AdminPanel;