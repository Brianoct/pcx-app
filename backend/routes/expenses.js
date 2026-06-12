const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../lib/authMiddleware');
const { getExpensesAccessScope, mapExpenseRow, normalizeExpensePayload } = require('../lib/expenses');
const { normalizeText, sanitizePanelAccess } = require('../lib/rbac');
const { loadUserContext } = require('../lib/users');
const { normalizeDepartmentLabel, parseBooleanLike } = require('../lib/util');

const router = express.Router();

// ─── EXPENSES / COST ACCOUNTABILITY ──────────────────────────────────────────
router.get('/api/expenses', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const scope = getExpensesAccessScope(userContext, access);
  if (scope.error) return res.status(403).json({ error: scope.error });

  const monthRaw = req.query?.month;
  const yearRaw = req.query?.year;
  const month = monthRaw !== undefined ? Number.parseInt(monthRaw, 10) : null;
  const year = yearRaw !== undefined ? Number.parseInt(yearRaw, 10) : null;
  if (monthRaw !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) {
    return res.status(400).json({ error: 'Mes inválido. Debe estar entre 1 y 12' });
  }
  if (yearRaw !== undefined && (!Number.isInteger(year) || year < 2000 || year > 3000)) {
    return res.status(400).json({ error: 'Año inválido' });
  }

  const recurringOnly = parseBooleanLike(req.query?.recurring_only, false);
  const departmentFilter = normalizeDepartmentLabel(req.query?.department || '');
  const search = String(req.query?.q || '').trim();

  try {
    const where = [];
    const params = [];

    if (scope.isAdmin) {
      if (departmentFilter) {
        params.push(departmentFilter);
        where.push(`LOWER(e.department) = LOWER($${params.length})`);
      }
    } else {
      params.push(scope.department);
      where.push(`LOWER(e.department) = LOWER($${params.length})`);
    }

    if (Number.isInteger(month)) {
      params.push(month);
      where.push(`EXTRACT(MONTH FROM e.expense_date) = $${params.length}`);
    }
    if (Number.isInteger(year)) {
      params.push(year);
      where.push(`EXTRACT(YEAR FROM e.expense_date) = $${params.length}`);
    }
    if (recurringOnly) {
      where.push('e.is_recurring = TRUE');
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(
        e.concept ILIKE $${params.length}
        OR COALESCE(e.vendor, '') ILIKE $${params.length}
        OR COALESCE(e.category, '') ILIKE $${params.length}
      )`);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT
         e.id, e.department, e.category, e.concept, e.vendor,
         e.quantity, e.amount, e.currency, e.is_recurring, e.recurrence_period,
         e.expense_date, e.notes, e.created_by, e.created_at, e.updated_at,
         u.email AS created_by_email
       FROM department_expenses e
       LEFT JOIN users u ON u.id = e.created_by
       ${whereSql}
       ORDER BY e.expense_date DESC, e.id DESC
       LIMIT 500`,
      params
    );
    res.json((result.rows || []).map((row) => mapExpenseRow(row)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar gastos' });
  }
});

router.get('/api/expenses/variance', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const scope = getExpensesAccessScope(userContext, access);
  if (scope.error) return res.status(403).json({ error: scope.error });

  const months = Number.parseInt(req.query?.months, 10);
  const safeMonths = Number.isInteger(months) ? Math.max(1, Math.min(36, months)) : 6;
  const limit = Number.parseInt(req.query?.limit, 10);
  const safeLimit = Number.isInteger(limit) ? Math.max(5, Math.min(200, limit)) : 30;
  const departmentFilter = normalizeDepartmentLabel(req.query?.department || '');
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - safeMonths);
  const startDateText = startDate.toISOString().slice(0, 10);

  try {
    const where = ['e.is_recurring = TRUE', `e.expense_date >= $1::date`];
    const params = [startDateText];

    if (scope.isAdmin) {
      if (departmentFilter) {
        params.push(departmentFilter);
        where.push(`LOWER(e.department) = LOWER($${params.length})`);
      }
    } else {
      params.push(scope.department);
      where.push(`LOWER(e.department) = LOWER($${params.length})`);
    }

    const result = await pool.query(
      `SELECT
         e.id, e.department, e.concept, e.vendor, e.amount, e.currency,
         e.recurrence_period, e.expense_date
       FROM department_expenses e
       WHERE ${where.join(' AND ')}
       ORDER BY LOWER(e.department) ASC, LOWER(e.concept) ASC, COALESCE(e.recurrence_period, '') ASC, e.expense_date DESC, e.id DESC`,
      params
    );

    const grouped = new Map();
    for (const row of result.rows || []) {
      const key = [
        normalizeText(row.department || ''),
        normalizeText(row.concept || ''),
        String(row.recurrence_period || '')
      ].join('|');
      const bucket = grouped.get(key) || [];
      bucket.push({
        department: row.department,
        concept: row.concept,
        vendor: row.vendor || null,
        amount: Number(row.amount || 0),
        recurrence_period: row.recurrence_period || null,
        expense_date: row.expense_date
      });
      grouped.set(key, bucket);
    }

    const summary = [];
    for (const entries of grouped.values()) {
      if (!Array.isArray(entries) || entries.length < 2) continue;
      const latest = entries[0];
      const previous = entries[1];
      const amounts = entries.map((item) => Number(item.amount || 0));
      const sum = amounts.reduce((acc, value) => acc + value, 0);
      const deltaAmount = Number(latest.amount || 0) - Number(previous.amount || 0);
      const previousAmount = Number(previous.amount || 0);
      const deltaPercent = previousAmount > 0 ? (deltaAmount / previousAmount) * 100 : null;
      summary.push({
        department: latest.department,
        concept: latest.concept,
        recurrence_period: latest.recurrence_period,
        samples: entries.length,
        latest_amount: Number(latest.amount || 0),
        previous_amount: previousAmount,
        delta_amount: deltaAmount,
        delta_percent: deltaPercent,
        avg_amount: sum / amounts.length,
        min_amount: Math.min(...amounts),
        max_amount: Math.max(...amounts),
        latest_vendor: latest.vendor,
        previous_vendor: previous.vendor,
        latest_date: latest.expense_date,
        previous_date: previous.expense_date
      });
    }

    summary.sort((a, b) => {
      if (b.delta_amount !== a.delta_amount) return b.delta_amount - a.delta_amount;
      const absDiff = Math.abs(b.delta_amount) - Math.abs(a.delta_amount);
      if (absDiff !== 0) return absDiff;
      return String(a.concept || '').localeCompare(String(b.concept || ''), 'es');
    });

    res.json(summary.slice(0, safeLimit));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo calcular variación de gastos recurrentes' });
  }
});

