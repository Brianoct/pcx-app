import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import jsPDF from 'jspdf';
import { apiRequest } from '../apiClient';
import { useOutbox } from '../OutboxProvider';
import QrCode from '../ui/QrCode';

const buildScanUrl = (qrToken) => {
  if (!qrToken) return '';
  const origin = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '';
  return `${origin}#/comprar/scan/${qrToken}`;
};

// ─── Restock QR labels (90×62mm) — bold, can't-miss-it bin labels ────────────

const LABEL_W = 90;
const LABEL_H = 62;

const fitText = (doc, text = '', maxWidth = 0, suffix = '…') => {
  const safe = String(text || '').trim();
  if (!safe) return '';
  if (doc.getTextWidth(safe) <= maxWidth) return safe;
  const suffixW = doc.getTextWidth(suffix);
  let out = safe;
  while (out.length > 0 && (doc.getTextWidth(out) + suffixW) > maxWidth) out = out.slice(0, -1);
  return `${out}${suffix}`;
};

// Draws one label with its top-left corner at (x, y).
const drawMaterialLabel = (doc, x, y, material, qrDataUrl) => {
  // Card outline
  doc.setDrawColor(28, 25, 23);
  doc.setLineWidth(0.4);
  doc.roundedRect(x, y, LABEL_W, LABEL_H, 2, 2);

  // Header band: brand red with an orange base stripe — visible across the room.
  doc.setFillColor(225, 29, 72);
  doc.rect(x + 0.2, y + 0.2, LABEL_W - 0.4, 13, 'F');
  doc.setFillColor(255, 127, 48);
  doc.rect(x + 0.2, y + 13.2, LABEL_W - 0.4, 1.6, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text('¿SE ACABÓ?', x + 5, y + 9.4);
  doc.setFontSize(6.4);
  doc.text('PCX · COMPRAS', x + LABEL_W - 5, y + 5.4, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.text('Escanea y pedimos más', x + LABEL_W - 5, y + 9.6, { align: 'right' });

  // QR block (left) with quiet zone
  const qrSize = 34;
  const qrX = x + 5;
  const qrY = y + 19.5;
  doc.setFillColor(255, 255, 255);
  doc.rect(qrX - 1.5, qrY - 1.5, qrSize + 3, qrSize + 3, 'F');
  doc.setDrawColor(225, 29, 72);
  doc.setLineWidth(0.8);
  doc.roundedRect(qrX - 1.5, qrY - 1.5, qrSize + 3, qrSize + 3, 1.5, 1.5);
  doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

  // Right column: material identity + instruction
  const rightX = x + qrSize + 10.5;
  const rightW = LABEL_W - qrSize - 15.5;
  doc.setTextColor(28, 25, 23);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  const nameLines = doc.splitTextToSize(String(material.name || '').trim(), rightW).slice(0, 2);
  nameLines.forEach((line, i) => doc.text(fitText(doc, line, rightW), rightX, y + 23.5 + i * 5.1));

  // Code chip
  const chipY = y + 23.5 + nameLines.length * 5.1 + 1.2;
  doc.setFont('courier', 'bold');
  doc.setFontSize(9.5);
  const codeText = String(material.code || '').toUpperCase();
  const chipW = Math.min(rightW, doc.getTextWidth(codeText) + 6);
  doc.setFillColor(245, 241, 236);
  doc.setDrawColor(214, 204, 192);
  doc.setLineWidth(0.25);
  doc.roundedRect(rightX, chipY, chipW, 6.4, 1.2, 1.2, 'FD');
  doc.setTextColor(28, 25, 23);
  doc.text(codeText, rightX + 3, chipY + 4.5);
  if (material.unit_measure) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(120, 113, 108);
    doc.text(String(material.unit_measure), rightX + chipW + 3, chipY + 4.5);
  }

  // Instruction
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(87, 83, 78);
  const instr = doc.splitTextToSize('Apunta la cámara de tu celular al código y el material entra solo a la lista de compras.', rightW);
  instr.slice(0, 3).forEach((line, i) => doc.text(line, rightX, chipY + 11 + i * 3.4));

  // Footer strip
  doc.setFillColor(255, 127, 48);
  doc.rect(x + 0.2, y + LABEL_H - 2.6, LABEL_W - 0.4, 2.4, 'F');
  doc.setTextColor(28, 25, 23);
};

const generateQrDataUrl = (url) => QRCode.toDataURL(url, { width: 512, margin: 0, errorCorrectionLevel: 'M' });

function MaterialsCatalogAdmin({ token }) {
  const { enqueueWrite } = useOutbox();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [qrMaterial, setQrMaterial] = useState(null);
  const [newRow, setNewRow] = useState({
    code: '',
    name: '',
    unit_measure: '',
    unit_cost_bs: '',
    waste_pct: '',
    reorder_qty: '',
    supplier: '',
    notes: ''
  });

  const loadRows = async () => {
    setLoading(true);
    setMessage('');
    try {
      const data = await apiRequest('/api/admin/materiales?include_inactive=1', { token });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const onRowField = (id, field, value) => {
    setRows((prev) => prev.map((row) => (
      row.id === id ? { ...row, [field]: value } : row
    )));
    setMessage('');
  };

  const buildPayload = (input = {}) => {
    const payload = {
      code: String(input.code || '').toUpperCase().trim(),
      name: String(input.name || '').trim(),
      unit_measure: String(input.unit_measure || '').trim(),
      unit_cost_bs: Number(input.unit_cost_bs || 0),
      waste_pct: Number(input.waste_pct || 0),
      reorder_qty: Number(input.reorder_qty || 0),
      supplier: String(input.supplier || '').trim() || null,
      notes: String(input.notes || '').trim() || null
    };
    if (!payload.code || !payload.name || !payload.unit_measure) {
      throw new Error('Código, nombre y unidad son requeridos');
    }
    if (!Number.isFinite(payload.unit_cost_bs) || payload.unit_cost_bs < 0) {
      throw new Error('Costo unitario inválido');
    }
    if (!Number.isFinite(payload.waste_pct) || payload.waste_pct < 0 || payload.waste_pct > 100) {
      throw new Error('Merma % inválida (0-100)');
    }
    if (!Number.isFinite(payload.reorder_qty) || payload.reorder_qty < 0) {
      throw new Error('Cantidad de reposición inválida');
    }
    return payload;
  };

  // One label per PDF page (90×62mm) — for sticker/label printers.
  const printLabel = async (row) => {
    try {
      const qrDataUrl = await generateQrDataUrl(buildScanUrl(row.qr_token));
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [LABEL_W, LABEL_H] });
      drawMaterialLabel(doc, 0, 0, row, qrDataUrl);
      doc.save(`qr_${String(row.code || 'material').toLowerCase()}.pdf`);
    } catch {
      setMessage('Error: no se pudo generar la etiqueta QR');
    }
  };

  // All active materials on A4 sheets, 8 labels per page (2×4), ready to cut.
  const printAllLabels = async () => {
    const printable = rows.filter((row) => row.is_active && row.qr_token);
    if (printable.length === 0) {
      setMessage('Error: no hay materiales activos con QR para imprimir');
      return;
    }
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const cols = 2;
      const rowsPerPage = 4;
      const x0 = 10;
      const y0 = 12;
      const gapX = 8;
      const gapY = 8;
      for (let i = 0; i < printable.length; i++) {
        const slot = i % (cols * rowsPerPage);
        if (i > 0 && slot === 0) doc.addPage('a4', 'portrait');
        const col = slot % cols;
        const rowIdx = Math.floor(slot / cols);
        const qrDataUrl = await generateQrDataUrl(buildScanUrl(printable[i].qr_token));
        drawMaterialLabel(doc, x0 + col * (LABEL_W + gapX), y0 + rowIdx * (LABEL_H + gapY), printable[i], qrDataUrl);
      }
      doc.save('qr_materiales_pcx.pdf');
    } catch {
      setMessage('Error: no se pudieron generar las etiquetas QR');
    }
  };

  const createRow = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const payload = buildPayload(newRow);
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Crear material ${payload.code}`,
          path: '/api/admin/materiales',
          options: {
            method: 'POST',
            body: payload,
            retries: 0
          },
          meta: { code: payload.code, name: payload.name }
        });
        setRows((prev) => [...prev, { ...payload, id: Date.now(), is_active: true }]);
        setMessage('Sin conexión: material en cola para sincronizar.');
      } else {
        await apiRequest('/api/admin/materiales', {
          method: 'POST',
          token,
          body: payload
        });
        setMessage('Material agregado.');
        await loadRows();
      }
      setNewRow({
        code: '',
        name: '',
        unit_measure: '',
        unit_cost_bs: '',
        waste_pct: '',
        reorder_qty: '',
        supplier: '',
        notes: ''
      });
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveRow = async (row) => {
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        ...buildPayload(row),
        is_active: Boolean(row.is_active)
      };
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Editar material #${row.id}`,
          path: `/api/admin/materiales/${row.id}`,
          options: {
            method: 'PATCH',
            body: payload,
            retries: 0
          },
          meta: { id: row.id, code: payload.code }
        });
        setMessage(`Sin conexión: cambios de ${payload.code} en cola para sincronizar.`);
      } else {
        await apiRequest(`/api/admin/materiales/${row.id}`, {
          method: 'PATCH',
          token,
          body: payload
        });
        setMessage(`Material ${payload.code} actualizado.`);
        await loadRows();
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const deactivateRow = async (row) => {
    if (!window.confirm(`¿Desactivar material ${row.code}?`)) return;
    setSaving(true);
    setMessage('');
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Desactivar material ${row.code}`,
          path: `/api/admin/materiales/${row.id}`,
          options: {
            method: 'DELETE',
            retries: 0
          },
          meta: { id: row.id, code: row.code }
        });
        setRows((prev) => prev.map((item) => (
          item.id === row.id ? { ...item, is_active: false } : item
        )));
        setMessage(`Sin conexión: desactivación de ${row.code} en cola para sincronizar.`);
      } else {
        await apiRequest(`/api/admin/materiales/${row.id}`, {
          method: 'DELETE',
          token
        });
        setMessage(`Material ${row.code} desactivado.`);
        await loadRows();
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div className="card">
        <h3 style={{ marginBottom: '12px' }}>Materiales</h3>
        <form onSubmit={createRow} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
          <input
            placeholder="Código"
            value={newRow.code}
            onChange={(e) => setNewRow((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
            className="form-input form-input--inline"
          />
          <input
            placeholder="Nombre"
            value={newRow.name}
            onChange={(e) => setNewRow((prev) => ({ ...prev, name: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            placeholder="Unidad (kg, m2, unidad...)"
            value={newRow.unit_measure}
            onChange={(e) => setNewRow((prev) => ({ ...prev, unit_measure: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Costo unitario (Bs)"
            value={newRow.unit_cost_bs}
            onChange={(e) => setNewRow((prev) => ({ ...prev, unit_cost_bs: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            placeholder="Merma %"
            value={newRow.waste_pct}
            onChange={(e) => setNewRow((prev) => ({ ...prev, waste_pct: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Reposición (cant. a comprar)"
            value={newRow.reorder_qty}
            onChange={(e) => setNewRow((prev) => ({ ...prev, reorder_qty: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            placeholder="Proveedor (opcional)"
            value={newRow.supplier}
            onChange={(e) => setNewRow((prev) => ({ ...prev, supplier: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            placeholder="Notas (opcional)"
            value={newRow.notes}
            onChange={(e) => setNewRow((prev) => ({ ...prev, notes: e.target.value }))}
            className="form-input form-input--inline"
          />
          <button
            type="submit"
            disabled={saving}
            style={{ border: 'none', borderRadius: '8px', background: '#3b82f6', color: 'white', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Guardando...' : 'Agregar material'}
          </button>
        </form>
      </div>

      {message && (
        <div style={{
          padding: '10px 12px',
          borderRadius: '8px',
          background: message.startsWith('Error') ? 'rgba(254,226,226,0.35)' : 'rgba(6,78,59,0.35)',
          border: message.startsWith('Error') ? '1px solid #ef4444' : '1px solid #047857',
          color: message.startsWith('Error') ? '#b91c1c' : '#047857'
        }}>
          {message}
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <h3 style={{ margin: 0 }}>Catálogo de materiales</h3>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={printAllLabels}
            disabled={loading}
            title="Genera un PDF A4 con las etiquetas QR de todos los materiales activos (8 por hoja, listas para recortar)"
          >
            Imprimir etiquetas QR (A4)
          </button>
        </div>
        {loading ? (
          <p style={{ color: '#78716c' }}>Cargando materiales...</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: '980px' }}>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Unidad</th>
                  <th style={{ textAlign: 'right' }}>Costo unitario (Bs)</th>
                  <th style={{ textAlign: 'right' }}>Merma %</th>
                  <th style={{ textAlign: 'right' }}>Reposición</th>
                  <th>Proveedor</th>
                  <th>Notas</th>
                  <th>Activo</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={10} style={{ textAlign: 'center', color: '#78716c' }}>Sin materiales</td></tr>
                ) : rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        value={row.code || ''}
                        onChange={(e) => onRowField(row.id, 'code', e.target.value.toUpperCase())}
                        className="form-input" style={{ width: 120 }}
                      />
                    </td>
                    <td>
                      <input
                        value={row.name || ''}
                        onChange={(e) => onRowField(row.id, 'name', e.target.value)}
                        className="form-input" style={{ minWidth: 180 }}
                      />
                    </td>
                    <td>
                      <input
                        value={row.unit_measure || ''}
                        onChange={(e) => onRowField(row.id, 'unit_measure', e.target.value)}
                        className="form-input" style={{ width: 130 }}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={Number(row.unit_cost_bs || 0)}
                        onChange={(e) => onRowField(row.id, 'unit_cost_bs', e.target.value)}
                        className="form-input" style={{ width: 120, textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={Number(row.waste_pct || 0)}
                        onChange={(e) => onRowField(row.id, 'waste_pct', e.target.value)}
                        className="form-input" style={{ width: 100, textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={Number(row.reorder_qty || 0)}
                        onChange={(e) => onRowField(row.id, 'reorder_qty', e.target.value)}
                        className="form-input" style={{ width: 100, textAlign: 'right' }}
                      />
                    </td>
                    <td>
                      <input
                        value={row.supplier || ''}
                        onChange={(e) => onRowField(row.id, 'supplier', e.target.value)}
                        className="form-input" style={{ minWidth: 140 }}
                      />
                    </td>
                    <td>
                      <input
                        value={row.notes || ''}
                        onChange={(e) => onRowField(row.id, 'notes', e.target.value)}
                        className="form-input" style={{ minWidth: 160 }}
                      />
                    </td>
                    <td>
                      <label className="form-check-inline">
                        <input
                          type="checkbox"
                          checked={Boolean(row.is_active)}
                          onChange={(e) => onRowField(row.id, 'is_active', e.target.checked)}
                        />
                        {row.is_active ? 'Sí' : 'No'}
                      </label>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => saveRow(row)}
                          disabled={saving}
                          style={{ padding: '8px 10px', borderRadius: '8px', border: 'none', background: '#3b82f6', color: 'white', cursor: saving ? 'not-allowed' : 'pointer' }}
                        >
                          Guardar
                        </button>
                        <button
                          onClick={() => setQrMaterial(row)}
                          disabled={!row.qr_token}
                          title={row.qr_token ? 'Ver código QR' : 'Guarda el material para generar su QR'}
                          style={{ padding: '8px 10px', borderRadius: '8px', border: 'none', background: '#0f766e', color: 'white', cursor: row.qr_token ? 'pointer' : 'not-allowed' }}
                        >
                          QR
                        </button>
                        <button
                          onClick={() => deactivateRow(row)}
                          disabled={saving || !row.is_active}
                          style={{ padding: '8px 10px', borderRadius: '8px', border: 'none', background: '#ef4444', color: 'white', cursor: saving ? 'not-allowed' : 'pointer' }}
                        >
                          Desactivar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {qrMaterial && (
        <div className="compras-modal-overlay" onClick={() => setQrMaterial(null)}>
          <div className="compras-modal card" style={{ maxWidth: 380, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <div className="compras-modal-header">
              <h3 style={{ margin: 0 }}>QR de reposición</h3>
              <button type="button" className="compras-modal-close" onClick={() => setQrMaterial(null)} aria-label="Cerrar">×</button>
            </div>
            <div style={{ fontWeight: 700 }}>{qrMaterial.name}</div>
            <div style={{ color: '#78716c', marginBottom: 12 }}>{qrMaterial.code}{qrMaterial.unit_measure ? ` · ${qrMaterial.unit_measure}` : ''}</div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <QrCode value={buildScanUrl(qrMaterial.qr_token)} size={220} alt={`QR ${qrMaterial.code}`} />
            </div>
            <p style={{ color: '#a8a29e', fontSize: '0.78rem', wordBreak: 'break-all', marginBottom: 12 }}>
              {buildScanUrl(qrMaterial.qr_token)}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button type="button" className="btn btn-primary" onClick={() => printLabel(qrMaterial)}>Imprimir etiqueta</button>
              <button type="button" className="btn" onClick={() => setQrMaterial(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MaterialsCatalogAdmin;
