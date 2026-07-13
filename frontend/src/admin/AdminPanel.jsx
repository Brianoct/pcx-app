import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import UserManagement from './UserManagement';
import ProductCatalogAdmin from './ProductCatalogAdmin';
import EquipmentCatalogAdmin from './EquipmentCatalogAdmin';
import MaterialsCatalogAdmin from './MaterialsCatalogAdmin';
import TimeOffAdminPanel from './TimeOffAdminPanel';
import QualityControlCommissionConfig from './QualityControlCommissionConfig';
import QualityControlRecordsAdmin from './QualityControlRecordsAdmin';
import CommissionConfig from './CommissionConfig';
import PayrollPanel from './PayrollPanel';
import RoleConfiguration from './RoleConfiguration';
import ProductCostingAdmin from './ProductCostingAdmin';
import ProductStructureAdmin from './ProductStructureAdmin';
import SalesAssistant from './SalesAssistant';
import { apiRequest } from '../apiClient';

function AdminPanel({ token, user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiInfo, setAiInfo] = useState(null);
  const baseTabKeys = ['usuarios', 'productos', 'equipos', 'materiales', 'estructura', 'costeo', 'roles', 'comisiones', 'pagos', 'calendario'];
  const tabKeys = aiEnabled ? [...baseTabKeys, 'ventas_ia'] : baseTabKeys;
  const resolveTab = (searchText = '') => {
    const tab = new URLSearchParams(searchText).get('tab');
    return tabKeys.includes(tab) ? tab : 'usuarios';
  };
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
      hint: 'Altas, edición y estado del equipo'
    },
    {
      key: 'roles',
      label: 'Roles',
      icon: 'R',
      hint: 'Permisos por panel y perfil'
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
      key: 'costeo',
      label: 'Costeo',
      icon: '$',
      hint: 'Costo por insumo y utilidad'
    },
    {
      key: 'comisiones',
      label: 'Comisiones',
      icon: 'C',
      hint: 'Reglas por rol y control calidad'
    },
    {
      key: 'pagos',
      label: 'Pagos',
      icon: '$',
      hint: 'QR y datos de pago del equipo'
    },
    {
      key: 'calendario',
      label: 'Calendario',
      icon: 'K',
      hint: 'Permisos y ausencias del equipo'
    },
    ...(aiEnabled ? [{
      key: 'ventas_ia',
      label: 'Ventas IA',
      icon: 'VA',
      hint: 'Vende desde el inbox con ayuda de IA (beta)'
    }] : [])
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
        {activeTab === 'usuarios' && <UserManagement token={token} />}
        {activeTab === 'productos' && <ProductCatalogAdmin token={token} />}
        {activeTab === 'equipos' && <EquipmentCatalogAdmin token={token} />}
        {activeTab === 'materiales' && <MaterialsCatalogAdmin token={token} />}
        {activeTab === 'estructura' && <ProductStructureAdmin token={token} />}
        {activeTab === 'costeo' && <ProductCostingAdmin token={token} />}
        {activeTab === 'roles' && <RoleConfiguration token={token} />}
        {activeTab === 'comisiones' && (
          <div style={{ display: 'grid', gap: '14px' }}>
            <CommissionConfig token={token} />
            <QualityControlCommissionConfig token={token} />
            <QualityControlRecordsAdmin token={token} />
          </div>
        )}
        {activeTab === 'pagos' && <PayrollPanel token={token} />}
        {activeTab === 'calendario' && <TimeOffAdminPanel token={token} />}
        {activeTab === 'ventas_ia' && aiEnabled && <SalesAssistant token={token} user={user} aiInfo={aiInfo} />}
      </div>
    </div>
  );
}

export default AdminPanel;
