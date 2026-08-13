// Mapa de Bolivia con ventas por departamento + ranking Departamento → Ciudad.
// Extraído de Estadísticas (AdminDashboard) para reutilizarlo tal cual en el
// Panel de Marketing. Recibe los datos ya agregados por el backend:
//   - salesByDepartment: [{ department, total_sales }]
//   - topLocations: [{ location, order_count, total_sales, cities: [...] }]
import boliviaAdminMapSvg from './assets/bolivia-admin1.svg?raw';

const BOLIVIA_DEPARTMENT_MAP = {
  'la paz': 'La Paz',
  'santa cruz': 'Santa Cruz',
  'santa cruz de la sierra': 'Santa Cruz',
  scz: 'Santa Cruz',
  cochabamba: 'Cochabamba',
  cbba: 'Cochabamba',
  potosi: 'Potosí',
  potosí: 'Potosí',
  tarija: 'Tarija',
  oruro: 'Oruro',
  beni: 'Beni',
  'el beni': 'Beni',
  pando: 'Pando',
  chuquisaca: 'Chuquisaca',
  // capital cities / common aliases that should roll up to their department
  sucre: 'Chuquisaca',
  trinidad: 'Beni',
  cobija: 'Pando',
  'el alto': 'La Paz'
};

const BOLIVIA_MAP_CODE_TO_DEPARTMENT = {
  BOB: 'Beni',
  BOC: 'Cochabamba',
  BOH: 'Chuquisaca',
  BOL: 'La Paz',
  BON: 'Pando',
  BOO: 'Oruro',
  BOP: 'Potosí',
  BOS: 'Santa Cruz',
  BOT: 'Tarija'
};

const BOLIVIA_DEPARTMENT_SHORT_LABEL = {
  BOB: 'BEN',
  BOC: 'CBB',
  BOH: 'CHQ',
  BOL: 'LPZ',
  BON: 'PAN',
  BOO: 'ORU',
  BOP: 'POT',
  BOS: 'SCZ',
  BOT: 'TJA'
};

const BOLIVIA_LABEL_OFFSETS = {
  BOB: { dx: 10, dy: -28 },
  BOC: { dx: 26, dy: 8 },
  BOH: { dx: 24, dy: 16 },
  BOL: { dx: -28, dy: -14 },
  BON: { dx: 0, dy: -30 },
  BOO: { dx: -32, dy: 0 },
  BOP: { dx: -36, dy: 16 },
  BOS: { dx: 42, dy: 18 },
  BOT: { dx: 18, dy: 30 }
};

