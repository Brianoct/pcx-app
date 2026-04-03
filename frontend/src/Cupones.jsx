// src/Cupones.jsx
import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from './apiClient';
import { useOutbox } from './OutboxProvider';

function Cupones({ token }) {
  const { enqueueWrite, isOnline } = useOutbox();
  const [coupons, setCoupons] = useState([]);
  const [code, setCode] = useState('');
  const [discountPercent, setDiscountPercent] = useState(0);
  const [validUntil, setValidUntil] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const fetchCoupons = useCallback(async () => {
    try {
      const data = await apiRequest('/api/cupones', { token });
      setCoupons(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchCoupons();
  }, [fetchCoupons]);

  const handleCreateCoupon = async () => {
    if (!code.trim() || discountPercent <= 0 || !validUntil) {
      alert('Complete todos los campos correctamente');
      return;
    }

    const payload = {
      code: code.trim().toUpperCase(),
      discount_percent: discountPercent,
      valid_until: validUntil
    };

    if (!isOnline) {
      enqueueWrite({
        label: `Crear cupón ${payload.code}`,
        path: '/api/cupones',
        options: {
          method: 'POST',
          body: payload,
          retries: 0
        },
        meta: {
          type: 'coupon_create',
          code: payload.code
        }
      });
      setCode('');
      setDiscountPercent(0);
      setValidUntil('');
      alert('Sin conexión: cupón en cola para sincronizar.');
      return;
    }

    try {
      await apiRequest('/api/cupones', {
        method: 'POST',
        token,
        body: payload
      });

      alert('Cupón creado correctamente');
      setCode('');
      setDiscountPercent(0);
      setValidUntil('');
      fetchCoupons();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleDeleteCoupon = async (id) => {
    if (!window.confirm('¿Eliminar cupón permanentemente?')) return;

    if (!isOnline) {
      const existing = coupons.find((item) => Number(item.id) === Number(id));
      enqueueWrite({
        label: `Eliminar cupón ${existing?.code || `#${id}`}`,
        path: `/api/cupones/${id}`,
        options: {
          method: 'DELETE',
          retries: 0
        },
        meta: {
          type: 'coupon_delete',
          couponId: id,
          code: existing?.code || ''
        }
      });
      setCoupons((prev) => prev.filter((item) => Number(item.id) !== Number(id)));
      alert('Sin conexión: eliminación en cola para sincronizar.');
      return;
    }

    try {
      await apiRequest(`/api/cupones/${id}`, {
        method: 'DELETE',
        token
      });
      alert('Cupón eliminado');
      fetchCoupons();
    } catch (err) {
      alert('Error al eliminar: ' + err.message);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}>Cargando...</div>;

  return (
    <div style={{ padding: '16px' }}>
      <h2 style={{ textAlign: 'center', color: '#f87171', marginBottom: '24px' }}>Cupones</h2>
      {error && <p style={{ textAlign: 'center', color: '#f87171', marginBottom: '12px' }}>{error}</p>}

      {/* Create Coupon Form */}
      <div style={{ background: '#1e293b', padding: '20px', borderRadius: '12px', marginBottom: '32px' }}>
        <h3 style={{ color: '#94a3b8', marginBottom: '16px' }}>Crear Nuevo Cupón</h3>

        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Código del cupón (ej: PADRE20)"
          style={{ width: '100%', padding: '12px', marginBottom: '16px', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
        />

        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Porcentaje de descuento</label>
            <input
              type="number"
              min="1"
              max="50"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(Math.min(50, Math.max(0, parseInt(e.target.value) || 0)))}
              style={{ width: '100%', padding: '12px', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
            />
          </div>

          <div style={{ flex: 1 }}>
            <label style={{ color: '#94a3b8', display: 'block', marginBottom: '6px' }}>Válido hasta</label>
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              style={{ width: '100%', padding: '12px', background: '#0f172a', color: 'white', border: '1px solid #334155', borderRadius: '6px' }}
            />
          </div>
        </div>

        <button
          onClick={handleCreateCoupon}
          style={{ width: '100%', padding: '14px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.1rem', cursor: 'pointer' }}
          disabled={!code.trim() || discountPercent <= 0 || !validUntil}
        >
          Crear Cupón
        </button>
      </div>

      {/* Existing Coupons */}
      <h3 style={{ color: '#94a3b8', marginBottom: '12px' }}>Cupones Existentes</h3>
      {coupons.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#94a3b8' }}>No hay cupones creados aún</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#0f172a' }}>
                <th style={{ padding: '12px', textAlign: 'left' }}>Código</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>Descuento</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>Válido hasta</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map(coupon => (
                <tr key={coupon.id} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '12px' }}>{coupon.code}</td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>{coupon.discount_percent}%</td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    {new Date(coupon.valid_until).toLocaleDateString('es-BO')}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <button
                      onClick={() => handleDeleteCoupon(coupon.id)}
                      style={{ background: '#ef4444', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default Cupones;