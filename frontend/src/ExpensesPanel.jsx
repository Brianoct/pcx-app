import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from './apiClient';
import { normalizeRole } from './roleAccess';
import { useOutbox } from './OutboxProvider';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const RECURRENCE_OPTIONS = [
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensual' },
  { value: 'quarterly', label: 'Trimestral' },
  { value: 'yearly', label: 'Anual' }
];

const CATEGORY_OPTIONS = [
  'Operativo',
  'Logística',
  'Servicios',
  'Marketing',
  'Suministros',
  'Personal',
  'Software',
  'Otro'
];

const WORK_AREA_BY_ROLE = {
  ventas: 'Ventas',
  'ventas lider': 'Ventas',
  almacen: 'Almacén',
  'almacen lider': 'Almacén',
  marketing: 'Marketing',
  'marketing lider': 'Marketing',
  microfabrica: 'Microfábrica',
  'microfabrica lider': 'Microfábrica',
  admin: 'Administración'
};

const todayText = () => new Date().toISOString().slice(0, 10);
const formatMoney = (amount) => `${Number(amount || 0).toFixed(2)} Bs`;
const formatDelta = (value) => {
  const safe = Number(value || 0);
  const sign = safe > 0 ? '+' : '';
  return `${sign}${safe.toFixed(2)} Bs`;
};

