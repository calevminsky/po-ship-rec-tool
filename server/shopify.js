import { getShopifyAccessToken } from "./shopifyAuth.js";

const LOCATIONS = [
  { name: "Bogota", id: "20363018337" },
  { name: "Cedarhurst", id: "31679414369" },
  { name: "Toms River", id: "62070161505" },
  { name: "Teaneck Store", id: "33027424353" },
  { name: "Office", id: "69648253025" },
  { name: "Warehouse", id: "68496293985" }
];

export function getLocations() {
  return LOCATIONS;
}

function gid(type, numericId) {
  return `gid://shopify/${type}/${numericId}`;
}

async function shopifyGraphQL(query, variables) {
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_API_VERSION || "2024-10";
  const token = await getShopifyAccessToken();

  const res = await fetch(`https://${shop}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({ query, variables })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Shopify GraphQL error: ${JSON.stringify(data)}`);
  if (data.errors?.length) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(data.errors)}`);
  return data.data;
}

/**
 * Lookup variant by barcode.
 * Returns:
 *  - productTitle
 *  - productId
 *  - variantId
 *  - inventoryItemId
 *  - sizeValue (from selectedOptions where name === "Size")
 */
export async function lookupVariantByBarcode(barcode) {
  const q = `
    query($q: String!) {
      productVariants(first: 1, query: $q) {
        nodes {
          id
          barcode
          product { id title }
          inventoryItem { id }
          selectedOptions { name value }
        }
      }
    }
  `;

  const data = await shopifyGraphQL(q, { q: `barcode:${barcode}` });
  const v = data?.productVariants?.nodes?.[0];
  if (!v) return null;

  const sizeOpt = (v.selectedOptions || []).find(o => o.name === "Size");
  return {
    barcode: v.barcode,
    productTitle: v.product?.title || "",
    productId: v.product?.id || null,
    variantId: v.id,
    inventoryItemId: v.inventoryItem?.id || null,
    sizeValue: sizeOpt?.value || null
  };
}

/**
 * Fetch all variants for a product (for size→inventoryItem mapping)
 */
export async function fetchProductVariants(productId) {
  const q = `
    query($id: ID!) {
      product(id: $id) {
        id
        title
        variants(first: 250) {
          nodes {
            id
            barcode
            inventoryItem { id }
            selectedOptions { name value }
          }
        }
      }
    }
  `;
  const data = await shopifyGraphQL(q, { id: productId });
  const p = data?.product;
  if (!p) throw new Error("Product not found in Shopify");

  const variants = (p.variants?.nodes || []).map(v => {
    const sizeOpt = (v.selectedOptions || []).find(o => o.name === "Size");
    return {
      variantId: v.id,
      barcode: v.barcode,
      inventoryItemId: v.inventoryItem?.id || null,
      sizeValue: sizeOpt?.value || null
    };
  });

  return { productId: p.id, title: p.title, variants };
}

/**
 * Adjust inventory by deltas per location.
 * changes: [{ inventoryItemId (gid), locationId (numeric), delta }]
 */
export async function adjustInventoryQuantities({ reason = "correction", changes = [] }) {
  if (!changes.length) return { ok: true, userErrors: [] };

  const mutation = `
    mutation($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        userErrors { field message }
        inventoryAdjustmentGroup { id createdAt }
      }
    }
  `;

  const input = {
    reason,
    name: "available",
    changes: changes.map(c => ({
      inventoryItemId: c.inventoryItemId,
      locationId: gid("Location", c.locationId),
      delta: c.delta
    }))
  };

  const data = await shopifyGraphQL(mutation, { input });
  const userErrors = data?.inventoryAdjustQuantities?.userErrors || [];
  return { ok: userErrors.length === 0, userErrors, result: data?.inventoryAdjustQuantities || null };
}
