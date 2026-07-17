import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import UsersRolesAdmin from './UsersRolesAdmin';
import ProductCatalogAdmin from './ProductCatalogAdmin';
import EquipmentCatalogAdmin from './EquipmentCatalogAdmin';
import MaterialsCatalogAdmin from './MaterialsCatalogAdmin';
import ProductStructureAdmin from './ProductStructureAdmin';
import SalesAssistant from './SalesAssistant';
import PipelineBoard from '../crm/PipelineBoard';
import { apiRequest } from '../apiClient';

function AdminPanel({ token, user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiInfo, setAiInfo] = useState(null);
  // Ventas IA siempre visible: el Embudo funciona sin IA configurada; el
  // sub-tab de WhatsApp+IA aparece solo cuando la IA está habilitada.
  const tabKeys = ['usuarios', 'productos', 'equipos', 'materiales', 'estructura', 'ventas_ia'];
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
  const tabs = [
    {
      key: 'usuarios',
      label: 'Usuarios',
      icon: 'U',
      hint: 'Equipo, permisos, comisiones y pagos'
    },
    {
      key: 'productos',
      label: 'Productos',
      icon: 'P',
      hint: 'Catálogo usado por cotizador'
    },
    {
      key: 'equipos',
      label: 'Equipos',
      icon: 'EQ',
      hint: 'Maquinaria y costos base'
    },
    {
      key: 'materiales',
      label: 'Materiales',
      icon: 'MT',
      hint: 'Insumos y costos por unidad'
    },
    {
      key: 'estructura',
      label: 'Estructura',
      icon: 'ES',
      hint: 'Ruta, materiales y costo derivado'
    },
    {
      key: 'ventas_ia',
      label: 'Ventas IA',
      icon: 'VA',
      hint: 'Embudo de ventas y asistente con IA'
    }
  ];
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
      <div className="admin-hero-card">
        <div>
          <p className="admin-hero-eyebrow">Administración PCX</p>
          <h2 className="admin-hero-title">Centro de control</h2>
          <p className="admin-hero-subtitle">
            Gestiona usuarios, permisos, catálogo y comisiones desde una sola vista clara.
          </p>
        </div>
        <div className="admin-active-section-badge">
          <span>Sección activa</span>
          <strong>{activeTabMeta.label}</strong>
        </div>
      </div>

      <div className="admin-tabs-nav" role="tablist" aria-label="Secciones del panel admin">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`admin-tab-btn ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => changeTab(tab.key)}
          >
            <span className="admin-tab-icon" aria-hidden="true">{tab.icon}</span>
            <span className="admin-tab-content">
              <strong>{tab.label}</strong>
              <small>{tab.hint}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="admin-mobile-tab-select">
        <label htmlFor="admin-tab-select">Sección</label>
        <select
          id="admin-tab-select"
          value={activeTab}
          onChange={(e) => changeTab(e.target.value)}
        >
          {tabs.map((tab) => (
            <option key={tab.key} value={tab.key}>{tab.label}</option>
          ))}
        </select>
      </div>

      <div className="admin-content-shell">
        {activeTab === 'usuarios' && <UsersRolesAdmin token={token} initialView={legacyUserView} />}
        {activeTab === 'productos' && <ProductCatalogAdmin token={token} />}
        {activeTab === 'equipos' && <EquipmentCatalogAdmin token={token} />}
        {activeTab === 'materiales' && <MaterialsCatalogAdmin token={token} />}
        {activeTab === 'estructura' && <ProductStructureAdmin token={token} />}
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
    </div>
  );
}

export default AdminPanel;
