// src/MarketingPanel.jsx
import { useState } from 'react';
import Combos from './Combos';
import Cupones from './Cupones';

function MarketingPanel({ token }) {
  const [activeTab, setActiveTab] = useState('combos');

  return (
    <div style={{ padding: '16px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Tabs at the top */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        marginBottom: '32px',
        borderBottom: '2px solid #334155'
      }}>
        <button
          onClick={() => setActiveTab('combos')}
          style={{
            padding: '14px 40px',
            background: 'transparent',
            color: activeTab === 'combos' ? '#f87171' : '#94a3b8',
            border: 'none',
            borderBottom: activeTab === 'combos' ? '4px solid #f87171' : '4px solid transparent',
            fontSize: '1.2rem',
            fontWeight: activeTab === 'combos' ? '600' : '500',
            cursor: 'pointer',
            transition: 'all 0.3s ease'
          }}
        >
          Combos
        </button>

        <button
          onClick={() => setActiveTab('cupones')}
          style={{
            padding: '14px 40px',
            background: 'transparent',
            color: activeTab === 'cupones' ? '#f87171' : '#94a3b8',
            border: 'none',
            borderBottom: activeTab === 'cupones' ? '4px solid #f87171' : '4px solid transparent',
            fontSize: '1.2rem',
            fontWeight: activeTab === 'cupones' ? '600' : '500',
            cursor: 'pointer',
            transition: 'all 0.3s ease'
          }}
        >
          Cupones
        </button>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'combos' && <Combos token={token} />}
        {activeTab === 'cupones' && <Cupones token={token} />}
      </div>
    </div>
  );
}

export default MarketingPanel;