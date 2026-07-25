import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../apiClient';

// Panel Admin "Destinos": estado de clasificación de destinos de envío,
// reclasificación automática contra el catálogo y asignación manual de los
// textos libres que quedaron sin match (con alias opcional para el buscador).
function GeoDestinosAdmin({ token }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  // Estado por fila de la lista sin match, indexado por el texto libre.
  const [assign, setAssign] = useState({});
  const searchTimers = useRef({});

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest('/api/admin/geo/summary', { token, timeoutMs: 30000 });
      setSummary(data);
    } catch (err) {
      setError(err.message || 'No se pudo cargar el resumen');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const runBackfill = async () => {
    setRunning(true);
    setMessage(null);
    setError(null);
    try {
      const result = await apiRequest('/api/admin/geo/backfill', { token, method: 'POST', timeoutMs: 60000 });
      setMessage(
        `Reclasificación completada: ${result.updatedFull} cotizaciones clasificadas al municipio` +
        (result.updatedProvincia ? ` y ${result.updatedProvincia} corregidas a nivel provincia.` : '.')
      );
      await loadSummary();
    } catch (err) {
      setError(err.message || 'No se pudo ejecutar la reclasificación');
    } finally {
      setRunning(false);
    }
  };

  const rowState = (text) => assign[text] || { query: '', results: [], selected: null, saveAlias: true, busy: false };

  const patchRow = (text, patch) => {
    setAssign((prev) => ({ ...prev, [text]: { ...rowState(text), ...prev[text], ...patch } }));
  };

  const onQueryChange = (text, query) => {
    patchRow(text, { query, selected: null });
    clearTimeout(searchTimers.current[text]);
    if (query.trim().length < 2) {
      patchRow(text, { results: [] });
      return;
    }
    searchTimers.current[text] = setTimeout(async () => {
      try {
        const data = await apiRequest(`/api/geo/search?q=${encodeURIComponent(query.trim())}`, { token });
        patchRow(text, { results: data.results || [] });
      } catch {
        patchRow(text, { results: [] });
      }
    }, 250);
  };

  const assignText = async (text) => {
    const row = rowState(text);
    if (!row.selected) return;
    patchRow(text, { busy: true });
    setMessage(null);
    setError(null);
    try {
      const result = await apiRequest('/api/admin/geo/assign', {
        token,
        method: 'POST',
        body: { text, dest_geo_id: row.selected.id, save_alias: row.saveAlias }
      });
      setMessage(
        `"${text}" → ${result.geo.municipio} (${result.geo.departamento}): ${result.updated} cotizaciones actualizadas` +
        (result.aliasSaved ? '. Alias guardado para el buscador.' : '.')
      );
      setAssign((prev) => {
        const next = { ...prev };
        delete next[text];
        return next;
      });
      await loadSummary();
    } catch (err) {
      setError(err.message || 'No se pudo asignar el destino');
      patchRow(text, { busy: false });
    }
  };

  if (loading && !summary) {
    return <p className="geo-admin-status">Cargando estado de destinos…</p>;
  }

  const counts = summary?.counts || {};
  const unmatched = summary?.unmatched || [];
  const autoTotal = (summary?.autoFull || 0) + (summary?.autoProvincia || 0);

  return (
    <div className="geo-admin">
      <div className="geo-admin-head">
        <div>
          <h3>Destinos de envío</h3>
          <p className="geo-admin-sub">
            Clasificación de cotizaciones contra el catálogo oficial (departamento → provincia → municipio).
            Las nuevas cotizaciones ya se clasifican solas; aquí se ordena el historial.
          </p>
        </div>
        <button type="button" className="geo-admin-refresh" onClick={loadSummary} disabled={loading}>
          {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      {error && <p className="geo-admin-alert geo-admin-alert-error">{error}</p>}
      {message && <p className="geo-admin-alert geo-admin-alert-ok">{message}</p>}

      <div className="geo-admin-cards">
        <div className="geo-admin-card">
          <strong>{counts.total ?? '—'}</strong>
          <span>Cotizaciones totales</span>
        </div>
        <div className="geo-admin-card geo-admin-card-ok">
          <strong>{counts.clasificado ?? '—'}</strong>
          <span>Con municipio del catálogo</span>
        </div>
        <div className="geo-admin-card geo-admin-card-warn">
          <strong>{counts.pendiente ?? '—'}</strong>
          <span>Pendientes con texto libre</span>
        </div>
        <div className="geo-admin-card">
          <strong>{counts.solo_departamento ?? '—'}</strong>
          <span>Solo departamento</span>
        </div>
        <div className="geo-admin-card">
          <strong>{counts.sin_destino ?? '—'}</strong>
          <span>Sin destino registrado</span>
        </div>
      </div>

      <div className="geo-admin-run">
        <div>
          <strong>Reclasificación automática</strong>
          <p>
            {autoTotal > 0
              ? `Puede resolver ${summary.autoFull} cotizaciones con municipio exacto` +
                (summary.autoProvincia ? ` y corregir ${summary.autoProvincia} a nivel provincia.` : '.')
              : 'No hay cotizaciones que se puedan reclasificar automáticamente ahora.'}
          </p>
        </div>
        <button
          type="button"
          className="geo-admin-run-btn"
          onClick={runBackfill}
          disabled={running || autoTotal === 0}
        >
          {running ? 'Ejecutando…' : 'Ejecutar reclasificación'}
        </button>
      </div>

      <div className="geo-admin-unmatched">
        <h4>Textos sin clasificar {unmatched.length > 0 && <span className="geo-admin-count">{unmatched.length}</span>}</h4>
        {unmatched.length === 0 ? (
          <p className="geo-admin-status">🎉 No quedan textos de destino sin clasificar.</p>
        ) : (
          <ul className="geo-admin-list">
            {unmatched.map((item) => {
              const row = rowState(item.text);
              return (
                <li key={item.text} className="geo-admin-item">
                  <div className="geo-admin-item-head">
                    <strong>“{item.text}”</strong>
                    <span className="geo-admin-count">{item.count} {item.count === 1 ? 'cotización' : 'cotizaciones'}</span>
                  </div>
                  {item.hint && <p className="geo-admin-hint">{item.hint}</p>}
                  <div className="geo-admin-assign">
                    {row.selected ? (
                      <span className="geo-admin-chip">
                        📍 {row.selected.municipio} · Prov. {row.selected.provincia} · {row.selected.departamento}
                        <button
                          type="button"
                          aria-label="Quitar selección"
                          onClick={() => patchRow(item.text, { selected: null, query: '', results: [] })}
                        >✕</button>
                      </span>
                    ) : (
                      <div className="geo-admin-search">
                        <input
                          type="text"
                          value={row.query}
                          placeholder="Buscar municipio correcto…"
                          onChange={(e) => onQueryChange(item.text, e.target.value)}
                        />
                        {row.results.length > 0 && (
                          <ul className="geo-admin-results">
                            {row.results.map((r) => (
                              <li key={r.id}>
                                <button
                                  type="button"
                                  onClick={() => patchRow(item.text, { selected: r, results: [] })}
                                >
                                  <strong>{r.municipio}</strong> <small>{r.provincia} · {r.departamento}</small>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    <label className="geo-admin-alias">
                      <input
                        type="checkbox"
                        checked={row.saveAlias}
                        onChange={(e) => patchRow(item.text, { saveAlias: e.target.checked })}
                      />
                      Guardar “{item.text}” como alias
                    </label>
                    <button
                      type="button"
                      className="geo-admin-assign-btn"
                      disabled={!row.selected || row.busy}
                      onClick={() => assignText(item.text)}
                    >
                      {row.busy ? 'Asignando…' : 'Asignar'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default GeoDestinosAdmin;
