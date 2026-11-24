import { useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE } from './apiClient';
import { MAX_QTY, searchProducts } from './quotePickerSearch';

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
  { key: 'acero', label: 'Acero' },
  { key: 'armonia', label: 'Armonía' }
];

// Stepper de cantidad. Mientras se escribe guarda el texto tal cual (borrar
// el número para teclear otro no elimina la línea); «−» en 1 sí la quita.
export function QtyStepper({ qty, onChange, label = 'producto', size = 'md' }) {
  const [text, setText] = useState(null);
  const current = Number(qty) || 0;
  return (
    <div className={`qt-stepper is-${size}`}>
      <button type="button" onClick={() => onChange(Math.max(0, current - 1))} aria-label={`Quitar uno de ${label}`}>−</button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={text === null ? String(qty ?? '') : text}
        onFocus={(e) => { setText(String(qty ?? '')); e.target.select(); }}
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, '').slice(0, 4);
          setText(next);
          const parsed = Number.parseInt(next, 10);
          if (Number.isInteger(parsed) && parsed > 0) onChange(Math.min(MAX_QTY, parsed));
        }}
        onBlur={() => setText(null)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        aria-label={`Cantidad de ${label}`}
      />
      <button type="button" onClick={() => onChange(Math.min(MAX_QTY, current + 1))} aria-label={`Agregar uno de ${label}`}>+</button>
    </div>
  );
}

/**
 * Buscador de productos de Cotizar. Un solo cuadro de búsqueda alimenta dos
 * vistas (lista compacta o catálogo con fotos); ambas editan las mismas
 * líneas de la cotización.
 *  - Teclado: escribir → Enter agrega el primero · ↑↓ eligen · «x3» cantidad.
 *  - Un toque: «Más cotizados» son los productos que este vendedor usa más.
 */
