import { useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import { apiRequest, API_BASE } from '../apiClient';
import { useOutbox } from '../OutboxProvider';

// Lista de precios en PDF: SKU, producto y precio FACTURADO de todo el
// catálogo activo, con los precios vigentes del sistema. Pensada para el
// registro de productos en Impuestos (SIAT): lo que dice este PDF es lo que
// imprimen las proformas, así la factura siempre cuadra.
const downloadPriceListPdf = (products) => {
  const rows = products
    .filter((row) => row.is_active)
    .map((row) => ({
      sku: String(row.sku || '').toUpperCase(),
      name: String(row.name || '').trim(),
      cf: Number(row.cf ?? row.cf_price ?? 0)
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
  if (rows.length === 0) return 0;

  const doc = new jsPDF();
  const pageW = 210;
  const pageH = 297;
  const left = 14;
  const right = 196;
  const COL_SKU = left + 4;
  const COL_NAME = left + 38;
  const COL_PRICE = right - 4;
  const NAME_W = COL_PRICE - COL_NAME - 24;
  const dateLabel = new Date().toLocaleDateString('es-BO', { day: 'numeric', month: 'long', year: 'numeric' });

  let page = 1;
  const drawPageChrome = () => {
    doc.setFillColor(225, 29, 72);
    doc.rect(0, 0, pageW, 4, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(28, 25, 23);
    doc.text('Lista de precios — Catálogo PCX', left, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(120, 113, 108);
    doc.text(`Precio facturado (con factura) · ${rows.length} productos activos · generado el ${dateLabel}`, left, 19.5);
    doc.setFontSize(8);
    doc.text(`Página ${page}`, right, 19.5, { align: 'right' });
    // Encabezado de la tabla
    doc.setFillColor(28, 25, 23);
    doc.rect(left, 23, right - left, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text('SKU', COL_SKU, 27.8);
    doc.text('Producto', COL_NAME, 27.8);
    doc.text('Precio CF (Bs)', COL_PRICE, 27.8, { align: 'right' });
    return 30;
  };

  let y = drawPageChrome();
  rows.forEach((row, index) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const nameLines = doc.splitTextToSize(row.name || row.sku, NAME_W);
    const rowH = Math.max(6.4, nameLines.length * 4.4 + 2.4);
    if (y + rowH > pageH - 14) {
      page += 1;
      doc.addPage();
      y = drawPageChrome();
    }
    if (index % 2 === 1) {
      doc.setFillColor(245, 245, 244);
      doc.rect(left, y, right - left, rowH, 'F');
    }
    doc.setTextColor(28, 25, 23);
    doc.setFont('helvetica', 'bold');
    doc.text(row.sku, COL_SKU, y + 4.4);
    doc.setFont('helvetica', 'normal');
    doc.text(nameLines, COL_NAME, y + 4.4, { lineHeightFactor: 1.25 });
    doc.text(row.cf.toFixed(2), COL_PRICE, y + 4.4, { align: 'right' });
    y += rowH;
  });
  doc.setDrawColor(231, 224, 216);
  doc.line(left, y, right, y);

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`lista-precios-pcx-${stamp}.pdf`);
  return rows.length;
};

// Catalog images are relative capability URLs (/api/product-assets/...); the
// <img> tag needs the absolute backend origin.
const resolveImageUrl = (rawUrl = '') => {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${String(API_BASE || '').replace(/\/+$/, '')}${value}`;
  return value;
};

// Downscale on the client so uploads stay tens of KB — the catalog grid shows
// small cards, so 800px is plenty.
const downscaleImage = (file, { maxDim = 800, quality = 0.82 } = {}) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    img.src = String(reader.result || '');
  };
  reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
  reader.readAsDataURL(file);
});

function ProductCatalogAdmin({ token }) {
  const { enqueueWrite } = useOutbox();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [newProduct, setNewProduct] = useState({
    sku: '',
    name: '',
    description: '',
    sf: '',
    cf: '',
    product_line: 'acero',
    product_type: '',
    material: 'metal',
    equipment_ids: [],
    material_ids: [],
    processes: []
  });
  const [productionOptions, setProductionOptions] = useState({
    equipment_options: [],
    material_options: [],
    process_options: []
  });
  const [configModal, setConfigModal] = useState(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [imageBusySku, setImageBusySku] = useState('');
  const [productSearch, setProductSearch] = useState('');
  // Product enrichment CSV round-trip
  const [importCsvText, setImportCsvText] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [updateNames, setUpdateNames] = useState(false);
  const [syncDescription, setSyncDescription] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState('');
  const inactiveProducts = products.filter((row) => !row.is_active);
  const visibleProducts = (() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((row) => (
      String(row.sku || '').toLowerCase().includes(q)
      || String(row.name || '').toLowerCase().includes(q)
    ));
  })();

  const loadProducts = async () => {
    setLoading(true);
    setMessage('');
    try {
      const data = await apiRequest('/api/product-catalog?include_inactive=1', { token });
      setProducts(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadProductionOptions = async () => {
    try {
      const data = await apiRequest('/api/admin/product-production/options', { token });
      setProductionOptions({
        equipment_options: Array.isArray(data?.equipment_options) ? data.equipment_options : [],
        material_options: Array.isArray(data?.material_options) ? data.material_options : [],
        process_options: Array.isArray(data?.process_options) ? data.process_options : []
      });
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  useEffect(() => {
    loadProducts();
    loadProductionOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const onRowField = (sku, field, value) => {
    setProducts((prev) => prev.map((row) => (
      row.sku === sku ? { ...row, [field]: value } : row
    )));
    setMessage('');
  };

  const toggleInArray = (items = [], value) => {
    const set = new Set(Array.isArray(items) ? items : []);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    return [...set];
  };

  const toggleNewProductEquipment = (equipmentId) => {
    setNewProduct((prev) => ({
      ...prev,
      equipment_ids: toggleInArray(prev.equipment_ids, equipmentId)
    }));
  };

  const toggleNewProductMaterial = (materialId) => {
    setNewProduct((prev) => ({
      ...prev,
      material_ids: toggleInArray(prev.material_ids, materialId)
    }));
  };

  const toggleNewProductProcess = (processKey) => {
    setNewProduct((prev) => ({
      ...prev,
      processes: toggleInArray(prev.processes, processKey)
    }));
  };

  const createProduct = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        sku: String(newProduct.sku || '').toUpperCase().trim(),
        name: String(newProduct.name || '').trim(),
        description: String(newProduct.description || '').trim(),
        sf: Number(newProduct.sf || 0),
        cf: Number(newProduct.cf || 0),
        product_line: newProduct.product_line || null,
        product_type: newProduct.product_type || null,
        material: newProduct.material || null,
        equipment_ids: Array.isArray(newProduct.equipment_ids) ? newProduct.equipment_ids : [],
        material_ids: Array.isArray(newProduct.material_ids) ? newProduct.material_ids : [],
        processes: Array.isArray(newProduct.processes) ? newProduct.processes : []
      };
      if (!payload.sku || !payload.name) {
        throw new Error('SKU y nombre son requeridos');
      }
      if (!Number.isFinite(payload.sf) || payload.sf < 0 || !Number.isFinite(payload.cf) || payload.cf < 0) {
        throw new Error('Precios SF/CF inválidos');
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Crear producto ${payload.sku}`,
          path: '/api/product-catalog',
          options: {
            method: 'POST',
            body: payload,
            retries: 0
          },
          meta: { sku: payload.sku, name: payload.name }
        });
        setProducts((prev) => [...prev, {
          sku: payload.sku,
          name: payload.name,
          sf: payload.sf,
          cf: payload.cf,
          is_active: true
        }]);
        setMessage('Sin conexión: producto en cola para sincronizar.');
      } else {
        await apiRequest('/api/product-catalog', {
          method: 'POST',
          token,
          body: payload
        });
        setMessage('Producto agregado.');
      }
      setNewProduct({
        sku: '',
        name: '',
        description: '',
        sf: '',
        cf: '',
        product_line: 'acero',
        product_type: '',
        material: 'metal',
        equipment_ids: [],
        material_ids: [],
        processes: []
      });
      if (typeof navigator !== 'undefined' && navigator.onLine !== false) {
        await loadProducts();
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const saveProduct = async (row) => {
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        name: String(row.name || '').trim(),
        description: String(row.description || '').trim(),
        sf: Number(row.sf ?? row.sf_price ?? 0),
        cf: Number(row.cf ?? row.cf_price ?? 0),
        is_active: Boolean(row.is_active),
        product_line: row.product_line || null,
        product_type: row.product_type || null,
        material: row.material || null
      };
      if (!payload.name) throw new Error('Nombre requerido');
      if (!Number.isFinite(payload.sf) || payload.sf < 0 || !Number.isFinite(payload.cf) || payload.cf < 0) {
        throw new Error('Precios SF/CF inválidos');
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Editar producto ${row.sku}`,
          path: `/api/product-catalog/${encodeURIComponent(row.sku)}`,
          options: {
            method: 'PATCH',
            body: payload,
            retries: 0
          },
          meta: { sku: row.sku }
        });
        setProducts((prev) => prev.map((item) => (
          item.sku === row.sku ? { ...item, ...payload } : item
        )));
        setMessage(`Sin conexión: cambios de ${row.sku} en cola para sincronizar.`);
      } else {
        await apiRequest(`/api/product-catalog/${encodeURIComponent(row.sku)}`, {
          method: 'PATCH',
          token,
          body: payload
        });
        setMessage(`Producto ${row.sku} actualizado.`);
        await loadProducts();
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (row) => {
    if (!window.confirm(`¿Desactivar producto ${row.sku}?`)) return;
    setSaving(true);
    setMessage('');
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Desactivar producto ${row.sku}`,
          path: `/api/product-catalog/${encodeURIComponent(row.sku)}`,
          options: {
            method: 'DELETE',
            retries: 0
          },
          meta: { sku: row.sku }
        });
        setProducts((prev) => prev.map((item) => (
          item.sku === row.sku ? { ...item, is_active: false } : item
        )));
        setMessage(`Sin conexión: desactivación de ${row.sku} en cola para sincronizar.`);
      } else {
        await apiRequest(`/api/product-catalog/${encodeURIComponent(row.sku)}`, {
          method: 'DELETE',
          token
        });
        setMessage(`Producto ${row.sku} desactivado.`);
        await loadProducts();
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const uploadProductImage = async (row, file) => {
    if (!file) return;
    setImageBusySku(row.sku);
    setMessage('');
    try {
      const dataUrl = await downscaleImage(file);
      const res = await apiRequest(`/api/product-catalog/${encodeURIComponent(row.sku)}/image`, {
        method: 'POST',
        token,
        body: { data_url: dataUrl },
        timeoutMs: 30000,
        retries: 0
      });
      setProducts((prev) => prev.map((item) => (
        item.sku === row.sku ? { ...item, image_url: res.image_url } : item
      )));
      setMessage(`Imagen de ${row.sku} actualizada.`);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setImageBusySku('');
    }
  };

  const removeProductImage = async (row) => {
    if (!window.confirm(`¿Quitar la imagen de ${row.sku}?`)) return;
    setImageBusySku(row.sku);
    setMessage('');
    try {
      await apiRequest(`/api/product-catalog/${encodeURIComponent(row.sku)}/image`, {
        method: 'DELETE',
        token,
        retries: 0
      });
      setProducts((prev) => prev.map((item) => (
        item.sku === row.sku ? { ...item, image_url: null } : item
      )));
      setMessage(`Imagen de ${row.sku} eliminada.`);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setImageBusySku('');
    }
  };

  const openProductionConfig = async (row) => {
    if (!row?.sku) return;
    setConfigLoading(true);
    setMessage('');
    setConfigModal({
      sku: row.sku,
      equipment_ids: [],
      material_ids: [],
      processes: []
    });
    try {
      const payload = await apiRequest(`/api/admin/product-production/${encodeURIComponent(row.sku)}`, { token });
      setConfigModal({
        sku: row.sku,
        equipment_ids: Array.isArray(payload?.equipment_ids) ? payload.equipment_ids : [],
        material_ids: Array.isArray(payload?.material_ids) ? payload.material_ids : [],
        processes: Array.isArray(payload?.processes) ? payload.processes : []
      });
    } catch (err) {
      setMessage(`Error: ${err.message}`);
      setConfigModal(null);
    } finally {
      setConfigLoading(false);
    }
  };

  const updateConfigSelection = (field, value) => {
    setConfigModal((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [field]: toggleInArray(prev[field] || [], value)
      };
    });
  };

  const saveProductionConfig = async () => {
    if (!configModal?.sku) return;
    setConfigSaving(true);
    setMessage('');
    try {
      const payload = {
        equipment_ids: Array.isArray(configModal.equipment_ids) ? configModal.equipment_ids : [],
        material_ids: Array.isArray(configModal.material_ids) ? configModal.material_ids : [],
        processes: Array.isArray(configModal.processes) ? configModal.processes : []
      };
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Configuración producción ${configModal.sku}`,
          path: `/api/admin/product-production/${encodeURIComponent(configModal.sku)}`,
          options: {
            method: 'PUT',
            body: payload,
            retries: 0
          },
          meta: { sku: configModal.sku }
        });
        setMessage(`Sin conexión: configuración de ${configModal.sku} en cola para sincronizar.`);
      } else {
        await apiRequest(`/api/admin/product-production/${encodeURIComponent(configModal.sku)}`, {
          method: 'PUT',
          token,
          body: payload
        });
        setMessage(`Configuración de producción guardada para ${configModal.sku}.`);
      }
      setConfigModal(null);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setConfigSaving(false);
    }
  };

  const downloadEnrichmentCsv = async () => {
    setEnrichMsg('');
    try {
      const csv = await apiRequest('/api/product-catalog/export', { token, timeoutMs: 30000 });
      const blob = new Blob([typeof csv === 'string' ? csv : ''], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'products-enrichment.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setEnrichMsg(`Error al descargar: ${err.message}`);
    }
  };

  const previewImport = async (text, useUpdateNames = updateNames) => {
    setImportBusy(true);
    setEnrichMsg('');
    setImportPreview(null);
    try {
      const res = await apiRequest('/api/product-catalog/import', {
        method: 'POST',
        token,
        body: { csv: text, commit: false, update_names: useUpdateNames, sync_description: syncDescription },
        timeoutMs: 30000,
        retries: 0
      });
      setImportPreview(res);
    } catch (err) {
      setEnrichMsg(`Error al analizar el CSV: ${err.message}`);
    } finally {
      setImportBusy(false);
    }
  };

  const onEnrichmentFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      setImportCsvText(text);
      previewImport(text);
    };
    reader.onerror = () => setEnrichMsg('No se pudo leer el archivo.');
    reader.readAsText(file);
  };

  const applyImport = async () => {
    if (!importCsvText) return;
    setImportBusy(true);
    setEnrichMsg('');
    try {
      const res = await apiRequest('/api/product-catalog/import', {
        method: 'POST',
        token,
        body: { csv: importCsvText, commit: true, update_names: updateNames, sync_description: syncDescription },
        timeoutMs: 60000,
        retries: 0
      });
      setImportPreview(res);
      setEnrichMsg(`Aplicado: ${res.counts.to_update} producto(s) actualizado(s).`);
      await loadProducts();
    } catch (err) {
      setEnrichMsg(`Error al aplicar: ${err.message}`);
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <div className="card">
        <h3 style={{ marginBottom: '8px' }}>Lista de precios (PDF)</h3>
        <p style={{ color: '#555', fontSize: '0.9em', marginBottom: '12px' }}>
          Descarga el catálogo activo con SKU, producto y precio FACTURADO vigente — listo para
          registrar los productos en Impuestos (SIAT). Vuelve a descargarla cada vez que cambien
          los precios para que la factura siempre cuadre con la proforma.
        </p>
        <button
          type="button"
          disabled={loading || products.filter((row) => row.is_active).length === 0}
          onClick={() => {
            const count = downloadPriceListPdf(products);
            setMessage(count > 0
              ? `Lista de precios descargada: ${count} productos activos.`
              : 'No hay productos activos para listar.');
          }}
        >
          Descargar lista de precios (PDF)
        </button>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '8px' }}>Detalles de productos (CSV)</h3>
        <p style={{ color: '#555', fontSize: '0.9em', marginBottom: '12px' }}>
          Descarga el catálogo completo, completa los detalles (línea, color, medidas, materiales,
          compatibilidad, etc.) en Excel o Google Sheets, y vuelve a subir el archivo. La vista previa
          muestra los cambios antes de aplicarlos.
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" onClick={downloadEnrichmentCsv} disabled={importBusy}>Descargar CSV</button>
          <label style={{ padding: '8px 12px', background: '#eef2ff', borderRadius: '8px', cursor: 'pointer' }}>
            Elegir CSV para importar
            <input type="file" accept=".csv,text/csv" onChange={onEnrichmentFile} style={{ display: 'none' }} />
          </label>
          {importFileName && <span style={{ color: '#555', fontSize: '0.85em' }}>{importFileName}</span>}
        </div>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '10px', fontSize: '0.9em' }}>
          <label style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={updateNames}
              onChange={(e) => { setUpdateNames(e.target.checked); if (importCsvText) previewImport(importCsvText, e.target.checked); }}
            />{' '}Actualizar nombres desde el CSV
          </label>
          <label style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={syncDescription}
              onChange={(e) => setSyncDescription(e.target.checked)}
            />{' '}Copiar descripción larga al menú
          </label>
        </div>
        {importBusy && <p style={{ color: '#555', marginTop: '10px' }}>Procesando…</p>}
        {enrichMsg && <p style={{ marginTop: '10px' }}>{enrichMsg}</p>}
        {importPreview && (
          <div style={{ marginTop: '10px', fontSize: '0.9em' }}>
            <p>
              {importPreview.applied ? '✅ Aplicado. ' : 'Vista previa (sin aplicar). '}
              {importPreview.counts.to_update} a actualizar · {importPreview.counts.skipped} sin cambios · {importPreview.counts.unknown} SKU desconocidos.
            </p>
            {importPreview.unknown?.length > 0 && (
              <p style={{ color: '#b45309' }}>Desconocidos (omitidos): {importPreview.unknown.join(', ')}</p>
            )}
            {(importPreview.warnings || []).map((w, i) => (
              <p key={`w-${i}`} style={{ color: '#b45309' }}>⚠ {w}</p>
            ))}
            {!importPreview.applied && importPreview.counts.to_update > 0 && (
              <button type="button" onClick={applyImport} disabled={importBusy} style={{ marginTop: '6px' }}>
                Aplicar {importPreview.counts.to_update} cambio(s)
              </button>
            )}
          </div>
        )}
      </div>
      <div className="card">
        <h3 style={{ marginBottom: '12px' }}>Agregar producto al cotizador</h3>
        <form onSubmit={createProduct} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
          <input
            placeholder="SKU"
            value={newProduct.sku}
            onChange={(e) => setNewProduct((prev) => ({ ...prev, sku: e.target.value.toUpperCase() }))}
            className="form-input form-input--inline"
          />
          <input
            placeholder="Nombre"
            value={newProduct.name}
            onChange={(e) => setNewProduct((prev) => ({ ...prev, name: e.target.value }))}
            className="form-input form-input--inline"
          />
          <textarea
            placeholder="Descripción (uso / para qué sirve — ayuda a la IA)"
            value={newProduct.description}
            onChange={(e) => setNewProduct((prev) => ({ ...prev, description: e.target.value }))}
            className="form-input form-input--inline"
            rows={2}
            style={{ gridColumn: '1 / -1', resize: 'vertical' }}
          />
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Precio SF"
            value={newProduct.sf}
            onChange={(e) => setNewProduct((prev) => ({ ...prev, sf: e.target.value }))}
            className="form-input form-input--inline"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Precio CF"
            value={newProduct.cf}
            onChange={(e) => setNewProduct((prev) => ({ ...prev, cf: e.target.value }))}
            className="form-input form-input--inline"
          />
          <select
            value={newProduct.product_line}
            onChange={(e) => setNewProduct((prev) => ({ ...prev, product_line: e.target.value }))}
            className="form-select form-input--inline"
            title="Línea"
          >
            <option value="acero">Línea: Acero</option>
            <option value="armonia">Línea: Armonía</option>
          </select>
          <select
            value={newProduct.product_type}
            onChange={(e) => setNewProduct((prev) => ({ ...prev, product_type: e.target.value }))}
            className="form-select form-input--inline"
            title="Tipo"
          >
            <option value="">Tipo: automático</option>
            <option value="tablero">Tipo: Tablero</option>
            <option value="accesorio">Tipo: Accesorio</option>
            <option value="combo">Tipo: Combo</option>
          </select>
          <select
            value={newProduct.material}
            onChange={(e) => setNewProduct((prev) => ({ ...prev, material: e.target.value }))}
            className="form-select form-input--inline"
            title="Material"
          >
            <option value="metal">Material: Metal</option>
            <option value="plastico">Material: Plástico</option>
            <option value="mixto">Material: Mixto</option>
          </select>
          <button
            type="submit"
            disabled={saving}
            style={{ border: 'none', borderRadius: '8px', background: '#3b82f6', color: 'white', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Guardando...' : 'Agregar'}
          </button>

          <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 10 }}>
            <div style={{ border: '1px solid #e7e0d8', borderRadius: 10, padding: 10, background: '#ffffff' }}>
              <div style={{ color: '#292524', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Procesos</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {productionOptions.process_options.map((option) => (
                  <label key={`new-process-${option.value}`} className="form-check-inline">
                    <input
                      type="checkbox"
                      checked={Array.isArray(newProduct.processes) && newProduct.processes.includes(option.value)}
                      onChange={() => toggleNewProductProcess(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
                {productionOptions.process_options.length === 0 && (
                  <span style={{ color: '#78716c', fontSize: '0.82rem' }}>No hay procesos disponibles</span>
                )}
              </div>
            </div>

            <div style={{ border: '1px solid #e7e0d8', borderRadius: 10, padding: 10, background: '#ffffff' }}>
              <div style={{ color: '#292524', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Equipos utilizados</div>
              <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                {productionOptions.equipment_options.map((equipment) => (
                  <label key={`new-eq-${equipment.id}`} className="form-check-inline">
                    <input
                      type="checkbox"
                      checked={Array.isArray(newProduct.equipment_ids) && newProduct.equipment_ids.includes(equipment.id)}
                      onChange={() => toggleNewProductEquipment(equipment.id)}
                    />
                    {equipment.code} · {equipment.name}
                  </label>
                ))}
                {productionOptions.equipment_options.length === 0 && (
                  <span style={{ color: '#78716c', fontSize: '0.82rem' }}>No hay equipos activos. Agrégalos en la pestaña Equipos.</span>
                )}
              </div>
            </div>

            <div style={{ border: '1px solid #e7e0d8', borderRadius: 10, padding: 10, background: '#ffffff' }}>
              <div style={{ color: '#292524', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Materiales utilizados</div>
              <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                {productionOptions.material_options.map((material) => (
                  <label key={`new-mt-${material.id}`} className="form-check-inline">
                    <input
                      type="checkbox"
                      checked={Array.isArray(newProduct.material_ids) && newProduct.material_ids.includes(material.id)}
                      onChange={() => toggleNewProductMaterial(material.id)}
                    />
                    {material.code} · {material.name}{material.unit_measure ? ` (${material.unit_measure})` : ''}
                  </label>
                ))}
                {productionOptions.material_options.length === 0 && (
                  <span style={{ color: '#78716c', fontSize: '0.82rem' }}>No hay materiales activos. Agrégalos en la pestaña Materiales.</span>
                )}
              </div>
            </div>
          </div>
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
        <div className="pcat-table-head">
          <h3 style={{ margin: 0 }}>Productos del cotizador</h3>
          <input
            type="search"
            className="form-input pcat-search"
            placeholder="Buscar por SKU o nombre…"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
          />
        </div>
        {loading ? (
          <p style={{ color: '#78716c' }}>Cargando productos...</p>
        ) : visibleProducts.length === 0 ? (
          <p style={{ color: '#78716c' }}>Sin productos.</p>
        ) : (
          <div className="pcat-list">
            {visibleProducts.map((row) => (
              <div key={row.sku} className={`pcat-item ${row.is_active ? '' : 'is-inactive'}`}>
                <div className="pcat-item-media">
                  <div className="pcat-thumb">
                    {row.image_url
                      ? <img src={resolveImageUrl(row.image_url)} alt={row.name || row.sku} loading="lazy" />
                      : <span className="pcat-thumb-empty">Sin foto</span>}
                  </div>
                  <div className="pcat-image-actions">
                    <label className={`pcat-upload-btn ${imageBusySku === row.sku ? 'is-busy' : ''}`}>
                      {imageBusySku === row.sku ? '…' : (row.image_url ? 'Cambiar' : 'Subir')}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={imageBusySku === row.sku}
                        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadProductImage(row, f); }}
                        style={{ display: 'none' }}
                      />
                    </label>
                    {row.image_url && (
                      <button
                        type="button"
                        className="pcat-remove-btn"
                        disabled={imageBusySku === row.sku}
                        onClick={() => removeProductImage(row)}
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                </div>

                <div className="pcat-item-fields">
                  <div className="pcat-item-topline">
                    <span className="pcat-sku">{row.sku}</span>
                    <label className="pcat-switch-inline" title={row.is_active ? 'Activo' : 'Inactivo'}>
                      <span className="pcat-switch">
                        <input
                          type="checkbox"
                          checked={Boolean(row.is_active)}
                          onChange={(e) => onRowField(row.sku, 'is_active', e.target.checked)}
                        />
                        <span className="pcat-switch-track" />
                      </span>
                      {row.is_active ? 'Activo' : 'Inactivo'}
                    </label>
                  </div>

                  <label className="pcat-field">
                    <span>Nombre</span>
                    <input
                      value={row.name || ''}
                      onChange={(e) => onRowField(row.sku, 'name', e.target.value)}
                      className="form-input"
                    />
                  </label>

                  <label className="pcat-field">
                    <span>Descripción <em>(uso / para qué sirve)</em></span>
                    <textarea
                      value={row.description || ''}
                      onChange={(e) => onRowField(row.sku, 'description', e.target.value)}
                      className="form-input pcat-desc"
                      rows={2}
                      placeholder="Uso / para qué sirve — ayuda a la IA"
                    />
                  </label>

                  <div className="pcat-price-row">
                    <label className="pcat-field pcat-field--price">
                      <span>Precio SF</span>
                      <input
                        type="number" min="0" step="0.01"
                        value={Number(row.sf ?? row.sf_price ?? 0)}
                        onChange={(e) => onRowField(row.sku, 'sf', e.target.value)}
                        className="form-input"
                      />
                    </label>
                    <label className="pcat-field pcat-field--price">
                      <span>Precio CF</span>
                      <input
                        type="number" min="0" step="0.01"
                        value={Number(row.cf ?? row.cf_price ?? 0)}
                        onChange={(e) => onRowField(row.sku, 'cf', e.target.value)}
                        className="form-input"
                      />
                    </label>
                  </div>

                  <div className="pcat-price-row">
                    <label className="pcat-field pcat-field--price">
                      <span>Línea</span>
                      <select
                        value={row.product_line || ''}
                        onChange={(e) => onRowField(row.sku, 'product_line', e.target.value)}
                        className="form-select"
                      >
                        <option value="">—</option>
                        <option value="acero">Acero</option>
                        <option value="armonia">Armonía</option>
                      </select>
                    </label>
                    <label className="pcat-field pcat-field--price">
                      <span>Tipo</span>
                      <select
                        value={row.product_type || ''}
                        onChange={(e) => onRowField(row.sku, 'product_type', e.target.value)}
                        className="form-select"
                      >
                        <option value="">—</option>
                        <option value="tablero">Tablero</option>
                        <option value="accesorio">Accesorio</option>
                        <option value="combo">Combo</option>
                      </select>
                    </label>
                    <label className="pcat-field pcat-field--price">
                      <span>Material</span>
                      <select
                        value={row.material || ''}
                        onChange={(e) => onRowField(row.sku, 'material', e.target.value)}
                        className="form-select"
                      >
                        <option value="">—</option>
                        <option value="metal">Metal</option>
                        <option value="plastico">Plástico</option>
                        <option value="mixto">Mixto</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div className="pcat-actions">
                  <button
                    type="button"
                    className="pcat-action pcat-action--save"
                    onClick={() => saveProduct(row)}
                    disabled={saving}
                  >
                    Guardar
                  </button>
                  <button
                    type="button"
                    className="pcat-action pcat-action--config"
                    onClick={() => openProductionConfig(row)}
                    disabled={saving || configLoading}
                  >
                    Producción
                  </button>
                  <button
                    type="button"
                    className="pcat-action pcat-action--danger"
                    onClick={() => deleteProduct(row)}
                    disabled={saving || !row.is_active}
                  >
                    Desactivar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {inactiveProducts.length > 0 && (
        <div className="card">
          <h4 style={{ marginBottom: '8px' }}>Productos inactivos</h4>
          <p style={{ marginBottom: '10px', color: '#78716c' }}>
            Reactiva un producto marcando <strong>Activo</strong> y guardando.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: '860px' }}>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Nombre</th>
                  <th style={{ textAlign: 'right' }}>SF</th>
                  <th style={{ textAlign: 'right' }}>CF</th>
                  <th>Activo</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {inactiveProducts.map((row) => (
                  <tr key={`inactive-${row.sku}`}>
                    <td>{row.sku}</td>
                    <td>{row.name}</td>
                    <td style={{ textAlign: 'right' }}>{Number(row.sf ?? row.sf_price ?? 0).toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>{Number(row.cf ?? row.cf_price ?? 0).toFixed(2)}</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(row.is_active)}
                        onChange={(e) => onRowField(row.sku, 'is_active', e.target.checked)}
                      />
                    </td>
                    <td>
                      <button
                        onClick={() => saveProduct({ ...row, is_active: true })}
                        disabled={saving}
                        style={{ padding: '8px 10px', borderRadius: '8px', border: 'none', background: '#047857', color: 'white', cursor: saving ? 'not-allowed' : 'pointer' }}
                      >
                        Reactivar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {configModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(120,100,80,0.72)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          zIndex: 1000
        }}>
          <div style={{
            width: 'min(880px, 100%)',
            maxHeight: '90vh',
            overflowY: 'auto',
            background: '#f5f1ec',
            border: '1px solid #e7e0d8',
            borderRadius: 12,
            padding: 16,
            display: 'grid',
            gap: 12
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0 }}>Configurar producción · {configModal.sku}</h3>
              {configLoading && <span style={{ color: '#2563eb', fontSize: '0.82rem' }}>Cargando...</span>}
            </div>

            <div style={{ border: '1px solid #e7e0d8', borderRadius: 10, padding: 10, background: '#ffffff' }}>
              <div style={{ color: '#292524', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Procesos</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {productionOptions.process_options.map((option) => (
                  <label key={`cfg-process-${option.value}`} className="form-check-inline">
                    <input
                      type="checkbox"
                      checked={Array.isArray(configModal.processes) && configModal.processes.includes(option.value)}
                      onChange={() => updateConfigSelection('processes', option.value)}
                      disabled={configLoading || configSaving}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ border: '1px solid #e7e0d8', borderRadius: 10, padding: 10, background: '#ffffff' }}>
              <div style={{ color: '#292524', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Equipos</div>
              <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                {productionOptions.equipment_options.map((equipment) => (
                  <label key={`cfg-eq-${equipment.id}`} className="form-check-inline">
                    <input
                      type="checkbox"
                      checked={Array.isArray(configModal.equipment_ids) && configModal.equipment_ids.includes(equipment.id)}
                      onChange={() => updateConfigSelection('equipment_ids', equipment.id)}
                      disabled={configLoading || configSaving}
                    />
                    {equipment.code} · {equipment.name}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ border: '1px solid #e7e0d8', borderRadius: 10, padding: 10, background: '#ffffff' }}>
              <div style={{ color: '#292524', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Materiales</div>
              <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                {productionOptions.material_options.map((material) => (
                  <label key={`cfg-mt-${material.id}`} className="form-check-inline">
                    <input
                      type="checkbox"
                      checked={Array.isArray(configModal.material_ids) && configModal.material_ids.includes(material.id)}
                      onChange={() => updateConfigSelection('material_ids', material.id)}
                      disabled={configLoading || configSaving}
                    />
                    {material.code} · {material.name}{material.unit_measure ? ` (${material.unit_measure})` : ''}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setConfigModal(null)}
                disabled={configSaving}
                style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #e7e0d8', background: '#ffffff', color: '#292524', cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveProductionConfig}
                disabled={configSaving || configLoading}
                style={{ padding: '8px 12px', borderRadius: '8px', border: 'none', background: '#2563eb', color: 'white', fontWeight: 700, cursor: 'pointer' }}
              >
                {configSaving ? 'Guardando...' : 'Guardar configuración'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProductCatalogAdmin;