const buildBoliviaMapFeatures = () => {
  const pathRegex = /<path d="([^"]+)" id="([^"]+)" name="([^"]+)">/g;
  const labelRegex = /<circle class="([^"]+)" cx="([^"]+)" cy="([^"]+)" id="([^"]+)">/g;
  const features = [];
  const labelById = new Map();
  let match;

  while ((match = labelRegex.exec(boliviaAdminMapSvg)) !== null) {
    const [, mapLabel, cx, cy, id] = match;
    labelById.set(id, {
      labelName: mapLabel,
      labelX: Number(cx),
      labelY: Number(cy)
    });
  }

  while ((match = pathRegex.exec(boliviaAdminMapSvg)) !== null) {
    const [, path, id, fallbackName] = match;
    if (!BOLIVIA_MAP_CODE_TO_DEPARTMENT[id]) {
      continue;
    }

    const labelPoint = labelById.get(id) || {};
    features.push({
      id,
      department: BOLIVIA_MAP_CODE_TO_DEPARTMENT[id] || fallbackName,
      shortLabel: BOLIVIA_DEPARTMENT_SHORT_LABEL[id] || fallbackName,
      path,
      labelX: Number(labelPoint.labelX || 500),
      labelY: Number(labelPoint.labelY || 500)
    });
  }

  return features;
};

const BOLIVIA_MAP_FEATURES = buildBoliviaMapFeatures();

// Escala secuencial de UN solo tono (azul claro → azul oscuro): la magnitud
// se lee por oscuridad, y el texto con halo blanco contrasta en toda la escala.
const getDepartmentFillColor = (ratio, hasSales) => {
  if (!hasSales) {
    return '#f4f3f0';
  }
  const t = Math.max(0, Math.min(1, ratio));
  const stops = [
    { r: 205, g: 226, b: 251 }, // #cde2fb
    { r: 42, g: 120, b: 214 },  // #2a78d6
    { r: 13, g: 54, b: 107 }    // #0d366b
  ];
  const seg = t < 0.5 ? 0 : 1;
  const local = (t - seg * 0.5) / 0.5;
  const a = stops[seg];
  const b = stops[seg + 1];
  const r = Math.round(a.r + (b.r - a.r) * local);
  const g = Math.round(a.g + (b.g - a.g) * local);
  const bl = Math.round(a.b + (b.b - a.b) * local);
  return `rgb(${r} ${g} ${bl})`;
};

const normalizeText = (value = '') => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const formatCompactBs = (value) => {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return `${Math.round(value)}`;
};

const formatBs = (value) => `${Number(value || 0).toFixed(2)} Bs`;

export default function BoliviaSalesMap({
  salesByDepartment = [],
  topLocations = [],
  title = 'Mapa de Bolivia · Ventas por departamento'
}) {
  const departmentSalesMap = (Array.isArray(salesByDepartment) ? salesByDepartment : []).reduce((acc, row) => {
    const sourceDepartment = String(row.department || '').trim();
    const normalizedDepartment = normalizeText(sourceDepartment);
    const canonicalDepartment = BOLIVIA_DEPARTMENT_MAP[normalizedDepartment] || sourceDepartment;
    // accumulate so a city alias (e.g. "Sucre") sums into its department ("Chuquisaca")
    acc[canonicalDepartment] = (acc[canonicalDepartment] || 0) + Number(row.total_sales || 0);
    return acc;
  }, {});
  const maxDepartmentSales = Math.max(...Object.values(departmentSalesMap), 1);
  const mapFeatureRows = BOLIVIA_MAP_FEATURES.map((feature) => {
    const totalSales = Number(departmentSalesMap[feature.department] || 0);
    const ratio = maxDepartmentSales > 0 ? Math.min(1, totalSales / maxDepartmentSales) : 0;
    const offset = BOLIVIA_LABEL_OFFSETS[feature.id] || { dx: 0, dy: 0 };
    return {
      ...feature,
      totalSales,
      ratio,
      anchorX: feature.labelX,
      anchorY: feature.labelY,
      labelX: feature.labelX + offset.dx,
      labelY: feature.labelY + offset.dy
    };
  });

  const safeTopLocations = Array.isArray(topLocations) ? topLocations : [];

  return (
    <section className="dashboard-card dashboard-map-card">
      <h3>{title}</h3>
      <div className="dashboard-map-wrap">
        <div className="dashboard-bolivia-map">
          <svg
            viewBox="40 20 920 950"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Mapa geográfico de Bolivia por ventas"
            className="dashboard-bolivia-map-svg"
          >
            {mapFeatureRows.map((region) => {
              const fillColor = getDepartmentFillColor(region.ratio, region.totalSales > 0);
              return (
                <g key={region.id}>
                  <path
                    className="dashboard-map-region"
                    d={region.path}
                    style={{ fill: fillColor }}
                  />
                  <line
                    x1={region.anchorX}
                    y1={region.anchorY}
                    x2={region.labelX}
                    y2={region.labelY}
                    className="dashboard-map-label-leader"
                  />
                  <text x={region.labelX} y={region.labelY} className="dashboard-map-region-label">
                    {region.shortLabel}
                  </text>
                  <text x={region.labelX} y={region.labelY + 26} className="dashboard-map-region-value">
                    {formatCompactBs(region.totalSales)} Bs
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="dashboard-map-ranking">
          <h4 className="dashboard-map-ranking-title">Ranking destinos · Departamento → Ciudad</h4>
          {safeTopLocations.length === 0 ? (
            <p className="dashboard-empty">Sin datos este periodo</p>
          ) : (
            <ol className="dashboard-list dashboard-geo-list">
              {safeTopLocations.map((location, index) => (
                <li key={`${location.location}-${index}`}>
                  <div className="dashboard-geo-dept">
                    <strong>{location.location}</strong>
                    <span>{location.order_count} pedido{Number(location.order_count) === 1 ? '' : 's'} · {formatBs(location.total_sales)}</span>
                  </div>
                  {Array.isArray(location.cities) && location.cities.length > 0 && (
                    <ul className="dashboard-geo-cities">
                      {location.cities.map((city, cityIndex) => (
                        <li key={`${city.ciudad}-${cityIndex}`}>
                          <span>{city.ciudad}</span>
                          <span>{formatBs(city.total_sales)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      <div className="dashboard-map-legend">
        <span className="dashboard-map-legend-label">Menor venta</span>
        <span className="dashboard-map-legend-gradient" />
        <span className="dashboard-map-legend-label">Mayor venta</span>
      </div>
    </section>
  );
}
