const BASE = "https://api.airtable.com/v0";

const token = process.env.AIRTABLE_TOKEN;
const baseId = process.env.AIRTABLE_BASE_ID;
const table = process.env.AIRTABLE_TABLE_NAME || "Products";

const sizes = (process.env.SIZES || "XXS,XS,S,M,L,XL").split(",").map((s) => s.trim());

const PO_FIELD = process.env.AIRTABLE_PO_FIELD || "PO #";
const PRODUCT_FIELD = process.env.AIRTABLE_PRODUCT_FIELD || "Product";
const ATTACH_FIELD = process.env.AIRTABLE_IMAGE_FIELD || "Product or Swatch";
const UNIT_COST_FIELD = process.env.AIRTABLE_UNIT_COST_FIELD || "Unit Cost";
const SHIP_DATE_FIELD = process.env.AIRTABLE_SHIP_DATE_FIELD || "Ship Date";
const DELIVERY_FIELD = process.env.AIRTABLE_DELIVERY_FIELD || "Delivery";

const ALLOC_FIELD = process.env.AIRTABLE_ALLOC_FIELD || "Alloc_JSON";
const SCAN_FIELD = process.env.AIRTABLE_SCAN_FIELD || "Scan_JSON";

// NEW: field in Airtable to store Shopify Product GID
// Example value: gid://shopify/Product/1234567890
const SHOPIFY_PRODUCT_GID_FIELD = process.env.AIRTABLE_SHOPIFY_PRODUCT_GID_FIELD || "Shopify_Product_GID";

// Tracking Number field
const TRACKING_NUMBER_FIELD = process.env.AIRTABLE_TRACKING_NUMBER_FIELD || "Tracking Number";

// PDF attachment fields
const ALLOC_PDF_FIELD = process.env.AIRTABLE_ALLOC_PDF_FIELD || "Alloc_PDF";
const RECEIVING_PDF_FIELD = process.env.AIRTABLE_RECEIVING_PDF_FIELD || "Receiving PDFs";

// Financial fields
const PAID_FIELD = process.env.AIRTABLE_PAID_FIELD || "Paid";
const CREDIT_AMOUNT_FIELD = process.env.AIRTABLE_CREDIT_AMOUNT_FIELD || "Credit Amount";
const INVOICE_AMOUNT_FIELD = process.env.AIRTABLE_INVOICE_AMOUNT_FIELD || "Invoice Amount";
const FINAL_COST_FIELD = process.env.AIRTABLE_FINAL_COST_FIELD || "Final Cost";
const BALANCE_FIELD = process.env.AIRTABLE_BALANCE_FIELD || "Balance";
const SHORTAGE_ADJUSTMENT_FIELD = process.env.AIRTABLE_SHORTAGE_ADJUSTMENT_FIELD || "ShortageAdjustment";
const VENDOR_FIELD = process.env.AIRTABLE_VENDOR_FIELD || "Vendor";

// Office Samples fields
const OFFICE_SENT_FIELD = process.env.AIRTABLE_OFFICE_SENT_FIELD || "Office_Sent";
const OFFICE_SAMPLE_PHOTO_FIELD = process.env.AIRTABLE_OFFICE_SAMPLE_PHOTO_FIELD || "Office_Sample_Photo";

