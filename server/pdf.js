import PDFDocument from "pdfkit";

// ── Monochrome palette ───────────────────────────────────────────────────────
const BANNER_BG  = "#111111";  // near-black banner
const BANNER_TXT = "#ffffff";  // white
const BANNER_PO  = "#bbbbbb";  // light-gray PO text in banner
const TBL_HDR_BG = "#333333";  // dark-gray table header row
const TBL_HDR_TXT= "#ffffff";  // white text in header
const TOTAL_BG   = "#e0e0e0";  // light-gray totals row
const ALT_ROW    = "#f5f5f5";  // very-light-gray stripe
const BORDER     = "#cccccc";  // grid-line colour
const TEXT       = "#111111";  // near-black body text
const SECTION_LBL= "#333333";  // section-label text

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format an ISO timestamp → m/d/yy  e.g. "1/5/25" */
function fmtDate(isoStr) {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(-2)}`;
}

/** Return only the first segment of a label like "Product • Style • Color • Vendor" */
function productTitle(label) {
  return (label || "").split("•")[0].trim() || "—";
}

// ── Table renderer ───────────────────────────────────────────────────────────
// rows[0] = header row, rows[last] = totals row, everything else = data rows
function drawTable(doc, { x, y, colWidths, rowHeight, rows }) {
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  let cy = y;

  for (let r = 0; r < rows.length; r++) {
    const row      = rows[r];
    const isHeader = r === 0;
    const isTotal  = r === rows.length - 1;
    const isAlt    = !isHeader && !isTotal && r % 2 === 0;

    if (isHeader)     doc.rect(x, cy, totalWidth, rowHeight).fill(TBL_HDR_BG);
    else if (isTotal) doc.rect(x, cy, totalWidth, rowHeight).fill(TOTAL_BG);
    else if (isAlt)   doc.rect(x, cy, totalWidth, rowHeight).fill(ALT_ROW);

    const textColor = isHeader ? TBL_HDR_TXT : TEXT;
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
  return cy;
}

// ── Matrix rows ──────────────────────────────────────────────────────────────
function buildMatrixRows({ sizes, locations, mat }) {
  const rows = [["Location", ...sizes, "Total"]];

  for (const loc of locations) {
    const row = [loc];
    let rt = 0;
    for (const s of sizes) {
      const v = Number(mat?.[loc]?.[s] ?? 0);
      rt += v;
      row.push(v);
    }
    row.push(rt);
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

// ── Shared layout pieces ─────────────────────────────────────────────────────

function drawBanner(doc, { title, po, margin, pageWidth }) {
  const bannerH = 54;
  const bannerY = doc.y;

  doc.rect(margin, bannerY, pageWidth, bannerH).fill(BANNER_BG);

  doc.font("Helvetica-Bold").fontSize(22).fillColor(BANNER_TXT)
    .text(title, margin + 14, bannerY + 10, { lineBreak: false });

  if (po) {
    doc.font("Helvetica-Bold").fontSize(12).fillColor(BANNER_PO)
      .text(`PO: ${String(po).toUpperCase()}`, margin, bannerY + 21, {
        width: pageWidth - 14,
        align: "right",
        lineBreak: false
      });
  }

  doc.y = bannerY + bannerH + 14;
}

function drawMeta(doc, { productLabel, createdAtISO, margin, pageWidth }) {
  const title   = productTitle(productLabel);
  const dateStr = fmtDate(createdAtISO);

  doc.font("Helvetica-Bold").fontSize(14).fillColor(TEXT)
    .text(title, margin, doc.y, { width: pageWidth });
  doc.moveDown(0.25);

  doc.font("Helvetica-Bold").fontSize(14).fillColor(TEXT)
    .text(dateStr, margin, doc.y, { width: pageWidth });
  doc.moveDown(0.75);

  // Separator
  const sepY = doc.y;
  doc.moveTo(margin, sepY).lineTo(margin + pageWidth, sepY)
    .strokeColor(BORDER).lineWidth(0.75).stroke();
  doc.y = sepY + 12;
}

function calcColWidths(sizes, pageWidth) {
  const locColW   = 110;
  const totalColW = 58;
  const sizeColW  = Math.floor((pageWidth - locColW - totalColW) / sizes.length);
  return [locColW, ...sizes.map(() => sizeColW), totalColW];
}

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
  drawMeta(doc, { productLabel, createdAtISO, margin, pageWidth });

  const colWidths = calcColWidths(sizes, pageWidth);

  drawTable(doc, {
    x: margin,
    y: doc.y,
    colWidths,
    rowHeight: 24,
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
  drawMeta(doc, { productLabel, createdAtISO, margin, pageWidth });

  drawSectionLabel(doc, "ALLOCATION", margin, pageWidth);
  const afterAlloc = drawTable(doc, {
    x: margin, y: doc.y, colWidths, rowHeight,
    rows: buildMatrixRows({ sizes, locations, mat: allocation })
  });

  doc.y = afterAlloc + 20;

  drawSectionLabel(doc, "SCANNED", margin, pageWidth);
  drawTable(doc, {
    x: margin, y: doc.y, colWidths, rowHeight,
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
  doc.fontSize(11).fillColor(SECTION_LBL).text(`Date: ${reportDate}`);
  doc.fontSize(10).fillColor(SECTION_LBL)
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
      } catch { /* skip image */ }
    }

    doc.fontSize(13).fillColor(TEXT)
      .text(e.productTitle || "(Unknown)", textX, startY, { width: textW });
    doc.fontSize(10).fillColor(SECTION_LBL)
      .text(`PO: ${e.poNumber || "—"}`,               { width: textW })
      .text(`Sizes sent: ${(e.sizes || []).join(", ")}`, { width: textW })
      .text(`Time: ${e.timestamp || "—"}`,             { width: textW });

    const afterText = doc.y;
    const afterImg  = startY + imgSize + 8;
    if (afterImg > afterText) doc.y = afterImg;

    if (i < entries.length - 1) {
      doc.moveDown(0.4);
      doc.moveTo(margin, doc.y).lineTo(margin + pageWidth, doc.y)
        .strokeColor(BORDER).stroke();
      doc.moveDown(0.6);
    }
  }

  doc.end();
  return done;
}
