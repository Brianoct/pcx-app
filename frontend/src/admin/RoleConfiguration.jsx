import { useState, useEffect } from 'react';
import { ACCESS_LABELS } from '../roleAccess';
import { apiRequest } from '../apiClient';
import { useOutbox } from '../OutboxProvider';
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div className="card">
      <h3 style={{ marginBottom: '12px' }}>Configuración de Roles</h3>
      <p style={{ color: '#78716c', marginBottom: '16px' }}>
        Edita los paneles por rol y guarda con un solo clic. Puedes guardar solo la plantilla o guardar y aplicar a todos los usuarios del rol.
      </p>

      {message && (
        <div style={{
          marginBottom: '14px',
          padding: '10px 12px',
          borderRadius: '8px',
          background: message.startsWith('Error') ? 'rgba(254,226,226,0.35)' : 'rgba(6,78,59,0.35)',
          border: message.startsWith('Error') ? '1px solid #ef4444' : '1px solid #047857',
          color: message.startsWith('Error') ? '#b91c1c' : '#047857'
        }}>
          {message}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ border: '1px solid #e7e0d8', borderRadius: '10px', padding: '14px' }}>
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
                  border: '1px solid #e7e0d8',
                  background: '#ffffff',
                  color: '#292524'
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
                color: '#57534e',
                border: '1px solid #e7e0d8',
                borderRadius: '8px',
                padding: '8px 10px',
                background: 'rgba(255,255,255,0.7)'
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
                    color: '#57534e',
                    border: '1px solid #e7e0d8',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    background: 'rgba(255,255,255,0.7)'
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

          <div style={{ marginTop: '10px', color: '#78716c', fontSize: '0.9rem' }}>
            Consejo: activa <strong>Aplicar a usuarios existentes</strong> si quieres que el cambio impacte inmediatamente a todo el equipo de ese rol.
          </div>
        </div>
      )}
    </div>
  );
}

export default RoleConfiguration;
