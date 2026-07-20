import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../apiClient';
import { useToast } from '../ui/toastContext';

// Convocatorias: el admin publica los puestos que aparecen en la página
// pública "Trabaja con nosotros" (/#/carreras, enlazada desde Contacto).

const EMPLOYMENT_TYPES = ['Tiempo completo', 'Medio tiempo', 'Por proyecto', 'Prácticas'];
const AREAS = ['Producción', 'Ventas', 'Almacén', 'Marketing', 'Administración'];
const LOCATIONS = ['Cochabamba', 'Santa Cruz', 'Lima'];

const emptyForm = () => ({
  id: null, title: '', area: '', location: '', employment_type: 'Tiempo completo', description: '', requirements: ''
});

export default function CareersAdmin({ token }) {
  const toast = useToast();
  const [postings, setPostings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    apiRequest('/api/admin/careers', { token })
      .then((data) => setPostings(Array.isArray(data?.postings) ? data.postings : []))
      .catch((err) => toast.error(err.message || 'No se pudieron cargar las convocatorias'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form?.title.trim() || saving) return;
    setSaving(true);
    try {
      if (form.id) {
        await apiRequest(`/api/admin/careers/${form.id}`, { method: 'PUT', token, body: form });
        toast.success('Convocatoria actualizada');
      } else {
        await apiRequest('/api/admin/careers', { method: 'POST', token, body: form });
        toast.success('Convocatoria publicada — ya se ve en la página pública');
      }
      setForm(null);
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (posting) => {
    try {
      await apiRequest(`/api/admin/careers/${posting.id}/active`, {
        method: 'PATCH', token, body: { is_active: !posting.is_active }
      });
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo cambiar el estado');
    }
  };

  const remove = async (posting) => {
    if (!window.confirm(`¿Eliminar la convocatoria "${posting.title}"?`)) return;
    try {
      await apiRequest(`/api/admin/careers/${posting.id}`, { method: 'DELETE', token });
      toast.success('Convocatoria eliminada');
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar');
    }
  };

  if (loading) return <p className="dashboard-muted">Cargando convocatorias…</p>;

  if (form) {
    return (
      <div className="card careers-form">
        <h3>{form.id ? 'Editar convocatoria' : 'Nueva convocatoria'}</h3>
        <div className="careers-form-grid">
          <label className="camp-field camp-field-wide">
            <span>Título del puesto</span>
            <input
              type="text" maxLength={120} value={form.title}
              placeholder="Ej: Operario de producción"
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label className="camp-field">
            <span>Área</span>
            <select value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}>
              <option value="">— Sin área —</option>
              {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="camp-field">
            <span>Sede</span>
            <select value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}>
              <option value="">— Sin sede —</option>
              {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label className="camp-field">
            <span>Tipo</span>
            <select value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })}>
              {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="camp-field camp-field-wide">
            <span>Descripción del puesto</span>
            <textarea
              rows={4} maxLength={4000} value={form.description}
              placeholder="Qué hará la persona, horario, qué ofrecemos…"
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          <label className="camp-field camp-field-wide">
            <span>Requisitos (uno por línea)</span>
            <textarea
              rows={4} maxLength={4000} value={form.requirements}
              placeholder={'Experiencia en carpintería o metalmecánica\nGanas de aprender\nVivir en Cochabamba'}
              onChange={(e) => setForm({ ...form, requirements: e.target.value })}
            />
          </label>
        </div>
        <div className="camp-form-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setForm(null)} disabled={saving}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !form.title.trim()}>
            {saving ? 'Guardando…' : (form.id ? 'Guardar cambios' : 'Publicar convocatoria')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="careers-admin-head">
        <button type="button" className="btn btn-primary" onClick={() => setForm(emptyForm())}>
          + Nueva convocatoria
        </button>
        <a className="careers-public-link" href="#/carreras" target="_blank" rel="noreferrer">
          Ver página pública ↗
        </a>
      </div>

      {postings.length === 0 && (
        <div className="card camp-empty">No hay convocatorias todavía. Publica la primera.</div>
      )}

      {postings.map((posting) => (
        <div key={posting.id} className={`careers-row ${posting.is_active ? '' : 'is-closed'}`}>
          <div className="careers-row-main">
            <div className="careers-row-title">
              {posting.title}
              <span className={`careers-status ${posting.is_active ? 'is-open' : ''}`}>
                {posting.is_active ? 'Publicada' : 'Cerrada'}
              </span>
            </div>
            <div className="careers-row-meta">
              {[posting.area, posting.location, posting.employment_type].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div className="careers-row-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm({ ...posting })}>Editar</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleActive(posting)}>
              {posting.is_active ? 'Cerrar' : 'Republicar'}
            </button>
            <button type="button" className="camp-delete" title="Eliminar" onClick={() => remove(posting)}>🗑</button>
          </div>
        </div>
      ))}
    </div>
  );
}
