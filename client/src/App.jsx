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

  // Receiving (Mode 3)
  const [scan, setScan] = useState(() => emptyMatrix(DEFAULT_LOCATIONS, SIZES));
  const [scanEdit, setScanEdit] = useState(false);
  const [activeLoc, setActiveLoc] = useState(DEFAULT_LOCATIONS[0]);
  const [scanBarcode, setScanBarcode] = useState("");
  const scanInputRef = useRef(null);
  const [lastScanStack, setLastScanStack] = useState([]);

  // Shopify link (Mode 3 only)
  const [shopifyLinked, setShopifyLinked] = useState(false);
  const [shopifyProduct, setShopifyProduct] = useState(null);
  const [barcodeLinkInput, setBarcodeLinkInput] = useState("");
  const [barcodeMap, setBarcodeMap] = useState({});

  // Derived
  const unitCost = Number(selected?.unitCost ?? 0);

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

    // Reset receiving/shopify state when changing product
    setAllocEdit(false);
    setScanEdit(false);
    setShopifyLinked(false);
    setShopifyProduct(null);
    setBarcodeLinkInput("");
    setBarcodeMap({});
    setScanBarcode("");
    setLastScanStack([]);

    setStatus("");
  }, [selectedId, locations]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ---------- Mode 2: Save Allocation ----------
  async function onSaveAllocation() {
    if (!selectedId) return;

    // Warn if mismatch, allow submit anyway
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

  // ---------- Mode 3: Shopify linking ----------
  async function onLinkShopifyByBarcode() {
    const bc = barcodeLinkInput.trim();
    if (!bc) return;

    try {
      setLoading(true);
      setStatus("Linking Shopify product…");

      const r = await shopifyByBarcode(bc);
      if (!r.found) {
        setShopifyLinked(false);
        setShopifyProduct(null);
        setBarcodeMap({});
        setStatus("Barcode not found in Shopify. You can continue without scanning.");
        return;
      }

      setShopifyLinked(true);
      setShopifyProduct(r.product);

      const map = {};
      for (const v of r.product.variants || []) {
        const b = String(v.barcode || "").trim();
        if (!b) continue;
        const size = normalizeSizeValue(v.sizeValue);
        if (!size) continue;
        map[b] = { size, inventoryItemId: v.inventoryItemId };
      }
      setBarcodeMap(map);

      setStatus(`Linked: ${r.product.title} (${Object.keys(map).length} barcodes loaded)`);
      setTimeout(() => scanInputRef.current?.focus(), 50);
    } catch (e) {
      setShopifyLinked(false);
      setShopifyProduct(null);
      setBarcodeMap({});
      setStatus(`Shopify link failed: ${e.message}`);
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
      const ok = window.confirm(
        "This barcode is NOT part of the linked Shopify product.\n\n" +
          "Press OK to ignore (no scan), or Cancel to keep scanning."
      );
      if (ok) setStatus("Barcode not in linked product (ignored).");
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
        `Over allocation for ${activeLoc} ${size}.\n\n` +
          `Allocated: ${allocCap}\nScanned would become: ${cur + 1}\n\nOverride and allow anyway?`
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
      const ok = window.confirm(
        "Allocation does NOT match Ship Units.\n\nSubmit closeout anyway?\n\n(You will still get a PDF; Shopify adjust uses scanned totals.)"
      );
      if (!ok) return;
    }

    if (!scanMatchesAlloc) {
      const ok = window.confirm(
        "Scanned totals do NOT match Allocation.\n\nSubmit closeout anyway?\n\n(You will still get a PDF; Shopify adjust uses scanned totals.)"
      );
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
                      placeholder="e.g. YB1892"
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

                {mode === "receiving" ? (
                  <>
                    <div className="divider" />
                    <div className="field">
                      <div className="label">Link Shopify (needed to scan)</div>
                      <div className="hstack">
                        <input
                          className="input"
                          value={barcodeLinkInput}
                          onChange={(e) => setBarcodeLinkInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") onLinkShopifyByBarcode();
                          }}
                          placeholder="Scan/enter ANY variant barcode…"
                          disabled={!selected}
                        />
                        <button className="btn" onClick={onLinkShopifyByBarcode} disabled={!selected || loading || !barcodeLinkInput.trim()}>
                          Link
                        </button>
                      </div>
                      <div className="hint">
                        {shopifyLinked && shopifyProduct
                          ? `Linked: ${shopifyProduct.title} • ${Object.keys(barcodeMap).length} barcodes loaded`
                          : "Not linked yet (scanning disabled)."}
                      </div>
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
                    {selected.imageUrl ? <img className="image" src={selected.imageUrl} alt="Product or Swatch" /> : <div className="imageEmpty">No image</div>}
                  </div>
                </div>

                {mode === "shipping" ? (
                  <>
                    <div className="sectionTitle">Mode 1 — Shipping</div>
                    <div className="hint">Enter ship date + shipped units. This saves back to Airtable.</div>

                    <div className="shipBlock">
                      <div className="shipRow">
                        <div className="label">Ship Date</div>
                        <input className="dateBig" type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} />
                      </div>

                      <div className="tableCard">
                        <table className="matrix2">
                          <thead>
                            <tr>
                              {sizes.map((s) => (
                                <th key={s} className="c-size2">
                                  {s}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
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
                    <div className="hint">Sizes are columns. Locations are rows. Totals should match Ship Units.</div>

                    <div className="modeTools">
                      <button className="btn" onClick={() => setAllocEdit((v) => !v)}>
                        {allocEdit ? "Done Editing" : "Edit Allocation"}
                      </button>
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
                      <button className="btn primary" onClick={onSaveAllocation} disabled={loading || !selectedId}>
                        Submit Allocation
                      </button>
                    </div>
                  </>
                ) : null}

                {mode === "receiving" ? (
                  <>
                    <div className="sectionTitle">Mode 3 — Receiving</div>
                    <div className="hint">
                      Select a location, then scan into that location. Cells show <strong>Allocated</strong> and <strong>Scanned</strong>.
                    </div>

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
                        <button className="btn primary" disabled={!shopifyLinked || loading || !scanBarcode.trim()}>
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

                      <div className="scanHint">
                        Tip: Keep the scanner cursor in the scan box. If you over-scan, you’ll get a warning + optional override.
                      </div>
                    </div>

                    <ReceivingMatrix
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
                        <input
                          className="qty2"
                          inputMode="numeric"
                          value={v}
                          onChange={(e) => setAllocCell(loc, s, e.target.value)}
                        />
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
            <td className="locCell strong">Totals</td>
            {sizes.map((s) => (
              <td key={s} className={diffs[s] !== 0 ? "badCell" : ""}>
                <div className="strong">{allocTotalsBySize[s]}</div>
                <div className="tiny">Ship: {shipTotalsBySize[s]} (diff {diffs[s]})</div>
              </td>
            ))}
            <td className="cellRead strong">{sizes.reduce((a, s) => a + Number(allocTotalsBySize[s] ?? 0), 0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ReceivingMatrix({ locations, sizes, alloc, scan, activeLoc, edit, setScanCell, bumpScanCell }) {
  return (
    <div className="tableCard">
      <table className="matrix2">
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
                      <div className={`recvCell ${isActive ? "recvActive" : ""}`}>
                        <div className="recvTop">
                          <span className="recvAlloc">Alloc {a}</span>
                          <span className={`recvScan ${over ? "badText" : ""}`}>Scanned {v}</span>
                        </div>

                        {edit ? (
                          <div className="recvEdit">
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
