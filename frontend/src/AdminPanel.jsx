// src/AdminPanel.jsx
import { useState, useEffect } from 'react';
import AdminDashboard from './AdminDashboard';

// User management component
function UserManagement({ token }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newUser, setNewUser] = useState({ email: '', password: '', role: 'Ventas', city: 'Santa Cruz', phone: '' });
  const [editModal, setEditModal] = useState(null); // { userId, email, role, city, phone }

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch('http://localhost:4000/api/users', {
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
      const res = await fetch('http://localhost:4000/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(newUser)
      });
      if (!res.ok) throw new Error('No se pudo agregar usuario');
      alert('Usuario agregado con éxito');
      const refreshRes = await fetch('http://localhost:4000/api/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setUsers(await refreshRes.json());
      setNewUser({ email: '', password: '', role: 'Ventas', city: 'Santa Cruz', phone: '' });
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleUpdateRole = async (userId, newRole) => {
    try {
      const res = await fetch(`http://localhost:4000/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ role: newRole })
      });
      if (!res.ok) throw new Error('No se pudo actualizar rol');
      alert('Rol actualizado');
      const refreshRes = await fetch('http://localhost:4000/api/users', {
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
      const res = await fetch(`http://localhost:4000/api/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('No se pudo eliminar usuario');
      alert('Usuario eliminado');
      const refreshRes = await fetch('http://localhost:4000/api/users', {
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
      phone: user.phone || ''
    });
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();

    if (editModal.phone && !/^\d{8}$/.test(editModal.phone)) {
      alert('El teléfono debe tener exactamente 8 dígitos numéricos.');
      return;
    }

    try {
      const res = await fetch(`http://localhost:4000/api/users/${editModal.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          role: editModal.role,
          city: editModal.city,
          phone: editModal.phone
        })
      });
      if (!res.ok) throw new Error('No se pudo actualizar usuario');
      alert('Usuario actualizado con éxito');
      const refreshRes = await fetch('http://localhost:4000/api/users', {
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
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
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
                    onChange={(e) => setEditModal({ ...editModal, role: e.target.value })}
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

function StatisticsDashboard({ token }) {
  return <AdminDashboard token={token} />;
}

function AdminPanel({ token }) {
  const [activeTab, setActiveTab] = useState('usuarios');

  return (
    <div style={{ padding: '16px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '32px', borderBottom: '2px solid #334155' }}>
        <button onClick={() => setActiveTab('usuarios')} style={{ padding: '14px 40px', background: 'transparent', color: activeTab === 'usuarios' ? '#f87171' : '#94a3b8', border: 'none', borderBottom: activeTab === 'usuarios' ? '4px solid #f87171' : '4px solid transparent', fontSize: '1.2rem', fontWeight: activeTab === 'usuarios' ? '600' : '500', cursor: 'pointer' }}>
          Usuarios
        </button>
        <button onClick={() => setActiveTab('dashboard')} style={{ padding: '14px 40px', background: 'transparent', color: activeTab === 'dashboard' ? '#f87171' : '#94a3b8', border: 'none', borderBottom: activeTab === 'dashboard' ? '4px solid #f87171' : '4px solid transparent', fontSize: '1.2rem', fontWeight: activeTab === 'dashboard' ? '600' : '500', cursor: 'pointer' }}>
          Dashboard
        </button>
      </div>

      <div>
        {activeTab === 'usuarios' && <UserManagement token={token} />}
        {activeTab === 'dashboard' && <StatisticsDashboard token={token} />}
      </div>
    </div>
  );
}

export default AdminPanel;