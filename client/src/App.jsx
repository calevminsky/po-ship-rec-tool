import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchPO,
  me,
  login,
  logout,
  getLocations,
  saveShip,
  saveAllocation,
  saveScan,
  shopifyByBarcode,
  shopifyByProductId,
  shopifySearchByTitle,
  linkShopifyProduct,
  closeoutPdf,
  allocationPdf,
  submitOfficeSample,
  downloadSessionPdf,
  bulkAllocPdfs,
  bulkAllocMergedPdf,
  fetchRecordsByShopifyGid
} from "./api.js";
import { computeAllocation } from "./allocationEngine";

// ---- Dynamsoft barcode scanner (Office Samples mode) ----
const DYNAMSOFT_LICENSE = "DLS2eyJoYW5kc2hha2VDb2RlIjoiMTA0MzEyNTE0LTEwNDQ2Nzg3NCIsIm1haW5TZXJ2ZXJVUkwiOiJodHRwczovL21kbHMuZHluYW1zb2Z0b25saW5lLmNvbS8iLCJvcmdhbml6YXRpb25JRCI6IjEwNDMxMjUxNCIsInN0YW5kYnlTZXJ2ZXJVUkwiOiJodHRwczovL3NkbHMuZHluYW1zb2Z0b25saW5lLmNvbS8iLCJjaGVja0NvZGUiOjE5MzI1NzIzNDd9";

async function launchDynamsoftScanner() {
  if (typeof Dynamsoft === "undefined") throw new Error("Dynamsoft not loaded — check your internet connection.");
  const scanner = new Dynamsoft.BarcodeScanner({
    license: DYNAMSOFT_LICENSE,
    barcodeFormats: [Dynamsoft.DBR.EnumBarcodeFormat.BF_ONED]
  });
  const result = await scanner.launch();
  return result?.barcodeResults?.[0]?.text || null;
}

// Resize a data URL image to a max width (for session log thumbnails)
function resizeImageDataUrl(dataUrl, maxWidth = 400, quality = 0.75) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl); // fallback: return original
    img.src = dataUrl;
  });
}

/**
 * Allocation rules (updated):
 * - Allocation is based on BUY total.
 * - Overage (ship - buy) goes to Warehouse.
 * - Packs are built from inv = min(buy, ship).
 * - Office rule (ONLY rule):
 *   - On Bogota’s FIRST successful pack, move 1 XS + 1 S FROM Bogota allocation to Office (if possible).
 * - Ignore Teaneck:
 *   - exclude Teaneck from store pack distribution (its would-be packs go to Warehouse).
 */

// Pack sequence (1..15). After 15 packs, remainder goes to Warehouse.
const PACK_SEQUENCE_1_TO_15 = [
  "Cedarhurst", // 1
  "Cedarhurst", // 2
  "Bogota", // 3
  "Bogota", // 4
  "Toms River", // 5
  "Teaneck Store", // 6
  "Cedarhurst", // 7
  "Bogota", // 8
  "Toms River", // 9
  "Cedarhurst", // 10
  "Warehouse", // 11
  "Warehouse", // 12
  "Bogota", // 13
  "Cedarhurst", // 14
  "Warehouse" // 15
];

const PACK_CORE_NO_XL = { XS: 3, S: 3, M: 2, L: 1 }; // 9 units (XL optional, XXS optional)

const SIZES = ["XXS", "XS", "S", "M", "L", "XL"];
const LOCATION_DISPLAY_ORDER = ["Office", "Bogota", "Cedarhurst", "Teaneck Store", "Toms River", "Warehouse"];
const DEFAULT_LOCATIONS = LOCATION_DISPLAY_ORDER;