function ExpensesPanel({ token, user, role }) {
  const { enqueueWrite, isWriteIntentError } = useOutbox();
  const [rows, setRows] = useState([]);
  const [varianceRows, setVarianceRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [recurringOnly, setRecurringOnly] = useState(false);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [message, setMessage] = useState('');

  const userDepartment = WORK_AREA_BY_ROLE[normalizeRole(role || '')] || '';
  const isAdmin = normalizeRole(role || '') === 'admin';

  const [form, setForm] = useState({
    department: isAdmin ? '' : userDepartment,
    category: 'Operativo',
    concept: '',
    vendor: '',
    quantity: '1',
    amount: '',
    currency: 'BS',
    is_recurring: false,
    recurrence_period: 'monthly',
    expense_date: todayText(),
    notes: ''
  });

  useEffect(() => {
    if (isAdmin) return;
    setForm((prev) => ({ ...prev, department: userDepartment || prev.department }));
  }, [isAdmin, userDepartment]);

  const loadData = async () => {
    setLoading(true);
    setMessage('');
    try {
      const listParams = new URLSearchParams({
        month: String(month),
        year: String(year)
      });
      if (search.trim()) listParams.set('q', search.trim());
      if (recurringOnly) listParams.set('recurring_only', 'true');
      if (isAdmin && departmentFilter.trim()) listParams.set('department', departmentFilter.trim());

      const varianceParams = new URLSearchParams({
        months: '6',
        limit: '30'
      });
      if (isAdmin && departmentFilter.trim()) varianceParams.set('department', departmentFilter.trim());

      const [listData, varianceData] = await Promise.all([
        apiRequest(`/api/expenses?${listParams.toString()}`, { token }),
        apiRequest(`/api/expenses/variance?${varianceParams.toString()}`, { token })
      ]);

      setRows(Array.isArray(listData) ? listData : []);
      setVarianceRows(Array.isArray(varianceData) ? varianceData : []);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token, month, year, recurringOnly, departmentFilter]);

  const availableDepartments = useMemo(() => {
    const set = new Set([
      'Ventas',
      'Almacén',
      'Marketing',
      'Microfábrica',
      'Desarrollo',
      'Administración',
      ...rows.map((row) => row.department).filter(Boolean)
    ]);
    return [...set].sort((a, b) => a.localeCompare(b, 'es'));
  }, [rows]);

  const monthlyTotal = useMemo(
    () => rows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    [rows]
  );
  const recurringCount = useMemo(
    () => rows.filter((row) => row.is_recurring).length,
    [rows]
  );
  const biggestIncrease = useMemo(
    () => varianceRows.find((row) => Number(row.delta_amount || 0) > 0) || null,
    [varianceRows]
  );

  const resetForm = () => {
    setForm((prev) => ({
      ...prev,
      category: 'Operativo',
      concept: '',
      vendor: '',
      quantity: '1',
      amount: '',
      currency: 'BS',
      is_recurring: false,
      recurrence_period: 'monthly',
      expense_date: todayText(),
      notes: '',
      department: isAdmin ? '' : userDepartment
    }));
  };

  const handleCreateExpense = async (event) => {
    event.preventDefault();
    const payload = {
      department: (isAdmin ? form.department : userDepartment).trim(),
      category: form.category,
      concept: form.concept.trim(),
      vendor: form.vendor.trim() || null,
      quantity: Number.parseInt(form.quantity, 10),
      amount: Number(form.amount),
      currency: form.currency || 'BS',
      is_recurring: Boolean(form.is_recurring),
      recurrence_period: form.is_recurring ? form.recurrence_period : null,
      expense_date: form.expense_date || todayText(),
      notes: form.notes.trim() || null
    };

    if (!payload.department) {
      setMessage('Error: Debes seleccionar un área de trabajo.');
      return;
    }
    if (!payload.concept) {
      setMessage('Error: Debes indicar el concepto del gasto.');
      return;
    }
    if (!Number.isInteger(payload.quantity) || payload.quantity <= 0) {
      setMessage('Error: La cantidad debe ser mayor a 0.');
      return;
    }
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      setMessage('Error: El monto debe ser mayor a 0.');
      return;
    }

    setSaving(true);
    setMessage('');
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Registrar gasto ${payload.concept}`,
          path: '/api/expenses',
          options: {
            method: 'POST',
            body: payload,
            retries: 0
          },
          meta: {
            recordType: 'expenses',
            department: payload.department,
            concept: payload.concept
          }
        });
        setRows((prev) => ([
          {
            id: -Date.now(),
            ...payload,
            created_by_email: user?.email || null
          },
          ...prev
        ]));
        setMessage('Sin conexión: gasto guardado en cola para sincronizar.');
        resetForm();
      } else {
        const created = await apiRequest('/api/expenses', {
          method: 'POST',
          token,
          body: payload
        });
        setRows((prev) => [created, ...prev]);
        setMessage('Gasto registrado correctamente.');
        resetForm();
        await loadData();
      }
    } catch (err) {
      if (isWriteIntentError(err)) {
        enqueueWrite({
          label: `Registrar gasto ${payload.concept}`,
          path: '/api/expenses',
          options: {
            method: 'POST',
            body: payload,
            retries: 0
          },
          meta: {
            recordType: 'expenses',
            department: payload.department,
            concept: payload.concept
          }
        });
        setRows((prev) => ([
          {
            id: -Date.now(),
            ...payload,
            created_by_email: user?.email || null
          },
          ...prev
        ]));
        setMessage('Conexión inestable: gasto en cola para sincronizar.');
        resetForm();
      } else {
        setMessage(`Error: ${err.message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const removeExpense = async (expense) => {
    if (!window.confirm(`¿Eliminar gasto "${expense.concept}"?`)) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        enqueueWrite({
          label: `Eliminar gasto #${expense.id}`,
          path: `/api/expenses/${expense.id}`,
          options: {
            method: 'DELETE',
            retries: 0
          },
          meta: {
            recordType: 'expenses',
            expenseId: expense.id
          }
        });
        setRows((prev) => prev.filter((row) => row.id !== expense.id));
        setMessage('Sin conexión: eliminación en cola para sincronizar.');
        return;
      }
      await apiRequest(`/api/expenses/${expense.id}`, {
        method: 'DELETE',
        token
      });
      setRows((prev) => prev.filter((row) => row.id !== expense.id));
      setMessage('Gasto eliminado.');
      await loadData();
    } catch (err) {
      if (isWriteIntentError(err)) {
        enqueueWrite({
          label: `Eliminar gasto #${expense.id}`,
          path: `/api/expenses/${expense.id}`,
          options: {
            method: 'DELETE',
            retries: 0
          },
          meta: {
            recordType: 'expenses',
            expenseId: expense.id
          }
        });
        setRows((prev) => prev.filter((row) => row.id !== expense.id));
        setMessage('Conexión inestable: eliminación en cola para sincronizar.');
      } else {
        setMessage(`Error: ${err.message}`);
      }
    }
  };

  return (
    <div className="dashboard-workspace">
      <div className="admin-hero-card" style={{ padding: '16px 20px' }}>
        <p style={{ margin: 0, color: '#ff7f30', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Gastos
        </p>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
          <div style={{ border: '1px solid #334155', borderRadius: '10px', padding: '12px', background: '#0f172a' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Total del período</div>
            <div style={{ color: '#60a5fa', fontWeight: 800, fontSize: '1.25rem' }}>{formatMoney(monthlyTotal)}</div>
          </div>
          <div style={{ border: '1px solid #334155', borderRadius: '10px', padding: '12px', background: '#0f172a' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Gastos recurrentes</div>
            <div style={{ color: '#facc15', fontWeight: 800, fontSize: '1.25rem' }}>{recurringCount}</div>
          </div>
          <div style={{ border: '1px solid #334155', borderRadius: '10px', padding: '12px', background: '#0f172a' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Mayor incremento</div>
            <div style={{ color: biggestIncrease ? '#f87171' : '#94a3b8', fontWeight: 800, fontSize: '1.05rem' }}>
              {biggestIncrease ? `${biggestIncrease.concept} (${formatDelta(biggestIncrease.delta_amount)})` : 'Sin variación positiva'}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h3 style={{ marginBottom: '12px' }}>Registrar gasto</h3>
        <form onSubmit={handleCreateExpense} style={{ display: 'grid', gap: '10px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '10px' }}>
            {isAdmin ? (
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ color: '#94a3b8' }}>Área de Trabajo</span>
                <input
                  value={form.department}
                  onChange={(e) => setForm((prev) => ({ ...prev, department: e.target.value }))}
                  list="expense-department-options"
                  placeholder="Ej: Ventas"
                  style={{ minHeight: '42px', borderRadius: '10px', border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', padding: '10px' }}
                />
                <datalist id="expense-department-options">
                  {availableDepartments.map((dep) => (
                    <option key={dep} value={dep} />
                  ))}
                </datalist>
              </label>
            ) : (
              <label style={{ display: 'grid', gap: '6px' }}>
                <span style={{ color: '#94a3b8' }}>Área de Trabajo</span>
                <input
                  value={userDepartment || '—'}
                  disabled
                  style={{ minHeight: '42px', borderRadius: '10px', border: '1px solid #334155', background: '#111827', color: '#9ca3af', padding: '10px' }}
                />
              </label>
            )}
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ color: '#94a3b8' }}>Categoría</span>
              <select
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                style={{ minHeight: '42px', borderRadius: '10px', border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', padding: '10px' }}
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ color: '#94a3b8' }}>Concepto</span>
              <input
                value={form.concept}
                onChange={(e) => setForm((prev) => ({ ...prev, concept: e.target.value }))}
                placeholder="Ej: Internet oficina"
                required
                style={{ minHeight: '42px', borderRadius: '10px', border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', padding: '10px' }}
              />
            </label>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ color: '#94a3b8' }}>Proveedor</span>
              <input
                value={form.vendor}
                onChange={(e) => setForm((prev) => ({ ...prev, vendor: e.target.value }))}
                placeholder="Ej: Tigo / Entel"
                style={{ minHeight: '42px', borderRadius: '10px', border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', padding: '10px' }}
              />
            </label>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ color: '#94a3b8' }}>Cantidad</span>
              <input
                type="number"
                min="1"
                step="1"
                value={form.quantity}
                onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))}
                required
                style={{ minHeight: '42px', borderRadius: '10px', border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', padding: '10px' }}
              />
            </label>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ color: '#94a3b8' }}>Monto (Bs)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                required
                style={{ minHeight: '42px', borderRadius: '10px', border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', padding: '10px' }}
              />
            </label>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ color: '#94a3b8' }}>Fecha</span>
              <input
                type="date"
                value={form.expense_date}
                onChange={(e) => setForm((prev) => ({ ...prev, expense_date: e.target.value }))}
                style={{ minHeight: '42px', borderRadius: '10px', border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', padding: '10px' }}
              />
            </label>
            <label style={{ display: 'grid', gap: '6px' }}>
              <span style={{ color: '#94a3b8' }}>Moneda (Bs)</span>
              <input
                value={form.currency}
                onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value.toUpperCase() }))}
                style={{ minHeight: '42px', borderRadius: '10px', border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', padding: '10px' }}
              />
            </label>
          </div>

          <div style={{ display: 'grid', gap: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#cbd5e1' }}>
              <input
                type="checkbox"
                checked={form.is_recurring}
                onChange={(e) => setForm((prev) => ({ ...prev, is_recurring: e.target.checked }))}
              />
              Gasto recurrente
            </label>
            {form.is_recurring && (
              <label style={{ display: 'grid', gap: '6px', maxWidth: '320px' }}>
                <span style={{ color: '#94a3b8' }}>Frecuencia</span>
                <select
                  value={form.recurrence_period}
                  onChange={(e) => setForm((prev) => ({ ...prev, recurrence_period: e.target.value }))}
                  style={{ minHeight: '42px', borderRadius: '10px', border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', padding: '10px' }}
                >
                  {RECURRENCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={{ color: '#94a3b8' }}>Notas</span>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Observaciones para auditoría y recorte"
              style={{ borderRadius: '10px', border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', padding: '10px' }}
            />
          </label>

          <div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
              style={{ minWidth: '220px' }}
            >
              {saving ? 'Guardando...' : 'Registrar gasto'}
            </button>
          </div>
        </form>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
          <h3 style={{ margin: 0 }}>Histórico de gastos</h3>
          <button className="btn btn-secondary" onClick={loadData}>Actualizar</button>
        </div>
        <div className="filter-bar" style={{ marginBottom: '12px' }}>
          <select className="filter-select" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTH_NAMES.map((name, index) => (
              <option key={name} value={index + 1}>{name}</option>
            ))}
          </select>
          <select className="filter-select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[2024, 2025, 2026, 2027, 2028].map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          {isAdmin && (
            <select
              className="filter-select"
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
            >
              <option value="">Todas las áreas de trabajo</option>
              {availableDepartments.map((dep) => (
                <option key={dep} value={dep}>{dep}</option>
              ))}
            </select>
          )}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: '#cbd5e1' }}>
            <input
              type="checkbox"
              checked={recurringOnly}
              onChange={(e) => setRecurringOnly(e.target.checked)}
            />
            Solo recurrentes
          </label>
          <input
            className="filter-input"
            placeholder="Buscar concepto / proveedor / categoría"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                loadData();
              }
            }}
          />
          <button className="btn" onClick={loadData} style={{ background: '#334155', color: '#e2e8f0' }}>
            Buscar
          </button>
        </div>

        {message && (
          <div style={{
            marginBottom: '10px',
            padding: '10px 12px',
            borderRadius: '8px',
            background: message.startsWith('Error') ? 'rgba(127,29,29,0.35)' : 'rgba(6,78,59,0.35)',
            border: message.startsWith('Error') ? '1px solid #ef4444' : '1px solid #10b981',
            color: message.startsWith('Error') ? '#fecaca' : '#bbf7d0'
          }}>
            {message}
          </div>
        )}

        {loading ? (
          <div style={{ color: '#94a3b8', padding: '8px 0' }}>Cargando gastos...</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: '1180px' }}>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Área de Trabajo</th>
                  <th>Categoría</th>
                  <th>Concepto</th>
                  <th>Proveedor</th>
                  <th style={{ textAlign: 'right' }}>Cantidad</th>
                  <th style={{ textAlign: 'right' }}>Monto</th>
                  <th>Recurrencia</th>
                  <th>Registrado por</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', color: '#94a3b8' }}>
                      Sin gastos en el período seleccionado.
                    </td>
                  </tr>
                ) : rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.expense_date}</td>
                    <td>{row.department}</td>
                    <td>{row.category}</td>
                    <td title={row.concept}>{row.concept}</td>
                    <td title={row.vendor || ''}>{row.vendor || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{Number.parseInt(row.quantity, 10) || 1}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatMoney(row.amount)}</td>
                    <td>{row.is_recurring ? (RECURRENCE_OPTIONS.find((item) => item.value === row.recurrence_period)?.label || row.recurrence_period || 'Sí') : 'No'}</td>
                    <td>{row.created_by_email || '—'}</td>
                    <td>
                      <button
                        className="btn"
                        onClick={() => removeExpense(row)}
                        style={{ minHeight: '34px', padding: '6px 10px', background: '#7f1d1d', color: '#fecaca' }}
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h3 style={{ marginBottom: '10px' }}>Variación de gastos recurrentes (últimos 6 meses)</h3>
        <p style={{ color: '#94a3b8', marginBottom: '10px' }}>
          Ordenado por incremento para facilitar decisiones de negociación y recorte.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: '1080px' }}>
            <thead>
              <tr>
                <th>Área de Trabajo</th>
                <th>Concepto</th>
                <th>Frecuencia</th>
                <th style={{ textAlign: 'right' }}>Último</th>
                <th style={{ textAlign: 'right' }}>Anterior</th>
                <th style={{ textAlign: 'right' }}>Δ Monto</th>
                <th style={{ textAlign: 'right' }}>Δ %</th>
                <th>Muestras</th>
                <th>Proveedor actual</th>
              </tr>
            </thead>
            <tbody>
              {varianceRows.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', color: '#94a3b8' }}>
                    Aún no hay suficientes datos recurrentes para comparar.
                  </td>
                </tr>
              ) : varianceRows.map((row, index) => {
                const delta = Number(row.delta_amount || 0);
                return (
                  <tr key={`${row.department}-${row.concept}-${index}`}>
                    <td>{row.department}</td>
                    <td>{row.concept}</td>
                    <td>{RECURRENCE_OPTIONS.find((item) => item.value === row.recurrence_period)?.label || row.recurrence_period || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatMoney(row.latest_amount)}</td>
                    <td style={{ textAlign: 'right' }}>{formatMoney(row.previous_amount)}</td>
                    <td style={{ textAlign: 'right', color: delta > 0 ? '#f87171' : (delta < 0 ? '#34d399' : '#cbd5e1'), fontWeight: 700 }}>
                      {formatDelta(delta)}
                    </td>
                    <td style={{ textAlign: 'right', color: delta > 0 ? '#f87171' : (delta < 0 ? '#34d399' : '#cbd5e1') }}>
                      {row.delta_percent === null || row.delta_percent === undefined
                        ? '—'
                        : `${row.delta_percent > 0 ? '+' : ''}${Number(row.delta_percent).toFixed(2)}%`}
                    </td>
                    <td>{row.samples}</td>
                    <td>{row.latest_vendor || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default ExpensesPanel;
