// QuoteTool.jsx
import { useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import logo from './assets/logo.png';

export default function QuoteTool({ token, user }) {
  const regularProducts = [
    { sku: "T6195R", name: "Tablero 61x95 Rojo", sf: 330, cf: 383, isCombo: false },
    { sku: "T6195N", name: "Tablero 61x95 Negro", sf: 330, cf: 383, isCombo: false },
    { sku: "T6195AM", name: "Tablero 61x95 Amarillo", sf: 330, cf: 383, isCombo: false },
    { sku: "T6195AP", name: "Tablero 61x95 Azul Petroleo", sf: 330, cf: 383, isCombo: false },
    { sku: "T6195PL", name: "Tablero 61x95 Plomo", sf: 330, cf: 383, isCombo: false },
    { sku: "T9495R", name: "Tablero 94x95 Rojo", sf: 450, cf: 522, isCombo: false },
    { sku: "T9495N", name: "Tablero 94x95 Negro", sf: 450, cf: 522, isCombo: false },
    { sku: "T9495AM", name: "Tablero 94x95 Amarillo", sf: 450, cf: 522, isCombo: false },
    { sku: "T9495AP", name: "Tablero 94x95 Azul Petroleo", sf: 450, cf: 522, isCombo: false },
    { sku: "T9495PL", name: "Tablero 94x95 Plomo", sf: 450, cf: 522, isCombo: false },
    { sku: "T1099R", name: "Tablero 10x99 Rojo", sf: 105, cf: 122, isCombo: false },
    { sku: "T1099N", name: "Tablero 10x99 Negro", sf: 105, cf: 122, isCombo: false },
    { sku: "T1099AP", name: "Tablero 10x99 Azul Petroleo", sf: 105, cf: 122, isCombo: false },
    { sku: "R40N", name: "Repisa Grande Negro", sf: 85, cf: 99, isCombo: false },
    { sku: "R25N", name: "Repisa Pequeña Negro", sf: 40, cf: 47, isCombo: false },
    { sku: "D40N", name: "Desarmador Grande Negro", sf: 70, cf: 82, isCombo: false },
    { sku: "D22N", name: "Desarmador Pequeño Negro", sf: 45, cf: 53, isCombo: false },
    { sku: "L40N", name: "Llave Grande Negro", sf: 80, cf: 93, isCombo: false },
    { sku: "L22N", name: "Llave Pequeño Negro", sf: 50, cf: 58, isCombo: false },
    { sku: "C15N", name: "Caja Negro", sf: 48, cf: 56, isCombo: false },
    { sku: "M08N", name: "Martillo Negro", sf: 17, cf: 20, isCombo: false },
    { sku: "A15N", name: "Amoladora Negro", sf: 30, cf: 35, isCombo: false },
    { sku: "RR15N", name: "Repisa/Rollo Negro", sf: 90, cf: 105, isCombo: false },
    { sku: "G05C", name: "Gancho 5cm Cromo", sf: 65, cf: 76, isCombo: false },
    { sku: "G10C", name: "Gancho 10cm Cromo", sf: 84, cf: 98, isCombo: false },
  ];

  const [combos, setCombos] = useState([]);

  const [step, setStep] = useState(1);

  const [rows, setRows] = useState([]);
  const [ventaType, setVentaType] = useState('sf');
  const [discountPercent, setDiscountPercent] = useState(0);
  const [roundTotal, setRoundTotal] = useState(false);
  const [useAlternativeName, setUseAlternativeName] = useState(false);
  const [alternativeName, setAlternativeName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [department, setDepartment] = useState('');
  const [provincia, setProvincia] = useState('');
  const [isProvincia, setIsProvincia] = useState(false);
  const [almacen, setAlmacen] = useState('');
  const [shippingNotes, setShippingNotes] = useState('');
  const [currentDateTime, setCurrentDateTime] = useState('');
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (step === 2) {
      const fetchCombos = async () => {
        try {
          const res = await fetch(`${API_BASE}/api/combos`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            setCombos(data);
          } else {
            console.error('Failed to fetch combos:', res.status);
          }
        } catch (err) {
          console.error('Error fetching combos:', err);
        }
      };
      fetchCombos();
    }
  }, [step, token, API_BASE]);

  useEffect(() => {
    if (step === 2 && rows.length === 0) {
      addRow();
    }
  }, [step]);

  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
      const formatter = new Intl.DateTimeFormat('es-BO', options);
      const formatted = formatter.format(now);
      setCurrentDateTime(formatted.charAt(0).toUpperCase() + formatted.slice(1));
    };
    updateDateTime();
    const interval = setInterval(updateDateTime, 60000);
    return () => clearInterval(interval);
  }, []);

  const allItems = [
    ...regularProducts.map(p => ({ ...p, displayName: p.name })),
    ...combos.map(combo => ({
      sku: `COMBO_${combo.id}`,
      displayName: `${combo.name} (Combo)`,
      name: combo.name,
      sf: Number(combo.sf_price) || 0,
      cf: Number(combo.cf_price) || 0,
      isCombo: true,
      comboId: combo.id,
      items: combo.items || []
    }))
  ];

  const findItem = (sku) => allItems.find(item => item.sku === sku);

  const fetchStock = async (sku, store) => {
    if (!sku || !store || sku.startsWith('COMBO_')) return null;
    try {
      const res = await fetch(`${API_BASE}/api/stock?sku=${encodeURIComponent(sku)}&store_location=${encodeURIComponent(store)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.stock;
    } catch (err) {
      console.error('Error fetching stock:', err);
      return null;
    }
  };

  const handleProductSelect = async (rowId, selectedSku) => {
    const item = findItem(selectedSku);
    let availableStock = null;
    if (item && !item.isCombo && almacen) {
      availableStock = await fetchStock(selectedSku, almacen);
    }

    setRows(rows.map(row =>
      row.id === rowId ? {
        ...row,
        sku: selectedSku,
        skuDisplay: item ? item.displayName : selectedSku,
        unitPrice: item ? Number(item.sf || item.cf || 0) : 0,
        lineTotal: item ? Number(item.sf || item.cf || 0) * (row.qty || 0) : 0,
        availableStock,
        isCombo: item?.isCombo || false,
        comboItems: item?.isCombo ? item.items : undefined
      } : row
    ));
  };

  const handleQtyChange = (rowId, newQty) => {
    const qty = newQty === '' ? '' : Math.max(1, parseInt(newQty) || 1);
    setRows(rows.map(row =>
      row.id === rowId ? { ...row, qty, lineTotal: (row.unitPrice || 0) * (qty || 0) } : row
    ));
  };

  const addRow = () => {
    const newRow = { id: Date.now(), sku: '', skuDisplay: '', qty: '', unitPrice: 0, lineTotal: 0, availableStock: null, isCombo: false };
    setRows([...rows, newRow]);
  };

  const confirmAndDeleteRow = (id) => {
    if (window.confirm('¿Eliminar esta línea?')) {
      setRows(rows.filter(r => r.id !== id));
    }
  };

  const subtotal = rows.reduce((sum, r) => sum + (r.lineTotal || 0), 0);

  const discountPercentApplied = subtotal * (discountPercent / 100);
  let total = subtotal - discountPercentApplied;

  if (roundTotal) {
    total = Math.round(total / 10) * 10;
  }

  useEffect(() => {
    setRows(prev => prev.map(row => {
      if (!row.sku) return row;
      const item = findItem(row.sku);
      if (!item) return row;
      const newPrice = ventaType === 'sf' ? Number(item.sf || 0) : Number(item.cf || 0);
      return { ...row, unitPrice: newPrice, lineTotal: newPrice * (row.qty || 0) };
    }));
  }, [ventaType]);

  useEffect(() => {
    if (!almacen || step !== 2) return;
    const refreshStock = async () => {
      for (const row of rows) {
        if (row.sku && !row.isCombo) {
          const stock = await fetchStock(row.sku, almacen);
          setRows(prev => prev.map(r =>
            r.id === row.id ? { ...r, availableStock: stock } : r
          ));
        }
      }
    };
    refreshStock();
  }, [almacen, step]);

  const canSave =
    customerName.trim() &&
    customerPhone.trim() &&
    almacen &&
    rows.length > 0 &&
    rows.every(r => r.sku && r.unitPrice > 0 && r.qty > 0) &&
    (!isProvincia || provincia.trim()) &&
    (isProvincia || department) &&
    (!useAlternativeName || alternativeName.trim());

  const saveAndGeneratePDF = async () => {
    if (!canSave) {
      alert('Completa todos los campos obligatorios del cliente y verifica que todas las líneas tengan producto y cantidad.');
      return;
    }

    const vendedorName = user ? user.email.split('@')[0] : 'Usuario';

    const rowsWithDisplay = rows.map(row => {
      const item = findItem(row.sku);
      return {
        ...row,
        displayName: item ? item.displayName : row.skuDisplay || row.sku
      };
    });

    const expandedRows = [];
    for (const row of rowsWithDisplay) {
      if (row.isCombo) {
        expandedRows.push({
          ...row,
          skuDisplay: row.displayName,
          isComboHeader: true,
          isIndented: false
        });

        row.comboItems?.forEach(comboItem => {
          expandedRows.push({
            sku: comboItem.sku,
            skuDisplay: comboItem.sku + ' (del combo)',
            qty: comboItem.quantity * (row.qty || 1),
            unitPrice: 0,
            lineTotal: 0,
            availableStock: null,
            isIndented: true
          });
        });
      } else {
        expandedRows.push({
          ...row,
          isIndented: false
        });
      }
    }

    const payload = {
      customer_name: customerName,
      customer_phone: customerPhone,
      department: isProvincia ? null : department,
      provincia: isProvincia ? provincia : null,
      shipping_notes: shippingNotes,
      alternative_name: useAlternativeName ? alternativeName.trim() : null,
      store_location: almacen,
      vendor: vendedorName,
      venta_type: ventaType,
      discount_percent: discountPercent,
      discount_bs: 0,
      round_total: roundTotal,
      rows: rowsWithDisplay,
      subtotal,
      total
    };

    try {
      const saveRes = await fetch(`${API_BASE}/api/quotes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!saveRes.ok) {
        const errData = await saveRes.json();
        throw new Error(errData.error || 'No se pudo guardar la cotización');
      }

      const doc = new jsPDF();

      doc.addImage(logo, 'PNG', 15, 10, 50, 20);
      doc.setFontSize(22);
      doc.setTextColor(225, 29, 72);
      doc.text("Cotizacion", 105, 35, { align: "center" });

      doc.setFontSize(11);
      doc.setTextColor(100);
      doc.text(`Vendedor: ${vendedorName}   •   Almacén: ${almacen}`, 20, 50);
      doc.text(`Fecha: ${currentDateTime.split(', ')[1]}`, 20, 57);
      doc.text("Cochabamba, Bolivia.", 20, 64);

      doc.setLineWidth(0.5);
      doc.setDrawColor(225, 29, 72);
      doc.line(20, 68, 190, 68);

      doc.setFontSize(12);
      doc.setTextColor(0);
      doc.text(`Cliente: ${customerName}`, 20, 78);
      doc.text(`Teléfono: ${customerPhone}`, 20, 85);

      if (useAlternativeName && alternativeName.trim()) {
        doc.text(`Enviar a nombre de: ${alternativeName}`, 20, 92);
      }

      const location = isProvincia ? `Provincia: ${provincia || '—'}` : `Departamento: ${department || '—'}`;
      doc.text(location, 20, useAlternativeName ? 99 : 92);

      if (shippingNotes.trim()) {
        doc.setFontSize(10);
        doc.text('Notas de envío:', 20, useAlternativeName ? 106 : 99);
        const splitNotes = doc.splitTextToSize(shippingNotes, 170);
        doc.text(splitNotes, 20, useAlternativeName ? 113 : 106);
      }

      doc.setFillColor(30, 41, 59);
      doc.rect(15, 105, 180, 10, 'F');
      doc.setTextColor(255);
      doc.setFontSize(11);
      doc.text("Descripción", 22, 112);
      doc.text("Cant.", 100, 112, { align: "center" });
      doc.text("P. Unit.", 138, 112, { align: "right" });
      doc.text("Subtotal", 178, 112, { align: "right" });

      doc.setTextColor(0);
      doc.setFontSize(10);
      let y = 122;

      expandedRows.forEach((row) => {
        let desc = row.skuDisplay || row.sku || '—';
        if (desc.length > 48) desc = desc.substring(0, 45) + "...";

        const indent = row.isIndented ? '      ' : '';
        desc = indent + desc;

        if (row.isComboHeader) {
          doc.setFontSize(11);
          doc.setTextColor(225, 29, 72);
        } else if (row.isIndented) {
          doc.setFontSize(9);
          doc.setTextColor(100);
        } else {
          doc.setFontSize(10);
          doc.setTextColor(0);
        }

        doc.text(desc, 22, y);
        doc.text((row.qty || 0).toString(), 100, y, { align: "center" });
        const price = row.unitPrice != null ? Number(row.unitPrice).toFixed(2) : '-';
        doc.text(price, 138, y, { align: "right" });
        const lineTotal = row.lineTotal != null ? Number(row.lineTotal).toFixed(2) : '-';
        doc.text(lineTotal, 178, y, { align: "right" });

        y += row.isIndented ? 7 : 9;
      });

      y += 8;
      doc.setFontSize(12);
      doc.text(`Subtotal: ${subtotal.toFixed(2)} Bs`, 150, y, { align: "right" });
      y += 8;

      if (discountPercentApplied > 0) {
        doc.text(`Descuento (${discountPercent}%): ${discountPercentApplied.toFixed(2)} Bs`, 150, y, { align: "right" });
        y += 8;
      }

      if (roundTotal) {
        doc.text(`Redondeo aplicado`, 150, y, { align: "right" });
        y += 8;
      }

      doc.setLineWidth(0.5);
      doc.setDrawColor(0);
      doc.line(150, y, 190, y);
      y += 8;

      doc.setFontSize(14);
      doc.setTextColor(225, 29, 72);
      doc.text(`TOTAL: ${total.toFixed(2)} Bs`, 150, y, { align: "right" });

      y += 20;
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text("Cotización válida por 7 días", 105, y, { align: "center" });
      y += 7;
      doc.text("PCX - ¡Esperamos servirle nuevamente!", 105, y, { align: "center" });

      doc.save(`cotizacion_${customerName.replace(/\s+/g, '_') || 'sin_nombre'}_${Date.now()}.pdf`);

      alert('Cotización guardada y PDF generado');
    } catch (err) {
      console.error('Error completo al guardar:', err);
      alert('Error al guardar: ' + (err.message || 'Error desconocido'));
    }
  };

  const selectedItemsCount = rows.filter((row) => row.sku).length;
  const totalUnits = rows.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);

  return (
    <div className="container" style={{ paddingTop: '90px' }}>
      <header style={{ textAlign: 'center', marginBottom: '24px' }}>
        {currentDateTime && (
          <div style={{ color: '#9ca3af', fontSize: '1.1rem', fontWeight: '500' }}>
            {currentDateTime}
          </div>
        )}
      </header>

      <div className="quote-stepper">
        <button
          onClick={() => setStep(1)}
          className={`quote-step-btn ${step === 1 ? 'active' : ''}`}
        >
          1. Cliente
        </button>
        <button
          onClick={() => setStep(2)}
          className={`quote-step-btn ${step === 2 ? 'active' : ''}`}
        >
          2. Productos
        </button>
      </div>

      {step === 1 && (
        <div className="card quote-client-card">
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '20px',
            marginBottom: '24px'
          }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>Cliente</label>
              <input
                type="text"
                maxLength={26}
                placeholder="Nombre (máx 26)"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                style={{ width: '100%', padding: '12px', fontSize: '1rem', borderRadius: '8px', border: '1px solid #374151', background: '#0f172a', color: 'white' }}
              />
              <div style={{ fontSize: '0.75rem', textAlign: 'right', color: customerName.length >= 23 ? '#e11d48' : '#9ca3af', marginTop: '4px' }}>
                {customerName.length}/26
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>Teléfono</label>
              <input
                type="tel"
                maxLength={26}
                placeholder="Ej: 77778888 (máx 26)"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                style={{ width: '100%', padding: '12px', fontSize: '1rem', borderRadius: '8px', border: '1px solid #374151', background: '#0f172a', color: 'white' }}
              />
              <div style={{ fontSize: '0.75rem', textAlign: 'right', color: customerPhone.length >= 23 ? '#e11d48' : '#9ca3af', marginTop: '4px' }}>
                {customerPhone.length}/26
              </div>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={isProvincia} onChange={(e) => setIsProvincia(e.target.checked)} />
                Provincia (no departamento)
              </label>
            </div>

            {isProvincia ? (
              <div>
                <label style={{ display: 'block', marginBottom: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>Provincia</label>
                <input
                  type="text"
                  maxLength={26}
                  placeholder="Provincia (máx 26)"
                  value={provincia}
                  onChange={(e) => setProvincia(e.target.value)}
                  style={{ width: '100%', padding: '12px', fontSize: '1rem', borderRadius: '8px', border: '1px solid #374151', background: '#0f172a', color: 'white' }}
                />
                <div style={{ fontSize: '0.75rem', textAlign: 'right', color: provincia.length >= 23 ? '#e11d48' : '#9ca3af', marginTop: '4px' }}>
                  {provincia.length}/26
                </div>
              </div>
            ) : (
              <div>
                <label style={{ display: 'block', marginBottom: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>Departamento</label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '44px',
                    padding: '12px 36px 12px 12px',
                    fontSize: '1rem',
                    borderRadius: '8px',
                    border: '1px solid #374151',
                    background: '#0f172a',
                    color: 'white',
                    appearance: 'none',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%239ca3af' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 12px center',
                    backgroundSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  <option value="" disabled>Departamento</option>
                  <option value="Beni">Beni</option>
                  <option value="Chuquisaca">Chuquisaca</option>
                  <option value="Cochabamba">Cochabamba</option>
                  <option value="La Paz">La Paz</option>
                  <option value="Oruro">Oruro</option>
                  <option value="Pando">Pando</option>
                  <option value="Potosí">Potosí</option>
                  <option value="Santa Cruz">Santa Cruz</option>
                  <option value="Tarija">Tarija</option>
                </select>
              </div>
            )}

            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>Almacén</label>
              <select
                value={almacen}
                onChange={(e) => setAlmacen(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '44px',
                  padding: '12px 36px 12px 12px',
                  fontSize: '1rem',
                  borderRadius: '8px',
                  border: '1px solid #374151',
                  background: '#0f172a',
                  color: 'white',
                  appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%239ca3af' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 12px center',
                  backgroundSize: '12px',
                  cursor: 'pointer'
                }}
              >
                <option value="" disabled>Almacén</option>
                <option value="Cochabamba">Cochabamba</option>
                <option value="Lima">Lima</option>
                <option value="Santa Cruz">Santa Cruz</option>
              </select>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={useAlternativeName} onChange={(e) => setUseAlternativeName(e.target.checked)} />
                Enviar a nombre diferente
              </label>
              {useAlternativeName && (
                <input
                  type="text"
                  maxLength={26}
                  placeholder="Nombre alternativo para envío"
                  value={alternativeName}
                  onChange={(e) => setAlternativeName(e.target.value)}
                  style={{ width: '100%', padding: '12px', marginTop: '8px', fontSize: '1rem', borderRadius: '8px', border: '1px solid #374151', background: '#0f172a', color: 'white' }}
                />
              )}
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>
              Notas de envío (opcional, máx 26)
            </label>
            <textarea
              maxLength={26}
              placeholder="Instrucciones, referencias..."
              value={shippingNotes}
              onChange={(e) => setShippingNotes(e.target.value)}
              rows={3}
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '1rem',
                borderRadius: '8px',
                border: '1px solid #374151',
                background: '#0f172a',
                color: 'white',
                resize: 'vertical'
              }}
            />
            <div style={{ fontSize: '0.75rem', textAlign: 'right', color: shippingNotes.length >= 23 ? '#e11d48' : '#9ca3af', marginTop: '4px' }}>
              {shippingNotes.length}/26
            </div>
          </div>

          <button
            onClick={() => setStep(2)}
            style={{
              width: '100%',
              padding: '14px',
              background: '#e11d48',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '1.1rem',
              cursor: 'pointer'
            }}
          >
            Siguiente: Productos →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="card quote-products-card">
          <div className="quote-products-toolbar">
            <div className="quote-sale-type-group">
              <button
                type="button"
                className={`quote-sale-type-btn ${ventaType === 'sf' ? 'active' : ''}`}
                onClick={() => setVentaType('sf')}
              >
                Sin Factura
              </button>
              <button
                type="button"
                className={`quote-sale-type-btn ${ventaType === 'cf' ? 'active' : ''}`}
                onClick={() => setVentaType('cf')}
              >
                Con Factura
              </button>
            </div>

            <button
              type="button"
              onClick={addRow}
              className="btn btn-secondary"
            >
              + Agregar línea
            </button>
          </div>

          <div className="quote-products-meta">
            <span>Líneas: <strong>{rows.length}</strong></span>
            <span>Productos: <strong>{selectedItemsCount}</strong></span>
            <span>Unidades: <strong>{totalUnits}</strong></span>
          </div>

          {isMobile ? (
            <div className="mobile-cards-list" style={{ marginBottom: '20px' }}>
              {rows.map((row) => {
                const stock = row.availableStock;
                const stockDisplay = row.isCombo ? 'Combo' : (stock === null ? 'Cargando...' : stock);
                const stockColor = row.isCombo ? '#e11d48' : (stock === null ? '#9ca3af' : Number(stock) > 0 ? '#10b981' : '#ef4444');

                return (
                  <div key={row.id} className="mobile-card">
                    <div className="mobile-card-header">
                      <span className="mobile-card-id">Línea #{rows.indexOf(row) + 1}</span>
                      <span className="mobile-card-total">{(row.lineTotal || 0).toFixed(2)} Bs</span>
                    </div>

                    <div className="mobile-card-body">
                      <div>
                        <label className="mobile-card-label">Producto / Combo</label>
                        <select
                          value={row.sku || ''}
                          onChange={(e) => handleProductSelect(row.id, e.target.value)}
                          className="mobile-select"
                          style={{ width: '100%', marginTop: '6px' }}
                        >
                          <option value="">Seleccionar producto / combo...</option>
                          {allItems.map((item) => (
                            <option key={item.sku} value={item.sku}>
                              {item.displayName}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="mobile-card-row">
                        <span className="mobile-card-label">Cantidad</span>
                        <input
                          type="number"
                          min="1"
                          value={row.qty}
                          onChange={(e) => handleQtyChange(row.id, e.target.value)}
                          className="mobile-select"
                          style={{ width: '90px', textAlign: 'center', flex: '0 0 90px' }}
                        />
                      </div>

                      <div className="mobile-card-row">
                        <span className="mobile-card-label">Disponibilidad</span>
                        <span style={{ color: stockColor, fontWeight: 700 }}>{stockDisplay}</span>
                      </div>

                      <div className="mobile-card-row">
                        <span className="mobile-card-label">Precio unitario</span>
                        <span>{(row.unitPrice || 0).toFixed(2)} Bs</span>
                      </div>
                    </div>

                    <div className="mobile-card-actions">
                      <button className="btn btn-danger" onClick={() => confirmAndDeleteRow(row.id)}>
                        Eliminar línea
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                <thead>
                  <tr style={{ background: '#111827' }}>
                    <th style={{ padding: '12px', textAlign: 'left' }}>Producto / Combo</th>
                    <th style={{ padding: '12px', width: '80px' }}>Cant.</th>
                    <th style={{ padding: '12px', width: '80px', textAlign: 'center' }}>Disp.</th>
                    <th style={{ padding: '12px', width: '100px', textAlign: 'right' }}>Unit.</th>
                    <th style={{ padding: '12px', width: '120px', textAlign: 'right' }}>Subt.</th>
                    <th style={{ padding: '12px', width: '60px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>
                        Agrega líneas arriba
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const stock = row.availableStock;
                      const stockDisplay = row.isCombo ? 'Combo' : (stock === null ? 'Cargando...' : stock);
                      const stockColor = row.isCombo ? '#e11d48' : (stock === null ? '#9ca3af' : '#10b981');

                      return (
                        <tr key={row.id} style={{ borderBottom: '1px solid #374151' }}>
                          <td style={{ padding: '12px' }}>
                            <select
                              value={row.sku || ''}
                              onChange={(e) => handleProductSelect(row.id, e.target.value)}
                              style={{ width: '100%', padding: '10px', fontSize: '0.95rem', borderRadius: '6px', border: '1px solid #374151', background: '#0f172a', color: 'white' }}
                            >
                              <option value="">Seleccionar producto / combo...</option>
                              {allItems.map(item => (
                                <option key={item.sku} value={item.sku}>
                                  {item.displayName}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '12px' }}>
                            <input
                              type="number"
                              min="1"
                              value={row.qty}
                              onChange={(e) => handleQtyChange(row.id, e.target.value)}
                              style={{ width: '100%', padding: '10px', fontSize: '0.95rem', textAlign: 'center', borderRadius: '6px', border: '1px solid #374151', background: '#0f172a', color: 'white' }}
                            />
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center', color: stockColor, fontWeight: '600' }}>
                            {stockDisplay}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right' }}>
                            {(row.unitPrice || 0).toFixed(2)}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', fontWeight: '600' }}>
                            {(row.lineTotal || 0).toFixed(2)}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center' }}>
                            <button
                              onClick={() => confirmAndDeleteRow(row.id)}
                              style={{ background: 'transparent', border: 'none', color: '#ef4444', fontSize: '1.4rem', cursor: 'pointer' }}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Summary - only % discount and rounding */}
          <div className="quote-summary-panel" style={{
            position: 'sticky',
            bottom: 0,
            left: 0,
            right: 0,
            background: '#0f172a',
            padding: '16px',
            borderTop: '1px solid #374151',
            boxShadow: '0 -4px 12px rgba(0,0,0,0.4)',
            zIndex: 10
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <small style={{ color: '#9ca3af' }}>Subtotal</small>
                <div style={{ fontSize: '1.4rem', fontWeight: '600' }}>{subtotal.toFixed(2)} Bs</div>
              </div>

              <div>
                <small style={{ color: '#9ca3af' }}>Descuento %</small>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button onClick={() => setDiscountPercent(Math.max(0, discountPercent - 1))} style={{ padding: '8px 12px', background: '#374151', color: 'white', border: 'none', borderRadius: '6px' }}>-</button>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={discountPercent}
                    onChange={(e) => {
                      let v = parseInt(e.target.value) || 0;
                      v = Math.max(0, Math.min(10, v));
                      setDiscountPercent(v);
                    }}
                    style={{ width: '60px', padding: '8px', textAlign: 'center', background: '#0f172a', color: 'white', border: '1px solid #374151', borderRadius: '6px' }}
                  />
                  <button onClick={() => setDiscountPercent(Math.min(10, discountPercent + 1))} style={{ padding: '8px 12px', background: '#374151', color: 'white', border: 'none', borderRadius: '6px' }}>+</button>
                </div>
                <span style={{ color: '#e11d48', fontWeight: '600' }}>{discountPercentApplied.toFixed(2)} Bs</span>
              </div>

              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#9ca3af', fontSize: '0.9rem' }}>
                  <input type="checkbox" checked={roundTotal} onChange={(e) => setRoundTotal(e.target.checked)} />
                  Redondear total
                </label>
                <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#e11d48' }}>
                  {total.toFixed(2)} Bs
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={!canSave}
              onClick={saveAndGeneratePDF}
              className="btn btn-primary"
              style={{
                width: '100%',
                marginTop: '16px',
                fontSize: '1.1rem',
                fontWeight: '600',
                opacity: canSave ? 1 : 0.6,
                cursor: canSave ? 'pointer' : 'not-allowed'
              }}
            >
              Guardar y generar PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}