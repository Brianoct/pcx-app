// Costo de equipos por hora (modelo único, compartido por Estructura,
// Rentabilidad y la pestaña Equipos).
//
//   Bs/mes  = reposición / vida útil (meses) + extra mensual
//   Bs/hora = Bs/mes / horas disponibles por mes
//   Bs/pza  = Bs/hora × minutos estándar del paso / 60
//
// «Horas disponibles por mes» es lo que la máquina realmente trabaja (p. ej.
// 160 h si corre una jornada completa). Sin horas no hay tarifa y el paso
// aporta 0: Estructura y Equipos lo marcan como pendiente.

const equipmentMonthlyCost = (equipment) => {
  if (!equipment) return 0;
  const life = Number(equipment.useful_life_months || 0);
  const depreciation = life > 0 ? Number(equipment.replacement_cost_bs || 0) / life : 0;
  return depreciation + Number(equipment.monthly_extra_cost_bs || 0);
};

const equipmentHourlyCost = (equipment) => {
  if (!equipment) return 0;
  const hours = Number(equipment.monthly_capacity_units || 0);
  if (hours <= 0) return 0;
  return equipmentMonthlyCost(equipment) / hours;
};

const equipmentCostForMinutes = (equipment, minutes) => {
  const mins = Number(minutes || 0);
  if (!equipment || mins <= 0) return 0;
  return equipmentHourlyCost(equipment) * (mins / 60);
};

const equipmentHasRate = (equipment) => Boolean(equipment) && Number(equipment.monthly_capacity_units || 0) > 0;

module.exports = { equipmentMonthlyCost, equipmentHourlyCost, equipmentCostForMinutes, equipmentHasRate };
