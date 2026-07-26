import { useMemo, useState } from 'react';
import { API_BASE } from './apiClient';

const resolveImageUrl = (rawUrl = '') => {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) {
    return `${String(API_BASE || '').replace(/\/+$/, '')}${value}`;
  }
  return value;
};

// Tipo (Tablero/Accesorio/Combo) + línea (Acero/Armonía): la clasificación
// vive en products.product_type / product_line, editable en Admin → Productos.
const TYPE_FILTERS = [
  { key: 'todos', label: 'Todos' },
  { key: 'tablero', label: 'Tableros' },
  { key: 'accesorio', label: 'Accesorios' },
  { key: 'combo', label: 'Combos' }
];
const LINE_FILTERS = [
  { key: 'todas', label: 'Todas las líneas' },
  { key: 'acero', label: 'Acero' },
  { key: 'armonia', label: 'Armonía' }
];

/**
 * Visual product picker for the quoting page. Reads quantities from the same
 * quote rows used by the list view, so both views always agree.
 */
export default function QuoteCatalogPicker({ items, rows, ventaType, onSetQty }) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('todos');
  const [lineFilter, setLineFilter] = useState('todas');

  const qtyBySku = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const sku = String(row.sku || '').trim().toUpperCase();
      if (!sku) continue;
      map.set(sku, (map.get(sku) || 0) + (Number(row.qty) || 0));
    }
    return map;
  }, [rows]);

  const stockBySku = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const sku = String(row.sku || '').trim().toUpperCase();
      if (!sku) continue;
      if (row.availableStock === null || row.availableStock === undefined) continue;
      if (Number.isFinite(Number(row.availableStock))) {
        map.set(sku, Number(row.availableStock));
      }
    }
    return map;
  }, [rows]);

  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      if (typeFilter === 'combo') {
        if (!item.isCombo && String(item.product_type || '') !== 'combo') return false;
      } else if (typeFilter !== 'todos') {
        if (item.isCombo) return false;
        if (String(item.product_type || '') !== typeFilter) return false;
      }
      // Los combos no tienen línea propia: se muestran bajo cualquier línea.
      if (lineFilter !== 'todas' && !item.isCombo) {
        if (String(item.product_line || '') !== lineFilter) return false;
      }
      if (!term) return true;
      return (
        String(item.displayName || '').toLowerCase().includes(term) ||
        String(item.sku || '').toLowerCase().includes(term)
      );
    });
  }, [items, search, typeFilter, lineFilter]);

  return (
    <div className="quote-catalog">
      <div className="quote-catalog-toolbar">
        <input
          type="search"
          className="form-input quote-catalog-search"
          placeholder="Buscar producto o SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="quote-catalog-filters">
          {TYPE_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`quote-catalog-filter ${typeFilter === filter.key ? 'active' : ''}`}
              onClick={() => setTypeFilter(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="quote-catalog-filters is-lines">
          {LINE_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`quote-catalog-filter ${lineFilter === filter.key ? 'active' : ''}`}
              onClick={() => setLineFilter(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {visibleItems.length === 0 && (
        <div className="quote-catalog-empty">Sin productos para este filtro.</div>
      )}

      <div className="quote-catalog-grid">
        {visibleItems.map((item) => {
          const sku = String(item.sku || '').trim().toUpperCase();
          const qty = qtyBySku.get(sku) || 0;
          const stock = stockBySku.get(sku);
          const price = ventaType === 'sf' ? Number(item.sf || 0) : Number(item.cf || 0);
          const imageUrl = resolveImageUrl(item.image_url);
          const overStock = Number.isFinite(stock) && qty > stock;

          return (
            <div key={sku} className={`quote-catalog-card ${qty > 0 ? 'selected' : ''}`}>
              <div className="quote-catalog-image">
                {imageUrl ? (
                  <img src={imageUrl} alt={item.displayName} loading="lazy" />
                ) : (
                  <span className="quote-catalog-image-fallback">
                    {item.isCombo ? 'COMBO' : sku.slice(0, 6)}
                  </span>
                )}
                {qty > 0 && <span className="quote-catalog-qty-badge">{qty}</span>}
              </div>
              <div className="quote-catalog-info">
                <div className="quote-catalog-name" title={item.displayName}>{item.displayName}</div>
                <div className="quote-catalog-price">{price.toFixed(2)} Bs</div>
                {Number.isFinite(stock) && (
                  <div className={`quote-catalog-stock ${overStock ? 'over' : ''}`}>
                    Disponible: {stock}
                  </div>
                )}
              </div>
              {qty > 0 ? (
                <div className="quote-catalog-stepper">
                  <button type="button" onClick={() => onSetQty(sku, qty - 1)} aria-label="Quitar uno">−</button>
                  <input
                    type="number"
                    min="0"
                    value={qty}
                    onChange={(e) => onSetQty(sku, Math.max(0, parseInt(e.target.value, 10) || 0))}
                  />
                  <button type="button" onClick={() => onSetQty(sku, qty + 1)} aria-label="Agregar uno">+</button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary quote-catalog-add"
                  onClick={() => onSetQty(sku, 1)}
                >
                  Agregar
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
