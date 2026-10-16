import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import UsersRolesAdmin from './UsersRolesAdmin';
import ProductCatalogAdmin from './ProductCatalogAdmin';
import EquipmentCatalogAdmin from './EquipmentCatalogAdmin';
import MaterialsCatalogAdmin from './MaterialsCatalogAdmin';
import ProductStructureAdmin from './ProductStructureAdmin';
import GeoDestinosAdmin from './GeoDestinosAdmin';
import PlanningAdmin from './PlanningAdmin';
import PanelsAdmin from './PanelsAdmin';
import LoginAuditAdmin from './LoginAuditAdmin';
import SalesAssistant from './SalesAssistant';
import PipelineBoard from '../crm/PipelineBoard';
import { apiRequest } from '../apiClient';
import AdminIcon from './AdminIcons';

function AdminPanel({ token, user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiInfo, setAiInfo] = useState(null);
  // Ventas IA siempre visible: el Embudo funciona sin IA configurada; el
  // sub-tab de WhatsApp+IA aparece solo cuando la IA está habilitada.
  const tabKeys = ['usuarios', 'productos', 'equipos', 'materiales', 'estructura', 'destinos', 'programas', 'paneles', 'accesos', 'ventas_ia'];
  const [ventasView, setVentasView] = useState('embudo');
  const resolveTab = (searchText = '') => {
    const tab = new URLSearchParams(searchText).get('tab');
    return tabKeys.includes(tab) ? tab : 'usuarios';
  };
  // Old top-level tabs that now live as sub-views inside Usuarios: deep-links
  // keep working by opening the hub on the right sub-view.
  const legacyUserView = { roles: 'permisos', comisiones: 'comisiones', pagos: 'pagos' }[
    new URLSearchParams(location.search).get('tab')
  ] || null;
  const [activeTab, setActiveTab] = useState(() => resolveTab(location.search));

  useEffect(() => {
    let active = true;
    apiRequest('/api/ai/assistant/access', { token })
      .then((res) => {
        if (!active) return;
        setAiEnabled(Boolean(res?.enabled));
        setAiInfo(res || null);
      })
      .catch(() => { if (active) { setAiEnabled(false); setAiInfo(null); } });
    return () => { active = false; };
  }, [token]);
  // Secciones agrupadas por lo que resuelven. Cada grupo tiene su color:
  // el riel y el encabezado lo usan para que se vea de un vistazo dónde estás.
  const groups = [
    {
      key: 'equipo',
      label: 'Equipo y accesos',
      color: '#7c3aed',
      tabs: [
        { key: 'usuarios', label: 'Usuarios', hint: 'Equipo, permisos, comisiones y pagos' },
        { key: 'paneles', label: 'Paneles', hint: 'Tableros por área y metas de ventas' },
        { key: 'accesos', label: 'Accesos', hint: 'Historial de logins y dispositivos' }
      ]
    },
    {
      key: 'costeo',
      label: 'Catálogo y costeo',
      color: '#ea580c',
      tabs: [
        { key: 'productos', label: 'Productos', hint: 'Catálogo usado por el cotizador' },
        { key: 'estructura', label: 'Estructura', hint: 'Ruta, materiales y costo derivado' },
        { key: 'equipos', label: 'Equipos', hint: 'Maquinaria y costo por hora' },
        { key: 'materiales', label: 'Materiales', hint: 'Insumos y costo por unidad' }
      ]
    },
    {
      key: 'operacion',
      label: 'Operación',
      color: '#0d9488',
      tabs: [
        { key: 'programas', label: 'Programas', hint: 'Planificación: operación → misión → tarea' },
        { key: 'destinos', label: 'Destinos', hint: 'Clasificación de destinos de envío' },
        { key: 'ventas_ia', label: 'Ventas IA', hint: 'Embudo de ventas y asistente con IA' }
      ]
    }
  ];
  const tabs = groups.flatMap((group) => group.tabs.map((tab) => ({ ...tab, group })));
  const activeTabMeta = tabs.find((tab) => tab.key === activeTab) || tabs[0];

  useEffect(() => {
    const nextTab = resolveTab(location.search);
    if (nextTab !== activeTab) {
      setActiveTab(nextTab);
    }
  }, [location.search, activeTab]);

  const changeTab = (nextTab) => {
    const safeTab = tabKeys.includes(nextTab) ? nextTab : 'usuarios';
    setActiveTab(safeTab);
    navigate(`/admin?tab=${safeTab}`, { replace: false });
  };

  return (
    <div className="admin-shell">
      <aside className="admin-rail" aria-label="Secciones del panel admin">
        <p className="admin-rail-title">Centro de control</p>
        {groups.map((group) => (
          <div key={group.key} className="admin-rail-group" style={{ '--g': group.color }}>
            <p className="admin-rail-group-title">{group.label}</p>
            <div className="admin-rail-items" role="tablist" aria-label={group.label}>
              {group.tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  className={`admin-rail-item ${activeTab === tab.key ? 'is-active' : ''}`}
                  onClick={() => changeTab(tab.key)}
                  title={tab.hint}
                >
                  <span className="admin-rail-icon"><AdminIcon name={tab.key} /></span>
                  <span className="admin-rail-text">
                    <strong>{tab.label}</strong>
                    <small>{tab.hint}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </aside>

      <section className="admin-main">
        <header className="admin-section-head" style={{ '--g': activeTabMeta.group.color }}>
          <span className="admin-section-icon"><AdminIcon name={activeTabMeta.key} size={28} /></span>
          <div>
            <p className="admin-section-eyebrow">{activeTabMeta.group.label}</p>
            <h2 className="admin-section-title">{activeTabMeta.label}</h2>
            <p className="admin-section-hint">{activeTabMeta.hint}</p>
          </div>
        </header>

      <div className="admin-content-shell">
        {activeTab === 'usuarios' && <UsersRolesAdmin token={token} initialView={legacyUserView} />}
        {activeTab === 'productos' && <ProductCatalogAdmin token={token} />}
        {activeTab === 'equipos' && <EquipmentCatalogAdmin token={token} />}
        {activeTab === 'materiales' && <MaterialsCatalogAdmin token={token} />}
        {activeTab === 'estructura' && <ProductStructureAdmin token={token} />}
        {activeTab === 'destinos' && <GeoDestinosAdmin token={token} />}
        {activeTab === 'programas' && <PlanningAdmin token={token} />}
        {activeTab === 'paneles' && <PanelsAdmin token={token} />}
        {activeTab === 'accesos' && <LoginAuditAdmin token={token} />}
        {activeTab === 'ventas_ia' && (
          <div>
            <div className="admin-subtabs" role="tablist" aria-label="Embudo y asistente de ventas">
              <button
                type="button"
                className={`admin-subtab ${ventasView === 'embudo' ? 'is-active' : ''}`}
                onClick={() => setVentasView('embudo')}
              >
                Embudo
              </button>
              {aiEnabled && (
                <button
                  type="button"
                  className={`admin-subtab ${ventasView === 'whatsapp' ? 'is-active' : ''}`}
                  onClick={() => setVentasView('whatsapp')}
                >
                  WhatsApp + IA
                </button>
              )}
            </div>
            {(ventasView === 'embudo' || !aiEnabled) && <PipelineBoard token={token} />}
            {ventasView === 'whatsapp' && aiEnabled && <SalesAssistant token={token} user={user} aiInfo={aiInfo} />}
          </div>
        )}
      </div>
      </section>
    </div>
  );
}

export default AdminPanel;
