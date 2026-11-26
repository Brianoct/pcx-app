// Cyber Monday 2026 en el inicio público.
//   · Pedido armado por el cliente, sin asesor: 20 % de descuento.
//   · Pedido con ayuda de un asesor por WhatsApp: 15 %.
// Vale del lunes 30 de noviembre al miércoles 2 de diciembre, hora de Bolivia
// (UTC−4). Fuera de esas fechas la página sigue ofreciendo las dos formas de
// comprar, sin descuento. El descuento lo aplica Ventas al cotizar: el mensaje
// de WhatsApp dice cuál corresponde.
export const CYBER_MONDAY = {
  // La franja de anuncio aparece sola el domingo 29, un día antes.
  teaserAt: Date.parse('2026-11-29T04:00:00Z'),
  startsAt: Date.parse('2026-11-30T04:00:00Z'),
  endsAt: Date.parse('2026-12-03T04:00:00Z'),
  selfPercent: 20,
  assistedPercent: 15,
  datesLabel: 'del lunes 30 de noviembre al miércoles 2 de diciembre'
};

// Black Friday 2026: 15 % en todos los productos, con o sin asesor, del jueves
// 26 al domingo 29 de noviembre (hora de Bolivia). Mientras dura, manda sobre
// el anuncio de Cyber Monday; el lunes 30 empieza Cyber Monday.
export const BLACK_FRIDAY = {
  startsAt: Date.parse('2026-11-26T04:00:00Z'),
  endsAt: Date.parse('2026-11-30T04:00:00Z'),
  percent: 15
};

// Para revisar la página antes de la fecha: ?cyber=live, ?cyber=before,
// ?cyber=after o ?cyber=bf (Black Friday) en la dirección.
const readOverride = () => {
  if (typeof window === 'undefined') return '';
  const text = `${window.location.search || ''}&${String(window.location.hash || '').split('?')[1] || ''}`;
  const match = text.match(/(?:^|[?&])cyber=(live|before|after|bf)\b/);
  return match ? match[1] : '';
};

export const cyberPhase = (now = Date.now(), override = readOverride()) => {
  if (override) return override;
  if (now < CYBER_MONDAY.startsAt) return 'before';
  if (now < CYBER_MONDAY.endsAt) return 'live';
  return 'after';
};

export const getCampaign = (now = Date.now(), override = readOverride()) => {
  if (override === 'bf' || (!override && now >= BLACK_FRIDAY.startsAt && now < BLACK_FRIDAY.endsAt)) {
    return {
      key: 'bf', name: 'Black Friday', phase: 'live', live: true, teaser: false,
      selfPercent: BLACK_FRIDAY.percent, assistedPercent: BLACK_FRIDAY.percent,
      datesLabel: 'hasta el domingo 29 de noviembre', endsLabel: 'hasta el domingo 29 de noviembre'
    };
  }
  const phase = cyberPhase(now, override);
  // Antes del domingo no se anuncia nada (salvo al revisar con ?cyber=before).
  const teaser = phase === 'before' && (override === 'before' || now >= CYBER_MONDAY.teaserAt);
  return { ...CYBER_MONDAY, key: 'cm', name: 'Cyber Monday', endsLabel: 'hasta el miércoles 2 de diciembre', phase, live: phase === 'live', teaser };
};

export const applyPercent = (amount, percent) => Math.round(Number(amount || 0) * (100 - percent)) / 100;
