import { useEffect, useMemo, useState } from 'react';
import { API_BASE, apiRequest } from './apiClient';

const DEFAULT_WHATSAPP_TEMPLATE = [
  'Hola, soy {nombre} de PCX.',
  'Aqui tienes nuestro catalogo digital para que puedas elegir productos:',
  '{link}',
  'Cuando envies tu pedido te confirmo disponibilidad y precio final.'
].join('\n');
const WHATSAPP_TEMPLATE_STORAGE_KEY = 'pcx.catalogo.whatsapp_template';
const PRODUCT_CATEGORY_OPTIONS = ['Tableros', 'Accesorios'];

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function toPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function resolvePreviewUrl(rawUrl = '') {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/customer-menu-images/')) {
    return `${String(API_BASE || '').replace(/\/+$/, '')}${value}`;
  }
  return value;
}

function buildWhatsAppShareMessage(template, { sellerName, link }) {
  const safeLink = String(link || '').trim();
  const safeSellerName = String(sellerName || '').trim() || 'Vendedor';
  let message = String(template || '').trim() || DEFAULT_WHATSAPP_TEMPLATE;
  message = message
    .replace(/\{nombre\}/gi, safeSellerName)
    .replace(/\{name\}/gi, safeSellerName)
    .replace(/\{sellerName\}/gi, safeSellerName)
    .replace(/\{link\}/gi, safeLink);
  if (safeLink && !message.includes(safeLink)) {
    message = `${message}\n${safeLink}`;
  }
  return message.trim();
}

