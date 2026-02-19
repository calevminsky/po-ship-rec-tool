const BASE = "https://api.airtable.com/v0";

const token = process.env.AIRTABLE_TOKEN;
const baseId = process.env.AIRTABLE_BASE_ID;
const table = process.env.AIRTABLE_TABLE_NAME || "Products";

const sizes = (process.env.SIZES || "XXS,XS,S,M,L,XL").split(",").map((s) => s.trim());

const PO_FIELD = process.env.AIRTABLE_PO_FIELD || "PO #";
const ATTACH_FIELD = process.env.AIRTABLE_IMAGE_FIELD || "Product or Swatch";
const UNIT_COST_FIELD = process.env.AIRTABLE_UNIT_COST_FIELD || "Unit Cost";
const SHIP_DATE_FIELD = process.env.AIRTABLE_SHIP_DATE_FIELD || "Ship Date";
const DELIVERY_FIELD = process.env.AIRTABLE_DELIVERY_FIELD || "Delivery";

const ALLOC_FIELD = process.env.AIRTABLE_ALLOC_FIELD || "Alloc_JSON";
const SCAN_FIELD = process.env.AIRTABLE_SCAN_FIELD || "Scan_JSON";

// NEW: field in Airtable to store Shopify Product GID
// Example value: gid://shopify/Product/1234567890
const SHOPIFY_PRODUCT_GID_FIELD = process.env.AIRTABLE_SHOPIFY_PRODUCT_GID_FIELD || "Shopify_Product_GID";

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

export const AIRTABLE_FIELDS = {
  SHIP_DATE_FIELD,
  DELIVERY_FIELD,
  ALLOC_FIELD,
  SCAN_FIELD,
  SHOPIFY_PRODUCT_GID_FIELD,
  OFFICE_SENT_FIELD,
  OFFICE_SAMPLE_PHOTO_FIELD
};
