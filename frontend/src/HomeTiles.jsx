// Inicio nuevo: la pantalla de entrada como «puerta» y no como tablero.
// Un cuadro «Describe lo que necesitas» que propone a dónde ir (y confirma
// antes de abrir) y ocho mosaicos grandes con lo más usado, según permisos.
// Lo demás que la persona puede ver queda en la fila «Más».
// Por ahora el cuadro entiende frases por palabras clave; la versión con
// modelo (preguntas a la base, dictado) viene después.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { allowsAny, getSidebarSections } from './navConfig';
import iconCotizar from './assets/home/cotizar.png';
import iconPedidos from './assets/home/pedidos.png';
import iconKanban from './assets/home/kanban.png';
import iconInventario from './assets/home/inventario.png';
import iconWhatsapp from './assets/home/whatsapp.png';
import iconClientes from './assets/home/clientes.png';
import iconCosteo from './assets/home/costeo.png';
import iconFacturacion from './assets/home/facturacion.png';

// Mosaicos en orden de prioridad; cada uno lleva el permiso que lo habilita
// (mismo criterio que el menú lateral). Se muestran los primeros ocho que la
// persona puede ver.
const TILES = [
  { path: '/cotizar', label: 'Cotizar', icon: iconCotizar, access: ['cotizar'], hot: true },
  { path: '/pedidos', label: 'Pedidos', icon: iconPedidos, access: ['pedidos_individual', 'pedidos_global'] },
  { path: '/produccion-kanban', label: 'Producción', icon: iconKanban, access: ['produccion_kanban'], hot: true },
  { path: '/inventory', label: 'Inventario', icon: iconInventario, access: ['inventario_individual', 'inventario_global'] },
  { path: '/whatsapp', label: 'WhatsApp', icon: iconWhatsapp, access: ['cotizar'] },
  { path: '/crm', label: 'Clientes', icon: iconClientes, access: ['cotizar', 'historial_global', 'clientes_lectura'] },
  { path: '/admin?tab=estructura', navPath: '/admin', label: 'Admin costeo', icon: iconCosteo, access: ['admin'] },
  { path: '/history', label: 'Historial', icon: iconFacturacion, access: ['historial_individual', 'historial_global'] },
  { path: '/calendario', label: 'Plan del día', icon: iconPedidos, access: ['calendario'] },
  { path: '/produccion-planificacion', label: 'Planificación', icon: iconKanban, access: ['produccion_kanban'] },
  { path: '/sitio-web', label: 'Sitio web', icon: iconFacturacion, access: ['sitio_web'] },
  { path: '/campanas', label: 'Campañas', icon: iconClientes, access: ['campanas_live'] },
  { path: '/mejoras', label: 'Mejoras', icon: iconCosteo, access: ['proyectos_panel'] },
  { path: '/gastos', label: 'Gastos', icon: iconFacturacion, access: ['gastos_panel'] }
];

// Intérprete por palabras clave: frase → destino. Devuelve null si no sabe.
const RULES = [
  { test: /pedido|despach|env[ií]o/, path: '/pedidos', label: 'Pedidos' },
  { test: /cotiz|proforma|presupuesto/, path: '/cotizar', label: 'Cotizar' },
  { test: /stock|inventario|cu[aá]nt[oa]s? .*(hay|quedan)|existencia/, path: '/inventory', label: 'Inventario' },
  { test: /whatsapp|mensaje|chat/, path: '/whatsapp', label: 'WhatsApp' },
  { test: /cliente|crm/, path: '/crm', label: 'Clientes' },
  { test: /lote|kanban|producci|atrasad/, path: '/produccion-kanban', label: 'Producción' },
  { test: /planific/, path: '/produccion-planificacion', label: 'Planificación' },
  { test: /venta|vendi|estad[ií]stica|rentabil|margen/, path: '/dashboard', label: 'Estadísticas' },
  { test: /historial|hist[oó]rico|factur/, path: '/history', label: 'Historial' },
  { test: /gasto/, path: '/gastos', label: 'Gastos' },
  { test: /compra|proveedor/, path: '/comprar', label: 'Compras' },
  { test: /costeo|estructura|material|equipo/, path: '/admin?tab=estructura', label: 'Admin costeo' },
  { test: /mejora|kaizen/, path: '/mejoras', label: 'Mejoras' },
  { test: /bono/, path: '/bono', label: 'Bono' },
  { test: /plan del d[ií]a|tarea|calendario|hoy/, path: '/calendario', label: 'Plan del día' },
  { test: /campa|live/, path: '/campanas', label: 'Campañas' },
  { test: /promo|cup[oó]n|sorteo/, path: '/promos', label: 'Promos' },
  { test: /sitio|p[aá]gina web|landing/, path: '/sitio-web', label: 'Sitio web' },
  { test: /usuario|permiso|admin/, path: '/admin', label: 'Admin' },
  { test: /perfil|contrase/, path: '/perfil', label: 'Perfil' }
];

