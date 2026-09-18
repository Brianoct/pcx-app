const { pool } = require('../db');
const { areaForRole, AREA_LABELS } = require('./areas');
const { createHttpError } = require('./util');

// Bono por desempeño: scorecard mensual. Todo se calcula de datos que la app
// ya registra sola (movimientos del Kanban, fechas de entrega, control de
// calidad, Plan del día, registro de mejoras). Nadie declara un número.
//
//  - Puerta del equipo (por área): si una meta del equipo está en rojo,
//    nadie del área califica ese mes ("si uno cae, caemos todos").
//  - Metas personales: pocas, verde/rojo.
//  - Tick-up: puntos de comisión extra del mes si puerta + metas en verde.
//    Por ahora es una VISTA PREVIA: no toca Comisiones.

const BO_TODAY = "(NOW() AT TIME ZONE 'America/La_Paz')::date";

const monthBounds = (month, year) => {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return { start, next };
};

// Días hábiles (lun–vie) del mes ya transcurridos (hasta hoy si es el mes
// en curso, todo el mes si ya pasó).
const workingDaysElapsed = (month, year, todayIso) => {
  const [ty, tm, td] = String(todayIso).split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDay = (ty === year && tm === month) ? Math.min(td, daysInMonth) : (ty > year || (ty === year && tm > month)) ? daysInMonth : 0;
  let count = 0;
  for (let d = 1; d <= lastDay; d += 1) {
    const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    if (dow >= 1 && dow <= 5) count += 1;
  }
  return count;
};

const loadGoals = async () => {
  const res = await pool.query('SELECT * FROM performance_goals ORDER BY position, key');
  return res.rows.map((row) => ({
    key: row.key,
    label: row.label,
    area: row.area,
    scope: row.scope,
    direction: row.direction,
    threshold: Number(row.threshold),
    unit: row.unit || '',
    description: row.description || '',
    enabled: Boolean(row.enabled),
    updated_at: row.updated_at || null
  }));
};

const loadSettings = async () => {
  const res = await pool.query('SELECT tick_up_pct, updated_at FROM performance_settings WHERE id = 1');
  return { tick_up_pct: Number(res.rows[0]?.tick_up_pct ?? 1), updated_at: res.rows[0]?.updated_at || null };
};

const loadGoalLog = async (limit = 30) => {
  const res = await pool.query(
    `SELECT l.*, COALESCE(NULLIF(TRIM(u.display_name), ''), split_part(u.email, '@', 1)) AS changed_by_name
     FROM performance_goal_log l LEFT JOIN users u ON u.id = l.changed_by
     ORDER BY l.changed_at DESC, l.id DESC LIMIT $1`,
    [limit]
  );
  return res.rows.map((row) => ({
    id: Number(row.id),
    goal_key: row.goal_key,
    field: row.field,
    old_value: row.old_value,
    new_value: row.new_value,
    changed_by_name: row.changed_by_name || 'Admin',
    changed_at: row.changed_at
  }));
};

