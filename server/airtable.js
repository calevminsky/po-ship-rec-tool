const BASE = "https://api.airtable.com/v0";

const token = process.env.AIRTABLE_TOKEN;
const baseId = process.env.AIRTABLE_BASE_ID;
const table = "Products";

const sizes = ["XXS","XS","S","M","L","XL"];

function headers() {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

export async function listRecordsByPO(po) {
  const formula = `{PO #}="${po}"`;

  const url = `${BASE}/${baseId}/${encodeURIComponent(table)}?filterByFormula=${encodeURIComponent(formula)}`;

  const res = await fetch(url, { headers: headers() });
  const data = await res.json();

  return {
    po,
    sizes,
    records: data.records.map(r => {
      const f = r.fields;

      const buy = {};
      const ship = {};
      const rec = {};

      sizes.forEach(s => {
        buy[s] = Number(f[`Buy_${s}`] || 0);
        ship[s] = Number(f[`Ship_${s}`] || 0);
        rec[s] = Number(f[`Rec_${s}`] || 0);
      });

      return {
        id: r.id,
        label: f.Product || r.id,
        buy,
        ship,
        rec
      };
    })
  };
}

export async function updateRecord(id, body) {
  const fields = {};

  sizes.forEach(s => {
    if (body.ship) fields[`Ship_${s}`] = Number(body.ship[s] || 0);
    if (body.rec) fields[`Rec_${s}`] = Number(body.rec[s] || 0);
  });

  const url = `${BASE}/${baseId}/${table}/${id}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ fields })
  });

  return await res.json();
}