const firstName = (user) => String(user?.display_name || user?.email || '').trim().split(/[\s@]/)[0] || '';

export default function HomeTiles({ user, access, features }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  // Todo lo que esta persona puede abrir (mismo filtro que el menú lateral).
  const visible = useMemo(() => {
    const items = getSidebarSections(access, features).flatMap((s) => s.items);
    return new Map(items.map((i) => [i.to, i.label]));
  }, [access, features]);

  const tiles = useMemo(
    () => TILES.filter((t) => visible.has(t.navPath || t.path) && allowsAny(access, t.access)).slice(0, 8),
    [visible, access]
  );
  const more = useMemo(() => {
    const used = new Set(tiles.map((t) => t.navPath || t.path));
    return [...visible.entries()].filter(([path]) => path !== '/' && !used.has(path)).map(([to, label]) => ({ to, label }));
  }, [visible, tiles]);

  const suggestion = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return null;
    const rule = RULES.find((r) => r.test.test(text));
    if (!rule) return { unknown: true };
    const navPath = rule.path.split('?')[0];
    if (!visible.has(navPath)) return { unknown: true, label: rule.label };
    return rule;
  }, [query, visible]);

  const open = (path) => navigate(path);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setQuery(''); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = (e) => {
    e.preventDefault();
    if (suggestion && !suggestion.unknown) open(suggestion.path);
  };

  return (
    <div className="home">
      <section className="home-hello">
        <h1>Hola, {firstName(user)}</h1>
        <p>Lo que necesitas hoy, empieza aquí.</p>
      </section>

      <form className="home-ask" onSubmit={submit}>
        <input
          id="home-ask-input"
          type="text"
          autoComplete="off"
          placeholder="Describe lo que necesitas… (p. ej. pedidos pendientes, cotizar, stock)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="home-go" disabled={!suggestion || suggestion.unknown}>Sí</button>
      </form>
      <div className="home-suggest" aria-live="polite">
        {suggestion && (suggestion.unknown ? (
          <div className="home-suggest-card">
            {suggestion.label
              ? <span>«{suggestion.label}» no está en tus accesos.</span>
              : <span>No estoy seguro. Elige un mosaico o prueba con «pedidos», «cotizar» o «stock».</span>}
          </div>
        ) : (
          <div className="home-suggest-card">
            <span>Abrir <strong>{suggestion.label}</strong>, ¿sí?</span>
            <span className="home-suggest-actions">
              <button type="button" className="is-primary" onClick={() => open(suggestion.path)}>Sí, abrir</button>
              <button type="button" onClick={() => setQuery('')}>No</button>
            </span>
          </div>
        ))}
      </div>

      <div className="home-tiles">
        {tiles.map((t) => (
          <button key={t.path} type="button" className={`home-tile ${t.hot ? 'is-hot' : ''}`} onClick={() => open(t.path)}>
            <img src={t.icon} alt="" />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {more.length > 0 && (
        <nav className="home-more" aria-label="Más secciones">
          <span className="home-more-label">Más →</span>
          {more.map((m) => (
            <button key={m.to} type="button" onClick={() => open(m.to)}>{m.label}</button>
          ))}
        </nav>
      )}
    </div>
  );
}
