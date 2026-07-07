// Public prize-wheel page: the customer opens a one-shot link from WhatsApp.
// The prize is decided by the SERVER when the spin starts; the animation here
// only dramatizes landing on it, so nothing in this file can change the odds.
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest } from './apiClient';
import WheelStage from './WheelStage';
import logo from './assets/logo.png';

export default function WheelSpin() {
  const { spinToken } = useParams();
  const [game, setGame] = useState(null); // payload from the public GET
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [isJackpot, setIsJackpot] = useState(false);

  useEffect(() => {
    let active = true;
    apiRequest(`/api/wheel/public/${spinToken}`)
      .then((data) => { if (active) setGame(data); })
      .catch((err) => { if (active) setError(err.message || 'Este enlace no es válido'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [spinToken]);

  const resolvePrize = async () => {
    try {
      return await apiRequest(`/api/wheel/public/${spinToken}/spin`, { method: 'POST' });
    } catch (err) {
      // 409 = already spun somewhere else (second tab, refresh mid-flight):
      // land on the already-recorded prize instead of failing.
      if (err?.payload?.prize_label) return err.payload;
      throw err;
    }
  };

  if (loading) {
    return <div className="wheel-page"><div className="wheel-loading">Cargando la ruleta…</div></div>;
  }
  if (!game) {
    return (
      <div className="wheel-page">
        <div className="wheel-invalid">
          <img src={logo} alt="PCX" className="wheel-logo" />
          <h1>Enlace no válido</h1>
          <p>{error || 'Este enlace de la ruleta no existe o fue reemplazado.'}</p>
        </div>
      </div>
    );
  }

  const initialResult = game.status === 'spun' && game.prize_index !== null
    ? { prize_label: game.prize_label, prize_index: game.prize_index, is_top_prize: game.is_top_prize }
    : null;

  return (
    <div className={`wheel-page ${isJackpot ? 'is-jackpot' : ''}`}>
      <div className="wheel-header">
        <img src={logo} alt="PCX" className="wheel-logo" />
        <h1 className="wheel-title">
          {game.customer_name ? `¡${game.customer_name}, gira y gana!` : '¡Gira y gana!'}
        </h1>
        <p className="wheel-subtitle">Tienes <strong>un giro</strong>. Que la suerte te acompañe 🍀</p>
      </div>

      <WheelStage
        slices={game.slices}
        resolvePrize={resolvePrize}
        initialResult={initialResult}
        resultNote="Tu premio quedó registrado con tu número. Tu asesor de ventas lo aplicará en tu compra. 💬"
        onPhaseChange={(phase, result) => {
          if (phase === 'done' && result?.is_top_prize) setIsJackpot(true);
        }}
      />

      <div className="wheel-footer">Un giro por cliente · Premios sujetos a disponibilidad</div>
    </div>
  );
}