function sortLocations(locs) {
  return [...locs].sort((a, b) => {
    const ai = LOCATION_DISPLAY_ORDER.indexOf(a);
    const bi = LOCATION_DISPLAY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

// (Not currently used by the allocator below, but leaving in place)
const PACK_WITH_XXS = { XXS: 1, XS: 3, S: 3, M: 2, L: 1, XL: 1 }; // 11
const PACK_NO_XXS = { XS: 3, S: 3, M: 2, L: 1, XL: 1 }; // 10
const STORE_PACK_PRIORITY = ["Cedarhurst", "Bogota", "Toms River", "Teaneck Store"];

// (Not currently used by the allocator below, but leaving in place)
const PACK_PLAN_NO_XXS = [
  { minTotal: 200, packs: { Bogota: 4, Cedarhurst: 5, "Toms River": 2, "Teaneck Store": 1, Warehouse: 8 } },
  { minTotal: 190, packs: { Bogota: 4, Cedarhurst: 5, "Toms River": 2, "Teaneck Store": 1, Warehouse: 7 } },
  { minTotal: 180, packs: { Bogota: 4, Cedarhurst: 5, "Toms River": 2, "Teaneck Store": 1, Warehouse: 6 } },
  { minTotal: 170, packs: { Bogota: 4, Cedarhurst: 5, "Toms River": 2, "Teaneck Store": 1, Warehouse: 5 } },
  { minTotal: 160, packs: { Bogota: 4, Cedarhurst: 5, "Toms River": 2, "Teaneck Store": 1, Warehouse: 4 } },
  { minTotal: 150, packs: { Bogota: 4, Cedarhurst: 5, "Toms River": 2, "Teaneck Store": 1, Warehouse: 3 } },
  { minTotal: 140, packs: { Bogota: 4, Cedarhurst: 5, "Toms River": 2, "Teaneck Store": 1, Warehouse: 2 } },
  { minTotal: 130, packs: { Bogota: 4, Cedarhurst: 5, "Toms River": 2, "Teaneck Store": 1, Warehouse: 1 } },
  { minTotal: 120, packs: { Bogota: 4, Cedarhurst: 5, "Toms River": 2, "Teaneck Store": 1, Warehouse: 0 } },
  { minTotal: 110, packs: { Bogota: 3, Cedarhurst: 5, "Toms River": 2, "Teaneck Store": 1, Warehouse: 0 } },
  { minTotal: 100, packs: { Bogota: 3, Cedarhurst: 4, "Toms River": 2, "Teaneck Store": 1, Warehouse: 0 } },
  { minTotal: 90, packs: { Bogota: 3, Cedarhurst: 3, "Toms River": 2, "Teaneck Store": 1, Warehouse: 0 } },
  { minTotal: 80, packs: { Bogota: 3, Cedarhurst: 3, "Toms River": 1, "Teaneck Store": 1, Warehouse: 0 } },
  { minTotal: 70, packs: { Bogota: 2, Cedarhurst: 3, "Toms River": 1, "Teaneck Store": 1, Warehouse: 0 } },
  { minTotal: 60, packs: { Bogota: 2, Cedarhurst: 2, "Toms River": 1, "Teaneck Store": 1, Warehouse: 0 } }
];

const PACK_PLAN_WITH_XXS = [
  { minTotal: 154, packs: { Bogota: 3, Cedarhurst: 4, "Toms River": 2, "Teaneck Store": 1 } },
  { minTotal: 88, packs: { Bogota: 2, Cedarhurst: 3, "Toms River": 1, "Teaneck Store": 2 } },
  { minTotal: 66, packs: { Bogota: 2, Cedarhurst: 2, "Toms River": 1, "Teaneck Store": 1 } }
];

function clampInt(v) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function fmtDateForInput(airtableDate) {
  if (!airtableDate) return "";
  return String(airtableDate).slice(0, 10);
}

function emptyMatrix(locations, sizes) {
  const m = {};
  for (const loc of locations) {
    m[loc] = {};
    for (const s of sizes) m[loc][s] = 0;
  }
  return m;
}

function parseJsonOrNull(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function perSizeTotalsFromMatrix(matrix, locations, sizes) {
  const t = {};
  for (const s of sizes) t[s] = locations.reduce((a, loc) => a + Number(matrix?.[loc]?.[s] ?? 0), 0);
  return t;
}

function equalsPerSize(a, b, sizes) {
  return sizes.every((s) => Number(a?.[s] ?? 0) === Number(b?.[s] ?? 0));
}

function diffPerSize(a, b, sizes) {
  const d = {};
  for (const s of sizes) d[s] = Number(a?.[s] ?? 0) - Number(b?.[s] ?? 0);
  return d;
}

function normalizeSizeValue(val) {
  if (!val) return null;
  const s = String(val).trim().toUpperCase();
  if (s === "X-SMALL") return "XS";
  if (s === "XX-SMALL") return "XXS";
  if (s === "X SMALL") return "XS";
  if (s === "XX SMALL") return "XXS";
  return s;
}

function statusKind(message) {
  const m = String(message || "").toLowerCase();
  if (!m) return "info";
  if (m.includes("fail") || m.includes("error") || m.includes("over") || m.includes("unauthorized")) return "error";
  if (m.includes("saved") || m.includes("linked") || m.includes("complete") || m.includes("download")) return "success";
  return "info";
}

function money(n) {
  const x = Number(n ?? 0);
  return x.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function sumPerSize(obj, sizes) {
  return sizes.reduce((a, s) => a + Number(obj?.[s] ?? 0), 0);
}

/**
 * Try to build N full packs from available inventoryBySize.
 */
function computeMaxPacksAvailable(inventoryBySize, packScale) {
  let max = Infinity;
  for (const [size, need] of Object.entries(packScale)) {
    const have = Number(inventoryBySize?.[size] ?? 0);
    if (need <= 0) continue;
    max = Math.min(max, Math.floor(have / need));
  }
  if (!Number.isFinite(max)) max = 0;
  return Math.max(0, max);
}

function subtractPack(inventoryBySize, packScale, packsCount = 1) {
  const next = { ...inventoryBySize };
  for (const [size, need] of Object.entries(packScale)) {
    next[size] = Math.max(0, Number(next[size] ?? 0) - need * packsCount);
  }
  return next;
}

function addPackToMatrix(matrix, loc, packScale, packsCount = 1) {
  const out = structuredClone(matrix);
  for (const [size, need] of Object.entries(packScale)) {
    out[loc][size] = Number(out?.[loc]?.[size] ?? 0) + need * packsCount;
  }
  return out;
}

function pickPlan(total) {
  const plans = PACK_PLAN_NO_XXS;
  const FUDGE = 2;
  for (const p of plans) {
    if (total >= p.minTotal - FUDGE) return p.packs;
  }
  return plans[plans.length - 1]?.packs || {};
}

/**
 * Pure auto-allocation function. Same algorithm as the UI "Auto Allocate" button.
 * Delegates to computeAllocation() from allocationEngine.js.
 */
function computeAutoAlloc(record, locations, sizes, ignoreTeaneck = false) {
  const { allocation } = computeAllocation({
    buy: record?.buy || {},
    ship: record?.ship || {},
    locations,
    sizes,
    ignoreTeaneck
  });
  return allocation;
}



export default function App() {
  // ---------- AUTH ----------
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState(null);
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await me();
        setUser(r.user);
      } catch {
        setUser(null);
      } finally {
        setAuthChecked(true);
      }
    })();
  }, []);

  async function doLogin() {
    setAuthError("");
    try {
      const r = await login(u.trim(), p);
      setUser(r.user);
      setP("");
    } catch (e) {
      setAuthError(e.message || "Login failed");
    }
  }

  async function doLogout() {
    await logout();
    setUser(null);
    setU("");
    setP("");
  }

  // ---------- APP STATE ----------
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  // Mode: shipping | allocation | receiving
  const [mode, setMode] = useState(null);

  const [poInput, setPoInput] = useState("");
  const [poData, setPoData] = useState(null);
  const [selectedId, setSelectedId] = useState("");

  const sizes = SIZES;
  const records = poData?.records || [];
  const selected = useMemo(() => records.find((r) => r.id === selectedId) || null, [records, selectedId]);

  // Locations
  const [locations, setLocations] = useState(DEFAULT_LOCATIONS);
  useEffect(() => {
    (async () => {
      try {
        const r = await getLocations();
        setLocations(sortLocations(r.locations || DEFAULT_LOCATIONS));
      } catch {
        setLocations(DEFAULT_LOCATIONS);
      }
    })();
  }, []);

  // Shipping (Mode 1)
  const [shipDate, setShipDate] = useState("");
  const [shipEdits, setShipEdits] = useState(null);

  // Allocation (Mode 2)
  const [alloc, setAlloc] = useState(() => emptyMatrix(DEFAULT_LOCATIONS, SIZES));
  const [allocEdit, setAllocEdit] = useState(false);
  const [ignoreTeaneck, setIgnoreTeaneck] = useState(false);

  // Receiving (Mode 3)
  const [scan, setScan] = useState(() => emptyMatrix(DEFAULT_LOCATIONS, SIZES));
  const [scanEdit, setScanEdit] = useState(false);
  const [activeLoc, setActiveLoc] = useState(DEFAULT_LOCATIONS[0]);
  const [scanBarcode, setScanBarcode] = useState("");
  const scanInputRef = useRef(null);
  const [lastScanStack, setLastScanStack] = useState([]);

  // Shopify link (auto if Airtable already has product gid)
  const [shopifyLinked, setShopifyLinked] = useState(false);
  const [shopifyProduct, setShopifyProduct] = useState(null);
  const [barcodeLinkInput, setBarcodeLinkInput] = useState("");
  const [barcodeMap, setBarcodeMap] = useState({});

  // ✅ NEW: Shopify manual search + select
  const [shopifySearch, setShopifySearch] = useState("");
  const [shopifySearchResults, setShopifySearchResults] = useState([]);
  const [shopifySelectedProductId, setShopifySelectedProductId] = useState("");

  // ---- Office Samples mode (Mode 4) ----
  const [osStep, setOsStep] = useState("photo"); // "photo" | "scan" | "po" | "done"
  const [osPhoto, setOsPhoto] = useState(null);   // { base64, thumbBase64, filename, previewUrl }
  const [osScanned, setOsScanned] = useState([]); // [{ size, inventoryItemId, barcode }]
  const [osProduct, setOsProduct] = useState(null); // { productId, title, variants }
  const [osPoInput, setOsPoInput] = useState("");
  const [osDelivery, setOsDelivery] = useState("");
  const [osRecord, setOsRecord] = useState(null); // matched Airtable record
  const [osError, setOsError] = useState("");
  const [osManualBarcode, setOsManualBarcode] = useState("");

  // Session log: persisted to localStorage by date
  const today = new Date().toISOString().slice(0, 10);
  const [osLog, setOsLog] = useState(() => {
    try {
      const stored = localStorage.getItem(`os_log_${today}`);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  function addToOsLog(entry) {
    setOsLog((prev) => {
      const next = [...prev, entry];
      try { localStorage.setItem(`os_log_${today}`, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function clearOsLog() {
    if (!window.confirm("Clear the entire session log for today?")) return;
    setOsLog([]);
    try { localStorage.removeItem(`os_log_${today}`); } catch {}
  }

  function resetOsState() {
    setOsStep("photo");
    setOsPhoto(null);
    setOsScanned([]);
    setOsProduct(null);
    setOsPoInput("");
    setOsDelivery("");
    setOsRecord(null);
    setOsError("");
    setOsManualBarcode("");
  }

  // ---- Bulk Allocation mode (Mode 5) ----
  const [baPOText, setBaPOText] = useState("");
  const [baRows, setBaRows] = useState([]); // [{ po, recordId, label, rec, ignoreTeaneck, error }]
  const [baLoaded, setBaLoaded] = useState(false);
  const [baRunning, setBaRunning] = useState(false);
  const [baZipReady, setBaZipReady] = useState(false);

  function baToggleIgnoreTeaneck(idx) {
    setBaRows((prev) => prev.map((r, i) => i === idx ? { ...r, ignoreTeaneck: !r.ignoreTeaneck } : r));
  }

  function baRemoveRow(idx) {
    setBaRows((prev) => prev.filter((_, i) => i !== idx));
  }

  async function onLoadBulkPOs() {
    const poList = baPOText.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (!poList.length) return;

    setBaRows([]);
    setBaLoaded(false);
    setBaRunning(true);
    setBaZipReady(false);
    setStatus(`Loading ${poList.length} PO(s)…`);

    const rows = [];
    for (const po of poList) {
      try {
        const data = await fetchPO(po);
        const recs = data.records || [];
        if (!recs.length) {
          rows.push({ po, recordId: null, label: "No records found", rec: null, ignoreTeaneck: false, error: true });
        } else {
          for (const rec of recs) {
            // Extract product title only (first segment before " • ")
            const title = (rec.label || "").split("•")[0].trim() || rec.label;
            rows.push({ po, recordId: rec.id, label: title, rec, ignoreTeaneck: false, error: false });
          }
        }
      } catch (e) {
        rows.push({ po, recordId: null, label: String(e.message), rec: null, ignoreTeaneck: false, error: true });
      }
    }

    setBaRows(rows);
    setBaLoaded(true);
    setBaRunning(false);
    const ok = rows.filter((r) => !r.error).length;
    setStatus(`Loaded ${ok} product${ok !== 1 ? "s" : ""} from ${poList.length} PO${poList.length !== 1 ? "s" : ""}.`);
  }

  async function onRunBulkAlloc() {
    const validRows = baRows.filter((r) => !r.error && r.rec);
    if (!validRows.length) return;

    setBaRunning(true);
    setBaZipReady(false);
    setStatus(`Running allocation for ${validRows.length} product(s)…`);

    const items = validRows.map((row) => {
      const alloc = computeAutoAlloc(row.rec, locations, sizes, row.ignoreTeaneck);
      return {
        recordId: row.recordId,
        allocJson: JSON.stringify(alloc),
        po: row.po,
        productLabel: row.label,
        sizes,
        locations,
        allocation: alloc,
        buy: row.rec?.buy || {},
        ship: row.rec?.ship || {}
      };
    });

    items.sort((a, b) => {
      const pc = (a.po || "").localeCompare(b.po || "");
      if (pc !== 0) return pc;
      return (a.productLabel || "").localeCompare(b.productLabel || "");
    });

    try {
      setStatus("Saving allocations + generating PDFs…");
      const blob = await bulkAllocPdfs(items);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bulk_allocations_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setBaZipReady(true);
      setStatus(`Bulk allocation complete ✅ ${items.length} PDF(s) downloaded.`);
    } catch (e) {
      setStatus(`Bulk allocation PDF/save failed: ${e.message}`);
    } finally {
      setBaRunning(false);
    }
  }

  async function onRunBulkAllocMerged() {
    const validRows = baRows.filter((r) => !r.error && r.rec);
    if (!validRows.length) return;

    setBaRunning(true);
    setStatus(`Running allocation for ${validRows.length} product(s)…`);

    const items = validRows.map((row) => {
      const alloc = computeAutoAlloc(row.rec, locations, sizes, row.ignoreTeaneck);
      return {
        recordId: row.recordId,
        allocJson: JSON.stringify(alloc),
        po: row.po,
        productLabel: row.label,
        sizes,
        locations,
        allocation: alloc,
        buy: row.rec?.buy || {},
        ship: row.rec?.ship || {}
      };
    });

    items.sort((a, b) => {
      const pc = (a.po || "").localeCompare(b.po || "");
      if (pc !== 0) return pc;
      return (a.productLabel || "").localeCompare(b.productLabel || "");
    });

    try {
      setStatus("Saving allocations + generating merged PDF…");
      const blob = await bulkAllocMergedPdf(items);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bulk_allocations_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setBaZipReady(true);
      setStatus(`Bulk allocation complete ✅ ${items.length} PDF(s) merged and downloaded.`);
    } catch (e) {
      setStatus(`Bulk allocation merged PDF failed: ${e.message}`);
    } finally {
      setBaRunning(false);
    }
  }

  // ---- Product Lookup mode (Mode 6) ----
  const [plBarcode, setPlBarcode] = useState("");
  const [plSearch, setPlSearch] = useState("");
  const [plSearchResults, setPlSearchResults] = useState([]);
  const [plSelectedId, setPlSelectedId] = useState("");
  const [plProduct, setPlProduct] = useState(null);
  const [plLinkedPOs, setPlLinkedPOs] = useState([]);
  const [plLoading, setPlLoading] = useState(false);

  async function onPlBarcodeSearch() {
    const bc = plBarcode.trim();
    if (!bc) return;
    try {
      setPlLoading(true);
      setStatus("Looking up barcode in Shopify…");
      const r = await shopifyByBarcode(bc);
      if (!r.found) {
        setStatus("Barcode not found in Shopify.");
        setPlProduct(null);
        setPlLinkedPOs([]);
        return;
      }
      setPlProduct(r.product);
      const linked = await fetchRecordsByShopifyGid(r.product.productId);
      setPlLinkedPOs(linked.records || []);
      setStatus(linked.records?.length ? `Found ${linked.records.length} linked PO(s) ✅` : "Product found — no POs linked yet.");
    } catch (e) {
      setStatus(`Lookup failed: ${e.message}`);
    } finally {
      setPlLoading(false);
    }
  }

  async function onPlTitleSearch() {
    const q = plSearch.trim();
    if (!q) return;
    try {
      setPlLoading(true);
      setStatus("Searching Shopify products…");
      const r = await shopifySearchByTitle(q);
      setPlSearchResults(r.products || []);
      setPlSelectedId(r.products?.[0]?.productId || "");
      setStatus(r.products?.length ? `Found ${r.products.length} product(s) ✅` : "No products found.");
    } catch (e) {
      setStatus(`Search failed: ${e.message}`);
      setPlSearchResults([]);
    } finally {
      setPlLoading(false);
    }
  }

  async function onPlSelectProduct() {
    const gid = plSelectedId.trim();
    if (!gid) return;
    try {
      setPlLoading(true);
      setStatus("Loading product + linked POs…");
      const [prodRes, linkedRes] = await Promise.all([
        shopifyByProductId(gid),
        fetchRecordsByShopifyGid(gid)
      ]);
      setPlProduct(prodRes.product);
      setPlLinkedPOs(linkedRes.records || []);
      setStatus(linkedRes.records?.length ? `Found ${linkedRes.records.length} linked PO(s) ✅` : "Product found — no POs linked yet.");
    } catch (e) {
      setStatus(`Failed: ${e.message}`);
    } finally {
      setPlLoading(false);
    }
  }

  // Derived
  const unitCost = Number(selected?.unitCost ?? 0);

  const buyTotalsBySize = useMemo(() => {
    const t = {};
    for (const s of sizes) t[s] = Number(selected?.buy?.[s] ?? 0);
    return t;
  }, [selected, sizes]);

  const shipTotalsBySize = useMemo(() => {
    const t = {};
    for (const s of sizes) t[s] = Number(shipEdits?.[s] ?? 0);
    return t;
  }, [shipEdits, sizes]);

  const allocTotalsBySize = useMemo(() => perSizeTotalsFromMatrix(alloc, locations, sizes), [alloc, locations, sizes]);
  const scanTotalsBySize = useMemo(() => perSizeTotalsFromMatrix(scan, locations, sizes), [scan, locations, sizes]);

  const allocMatchesShip = useMemo(() => equalsPerSize(allocTotalsBySize, shipTotalsBySize, sizes), [
    allocTotalsBySize,
    shipTotalsBySize,
    sizes
  ]);

  const scanMatchesAlloc = useMemo(() => equalsPerSize(scanTotalsBySize, allocTotalsBySize, sizes), [
    scanTotalsBySize,
    allocTotalsBySize,
    sizes
  ]);

  // ---------- LOAD PO ----------
  async function onLoadPO() {
    setStatus("");
    const po = poInput.trim();
    if (!po) return;

    try {
      setLoading(true);
      const data = await fetchPO(po);
      setPoData(data);

      if ((data.records || []).length === 1) setSelectedId(data.records[0].id);
      else setSelectedId("");

      if (!(data.records || []).length) setStatus("No records found for that PO #.");
    } catch (e) {
      setStatus(e.message);
    } finally {
      setLoading(false);
    }
  }

  function buildBarcodeMapFromProduct(product) {
    const map = {};
    for (const v of product?.variants || []) {
      const b = String(v.barcode || "").trim();
      if (!b) continue;
      const size = normalizeSizeValue(v.sizeValue);
      if (!size) continue;
      map[b] = { size, inventoryItemId: v.inventoryItemId };
    }
    return map;
  }

  async function autoLoadShopifyIfLinked(record) {
    const gid = record?.shopifyProductGid;
    if (!gid) return;
    try {
      setLoading(true);
      setStatus("Loading linked Shopify product…");
      const r = await shopifyByProductId(gid);
      setShopifyLinked(true);
      setShopifyProduct(r.product);
      setBarcodeMap(buildBarcodeMapFromProduct(r.product));
      setStatus(`Linked Shopify loaded: ${r.product?.title || "Product"} ✅`);
    } catch (e) {
      setShopifyLinked(false);
      setShopifyProduct(null);
      setBarcodeMap({});
      setStatus(`Could not load linked Shopify product: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // Hydrate selection
  useEffect(() => {
    if (!selected) return;

    setShipEdits({ ...selected.ship });
    setShipDate(fmtDateForInput(selected.shipDate));

    const a = parseJsonOrNull(selected.allocJson) || emptyMatrix(locations, sizes);
    const sc = parseJsonOrNull(selected.scanJson) || emptyMatrix(locations, sizes);

    const normalizedA = emptyMatrix(locations, sizes);
    const normalizedS = emptyMatrix(locations, sizes);

    for (const loc of locations) {
      for (const s of sizes) {
        normalizedA[loc][s] = Number(a?.[loc]?.[s] ?? 0);
        normalizedS[loc][s] = Number(sc?.[loc]?.[s] ?? 0);
      }
    }

    setAlloc(normalizedA);
    setScan(normalizedS);

    setActiveLoc(locations[0] || DEFAULT_LOCATIONS[0]);

    setAllocEdit(false);
    setScanEdit(false);

    // reset shopify/manual search state on product switch
    setShopifyLinked(false);
    setShopifyProduct(null);
    setBarcodeLinkInput("");
    setBarcodeMap({});
    setShopifySearch("");
    setShopifySearchResults([]);
    setShopifySelectedProductId("");

    setScanBarcode("");
    setLastScanStack([]);

    setStatus("");

    autoLoadShopifyIfLinked(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, locations]);

  function setShipCell(size, value) {
    const v = clampInt(value);
    setShipEdits((prev) => ({ ...(prev || {}), [size]: v }));
  }

  function setAllocCell(loc, size, value) {
    const v = clampInt(value);
    setAlloc((prev) => ({ ...prev, [loc]: { ...(prev[loc] || {}), [size]: v } }));
  }

  function bumpAllocCell(loc, size, delta) {
    setAlloc((prev) => {
      const cur = Number(prev?.[loc]?.[size] ?? 0);
      const next = Math.max(0, cur + delta);
      return { ...prev, [loc]: { ...(prev[loc] || {}), [size]: next } };
    });
  }

  function setScanCell(loc, size, value) {
    const v = clampInt(value);
    setScan((prev) => ({ ...prev, [loc]: { ...(prev[loc] || {}), [size]: v } }));
  }

  function bumpScanCell(loc, size, delta) {
    setScan((prev) => {
      const cur = Number(prev?.[loc]?.[size] ?? 0);
      const next = Math.max(0, cur + delta);
      return { ...prev, [loc]: { ...(prev[loc] || {}), [size]: next } };
    });
  }

  // ---------- Mode 1: Save Shipping ----------
  async function onSaveShipping() {
    if (!selectedId) return;
    try {
      setLoading(true);
      setStatus("Saving shipping…");
      await saveShip(selectedId, shipDate, shipEdits || {});
      setStatus("Shipping saved ✅");
    } catch (e) {
      setStatus(`Shipping save failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ---------- Mode 2: Auto Allocate (pack-based, BUY-based) ----------
  function onAutoAllocate() {
  if (!selected) return;
  // Build a synthetic record using current ship edits (user may have changed them)
  const recordForAlloc = { buy: selected.buy, ship: shipTotalsBySize };
  const built = computeAutoAlloc(recordForAlloc, locations, sizes, ignoreTeaneck);
  setAlloc(built);
  setStatus("Auto Allocated ✅ Pack-sequence allocator applied.");
}

  // ---------- Mode 2: Save Allocation ----------
  async function onSaveAllocation() {
    if (!selectedId) return;

    if (!allocMatchesShip) {
      const diffs = diffPerSize(allocTotalsBySize, shipTotalsBySize, sizes);
      const msg =
        "Allocation totals do not match Ship Units.\n\n" +
        sizes
          .map((s) => `${s}: alloc ${allocTotalsBySize[s]} vs ship ${shipTotalsBySize[s]} (diff ${diffs[s]})`)
          .join("\n") +
        "\n\nSubmit anyway?";
      const ok = window.confirm(msg);
      if (!ok) return;
    }

    try {
      setLoading(true);
      setStatus("Saving allocation…");
      await saveAllocation(selectedId, alloc);
      setStatus("Allocation saved ✅");
    } catch (e) {
      setStatus(`Allocation save failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitAllocationAndDownloadPdf() {
    if (!selectedId || !selected) return;

    if (!allocMatchesShip) {
      const ok = window.confirm("Allocation does NOT match Ship Units.\n\nSubmit + PDF anyway?");
      if (!ok) return;
    }

    try {
      setLoading(true);
      setStatus("Submitting allocation… Generating Allocation PDF…");

      // Save allocation first (so Airtable is in sync)
      await saveAllocation(selectedId, alloc);

      const payload = {
        recordId: selectedId,
        po: poData?.po || "",
        productLabel: selected.label,
        sizes,
        locations,
        allocation: alloc,
        buy: selected.buy || {},
        ship: shipEdits || {}
      };

      const pdfBlob = await allocationPdf(payload);

      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `allocation_${poData?.po || "PO"}_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatus("Allocation submitted ✅ Allocation PDF downloaded.");
    } catch (e) {
      setStatus(`Allocation submit/PDF failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ---------- Shopify: Link by barcode ----------
  async function onLinkShopifyAndPersist() {
    const bc = barcodeLinkInput.trim();
    if (!bc || !selectedId) return;

    try {
      setLoading(true);
      setStatus("Finding Shopify product…");

      const r = await shopifyByBarcode(bc);
      if (!r.found) {
        setStatus("Barcode not found in Shopify.");
        return;
      }

      const productId = r.product.productId;

      setStatus("Writing Shopify Product GID to Airtable…");
      await linkShopifyProduct(selectedId, productId);

      setShopifyLinked(true);
      setShopifyProduct(r.product);
      setBarcodeMap(buildBarcodeMapFromProduct(r.product));
      setStatus(`Linked + saved ✅ ${r.product.title}`);

      if (poData?.po) {
        const refreshed = await fetchPO(poData.po);
        setPoData(refreshed);
      }

      setTimeout(() => scanInputRef.current?.focus(), 50);
    } catch (e) {
      setStatus(`Link failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ✅ NEW: Shopify search and manual select
  async function onShopifySearch() {
    const q = shopifySearch.trim();
    if (!q) return;
    try {
      setLoading(true);
      setStatus("Searching Shopify products…");
      const r = await shopifySearchByTitle(q);
      const products = r.products || [];
      setShopifySearchResults(products);
      setShopifySelectedProductId(products[0]?.productId || "");
      setStatus(products.length ? `Found ${products.length} products ✅` : "No products found.");
    } catch (e) {
      setShopifySearchResults([]);
      setShopifySelectedProductId("");
      setStatus(`Search failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function onLinkSelectedShopifyProduct() {
    if (!selectedId) return;
    const productId = String(shopifySelectedProductId || "").trim();
    if (!productId) return;

    try {
      setLoading(true);
      setStatus("Linking selected Shopify product…");

      // Fetch variants so scanning works immediately
      const r = await shopifyByProductId(productId);

      setStatus("Writing Shopify Product GID to Airtable…");
      await linkShopifyProduct(selectedId, productId);

      setShopifyLinked(true);
      setShopifyProduct(r.product);
      setBarcodeMap(buildBarcodeMapFromProduct(r.product));
      setStatus(`Linked + saved ✅ ${r.product.title}`);

      if (poData?.po) {
        const refreshed = await fetchPO(poData.po);
        setPoData(refreshed);
      }

      setTimeout(() => scanInputRef.current?.focus(), 50);
    } catch (e) {
      setStatus(`Manual link failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ---------- Mode 3: Scanning ----------
  function onScanSubmit(e) {
    e.preventDefault();
    if (!shopifyLinked || !shopifyProduct) return;

    const bc = scanBarcode.trim();
    if (!bc) return;

    const hit = barcodeMap[bc];
    if (!hit) {
      window.alert("This barcode is NOT part of the linked Shopify product.");
      return;
    }

    const size = hit.size;
    if (!sizes.includes(size)) {
      window.alert(`Scanned size "${size}" is not in the size matrix for this tool.`);
      return;
    }

    const allocCap = Number(alloc?.[activeLoc]?.[size] ?? 0);
    const cur = Number(scan?.[activeLoc]?.[size] ?? 0);

    if (cur + 1 > allocCap) {
      const ok = window.confirm(
        `Over allocation for ${activeLoc} ${size}.\n\nAllocated: ${allocCap}\nScanned would become: ${cur + 1}\n\nOverride and allow anyway?`
      );
      if (!ok) {
        setStatus(`Over allocation blocked: ${activeLoc} ${size} (alloc ${allocCap})`);
        return;
      }
      setStatus(`Override: scanned beyond allocation for ${activeLoc} ${size}`);
    } else {
      setStatus(`Scanned 1 → ${activeLoc} ${size}`);
    }

    setScan((prev) => ({
      ...prev,
      [activeLoc]: { ...(prev[activeLoc] || {}), [size]: cur + 1 }
    }));
    setLastScanStack((prev) => [...prev, { loc: activeLoc, size }]);

    setScanBarcode("");
    setTimeout(() => scanInputRef.current?.focus(), 25);
  }

  function undoLastScan() {
    setLastScanStack((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];

      setScan((cur) => {
        const curVal = Number(cur?.[last.loc]?.[last.size] ?? 0);
        const nextVal = Math.max(0, curVal - 1);
        return { ...cur, [last.loc]: { ...(cur[last.loc] || {}), [last.size]: nextVal } };
      });

      setStatus("Undid last scan ↩️");
      return prev.slice(0, -1);
    });
  }

  async function onSaveScanToAirtable() {
    if (!selectedId) return;
    try {
      setLoading(true);
      setStatus("Saving scan progress…");
      const recTotals = perSizeTotalsFromMatrix(scan, locations, sizes);
      await saveScan(selectedId, scan, recTotals);
      setStatus("Scan saved ✅");
    } catch (e) {
      setStatus(`Scan save failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ---------- Mode 4: Office Samples ----------

  async function onOsPhotoCapture(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result;
      const thumbBase64 = await resizeImageDataUrl(base64, 400);
      setOsPhoto({ base64, thumbBase64, filename: file.name || "photo.jpg", previewUrl: base64 });
    };
    reader.readAsDataURL(file);
    // reset file input so same file can be re-selected
    e.target.value = "";
  }

  async function processOsBarcode(barcode) {
    if (!barcode) return;
    // If product already identified, match variant directly
    if (osProduct) {
      const variant = osProduct.variants.find((v) => v.barcode === barcode);
      if (!variant) throw new Error(`Barcode "${barcode}" is not from "${osProduct.title}". Scan a barcode from the same product.`);
      const size = normalizeSizeValue(variant.sizeValue);
      if (osScanned.find((v) => v.size === size)) throw new Error(`Size ${size} already scanned.`);
      setOsScanned((prev) => [...prev, { size, inventoryItemId: variant.inventoryItemId, barcode }]);
      return;
    }
    // First scan: identify product
    const r = await shopifyByBarcode(barcode);
    if (!r.found || !r.product) throw new Error(`Barcode "${barcode}" not found in Shopify.`);
    const product = r.product;
    const variant = product.variants.find((v) => v.barcode === barcode);
    if (!variant) throw new Error("Variant not found in product.");
    const size = normalizeSizeValue(variant.sizeValue);
    setOsProduct(product);
    setOsScanned([{ size, inventoryItemId: variant.inventoryItemId, barcode }]);

    // Auto-lookup linked POs via Shopify Product GID
    try {
      const linked = await fetchRecordsByShopifyGid(product.productId);
      const linkedRecs = linked.records || [];
      if (linkedRecs.length >= 1) {
        const autoPO = linkedRecs[0].po;
        setOsPoInput(autoPO);
        // If exactly one linked PO, also auto-load the Airtable record
        if (linkedRecs.length === 1) {
          const data = await fetchPO(autoPO);
          const match = (data.records || []).find((rec) => rec.shopifyProductGid === product.productId);
          if (match) {
            setOsRecord(match);
            setOsDelivery(fmtDateForInput(match.delivery) || "");
          }
        }
      }
    } catch {
      // Silently ignore — user can enter PO manually
    }
  }

  async function onOsCameraScan() {
    setOsError("");
    try {
      setLoading(true);
      const barcode = await launchDynamsoftScanner();
      if (!barcode) { setOsError("No barcode detected. Try again."); return; }
      await processOsBarcode(barcode);
    } catch (e) {
      setOsError(e.message || "Scanner error");
    } finally {
      setLoading(false);
    }
  }

  async function onOsManualScan() {
    const bc = osManualBarcode.trim();
    if (!bc) return;
    setOsError("");
    setOsManualBarcode("");
    try {
      setLoading(true);
      await processOsBarcode(bc);
    } catch (e) {
      setOsError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function onOsLoadPO() {
    const po = osPoInput.trim();
    if (!po || !osProduct) return;
    setOsError("");
    try {
      setLoading(true);
      const data = await fetchPO(po);
      const match = (data.records || []).find((r) => r.shopifyProductGid === osProduct.productId);
      if (!match) {
        setOsError(`No Airtable record in PO "${po}" matches "${osProduct.title}". Make sure the Shopify_Product_GID field is linked on this record.`);
        setOsRecord(null);
        return;
      }
      setOsRecord(match);
      setOsDelivery(fmtDateForInput(match.delivery) || "");
    } catch (e) {
      setOsError(`PO load failed: ${e.message}`);
      setOsRecord(null);
    } finally {
      setLoading(false);
    }
  }

  async function onOsSubmit() {
    if (!osRecord || !osPhoto || osScanned.length === 0) return;
    setOsError("");
    try {
      setLoading(true);
      setStatus("Submitting office sample…");

      const result = await submitOfficeSample(osRecord.id, {
        inventoryAdjustments: osScanned.map((v) => ({ inventoryItemId: v.inventoryItemId, delta: 1 })),
        officeSentDate: today,
        deliveryDate: osDelivery || undefined,
        photoBase64: osPhoto.base64,
        photoFilename: osPhoto.filename,
        currentScanJson: osRecord.scanJson || null,
        scannedSizes: osScanned.map((v) => v.size)
      });

      // Add to session log with thumbnail
      addToOsLog({
        productTitle: osProduct.title,
        poNumber: osPoInput.trim(),
        sizes: osScanned.map((v) => v.size),
        thumbBase64: osPhoto.thumbBase64,
        timestamp: new Date().toLocaleString()
      });

      const photoNote = result.photoUploadError ? " (photo upload to Airtable failed — saved in session log)" : "";
      setStatus(`Office sample submitted${photoNote} ✅`);
      setOsStep("done");
    } catch (e) {
      setOsError(`Submit failed: ${e.message}`);
      setStatus(`Office sample submit failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function onDownloadSessionPdf() {
    if (!osLog.length) return;
    try {
      setLoading(true);
      setStatus("Generating session PDF…");
      const blob = await downloadSessionPdf(osLog, today);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `office_samples_${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus("Session PDF downloaded ✅");
    } catch (e) {
      setStatus(`Session PDF failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ---------- Mode 3: Closeout ----------
  async function onCloseout() {
    if (!selectedId || !selected) return;

    if (!allocMatchesShip) {
      const ok = window.confirm("Allocation does NOT match Ship Units.\n\nSubmit closeout anyway?");
      if (!ok) return;
    }

    if (!scanMatchesAlloc) {
      const ok = window.confirm("Scanned totals do NOT match Allocation.\n\nSubmit closeout anyway?");
      if (!ok) return;
    }

    try {
      setLoading(true);
      setStatus("Submitting closeout… Generating PDF…");

      const payload = {
        recordId: selectedId,
        po: poData?.po || "",
        productLabel: selected.label,
        sizes,
        locations,
        allocation: alloc,
        scanned: scan,
        shopifyProduct: shopifyLinked ? shopifyProduct : null,
        officeAlreadySent: !!selected.officeSent,
        buy: selected.buy || {},
        ship: shipEdits || {}
      };

      const pdfBlob = await closeoutPdf(payload);

      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `closeout_${poData?.po || "PO"}_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatus("Closeout complete ✅ PDF downloaded.");
    } catch (e) {
      setStatus(`Closeout failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ---------- Auth UI ----------
  if (!authChecked) {
    return (
      <div className="authShell">
        <div className="authCard">Loading…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="authShell">
        <div className="authCard">
          <div className="authTitle">Sign in</div>
          <div className="authSub">Enter your username and password.</div>
          <input className="authInput" value={u} onChange={(e) => setU(e.target.value)} placeholder="Username" />
          <input className="authInput" type="password" value={p} onChange={(e) => setP(e.target.value)} placeholder="Password" />
          {authError ? <div className="authError">{authError}</div> : null}
          <button className="btn primary" onClick={doLogin} disabled={!u.trim() || !p}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  const bannerType = statusKind(status);

  return (
    <div className="app">
      <div className="shell">
        <header className="header">
          <div className="brand">
            <div className="brandTitle">PO Ship / Allocate / Receive</div>
            <div className="brandSub">Pick a mode, then do one job at a time.</div>
          </div>

          <div className="headerRight">
            <div className="userPill">
              Signed in as <strong>{user.username}</strong>
              <button className="linkBtn" onClick={doLogout}>
                Log out
              </button>
            </div>
          </div>
        </header>

        {status ? <div className={`banner ${bannerType}`}>{status}</div> : null}

        <div className="layout">
          {/* LEFT */}
          <aside className="card lookup">
            <div className="cardTitle">Workflow</div>

            {!mode ? (
              <div className="modePick">
                <button className="btn primary modeBtn" onClick={() => setMode("shipping")}>
                  1) Shipping
                </button>
                <button className="btn primary modeBtn" onClick={() => setMode("allocation")}>
                  2) Allocation
                </button>
                <button className="btn primary modeBtn" onClick={() => setMode("receiving")}>
                  3) Receiving
                </button>
                <button className="btn primary modeBtn" onClick={() => { setMode("office-samples"); resetOsState(); }}>
                  4) Office Samples
                </button>
                <button className="btn primary modeBtn" onClick={() => { setMode("bulk-allocation"); setBaRows([]); setBaLoaded(false); setBaZipReady(false); }}>
                  5) Bulk Allocation
                </button>
                <button className="btn primary modeBtn" onClick={() => { setMode("product-lookup"); setPlProduct(null); setPlLinkedPOs([]); setPlSearchResults([]); setPlBarcode(""); setPlSearch(""); }}>
                  6) Product Lookup
                </button>
                <div className="hint">After picking a mode, load a PO and select a product.</div>
              </div>
            ) : mode === "bulk-allocation" ? (
              <>
                <div className="modeBar">
                  <div className="modePill">Mode: <strong>Bulk Allocation</strong></div>
                  <button className="btn" onClick={() => setMode(null)}>Change</button>
                </div>
                <div className="divider" />
                <div className="hint">Load POs, set per-product Ignore Teaneck, then run.</div>
              </>
            ) : mode === "product-lookup" ? (
              <>
                <div className="modeBar">
                  <div className="modePill">Mode: <strong>Product Lookup</strong></div>
                  <button className="btn" onClick={() => setMode(null)}>Change</button>
                </div>
                <div className="divider" />
                <div className="hint">Scan a barcode or search by title to find which POs are linked to a Shopify product.</div>
              </>
            ) : mode === "office-samples" ? (
              <>
                <div className="modeBar">
                  <div className="modePill">Mode: <strong>Office Samples</strong></div>
                  <button className="btn" onClick={() => { setMode(null); resetOsState(); }}>Change</button>
                </div>
                <div className="divider" />
                <div className="hint" style={{ marginBottom: 12 }}>
                  Photo → Scan barcodes → PO → Submit
                </div>

                {osLog.length > 0 && (
                  <>
                    <div className="divider" />
                    <div className="label" style={{ marginBottom: 6 }}>Session Log</div>
                    <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
                      {osLog.length} product{osLog.length === 1 ? "" : "s"} sent today
                    </div>
                    <button
                      className="btn primary"
                      onClick={onDownloadSessionPdf}
                      disabled={loading}
                      style={{ width: "100%", marginBottom: 6 }}
                    >
                      Download Session PDF
                    </button>
                    <button
                      className="btn"
                      onClick={clearOsLog}
                      style={{ width: "100%" }}
                    >
                      Clear Session
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="modeBar">
                  <div className="modePill">
                    Mode:{" "}
                    <strong>{mode === "shipping" ? "Shipping" : mode === "allocation" ? "Allocation" : "Receiving"}</strong>
                  </div>
                  <button className="btn" onClick={() => setMode(null)}>
                    Change
                  </button>
                </div>

                <div className="divider" />

                <div className="field">
                  <div className="label">PO #</div>
                  <div className="hstack">
                    <input
                      className="input"
                      value={poInput}
                      onChange={(e) => setPoInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onLoadPO();
                      }}
                      placeholder="Scan or type PO (e.g. YB1892)"
                    />
                    <button className="btn primary" onClick={onLoadPO} disabled={loading || !poInput.trim()}>
                      {loading ? "Loading…" : "Load"}
                    </button>
                  </div>
                </div>

                {poData && (
                  <div className="field">
                    <div className="label">Product</div>
                    <select className="select" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                      <option value="">{records.length ? "Select a product…" : "(no products found)"}</option>
                      {records.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Shopify link is in Mode 2 + Mode 3 */}
                {selected && (mode === "allocation" || mode === "receiving") ? (
                  <>
                    <div className="divider" />
                    <div className="field">
                      <div className="label">Shopify Link (one-time per product)</div>

                      {selected.shopifyProductGid ? (
                        <div className="hint">
                          ✅ Linked in Airtable
                          <div style={{ marginTop: 8 }}>
                            <button className="btn" onClick={() => autoLoadShopifyIfLinked(selected)} disabled={loading} type="button">
                              Refresh Shopify Variants
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Barcode link */}
                          <div className="hstack">
                            <input
                              className="input"
                              value={barcodeLinkInput}
                              onChange={(e) => setBarcodeLinkInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") onLinkShopifyAndPersist();
                              }}
                              placeholder="Scan/enter ANY variant barcode…"
                              disabled={!selected}
                            />
                            <button
                              className="btn"
                              onClick={onLinkShopifyAndPersist}
                              disabled={!selected || loading || !barcodeLinkInput.trim()}
                              type="button"
                            >
                              Link by Barcode
                            </button>
                          </div>

                          <div className="divider" />

                          {/* ✅ NEW: Title search + select */}
                          <div className="hstack">
                            <input
                              className="input"
                              value={shopifySearch}
                              onChange={(e) => setShopifySearch(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") onShopifySearch();
                              }}
                              placeholder="Or search Shopify by product title…"
                              disabled={!selected}
                            />
                            <button className="btn" onClick={onShopifySearch} disabled={loading || !shopifySearch.trim()} type="button">
                              Search
                            </button>
                          </div>

                          {shopifySearchResults.length ? (
                            <div style={{ marginTop: 10 }}>
                              <select
                                className="select"
                                value={shopifySelectedProductId}
                                onChange={(e) => setShopifySelectedProductId(e.target.value)}
                              >
                                {shopifySearchResults.map((p) => (
                                  <option key={p.productId} value={p.productId}>
                                    {p.title}
                                  </option>
                                ))}
                              </select>

                              <div style={{ marginTop: 8 }}>
                                <button
                                  className="btn"
                                  onClick={onLinkSelectedShopifyProduct}
                                  disabled={loading || !shopifySelectedProductId}
                                  type="button"
                                >
                                  Link Selected Product
                                </button>
                              </div>
                            </div>
                          ) : null}

                          <div className="hint" style={{ marginTop: 8 }}>
                            Barcode is fastest. Search is for when barcode isn’t available.
                          </div>
                        </>
                      )}
                    </div>
                  </>
                ) : null}
              </>
            )}
          </aside>

          {/* RIGHT */}
          <main className="card main">
            {!mode ? (
              <div className="emptyState">
                <div className="emptyTitle">Choose a mode.</div>
                <div className="emptyText">Shipping → Allocation → Receiving are separate screens so it stays simple.</div>
              </div>
            ) : mode === "bulk-allocation" ? (
              <BulkAllocationPanel
                poText={baPOText}
                onPoTextChange={setBaPOText}
                onLoad={onLoadBulkPOs}
                rows={baRows}
                loaded={baLoaded}
                running={baRunning}
                zipReady={baZipReady}
                onToggleIgnoreTeaneck={baToggleIgnoreTeaneck}
                onRemoveRow={baRemoveRow}
                onRun={onRunBulkAlloc}
                onRunMerged={onRunBulkAllocMerged}
              />
            ) : mode === "product-lookup" ? (
              <ProductLookupPanel
                barcode={plBarcode}
                onBarcodeChange={setPlBarcode}
                onBarcodeSearch={onPlBarcodeSearch}
                search={plSearch}
                onSearchChange={setPlSearch}
                onTitleSearch={onPlTitleSearch}
                searchResults={plSearchResults}
                selectedId={plSelectedId}
                onSelectedIdChange={setPlSelectedId}
                onSelectProduct={onPlSelectProduct}
                product={plProduct}
                linkedPOs={plLinkedPOs}
                loading={plLoading}
              />
            ) : mode === "office-samples" ? (
              <OfficeSamplesWizard
                step={osStep}
                photo={osPhoto}
                scanned={osScanned}
                product={osProduct}
                poInput={osPoInput}
                delivery={osDelivery}
                record={osRecord}
                error={osError}
                loading={loading}
                manualBarcode={osManualBarcode}
                onPhotoCapture={onOsPhotoCapture}
                onRetakePhoto={() => setOsPhoto(null)}
                onNextToScan={() => setOsStep("scan")}
                onCameraScan={onOsCameraScan}
                onManualBarcodeChange={(v) => setOsManualBarcode(v)}
                onManualScan={onOsManualScan}
                onClearScanned={() => { setOsScanned([]); setOsProduct(null); setOsError(""); }}
                onRemoveScanned={(size) => setOsScanned((prev) => prev.filter((v) => v.size !== size))}
                onNextToPO={() => { setOsStep("po"); setOsError(""); }}
                onPoInputChange={(v) => setOsPoInput(v)}
                onLoadPO={onOsLoadPO}
                onDeliveryChange={(v) => setOsDelivery(v)}
                onSubmit={onOsSubmit}
                onStartNext={() => { resetOsState(); }}
              />
            ) : !selected ? (
              <div className="emptyState">
                <div className="emptyTitle">Load a PO and select a product.</div>
                <div className="emptyText">Then you'll see the {mode} screen for that product.</div>
              </div>
            ) : (
              <>
                <div className="topRow">
                  <div className="productInfo">
                    <div className="productTitle">{selected.label}</div>
                    <div className="productBadges">
                      <span className="badge">Unit Cost: {money(unitCost)}</span>
                      <span className="badge subtle">PO: {poData?.po}</span>
                    </div>
                  </div>

                  <div className="imageCard">
                    {selected.imageUrl ? (
                      <img className="image" src={selected.imageUrl} alt="Product or Swatch" />
                    ) : (
                      <div className="imageEmpty">No image</div>
                    )}
                  </div>
                </div>

                {mode === "shipping" ? (
                  <>
                    <div className="sectionTitle">Mode 1 — Shipping</div>
                    <div className="hint">Enter ship date + shipped units. Buy is shown for reference.</div>

                    <div className="shipBlock">
                      <div className="shipRow">
                        <div className="label">Ship Date</div>
                        <input className="dateBig" type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} />
                      </div>

                      <BuyShipTotalsRow sizes={sizes} buyTotals={buyTotalsBySize} shipTotals={shipTotalsBySize} />

                      <div className="tableCard">
                        <table className="matrix2 matrixSimple">
                          <thead>
                            <tr>
                              <th className="c-loc"> </th>
                              {sizes.map((s) => (
                                <th key={s} className="c-size2">
                                  {s}
                                </th>
                              ))}
                              <th className="c-rowtotal">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="locCell subtleRow">Buy</td>
                              {sizes.map((s) => (
                                <td key={s} className="cellRead">
                                  {Number(selected.buy?.[s] ?? 0)}
                                </td>
                              ))}
                              <td className="cellRead strong">{sumPerSize(buyTotalsBySize, sizes)}</td>
                            </tr>
                            <tr>
                              <td className="locCell">Ship</td>
                              {sizes.map((s) => (
                                <td key={s}>
                                  <input
                                    className="qty2"
                                    inputMode="numeric"
                                    value={shipEdits?.[s] ?? 0}
                                    onChange={(e) => setShipCell(s, e.target.value)}
                                  />
                                </td>
                              ))}
                              <td className="cellRead strong">{sumPerSize(shipTotalsBySize, sizes)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <div className="rowActions">
                        <button className="btn primary" onClick={onSaveShipping} disabled={loading || !selectedId}>
                          Save Shipping
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}

                {mode === "allocation" ? (
                  <>
                    <div className="sectionTitle">Mode 2 — Allocation</div>
                    <div className="hint">Auto Allocate uses BUY-based packs; overage Ship→Warehouse.</div>

                    <BuyShipTotalsRow sizes={sizes} buyTotals={buyTotalsBySize} shipTotals={shipTotalsBySize} />

                    <div className="modeTools">
                      <button className="btn primary" onClick={onAutoAllocate} type="button" disabled={loading}>
                        Auto Allocate
                      </button>
                      <button className="btn" onClick={() => setAllocEdit((v) => !v)} type="button">
                        {allocEdit ? "Done Editing" : "Edit Allocation"}
                      </button>

                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 10 }}>
                        <input type="checkbox" checked={ignoreTeaneck} onChange={(e) => setIgnoreTeaneck(e.target.checked)} />
                        Ignore Teaneck
                      </label>

                      <div className={`modeFlag ${allocMatchesShip ? "okText" : "badText"}`}>
                        {allocMatchesShip ? "Totals match Ship Units" : "Totals do NOT match Ship Units"}
                      </div>
                    </div>

                    <AllocationMatrix
                      locations={locations}
                      sizes={sizes}
                      alloc={alloc}
                      shipTotalsBySize={shipTotalsBySize}
                      allocTotalsBySize={allocTotalsBySize}
                      edit={allocEdit}
                      setAllocCell={setAllocCell}
                      bumpAllocCell={bumpAllocCell}
                    />

                    <div className="rowActions">
                      <button className="btn primary" onClick={onSaveAllocation} disabled={loading || !selectedId} type="button">
                        Submit Allocation
                      </button>
                      <button className="btn primary" onClick={onSubmitAllocationAndDownloadPdf} disabled={loading || !selectedId}>
                        Submit + Download Allocation PDF
                      </button>
                    </div>
                  </>
                ) : null}

                {mode === "receiving" ? (
                  <>
                    <div className="sectionTitle">Mode 3 — Receiving</div>
                    <div className="hint">Select a location, then scan. The selected location stays visually obvious.</div>

                    {selected.officeSent ? (
                      <div className="banner info" style={{ marginBottom: 10 }}>
                        Office samples sent on {fmtDateForInput(selected.officeSent)} — Office column pre-filled. Shopify Office inventory will NOT be re-adjusted at closeout.
                      </div>
                    ) : null}

                    <div className="locBar">
                      <div className="locTitle">Selected Location</div>
                      <div className="locButtons">
                        {locations.map((l) => (
                          <button
                            key={l}
                            type="button"
                            className={`locBtn ${activeLoc === l ? "active" : ""}`}
                            onClick={() => {
                              setActiveLoc(l);
                              setTimeout(() => scanInputRef.current?.focus(), 25);
                            }}
                          >
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="scanCard">
                      <div className="scanHeader">
                        <div className="scanHeaderTitle">Scan</div>
                        <div className="scanHeaderMeta">
                          Active: <span className="tag">{activeLoc}</span>
                          {!shopifyLinked ? <span className="tag warn">Link Shopify to scan</span> : null}
                        </div>
                      </div>

                      <form className="scanForm" onSubmit={onScanSubmit}>
                        <input
                          ref={scanInputRef}
                          className="input scanInput"
                          value={scanBarcode}
                          onChange={(e) => setScanBarcode(e.target.value)}
                          placeholder={shopifyLinked ? "Scan variant barcode…" : "Scanning disabled until Shopify is linked"}
                          disabled={!shopifyLinked || loading}
                        />
                        <button className="btn primary" disabled={!shopifyLinked || loading || !scanBarcode.trim()} type="submit">
                          Add
                        </button>
                        <button className="btn" type="button" onClick={undoLastScan} disabled={!lastScanStack.length}>
                          Undo
                        </button>
                        <button className="btn" type="button" onClick={onSaveScanToAirtable} disabled={loading || !selectedId}>
                          Save Progress
                        </button>
                        <button className="btn" type="button" onClick={() => setScanEdit((v) => !v)}>
                          {scanEdit ? "Done Editing" : "Edit Counts"}
                        </button>
                      </form>

                      <div className="scanHint">Tip: over-scans prompt for override. Wrong barcode warns.</div>
                    </div>

                    <ActiveLocSummary activeLoc={activeLoc} sizes={sizes} alloc={alloc} scan={scan} />

                    <ReceivingMatrixClean
                      locations={locations}
                      sizes={sizes}
                      alloc={alloc}
                      scan={scan}
                      activeLoc={activeLoc}
                      edit={scanEdit}
                      setScanCell={setScanCell}
                      bumpScanCell={bumpScanCell}
                    />

                    <div className="actionsRow">
                      <button className="btn primary" onClick={onCloseout} disabled={loading || !selectedId} type="button">
                        Submit Closeout + Download PDF
                      </button>

                      <div className="actionsNote">
                        You’ll get warnings if Allocation≠Ship or Scan≠Allocation, but you can still submit if needed.
                      </div>
                    </div>
                  </>
                ) : null}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Components ---------------- */

function BuyShipTotalsRow({ sizes, buyTotals, shipTotals }) {
  return (
    <div className="tableCard compactTopTable">
      <table className="matrix2 matrixTopTotals">
        <thead>
          <tr>
            <th className="c-loc">Totals</th>
            {sizes.map((s) => (
              <th key={s} className="c-size2">
                {s}
              </th>
            ))}
            <th className="c-rowtotal">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="locCell subtleRow">Buy</td>
            {sizes.map((s) => (
              <td key={s} className="cellRead">
                {Number(buyTotals?.[s] ?? 0)}
              </td>
            ))}
            <td className="cellRead strong">{sumPerSize(buyTotals, sizes)}</td>
          </tr>
          <tr>
            <td className="locCell">Ship</td>
            {sizes.map((s) => (
              <td key={s} className="cellRead">
                {Number(shipTotals?.[s] ?? 0)}
              </td>
            ))}
            <td className="cellRead strong">{sumPerSize(shipTotals, sizes)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function AllocationMatrix({ locations, sizes, alloc, shipTotalsBySize, allocTotalsBySize, edit, setAllocCell, bumpAllocCell }) {
  const diffs = useMemo(() => diffPerSize(allocTotalsBySize, shipTotalsBySize, sizes), [allocTotalsBySize, shipTotalsBySize, sizes]);

  return (
    <div className="tableCard">
      <table className="matrix2">
        <thead>
          <tr>
            <th className="c-loc">Location</th>
            {sizes.map((s) => (
              <th key={s} className={`c-size2 ${diffs[s] !== 0 ? "badHead" : ""}`}>
                {s}
              </th>
            ))}
            <th className="c-rowtotal">Row Total</th>
          </tr>
        </thead>

        <tbody>
          {locations.map((loc) => {
            const rowTotal = sizes.reduce((a, s) => a + Number(alloc?.[loc]?.[s] ?? 0), 0);
            return (
              <tr key={loc}>
                <td className="locCell">{loc}</td>
                {sizes.map((s) => {
                  const v = Number(alloc?.[loc]?.[s] ?? 0);
                  return (
                    <td key={s}>
                      <div className={`cellStepper ${edit ? "" : "compact"}`}>
                        <input className="qty2" inputMode="numeric" value={v} onChange={(e) => setAllocCell(loc, s, e.target.value)} />
                        {edit ? (
                          <>
                            <button className="step" type="button" onClick={() => bumpAllocCell(loc, s, -1)}>
                              –
                            </button>
                            <button className="step" type="button" onClick={() => bumpAllocCell(loc, s, 1)}>
                              +
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
                <td className="cellRead strong">{rowTotal}</td>
              </tr>
            );
          })}

          <tr className="totRow">
            <td className="locCell strong">Allocated Totals</td>
            {sizes.map((s) => (
              <td key={s} className={diffs[s] !== 0 ? "badCell" : ""}>
                <div className="strong">{allocTotalsBySize[s]}</div>
                <div className="tiny">
                  Ship: {shipTotalsBySize[s]} (diff {diffs[s]})
                </div>
              </td>
            ))}
            <td className="cellRead strong">{sizes.reduce((a, s) => a + Number(allocTotalsBySize[s] ?? 0), 0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ActiveLocSummary({ activeLoc, sizes, alloc, scan }) {
  const items = sizes.map((s) => {
    const a = Number(alloc?.[activeLoc]?.[s] ?? 0);
    const v = Number(scan?.[activeLoc]?.[s] ?? 0);
    const over = v > a;
    const done = a > 0 && v === a;
    return { s, a, v, over, done };
  });

  const totalA = items.reduce((x, it) => x + it.a, 0);
  const totalV = items.reduce((x, it) => x + it.v, 0);

  return (
    <div className="summaryPanel">
      <div className="summaryPanelTop">
        <div className="summaryPanelTitle">{activeLoc} — Allocation vs Scanned</div>
        <div className="summaryPanelTotals">
          <span className="tag">Allocated: {totalA}</span>
          <span className="tag">Scanned: {totalV}</span>
        </div>
      </div>

      <div className="sizeCards">
        {items.map((it) => (
          <div key={it.s} className={`sizeCard ${it.over ? "badSoft" : it.done ? "okSoft" : ""}`}>
            <div className="sizeCardTop">
              <div className="sizeName">{it.s}</div>
              <div className={`sizeDelta ${it.over ? "badText" : ""}`}>
                {it.v}/{it.a}
              </div>
            </div>
            <div className="sizeSub">Scanned / Allocated</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReceivingMatrixClean({ locations, sizes, alloc, scan, activeLoc, edit, setScanCell, bumpScanCell }) {
  return (
    <div className="tableCard">
      <table className="matrix2 matrixClean">
        <thead>
          <tr>
            <th className="c-loc">Location</th>
            {sizes.map((s) => (
              <th key={s} className="c-size2">
                {s}
              </th>
            ))}
            <th className="c-rowtotal">Row Total</th>
          </tr>
        </thead>

        <tbody>
          {locations.map((loc) => {
            const isActive = loc === activeLoc;
            const rowTotal = sizes.reduce((a, s) => a + Number(scan?.[loc]?.[s] ?? 0), 0);

            return (
              <tr key={loc} className={isActive ? "activeRow" : ""}>
                <td className="locCell">
                  {loc} {isActive ? <span className="miniTag">ACTIVE</span> : null}
                </td>

                {sizes.map((s) => {
                  const a = Number(alloc?.[loc]?.[s] ?? 0);
                  const v = Number(scan?.[loc]?.[s] ?? 0);
                  const over = v > a;

                  return (
                    <td key={s} className={over ? "badCell" : ""}>
                      <div className={`cellStack ${isActive ? "cellStackActive" : ""}`}>
                        <div className={`bigNum ${over ? "badText" : ""}`}>{v}</div>
                        <div className="smallSub">of {a}</div>

                        {edit ? (
                          <div className="editRow">
                            <input className="qty2" inputMode="numeric" value={v} onChange={(e) => setScanCell(loc, s, e.target.value)} />
                            <button className="step" type="button" onClick={() => bumpScanCell(loc, s, -1)}>
                              –
                            </button>
                            <button className="step" type="button" onClick={() => bumpScanCell(loc, s, 1)}>
                              +
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  );
                })}

                <td className="cellRead strong">{rowTotal}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Bulk Allocation Panel ---------------- */

function BulkAllocationPanel({ poText, onPoTextChange, onLoad, rows, loaded, running, zipReady, onToggleIgnoreTeaneck, onRemoveRow, onRun, onRunMerged }) {
  const validCount = rows.filter((r) => !r.error).length;
  const errorCount = rows.filter((r) => r.error).length;

  return (
    <div style={{ maxWidth: 800 }}>
      <div className="sectionTitle">Mode 5 — Bulk Allocation</div>

      {/* Step 1 */}
      <div className="hint">Step 1 — Paste PO numbers (one per line or comma-separated) then click Load.</div>
      <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "flex-start" }}>
        <textarea
          className="input"
          value={poText}
          onChange={(e) => onPoTextChange(e.target.value)}
          placeholder={"YB1892\nYB1893\nYB1894"}
          rows={5}
          style={{ flex: 1, fontFamily: "monospace", fontSize: 14, resize: "vertical" }}
          disabled={running}
        />
        <button
          className="btn primary"
          onClick={onLoad}
          disabled={running || !poText.trim()}
          style={{ whiteSpace: "nowrap", padding: "10px 20px" }}
        >
          {running && !loaded ? "Loading…" : "Load POs"}
        </button>
      </div>

      {/* Step 2 */}
      {loaded && rows.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div className="hint" style={{ marginBottom: 10 }}>
            Step 2 — Check <strong>Ignore Teaneck</strong> for any products that need it, remove rows you don't want, then run.
          </div>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
            {validCount} product{validCount !== 1 ? "s" : ""} loaded
            {errorCount > 0 ? ` · ${errorCount} error${errorCount > 1 ? "s" : ""}` : ""}
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f5f5f5" }}>
                <th style={{ padding: "8px 10px", border: "1px solid #e0e0e0", textAlign: "left" }}>PO</th>
                <th style={{ padding: "8px 10px", border: "1px solid #e0e0e0", textAlign: "left" }}>Product</th>
                <th style={{ padding: "8px 10px", border: "1px solid #e0e0e0", textAlign: "center", whiteSpace: "nowrap" }}>Buy Units</th>
                <th style={{ padding: "8px 10px", border: "1px solid #e0e0e0", textAlign: "center", whiteSpace: "nowrap" }}>Ignore Teaneck</th>
                <th style={{ padding: "8px 10px", border: "1px solid #e0e0e0", textAlign: "center" }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const buyTotal = Object.values(row.rec?.buy || {}).reduce((a, v) => a + Number(v), 0);
                return (
                  <tr key={i} style={{ background: row.error ? "#fff5f5" : i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                    <td style={{ padding: "7px 10px", border: "1px solid #e0e0e0", fontWeight: 500 }}>{row.po}</td>
                    <td style={{ padding: "7px 10px", border: "1px solid #e0e0e0", color: row.error ? "var(--bad)" : "inherit" }}>
                      {row.error ? `⚠ ${row.label}` : row.label}
                    </td>
                    <td style={{ padding: "7px 10px", border: "1px solid #e0e0e0", textAlign: "center", fontWeight: 500 }}>
                      {row.error ? "—" : buyTotal}
                    </td>
                    <td style={{ padding: "7px 10px", border: "1px solid #e0e0e0", textAlign: "center" }}>
                      {!row.error && (
                        <input
                          type="checkbox"
                          checked={row.ignoreTeaneck}
                          onChange={() => onToggleIgnoreTeaneck(i)}
                          style={{ cursor: "pointer", width: 16, height: 16 }}
                        />
                      )}
                    </td>
                    <td style={{ padding: "7px 10px", border: "1px solid #e0e0e0", textAlign: "center" }}>
                      <button
                        onClick={() => onRemoveRow(i)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 16, fontWeight: 700, lineHeight: 1, padding: "0 4px" }}
                        title="Remove"
                      >×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              className="btn primary"
              onClick={onRun}
              disabled={running || validCount === 0}
              style={{ fontSize: 15, padding: "10px 24px" }}
            >
              {running ? "Running…" : `Download ZIP (${validCount})`}
            </button>
            <button
              className="btn secondary"
              onClick={onRunMerged}
              disabled={running || validCount === 0}
              style={{ fontSize: 15, padding: "10px 24px" }}
            >
              {running ? "Running…" : `Download Merged PDF (${validCount})`}
            </button>
            {zipReady && <span style={{ color: "var(--good)", fontWeight: 600 }}>Downloaded ✅</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Product Lookup Panel ---------------- */

function ProductLookupPanel({ barcode, onBarcodeChange, onBarcodeSearch, search, onSearchChange, onTitleSearch, searchResults, selectedId, onSelectedIdChange, onSelectProduct, product, linkedPOs, loading }) {
  return (
    <div style={{ maxWidth: 640 }}>
      <div className="sectionTitle">Mode 6 — Product Lookup</div>
      <div className="hint">Find which PO(s) are linked to a Shopify product by scanning a barcode or searching by title.</div>

      {/* Barcode */}
      <div className="label" style={{ marginTop: 20, marginBottom: 6 }}>Scan / Enter Barcode</div>
      <div className="hstack">
        <input
          className="input"
          value={barcode}
          onChange={(e) => onBarcodeChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onBarcodeSearch(); }}
          placeholder="Scan any variant barcode…"
          disabled={loading}
          autoFocus
        />
        <button className="btn primary" onClick={onBarcodeSearch} disabled={loading || !barcode.trim()}>
          Look Up
        </button>
      </div>

      {/* Title search */}
      <div className="label" style={{ marginTop: 18, marginBottom: 6 }}>Or Search by Product Title</div>
      <div className="hstack">
        <input
          className="input"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onTitleSearch(); }}
          placeholder="Search Shopify by title…"
          disabled={loading}
        />
        <button className="btn" onClick={onTitleSearch} disabled={loading || !search.trim()}>
          Search
        </button>
      </div>

      {searchResults.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
          <select
            className="select"
            value={selectedId}
            onChange={(e) => onSelectedIdChange(e.target.value)}
            style={{ flex: 1 }}
          >
            {searchResults.map((p) => (
              <option key={p.productId} value={p.productId}>{p.title}</option>
            ))}
          </select>
          <button className="btn primary" onClick={onSelectProduct} disabled={loading || !selectedId}>
            Look Up
          </button>
        </div>
      )}

      {/* Result */}
      {product && (
        <div style={{ marginTop: 24, padding: 16, border: "1px solid var(--border)", borderRadius: 10, background: "#fafafa" }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>{product.title}</div>

          {linkedPOs.length === 0 ? (
            <div className="hint">No Airtable POs are currently linked to this product.</div>
          ) : (
            <>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                {linkedPOs.length} linked PO{linkedPOs.length !== 1 ? "s" : ""}:
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f0f0f0" }}>
                    <th style={{ padding: "7px 10px", border: "1px solid #e0e0e0", textAlign: "left" }}>PO #</th>
                    <th style={{ padding: "7px 10px", border: "1px solid #e0e0e0", textAlign: "left" }}>Product</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedPOs.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                      <td style={{ padding: "7px 10px", border: "1px solid #e0e0e0", fontWeight: 600 }}>{r.po}</td>
                      <td style={{ padding: "7px 10px", border: "1px solid #e0e0e0" }}>{r.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Office Samples Wizard ---------------- */

function OfficeSamplesWizard({
  step, photo, scanned, product, poInput, delivery, record, error, loading,
  manualBarcode, onPhotoCapture, onRetakePhoto, onNextToScan, onCameraScan,
  onManualBarcodeChange, onManualScan, onClearScanned, onRemoveScanned,
  onNextToPO, onPoInputChange, onLoadPO, onDeliveryChange, onSubmit, onStartNext
}) {
  if (step === "done") {
    return (
      <div style={{ padding: "40px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 56, lineHeight: 1 }}>✓</div>
        <div className="emptyTitle" style={{ marginTop: 16 }}>Office Sample Received!</div>
        <div className="emptyText" style={{ marginTop: 8 }}>
          Shopify Office inventory updated. Airtable record stamped with today's date.
        </div>
        <button
          className="btn primary"
          style={{ marginTop: 24, fontSize: 16, padding: "12px 28px" }}
          onClick={onStartNext}
        >
          Start Next Product
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "0 4px" }}>
      {/* Step indicator */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {[["photo", "1. Photo"], ["scan", "2. Scan"], ["po", "3. PO"]].map(([s, label]) => (
          <span
            key={s}
            style={{
              padding: "3px 10px",
              borderRadius: 12,
              fontSize: 12,
              fontWeight: step === s ? 700 : 400,
              background: step === s ? "var(--primary)" : "#f3f4f6",
              color: step === s ? "#fff" : "#6b7280"
            }}
          >
            {label}
          </span>
        ))}
      </div>

      {/* Step 1: Photo */}
      {step === "photo" && (
        <div>
          <div className="sectionTitle">Step 1 — Take a Photo</div>
          <div className="hint">Point your camera at the product so there is a visual record.</div>

          {photo ? (
            <div style={{ marginTop: 14 }}>
              <img
                src={photo.previewUrl}
                alt="Product"
                style={{ width: "100%", maxHeight: 300, objectFit: "contain", borderRadius: 12, border: "1px solid var(--border)" }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="btn" onClick={onRetakePhoto}>Retake Photo</button>
                <button className="btn primary" onClick={onNextToScan}>Next: Scan Barcodes</button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <label className="btn primary" style={{ display: "inline-block", cursor: "pointer" }}>
                Open Camera
                <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onPhotoCapture} />
              </label>
              <div className="hint" style={{ marginTop: 8 }}>On mobile, opens the rear camera. On desktop, opens a file picker.</div>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Scan */}
      {step === "scan" && (
        <div>
          <div className="sectionTitle">Step 2 — Scan Size Barcodes</div>
          <div className="hint">
            Scan each size barcode one at a time (XS, then S).
            {product ? <span> Product: <strong>{product.title}</strong></span> : " First scan identifies the product."}
          </div>

          {scanned.length > 0 && (
            <div className="summaryPanel" style={{ marginTop: 12 }}>
              <div className="summaryPanelTitle">Scanned Sizes</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {scanned.map((v) => (
                  <span
                    key={v.size}
                    style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--softOk)", borderRadius: 10, padding: "3px 10px", fontSize: 13 }}
                  >
                    {v.size}
                    <button
                      onClick={() => onRemoveScanned(v.size)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontWeight: 700, padding: 0, lineHeight: 1 }}
                      title="Remove"
                    >x</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {error && <div className="banner error" style={{ marginTop: 10 }}>{error}</div>}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <button className="btn primary" onClick={onCameraScan} disabled={loading}>
              {loading ? "Scanning…" : "Scan with Camera"}
            </button>
            {scanned.length > 0 && (
              <button className="btn" onClick={onClearScanned}>Clear All</button>
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="label">Or type barcode manually</div>
            <div className="hstack" style={{ marginTop: 4 }}>
              <input
                className="input"
                value={manualBarcode}
                onChange={(e) => onManualBarcodeChange(e.target.value)}
                placeholder="Type or paste barcode…"
                onKeyDown={(e) => { if (e.key === "Enter") onManualScan(); }}
                disabled={loading}
              />
              <button className="btn" onClick={onManualScan} disabled={loading || !manualBarcode.trim()}>Add</button>
            </div>
          </div>

          {scanned.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <button className="btn primary" onClick={onNextToPO}>Next: Enter PO</button>
            </div>
          )}
        </div>
      )}

      {/* Step 3: PO + Delivery */}
      {step === "po" && (
        <div>
          <div className="sectionTitle">Step 3 — PO Number</div>
          <div className="hint">Find this product in Airtable and confirm the delivery date.</div>

          <div className="field" style={{ marginTop: 14 }}>
            <div className="label">PO #</div>
            <div className="hstack">
              <input
                className="input"
                value={poInput}
                onChange={(e) => onPoInputChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") onLoadPO(); }}
                placeholder="e.g. YB1892"
                disabled={loading}
              />
              <button className="btn primary" onClick={onLoadPO} disabled={loading || !poInput.trim()}>
                {loading ? "Loading…" : "Load"}
              </button>
            </div>
          </div>

          {error && <div className="banner error" style={{ marginTop: 8 }}>{error}</div>}

          {record && (
            <>
              <div className="summaryPanel" style={{ marginTop: 12 }}>
                <div className="summaryPanelTitle">{record.label}</div>
                <div className="hint" style={{ marginTop: 4 }}>
                  Sizes to send to Office: <strong>{scanned.map((v) => v.size).join(", ")}</strong>
                </div>
              </div>

              <div className="field" style={{ marginTop: 12 }}>
                <div className="label">Delivery Date</div>
                <input
                  className="dateBig"
                  type="date"
                  value={delivery}
                  onChange={(e) => onDeliveryChange(e.target.value)}
                />
              </div>

              {photo && (
                <div style={{ marginTop: 10 }}>
                  <img
                    src={photo.previewUrl}
                    alt="Product"
                    style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }}
                  />
                </div>
              )}

              <div style={{ marginTop: 16 }}>
                <button className="btn primary" onClick={onSubmit} disabled={loading} style={{ fontSize: 15, padding: "10px 24px" }}>
                  {loading ? "Submitting…" : "Submit to Office"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
