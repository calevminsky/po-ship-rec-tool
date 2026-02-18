import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";

import { listRecordsByPO, updateRecord, getSizes, AIRTABLE_FIELDS } from "./airtable.js";
import {
  getLocations,
  lookupVariantByBarcode,
  fetchProductVariants,
  adjustInventoryQuantities,
  searchProductsByTitle // NEW
} from "./shopify.js";
import { buildCloseoutPdf, buildAllocationPdf } from "./pdf.js";

import { buildAuthorizeUrl, exchangeCodeForToken, makeState } from "./shopifyAuth.js";
import { setShopifyAccessToken, hasShopifyAccessToken, getShopifyAccessToken } from "./shopifyTokenStore.js";

let OAUTH_STATE = null;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.join(__dirname, "public");

// ---- APP_USERS auth (Option 2) ----
const USERS_RAW = process.env.APP_USERS || "";
const USERS = new Map(
  USERS_RAW
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf(":");
      if (idx === -1) return null;
      const user = pair.slice(0, idx).trim();
      const pass = pair.slice(idx + 1).trim();
      if (!user || !pass) return null;
      return [user, pass];
    })
    .filter(Boolean)
);

const AUTH_ENABLED = USERS.size > 0;

function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) return next();
  const username = req.cookies?.yb_user;
  if (!username || !USERS.has(username)) return res.status(401).json({ error: "Unauthorized" });
  req.user = { username };
  next();
}

app.get("/api/me", (req, res) => {
  if (!AUTH_ENABLED) return res.json({ ok: true, user: { username: "guest" }, authEnabled: false });
  const username = req.cookies?.yb_user;
  if (username && USERS.has(username)) return res.json({ ok: true, user: { username }, authEnabled: true });
  return res.status(401).json({ error: "Unauthorized", authEnabled: true });
});

app.post("/api/login", (req, res) => {
  if (!AUTH_ENABLED) return res.json({ ok: true, user: { username: "guest" }, authEnabled: false });
  const { username, password } = req.body || {};
  const expected = USERS.get(String(username || ""));
  if (!expected || expected !== String(password || "")) return res.status(401).json({ error: "Invalid credentials" });

  // NOTE: secure:true requires HTTPS (Render is HTTPS, so OK)
  res.cookie("yb_user", String(username), { httpOnly: true, sameSite: "strict", secure: true });
  res.json({ ok: true, user: { username }, authEnabled: true });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("yb_user");
  res.json({ ok: true });
});

// -------------------- SHOPIFY OAUTH --------------------
// Start OAuth (you can keep this, even if you eventually move to a fixed token)
app.get("/api/shopify/auth", requireAuth, (req, res) => {
  OAUTH_STATE = makeState();
  const url = buildAuthorizeUrl(OAUTH_STATE);
  res.redirect(url);
});

// OAuth callback
app.get("/api/shopify/callback", requireAuth, async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).send("Missing code");
    if (!state || state !== OAUTH_STATE) return res.status(400).send("Invalid state");

    const token = await exchangeCodeForToken(code);
    setShopifyAccessToken(token);

    // back to app
    res.redirect("/?shopify=connected");
  } catch (e) {
    res.status(500).send(`Shopify auth failed: ${e.message}`);
  }
});

// Token status
app.get("/api/shopify/status", requireAuth, (req, res) => {
  res.json({ ok: true, hasToken: hasShopifyAccessToken() });
});

