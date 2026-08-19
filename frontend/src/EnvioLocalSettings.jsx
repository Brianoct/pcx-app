// Configuración del envío local (Almacén): por ciudad, el punto GPS del
// almacén y los anillos de distancia con su precio. Cotizar y el chat de
// WhatsApp usan esto para cotizar el delivery desde la ubicación del cliente.
// La distancia es en línea recta: los anillos se calibran sabiendo eso.
import { useEffect, useState } from 'react';
import { apiRequest } from './apiClient';
import { useToast } from './ui/toastContext';
import { looksLikeMapsLink, parseGpsInput } from './gps';

function CityEditor({ city, token, onSaved }) {
  const toast = useToast();
  const [originText, setOriginText] = useState(
    city.origin_lat !== null && city.origin_lng !== null ? `${city.origin_lat}, ${city.origin_lng}` : ''
  );
  const [rings, setRings] = useState(
    (city.rings || []).map((r) => ({ max_km: String(r.max_km), price_bs: String(r.price_bs) }))
  );
  const [active, setActive] = useState(Boolean(city.active));
  const [saving, setSaving] = useState(false);

  const addRing = () => setRings((prev) => [...prev, { max_km: '', price_bs: '' }]);
  const removeRing = (index) => setRings((prev) => prev.filter((_, i) => i !== index));
  const patchRing = (index, field, value) => {
    setRings((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const save = async () => {
    const body = { active };
    let gps = parseGpsInput(originText);
    // Link corto (goo.gl/maps/…): el servidor lo expande a coordenadas.
    if (originText.trim() && !gps && looksLikeMapsLink(originText)) {
      try {
        const resolved = await apiRequest('/api/delivery/resolve', {
          method: 'POST',
          token,
          body: { link: originText.trim() }
        });
        if (Number.isFinite(Number(resolved?.lat)) && Number.isFinite(Number(resolved?.lng))) {
          gps = { lat: Number(resolved.lat), lng: Number(resolved.lng) };
          setOriginText(`${gps.lat}, ${gps.lng}`);
        }
      } catch (err) {
        toast.error(err.message || 'No se pudo leer el link de Maps');
        return;
      }
    }
    if (originText.trim() && !gps) {
      toast.error('Punto del almacén inválido: pega "lat, lng" o un link de Google Maps');
      return;
    }
    if (gps) {
      body.origin_lat = gps.lat;
      body.origin_lng = gps.lng;
    }
    const parsedRings = rings
      .filter((r) => String(r.max_km).trim() !== '' || String(r.price_bs).trim() !== '')
      .map((r) => ({ max_km: Number(r.max_km), price_bs: Number(r.price_bs) }));
    body.rings = parsedRings;
    setSaving(true);
    try {
      const data = await apiRequest(`/api/delivery/settings/${encodeURIComponent(city.city)}`, {
        method: 'PATCH',
        token,
        body
      });
      toast.success(`Envío local de ${city.city} guardado`);
      onSaved(data.cities || null);
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="els-city">
      <div className="els-city-head">
        <strong>{city.city}</strong>
        <label className="els-active">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Activo
        </label>
      </div>
      <label className="els-field">
        <span>Punto del almacén (pega «lat, lng» o link de Google Maps)</span>
        <input
          type="text"
          value={originText}
          placeholder="-17.393, -66.157"
          onChange={(e) => setOriginText(e.target.value)}
        />
      </label>
      <div className="els-rings">
        <span className="els-rings-title">Anillos de precio (distancia en línea recta)</span>
        {rings.map((ring, index) => (
          <div key={index} className="els-ring-row">
            <span>hasta</span>
            <input
              type="number" min="0.5" step="0.5" value={ring.max_km}
              onChange={(e) => patchRing(index, 'max_km', e.target.value)}
            />
            <span>km →</span>
            <input
              type="number" min="0" step="1" value={ring.price_bs}
              onChange={(e) => patchRing(index, 'price_bs', e.target.value)}
            />
            <span>Bs</span>
            <button type="button" className="els-ring-remove" onClick={() => removeRing(index)} title="Quitar anillo">✕</button>
          </div>
        ))}
        <button type="button" className="btn btn-secondary els-add" onClick={addRing}>+ Agregar anillo</button>
        <p className="els-note">Más allá del último anillo: fuera de cobertura (se cotiza manual).</p>
      </div>
      <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
        {saving ? 'Guardando…' : `Guardar ${city.city}`}
      </button>
    </div>
  );
}

export default function EnvioLocalSettings({ token }) {
  const [cities, setCities] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let activeFlag = true;
    apiRequest('/api/delivery/settings', { token })
      .then((data) => { if (activeFlag) setCities(Array.isArray(data?.cities) ? data.cities : []); })
      .catch(() => { if (activeFlag) setCities([]); });
    return () => { activeFlag = false; };
  }, [token]);

  if (cities === null) return null;

  return (
    <section className="card els-card">
      <button type="button" className="els-toggle" onClick={() => setOpen((prev) => !prev)}>
        <span>🛵 Envío local — precios por zona</span>
        <span className="els-toggle-sub">
          {open ? 'Cerrar' : 'Configurar los anillos de precio que usa Ventas al cotizar delivery'}
        </span>
      </button>
      {open && (
        <div className="els-body">
          {cities.map((city) => (
            <CityEditor
              key={`${city.city}-${city.updated_at || ''}`}
              city={city}
              token={token}
              onSaved={(next) => { if (next) setCities(next); }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