const LABEL_FIELDS = (process.env.AIRTABLE_DISPLAY_FIELDS || "Product,Style,Color,Vendor")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function headers() {
  if (!token) throw new Error("Missing AIRTABLE_TOKEN");
  if (!baseId) throw new Error("Missing AIRTABLE_BASE_ID");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function escapeQuotes(s) {
  return String(s).replace(/"/g, '\\"');
}

function buildLabel(fields) {
  const parts = [];
  for (const f of LABEL_FIELDS) if (fields?.[f]) parts.push(String(fields[f]));
  return parts.length ? parts.join(" • ") : "(Untitled)";
}

function pickAttachmentUrl(attField) {
  if (!attField || !Array.isArray(attField) || !attField[0]) return null;
  const a0 = attField[0];
  return a0?.thumbnails?.large?.url || a0?.thumbnails?.small?.url || a0?.url || null;
}

export async function listRecordsByPO(po) {
  const safePO = escapeQuotes(po);
  const formula = `LOWER(TRIM({${PO_FIELD}}))=LOWER(TRIM("${safePO}"))`;

  const params = new URLSearchParams();
  params.set("filterByFormula", formula);

  // Fields
  params.append("fields[]", PO_FIELD);
  params.append("fields[]", ATTACH_FIELD);
  params.append("fields[]", UNIT_COST_FIELD);
  params.append("fields[]", SHIP_DATE_FIELD);
  params.append("fields[]", DELIVERY_FIELD);
  params.append("fields[]", ALLOC_FIELD);
  params.append("fields[]", SCAN_FIELD);
  params.append("fields[]", SHOPIFY_PRODUCT_GID_FIELD);
  params.append("fields[]", OFFICE_SENT_FIELD);
  params.append("fields[]", TRACKING_NUMBER_FIELD);
  params.append("fields[]", PAID_FIELD);
  params.append("fields[]", CREDIT_AMOUNT_FIELD);
  params.append("fields[]", INVOICE_AMOUNT_FIELD);
  params.append("fields[]", FINAL_COST_FIELD);
  params.append("fields[]", BALANCE_FIELD);

  for (const f of LABEL_FIELDS) params.append("fields[]", f);

  for (const s of sizes) {
    params.append("fields[]", `Buy_${s}`);
    params.append("fields[]", `Ship_${s}`);
    params.append("fields[]", `Rec_${s}`);
  }

  const url = `${BASE}/${baseId}/${encodeURIComponent(table)}?${params.toString()}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Airtable list failed (${res.status}): ${await res.text()}`);

  const data = await res.json();

  return {
    po,
    sizes,
    records: (data.records || []).map((r) => {
      const f = r.fields || {};
      const buy = {},
        ship = {},
        rec = {};
      for (const s of sizes) {
        buy[s] = Number(f[`Buy_${s}`] ?? 0);
        ship[s] = Number(f[`Ship_${s}`] ?? 0);
        rec[s] = Number(f[`Rec_${s}`] ?? 0);
      }

      return {
        id: r.id,
        label: buildLabel(f),
        imageUrl: pickAttachmentUrl(f[ATTACH_FIELD]),
        unitCost: Number(f[UNIT_COST_FIELD] ?? 0),
        shipDate: f[SHIP_DATE_FIELD] ?? null,
        delivery: f[DELIVERY_FIELD] ?? null,
        allocJson: f[ALLOC_FIELD] ?? null,
        scanJson: f[SCAN_FIELD] ?? null,
        shopifyProductGid: f[SHOPIFY_PRODUCT_GID_FIELD] ?? null,
        officeSent: f[OFFICE_SENT_FIELD] ?? null,
        trackingNumber: f[TRACKING_NUMBER_FIELD] ?? "",
        paid: Number(f[PAID_FIELD] ?? 0),
        creditAmount: Number(f[CREDIT_AMOUNT_FIELD] ?? 0),
        invoiceAmount: Number(f[INVOICE_AMOUNT_FIELD] ?? 0),
        finalCost: Number(f[FINAL_COST_FIELD] ?? 0),
        balance: Number(f[BALANCE_FIELD] ?? 0),
        hasCloseout: (() => { try { return !!JSON.parse(f[SCAN_FIELD] || "{}")._closeoutSubmitted; } catch { return false; } })(),
        styleName: (() => { const p = String(f[PRODUCT_FIELD] ?? ""); const i = p.lastIndexOf(" ("); return i > 0 ? p.slice(0, i) : p; })(),
        colorName: (() => { const p = String(f[PRODUCT_FIELD] ?? ""); const m = p.match(/\(([^)]+)\)\s*$/); return m ? m[1] : ""; })(),
        buy,
        ship,
        rec
      };
    })
  };
}

