// Marketing manager for prize-wheel campaigns: create, edit, delete and
// activate named ruletas, pick gift prizes from the full product catalog, and
// TEST the exact customer experience (spins locally — burns no real spins).
import { useState, useEffect, useMemo } from 'react';
import { apiRequest } from './apiClient';
import { WheelSvg } from './wheelShared';
import WheelStage from './WheelStage';
import { useToast } from './ui/toastContext';

const MAX_SLICES = 12;
const MIN_SLICES = 2;

const DEFAULT_SLICES = [
  { label: '5% de descuento', weight: 20, top: false, type: 'discount', percent: 5 },
  { label: 'Regalo sorpresa', weight: 15, top: false, type: 'text' },
  { label: 'Sigue participando', weight: 40, top: false, type: 'text' },
  { label: 'PREMIO MAYOR', weight: 2, top: true, type: 'text' }
];

export default function RuletaAdmin({ token }) {
  const toast = useToast();
  const [campaigns, setCampaigns] = useState([]);
  const [selectedId, setSelectedId] = useState(null); // null = creating a new one
  const [name, setName] = useState('');
  const [slices, setSlices] = useState(DEFAULT_SLICES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [products, setProducts] = useState([]);
  const [testOpen, setTestOpen] = useState(false);

  const loadCampaigns = async () => {
    const data = await apiRequest('/api/wheel/campaigns', { token });
    const list = Array.isArray(data?.campaigns) ? data.campaigns : [];
    setCampaigns(list);
    return list;
  };

  useEffect(() => {
    let active = true;
    Promise.all([
      loadCampaigns().then((list) => {
        if (!active || list.length === 0) return;
        const current = list.find((c) => c.is_active) || list[0];
        setSelectedId(current.id);
        setName(current.name);
        setSlices(current.slices);
      }),
      apiRequest('/api/product-catalog', { token }).then((data) => {
        if (!active) return;
        setProducts((Array.isArray(data) ? data : []).map((product) => ({
          sku: String(product.sku || '').trim().toUpperCase(),
          name: String(product.name || '').trim() || product.sku
        })));
      })
    ])
      .catch((err) => { if (active) setError(err.message || 'No se pudo cargar'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const selectCampaign = (campaign) => {
    setSelectedId(campaign.id);
    setName(campaign.name);
    setSlices(campaign.slices);
    setError('');
  };

  const startNew = () => {
    setSelectedId(null);
    setName('');
    setSlices(DEFAULT_SLICES);
    setError('');
  };

  const editSlice = (index, field, value) => {
    setSlices((prev) => prev.map((slice, i) => (i === index ? { ...slice, [field]: value } : slice)));
  };

  const totalWeight = slices.reduce((sum, slice) => sum + (Number(slice.weight) || 0), 0);
  const selectedCampaign = campaigns.find((c) => c.id === selectedId) || null;

  const buildPayload = () => ({
    name: name.trim(),
    slices: slices.map((slice) => ({
      label: String(slice.label || '').trim(),
      weight: Number(slice.weight) || 0,
      top: Boolean(slice.top),
      type: slice.type || 'text',
      percent: slice.type === 'discount' ? Number(slice.percent) || 0 : undefined,
      gift_sku: slice.type === 'gift' ? String(slice.gift_sku || '').trim().toUpperCase() : undefined,
      gift_sku_2: slice.type === 'gift' ? (String(slice.gift_sku_2 || '').trim().toUpperCase() || undefined) : undefined
    }))
  });

  const save = async () => {
    setSaving(true);
    try {
      const path = selectedId ? `/api/wheel/campaigns/${selectedId}` : '/api/wheel/campaigns';
      const data = await apiRequest(path, { method: selectedId ? 'PUT' : 'POST', token, body: buildPayload() });
      toast.success(selectedId ? 'Campaña guardada' : 'Campaña creada');
      const list = await loadCampaigns();
      const saved = data?.campaign;
      if (saved) {
        setSelectedId(saved.id);
        const fresh = list.find((c) => c.id === saved.id);
        if (fresh) { setName(fresh.name); setSlices(fresh.slices); }
      }
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const activate = async (campaign, makeActive) => {
    setSaving(true);
    try {
      await apiRequest(`/api/wheel/campaigns/${campaign.id}/activate`, {
        method: 'POST', token, body: { active: makeActive }
      });
      toast.success(makeActive ? `"${campaign.name}" ahora está activa` : `"${campaign.name}" desactivada`);
      await loadCampaigns();
    } catch (err) {
      toast.error(err.message || 'No se pudo cambiar la campaña activa');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (campaign) => {
    if (!window.confirm(`¿Eliminar la campaña "${campaign.name}"? Los premios ya ganados se conservan.`)) return;
    setSaving(true);
    try {
      await apiRequest(`/api/wheel/campaigns/${campaign.id}`, { method: 'DELETE', token });
      toast.success('Campaña eliminada');
      const list = await loadCampaigns();
      if (selectedId === campaign.id) {
        if (list.length > 0) selectCampaign(list[0]);
        else startNew();
      }
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar');
    } finally {
      setSaving(false);
    }
  };

  // Test spins use the slices as edited RIGHT NOW (even unsaved) and the same
  // weighted pick the server uses — locally, without creating any spin row.
  const testSlices = useMemo(
    () => slices.filter((slice) => String(slice.label || '').trim()),
    [slices]
  );
  const resolveTestPrize = () => {
    const weights = testSlices.map((slice) => Math.max(0, Number(slice.weight) || 0));
    const total = weights.reduce((sum, w) => sum + w, 0);
    let r = Math.random() * (total || 1);
    let index = 0;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) { index = i; break; }
      index = i;
    }
    const prize = testSlices[index];
    return Promise.resolve({
      prize_label: prize.label,
      prize_index: index,
      is_top_prize: Boolean(prize.top)
    });
  };

  if (loading) return <div className="container"><p>Cargando ruleta…</p></div>;

  return (
    <div className="container ruleta-admin">
      <h2 className="ruleta-admin-title">🎡 Ruleta de premios</h2>
      <p className="ruleta-admin-hint">
        Guarda varias campañas y elige cuál está activa. Ventas genera un enlace por cliente desde Cotizar;
        el cliente gira <strong>una sola vez por campaña</strong> y el premio se aplica solo al cotizarle.
      </p>
      {error && <div className="ruleta-admin-error">{error}</div>}

      <div className="card ruleta-campaign-list">
        <div className="ruleta-campaign-list-head">
          <h3>Campañas</h3>
          <button type="button" className="btn btn-secondary" onClick={startNew}>+ Nueva campaña</button>
        </div>
        {campaigns.length === 0 ? (
          <p className="ruleta-empty">Todavía no hay campañas. Crea la primera abajo.</p>
        ) : (
          <table className="ruleta-campaign-table">
            <thead>
              <tr><th>Nombre</th><th>Estado</th><th>Enlaces</th><th>Giros</th><th>Mayores</th><th /></tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.id} className={campaign.id === selectedId ? 'is-selected' : ''}>
                  <td className="ruleta-campaign-name">{campaign.name}</td>
                  <td>
                    {campaign.is_active
                      ? <span className="ruleta-badge-active">● ACTIVA</span>
                      : <span className="ruleta-badge-off">borrador</span>}
                  </td>
                  <td>{campaign.links}</td>
                  <td>{campaign.spins}</td>
                  <td>{campaign.top_prizes}</td>
                  <td className="ruleta-campaign-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => selectCampaign(campaign)}>Editar</button>
                    {campaign.is_active ? (
                      <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => activate(campaign, false)}>Desactivar</button>
                    ) : (
                      <button type="button" className="btn btn-primary" disabled={saving} onClick={() => activate(campaign, true)}>Activar</button>
                    )}
                    <button type="button" className="ruleta-slice-remove" title="Eliminar campaña" disabled={saving} onClick={() => remove(campaign)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="ruleta-admin-layout">
        <div className="card ruleta-admin-editor">
          <div className="ruleta-admin-editor-head">
            <h3>{selectedId ? `Editando: ${selectedCampaign?.name || name}` : 'Nueva campaña'}</h3>
            {selectedCampaign?.is_active && <span className="ruleta-badge-active">● ACTIVA</span>}
          </div>

          <label className="ruleta-name-field">
            Nombre de la campaña
            <input
              type="text"
              maxLength={80}
              value={name}
              placeholder="Ej: Ruleta Día de la Madre"
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <div className="ruleta-slice-head">
            <span>Texto del premio ({slices.length} espacios)</span>
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
                  <>
                    <select
                      className="ruleta-gift-select"
                      value={slice.gift_sku || ''}
                      onChange={(e) => editSlice(i, 'gift_sku', e.target.value)}
                      title="Opción 1 (ej: línea Acero)"
                    >
                      <option value="">Opción 1 del regalo…</option>
                      {products.map((product) => (
                        <option key={product.sku} value={product.sku}>{product.name} ({product.sku})</option>
                      ))}
                    </select>
                    <select
                      className="ruleta-gift-select"
                      value={slice.gift_sku_2 || ''}
                      onChange={(e) => editSlice(i, 'gift_sku_2', e.target.value)}
                      title="Opción 2 opcional (ej: línea Armonía) — el vendedor elige una de las dos"
                    >
                      <option value="">Opción 2 (opcional)…</option>
                      {products.map((product) => (
                        <option key={product.sku} value={product.sku}>{product.name} ({product.sku})</option>
                      ))}
                    </select>
                  </>
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
            <button type="button" className="btn btn-secondary" disabled={testSlices.length < MIN_SLICES} onClick={() => setTestOpen(true)}>
              🎡 Probar ruleta
            </button>
            <button type="button" className="btn btn-primary" disabled={saving || !name.trim()} onClick={save}>
              {saving ? 'Guardando…' : selectedId ? 'Guardar cambios' : 'Crear campaña'}
            </button>
          </div>
        </div>

        <div className="card ruleta-admin-preview">
          <h3>Vista previa</h3>
          <div className="ruleta-preview-stage">
            <div className="wheel-pointer" aria-hidden="true" />
            <WheelSvg slices={testSlices} gradientId="goldShinePreview" className="wheel-svg ruleta-preview-svg" />
          </div>
          <p className="ruleta-preview-note">Así la verá el cliente en su teléfono. Usa “Probar ruleta” para vivir el giro completo.</p>
        </div>
      </div>

      {testOpen && (
        <div className="wheel-page wheel-test-overlay">
          <button type="button" className="wheel-test-close" onClick={() => setTestOpen(false)} aria-label="Cerrar prueba">✕</button>
          <div className="wheel-test-badge">MODO PRUEBA — no gasta giros de clientes</div>
          <div className="wheel-header">
            <h1 className="wheel-title">¡Gira y gana!</h1>
            <p className="wheel-subtitle">Así lo vive el cliente 🍀</p>
          </div>
          <WheelStage
            key={testSlices.map((s) => `${s.label}:${s.weight}`).join('|')}
            slices={testSlices}
            resolvePrize={resolveTestPrize}
            resultNote="(Prueba: en la ruleta real este premio quedaría registrado con el número del cliente.)"
            allowRespin
          />
          <div className="wheel-footer">Probando la campaña “{name || 'sin nombre'}”</div>
        </div>
      )}
    </div>
  );
}
