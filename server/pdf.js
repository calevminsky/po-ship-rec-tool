import PDFDocument from "pdfkit";

// ── Colour palette ───────────────────────────────────────────────────────────
const HEADER_BG    = "#1a3a5c";   // dark navy banner
const HEADER_TEXT  = "#ffffff";   // white
const HEADER_SUB   = "#a8c4d8";   // muted blue for sub-text in banner
const TBL_HEAD_BG  = "#2d5a8e";   // table header row
const TBL_HEAD_TXT = "#ffffff";
const TOTAL_BG     = "#dbeafe";   // light blue for totals row
const ALT_ROW      = "#f7f9fc";   // subtle stripe for odd data rows
const BORDER       = "#cbd5e0";   // grid line colour
const TEXT         = "#1a202c";   // body text
const SUBTEXT      = "#718096";   // meta / secondary text
const SECTION_LBL  = "#2d5a8e";   // section labels (e.g. "ALLOCATION")

// ── Table renderer ───────────────────────────────────────────────────────────
// rows[0] = header row, rows[last] = totals row, everything else = data
function drawTable(doc, { x, y, colWidths, rowHeight, rows }) {
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  let cy = y;

  for (let r = 0; r < rows.length; r++) {
    const row        = rows[r];
    const isHeader   = r === 0;
    const isTotal    = r === rows.length - 1;
    const isAltRow   = !isHeader && !isTotal && r % 2 === 0;

    // Row background
    if (isHeader)        doc.rect(x, cy, totalWidth, rowHeight).fill(TBL_HEAD_BG);
    else if (isTotal)    doc.rect(x, cy, totalWidth, rowHeight).fill(TOTAL_BG);
    else if (isAltRow)   doc.rect(x, cy, totalWidth, rowHeight).fill(ALT_ROW);

    const textColor = isHeader ? TBL_HEAD_TXT : TEXT;
    const font      = (isHeader || isTotal) ? "Helvetica-Bold" : "Helvetica";
    const fontSize  = 9;
    const textY     = cy + Math.floor((rowHeight - fontSize) / 2);

    let cx = x;
    for (let c = 0; c < row.length; c++) {
      doc.rect(cx, cy, colWidths[c], rowHeight).stroke(BORDER);
      doc.font(font).fontSize(fontSize).fillColor(textColor)
        .text(String(row[c] ?? ""), cx + 5, textY, {
          width:     colWidths[c] - 10,
          align:     c === 0 ? "left" : "center",
          lineBreak: false
        });
      cx += colWidths[c];
    }
    cy += rowHeight;
  }

  return cy; // bottom edge of table
}

// ── Matrix row builder ───────────────────────────────────────────────────────
// Returns: [ headerRow, ...locationRows, totalsRow ]
function buildMatrixRows({ sizes, locations, mat }) {
  const rows = [];
  rows.push(["Location", ...sizes, "Total"]);

  for (const loc of locations) {
    const row = [loc];
    let rowTotal = 0;
    for (const s of sizes) {
      const v = Number(mat?.[loc]?.[s] ?? 0);
      rowTotal += v;
      row.push(v);
    }
    row.push(rowTotal);
    rows.push(row);
  }

  const totalRow = ["TOTAL"];
  let grand = 0;
  for (const s of sizes) {
    const t = locations.reduce((a, loc) => a + Number(mat?.[loc]?.[s] ?? 0), 0);
    totalRow.push(t);
    grand += t;
  }
  totalRow.push(grand);
  rows.push(totalRow);

  return rows;
}

// ── Shared header banner ─────────────────────────────────────────────────────
function drawBanner(doc, { title, po, margin, pageWidth }) {
  const bannerH = 54;
  const bannerY = doc.y;

  doc.rect(margin, bannerY, pageWidth, bannerH).fill(HEADER_BG);

  // Title (left)
  doc.font("Helvetica-Bold").fontSize(22).fillColor(HEADER_TEXT)
    .text(title, margin + 14, bannerY + 10, { lineBreak: false });

  // PO badge (right)
  if (po) {
    doc.font("Helvetica-Bold").fontSize(12).fillColor(HEADER_SUB)
      .text(`PO: ${po}`, margin, bannerY + 21, {
        width: pageWidth - 14,
        align: "right",
        lineBreak: false
      });
  }

  doc.y = bannerY + bannerH + 14;
}

// ── Shared product / meta block ──────────────────────────────────────────────
function drawMeta(doc, { productLabel, username, createdAtISO, margin, pageWidth }) {
  const dateStr = createdAtISO
    ? createdAtISO.slice(0, 16).replace("T", " ") + " UTC"
    : "—";

  doc.font("Helvetica-Bold").fontSize(14).fillColor(TEXT)
    .text(productLabel || "—", margin, doc.y, { width: pageWidth });
  doc.moveDown(0.3);

  doc.font("Helvetica").fontSize(9).fillColor(SUBTEXT)
    .text(
      `User: ${username || "—"}   ·   Created: ${dateStr}`,
      margin, doc.y, { width: pageWidth }
    );
  doc.moveDown(0.75);

  // Separator line
  const sepY = doc.y;
  doc.moveTo(margin, sepY).lineTo(margin + pageWidth, sepY)
    .strokeColor(BORDER).lineWidth(0.75).stroke();
  doc.y = sepY + 12;
}

