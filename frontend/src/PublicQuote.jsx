// Cotizador público del inicio: el visitante arma su pedido con la misma
// vitrina (fotos, filtros, precios) que usa Ventas en Cotizar y lo manda por
// WhatsApp con un clic. No crea nada en el sistema: el pedido llega como
// mensaje y Ventas lo cotiza formalmente desde ahí.
import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';
import QuoteCatalogPicker from './QuoteCatalogPicker';

const formatBs = (value) => `Bs ${Number(value || 0).toLocaleString('es-BO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const buildOrderMessage = ({ intro, lines, total }) => {
  const parts = [String(intro || 'Hola PCX, quiero hacer este pedido:').trim(), ''];
  for (const line of lines) {
    parts.push(`• ${line.qty} × ${line.name} — ${formatBs(line.qty * line.price)}`);
  }
  parts.push('', `Total referencial: ${formatBs(total)}`);
  return parts.join('\n');
};

export default function PublicQuote({ section, whatsapp, preview = false }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [qtyBySku, setQtyBySku] = useState({});
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let alive = true;
    apiRequest('/api/site/products')
      .then((data) => {
        if (!alive) return;
        const products = (data?.products || []).map((p) => ({ ...p, sf: p.price, cf: p.price, displayName: p.name }));
        const combos = section.show_combos === false ? [] : (data?.combos || []).map((c) => ({ ...c, sf: c.price, cf: c.price, displayName: c.name, isCombo: true }));
        setItems([...products, ...combos]);
      })
      .catch((err) => { if (alive) setError(err.message || 'No se pudieron cargar los productos'); });
    return () => { alive = false; };
  }, [section.show_combos]);

  const rows = useMemo(() => Object.entries(qtyBySku).filter(([, qty]) => qty > 0).map(([sku, qty]) => ({ sku, qty })), [qtyBySku]);

  const lines = useMemo(() => {
    if (!items) return [];
    return rows.map(({ sku, qty }) => {
      const item = items.find((it) => String(it.sku).toUpperCase() === sku);
      return item ? { sku, qty, name: item.name, price: Number(item.price || 0) } : null;
    }).filter(Boolean);
  }, [rows, items]);

  const total = lines.reduce((sum, line) => sum + line.qty * line.price, 0);
  const units = lines.reduce((sum, line) => sum + line.qty, 0);

  const setQty = (sku, qty) => {
    setSent(false);
    setQtyBySku((prev) => ({ ...prev, [String(sku).toUpperCase()]: Math.max(0, Number(qty) || 0) }));
  };

  const number = String(whatsapp?.number || '').replace(/\D/g, '');
  const message = buildOrderMessage({ intro: section.message_intro, lines, total });
  const waUrl = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;

  return (
    <section className="lp-quote" id="cotizar">
      <div className="lp-section-head">
        <h2>{section.title}</h2>
        {section.subtitle && <p>{section.subtitle}</p>}
      </div>

      {error && <p className="lp-quote-error">{error}</p>}
      {!items && !error && <p className="lp-quote-loading">Cargando productos…</p>}
      {items && (
        <div className="lp-quote-picker">
          <QuoteCatalogPicker items={items} rows={rows} ventaType="sf" onSetQty={setQty} />
        </div>
      )}

      {section.note && <p className="lp-note lp-quote-note">{section.note}</p>}

      <div className={`lp-quote-bar ${lines.length > 0 ? 'is-active' : ''}`}>
        <div className="lp-quote-summary">
          {lines.length === 0 ? (
            <span className="lp-quote-hint">Agrega productos para armar tu pedido.</span>
          ) : (
            <>
              <strong>{units} {units === 1 ? 'unidad' : 'unidades'} · {formatBs(total)}</strong>
              <ul className="lp-quote-lines">
                {lines.map((line) => (
                  <li key={line.sku}>
                    <span>{line.qty} × {line.name}</span>
                    <button type="button" aria-label={`Quitar ${line.name}`} onClick={() => setQty(line.sku, 0)}>×</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <a
          className={`lp-btn lp-btn-wa ${lines.length === 0 ? 'is-disabled' : ''}`}
          data-tt-event="SubmitForm"
          href={lines.length === 0 || preview ? undefined : waUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={lines.length === 0}
          onClick={(e) => { if (lines.length === 0 || preview) e.preventDefault(); else setSent(true); }}
        >
          {section.cta_label || 'Enviar pedido'}
        </a>
      </div>
      {sent && <p className="lp-quote-sent">Se abrió WhatsApp con tu pedido. Si no se abrió, revisa las ventanas emergentes.</p>}
    </section>
  );
}