// ---- Airtable PO ----
app.get("/api/po/:po", requireAuth, async (req, res) => {
  try {
    const po = (req.params.po || "").trim();
    if (!po) return res.status(400).json({ error: "Missing PO #" });
    res.json(await listRecordsByPO(po));
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

// ---- Locations ----
app.get("/api/locations", requireAuth, (req, res) => {
  res.json({ ok: true, locations: getLocations().map((l) => l.name) });
});

// ---- Save Allocation ----
app.patch("/api/record/:id/save-allocation", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const { allocJson } = req.body || {};
    if (typeof allocJson !== "string") return res.status(400).json({ error: "allocJson must be a string" });

    const updated = await updateRecord(id, { [AIRTABLE_FIELDS.ALLOC_FIELD]: allocJson });
    res.json({ ok: true, updated });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

// ---- Save Ship + Ship Date ----
app.patch("/api/record/:id/save-ship", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const { shipDate, shipTotals } = req.body || {};

    if (typeof shipTotals !== "object" || shipTotals === null) {
      return res.status(400).json({ error: "shipTotals must be an object" });
    }

    const sizes = getSizes();
    const patch = {};

    if (shipDate !== undefined) {
      patch[AIRTABLE_FIELDS.SHIP_DATE_FIELD] = shipDate || null;
    }

    for (const s of sizes) {
      patch[`Ship_${s}`] = Number(shipTotals?.[s] ?? 0);
    }

    const updated = await updateRecord(id, patch);
    res.json({ ok: true, updated });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

// ---- Save Scan + Rec totals ----
app.patch("/api/record/:id/save-scan", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const { scanJson, recTotals } = req.body || {};
    if (typeof scanJson !== "string") return res.status(400).json({ error: "scanJson must be a string" });

    const patch = { [AIRTABLE_FIELDS.SCAN_FIELD]: scanJson };

    const sizes = getSizes();
    for (const s of sizes) patch[`Rec_${s}`] = Number(recTotals?.[s] ?? 0);

    const updated = await updateRecord(id, patch);
    res.json({ ok: true, updated });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

// ---- Shopify barcode lookup (returns product + variants) ----
app.get("/api/shopify/barcode/:barcode", requireAuth, async (req, res) => {
  try {
    const barcode = (req.params.barcode || "").trim();
    if (!barcode) return res.status(400).json({ error: "Missing barcode" });

    const v = await lookupVariantByBarcode(barcode);
    if (!v) return res.json({ ok: true, found: false });

    const product = await fetchProductVariants(v.productId);

    res.json({
      ok: true,
      found: true,
      product: {
        productId: product.productId,
        title: product.title,
        variants: product.variants
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Shopify lookup error" });
  }
});

// ---- NEW: Shopify product fetch by productId ----
app.get("/api/shopify/product/:productId", requireAuth, async (req, res) => {
  try {
    const productId = (req.params.productId || "").trim();
    if (!productId) return res.status(400).json({ error: "Missing productId" });

    const product = await fetchProductVariants(productId);
    res.json({
      ok: true,
      product: {
        productId: product.productId,
        title: product.title,
        variants: product.variants
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Shopify product fetch error" });
  }
});

// NEW: search Shopify products by title
app.get("/api/shopify/search", requireAuth, async (req, res) => {
  try {
    const title = String(req.query?.title || "").trim();
    if (!title) return res.status(400).json({ error: "Missing title" });

    const products = await searchProductsByTitle(title, 10);
    res.json({ ok: true, products });
  } catch (e) {
    res.status(500).json({ error: e.message || "Shopify product search error" });
  }
});

// ---- NEW: Link Airtable record to Shopify product (writes Product GID into Airtable) ----
app.patch("/api/record/:id/link-shopify-product", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const { productId } = req.body || {};
    if (!productId || typeof productId !== "string") return res.status(400).json({ error: "productId is required" });

    const updated = await updateRecord(id, { [AIRTABLE_FIELDS.SHOPIFY_PRODUCT_GID_FIELD]: productId });
    res.json({ ok: true, updated });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

// ---- Closeout ----
app.post("/api/closeout", requireAuth, async (req, res) => {
  try {
    const username = req.user?.username || "unknown";
    const { po, productLabel, recordId, sizes, locations, allocation, scanned, shopifyProduct } = req.body || {};
    if (!recordId) return res.status(400).json({ error: "Missing recordId" });

    // Rec totals per size from scanned matrix
    const recTotals = {};
    for (const s of sizes || []) {
      recTotals[s] = (locations || []).reduce((a, loc) => a + Number(scanned?.[loc]?.[s] ?? 0), 0);
    }

    // Save scan + totals to Airtable
    await updateRecord(recordId, {
      [AIRTABLE_FIELDS.SCAN_FIELD]: JSON.stringify(scanned),
      ...Object.fromEntries(getSizes().map((s) => [`Rec_${s}`, Number(recTotals[s] ?? 0)]))
    });

    // Shopify adjustments (optional)
    let shopifyResult = { skipped: true };
    if (shopifyProduct?.productId && Array.isArray(shopifyProduct?.variants)) {
      const sizeToInv = new Map();
      for (const v of shopifyProduct.variants) {
        if (!v.sizeValue || !v.inventoryItemId) continue;
        const normalized = String(v.sizeValue).trim().toUpperCase();
        sizeToInv.set(normalized, v.inventoryItemId);
      }

      const locMap = new Map(getLocations().map((l) => [l.name, l.id]));
      const changes = [];

      for (const loc of locations || []) {
        const locId = locMap.get(loc);
        if (!locId) continue;

        for (const s of sizes || []) {
          const invId = sizeToInv.get(String(s).toUpperCase());
          if (!invId) continue;

          const delta = Number(scanned?.[loc]?.[s] ?? 0);
          if (delta !== 0) changes.push({ inventoryItemId: invId, locationId: locId, delta });
        }
      }

      const result = await adjustInventoryQuantities({
        name: "available",
        reason: "correction",
        changes
      });

      shopifyResult = result;

      if (!result.ok) {
        return res.status(400).json({ error: "Shopify inventory adjust failed", shopify: result });
      }
    }

    // PDF
    const createdAtISO = new Date().toISOString();
    const pdfBuffer = await buildCloseoutPdf({
      username,
      po,
      productLabel,
      sizes,
      locations,
      allocation,
      scanned,
      createdAtISO
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="closeout_${po || "PO"}_${Date.now()}.pdf"`);
    res.send(pdfBuffer);
  } catch (e) {
    res.status(500).json({ error: e.message || "Closeout error" });
  }
});
app.post("/api/allocation-pdf", requireAuth, async (req, res) => {
  try {
    const { po, productLabel, sizes, locations, allocation } = req.body || {};

    if (!po) return res.status(400).json({ error: "Missing po" });
    if (!productLabel) return res.status(400).json({ error: "Missing productLabel" });
    if (!Array.isArray(sizes) || !sizes.length) return res.status(400).json({ error: "Missing sizes" });
    if (!Array.isArray(locations) || !locations.length) return res.status(400).json({ error: "Missing locations" });
    if (typeof allocation !== "object" || !allocation) return res.status(400).json({ error: "Missing allocation" });

    const pdfBuffer = await buildAllocationPdf({
      po,
      productLabel,
      sizes,
      locations,
      allocation
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="allocation_${po}.pdf"`);
    res.send(pdfBuffer);
  } catch (e) {
    res.status(500).json({ error: e.message || "Allocation PDF error" });
  }
});


// Debug route (kept)
app.get("/api/shopify/debug-locations", requireAuth, async (req, res) => {
  try {
    const token = getShopifyAccessToken();
    const shop = process.env.SHOPIFY_SHOP;
    const ver = process.env.SHOPIFY_API_VERSION || "2025-01";

    const query = `
      query {
        locations(first: 50) {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    `;

    const r = await fetch(`https://${shop}/admin/api/${ver}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({ query })
    });

    const j = await r.json();
    res.json(j);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(clientDist));

// ---- Static client ----
app.use(express.static(clientDist));
app.get("*", (req, res) => res.sendFile(path.join(clientDist, "index.html")));

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server running on :${port}`));