// ── Column widths helper ─────────────────────────────────────────────────────
function calcColWidths(sizes, pageWidth) {
  const locColW   = 110;
  const totalColW = 58;
  const sizeColW  = Math.floor((pageWidth - locColW - totalColW) / sizes.length);
  return [locColW, ...sizes.map(() => sizeColW), totalColW];
}

// ── Section label (for closeout two-table layout) ────────────────────────────
function drawSectionLabel(doc, label, margin, pageWidth) {
  doc.font("Helvetica-Bold").fontSize(10).fillColor(SECTION_LBL)
    .text(label, margin, doc.y, { width: pageWidth });
  doc.moveDown(0.4);
}

// ════════════════════════════════════════════════════════════════════════════
//  Allocation PDF
// ════════════════════════════════════════════════════════════════════════════
export function buildAllocationPdf({ username, po, productLabel, sizes, locations, allocation, createdAtISO }) {
  const doc = new PDFDocument({ margin: 36 });
  const buffers = [];
  doc.on("data", (d) => buffers.push(d));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(buffers))));

  const margin    = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  drawBanner(doc, { title: "ALLOCATION", po, margin, pageWidth });
  drawMeta(doc,   { productLabel, username, createdAtISO, margin, pageWidth });

  const colWidths = calcColWidths(sizes, pageWidth);
  const rowHeight = 24;

  drawTable(doc, {
    x: margin,
    y: doc.y,
    colWidths,
    rowHeight,
    rows: buildMatrixRows({ sizes, locations, mat: allocation })
  });

  doc.end();
  return done;
}

// ════════════════════════════════════════════════════════════════════════════
//  Closeout PDF  (Allocation + Scanned)
// ════════════════════════════════════════════════════════════════════════════
export function buildCloseoutPdf({ username, po, productLabel, sizes, locations, allocation, scanned, createdAtISO }) {
  const doc = new PDFDocument({ margin: 36 });
  const buffers = [];
  doc.on("data", (d) => buffers.push(d));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(buffers))));

  const margin    = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidths = calcColWidths(sizes, pageWidth);
  const rowHeight = 24;

  drawBanner(doc, { title: "RECEIVING CLOSEOUT", po, margin, pageWidth });
  drawMeta(doc,   { productLabel, username, createdAtISO, margin, pageWidth });

  // Allocation table
  drawSectionLabel(doc, "ALLOCATION", margin, pageWidth);
  const afterAlloc = drawTable(doc, {
    x: margin,
    y: doc.y,
    colWidths,
    rowHeight,
    rows: buildMatrixRows({ sizes, locations, mat: allocation })
  });

  doc.y = afterAlloc + 20;

  // Scanned table
  drawSectionLabel(doc, "SCANNED", margin, pageWidth);
  drawTable(doc, {
    x: margin,
    y: doc.y,
    colWidths,
    rowHeight,
    rows: buildMatrixRows({ sizes, locations, mat: scanned })
  });

  doc.end();
  return done;
}

// ════════════════════════════════════════════════════════════════════════════
//  Office Samples PDF
// ════════════════════════════════════════════════════════════════════════════
export async function buildOfficeSamplesPdf({ entries, reportDate }) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const buffers = [];
  doc.on("data", (d) => buffers.push(d));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(buffers))));

  const margin    = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.fontSize(20).fillColor(TEXT).text("Office Samples Report", { align: "left" });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor(SUBTEXT).text(`Date: ${reportDate}`);
  doc.fontSize(10).fillColor(SUBTEXT)
    .text(`${entries.length} product${entries.length === 1 ? "" : "s"} sent to office`);
  doc.moveDown(0.8);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];

    if (doc.y > doc.page.height - 180) {
      doc.addPage();
      doc.moveDown(0.5);
    }

    const startY  = doc.y;
    const imgSize = 90;
    const textX   = margin + imgSize + 14;
    const textW   = pageWidth - imgSize - 14;

    if (e.thumbBase64 || e.imageBase64) {
      try {
        const raw      = e.thumbBase64 || e.imageBase64;
        const commaIdx = raw.indexOf(",");
        const b64      = commaIdx >= 0 ? raw.slice(commaIdx + 1) : raw;
        doc.image(Buffer.from(b64, "base64"), margin, startY, { fit: [imgSize, imgSize] });
      } catch {
        // skip image if decode fails
      }
    }

    doc.fontSize(13).fillColor(TEXT)
      .text(e.productTitle || "(Unknown)", textX, startY, { width: textW });
    doc.fontSize(10).fillColor(SUBTEXT)
      .text(`PO: ${e.poNumber || "—"}`,               { width: textW })
      .text(`Sizes sent: ${(e.sizes || []).join(", ")}`, { width: textW })
      .text(`Time: ${e.timestamp || "—"}`,             { width: textW });

    const afterText = doc.y;
    const afterImg  = startY + imgSize + 8;
    if (afterImg > afterText) doc.y = afterImg;

    if (i < entries.length - 1) {
      doc.moveDown(0.4);
      doc.moveTo(margin, doc.y)
        .lineTo(margin + pageWidth, doc.y)
        .strokeColor(BORDER).stroke();
      doc.moveDown(0.6);
    }
  }

  doc.end();
  return done;
}