export default function QuotePicker({
  items,
  rows,
  priceFor,
  stockFor,
  onSetQty,
  onAdd,
  topSkus = [],
  view,
  onViewChange,
  isMobile,
  inputRef
}) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('todos');
  const [lineFilter, setLineFilter] = useState('todas');
  const [activeIndex, setActiveIndex] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [flash, setFlash] = useState('');
  const listRef = useRef(null);
  const flashTimer = useRef(null);

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const qtyBySku = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const sku = String(row.sku || '').trim().toUpperCase();
      if (!sku) continue;
      map.set(sku, (map.get(sku) || 0) + (Number(row.qty) || 0));
    }
    return map;
  }, [rows]);

  const bySku = useMemo(() => new Map(items.map((item) => [String(item.sku || '').trim().toUpperCase(), item])), [items]);
  const popularity = useMemo(() => new Map(topSkus.map((sku, index) => [String(sku).toUpperCase(), index])), [topSkus]);
  const quickItems = useMemo(
    () => topSkus.map((sku) => bySku.get(String(sku).toUpperCase())).filter(Boolean).slice(0, isMobile ? 8 : 10),
    [topSkus, bySku, isMobile]
  );

  const hasCombos = useMemo(() => items.some((item) => item.isCombo || item.product_type === 'combo'), [items]);
  const availableLines = useMemo(
    () => LINE_FILTERS.filter((line) => items.some((item) => String(item.product_line || '') === line.key)),
    [items]
  );

  const { visibleItems, addQty, term } = useMemo(() => {
    const result = searchProducts(items, search, { typeFilter, lineFilter, popularity });
    return { visibleItems: result.list, addQty: result.qty, term: result.term };
  }, [items, search, typeFilter, lineFilter, popularity]);

  const browsing = !term && typeFilter === 'todos' && lineFilter === 'todas';
  // En el teléfono la lista completa empuja la cotización muy abajo: aparece
  // al buscar, al filtrar o al pedirla.
  const listHidden = isMobile && view === 'lista' && browsing && !expanded;
  // En escritorio (vista lista) los más cotizados son las primeras filas de
  // la lista; en teléfono y en la vista con fotos van como chips arriba.
  const quickInList = !isMobile && view === 'lista' && browsing && quickItems.length > 0;
  // Los chips nunca aparecen ni desaparecen al escribir (moverían la lista):
  // o están siempre (teléfono, fotos) o nunca (lista de escritorio).
  const showChips = quickItems.length > 0 && (isMobile || view === 'catalogo');
  const entries = useMemo(() => {
    const regular = visibleItems.map((item) => ({ item, key: String(item.sku), quick: false }));
    if (!quickInList) return regular;
    return [
      ...quickItems.slice(0, 6).map((item) => ({ item, key: `quick-${item.sku}`, quick: true })),
      ...regular
    ];
  }, [visibleItems, quickItems, quickInList]);
  const showActive = Boolean(term) || navigated;
  const safeActive = Math.max(0, Math.min(activeIndex, entries.length - 1));

  useEffect(() => {
    if (!navigated || !listRef.current) return;
    const node = listRef.current.querySelector('[data-active="true"]');
    if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
  }, [safeActive, navigated]);

  const activeItem = showActive ? (entries[safeActive]?.item || null) : null;
  const enterPreview = activeItem ? `${addQty > 1 ? `${addQty} × ` : ''}${activeItem.displayName}` : '';

  const announce = (message) => {
    setFlash(message);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 2600);
  };

  const addFromKeyboard = () => {
    const item = activeItem;
    if (!item) return;
    const sku = String(item.sku || '').trim().toUpperCase();
    onAdd(sku, addQty);
    announce(`✓ Agregado: ${addQty > 1 ? `${addQty} × ` : ''}${item.displayName}`);
    setSearch('');
    setActiveIndex(0);
    setNavigated(false);
  };

  const handleKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setNavigated(true);
      setActiveIndex((prev) => Math.min(entries.length - 1, (navigated || term ? prev : -1) + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setNavigated(true);
      setActiveIndex((prev) => Math.max(0, prev - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      addFromKeyboard();
    } else if (e.key === 'Escape' && search) {
      e.preventDefault();
      setSearch('');
      setActiveIndex(0);
      setNavigated(false);
    }
  };

  const changeSearch = (value) => {
    setSearch(value);
    setFlash('');
    setActiveIndex(0);
    setNavigated(false);
  };

  const renderStock = (stock, qty) => {
    if (stock === null || stock === undefined) return null;
    if (stock <= 0) return <span className="qt-prod-stock is-out">Sin stock</span>;
    return <span className={`qt-prod-stock ${qty > stock ? 'is-out' : ''}`}>Disp. {stock}</span>;
  };

  return (
    <div className="qt-picker">
      <div className="qt-picker-head">
        <div className="qt-picker-top">
          <div className="qt-search">
            <span className="qt-search-icon" aria-hidden="true">🔍</span>
            <input
              ref={inputRef}
              type="search"
              className="form-input qt-search-input"
              placeholder={isMobile ? 'Buscar producto…' : 'Buscar producto o código… Enter lo agrega'}
              value={search}
              onChange={(e) => changeSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="Buscar producto"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
            />
          </div>
          <div className="qt-seg" role="group" aria-label="Vista de productos">
            <button type="button" className={view === 'lista' ? 'active' : ''} onClick={() => onViewChange('lista')}>Lista</button>
            <button type="button" className={view === 'catalogo' ? 'active' : ''} onClick={() => onViewChange('catalogo')}>Fotos</button>
          </div>
        </div>

        <div className="qt-filter-row">
          <div className="qt-filters" role="group" aria-label="Filtros de productos">
            {TYPE_FILTERS.filter((filter) => filter.key !== 'combo' || hasCombos).map((filter) => (
              <button
                key={filter.key}
                type="button"
                className={`qt-pill ${typeFilter === filter.key ? 'active' : ''}`}
                onClick={() => { setTypeFilter(filter.key); setActiveIndex(0); }}
              >
                {filter.label}
              </button>
            ))}
            {availableLines.length > 1 && <span className="qt-filters-sep" aria-hidden="true" />}
            {availableLines.length > 1 && availableLines.map((filter) => (
              <button
                key={filter.key}
                type="button"
                className={`qt-pill is-line ${lineFilter === filter.key ? 'active' : ''}`}
                onClick={() => { setLineFilter((prev) => (prev === filter.key ? 'todas' : filter.key)); setActiveIndex(0); }}
                aria-pressed={lineFilter === filter.key}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="qt-picker-hint" aria-live="polite">
            {enterPreview ? (
              <span>↵ Enter agrega: <strong>{enterPreview}</strong></span>
            ) : flash ? (
              <span className="qt-flash">{flash}</span>
            ) : (
              !isMobile && <span>↑↓ eligen · Enter agrega · «x3» al final = cantidad</span>
            )}
          </div>
        </div>
      </div>

      {showChips && (
        <div className="qt-quick">
          <span className="qt-quick-label">⚡ Más cotizados</span>
          <div className="qt-quick-chips">
            {quickItems.map((item) => {
              const sku = String(item.sku || '').trim().toUpperCase();
              const qty = qtyBySku.get(sku) || 0;
              return (
                <button
                  key={sku}
                  type="button"
                  className={`qt-chip ${qty > 0 ? 'in-cart' : ''}`}
                  onClick={() => onAdd(sku, 1)}
                  title={`${item.displayName} · ${priceFor(item).toFixed(2)} Bs`}
                >
                  <span className="qt-chip-name">{item.displayName}</span>
                  {qty > 0 ? <span className="qt-chip-qty">×{qty}</span> : <span className="qt-chip-plus" aria-hidden="true">+</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {listHidden ? (
        <button type="button" className="qt-expand" onClick={() => setExpanded(true)}>
          Ver los {items.length} productos ▾
        </button>
      ) : (
        <>
          {visibleItems.length === 0 && (
            <div className="quote-catalog-empty">
              {items.length === 0 ? 'Cargando productos…' : 'Ningún producto coincide con la búsqueda.'}
            </div>
          )}

          {view === 'catalogo' ? (
            <div className="quote-catalog-grid" ref={listRef}>
              {entries.map(({ item, key }, index) => {
                const sku = String(item.sku || '').trim().toUpperCase();
                const qty = qtyBySku.get(sku) || 0;
                const stock = stockFor(item);
                const imageUrl = resolveImageUrl(item.image_url);
                const isActive = showActive && index === safeActive;
                return (
                  <div
                    key={key}
                    className={`quote-catalog-card ${qty > 0 ? 'selected' : ''} ${isActive ? 'is-active' : ''}`}
                    data-active={isActive ? 'true' : undefined}
                  >
                    <button type="button" className="qt-card-hit" onClick={() => onAdd(sku, 1)} aria-label={`Agregar ${item.displayName}`}>
                      <span className="quote-catalog-image">
                        {imageUrl ? (
                          <img src={imageUrl} alt="" loading="lazy" />
                        ) : (
                          <span className="quote-catalog-image-fallback">
                            {item.isCombo ? 'COMBO' : sku.slice(0, 7)}
                          </span>
                        )}
                        {qty > 0 && <span className="quote-catalog-qty-badge">{qty}</span>}
                      </span>
                      <span className="quote-catalog-info">
                        <span className="quote-catalog-name" title={item.displayName}>{item.displayName}</span>
                        <span className="quote-catalog-price">{priceFor(item).toFixed(2)} Bs</span>
                        {renderStock(stock, qty)}
                      </span>
                    </button>
                    {qty > 0 ? (
                      <div className="qt-card-stepper">
                        <QtyStepper qty={qty} onChange={(next) => onSetQty(sku, next)} label={item.displayName} />
                      </div>
                    ) : (
                      <button type="button" className="btn btn-secondary quote-catalog-add" onClick={() => onAdd(sku, 1)}>
                        Agregar
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <ul className="qt-prod-list" ref={listRef}>
              {entries.map(({ item, key, quick }, index) => {
                const sku = String(item.sku || '').trim().toUpperCase();
                const qty = qtyBySku.get(sku) || 0;
                const stock = stockFor(item);
                const isActive = showActive && index === safeActive;
                // Encabezados de sección: solo cuando la lista lleva arriba
                // los más cotizados.
                const sectionTitle = !quickInList
                  ? ''
                  : (index === 0 ? '⚡ Lo que más cotizas' : (!quick && entries[index - 1]?.quick ? `Todos los productos (${visibleItems.length})` : ''));
                return (
                  <li key={key} className="qt-prod-item">
                    {sectionTitle && <div className="qt-prod-section">{sectionTitle}</div>}
                    <div
                      className={`qt-prod ${qty > 0 ? 'in-cart' : ''} ${isActive ? 'is-active' : ''} ${stock !== null && stock <= 0 ? 'no-stock' : ''}`}
                      data-active={isActive ? 'true' : undefined}
                    >
                      <button type="button" className="qt-prod-main" onClick={() => onAdd(sku, 1)} title="Agregar 1">
                        <span className="qt-prod-name">{item.displayName}</span>
                        <span className="qt-prod-meta">
                          <span className="qt-prod-sku">{item.isCombo ? 'Combo' : sku}</span>
                          <span className="qt-prod-price">{priceFor(item).toFixed(2)} Bs</span>
                          {renderStock(stock, qty)}
                        </span>
                      </button>
                      {qty > 0 ? (
                        <QtyStepper qty={qty} onChange={(next) => onSetQty(sku, next)} label={item.displayName} size="sm" />
                      ) : (
                        <button type="button" className="qt-prod-add" onClick={() => onAdd(sku, 1)} aria-label={`Agregar ${item.displayName}`} tabIndex={-1}>+</button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {isMobile && view === 'lista' && browsing && expanded && (
            <button type="button" className="qt-expand" onClick={() => setExpanded(false)}>Ocultar lista ▴</button>
          )}
        </>
      )}
    </div>
  );
}
