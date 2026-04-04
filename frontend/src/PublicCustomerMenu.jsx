import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest } from './apiClient';

const CATEGORY_TABLEROS = 'Tableros';
const CATEGORY_ACCESORIOS = 'Accesorios';

export default function PublicCustomerMenu() {
  const { shareToken } = useParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [menuData, setMenuData] = useState(null);
  const [activeCategory, setActiveCategory] = useState(CATEGORY_TABLEROS);
  const [quantities, setQuantities] = useState({});
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const loadMenu = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await apiRequest(`/api/public/menu/${encodeURIComponent(shareToken || '')}`, {
          retries: 0
        });
        setMenuData(data || null);
        const categories = Array.isArray(data?.categories) && data.categories.length > 0
          ? data.categories
          : [CATEGORY_TABLEROS, CATEGORY_ACCESORIOS];
        setActiveCategory(categories.includes(CATEGORY_TABLEROS) ? CATEGORY_TABLEROS : categories[0]);
      } catch (err) {
        setError(err.message || 'No se pudo cargar el menú');
      } finally {
        setLoading(false);
      }
    };
    loadMenu();
  }, [shareToken]);

  const products = useMemo(
    () => Array.isArray(menuData?.products) ? menuData.products : [],
    [menuData]
  );
  const categories = useMemo(
    () => Array.isArray(menuData?.categories) && menuData.categories.length > 0
      ? menuData.categories
      : [CATEGORY_TABLEROS, CATEGORY_ACCESORIOS],
    [menuData]
  );
  const filteredProducts = useMemo(
    () => products.filter((product) => String(product.category || CATEGORY_ACCESORIOS) === activeCategory),
    [products, activeCategory]
  );
  const cartItems = useMemo(() => (
    products
      .filter((product) => Number(quantities[product.sku] || 0) > 0)
      .map((product) => {
        const qty = Number(quantities[product.sku] || 0);
        const price = Number(product.price || 0);
        return {
          ...product,
          qty,
          lineTotal: qty * price
        };
      })
  ), [products, quantities]);
  const cartUnits = cartItems.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const cartTotal = cartItems.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);

  const setQty = (sku, qty) => {
    const normalizedQty = Math.max(0, Number.parseInt(qty, 10) || 0);
    setQuantities((prev) => {
      if (normalizedQty === 0) {
        const next = { ...prev };
        delete next[sku];
        return next;
      }
      return { ...prev, [sku]: normalizedQty };
    });
  };

  const increase = (sku) => setQty(sku, Number(quantities[sku] || 0) + 1);
  const decrease = (sku) => setQty(sku, Math.max(0, Number(quantities[sku] || 0) - 1));

  const submitOrder = async (e) => {
    e.preventDefault();
    if (cartItems.length === 0) {
      alert('Selecciona al menos un producto');
      return;
    }
    if (!String(customerName || '').trim() || !String(customerPhone || '').trim()) {
      alert('Completa nombre y teléfono');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess(null);
    try {
      const payload = {
        customer_name: String(customerName || '').trim(),
        customer_phone: String(customerPhone || '').trim(),
        notes: String(notes || '').trim() || null,
        items: cartItems.map((item) => ({
          sku: item.sku,
          qty: Number(item.qty || 0)
        }))
      };
      const data = await apiRequest(`/api/public/menu/${encodeURIComponent(shareToken || '')}/order`, {
        method: 'POST',
        body: payload,
        retries: 0
      });
      setSuccess(data || { message: 'Pedido enviado correctamente' });
      setQuantities({});
      setNotes('');
    } catch (err) {
      setError(err.message || 'No se pudo enviar el pedido');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="container" style={{ maxWidth: '1080px' }}>
        <div className="card" style={{ textAlign: 'center', color: '#94a3b8' }}>Cargando menú...</div>
      </div>
    );
  }

  if (error && !menuData) {
    return (
      <div className="container" style={{ maxWidth: '1080px' }}>
        <div className="card" style={{ textAlign: 'center', color: '#fca5a5' }}>{error}</div>
      </div>
    );
  }

  const sellerName = String(menuData?.seller?.display_name || 'Ventas PCX');

  return (
    <div className="container" style={{ maxWidth: '1120px', paddingTop: '28px' }}>
      <div className="card" style={{ marginBottom: '14px' }}>
        <h2 style={{ marginBottom: '8px', color: '#f87171' }}>Menú PCX</h2>
        <p style={{ color: '#cbd5e1', marginBottom: '4px' }}>
          Elige tus productos y envía tu pedido. Te contactará <strong>{sellerName}</strong>.
        </p>
        {menuData?.default_store && (
          <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
            Despacho base: {menuData.default_store}
          </p>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: '14px' }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={`btn ${activeCategory === category ? 'btn-primary' : ''}`}
                onClick={() => setActiveCategory(category)}
                style={activeCategory === category ? {} : { background: '#1f2937', color: '#e2e8f0', border: '1px solid #334155' }}
              >
                {category}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
            {filteredProducts.map((product) => {
              const qty = Number(quantities[product.sku] || 0);
              return (
                <div key={product.sku} style={{
                  border: '1px solid rgba(71,85,105,0.55)',
                  background: '#111827',
                  borderRadius: '12px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    height: '128px',
                    background: product.image_url
                      ? `center / cover no-repeat url(${product.image_url})`
                      : 'linear-gradient(135deg, rgba(30,64,175,0.35), rgba(225,29,72,0.28))',
                    borderBottom: '1px solid rgba(71,85,105,0.45)'
                  }} />
                  <div style={{ padding: '10px' }}>
                    <div style={{ fontWeight: 700, marginBottom: '4px', color: '#f1f5f9' }}>{product.name}</div>
                    <div style={{ color: '#10b981', fontWeight: 700, marginBottom: '8px' }}>
                      {Number(product.price || 0).toFixed(2)} Bs
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button type="button" className="btn" onClick={() => decrease(product.sku)} style={{ minHeight: '34px', padding: '6px 10px', background: '#334155', color: 'white' }}>-</button>
                      <input
                        type="number"
                        min="0"
                        value={qty}
                        onChange={(e) => setQty(product.sku, e.target.value)}
                        style={{
                          width: '70px',
                          minHeight: '34px',
                          textAlign: 'center',
                          borderRadius: '8px',
                          border: '1px solid #334155',
                          background: '#0f172a',
                          color: 'white'
                        }}
                      />
                      <button type="button" className="btn" onClick={() => increase(product.sku)} style={{ minHeight: '34px', padding: '6px 10px', background: '#2563eb', color: 'white' }}>+</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 0 }}>
          <h3 style={{ marginBottom: '8px' }}>Tu pedido</h3>
          <div style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '12px' }}>
            {cartUnits} unidad(es) · {cartTotal.toFixed(2)} Bs
          </div>

          <div style={{ maxHeight: '180px', overflowY: 'auto', marginBottom: '12px', paddingRight: '4px' }}>
            {cartItems.length === 0 ? (
              <div style={{ color: '#94a3b8' }}>Aún no agregaste productos.</div>
            ) : cartItems.map((item) => (
              <div key={`cart-${item.sku}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '6px', color: '#e2e8f0' }}>
                <span>{item.qty}× {item.name}</span>
                <strong>{item.lineTotal.toFixed(2)} Bs</strong>
              </div>
            ))}
          </div>

          <form onSubmit={submitOrder} style={{ display: 'grid', gap: '8px' }}>
            <input
              type="text"
              placeholder="Tu nombre"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              required
              style={{ minHeight: '40px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: 'white', padding: '8px 10px' }}
            />
            <input
              type="text"
              placeholder="Tu teléfono"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              required
              style={{ minHeight: '40px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: 'white', padding: '8px 10px' }}
            />
            <textarea
              rows={3}
              placeholder="Nota (opcional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: 'white', padding: '8px 10px' }}
            />
            <button type="submit" className="btn btn-primary" disabled={saving || cartItems.length === 0}>
              {saving ? 'Enviando...' : 'Enviar pedido'}
            </button>
          </form>

          {error && (
            <div style={{ marginTop: '10px', color: '#fca5a5', fontSize: '0.9rem' }}>{error}</div>
          )}
          {success && (
            <div style={{ marginTop: '10px', color: '#86efac', fontSize: '0.9rem' }}>
              {success.message || 'Pedido enviado correctamente'}
              {success.quote_id ? ` · N° ${success.quote_id}` : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
