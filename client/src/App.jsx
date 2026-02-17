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
  linkShopifyProduct,
  closeoutPdf
} from "./api.js";

/**
 * NOTE:
 * - Sizes are columns, locations are rows.
 * - Auto allocation uses an "allocation scale" template (from your Allocation Guide)
 *   and applies per-size ratios (template ratios) to the actual shipped per-size totals.
 * - Always allocate 1 XS to "Office" (if XS >= 1), before allocating the remainder.
 * - Fill priority for rounding leftovers: Bogota, Cedarhurst, Toms River, Teaneck Store, Warehouse
 * - If underage makes a store too incomplete, we "drop" that store and move its units to a sink:
 *   Warehouse if Warehouse already has any units, else Cedarhurst.
 */

const SIZES = ["XXS", "XS", "S", "M", "L", "XL"];
const CORE_SIZES_FOR_STYLE = ["S", "M", "L"]; // used for "drop store" heuristic when underage makes a store too incomplete

// This matches what you described (and what your UI uses in your tool)
const DEFAULT_LOCATIONS = ["Bogota", "Cedarhurst", "Toms River", "Teaneck Store", "Office", "Warehouse"];

// Allocation rounding priority
const FILL_PRIORITY = ["Bogota", "Cedarhurst", "Toms River", "Teaneck Store", "Warehouse"];

// Allocation Guide S26 scales (from your uploaded guide)
// These templates are XS–XL. XXS will be allocated using the same ratios as XS.
const ALLOC_TEMPLATES = {
  60: {
    Bogota: { XS: 6, S: 6, M: 4, L: 2, XL: 2 },
    Cedarhurst: { XS: 6, S: 6, M: 4, L: 2, XL: 2 },
    "Toms River": { XS: 3, S: 3, M: 2, L: 1, XL: 1 },
    "Teaneck Store": { XS: 3, S: 3, M: 2, L: 1, XL: 1 },
    Warehouse: { XS: 0, S: 0, M: 0, L: 0, XL: 0 }
  },
  70: {
    Bogota: { XS: 6, S: 6, M: 4, L: 2, XL: 2 },
    Cedarhurst: { XS: 9, S: 9, M: 6, L: 3, XL: 3 },
    "Toms River": { XS: 3, S: 3, M: 2, L: 1, XL: 1 },
    "Teaneck Store": { XS: 3, S: 3, M: 2, L: 1, XL: 1 },
    Warehouse: { XS: 0, S: 0, M: 0, L: 0, XL: 0 }
  },
  80: {
    Bogota: { XS: 6, S: 6, M: 4, L: 2, XL: 2 },
    Cedarhurst: { XS: 9, S: 9, M: 6, L: 3, XL: 3 },
    "Toms River": { XS: 6, S: 6, M: 4, L: 2, XL: 2 },
    "Teaneck Store": { XS: 3, S: 3, M: 2, L: 1, XL: 1 },
    Warehouse: { XS: 0, S: 0, M: 0, L: 0, XL: 0 }
  },
  90: {
    Bogota: { XS: 9, S: 9, M: 6, L: 3, XL: 3 },
    Cedarhurst: { XS: 9, S: 9, M: 6, L: 3, XL: 3 },
    "Toms River": { XS: 6, S: 6, M: 4, L: 2, XL: 2 },
    "Teaneck Store": { XS: 3, S: 3, M: 2, L: 1, XL: 1 },
    Warehouse: { XS: 0, S: 0, M: 0, L: 0, XL: 0 }
  },
  100: {
    Bogota: { XS: 9, S: 9, M: 6, L: 3, XL: 3 },
    Cedarhurst: { XS: 12, S: 12, M: 8, L: 4, XL: 4 },
    "Toms River": { XS: 6, S: 6, M: 4, L: 2, XL: 2 },
    "Teaneck Store": { XS: 3, S: 3, M: 2, L: 1, XL: 1 },
    Warehouse: { XS: 0, S: 0, M: 0, L: 0, XL: 0 }
  },
  120: {
    Bogota: { XS: 9, S: 9, M: 6, L: 3, XL: 3 },
    Cedarhurst: { XS: 12, S: 12, M: 8, L: 4, XL: 4 },
    "Toms River": { XS: 6, S: 6, M: 4, L: 2, XL: 2 },
    "Teaneck Store": { XS: 3, S: 3, M: 2, L: 1, XL: 1 },
    Warehouse: { XS: 6, S: 6, M: 4, L: 2, XL: 2 }
  },
  130: {
    Bogota: { XS: 9, S: 9, M: 6, L: 3, XL: 3 },
    Cedarhurst: { XS: 15, S: 15, M: 10, L: 5, XL: 5 },
    "Toms River": { XS: 6, S: 6, M: 4, L: 2, XL: 2 },
    "Teaneck Store": { XS: 3, S: 3, M: 2, L: 1, XL: 1 },
    Warehouse: { XS: 6, S: 6, M: 4, L: 2, XL: 2 }
  },
  140: {
    Bogota: { XS: 12, S: 12, M: 8, L: 4, XL: 4 },
    Cedarhurst: { XS: 15, S: 15, M: 10, L: 5, XL: 5 },
    "Toms River": { XS: 6, S: 6, M: 4, L: 2, XL: 2 },
    "Teaneck Store": { XS: 3, S: 3, M: 2, L: 1, XL: 1 },
    Warehouse: { XS: 6, S: 6, M: 4, L: 2, XL: 2 }
  },
  170: {
    Bogota: { XS: 12, S: 12, M: 8, L: 4, XL: 4 },
    Cedarhurst: { XS: 18, S: 18, M: 12, L: 6, XL: 6 },
    "Toms River": { XS: 9, S: 9, M: 6, L: 3, XL: 3 },
    "Teaneck Store": { XS: 6, S: 6, M: 4, L: 2, XL: 2 },
    Warehouse: { XS: 9, S: 9, M: 6, L: 3, XL: 3 }
  },
  200: {
    Bogota: { XS: 15, S: 15, M: 10, L: 5, XL: 5 },
    Cedarhurst: { XS: 24, S: 24, M: 16, L: 8, XL: 8 },
    "Toms River": { XS: 12, S: 12, M: 8, L: 4, XL: 4 },
    "Teaneck Store": { XS: 9, S: 9, M: 6, L: 3, XL: 3 },
    Warehouse: { XS: 12, S: 12, M: 8, L: 4, XL: 4 }
  },
  220: {
    Bogota: { XS: 18, S: 18, M: 12, L: 6, XL: 6 },
    Cedarhurst: { XS: 24, S: 24, M: 16, L: 8, XL: 8 },
    "Toms River": { XS: 12, S: 12, M: 8, L: 4, XL: 4 },
    "Teaneck Store": { XS: 9, S: 9, M: 6, L: 3, XL: 3 },
    Warehouse: { XS: 12, S: 12, M: 8, L: 4, XL: 4 }
  }
};

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

