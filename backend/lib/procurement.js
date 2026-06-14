const { normalizeText } = require('./rbac');

const REQUEST_STATUSES = ['pending', 'purchased', 'received', 'cancelled'];
const OPEN_STATUSES = ['pending', 'purchased'];
const REQUEST_PRIORITIES = ['low', 'normal', 'urgent'];

const STATUS_LABELS = {
  pending: 'Por comprar',
  purchased: 'Comprado',
  received: 'Recibido',
  cancelled: 'Cancelado'
};
const PRIORITY_LABELS = {
  low: 'Baja',
  normal: 'Normal',
  urgent: 'Urgente'
};

const STATUS_ALIASES = {
  pending: 'pending',
  pendiente: 'pending',
  por_comprar: 'pending',
  purchased: 'purchased',
  comprado: 'purchased',
  received: 'received',
  recibido: 'received',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  cancelado: 'cancelled'
};
const PRIORITY_ALIASES = {
  low: 'low',
  baja: 'low',
  normal: 'normal',
  media: 'normal',
  urgent: 'urgent',
  urgente: 'urgent',
  alta: 'urgent'
};

const normalizeKey = (value = '') => normalizeText(value).replace(/[\s-]+/g, '_');

const normalizeRequestStatus = (value = '') => STATUS_ALIASES[normalizeKey(value)] || null;
const normalizeRequestPriority = (value = '') => PRIORITY_ALIASES[normalizeKey(value)] || null;

// Parse a quantity that must be > 0; returns null when invalid.
const parsePositiveQuantity = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
};

const buildPurchaseRequestRow = (row = {}) => ({
  id: Number(row.id),
  material_id: Number(row.material_id),
  material_code: String(row.material_code || '').trim().toUpperCase(),
  material_name: String(row.material_name || '').trim(),
  unit_measure: row.unit_measure ? String(row.unit_measure).trim() : null,
  quantity: Number(row.quantity || 0),
  scan_count: Number(row.scan_count || 0),
  status: normalizeRequestStatus(row.status) || 'pending',
  status_label: STATUS_LABELS[normalizeRequestStatus(row.status) || 'pending'],
  priority: normalizeRequestPriority(row.priority) || 'normal',
  priority_label: PRIORITY_LABELS[normalizeRequestPriority(row.priority) || 'normal'],
  note: row.note ? String(row.note).trim() : null,
  store_location: row.store_location ? String(row.store_location).trim() : null,
  supplier: row.supplier ? String(row.supplier).trim() : null,
  requested_by: row.requested_by !== null && row.requested_by !== undefined ? Number(row.requested_by) : null,
  requested_by_email: row.requested_by_email || null,
  purchased_by: row.purchased_by !== null && row.purchased_by !== undefined ? Number(row.purchased_by) : null,
  purchased_at: row.purchased_at || null,
  received_by: row.received_by !== null && row.received_by !== undefined ? Number(row.received_by) : null,
  received_at: row.received_at || null,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null
});

module.exports = {
  OPEN_STATUSES,
  PRIORITY_LABELS,
  REQUEST_PRIORITIES,
  REQUEST_STATUSES,
  STATUS_LABELS,
  buildPurchaseRequestRow,
  normalizeRequestPriority,
  normalizeRequestStatus,
  parsePositiveQuantity
};