export async function updateRecord(id, fieldsPatch) {
  const url = `${BASE}/${baseId}/${encodeURIComponent(table)}/${id}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ fields: fieldsPatch })
  });

  if (!res.ok) throw new Error(`Airtable update failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

/** Fetch one Airtable record by id. Returns { id, fields } or throws. */
export async function getRecord(id) {
  const url = `${BASE}/${baseId}/${encodeURIComponent(table)}/${id}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Airtable get failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

export function getSizes() {
  return sizes;
}

/** Find all Airtable records linked to a given Shopify Product GID. */
export async function listRecordsByShopifyGid(gid) {
  const formula = `{${SHOPIFY_PRODUCT_GID_FIELD}}="${escapeQuotes(gid)}"`;

  const params = new URLSearchParams();
  params.set("filterByFormula", formula);
  params.append("fields[]", PO_FIELD);
  params.append("fields[]", SHIP_DATE_FIELD);
  for (const f of LABEL_FIELDS) params.append("fields[]", f);

  const url = `${BASE}/${baseId}/${encodeURIComponent(table)}?${params.toString()}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Airtable GID lookup failed (${res.status}): ${await res.text()}`);

  const data = await res.json();
  return (data.records || []).map((r) => ({
    id: r.id,
    po: r.fields?.[PO_FIELD] || "",
    label: buildLabel(r.fields || {}),
    shipDate: r.fields?.[SHIP_DATE_FIELD] || null
  }));
}

/** List all invoicing records (shipped). Handles Airtable pagination. */
export async function listInvoicingRecords() {
  // Fetch all records that have an invoice amount (i.e. shipped units > 0)
  const formula = `{${INVOICE_AMOUNT_FIELD}}>0`;

  const fields = [
    PO_FIELD, PRODUCT_FIELD, ATTACH_FIELD, UNIT_COST_FIELD, SHIP_DATE_FIELD, DELIVERY_FIELD,
    TRACKING_NUMBER_FIELD, PAID_FIELD, CREDIT_AMOUNT_FIELD, INVOICE_AMOUNT_FIELD,
    FINAL_COST_FIELD, BALANCE_FIELD, SHORTAGE_ADJUSTMENT_FIELD, VENDOR_FIELD,
    ...sizes.flatMap((s) => [`Buy_${s}`, `Ship_${s}`, `Rec_${s}`])
  ];

  let allRecords = [];
  let offset = null;

  do {
    const params = new URLSearchParams();
    params.set("filterByFormula", formula);
    for (const f of fields) params.append("fields[]", f);
    if (offset) params.set("offset", offset);

    const url = `${BASE}/${baseId}/${encodeURIComponent(table)}?${params.toString()}`;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error(`Airtable list failed (${res.status}): ${await res.text()}`);

    const data = await res.json();
    offset = data.offset || null;

    for (const r of data.records || []) {
      const f = r.fields || {};
      const buy = {}, ship = {}, rec = {};
      for (const s of sizes) {
        buy[s] = Number(f[`Buy_${s}`] ?? 0);
        ship[s] = Number(f[`Ship_${s}`] ?? 0);
        rec[s] = Number(f[`Rec_${s}`] ?? 0);
      }
      const buyUnits = sizes.reduce((sum, s) => sum + buy[s], 0);
      const shipUnits = sizes.reduce((sum, s) => sum + ship[s], 0);
      const recUnits = sizes.reduce((sum, s) => sum + rec[s], 0);
      const vendorRaw = f[VENDOR_FIELD];
      const vendor = Array.isArray(vendorRaw) ? vendorRaw.join(", ") : String(vendorRaw || "");
      const productName = f[PRODUCT_FIELD] || "";
      allRecords.push({
        id: r.id,
        po: f[PO_FIELD] || "",
        label: productName || "(Untitled)",
        vendor,
        imageUrl: pickAttachmentUrl(f[ATTACH_FIELD]),
        unitCost: Number(f[UNIT_COST_FIELD] ?? 0),
        shipDate: f[SHIP_DATE_FIELD] ?? null,
        delivery: f[DELIVERY_FIELD] ?? null,
        trackingNumber: f[TRACKING_NUMBER_FIELD] ?? "",
        paid: Number(f[PAID_FIELD] ?? 0),
        creditAmount: Number(f[CREDIT_AMOUNT_FIELD] ?? 0),
        shortageAdjustment: Number(f[SHORTAGE_ADJUSTMENT_FIELD] ?? 0),
        invoiceAmount: Number(f[INVOICE_AMOUNT_FIELD] ?? 0),
        finalCost: Number(f[FINAL_COST_FIELD] ?? 0),
        balance: Number(f[BALANCE_FIELD] ?? 0),
        buyUnits, shipUnits, recUnits,
        buy, ship, rec
      });
    }
  } while (offset);

  return { sizes, records: allRecords };
}

export const AIRTABLE_FIELDS = {
  SHIP_DATE_FIELD,
  DELIVERY_FIELD,
  ALLOC_FIELD,
  SCAN_FIELD,
  SHOPIFY_PRODUCT_GID_FIELD,
  OFFICE_SENT_FIELD,
  OFFICE_SAMPLE_PHOTO_FIELD,
  TRACKING_NUMBER_FIELD,
  ALLOC_PDF_FIELD,
  RECEIVING_PDF_FIELD,
  PAID_FIELD
};