router.post('/api/expenses', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const scope = getExpensesAccessScope(userContext, access);
  if (scope.error) return res.status(403).json({ error: scope.error });

  try {
    const body = scope.isAdmin
      ? req.body
      : { ...(req.body || {}), department: scope.department };
    const normalized = normalizeExpensePayload(body, { partial: false });
    if (!scope.isAdmin && normalizeText(normalized.department) !== normalizeText(scope.department)) {
      return res.status(403).json({ error: 'No puedes registrar gastos para otro departamento' });
    }
    if (!normalized.is_recurring) {
      normalized.recurrence_period = null;
    }

    const result = await pool.query(
      `INSERT INTO department_expenses (
         department, category, concept, vendor, quantity, amount, currency,
         is_recurring, recurrence_period, expense_date, notes, created_by, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11, $12, NOW(), NOW())
       RETURNING id, department, category, concept, vendor, quantity, amount, currency, is_recurring, recurrence_period, expense_date, notes, created_by, created_at, updated_at`,
      [
        normalized.department,
        normalized.category,
        normalized.concept,
        normalized.vendor,
        normalized.quantity,
        normalized.amount,
        normalized.currency,
        Boolean(normalized.is_recurring),
        normalized.recurrence_period,
        normalized.expense_date,
        normalized.notes,
        req.user.id
      ]
    );
    res.status(201).json(mapExpenseRow({ ...result.rows[0], created_by_email: userContext.email }));
  } catch (err) {
    const statusCode = err?.statusCode || 500;
    if (statusCode >= 400 && statusCode < 500) {
      return res.status(statusCode).json({ error: err.message || 'Datos de gasto inválidos' });
    }
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar gasto' });
  }
});

