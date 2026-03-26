import jsPDF from 'jspdf';

const BRAND_RED = [225, 29, 72];
const TEXT_DARK = [15, 23, 42];
const TEXT_MUTED = [100, 116, 139];
const BORDER_SOFT = [226, 232, 240];
const BG_SOFT = [248, 250, 252];

const toMoney = (value) => Number(value || 0).toFixed(2);

const truncate = (value = '', max = 56) => {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
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
  shippingNotes,
  alternativeName,
  alternativePhone,
  rows = [],
  subtotal = 0,
  discountPercent = 0,
  discountAmount,
  roundTotal = false,
  total = 0
}) {
  const doc = new jsPDF();

  const pageW = 210;
  const pageH = 297;
  const left = 14;
  const right = 196;
  const tableW = right - left;

  const drawTopBar = () => {
    doc.setFillColor(...BRAND_RED);
    doc.rect(0, 0, pageW, 4, 'F');
  };

  const drawTableHeader = (y, continuation = false) => {
    doc.setFillColor(30, 41, 59);
    doc.rect(left, y, tableW, 9, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(continuation ? 'Descripcion (continuacion)' : 'Descripcion', left + 3, y + 6);
    doc.text('Cant.', 128, y + 6, { align: 'center' });
    doc.text('P. Unit.', 160, y + 6, { align: 'right' });
    doc.text('Subtotal', right - 3, y + 6, { align: 'right' });
    return y + 9;
  };

  drawTopBar();

  if (logo) {
    doc.addImage(logo, 'PNG', left, 10, 34, 14);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...TEXT_DARK);
  doc.text('Cotizacion', right, 18, { align: 'right' });

  if (quoteNumber != null && quoteNumber !== '') {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(`Nro: ${quoteNumber}`, right, 24, { align: 'right' });
  }

  const metaChips = [
    `Vendedor: ${vendorName || '—'}`,
    `Almacen: ${storeLocation || '—'}`,
    `Fecha: ${dateText || '—'}`
  ];

  let chipX = left;
  let chipY = 31;
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

  const locationText = provincia ? `Provincia: ${provincia}` : `Departamento: ${department || '—'}`;
  const dispatchSourceText = storeLocation ? `Almacén: ${storeLocation}` : (cityText || '—');

  let cursorY = chipY + 8;
  doc.setFillColor(...BG_SOFT);
  doc.setDrawColor(...BORDER_SOFT);
  doc.roundedRect(left, cursorY, tableW, 24, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('CLIENTE', left + 4, cursorY + 6);
  doc.text('TELEFONO', 106, cursorY + 6);
  doc.text('UBICACION', left + 4, cursorY + 16);
  doc.text('ORIGEN', 106, cursorY + 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...TEXT_DARK);
  doc.text(truncate(customerName || '—', 28), left + 4, cursorY + 11);
  doc.text(truncate(customerPhone || '—', 24), 106, cursorY + 11);
  doc.text(truncate(locationText, 30), left + 4, cursorY + 21);
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

    const descriptionBase = row.skuDisplay || row.displayName || row.sku || '—';
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
    ...(roundTotal ? [{ label: 'Redondeo', value: 'Aplicado' }] : [])
  ];
  const summaryH = 18 + summaryLines.length * 7.5 + 10;

  doc.setFillColor(...BG_SOFT);
  doc.setDrawColor(...BORDER_SOFT);
  doc.roundedRect(summaryX, rowY + 6, summaryW, summaryH, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...TEXT_DARK);
  doc.text('Resumen', summaryX + 4, rowY + 13);

  let summaryY = rowY + 20;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  summaryLines.forEach((line) => {
    doc.setTextColor(...TEXT_MUTED);
    doc.text(line.label, summaryX + 4, summaryY);
    doc.setTextColor(...TEXT_DARK);
    doc.text(line.value, right - 3, summaryY, { align: 'right' });
    summaryY += 7;
  });

  doc.setDrawColor(...BORDER_SOFT);
  doc.line(summaryX + 4, summaryY, right - 3, summaryY);
  summaryY += 7;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...BRAND_RED);
  doc.text(`TOTAL: ${toMoney(total)} Bs`, right - 3, summaryY, { align: 'right' });

  const footerY = Math.max(summaryY + 10, pageH - 18);
  doc.setDrawColor(...BORDER_SOFT);
  doc.line(left, footerY - 5, right, footerY - 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('Cotizacion valida por 7 dias', left, footerY);
  doc.text('Gracias por confiar en PCX', right, footerY, { align: 'right' });

  doc.save(filename);
}
