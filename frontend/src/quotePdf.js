import jsPDF from 'jspdf';
import logoAsset from './assets/logo.png';

const BRAND_RED = [225, 29, 72];
const TEXT_DARK = [15, 23, 42];
const TEXT_MUTED = [100, 116, 139];
const BORDER_SOFT = [226, 232, 240];
const BG_SOFT = [248, 250, 252];

// The raw logo is RGBA; jsPDF composites its alpha unpredictably (black
// boxes / red smears) and the old fixed 34×14 box squashed it. Pre-render it
// once onto a white canvas at natural size and keep the real aspect ratio.
let logoPrepared = null;
if (typeof window !== 'undefined') {
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      logoPrepared = {
        dataUrl: canvas.toDataURL('image/png'),
        ratio: img.naturalWidth / img.naturalHeight
      };
    } catch { /* PDF simply renders without logo */ }
  };
  img.src = logoAsset;
}

const toMoney = (value) => Number(value || 0).toFixed(2);

const truncate = (value = '', max = 56) => {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

const normalizeLabel = (value = '') => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

const buildSkuNameDescription = (row = {}) => {
  const sku = String(row?.sku || '').trim().toUpperCase();
  const name = String(row?.displayName || row?.productName || row?.skuDisplay || '').trim();
  if (sku && name) {
    const normalizedSku = normalizeLabel(sku);
    const normalizedName = normalizeLabel(name);
    if (normalizedName === normalizedSku || normalizedName.startsWith(`${normalizedSku} -`)) {
      return name;
    }
    return `${sku} - ${name}`;
  }
  return name || sku || '—';
};

export function generateModernQuotePdf({
  logo,
  filename,
  quoteNumber,
  customerName,
  customerPhone,
  vendorName,
  storeLocation,
  dateText,
  cityText,
  department,
  provincia,
  ciudad,
  shippingNotes,
  alternativeName,
  alternativePhone,
  rows = [],
  subtotal = 0,
  discountPercent = 0,
  discountAmount,
  accessoryDiscount = null,
  total = 0,
  deliveryFee = null,
  promos = [],
  autoSave = true
}) {
  const doc = new jsPDF();

  const pageW = 210;
  const pageH = 297;
  const left = 14;
  const right = 196;
  const tableW = right - left;

  const drawTopBar = () => {
    doc.setFillColor(...BRAND_RED);
    doc.rect(0, 0, pageW, 3, 'F');
  };

  const drawTableHeader = (y, continuation = false) => {
    doc.setFillColor(30, 41, 59);
    doc.roundedRect(left, y, tableW, 9, 1.5, 1.5, 'F');
    doc.rect(left, y + 4, tableW, 5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(continuation ? 'Descripción (continuación)' : 'Descripción', left + 3, y + 6);
    doc.text('Cant.', 128, y + 6, { align: 'center' });
    doc.text('P. Unit.', 160, y + 6, { align: 'right' });
    doc.text('Subtotal', right - 3, y + 6, { align: 'right' });
    doc.setFillColor(...BRAND_RED);
    doc.rect(left, y + 9, tableW, 0.8, 'F');
    return y + 9.8;
  };

  drawTopBar();

  // Logo at its REAL aspect ratio, pre-composited on white (no black box).
  if (logoPrepared) {
    const logoH = 13;
    const logoW = Math.min(46, logoH * logoPrepared.ratio);
    doc.addImage(logoPrepared.dataUrl, 'PNG', left, 9, logoW, logoH);
  } else if (logo) {
    doc.addImage(logo, 'PNG', left, 9, 35.5, 13);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(21);
  doc.setTextColor(...TEXT_DARK);
  doc.text('COTIZACIÓN', right, 16, { align: 'right' });

  if (quoteNumber != null && quoteNumber !== '') {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...BRAND_RED);
    doc.text(`Nro ${quoteNumber}`, right, 22.5, { align: 'right' });
  }

  doc.setDrawColor(...BORDER_SOFT);
  doc.setLineWidth(0.4);
  doc.line(left, 25.5, right, 25.5);

  const metaChips = [
    `Vendedor: ${vendorName || '—'}`,
    `Almacén: ${storeLocation || '—'}`,
    `Fecha: ${dateText || '—'}`
  ];

  let chipX = left;
  let chipY = 33;
  metaChips.forEach((chip) => {
    const chipW = doc.getTextWidth(chip) + 8;
    if (chipX + chipW > right) {
      chipX = left;
      chipY += 8;
    }
    doc.setFillColor(...BG_SOFT);
    doc.setDrawColor(...BORDER_SOFT);
    doc.roundedRect(chipX, chipY - 4.5, chipW, 6.5, 1.6, 1.6, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_DARK);
    doc.text(chip, chipX + 4, chipY);
    chipX += chipW + 4;
  });

  // Destino canonico: "Quillacollo, Cochabamba". Legacy: provincia o departamento.
  const locationText = ciudad
    ? `${ciudad}, ${department || provincia || '—'}`
    : (provincia ? `Provincia: ${provincia}` : `Departamento: ${department || '—'}`);
  const dispatchSourceText = storeLocation ? `Almacén: ${storeLocation}` : (cityText || '—');

  let cursorY = chipY + 8;
  doc.setFillColor(...BG_SOFT);
  doc.setDrawColor(...BORDER_SOFT);
  doc.roundedRect(left, cursorY, tableW, 24, 2, 2, 'FD');

  // Red accent on the client card's left edge.
  doc.setFillColor(...BRAND_RED);
  doc.roundedRect(left, cursorY, 1.6, 24, 0.8, 0.8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('CLIENTE', left + 5, cursorY + 6);
  doc.text('TELÉFONO', 106, cursorY + 6);
  doc.text('UBICACIÓN', left + 5, cursorY + 16);
  doc.text('ORIGEN', 106, cursorY + 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...TEXT_DARK);
  doc.text(truncate(customerName || '—', 28), left + 5, cursorY + 11);
  doc.text(truncate(customerPhone || '—', 24), 106, cursorY + 11);
  doc.text(truncate(locationText, 30), left + 5, cursorY + 21);
  doc.text(truncate(dispatchSourceText, 30), 106, cursorY + 21);

  cursorY += 28;

  const altName = String(alternativeName || '').trim();
  const altPhone = String(alternativePhone || '').trim();
  if (altName || altPhone) {
    doc.setFillColor(255, 247, 237);
    doc.setDrawColor(253, 186, 116);
    doc.roundedRect(left, cursorY, tableW, 9, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(154, 52, 18);
    doc.text('DESTINATARIO', left + 4, cursorY + 5.2);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const recipient = truncate(altName || customerName || '—', 36);
    const recipientX = left + 34;
    doc.text(recipient, recipientX, cursorY + 5.2);
    const telX = Math.min(recipientX + doc.getTextWidth(recipient) + 5, right - 52);
    doc.text(`Tel: ${truncate(altPhone || customerPhone || '—', 20)}`, telX, cursorY + 5.2);
    cursorY += 11;
  }

  if (shippingNotes && shippingNotes.trim()) {
    const noteLines = doc.splitTextToSize(shippingNotes.trim(), tableW - 8);
    const noteH = Math.max(10, 5 + noteLines.length * 4.5);
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(...BORDER_SOFT);
    doc.roundedRect(left, cursorY, tableW, noteH, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUTED);
    doc.text('NOTAS DE ENVIO', left + 4, cursorY + 4.8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_DARK);
    doc.text(noteLines, left + 4, cursorY + 9);
    cursorY += noteH + 2;
  }

  let rowY = drawTableHeader(cursorY + 2);
  rows.forEach((row, idx) => {
    if (rowY > pageH - 40) {
      doc.addPage();
      drawTopBar();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...TEXT_MUTED);
      doc.text('Cotizacion - Continuacion', left, 14);
      rowY = drawTableHeader(18, true);
    }

    doc.setFillColor(idx % 2 === 0 ? 255 : 248, idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 252);
    doc.rect(left, rowY, tableW, 8, 'F');

    const descriptionBase = buildSkuNameDescription(row);
    const description = row.isIndented ? `- ${descriptionBase}` : descriptionBase;

    if (row.isComboHeader) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...BRAND_RED);
    } else if (row.isIndented) {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...TEXT_MUTED);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...TEXT_DARK);
    }

    doc.setFontSize(row.isIndented ? 8.5 : 9);
    doc.text(truncate(description, 62), left + 3, rowY + 5.5);
    doc.text(String(row.qty || 0), 128, rowY + 5.5, { align: 'center' });
    doc.text(toMoney(row.unitPrice), 160, rowY + 5.5, { align: 'right' });
    doc.text(toMoney(row.lineTotal), right - 3, rowY + 5.5, { align: 'right' });

    rowY += 8;
  });

  if (rowY > pageH - 50) {
    doc.addPage();
    drawTopBar();
    rowY = 24;
  }

  const summaryX = 124;
  const summaryW = right - summaryX;
  const discountValue = discountAmount != null
    ? Number(discountAmount || 0)
    : Number(subtotal || 0) * (Number(discountPercent || 0) / 100);
  const summaryLines = [
    { label: 'Subtotal', value: `${toMoney(subtotal)} Bs` },
    ...(Number(discountPercent || 0) > 0
      ? [{ label: `Descuento (${Number(discountPercent)}%)`, value: `${toMoney(discountValue)} Bs` }]
      : []),
    // Promo de accesorios: % aplicado solo a las líneas de accesorios.
    ...(accessoryDiscount && Number(accessoryDiscount.amount || 0) > 0
      ? [{ label: `Dcto accesorios (${Number(accessoryDiscount.percent || 0)}%)`, value: `-${toMoney(accessoryDiscount.amount)} Bs` }]
      : []),
    // Envío local cotizado desde el GPS del cliente: línea propia, después
    // del descuento (el descuento aplica solo a productos).
    ...(Number(deliveryFee || 0) > 0
      ? [{ label: 'Envío local', value: `${toMoney(deliveryFee)} Bs` }]
      : [])
  ];
  const summaryH = 10 + summaryLines.length * 7 + 13;

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...BORDER_SOFT);
  doc.roundedRect(summaryX, rowY + 6, summaryW, summaryH, 2, 2, 'FD');

  let summaryY = rowY + 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  summaryLines.forEach((line) => {
    doc.setTextColor(...TEXT_MUTED);
    doc.text(line.label, summaryX + 5, summaryY);
    doc.setTextColor(...TEXT_DARK);
    doc.text(line.value, right - 5, summaryY, { align: 'right' });
    summaryY += 7;
  });

  // TOTAL band in brand red — the number the customer looks for.
  doc.setFillColor(...BRAND_RED);
  doc.roundedRect(summaryX + 2.5, summaryY - 2.5, summaryW - 5, 10, 1.8, 1.8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(255, 255, 255);
  doc.text('TOTAL', summaryX + 6, summaryY + 4);
  doc.text(`${toMoney(total)} Bs`, right - 6, summaryY + 4, { align: 'right' });
  summaryY += 10;

  // Promos del toolchest (snapshot del servidor): impresas a la izquierda del
  // resumen, con el corte visto por el cliente. Sin emojis: helvetica no los trae.
  const promoList = Array.isArray(promos) ? promos.filter((p) => p && p.tool) : [];
  let promoY = rowY + 6;
  const promoW = summaryX - left - 6;
  const toDdMm = (iso) => {
    const parts = String(iso || '').slice(0, 10).split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : '';
  };
  // Caja de promo a prueba de desbordes: título, línea de código (opcional) y
  // detalle se parten al ancho de la caja y la caja CRECE con las líneas.
  // Toda promo nueva debe pasar por aquí — nada de alturas fijas.
  const drawPromoBox = ({ fill, stroke, titleColor, title, codeLine, detail, detailColor, detailSize = 8.5 }) => {
    const TITLE_STEP = 4.8;
    const DETAIL_STEP = 4.2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    const titleLines = doc.splitTextToSize(String(title || ''), promoW - 8);
    doc.setFontSize(11);
    const codeLines = codeLine ? doc.splitTextToSize(String(codeLine), promoW - 8) : [];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(detailSize);
    const detailLines = detail ? doc.splitTextToSize(String(detail), promoW - 8) : [];

    let contentH = 5.8 + (titleLines.length - 1) * TITLE_STEP;
    if (codeLines.length > 0) contentH += 5.6 + (codeLines.length - 1) * TITLE_STEP;
    if (detailLines.length > 0) contentH += (codeLines.length > 0 ? 4.8 : 5.0) + (detailLines.length - 1) * DETAIL_STEP;
    const boxH = contentH + 3.4;

    doc.setFillColor(...fill);
    doc.setDrawColor(...stroke);
    doc.roundedRect(left, promoY, promoW, boxH, 2, 2, 'FD');

    let y = promoY + 5.8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...titleColor);
    doc.text(titleLines, left + 4, y, { lineHeightFactor: 1.3 });
    y += (titleLines.length - 1) * TITLE_STEP;
    if (codeLines.length > 0) {
      y += 5.6;
      doc.setFontSize(11);
      doc.setTextColor(...TEXT_DARK);
      doc.text(codeLines, left + 4, y, { lineHeightFactor: 1.2 });
      y += (codeLines.length - 1) * TITLE_STEP;
    }
    if (detailLines.length > 0) {
      y += codeLines.length > 0 ? 4.8 : 5.0;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(detailSize);
      doc.setTextColor(...detailColor);
      doc.text(detailLines, left + 4, y, { lineHeightFactor: 1.4 });
    }
    promoY += boxH + 3;
  };

  promoList.forEach((promo) => {
    if (promo.tool === 'envio_gratis') {
      drawPromoBox({
        fill: [236, 253, 245],
        stroke: [4, 120, 87],
        titleColor: [4, 120, 87],
        title: 'ENVÍO GRATIS',
        detail: `${promo.name || 'Promoción de envío'} · válido hasta el ${toDdMm(promo.valid_until)}`,
        detailColor: [6, 95, 70]
      });
    } else if (promo.tool === 'regalo') {
      const items = Array.isArray(promo.gift_items) ? promo.gift_items : [];
      const itemsLabel = items.map((item) => `${item.qty}x ${item.name || item.sku}`).join(' + ');
      drawPromoBox({
        fill: [254, 243, 231],
        stroke: [180, 83, 9],
        titleColor: [180, 83, 9],
        title: 'REGALO INCLUIDO',
        detail: `${itemsLabel || promo.name}${itemsLabel ? ` · ${promo.name}` : ''}`,
        detailColor: [124, 74, 18]
      });
    } else if (promo.tool === 'descuento_accesorios') {
      drawPromoBox({
        fill: [240, 253, 250],
        stroke: [15, 118, 110],
        titleColor: [15, 118, 110],
        title: `${Number(promo.discount_percent || 0)}% DCTO EN ACCESORIOS`,
        detail: `${promo.name || 'Promoción'} · ahorras ${toMoney(promo.discount_bs)} Bs en esta compra`,
        detailColor: [17, 94, 89]
      });
    } else if (promo.tool === 'sorteo') {
      const ticketsLabel = Number(promo.tickets || 0) > 1 ? ` (${promo.tickets} tickets)` : '';
      drawPromoBox({
        fill: [255, 251, 235],
        stroke: [180, 83, 9],
        titleColor: [180, 83, 9],
        title: String(promo.name || 'SORTEO').toUpperCase(),
        codeLine: `Tu código: ${promo.code || ''}${ticketsLabel}`,
        detail: `Participas al pagar tu pedido${promo.ends_on ? ` · sorteo válido hasta el ${toDdMm(promo.ends_on)}` : ''}`,
        detailColor: [120, 113, 108],
        detailSize: 8
      });
    } else if (promo.tool === 'cupon') {
      drawPromoBox({
        fill: [239, 246, 255],
        stroke: [29, 78, 216],
        titleColor: [29, 78, 216],
        title: `CUPÓN ${Number(promo.discount_percent || 0)}% · PRÓXIMA COMPRA`,
        codeLine: `Tu código: ${promo.code || ''}`,
        detail: `Se activa al pagar este pedido · válido ${Number(promo.validity_days || 30)} días desde el pago`,
        detailColor: [120, 113, 108],
        detailSize: 8
      });
    }
  });

  const footerY = Math.max(summaryY + 12, promoY + 8, pageH - 16);
  doc.setDrawColor(...BORDER_SOFT);
  doc.setLineWidth(0.4);
  doc.line(left, footerY - 5, right, footerY - 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('Cotización válida por 7 días  ·  Gracias por confiar en PCX', pageW / 2, footerY, { align: 'center' });
  doc.setFillColor(...BRAND_RED);
  doc.rect(0, pageH - 3, pageW, 3, 'F');

  if (autoSave) {
    doc.save(filename);
  }
  return doc;
}
