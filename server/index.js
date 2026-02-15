import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import { listRecordsByPO, updateRecord, getSizes, AIRTABLE_FIELDS } from "./airtable.js";
import { getLocations, lookupVariantByBarcode, fetchProductVariants, adjustInventoryQuantities } from "./shopify.js";
import { buildCloseoutPdf } from "./pdf.js";
import { buildAuthorizeUrl, exchangeCodeForToken, loadTokenFromDisk, makeState, saveTokenToDisk } from "./shopifyAuth.js";

import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  loadTokenFromDisk,
  makeState,
  saveTokenToDisk
} from "./shopifyAuth.js";

let SHOPIFY_ACCESS_TOKEN = loadTokenFromDisk(); // memory cache
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
  USERS_RAW.split(",").map(s => s.trim()).filter(Boolean).map(pair => {
    const idx = pair.indexOf(":");
    if (idx === -1) return null;
    const user = pair.slice(0, idx).trim();
    const pass = pair.slice(idx + 1).trim();
    if (!user || !pass) return null;
    return [user, pass];
  }).filter(Boolean)
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

  res.cookie("yb_user", String(username), { httpOnly: true, sameSite: "strict", secure: true });
  res.json({ ok: true, user: { username }, authEnabled: true });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("yb_user");
  res.json({ ok: true });
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
  res.json({ ok: true, locations: getLocations().map(l => l.name) });
});

// ---- Save Allocation / Scan JSON / Rec totals ----
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

app.patch("/api/record/:id/save-scan", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const { scanJson, recTotals } = req.body || {};
    if (typeof scanJson !== "string") return res.status(400).json({ error: "scanJson must be a string" });

    const patch = { [AIRTABLE_FIELDS.SCAN_FIELD]: scanJson };

    // Write Rec_* totals
    const sizes = getSizes();
    for (const s of sizes) {
      patch[`Rec_${s}`] = Number(recTotals?.[s] ?? 0);
    }

    const updated = await updateRecord(id, patch);
    res.json({ ok: true, updated });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

// ---- Shopify barcode lookup ----
app.get("/api/shopify/barcode/:barcode", requireAuth, async (req, res) => {
  try {
    const barcode = (req.params.barcode || "").trim();
    if (!barcode) return res.status(400).json({ error: "Missing barcode" });

    const v = await lookupVariantByBarcode(barcode);
    if (!v) return res.json({ ok: true, found: false });

    // Fetch full product variants to build size→inventoryItem map
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

// ---- Shopify adjust inventory + generate PDF closeout ----
app.post("/api/closeout", requireAuth, async (req, res) => {
  try {
    const username = req.user?.username || "unknown";
    const {
      po,
      productLabel,
      recordId,
      sizes,
      locations,
      allocation, // object
      scanned,    // object
      shopifyProduct // optional: { productId, variants: [{sizeValue, inventoryItemId}] }
    } = req.body || {};

    if (!recordId) return res.status(400).json({ error: "Missing recordId" });

    // Compute Rec totals per size from scanned matrix
    const recTotals = {};
    for (const s of sizes || []) {
      recTotals[s] = (locations || []).reduce((a, loc) => a + Number(scanned?.[loc]?.[s] ?? 0), 0);
    }

    // Save scan + totals to Airtable
    await updateRecord(recordId, {
      [AIRTABLE_FIELDS.SCAN_FIELD]: JSON.stringify(scanned),
      ...Object.fromEntries((getSizes()).map(s => [`Rec_${s}`, Number(recTotals[s] ?? 0)]))
    });

    // Shopify adjustments (optional)
    let shopifyResult = { skipped: true };
    if (shopifyProduct?.productId && Array.isArray(shopifyProduct?.variants)) {
      // map size → inventoryItemId
      const sizeToInv = new Map();
      for (const v of shopifyProduct.variants) {
        if (!v.sizeValue || !v.inventoryItemId) continue;
        const normalized = String(v.sizeValue).trim().toUpperCase();
        sizeToInv.set(normalized, v.inventoryItemId);
      }

      // Build changes
      const locMap = new Map(getLocations().map(l => [l.name, l.id]));
      const changes = [];

      for (const loc of locations || []) {
        const locId = locMap.get(loc);
        if (!locId) continue;

        for (const s of sizes || []) {
          const invId = sizeToInv.get(String(s).toUpperCase());
          if (!invId) continue;

          const delta = Number(scanned?.[loc]?.[s] ?? 0);
          if (delta !== 0) {
            changes.push({ inventoryItemId: invId, locationId: locId, delta });
          }
        }
      }

      const result = await adjustInventoryQuantities({ reason: "correction", changes });
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

// ---- Static client ----
app.use(express.static(clientDist));
app.get("*", (req, res) => res.sendFile(path.join(clientDist, "index.html")));

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server running on :${port}`));