// Solo Admin. Cada cambio de umbral / activación / tick-up queda en bitácora.
const saveGoals = async ({ goals = [], tick_up_pct }, userId) => {
  const current = await loadGoals();
  const byKey = new Map(current.map((g) => [g.key, g]));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of Array.isArray(goals) ? goals : []) {
      const goal = byKey.get(String(item?.key || ''));
      if (!goal) throw createHttpError(400, `Meta desconocida: ${item?.key}`);
      const threshold = item.threshold === undefined ? goal.threshold : Number(item.threshold);
      if (!Number.isFinite(threshold) || threshold < 0) throw createHttpError(400, `${goal.label}: umbral inválido`);
      const enabled = item.enabled === undefined ? goal.enabled : Boolean(item.enabled);
      if (threshold !== goal.threshold) {
        await client.query(
          'INSERT INTO performance_goal_log (goal_key, field, old_value, new_value, changed_by) VALUES ($1, $2, $3, $4, $5)',
          [goal.key, 'threshold', String(goal.threshold), String(threshold), userId || null]
        );
      }
      if (enabled !== goal.enabled) {
        await client.query(
          'INSERT INTO performance_goal_log (goal_key, field, old_value, new_value, changed_by) VALUES ($1, $2, $3, $4, $5)',
          [goal.key, 'enabled', String(goal.enabled), String(enabled), userId || null]
        );
      }
      await client.query(
        'UPDATE performance_goals SET threshold = $2, enabled = $3, updated_by = $4, updated_at = NOW() WHERE key = $1',
        [goal.key, threshold, enabled, userId || null]
      );
    }
    if (tick_up_pct !== undefined) {
      const tick = Number(tick_up_pct);
      if (!Number.isFinite(tick) || tick < 0 || tick > 50) throw createHttpError(400, 'tick_up_pct debe estar entre 0 y 50');
      const prev = await loadSettings();
      if (tick !== prev.tick_up_pct) {
        await client.query(
          'INSERT INTO performance_goal_log (goal_key, field, old_value, new_value, changed_by) VALUES ($1, $2, $3, $4, $5)',
          ['tick_up', 'tick_up_pct', String(prev.tick_up_pct), String(tick), userId || null]
        );
      }
      await client.query(
        `INSERT INTO performance_settings (id, tick_up_pct, updated_by, updated_at) VALUES (1, $1, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET tick_up_pct = EXCLUDED.tick_up_pct, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [tick, userId || null]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// Verde / rojo / sin datos según dirección y umbral.
const judge = (goal, value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'nodata';
  const v = Number(value);
  const ok = goal.direction === 'gte' ? v >= goal.threshold : v <= goal.threshold;
  return ok ? 'green' : 'red';
};

// ── Métricas ────────────────────────────────────────────────────────────────

// Lotes que entraron a Embalado en el mes, con entrega definida.
const metricOnTime = async ({ start, next }) => {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE (e.moved_at AT TIME ZONE 'America/La_Paz')::date <= c.due_date)::int AS on_time
     FROM production_stage_events e
     JOIN production_kanban_cards c ON c.id = e.card_id
     WHERE e.to_stage = 'embalado' AND e.from_stage IS DISTINCT FROM 'embalado'
       AND c.due_date IS NOT NULL
       AND e.moved_at >= $1::date AND e.moved_at < $2::date`,
    [start, next]
  );
  const { total, on_time: onTime } = res.rows[0];
  return { value: total > 0 ? Number(((onTime / total) * 100).toFixed(1)) : null, detail: `${onTime}/${total} lotes con entrega` };
};

const metricRejects = async ({ start, next }) => {
  const res = await pool.query(
    `SELECT COALESCE(SUM(quantity) FILTER (WHERE result = 'rejected'), 0)::int AS rejected,
            COALESCE(SUM(quantity), 0)::int AS total
     FROM quality_control_records
     WHERE created_at >= $1::date AND created_at < $2::date`,
    [start, next]
  );
  const { rejected, total } = res.rows[0];
  return { value: total > 0 ? Number(((rejected / total) * 100).toFixed(1)) : null, detail: `${rejected} de ${total} piezas` };
};

// Por persona: días (hábiles, transcurridos) con al menos una mejora hecha.
const metricMejoraDiaria = async ({ start, next }, workingDays) => {
  const res = await pool.query(
    `SELECT user_id, COUNT(DISTINCT task_date)::int AS days
     FROM mejoras
     WHERE task_date >= $1::date AND task_date < $2::date
       AND EXTRACT(ISODOW FROM task_date) BETWEEN 1 AND 5
     GROUP BY user_id`,
    [start, next]
  );
  const byUser = new Map(res.rows.map((row) => [Number(row.user_id), Number(row.days)]));
  return (userId) => {
    const days = byUser.get(userId) || 0;
    return { value: workingDays > 0 ? Number(((days / workingDays) * 100).toFixed(0)) : null, detail: `${days} de ${workingDays} días hábiles` };
  };
};