function pickBestTemplateKeyForTotal(total, buildAllocForKey) {
  const keys = Object.keys(ALLOC_TEMPLATES)
    .map((x) => Number(x))
    .sort((a, b) => b - a); // descending

  const candidates = keys.filter((k) => k <= total);
  const fallback = keys;

  const toTry = candidates.length ? candidates : fallback;

  for (const k of toTry) {
    const testAlloc = buildAllocForKey(k);
    if (!testAlloc) continue;
    const trDrop = testAlloc._drop?.["Toms River"];
    const tnDrop = testAlloc._drop?.["Teaneck Store"];
    if (!trDrop && !tnDrop) return k;
  }

  let bestKey = toTry[0];
  let bestScore = Infinity;

  for (const k of toTry) {
    const testAlloc = buildAllocForKey(k);
    if (!testAlloc) continue;
    const score = (testAlloc._drop?.["Toms River"] ? 1 : 0) + (testAlloc._drop?.["Teaneck Store"] ? 1 : 0);
    if (score < bestScore) {
      bestScore = score;
      bestKey = k;
    }
  }

  return bestKey;
}

function computeRatiosFromTemplate(templateForKey, size) {
  const ratios = {};
  let colTotal = 0;
  for (const loc of Object.keys(templateForKey)) {
    const v = Number(templateForKey[loc]?.[size] ?? 0);
    colTotal += v;
  }
  for (const loc of Object.keys(templateForKey)) {
    const v = Number(templateForKey[loc]?.[size] ?? 0);
    ratios[loc] = colTotal > 0 ? v / colTotal : 0;
  }
  return ratios;
}