router.patch('/api/expenses/:id', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const scope = getExpensesAccessScope(userContext, access);
  if (scope.error) return res.status(403).json({ error: scope.error });

  const expenseId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(expenseId) || expenseId <= 0) {
    return res.status(400).json({ error: 'ID de gasto inválido' });
  }

  try {
    const existingRes = await pool.query(
      `SELECT id, department, category, concept, vendor, quantity, amount, currency, is_recurring, recurrence_period, expense_date, notes, created_by
       FROM department_expenses
       WHERE id = $1`,
      [expenseId]
    );
    if (existingRes.rowCount === 0) {
      return res.status(404).json({ error: 'Gasto no encontrado' });
    }

    const current = existingRes.rows[0];
    if (!scope.isAdmin && normalizeText(current.department) !== normalizeText(scope.department)) {
      return res.status(403).json({ error: 'No autorizado para editar este gasto' });
    }

    const normalized = normalizeExpensePayload(req.body, { partial: true });
    if (Object.keys(normalized).length === 0) {
      return res.status(400).json({ error: 'No se enviaron cambios' });
    }
    if (!scope.isAdmin && Object.prototype.hasOwnProperty.call(normalized, 'department')
      && normalizeText(normalized.department) !== normalizeText(scope.department)) {
      return res.status(403).json({ error: 'No puedes mover gastos a otro departamento' });
    }

    const nextDepartment = scope.isAdmin
      ? (normalized.department ?? current.department)
      : scope.department;
    const nextCategory = normalized.category ?? current.category;
    const nextConcept = normalized.concept ?? current.concept;
    const nextVendor = Object.prototype.hasOwnProperty.call(normalized, 'vendor')
      ? normalized.vendor
      : current.vendor;
    const nextQuantity = Object.prototype.hasOwnProperty.call(normalized, 'quantity')
      ? normalized.quantity
      : Math.max(1, Number.parseInt(current.quantity, 10) || 1);
    const nextAmount = Object.prototype.hasOwnProperty.call(normalized, 'amount')
      ? normalized.amount
      : Number(current.amount || 0);
    const nextCurrency = normalized.currency ?? current.currency;
    const nextIsRecurring = Object.prototype.hasOwnProperty.call(normalized, 'is_recurring')
      ? Boolean(normalized.is_recurring)
      : Boolean(current.is_recurring);
    const requestedRecurrence = Object.prototype.hasOwnProperty.call(normalized, 'recurrence_period')
      ? normalized.recurrence_period
      : current.recurrence_period;
    const nextRecurrence = nextIsRecurring ? requestedRecurrence : null;
    if (nextIsRecurring && !nextRecurrence) {
      return res.status(400).json({ error: 'Debes indicar frecuencia para gastos recurrentes' });
    }
    const nextExpenseDate = Object.prototype.hasOwnProperty.call(normalized, 'expense_date')
      ? normalized.expense_date
      : current.expense_date;
    const nextNotes = Object.prototype.hasOwnProperty.call(normalized, 'notes')
      ? normalized.notes
      : current.notes;

    const result = await pool.query(
      `UPDATE department_expenses
       SET department = $1,
           category = $2,
           concept = $3,
           vendor = $4,
           quantity = $5,
           amount = $6,
           currency = $7,
           is_recurring = $8,
           recurrence_period = $9,
           expense_date = $10::date,
           notes = $11,
           updated_at = NOW()
       WHERE id = $12
       RETURNING id, department, category, concept, vendor, quantity, amount, currency, is_recurring, recurrence_period, expense_date, notes, created_by, created_at, updated_at`,
      [
        nextDepartment,
        nextCategory,
        nextConcept,
        nextVendor,
        nextQuantity,
        nextAmount,
        nextCurrency,
        nextIsRecurring,
        nextRecurrence,
        nextExpenseDate,
        nextNotes,
        expenseId
      ]
    );

    const row = result.rows[0];
    const ownerRes = await pool.query('SELECT email FROM users WHERE id = $1', [row.created_by]);
    res.json(mapExpenseRow({ ...row, created_by_email: ownerRes.rows[0]?.email || null }));
  } catch (err) {
    const statusCode = err?.statusCode || 500;
    if (statusCode >= 400 && statusCode < 500) {
      return res.status(statusCode).json({ error: err.message || 'Datos inválidos' });
    }
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar gasto' });
  }
});

router.delete('/api/expenses/:id', authenticateToken, async (req, res) => {
  const userContext = await loadUserContext(req.user.id);
  if (!userContext) return res.status(401).json({ error: 'Usuario no encontrado' });
  const access = sanitizePanelAccess(userContext.panel_access, userContext.role);
  const scope = getExpensesAccessScope(userContext, access);
  if (scope.error) return res.status(403).json({ error: scope.error });

  const expenseId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(expenseId) || expenseId <= 0) {
    return res.status(400).json({ error: 'ID de gasto inválido' });
  }

  try {
    const rowRes = await pool.query(
      'SELECT id, department FROM department_expenses WHERE id = $1',
      [expenseId]
    );
    if (rowRes.rowCount === 0) {
      return res.status(404).json({ error: 'Gasto no encontrado' });
    }
    if (!scope.isAdmin && normalizeText(rowRes.rows[0].department) !== normalizeText(scope.department)) {
      return res.status(403).json({ error: 'No autorizado para eliminar este gasto' });
    }
    await pool.query('DELETE FROM department_expenses WHERE id = $1', [expenseId]);
    res.json({ message: 'Gasto eliminado', id: expenseId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo eliminar gasto' });
  }
});

module.exports = router;
