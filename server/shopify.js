import { getShopifyAccessToken } from "./shopifyTokenStore.js";

const SHOP = process.env.SHOPIFY_SHOP; // yakirabella.myshopify.com
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

function gqlEndpoint() {
  if (!SHOP) throw new Error("Missing SHOPIFY_SHOP env var");
  return `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
}

async function shopifyGraphQL(query, variables) {
  const token = getShopifyAccessToken();

  const resp = await fetch(gqlEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({ query, variables })
  });

  const json = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, json };
}

function extractUserErrors(json) {
  // common shape: json.data.<mutation>.userErrors
  if (!json?.data) return [];
  const key = Object.keys(json.data)[0];
  const obj = json.data[key];
  return obj?.userErrors || [];
}

// Your fixed mapping of store locations -> Shopify Location GIDs
// IMPORTANT: l.id must be a GID like gid://shopify/Location/12345
const LOCATIONS = [
  { name: "Office",       id: "gid://shopify/Location/69648253025" },
  { name: "Cedarhurst",   id: "gid://shopify/Location/31679414369" },
  { name: "Bogota",       id: "gid://shopify/Location/20363018337" },
  { name: "Toms River",   id: "gid://shopify/Location/62070161505" },
  { name: "Teaneck Store",id: "gid://shopify/Location/33027424353" },
  { name: "Warehouse",    id: "gid://shopify/Location/68496293985" }
];

export function getLocations() {
  return LOCATIONS;
}

// Lookup variant by barcode -> returns { productId, variantId }
export async function lookupVariantByBarcode(barcode) {
  const q = `
    query VariantByBarcode($q: String!) {
      productVariants(first: 1, query: $q) {
        edges {
          node {
            id
            barcode
            product { id }
          }
        }
      }
    }
  `;

  const { ok, status, json } = await shopifyGraphQL(q, { q: `barcode:${barcode}` });

  if (!ok || json.errors) {
    throw new Error(`Shopify barcode lookup failed (${status}): ${JSON.stringify(json.errors || json)}`);
  }

  const edge = json?.data?.productVariants?.edges?.[0];
  if (!edge?.node) return null;

  return {
    variantId: edge.node.id,
    productId: edge.node.product.id
  };
}

// Fetch all variants for a product with barcode + size option value + inventoryItemId
export async function fetchProductVariants(productId) {
  const q = `
    query ProductVariants($id: ID!) {
      product(id: $id) {
        id
        title
        variants(first: 250) {
          edges {
            node {
              id
              barcode
              inventoryItem { id }
              selectedOptions { name value }
            }
          }
        }
      }
    }
  `;

  const { ok, status, json } = await shopifyGraphQL(q, { id: productId });

  if (!ok || json.errors) {
    throw new Error(`Shopify product fetch failed (${status}): ${JSON.stringify(json.errors || json)}`);
  }

  const p = json?.data?.product;
  if (!p) throw new Error("Product not found in Shopify");

  const variants = (p.variants?.edges || []).map(({ node }) => {
    const sizeOpt = (node.selectedOptions || []).find((o) => String(o.name || "").toLowerCase() === "size");
    return {
      variantId: node.id,
      barcode: node.barcode || "",
      sizeValue: sizeOpt?.value || "",
      inventoryItemId: node.inventoryItem?.id || ""
    };
  });

  return { productId: p.id, title: p.title, variants };
}

// NEW: Search products by title (for manual Shopify linking)
export async function searchProductsByTitle(title, first = 10) {
  const q = `
    query ProductSearch($q: String!, $first: Int!) {
      products(first: $first, query: $q) {
        edges {
          node {
            id
            title
          }
        }
      }
    }
  `;

  const queryString = `title:*${title}*`;
  const { ok, status, json } = await shopifyGraphQL(q, { q: queryString, first });

  if (!ok || json.errors) {
    throw new Error(`Shopify product search failed (${status}): ${JSON.stringify(json.errors || json)}`);
  }

  const edges = json?.data?.products?.edges || [];
  return edges.map((e) => ({ productId: e.node.id, title: e.node.title }));
}

// Ensure an inventory item is stocked at a location (otherwise adjust fails)
async function inventoryActivate(inventoryItemId, locationId) {
  const m = `
    mutation Activate($inventoryItemId: ID!, $locationId: ID!) {
      inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
        inventoryLevel { id }
        userErrors { field message }
      }
    }
  `;

  const { ok, status, json } = await shopifyGraphQL(m, { inventoryItemId, locationId });
  const userErrors = extractUserErrors(json);

  return { ok: ok && !json.errors && userErrors.length === 0, status, json, userErrors };
}

// Adjust inventory quantities by delta
export async function adjustInventoryQuantities({
  name = "available",
  reason = "correction",
  changes = []
}) {
  if (!Array.isArray(changes) || changes.length === 0) return { ok: true, skipped: true };

  // Try activate + adjust; collect errors per change for debugging
  const results = [];
  const errors = [];

  // Newer inventory mutation style uses changes array. (This matches your “delta” requirement.)
  const m = `
    mutation Adjust($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        inventoryAdjustmentGroup { id }
        userErrors { field message }
      }
    }
  `;

  // Before adjust, activate each inventory item at each location (safe + prevents common failure)
  for (const c of changes) {
    const a = await inventoryActivate(c.inventoryItemId, c.locationId);
    results.push({ step: "activate", ...c, ok: a.ok, userErrors: a.userErrors, status: a.status });
    // activation can error harmlessly if already stocked; we don’t hard-fail here
  }

  const input = {
    name,
    reason,
    changes: changes.map((c) => ({
      inventoryItemId: c.inventoryItemId,
      locationId: c.locationId,
      delta: Number(c.delta || 0)
    }))
  };

  const { ok, status, json } = await shopifyGraphQL(m, { input });
  const userErrors = extractUserErrors(json);

  if (!ok || json.errors || userErrors.length) {
    errors.push({
      step: "adjust",
      status,
      errors: json.errors || null,
      userErrors
    });
    return { ok: false, status, errors, debug: { results, response: json } };
  }

  return { ok: true, status, debug: { results } };
}
