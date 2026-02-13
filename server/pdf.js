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

  const cols = ["Location", ...sizes, "Row Total"];
  const colWidths = [120, ...sizes.map(() => 52), 70];
  const rowHeight = 22;

  function matrixRows(title, mat) {
    const rows = [];
    rows.push([title, ...Array(sizes.length + 1).fill("")]); // spacer title row
    rows.push(cols);

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

  let y = doc.y;

  y = drawTable(doc, {
    x: doc.page.margins.left,
    y,
    colWidths,
    rowHeight,
    rows: matrixRows("Allocation", allocation),
    header: false
  });

  doc.moveDown(1.0);
  y = doc.y;

  y = drawTable(doc, {
    x: doc.page.margins.left,
    y,
    colWidths,
    rowHeight,
    rows: matrixRows("Scanned", scanned),
    header: false
  });

  doc.end();
  return done;
}
