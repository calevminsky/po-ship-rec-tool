import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchPO,
  me,
  login,
  logout,
  getLocations,
  saveAllocation,
  saveScan,
  shopifyByBarcode,
  closeoutPdf
} from "./api.js";

const SIZES = ["XXS", "XS", "S", "M", "L", "XL"];
const DEFAULT_LOCATIONS = ["Bogota", "Cedarhurst", "Toms River", "Teaneck Store", "Office", "Warehouse"];

function clampInt(v) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function sumObj(obj, sizes) {
  return sizes.reduce((acc, s) => acc + Number(obj?.[s] ?? 0), 0);
}

function money(n) {
  const x = Number(n ?? 0);
  return x.toLocaleString(undefined, { style: "currency", currency: "USD" });
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
  try { return JSON.parse(s); } catch { return null; }
}

function perSizeTotalsFromMatrix(matrix, locations, sizes) {
  const t = {};
  for (const s of sizes) {
    t[s] = locations.reduce((a, loc) => a + Number(matrix?.[loc]?.[s] ?? 0), 0);
  }
  return t;
}

function equalsPerSize(a, b, sizes) {
  return sizes.every(s => Number(a?.[s] ?? 0) === Number(b?.[s] ?? 0));
}

function diffPerSize(a, b, sizes) {
  const d = {};
  for (const s of sizes) d[s] = Number(a?.[s] ?? 0) - Number(b?.[s] ?? 0);
  return d;
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

  const [poInput, setPoInput] = useState("");
  const [poData, setPoData] = useState(null);
  const [selectedId, setSelectedId] = useState("");

  const sizes = SIZES; // always show XXS..XL

  const records = poData?.records || [];
  const selected = useMemo(() => records.find(r => r.id === selectedId) || null, [records, selectedId]);

  const [shipEdits, setShipEdits] = useState(null);
  const [recEdits, setRecEdits] = useState(null);
  const [shipDate, setShipDate] = useState("");
  const [delivery, setDelivery] = useState("");

  const [editMode, setEditMode] = useState("none"); // none | ship | received
  const shipEnabled = editMode === "ship";
  const recEnabled = editMode === "received";

  // Locations from server (fallback to default)
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

  // Allocation + scan matrices
  const [alloc, setAlloc] = useState(() => emptyMatrix(DEFAULT_LOCATIONS, SIZES));
  const [scan, setScan] = useState(() => emptyMatrix(DEFAULT_LOCATIONS, SIZES));

  // Shopify link
  const [shopifyLinked, setShopifyLinked] = useState(false);
  const [shopifyProduct, setShopifyProduct] = useState(null); // {productId,title,variants}
  const [barcodeLinkInput, setBarcodeLinkInput] = useState("");

  // Receiving scan mode
  const [activeLoc, setActiveLoc] = useState(DEFAULT_LOCATIONS[0]);
  const [scanBarcode, setScanBarcode] = useState("");
  const scanInputRef = useRef(null);
  const [lastScanStack, setLastScanStack] = useState([]); // {loc,size} stack

  // Derived totals
  const unitCost = Number(selected?.unitCost ?? 0);

  const buyTotalUnits = selected ? sumObj(selected.buy, sizes) : 0;
  const shipTotalUnits = shipEdits ? sumObj(shipEdits, sizes) : 0;
  const recTotalUnits = recEdits ? sumObj(recEdits, sizes) : 0;

  const buyTotalCost = buyTotalUnits * unitCost;
  const shipTotalCost = shipTotalUnits * unitCost;
  const recTotalCost = recTotalUnits * unitCost;

  const shipTotalsBySize = useMemo(() => {
    const t = {};
    for (const s of sizes) t[s] = Number(shipEdits?.[s] ?? 0);
    return t;
  }, [shipEdits, sizes]);

  const allocTotalsBySize = useMemo(() => perSizeTotalsFromMatrix(alloc, locations, sizes), [alloc, locations, sizes]);
  const scanTotalsBySize = useMemo(() => perSizeTotalsFromMatrix(scan, locations, sizes), [scan, locations, sizes]);

  const allocMatchesShip = useMemo(
    () => equalsPerSize(allocTotalsBySize, shipTotalsBySize, sizes),
    [allocTotalsBySize, shipTotalsBySize, sizes]
  );

  const scanMatchesAlloc = useMemo(
    () => equalsPerSize(scanTotalsBySize, allocTotalsBySize, sizes),
    [scanTotalsBySize, allocTotalsBySize, sizes]
  );

  // ---------- LOAD PO ----------
  async function onLoadPO() {
    setStatus("");
    const po = poInput.trim();
    if (!po) return;

    try {
      setLoading(true);
      const data = await fetchPO(po);
      setPoData(data);

      if ((data.records || []).length === 1) {
        const only = data.records[0];
        setSelectedId(only.id);
      } else {
        setSelectedId("");
      }
    } catch (e) {
      setStatus(e.message);
    } finally {
      setLoading(false);
    }
  }

  // When selecting a record, hydrate state including Alloc/Scan JSON
  useEffect(() => {
    if (!selected) return;

    setShipEdits({ ...selected.ship });
    setRecEdits({ ...selected.rec });
    setShipDate(fmtDateForInput(selected.shipDate));
    setDelivery(fmtDateForInput(selected.delivery));
    setEditMode("none");

    const a = parseJsonOrNull(selected.allocJson) || emptyMatrix(locations, sizes);
    const sc = parseJsonOrNull(selected.scanJson) || emptyMatrix(locations, sizes);

    // Ensure all loc/sizes exist
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

    // unlink Shopify by default; user can link via barcode
    setShopifyLinked(false);
    setShopifyProduct(null);
    setBarcodeLinkInput("");
    setScanBarcode("");
    setLastScanStack([]);
  }, [selectedId, locations]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleEdit(mode) {
    setEditMode(prev => (prev === mode ? "none" : mode));
  }

  function setShipCell(size, value) {
    const v = clampInt(value);
    setShipEdits(prev => ({ ...(prev || {}), [size]: v }));
  }

  function setRecCell(size, value) {
    const v = clampInt(value);
    setRecEdits(prev => ({ ...(prev || {}), [size]: v }));
  }

  // ---------- Allocation editing ----------
  function setAllocCell(loc, size, value) {
    const v = clampInt(value);
    setAlloc(prev => ({
      ...prev,
      [loc]: { ...(prev[loc] || {}), [size]: v }
    }));
  }

  function bumpAllocCell(loc, size, delta) {
    setAlloc(prev => {
      const cur = Number(prev?.[loc]?.[size] ?? 0);
      const next = Math.max(0, cur + delta);
      return { ...prev, [loc]: { ...(prev[loc] || {}), [size]: next } };
    });
  }

  async function onSaveAllocation() {
    if (!selectedId) return;
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

  // ---------- Shopify linking ----------
  async function onLinkShopifyByBarcode() {
    const bc = barcodeLinkInput.trim();
    if (!bc) return;

    try {
      setLoading(true);
      setStatus("Looking up barcode in Shopify…");
      const r = await shopifyByBarcode(bc);

      if (!r.found) {
        setShopifyLinked(false);
        setShopifyProduct(null);
        setStatus("Barcode not found in Shopify. You can continue without scanning.");
        return;
      }

      setShopifyLinked(true);
      setShopifyProduct(r.product);
      setStatus(`Linked Shopify product: ${r.product.title}`);
      // focus scan input
      setTimeout(() => scanInputRef.current?.focus(), 50);
    } catch (e) {
      setShopifyLinked(false);
      setShopifyProduct(null);
      setStatus(`Shopify lookup failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  function normalizeSizeValue(val) {
    if (!val) return null;
    const s = String(val).trim().toUpperCase();
    // Accept common variants
    if (s === "X-SMALL") return "XS";
    if (s === "XX-SMALL") return "XXS";
    return s;
  }

  // ---------- Receiving scan ----------
  async function onScanSubmit(e) {
    e.preventDefault();
    if (!shopifyLinked || !shopifyProduct) return;

    const bc = scanBarcode.trim();
    if (!bc) return;

    try {
      setLoading(true);
      setStatus("Scanning…");

      const r = await shopifyByBarcode(bc);
      if (!r.found) {
        setStatus("Barcode not found in Shopify.");
        return;
      }

      // size from the scanned variant’s "Size"
      // We already return full product; easiest is: find variant with barcode
      const v = (r.product.variants || []).find(x => String(x.barcode || "").trim() === bc);
      const size = normalizeSizeValue(v?.sizeValue);
      if (!size || !sizes.includes(size)) {
        setStatus(`Scanned size "${v?.sizeValue}" does not match app sizes.`);
        return;
      }

      // Check allocation limit: scan[activeLoc][size] + 1 <= alloc[activeLoc][size]
      const allocCap = Number(alloc?.[activeLoc]?.[size] ?? 0);
      const cur = Number(scan?.[activeLoc]?.[size] ?? 0);

      if (cur + 1 > allocCap) {
        setStatus(`Over allocation: ${activeLoc} ${size} would exceed allocation (${allocCap}).`);
        // keep lastScanStack unchanged; allow undo if previous scan existed
        return;
      }

      setScan(prev => ({
        ...prev,
        [activeLoc]: { ...(prev[activeLoc] || {}), [size]: cur + 1 }
      }));
      setLastScanStack(prev => [...prev, { loc: activeLoc, size }]);
      setScanBarcode("");
      setStatus("Scan recorded ✅");
    } catch (e2) {
      setStatus(`Scan failed: ${e2.message}`);
    } finally {
      setLoading(false);
      setTimeout(() => scanInputRef.current?.focus(), 25);
    }
  }

  function undoLastScan() {
    setLastScanStack(prev => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];

      setScan(cur => {
        const curVal = Number(cur?.[last.loc]?.[last.size] ?? 0);
        const nextVal = Math.max(0, curVal - 1);
        return {
          ...cur,
          [last.loc]: { ...(cur[last.loc] || {}), [last.size]: nextVal }
        };
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

  // ---------- Closeout (Shopify + Airtable totals + PDF download) ----------
  async function onCloseout() {
    if (!selectedId || !selected) return;

    // Enforce allocation==ship before scanning closeout
    if (!allocMatchesShip) {
      setStatus("Allocation totals must match Ship Units before closeout.");
      return;
    }

    // Enforce scan==allocation before submit (you can relax this later)
    if (!scanMatchesAlloc) {
      setStatus("Scanned totals must match Allocation before closeout.");
      return;
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

      // download
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
          <button className="btn primary" onClick={doLogin} disabled={!u.trim() || !p}>Sign in</button>
        </div>
      </div>
    );
  }

  // ---------- Main UI ----------
  return (
    <div className="app">
      <div className="shell">
        <header className="header">
          <div className="brand">
            <div className="brandTitle">Shipping & Receiving</div>
            <div className="brandSub">PO → Product → Allocation → Scan → Closeout PDF</div>
          </div>

          <div className="headerRight">
            <div className="userPill">
              Signed in as <strong>{user.username}</strong>
              <button className="linkBtn" onClick={doLogout}>Log out</button>
            </div>
            <div className="statusPill" data-show={status ? "1" : "0"}>{status || " "}</div>
          </div>
        </header>

        <div className="layout">
          <aside className="card lookup">
            <div className="cardTitle">Find</div>

            <div className="field">
              <div className="label">PO #</div>
              <div className="hstack">
                <input className="input" value={poInput} onChange={(e) => setPoInput(e.target.value)} placeholder="e.g. YB1892" />
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
                  {records.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </div>
            )}

            <div className="divider" />

            <div className="metaGrid">
              <div className="meta">
                <div className="metaLabel">Unit Cost</div>
                <div className="metaValue">{selected ? money(unitCost) : "—"}</div>
              </div>
              <div className="meta">
                <div className="metaLabel">Allocation vs Ship</div>
                <div className="metaValue">{selected ? (allocMatchesShip ? "OK" : "Mismatch") : "—"}</div>
              </div>
            </div>

            <div className="divider" />

            <div className="field">
              <div className="label">Link Shopify Product (optional)</div>
              <div className="hstack">
                <input
                  className="input"
                  value={barcodeLinkInput}
                  onChange={(e) => setBarcodeLinkInput(e.target.value)}
                  placeholder="Scan/enter any variant barcode…"
                  disabled={!selected}
                />
                <button className="btn" onClick={onLinkShopifyByBarcode} disabled={!selected || loading || !barcodeLinkInput.trim()}>
                  Link
                </button>
              </div>
              <div className="hint">
                {shopifyLinked && shopifyProduct
                  ? `Linked: ${shopifyProduct.title}`
                  : "If not linked, scanning is disabled (manual entry still works)."}
              </div>
            </div>
          </aside>

          <main className="card main">
            {!selected ? (
              <div className="emptyState">
                <div className="emptyTitle">Load a PO and select a product.</div>
                <div className="emptyText">Then build allocation and scan receiving.</div>
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

                  <div className="imageCardSm">
                    {selected.imageUrl ? (
                      <img className="image" src={selected.imageUrl} alt="Product or Swatch" />
                    ) : (
                      <div className="imageEmpty">No image</div>
                    )}
                  </div>
                </div>

                {/* Buy/Ship/Rec */}
                <div className="sectionTitle">Totals</div>
                <div className="tableCard">
                  <table className="matrix">
                    <thead>
                      <tr>
                        <th className="c-rowlabel"></th>
                        <th className="c-edit"></th>
                        <th className="c-date"></th>
                        {sizes.map(s => <th key={s} className="c-size">{s}</th>)}
                        <th className="c-total">Total Units</th>
                        <th className="c-cost">Total Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="rowLabel">Buy Units</td>
                        <td className="cellMuted">—</td>
                        <td className="cellMuted">—</td>
                        {sizes.map(s => <td key={s} className="cellRead">{Number(selected.buy[s] ?? 0)}</td>)}
                        <td className="cellRead strong">{buyTotalUnits}</td>
                        <td className="cellRead strong">{money(buyTotalCost)}</td>
                      </tr>

                      <tr className={shipEnabled ? "rowActive" : ""}>
                        <td className="rowLabel">Ship Units</td>
                        <td className="cellCenter">
                          <label className="check">
                            <input type="checkbox" checked={shipEnabled} onChange={() => toggleEdit("ship")} />
                            <span />
                          </label>
                        </td>
                        <td className="cellCenter">
                          <input className="date" type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} disabled={!shipEnabled} />
                        </td>
                        {sizes.map(s => (
                          <td key={s}>
                            <input className="qty" inputMode="numeric" value={shipEdits?.[s] ?? 0} onChange={(e) => setShipCell(s, e.target.value)} disabled={!shipEnabled} />
                          </td>
                        ))}
                        <td className="cellRead strong">{shipTotalUnits}</td>
                        <td className="cellRead strong">{money(shipTotalCost)}</td>
                      </tr>

                      <tr className={recEnabled ? "rowActive" : ""}>
                        <td className="rowLabel">Received Units</td>
                        <td className="cellCenter">
                          <label className="check">
                            <input type="checkbox" checked={recEnabled} onChange={() => toggleEdit("received")} />
                            <span />
                          </label>
                        </td>
                        <td className="cellCenter">
                          <input className="date" type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} disabled={!recEnabled} />
                        </td>
                        {sizes.map(s => (
                          <td key={s}>
                            <input className="qty" inputMode="numeric" value={recEdits?.[s] ?? 0} onChange={(e) => setRecCell(s, e.target.value)} disabled={!recEnabled} />
                          </td>
                        ))}
                        <td className="cellRead strong">{recTotalUnits}</td>
                        <td className="cellRead strong">{money(recTotalCost)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Allocation */}
                <div className="sectionTitleRow">
                  <div className="sectionTitle">Allocation Guide</div>
                  <div className="sectionRight">
                    <button className="btn" onClick={onSaveAllocation} disabled={loading || !selectedId}>
                      Save Allocation
                    </button>
                    <div className="hint">
                      {allocMatchesShip ? "Allocation totals match Ship Units ✅" : "Allocation totals must match Ship Units"}
                    </div>
                  </div>
                </div>

                <AllocationMatrix
                  locations={locations}
                  sizes={sizes}
                  alloc={alloc}
                  setAllocCell={setAllocCell}
                  bumpAllocCell={bumpAllocCell}
                  shipTotalsBySize={shipTotalsBySize}
                  allocTotalsBySize={allocTotalsBySize}
                />

                {/* Receiving */}
                <div className="sectionTitleRow">
                  <div className="sectionTitle">Receiving Scan</div>
                  <div className="sectionRight">
                    <button className="btn" onClick={onSaveScanToAirtable} disabled={loading || !selectedId}>
                      Save Scan Progress
                    </button>
                  </div>
                </div>

                <div className="scanBar">
                  <div className="scanLeft">
                    <div className="labelSmall">Active location</div>
                    <select className="select" value={activeLoc} onChange={(e) => setActiveLoc(e.target.value)}>
                      {locations.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>

                  <div className="scanMid">
                    <div className="labelSmall">Scan barcode</div>
                    <form onSubmit={onScanSubmit} className="scanForm">
                      <input
                        ref={scanInputRef}
                        className="input"
                        value={scanBarcode}
                        onChange={(e) => setScanBarcode(e.target.value)}
                        placeholder={shopifyLinked ? "Scan variant barcode…" : "Link Shopify product to enable scanning"}
                        disabled={!shopifyLinked || loading}
                      />
                      <button className="btn primary" disabled={!shopifyLinked || loading || !scanBarcode.trim()}>
                        Add Scan
                      </button>
                      <button className="btn" type="button" onClick={undoLastScan} disabled={!lastScanStack.length}>
                        Undo last scan
                      </button>
                    </form>
                  </div>

                  <div className="scanRight">
                    <div className="labelSmall">Status</div>
                    <div className={`pill ${scanMatchesAlloc ? "ok" : "warn"}`}>
                      {scanMatchesAlloc ? "Scan matches allocation" : "Scan differs from allocation"}
                    </div>
                  </div>
                </div>

                <ScanMatrix
                  locations={locations}
                  sizes={sizes}
                  alloc={alloc}
                  scan={scan}
                  setScan={setScan}
                />

                <div className="actionsRow">
                  <button className="btn primary" onClick={onCloseout} disabled={loading || !selectedId || !allocMatchesShip || !scanMatchesAlloc}>
                    Submit Closeout + Download PDF
                  </button>
                  <div className="actionsNote">
                    Requires Allocation=Ship and Scan=Allocation. Shopify inventory adjusts only if Shopify is linked.
                  </div>
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function AllocationMatrix({ locations, sizes, alloc, setAllocCell, bumpAllocCell, shipTotalsBySize, allocTotalsBySize }) {
  const diffs = useMemo(() => diffPerSize(allocTotalsBySize, shipTotalsBySize, sizes), [allocTotalsBySize, shipTotalsBySize, sizes]);

  return (
    <div className="tableCard">
      <table className="matrix2">
        <thead>
          <tr>
            <th className="c-loc">Location</th>
            {sizes.map(s => (
              <th key={s} className={`c-size2 ${diffs[s] !== 0 ? "bad" : ""}`}>
                {s}
              </th>
            ))}
            <th className="c-rowtotal">Row Total</th>
          </tr>
        </thead>

        <tbody>
          {locations.map(loc => {
            const rowTotal = sizes.reduce((a, s) => a + Number(alloc?.[loc]?.[s] ?? 0), 0);
            return (
              <tr key={loc}>
                <td className="locCell">{loc}</td>
                {sizes.map(s => (
                  <td key={s}>
                    <div className="cellStepper">
                      <button className="step" onClick={() => bumpAllocCell(loc, s, -1)} type="button">−</button>
                      <input
                        className="qty2"
                        inputMode="numeric"
                        value={alloc?.[loc]?.[s] ?? 0}
                        onChange={(e) => setAllocCell(loc, s, e.target.value)}
                      />
                      <button className="step" onClick={() => bumpAllocCell(loc, s, +1)} type="button">+</button>
                    </div>
                  </td>
                ))}
                <td className="cellRead strong">{rowTotal}</td>
              </tr>
            );
          })}

          <tr className="totRow">
            <td className="locCell strong">TOTAL</td>
            {sizes.map(s => (
              <td key={s} className={`cellRead strong ${diffs[s] !== 0 ? "badCell" : ""}`}>
                {allocTotalsBySize[s]}
                {diffs[s] !== 0 ? <div className="tiny">Δ {diffs[s]}</div> : null}
              </td>
            ))}
            <td className="cellRead strong">
              {sizes.reduce((a, s) => a + Number(allocTotalsBySize[s] ?? 0), 0)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ScanMatrix({ locations, sizes, alloc, scan, setScan }) {
  const setScanCell = (loc, size, value) => {
    const v = clampInt(value);
    setScan(prev => ({ ...prev, [loc]: { ...(prev[loc] || {}), [size]: v } }));
  };

  const diffsPerCell = (loc, size) => Number(scan?.[loc]?.[size] ?? 0) - Number(alloc?.[loc]?.[size] ?? 0);

  return (
    <div className="tableCard">
      <table className="matrix2">
        <thead>
          <tr>
            <th className="c-loc">Location</th>
            {sizes.map(s => <th key={s} className="c-size2">{s}</th>)}
            <th className="c-rowtotal">Row Total</th>
          </tr>
        </thead>

        <tbody>
          {locations.map(loc => {
            const rowTotal = sizes.reduce((a, s) => a + Number(scan?.[loc]?.[s] ?? 0), 0);
            return (
              <tr key={loc}>
                <td className="locCell">{loc}</td>
                {sizes.map(s => {
                  const d = diffsPerCell(loc, s);
                  return (
                    <td key={s} className={d > 0 ? "badCell" : ""}>
                      <input
                        className="qty2"
                        inputMode="numeric"
                        value={scan?.[loc]?.[s] ?? 0}
                        onChange={(e) => setScanCell(loc, s, e.target.value)}
                      />
                      {d > 0 ? <div className="tiny">Over by {d}</div> : null}
                    </td>
                  );
                })}
                <td className="cellRead strong">{rowTotal}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="hint" style={{ padding: "10px 12px" }}>
        Scan cells should never exceed allocation. Manual edits are allowed for now.
      </div>
    </div>
  );
}