function apportionInteger(total, ratios, priorityOrder) {
  const locs = Object.keys(ratios);
  const raw = {};
  const base = {};
  const frac = {};

  let used = 0;
  for (const loc of locs) {
    raw[loc] = total * (ratios[loc] || 0);
    base[loc] = Math.floor(raw[loc]);
    frac[loc] = raw[loc] - base[loc];
    used += base[loc];
  }

  let remaining = total - used;
  if (remaining <= 0) return base;

  const prIndex = new Map(priorityOrder.map((l, i) => [l, i]));
  const ordered = [...locs].sort((a, b) => {
    const df = (frac[b] ?? 0) - (frac[a] ?? 0);
    if (df !== 0) return df;
    return (prIndex.get(a) ?? 999) - (prIndex.get(b) ?? 999);
  });

  let idx = 0;
  while (remaining > 0) {
    const loc = ordered[idx % ordered.length];
    base[loc] += 1;
    remaining -= 1;
    idx += 1;
  }

  return base;
}

function missingFullSizesCount(storeRow, shippedTotalsBySize, sizes) {
  let missing = 0;
  for (const s of sizes) {
    const shipQty = Number(shippedTotalsBySize?.[s] ?? 0);
    if (shipQty <= 0) continue;

    const got = Number(storeRow?.[s] ?? 0);
    if (got <= 0) missing += 1;
  }
  return missing;
}

function shouldDropStore(storeRow, shippedTotalsBySize, sizes) {
  const rowTotal = sizes.reduce((a, s) => a + Number(storeRow?.[s] ?? 0), 0);
  if (rowTotal <= 0) return false;

  const missing = missingFullSizesCount(storeRow, shippedTotalsBySize, sizes);

  return rowTotal < 7 || missing >= 2;
}