export default function CustomerMenuTool({ token, user }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [linkData, setLinkData] = useState(null);
  const [error, setError] = useState('');
  const [whatsAppTemplate, setWhatsAppTemplate] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_WHATSAPP_TEMPLATE;
    return window.localStorage.getItem(WHATSAPP_TEMPLATE_STORAGE_KEY) || DEFAULT_WHATSAPP_TEMPLATE;
  });
  const sellerName = useMemo(
    () => String(user?.display_name || '').trim() || String(user?.email || '').split('@')[0] || 'Vendedor',
    [user]
  );
  const normalizedRole = normalizeText(user?.role || '');
  const canManageCatalog = normalizedRole === 'admin' || Boolean(user?.panel_access?.admin);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogSaving, setCatalogSaving] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState('');
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [imageLibrary, setImageLibrary] = useState([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [uploadingImageTarget, setUploadingImageTarget] = useState('');
  const [newProduct, setNewProduct] = useState({
    sku: '',
    name: '',
    sf: '',
    cf: '',
    is_gift_eligible: false,
    menu_category: 'Tableros',
    image_url: ''
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(WHATSAPP_TEMPLATE_STORAGE_KEY, whatsAppTemplate);
  }, [whatsAppTemplate]);

  const loadCatalogProducts = async () => {
    if (!canManageCatalog) return;
    setCatalogLoading(true);
    try {
      const data = await apiRequest('/api/product-catalog?include_inactive=1', { token });
      setCatalogProducts(Array.isArray(data) ? data : []);
    } catch (err) {
      setCatalogMessage(`Error cargando productos: ${err.message}`);
    } finally {
      setCatalogLoading(false);
    }
  };

  const loadImageLibrary = async () => {
    if (!canManageCatalog) return;
    setImagesLoading(true);
    try {
      const data = await apiRequest('/api/customer-menu/images', { token });
      setImageLibrary(Array.isArray(data) ? data : []);
    } catch (err) {
      setCatalogMessage(`Error cargando imágenes: ${err.message}`);
    } finally {
      setImagesLoading(false);
    }
  };

  useEffect(() => {
    if (!canManageCatalog) return;
    loadCatalogProducts();
    loadImageLibrary();
  }, [token, canManageCatalog]);

  const generateLink = async () => {
    setIsGenerating(true);
    setError('');
    try {
      const data = await apiRequest('/api/customer-menu/share-link', {
        method: 'POST',
        token,
        retries: 0
      });
      setLinkData(data);
    } catch (err) {
      setError(err.message || 'No se pudo generar el enlace');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyLink = async () => {
    const url = String(linkData?.share_url || '').trim();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      alert('Enlace copiado');
    } catch {
      alert('No se pudo copiar automáticamente. Copia manualmente el enlace.');
    }
  };

  const openWhatsApp = () => {
    const url = String(linkData?.share_url || '').trim();
    if (!url) return;
    const message = buildWhatsAppShareMessage(whatsAppTemplate, { sellerName, link: url });
    const waUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  const onCatalogRowField = (sku, field, value) => {
    setCatalogProducts((prev) => prev.map((row) => (
      row.sku === sku ? { ...row, [field]: value } : row
    )));
    setCatalogMessage('');
  };

  const createCatalogProduct = async (e) => {
    e.preventDefault();
    setCatalogSaving(true);
    setCatalogMessage('');
    try {
      const payload = {
        sku: String(newProduct.sku || '').trim().toUpperCase(),
        name: String(newProduct.name || '').trim(),
        sf: toPositiveNumber(newProduct.sf),
        cf: toPositiveNumber(newProduct.cf),
        is_gift_eligible: Boolean(newProduct.is_gift_eligible),
        menu_category: String(newProduct.menu_category || '').trim() || null,
        image_url: String(newProduct.image_url || '').trim() || null
      };
      if (!payload.sku || !payload.name) {
        throw new Error('SKU y nombre son requeridos');
      }
      await apiRequest('/api/product-catalog', {
        method: 'POST',
        token,
        body: payload
      });
      setCatalogMessage(`Producto ${payload.sku} creado`);
      setNewProduct({
        sku: '',
        name: '',
        sf: '',
        cf: '',
        is_gift_eligible: false,
        menu_category: 'Tableros',
        image_url: ''
      });
      await loadCatalogProducts();
    } catch (err) {
      setCatalogMessage(`Error creando producto: ${err.message}`);
    } finally {
      setCatalogSaving(false);
    }
  };

  const saveCatalogRow = async (row) => {
    setCatalogSaving(true);
    setCatalogMessage('');
    try {
      const payload = {
        name: String(row.name || '').trim(),
        sf: toPositiveNumber(row.sf ?? row.sf_price ?? 0),
        cf: toPositiveNumber(row.cf ?? row.cf_price ?? 0),
        is_gift_eligible: Boolean(row.is_gift_eligible),
        menu_category: String(row.menu_category || '').trim() || null,
        image_url: String(row.image_url || '').trim() || null,
        is_active: Boolean(row.is_active)
      };
      if (!payload.name) throw new Error('Nombre requerido');
      await apiRequest(`/api/product-catalog/${encodeURIComponent(row.sku)}`, {
        method: 'PATCH',
        token,
        body: payload
      });
      setCatalogMessage(`Producto ${row.sku} actualizado`);
      await loadCatalogProducts();
    } catch (err) {
      setCatalogMessage(`Error actualizando ${row.sku}: ${err.message}`);
    } finally {
      setCatalogSaving(false);
    }
  };

  const deactivateCatalogRow = async (row) => {
    if (!window.confirm(`¿Desactivar producto ${row.sku}?`)) return;
    setCatalogSaving(true);
    setCatalogMessage('');
    try {
      await apiRequest(`/api/product-catalog/${encodeURIComponent(row.sku)}`, {
        method: 'DELETE',
        token
      });
      setCatalogMessage(`Producto ${row.sku} desactivado`);
      await loadCatalogProducts();
    } catch (err) {
      setCatalogMessage(`Error desactivando ${row.sku}: ${err.message}`);
    } finally {
      setCatalogSaving(false);
    }
  };

  const uploadImageFile = async (file, targetSku = '') => {
    if (!file) return;
    setCatalogMessage('');
    setUploadingImageTarget(targetSku || 'new');
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
        reader.readAsDataURL(file);
      });
      const uploadRes = await apiRequest('/api/customer-menu/images', {
        method: 'POST',
        token,
        body: {
          filename: file.name,
          data_url: dataUrl
        },
        timeoutMs: 45000
      });
      const nextUrl = String(uploadRes?.image_url || uploadRes?.relative_path || '').trim();
      if (!nextUrl) throw new Error('La imagen se subió pero no se recibió URL');

      if (targetSku) {
        onCatalogRowField(targetSku, 'image_url', nextUrl);
      } else {
        setNewProduct((prev) => ({ ...prev, image_url: nextUrl }));
      }
      setCatalogMessage('Imagen subida correctamente. Guarda el producto para aplicar el cambio.');
      await loadImageLibrary();
    } catch (err) {
      setCatalogMessage(`Error subiendo imagen: ${err.message}`);
    } finally {
      setUploadingImageTarget('');
    }
  };

  const activeCatalogProducts = catalogProducts.filter((item) => Boolean(item?.is_active));
  const inactiveCatalogProducts = catalogProducts.filter((item) => !Boolean(item?.is_active));

  return (
    <div className="container">
      <h2 style={{ textAlign: 'center', margin: '20px 0', color: '#f87171' }}>
        Catálogo para Clientes
      </h2>
      <div className="card" style={{ maxWidth: '920px', margin: '0 auto' }}>
        <h3 style={{ marginBottom: '10px' }}>Comparte tu catálogo personal</h3>
        <p style={{ color: '#94a3b8', marginBottom: '14px' }}>
          Genera un enlace único para tus clientes. Los pedidos enviados desde ese enlace se registran en tu nombre.
        </p>
        <div style={{ marginBottom: '14px' }}>
          <label style={{ display: 'block', marginBottom: '8px', color: '#93c5fd', fontSize: '0.9rem' }}>
            Mensaje personalizado para WhatsApp
          </label>
          <textarea
            rows={4}
            value={whatsAppTemplate}
            onChange={(e) => setWhatsAppTemplate(e.target.value)}
            style={{
              width: '100%',
              borderRadius: '10px',
              border: '1px solid rgba(59,130,246,0.35)',
              background: 'rgba(15,23,42,0.7)',
              color: '#e2e8f0',
              padding: '10px 12px',
              fontSize: '0.92rem'
            }}
          />
          <div style={{ marginTop: '6px', color: '#93c5fd', fontSize: '0.8rem' }}>
            Usa {'{nombre}'} para tu nombre y {'{link}'} para el enlace.
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={generateLink}
            disabled={isGenerating}
          >
            {isGenerating ? 'Generando enlace...' : 'Generar enlace de catálogo'}
          </button>
        </div>

        {error && (
          <div style={{
            marginBottom: '12px',
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid #ef4444',
            background: 'rgba(127,29,29,0.35)',
            color: '#fecaca'
          }}>
            {error}
          </div>
        )}

        {linkData?.share_url && (
          <div style={{
            border: '1px solid rgba(59, 130, 246, 0.45)',
            background: 'rgba(30,64,175,0.18)',
            borderRadius: '12px',
            padding: '14px'
          }}>
            <div style={{ color: '#93c5fd', marginBottom: '8px', fontSize: '0.9rem' }}>Enlace compartible</div>
            <div style={{
              wordBreak: 'break-all',
              color: '#e2e8f0',
              fontSize: '0.92rem',
              background: 'rgba(15,23,42,0.7)',
              border: '1px solid rgba(59,130,246,0.35)',
              borderRadius: '8px',
              padding: '10px'
            }}>
              {linkData.share_url}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
              <button type="button" className="btn btn-secondary" onClick={copyLink}>
                Copiar enlace
              </button>
              <button type="button" className="btn btn-primary" onClick={openWhatsApp}>
                Compartir por WhatsApp
              </button>
              <a
                className="btn"
                href={linkData.share_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ background: '#334155', color: 'white', textDecoration: 'none' }}
              >
                Abrir vista cliente
              </a>
            </div>
          </div>
        )}
      </div>

      {canManageCatalog && (
        <div className="card" style={{ maxWidth: '1100px', margin: '16px auto 0' }}>
          <h3 style={{ marginBottom: '10px' }}>Gestión rápida de Catálogo Cliente</h3>
          <p style={{ color: '#94a3b8', marginBottom: '10px' }}>
            Agrega productos, cambia categoría (Tableros/Accesorios), asigna imagen y actualiza precios sin recodificar.
          </p>
          <div style={{ color: '#93c5fd', fontSize: '0.85rem', marginBottom: '14px' }}>
            Para variantes de tableros: crea SKUs separados por variante (color/tamaño) y marca categoría <strong>Tableros</strong>.
          </div>
          <div style={{
            border: '1px solid rgba(16,185,129,0.35)',
            background: 'rgba(6,78,59,0.22)',
            borderRadius: '10px',
            padding: '10px 12px',
            color: '#bbf7d0',
            fontSize: '0.84rem',
            marginBottom: '12px',
            lineHeight: 1.4
          }}>
            <strong>Persistencia:</strong> nombres, precios, categoría e imagen del catálogo se guardan en base de datos y permanecen tras cambios de código.
            Las imágenes subidas se guardan en <code>/customer-menu-images</code> del servidor.
          </div>

          <div style={{ marginBottom: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={loadCatalogProducts} disabled={catalogLoading}>
              {catalogLoading ? 'Actualizando productos...' : 'Actualizar productos'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={loadImageLibrary} disabled={imagesLoading}>
              {imagesLoading ? 'Actualizando imágenes...' : 'Actualizar imágenes'}
            </button>
          </div>

          <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', marginBottom: '12px' }}>
            <h4 style={{ marginBottom: '10px' }}>Agregar producto</h4>
            <form onSubmit={createCatalogProduct} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
              <input
                placeholder="SKU"
                value={newProduct.sku}
                onChange={(e) => setNewProduct((prev) => ({ ...prev, sku: e.target.value.toUpperCase() }))}
                style={{ padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: '#fff' }}
              />
              <input
                placeholder="Nombre producto/variante"
                value={newProduct.name}
                onChange={(e) => setNewProduct((prev) => ({ ...prev, name: e.target.value }))}
                style={{ padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: '#fff' }}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Precio SF"
                value={newProduct.sf}
                onChange={(e) => setNewProduct((prev) => ({ ...prev, sf: e.target.value }))}
                style={{ padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: '#fff' }}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Precio CF"
                value={newProduct.cf}
                onChange={(e) => setNewProduct((prev) => ({ ...prev, cf: e.target.value }))}
                style={{ padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: '#fff' }}
              />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: '#cbd5e1', fontSize: '0.9rem' }}>
                <input
                  type="checkbox"
                  checked={Boolean(newProduct.is_gift_eligible)}
                  onChange={(e) => setNewProduct((prev) => ({ ...prev, is_gift_eligible: e.target.checked }))}
                />
                Disponible como regalo en Cotizador
              </label>
              <select
                value={newProduct.menu_category}
                onChange={(e) => setNewProduct((prev) => ({ ...prev, menu_category: e.target.value }))}
                style={{ padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: '#fff' }}
              >
                {PRODUCT_CATEGORY_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <input
                placeholder="URL imagen (http://... o /menu-images/archivo.jpg)"
                value={newProduct.image_url}
                onChange={(e) => setNewProduct((prev) => ({ ...prev, image_url: e.target.value }))}
                style={{ padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: '#fff' }}
              />
              <select
                value=""
                onChange={(e) => {
                  const value = String(e.target.value || '').trim();
                  if (value) setNewProduct((prev) => ({ ...prev, image_url: value }));
                }}
                style={{ padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: '#fff' }}
              >
                <option value="">Seleccionar imagen existente...</option>
                {imageLibrary.map((img) => (
                  <option key={`${img.source}-${img.name}`} value={img.image_url}>
                    [{img.source}] {img.name}
                  </option>
                ))}
              </select>
              <label style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#e2e8f0',
                padding: '10px',
                cursor: uploadingImageTarget ? 'not-allowed' : 'pointer'
              }}>
                {uploadingImageTarget === 'new' ? 'Subiendo imagen...' : 'Subir imagen'}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  disabled={Boolean(uploadingImageTarget)}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    uploadImageFile(file, '');
                    e.target.value = '';
                  }}
                />
              </label>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={catalogSaving}
                style={{ fontWeight: 700 }}
              >
                {catalogSaving ? 'Guardando...' : 'Crear producto'}
              </button>
            </form>
            {newProduct.image_url && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ color: '#94a3b8', fontSize: '0.82rem', marginBottom: '6px' }}>Vista previa</div>
                <img
                  src={resolvePreviewUrl(newProduct.image_url)}
                  alt="Preview producto nuevo"
                  style={{ width: '100px', height: '100px', borderRadius: '8px', objectFit: 'cover', border: '1px solid #334155', background: '#020617' }}
                />
              </div>
            )}
          </div>

          {catalogMessage && (
            <div style={{
              marginBottom: '12px',
              padding: '10px 12px',
              borderRadius: '8px',
              border: catalogMessage.startsWith('Error') ? '1px solid #ef4444' : '1px solid #10b981',
              background: catalogMessage.startsWith('Error') ? 'rgba(127,29,29,0.35)' : 'rgba(6,78,59,0.35)',
              color: catalogMessage.startsWith('Error') ? '#fecaca' : '#bbf7d0'
            }}>
              {catalogMessage}
            </div>
          )}

          <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px' }}>
            <h4 style={{ marginBottom: '10px' }}>Productos activos ({activeCatalogProducts.length})</h4>
            {catalogLoading ? (
              <div style={{ color: '#94a3b8' }}>Cargando catálogo...</div>
            ) : (
              <div style={{ display: 'grid', gap: '10px' }}>
                {activeCatalogProducts.map((row) => (
                  <div
                    key={row.sku}
                    style={{
                      border: '1px solid #334155',
                      borderRadius: '10px',
                      background: '#0f172a',
                      padding: '10px'
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '10px',
                      flexWrap: 'wrap',
                      marginBottom: '8px'
                    }}>
                      <div style={{ color: '#f8fafc', fontWeight: 700, letterSpacing: '0.02em' }}>{row.sku}</div>
                      <label style={{ color: '#cbd5e1', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(row.is_active)}
                          onChange={(e) => onCatalogRowField(row.sku, 'is_active', e.target.checked)}
                        />
                        Activo
                      </label>
                    </div>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                      gap: '8px',
                      marginBottom: '8px'
                    }}>
                      <input
                        value={row.name || ''}
                        onChange={(e) => onCatalogRowField(row.sku, 'name', e.target.value)}
                        placeholder="Nombre producto/variante"
                        style={{ gridColumn: 'span 2', minHeight: '38px', padding: '8px', borderRadius: '8px', border: '1px solid #334155', background: '#020617', color: '#fff' }}
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.sf ?? row.sf_price ?? 0}
                        onChange={(e) => onCatalogRowField(row.sku, 'sf', e.target.value)}
                        placeholder="SF"
                        style={{ minHeight: '38px', padding: '8px', borderRadius: '8px', border: '1px solid #334155', background: '#020617', color: '#fff' }}
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.cf ?? row.cf_price ?? 0}
                        onChange={(e) => onCatalogRowField(row.sku, 'cf', e.target.value)}
                        placeholder="CF"
                        style={{ minHeight: '38px', padding: '8px', borderRadius: '8px', border: '1px solid #334155', background: '#020617', color: '#fff' }}
                      />
                      <label style={{ color: '#cbd5e1', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(row.is_gift_eligible)}
                          onChange={(e) => onCatalogRowField(row.sku, 'is_gift_eligible', e.target.checked)}
                        />
                        Regalo cotizador
                      </label>
                      <select
                        value={row.menu_category || ''}
                        onChange={(e) => onCatalogRowField(row.sku, 'menu_category', e.target.value)}
                        style={{ minHeight: '38px', padding: '8px', borderRadius: '8px', border: '1px solid #334155', background: '#020617', color: '#fff' }}
                      >
                        {PRODUCT_CATEGORY_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </div>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto',
                      gap: '8px',
                      alignItems: 'start'
                    }}>
                      <div style={{ display: 'grid', gap: '6px' }}>
                        <input
                          value={row.image_url || ''}
                          onChange={(e) => onCatalogRowField(row.sku, 'image_url', e.target.value)}
                          placeholder="/customer-menu-images/archivo.jpg o URL"
                          style={{ width: '100%', minHeight: '38px', padding: '8px', borderRadius: '8px', border: '1px solid #334155', background: '#020617', color: '#fff' }}
                        />
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '6px' }}>
                          <select
                            value=""
                            onChange={(e) => {
                              const value = String(e.target.value || '').trim();
                              if (value) onCatalogRowField(row.sku, 'image_url', value);
                            }}
                            style={{ padding: '8px', borderRadius: '8px', border: '1px solid #334155', background: '#020617', color: '#fff' }}
                          >
                            <option value="">Elegir imagen...</option>
                            {imageLibrary.map((img) => (
                              <option key={`${row.sku}-${img.source}-${img.name}`} value={img.image_url}>
                                [{img.source}] {img.name}
                              </option>
                            ))}
                          </select>
                          <label style={{
                            borderRadius: '8px',
                            border: '1px solid #334155',
                            background: '#020617',
                            color: '#e2e8f0',
                            padding: '8px 10px',
                            cursor: uploadingImageTarget ? 'not-allowed' : 'pointer',
                            whiteSpace: 'nowrap',
                            display: 'inline-flex',
                            alignItems: 'center'
                          }}>
                            {uploadingImageTarget === row.sku ? 'Subiendo...' : 'Subir'}
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: 'none' }}
                              disabled={Boolean(uploadingImageTarget)}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                uploadImageFile(file, row.sku);
                                e.target.value = '';
                              }}
                            />
                          </label>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gap: '8px', justifyItems: 'end' }}>
                        {row.image_url ? (
                          <img
                            src={resolvePreviewUrl(row.image_url)}
                            alt={`preview-${row.sku}`}
                            style={{ width: '58px', height: '58px', borderRadius: '8px', objectFit: 'cover', border: '1px solid #334155', background: '#020617' }}
                          />
                        ) : (
                          <div style={{
                            width: '58px',
                            height: '58px',
                            borderRadius: '8px',
                            border: '1px dashed #334155',
                            background: '#020617'
                          }} />
                        )}
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => saveCatalogRow(row)}
                            disabled={catalogSaving}
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => deactivateCatalogRow(row)}
                            disabled={catalogSaving}
                          >
                            Desactivar
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {inactiveCatalogProducts.length > 0 && (
              <div style={{ marginTop: '12px', color: '#94a3b8', fontSize: '0.9rem' }}>
                Productos inactivos: {inactiveCatalogProducts.length}. Usa Admin si necesitas reactivarlos en lote.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
