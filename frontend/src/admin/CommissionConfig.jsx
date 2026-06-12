import { useState, useEffect } from 'react';
import { apiRequest } from '../apiClient';
import { useOutbox } from '../OutboxProvider';
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

export default CommissionConfig;