// Por persona: bloques del Plan del día en grupo (dueña con etiquetados o etiquetada).
const metricCowork = async ({ start, next }) => {
  const res = await pool.query(
    `SELECT u AS user_id, COUNT(DISTINCT task_id)::int AS blocks FROM (
       SELECT t.user_id AS u, t.id AS task_id
       FROM day_plan_tasks t
       WHERE t.task_date >= $1::date AND t.task_date < $2::date
         AND EXISTS (SELECT 1 FROM day_plan_task_participants p WHERE p.task_id = t.id)
       UNION ALL
       SELECT p.user_id AS u, t.id AS task_id
       FROM day_plan_tasks t JOIN day_plan_task_participants p ON p.task_id = t.id
       WHERE t.task_date >= $1::date AND t.task_date < $2::date
     ) x GROUP BY u`,
    [start, next]
  );
  const byUser = new Map(res.rows.map((row) => [Number(row.user_id), Number(row.blocks)]));
  return (userId) => {
    const blocks = byUser.get(userId) || 0;
    return { value: blocks, detail: `${blocks} bloque${blocks === 1 ? '' : 's'} en grupo` };
  };
};

// Por estación (encargado): mediana de min/pza del mes vs base (90 días
// previos al mes). Valor = % de la base (100 = igual, 90 = 10% más rápido).
const metricStationSpeed = async ({ start, next }) => {
  const res = await pool.query(
    `WITH stays AS (
       SELECT e.to_stage AS process, e.qty, e.moved_at,
              EXTRACT(EPOCH FROM (
                LEAD(e.moved_at) OVER (PARTITION BY e.card_id ORDER BY e.moved_at, e.id) - e.moved_at
              )) / 60.0 AS minutes
       FROM production_stage_events e
       WHERE e.moved_at >= ($1::date - INTERVAL '90 days')
     ),
     valid AS (
       SELECT process, moved_at, minutes / qty AS mpp FROM stays
       WHERE minutes IS NOT NULL AND minutes > 0 AND minutes <= 10080 AND qty > 0
         AND process NOT IN ('planificacion', 'recepcion', 'recibido', 'danado_transito')
     )
     SELECT process,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY mpp) FILTER (WHERE moved_at < $1::date) AS base_mpp,
            COUNT(*) FILTER (WHERE moved_at < $1::date)::int AS base_lots,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY mpp) FILTER (WHERE moved_at >= $1::date AND moved_at < $2::date) AS month_mpp,
            COUNT(*) FILTER (WHERE moved_at >= $1::date AND moved_at < $2::date)::int AS month_lots
     FROM valid GROUP BY process`,
    [start, next]
  );
  const ownersRes = await pool.query('SELECT process, owner_user_id FROM production_process_rates WHERE owner_user_id IS NOT NULL');
  const byProcess = new Map(res.rows.map((row) => [row.process, row]));
  const stationsByUser = new Map();
  for (const row of ownersRes.rows) {
    const uid = Number(row.owner_user_id);
    if (!stationsByUser.has(uid)) stationsByUser.set(uid, []);
    stationsByUser.get(uid).push(row.process);
  }
  return (userId) => {
    const stations = stationsByUser.get(userId) || [];
    if (stations.length === 0) return null; // no es encargado de una estación
    const parts = [];
    let ratioSum = 0;
    let ratioCount = 0;
    for (const process of stations) {
      const row = byProcess.get(process);
      const base = row?.base_mpp !== null && row?.base_mpp !== undefined ? Number(row.base_mpp) : null;
      const month = row?.month_mpp !== null && row?.month_mpp !== undefined ? Number(row.month_mpp) : null;
      if (base && month) {
        ratioSum += (month / base) * 100;
        ratioCount += 1;
        parts.push(`${process}: ${month.toFixed(1)} vs base ${base.toFixed(1)} min/pza`);
      } else {
        parts.push(`${process}: ${month ? 'sin base aún' : 'sin lotes este mes'}`);
      }
    }
    return { value: ratioCount > 0 ? Number((ratioSum / ratioCount).toFixed(0)) : null, detail: parts.join(' · '), stations };
  };
};

