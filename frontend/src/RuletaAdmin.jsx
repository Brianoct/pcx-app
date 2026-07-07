// Marketing editor for the prize wheel: slices (text + probability weight +
// top-prize flag), live preview identical to what the customer sees, and
// per-campaign stats. Every save starts a new "campaign" (config version),
// which re-enables one spin for customers who played the previous wheel.
import { useState, useEffect } from 'react';
import { apiRequest } from './apiClient';
import { WheelSvg } from './wheelShared';
import { useToast } from './ui/toastContext';

const MAX_SLICES = 12;
const MIN_SLICES = 2;

export default function RuletaAdmin({ token }) {
  const toast = useToast();
  const [slices, setSlices] = useState([]);
  const [isActive, setIsActive] = useState(true);
  const [version, setVersion] = useState(0);
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [giftProducts, setGiftProducts] = useState([]);

  useEffect(() => {
    let active = true;
    apiRequest('/api/product-catalog', { token })
      .then((data) => {
        if (!active) return;
        setGiftProducts((Array.isArray(data) ? data : [])
          .filter((product) => Boolean(product?.is_gift_eligible))
          .map((product) => ({
            sku: String(product.sku || '').trim().toUpperCase(),
            name: String(product.name || '').trim() || product.sku
          })));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    let active = true;
    apiRequest('/api/wheel/config', { token })
      .then((data) => {
        if (!active) return;
        setSlices(Array.isArray(data?.config?.slices) ? data.config.slices : []);
        setIsActive(Boolean(data?.config?.is_active));
        setVersion(Number(data?.config?.version || 0));
        setStats(Array.isArray(data?.stats) ? data.stats : []);
      })
      .catch((err) => { if (active) setError(err.message || 'No se pudo cargar'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const editSlice = (index, field, value) => {
    setSlices((prev) => prev.map((slice, i) => (i === index ? { ...slice, [field]: value } : slice)));
  };

  const totalWeight = slices.reduce((sum, slice) => sum + (Number(slice.weight) || 0), 0);

  const save = async () => {
    setSaving(true);
    try {
      const data = await apiRequest('/api/wheel/config', {
        method: 'PUT',
        token,
        body: {
          slices: slices.map((slice) => ({
            label: String(slice.label || '').trim(),
            weight: Number(slice.weight) || 0,
            top: Boolean(slice.top),
            type: slice.type || 'text',
            percent: slice.type === 'discount' ? Number(slice.percent) || 0 : undefined,
            gift_sku: slice.type === 'gift' ? String(slice.gift_sku || '').trim().toUpperCase() : undefined
          })),
          is_active: isActive
        }
      });
      setVersion(Number(data?.config?.version || version + 1));
      toast.success(`Ruleta guardada — campaña #${data?.config?.version}. Los clientes pueden recibir un giro nuevo.`);
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="container"><p>Cargando ruleta…</p></div>;

  return (
    <div className="container ruleta-admin">
      <h2 className="ruleta-admin-title">🎡 Ruleta de premios</h2>
      <p className="ruleta-admin-hint">
        Ventas genera un enlace por cliente desde Cotizar; el cliente gira <strong>una sola vez</strong> y el
        premio aparece automáticamente al cotizarle. Guardar inicia una campaña nueva.
      </p>
      {error && <div className="ruleta-admin-error">{error}</div>}

      <div className="ruleta-admin-layout">
        <div className="card ruleta-admin-editor">
          <div className="ruleta-admin-editor-head">
            <h3>Espacios de la ruleta ({slices.length})</h3>
            <label className="ruleta-active-toggle">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Ruleta activa
            </label>
          </div>

          <div className="ruleta-slice-head">
            <span>Texto del premio</span>
            <span title="Peso relativo: más peso = sale más seguido">Prob.</span>
            <span title="Marca UNO como premio mayor (celebración especial)">Mayor</span>
            <span />
          </div>
          {slices.map((slice, i) => (
            <div key={i} className={`ruleta-slice-row ${slice.top ? 'is-top' : ''}`}>
              <input
                type="text"
                maxLength={60}
                value={slice.label || ''}
                placeholder={`Premio ${i + 1}`}
                onChange={(e) => editSlice(i, 'label', e.target.value)}
              />
              <input
                type="number"
                min="0"
                max="1000"
                step="1"
                value={slice.weight}
                onChange={(e) => editSlice(i, 'weight', e.target.value)}
              />
              <label className="ruleta-top-check" title="Premio mayor">
                <input
                  type="checkbox"
                  checked={Boolean(slice.top)}
                  onChange={(e) => setSlices((prev) => prev.map((s, j) => (
                    j === i ? { ...s, top: e.target.checked } : (e.target.checked ? { ...s, top: false } : s)
                  )))}
                />
                <span>{slice.top ? '⭐' : '☆'}</span>
              </label>
              <button
                type="button"
                className="ruleta-slice-remove"
                title="Quitar espacio"
                disabled={slices.length <= MIN_SLICES}
                onClick={() => setSlices((prev) => prev.filter((_, j) => j !== i))}
              >
                ✕
              </button>
              <div className="ruleta-slice-type">
                <select
                  value={slice.type || 'text'}
                  onChange={(e) => editSlice(i, 'type', e.target.value)}
                  title="Qué hace este premio al llegar a Cotizar"
                >
                  <option value="text">Solo texto (no llena nada)</option>
                  <option value="discount">Descuento % (llena Descuento)</option>
                  <option value="gift">Regalo (llena Regalo)</option>
                </select>
                {slice.type === 'discount' && (
                  <span className="ruleta-type-extra">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={slice.percent ?? ''}
                      placeholder="%"
                      onChange={(e) => editSlice(i, 'percent', e.target.value)}
                    />
                    <span>% de descuento</span>
                  </span>
                )}
                {slice.type === 'gift' && (
                  <select
                    className="ruleta-gift-select"
                    value={slice.gift_sku || ''}
                    onChange={(e) => editSlice(i, 'gift_sku', e.target.value)}
                  >
                    <option value="">Elegir producto regalo…</option>
                    {giftProducts.map((product) => (
                      <option key={product.sku} value={product.sku}>{product.name} ({product.sku})</option>
                    ))}
                  </select>
                )}
                {totalWeight > 0 && (
                  <span className="ruleta-slice-odds">
                    {(((Number(slice.weight) || 0) / totalWeight) * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          ))}

          <div className="ruleta-admin-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={slices.length >= MAX_SLICES}
              onClick={() => setSlices((prev) => [...prev, { label: '', weight: 10, top: false, type: 'text' }])}
            >
              + Agregar espacio
            </button>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
              {saving ? 'Guardando…' : 'Guardar (nueva campaña)'}
            </button>
          </div>

          {stats.length > 0 && (
            <div className="ruleta-stats">
              <h4>Campañas</h4>
              <table>
                <thead>
                  <tr><th>Campaña</th><th>Enlaces</th><th>Giros</th><th>Premios mayores</th></tr>
                </thead>
                <tbody>
                  {stats.map((row) => (
                    <tr key={row.config_version} className={Number(row.config_version) === version ? 'is-current' : ''}>
                      <td>#{row.config_version}{Number(row.config_version) === version ? ' (actual)' : ''}</td>
                      <td>{row.links}</td>
                      <td>{row.spins}</td>
                      <td>{row.top_prizes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card ruleta-admin-preview">
          <h3>Vista previa</h3>
          <div className="ruleta-preview-stage">
            <div className="wheel-pointer" aria-hidden="true" />
            <WheelSvg
              slices={slices.filter((slice) => String(slice.label || '').trim())}
              gradientId="goldShinePreview"
              className="wheel-svg ruleta-preview-svg"
            />
          </div>
          <p className="ruleta-preview-note">Así la verá el cliente en su teléfono.</p>
        </div>
      </div>
    </div>
  );
}
