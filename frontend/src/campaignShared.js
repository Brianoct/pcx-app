// Shared campaign helpers: used by CampaignsPanel and the Inicio banner
// without dragging the whole panel into the Dashboard bundle.
import { normalizeRole } from './roleAccess';

export const CAMPAIGN_AREAS = ['ventas', 'almacen', 'produccion', 'marketing', 'admin'];

export const AREA_LABELS = {
  ventas: 'Ventas',
  almacen: 'Almacén',
  produccion: 'Producción',
  marketing: 'Marketing',
  admin: 'Admin'
};

// Mirror of backend areaForRole: which area's checkboxes this user may tick.
export const areaForRole = (roleValue = '') => {
  const role = normalizeRole(roleValue);
  if (role === 'admin') return 'admin';
  if (role === 'ventas' || role === 'ventas lider' || role === 'sales' || role === 'vendedor') return 'ventas';
  if (role === 'almacen' || role === 'almacen lider') return 'almacen';
  if (role === 'produccion') return 'produccion';
  if (role === 'marketing' || role === 'marketing lider') return 'marketing';
  return null;
};

// Marketing runs the campaigns; Admin can always step in.
export const canEditCampaigns = (roleValue = '') =>
  ['marketing', 'marketing lider', 'admin'].includes(normalizeRole(roleValue));

export const canTickAnyArea = canEditCampaigns;

// Today in Bolivia as YYYY-MM-DD, so "active" flips at local midnight.
export const boliviaToday = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  return parts; // en-CA gives YYYY-MM-DD
};

export const campaignIsActive = (campaign, today = boliviaToday()) =>
  campaign?.status === 'anunciada'
  && String(campaign.start_date) <= today
  && String(campaign.end_date) >= today;

// "12 ago" style, parsing the plain date string without timezone surprises.
export const formatCampaignDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return String(value || '');
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat('es-BO', { day: 'numeric', month: 'short' }).format(date);
};
