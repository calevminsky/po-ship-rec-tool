import PDFDocument from "pdfkit";

function drawTable(doc, { x, y, colWidths, rowHeight, rows, header = true }) {
  let cy = y;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let cx = x;

    // header style
    if (header && r === 0) {
      doc.rect(x, cy, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill("#f3f4f6");
      doc.fillColor("#111827");
    } else {
      doc.fillColor("#111827");
    }

    for (let c = 0; c < row.length; c++) {
      doc.rect(cx, cy, colWidths[c], rowHeight).stroke("#e5e7eb");
      doc.text(String(row[c] ?? ""), cx + 6, cy + 6, { width: colWidths[c] - 12, height: rowHeight - 12 });
      cx += colWidths[c];
    }
    cy += rowHeight;
  }

  return cy;
}

function buildMatrixRows({ title, sizes, locations, mat }) {
  const rows = [];
  rows.push([title, ...Array(sizes.length + 1).fill("")]); // spacer title row
  rows.push(["Location", ...sizes, "Row Total"]);

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

  // totals row
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

export function buildCloseoutPdf({ username, po, productLabel, sizes, locations, allocation, scanned, createdAtISO }) {
  const doc = new PDFDocument({ margin: 36 });

  const buffers = [];
  doc.on("data", (d) => buffers.push(d));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(buffers))));

  doc.fontSize(18).fillColor("#111827").text("Receiving Closeout", { align: "left" });
  doc.moveDown(0.4);
  doc.fontSize(10).fillColor("#374151").text(`User: ${username}`);
  doc.text(`PO: ${po}`);
  doc.text(`Product: ${productLabel}`);
  doc.text(`Created: ${createdAtISO}`);
  doc.moveDown(0.8);

  const colWidths = [120, ...sizes.map(() => 52), 70];
  const rowHeight = 22;

  let y = doc.y;

  y = drawTable(doc, {
    x: doc.page.margins.left,
    y,
    colWidths,
    rowHeight,
    rows: buildMatrixRows({ title: "Allocation", sizes, locations, mat: allocation }),
    header: false
  });

  doc.moveDown(1.0);
  y = doc.y;

  y = drawTable(doc, {
    x: doc.page.margins.left,
    y,
    colWidths,
    rowHeight,
    rows: buildMatrixRows({ title: "Scanned", sizes, locations, mat: scanned }),
    header: false
  });

  doc.end();
  return done;
}

export async function buildOfficeSamplesPdf({ entries, reportDate }) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const buffers = [];
  doc.on("data", (d) => buffers.push(d));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(buffers))));

  const margin = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.fontSize(20).fillColor("#111827").text("Office Samples Report", { align: "left" });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor("#374151").text(`Date: ${reportDate}`);
  doc.fontSize(10).fillColor("#6b7280").text(`${entries.length} product${entries.length === 1 ? "" : "s"} sent to office`);
  doc.moveDown(0.8);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];

    if (doc.y > doc.page.height - 180) {
      doc.addPage();
      doc.moveDown(0.5);
    }

    const startY = doc.y;
    const imgSize = 90;
    const textX = margin + imgSize + 14;
    const textWidth = pageWidth - imgSize - 14;

    if (e.thumbBase64 || e.imageBase64) {
      try {
        const raw = e.thumbBase64 || e.imageBase64;
        const commaIdx = raw.indexOf(",");
        const b64 = commaIdx >= 0 ? raw.slice(commaIdx + 1) : raw;
        const buf = Buffer.from(b64, "base64");
        doc.image(buf, margin, startY, { fit: [imgSize, imgSize] });
      } catch {
        // skip image if it fails to decode
      }
    }

    doc.fontSize(13).fillColor("#111827").text(e.productTitle || "(Unknown)", textX, startY, { width: textWidth });
    doc.fontSize(10).fillColor("#374151")
      .text(`PO: ${e.poNumber || "—"}`, { width: textWidth })
      .text(`Sizes sent: ${(e.sizes || []).join(", ")}`, { width: textWidth })
      .text(`Time: ${e.timestamp || "—"}`, { width: textWidth });

    const afterText = doc.y;
    const afterImg = startY + imgSize + 8;
    if (afterImg > afterText) doc.y = afterImg;

    if (i < entries.length - 1) {
      doc.moveDown(0.4);
      doc.moveTo(margin, doc.y)
        .lineTo(margin + pageWidth, doc.y)
        .strokeColor("#e5e7eb")
        .stroke();
      doc.moveDown(0.6);
    }
  }

  doc.end();
  return done;
}

export function buildAllocationPdf({ username, po, productLabel, sizes, locations, allocation, createdAtISO }) {
  const doc = new PDFDocument({ margin: 36 });

  const buffers = [];
  doc.on("data", (d) => buffers.push(d));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(buffers))));

  doc.fontSize(18).fillColor("#111827").text("Allocation", { align: "left" });
  doc.moveDown(0.4);
  doc.fontSize(10).fillColor("#374151").text(`User: ${username}`);
  doc.text(`PO: ${po}`);
  doc.text(`Product: ${productLabel}`);
  doc.text(`Created: ${createdAtISO}`);
  doc.moveDown(0.8);

  const colWidths = [120, ...sizes.map(() => 52), 70];
  const rowHeight = 22;

  drawTable(doc, {
    x: doc.page.margins.left,
    y: doc.y,
    colWidths,
    rowHeight,
    rows: buildMatrixRows({ title: "Allocation", sizes, locations, mat: allocation }),
    header: false
  });

  doc.end();
  return done;
}
