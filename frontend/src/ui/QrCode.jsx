import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// Renders a QR code (as a PNG data URL) for the given value.
export default function QrCode({ value, size = 200, alt = 'Código QR' }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    if (!value) return undefined;
    QRCode.toDataURL(String(value), { width: size, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => { if (active) { setSrc(url); setError(false); } })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [value, size]);

  if (!value) return <div className="qr-placeholder" style={{ width: size, height: size }} />;
  if (error) return <div className="qr-error">No se pudo generar el QR</div>;
  if (!src) return <div className="qr-placeholder" style={{ width: size, height: size }} />;
  return <img className="qr-image" src={src} width={size} height={size} alt={alt} />;
}
