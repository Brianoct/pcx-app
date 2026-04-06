import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';

const DEFAULT_WHATSAPP_TEMPLATE = [
  'Hola, soy {nombre} de PCX.',
  'Aqui tienes nuestro catalogo digital para que puedas elegir productos:',
  '{link}',
  'Cuando envies tu pedido te confirmo disponibilidad y precio final.'
].join('\n');
const WHATSAPP_TEMPLATE_STORAGE_KEY = 'pcx.catalogo.whatsapp_template';

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
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(WHATSAPP_TEMPLATE_STORAGE_KEY, whatsAppTemplate);
  }, [whatsAppTemplate]);

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
    </div>
  );
}