// ── Scorecard ───────────────────────────────────────────────────────────────

const buildScorecard = async ({ month, year }) => {
  const bounds = monthBounds(month, year);
  const [goals, settings, todayRes, usersRes] = await Promise.all([
    loadGoals(),
    loadSettings(),
    pool.query(`SELECT ${BO_TODAY}::text AS today`),
    pool.query(
      `SELECT id, email, display_name, role FROM users WHERE is_active = TRUE
       ORDER BY LOWER(COALESCE(NULLIF(TRIM(display_name), ''), email))`
    )
  ]);
  const today = todayRes.rows[0].today;
  const workingDays = workingDaysElapsed(month, year, today);
  const enabled = goals.filter((g) => g.enabled);

  const [onTime, rejects, mejoraFn, coworkFn, speedFn] = await Promise.all([
    metricOnTime(bounds),
    metricRejects(bounds),
    metricMejoraDiaria(bounds, workingDays),
    metricCowork(bounds),
    metricStationSpeed(bounds)
  ]);

  const teamValues = { prod_on_time: onTime, prod_rejects: rejects };
  const personalFns = { mejora_diaria: mejoraFn, cowork: coworkFn, station_speed: speedFn };

  // Puertas por área: por ahora Producción tiene metas; las demás "por definir".
  const gates = {};
  for (const area of ['produccion', 'ventas', 'almacen', 'marketing', 'admin']) {
    const areaGoals = enabled.filter((g) => g.scope === 'team' && g.area === area);
    const items = areaGoals.map((goal) => {
      const m = teamValues[goal.key] || { value: null, detail: '' };
      return { ...goal, value: m.value, detail: m.detail, status: judge(goal, m.value) };
    });
    const status = items.length === 0 ? 'undefined' : items.some((i) => i.status === 'red') ? 'red' : items.every((i) => i.status === 'green') ? 'green' : 'nodata';
    gates[area] = { area, label: AREA_LABELS[area], items, status };
  }

  const people = usersRes.rows.map((row) => {
    const userId = Number(row.id);
    const area = areaForRole(row.role) || 'general';
    const items = [];
    for (const goal of enabled.filter((g) => g.scope === 'personal')) {
      if (goal.area !== 'todos' && goal.area !== area) continue;
      const fn = personalFns[goal.key];
      const m = fn ? fn(userId) : null;
      if (m === null) continue; // meta que no aplica a esta persona (p. ej. sin estación)
      items.push({ key: goal.key, label: goal.label, unit: goal.unit, direction: goal.direction, threshold: goal.threshold, value: m.value, detail: m.detail, status: judge(goal, m.value) });
    }
    const gate = gates[area] || { status: 'undefined' };
    const personalRed = items.some((i) => i.status === 'red');
    const gateRed = gate.status === 'red';
    // Califica si nada está en rojo. "Sin datos" no bloquea pero se avisa.
    const qualifies = !gateRed && !personalRed;
    const pending = gate.status === 'nodata' || items.some((i) => i.status === 'nodata');
    return {
      user_id: userId,
      name: String(row.display_name || '').trim() || String(row.email || '').split('@')[0],
      role: row.role || null,
      area,
      area_label: AREA_LABELS[area] || AREA_LABELS.general,
      gate_status: gate.status,
      goals: items,
      qualifies,
      pending,
      tick_up_pct: qualifies ? settings.tick_up_pct : 0
    };
  });

  return {
    month,
    year,
    today,
    working_days: workingDays,
    settings,
    gates,
    people,
    goals,
    preview: true
  };
};

module.exports = { buildScorecard, loadGoalLog, loadGoals, loadSettings, saveGoals };