function moveRowToSink(matrix, fromLoc, sinkLoc, sizes) {
  const out = structuredClone(matrix);
  for (const s of sizes) {
    out[sinkLoc][s] = Number(out[sinkLoc][s] ?? 0) + Number(out[fromLoc][s] ?? 0);
    out[fromLoc][s] = 0;
  }
  return out;
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
        setLocations(r.locations || DEFAULT_LOCATIONS);
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

  // ✅ NEW: Ignore Teaneck toggle
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
    setShopifyLinked(false);
    setShopifyProduct(null);
    setBarcodeLinkInput("");
    setBarcodeMap({});
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

  // ---------- Mode 2: Auto Allocate ----------
  function onAutoAllocate() {
    const shipOriginal = { ...shipTotalsBySize };

    const buildAllocForKey = (templateKey) => {
      const template = ALLOC_TEMPLATES[templateKey];
      if (!template) return null;

      const ship = { ...shipOriginal };
      const nextAlloc = emptyMatrix(locations, sizes);

      // 1) Always 1 XS to Office (if possible)
      if (ship.XS >= 1 && locations.includes("Office")) {
        nextAlloc["Office"]["XS"] = 1;
        ship.XS -= 1;
      }

      // Only allocate across these template locations (skip Office)
      let templateLocs = Object.keys(template).filter((l) => locations.includes(l));

      // ✅ NEW: if ignoreTeaneck, remove Teaneck from auto allocation
      if (ignoreTeaneck) {
        templateLocs = templateLocs.filter((l) => l !== "Teaneck Store");
      }

      const priority = FILL_PRIORITY.filter((l) => templateLocs.includes(l));

      for (const size of sizes) {
        const qty = Number(ship?.[size] ?? 0);
        if (!qty) continue;

        // XXS follows XS ratios
        let ratioSize = size === "XXS" ? "XS" : size;
        if (!["XS", "S", "M", "L", "XL"].includes(ratioSize)) ratioSize = "XS";

        const ratiosAll = computeRatiosFromTemplate(template, ratioSize);
        const ratios = {};
        for (const loc of templateLocs) ratios[loc] = ratiosAll[loc] || 0;

        const apportioned = apportionInteger(qty, ratios, priority);

        for (const loc of templateLocs) {
          nextAlloc[loc][size] = Number(nextAlloc[loc][size] ?? 0) + Number(apportioned[loc] ?? 0);
        }
      }

      // Evaluate drop-worthiness (but DON'T move units yet in the evaluator)
      const dropMap = {};
      for (const loc of ["Toms River", "Teaneck Store"]) {
        if (!locations.includes(loc)) continue;

        // ✅ NEW: when ignoring Teaneck, do NOT score it for dropping
        if (ignoreTeaneck && loc === "Teaneck Store") {
          dropMap[loc] = false;
          continue;
        }

        dropMap[loc] = shouldDropStore(nextAlloc[loc], shipOriginal, sizes);
      }

      nextAlloc._drop = dropMap;
      return nextAlloc;
    };

    // 2) Choose best template key with "scale down" behavior if needed
    const remainingTotal = sizes.reduce((a, s) => a + Number(shipOriginal?.[s] ?? 0), 0);
    const templateKey = pickBestTemplateKeyForTotal(remainingTotal, buildAllocForKey);

    let built = buildAllocForKey(templateKey);
    if (!built) {
      setStatus("Auto Allocate failed: no templates available.");
      return;
    }

    delete built._drop;

    // 3) Apply final drop rules (move units to sink)
    const warehouseHasAny = sizes.reduce((a, s) => a + Number(built?.["Warehouse"]?.[s] ?? 0), 0) > 0;

    let sink = null;
    if (warehouseHasAny && locations.includes("Warehouse")) sink = "Warehouse";
    else if (locations.includes("Cedarhurst")) sink = "Cedarhurst";
    else if (locations.includes("Bogota")) sink = "Bogota";
    else sink = locations[0];

    // ✅ NEW: if ignoring Teaneck, only consider dropping Toms River
    const dropCandidates = ignoreTeaneck ? ["Toms River"] : ["Toms River", "Teaneck Store"];

    for (const loc of dropCandidates) {
      if (!locations.includes(loc)) continue;
      if (shouldDropStore(built[loc], shipOriginal, sizes)) {
        built = moveRowToSink(built, loc, sink, sizes);
      }
    }

    // ✅ NEW: Force Teaneck to 0 if ignored (makes the behavior unmistakable)
    if (ignoreTeaneck && locations.includes("Teaneck Store")) {
      for (const s of sizes) built["Teaneck Store"][s] = 0;
    }

    setAlloc(built);
    setStatus(
      `Auto Allocated ✅ (scale ${templateKey}) — Ignore Teaneck ${ignoreTeaneck ? "ON" : "OFF"} — drop rule: <7 units OR missing 2+ sizes; Office XS rule applied`
    );
  }

  // ---------- Mode 2: Save Allocation ----------
  async function onSaveAllocation() {
    if (!selectedId) return;

    if (!allocMatchesShip) {
      const diffs = diffPerSize(allocTotalsBySize, shipTotalsBySize, sizes);
      const msg =
        "Allocation totals do not match Ship Units.\n\n" +
        sizes.map((s) => `${s}: alloc ${allocTotalsBySize[s]} vs ship ${shipTotalsBySize[s]} (diff ${diffs[s]})`).join("\n") +
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

  // ---------- Mode 2: Link Shopify product and write GID to Airtable ----------
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
        shopifyProduct: shopifyLinked ? shopifyProduct : null
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
                <div className="hint">After picking a mode, load a PO and select a product.</div>
              </div>
            ) : (
              <>
                <div className="modeBar">
                  <div className="modePill">
                    Mode:{" "}
                    <strong>
                      {mode === "shipping" ? "Shipping" : mode === "allocation" ? "Allocation" : "Receiving"}
                    </strong>
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
                              Link
                            </button>
                          </div>
                          <div className="hint">This writes the Shopify Product GID to Airtable so it auto-loads next time.</div>
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
            ) : !selected ? (
              <div className="emptyState">
                <div className="emptyTitle">Load a PO and select a product.</div>
                <div className="emptyText">Then you’ll see the {mode} screen for that product.</div>
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
                    <div className="hint">
                      Sizes are columns. Locations are rows. Use Auto Allocate first, then do minimal manual edits.
                    </div>

                    <BuyShipTotalsRow sizes={sizes} buyTotals={buyTotalsBySize} shipTotals={shipTotalsBySize} />

                    <div className="modeTools">
                      <button className="btn primary" onClick={onAutoAllocate} type="button" disabled={loading}>
                        Auto Allocate
                      </button>
                      <button className="btn" onClick={() => setAllocEdit((v) => !v)} type="button">
                        {allocEdit ? "Done Editing" : "Edit Allocation"}
                      </button>

                      {/* ✅ NEW: Ignore Teaneck checkbox */}
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 10 }}>
                        <input
                          type="checkbox"
                          checked={ignoreTeaneck}
                          onChange={(e) => setIgnoreTeaneck(e.target.checked)}
                        />
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
                    </div>
                  </>
                ) : null}

                {mode === "receiving" ? (
                  <>
                    <div className="sectionTitle">Mode 3 — Receiving</div>
                    <div className="hint">Select a location, then scan. The selected location stays visually obvious.</div>

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
