import React, { useMemo, useState } from "react";
import { fetchPO, saveRecord } from "./api.js";

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
  // Airtable dates often come as "YYYY-MM-DD" already; if datetime, slice date part.
  if (!airtableDate) return "";
  return String(airtableDate).slice(0, 10);
}

export default function App() {
  const [poInput, setPoInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [poData, setPoData] = useState(null);

  const [selectedId, setSelectedId] = useState("");
  const [shipEdits, setShipEdits] = useState(null);
  const [recEdits, setRecEdits] = useState(null);
  const [shipDate, setShipDate] = useState("");
  const [delivery, setDelivery] = useState("");

  const [status, setStatus] = useState("");

  const sizes = poData?.sizes || ["XXS", "XS", "S", "M", "L", "XL"];
  const records = poData?.records || [];

  const selected = useMemo(
    () => records.find((r) => r.id === selectedId) || null,
    [records, selectedId]
  );

  async function onLoadPO() {
    setStatus("");
    const po = poInput.trim();
    if (!po) return;

    try {
      setLoading(true);
      const data = await fetchPO(po);
      setPoData(data);

      // IMPORTANT: do NOT auto-select if multiple records
      if ((data.records || []).length === 1) {
        const only = data.records[0];
        setSelectedId(only.id);
        setShipEdits({ ...only.ship });
        setRecEdits({ ...only.rec });
        setShipDate(fmtDateForInput(only.shipDate));
        setDelivery(fmtDateForInput(only.delivery));
      } else {
        setSelectedId("");
        setShipEdits(null);
        setRecEdits(null);
        setShipDate("");
        setDelivery("");
      }

      if (!(data.records || []).length) setStatus("No records found for that PO #.");
    } catch (e) {
      setStatus(e.message);
    } finally {
      setLoading(false);
    }
  }

  function onSelect(id) {
    setSelectedId(id);
    const r = records.find((x) => x.id === id);
    if (!r) {
      setShipEdits(null);
      setRecEdits(null);
      setShipDate("");
      setDelivery("");
      return;
    }
    setShipEdits({ ...r.ship });
    setRecEdits({ ...r.rec });
    setShipDate(fmtDateForInput(r.shipDate));
    setDelivery(fmtDateForInput(r.delivery));
    setStatus("");
  }

  function setCell(kind, size, value) {
    const v = clampInt(value);
    if (kind === "ship") setShipEdits((prev) => ({ ...(prev || {}), [size]: v }));
    if (kind === "rec") setRecEdits((prev) => ({ ...(prev || {}), [size]: v }));
  }

  async function onSave() {
    if (!selectedId) return;

    try {
      setLoading(true);
      setStatus("Saving…");
      await saveRecord(selectedId, {
        ship: shipEdits,
        rec: recEdits,
        shipDate: shipDate || null,
        delivery: delivery || null
      });
      setStatus("Saved ✅");
    } catch (e) {
      setStatus(`Save failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  const unitCost = Number(selected?.unitCost ?? 0);

  const buyTotalUnits = selected ? sumObj(selected.buy, sizes) : 0;
  const shipTotalUnits = shipEdits ? sumObj(shipEdits, sizes) : 0;
  const recTotalUnits = recEdits ? sumObj(recEdits, sizes) : 0;

  const buyTotalCost = buyTotalUnits * unitCost;
  const shipTotalCost = shipTotalUnits * unitCost;
  const recTotalCost = recTotalUnits * unitCost;

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <div className="title">PO Shipping & Receiving</div>
          <div className="subtitle">Enter Ship / Received by size, totals & costs calculate automatically.</div>
        </div>
      </div>

      <div className="grid">
        <div className="panel">
          <div className="panelTitle">Find PO</div>

          <div className="formRow">
            <label>PO #</label>
            <div className="inline">
              <input
                className="text"
                value={poInput}
                onChange={(e) => setPoInput(e.target.value)}
                placeholder="Type PO number…"
              />
              <button className="btnPrimary" onClick={onLoadPO} disabled={loading || !poInput.trim()}>
                {loading ? "Loading…" : "Load"}
              </button>
            </div>
          </div>

          {poData && (
            <div className="formRow">
              <label>Product</label>
              <select className="select" value={selectedId} onChange={(e) => onSelect(e.target.value)}>
                <option value="">{records.length ? "Select a product…" : "(no products found)"}</option>
                {records.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              {records.length > 1 && !selectedId && (
                <div className="hint">This PO has multiple products—select the correct one to enter Ship/Received.</div>
              )}
            </div>
          )}

          {status && <div className="status">{status}</div>}
        </div>

        <div className="panel">
          <div className="panelTitle">Details</div>

          {!selected ? (
            <div className="empty">
              {poData
                ? "Select a product to view sizes and enter Ship/Received."
                : "Load a PO to begin."}
            </div>
          ) : (
            <>
              <div className="detailHeader">
                <div className="detailLeft">
                  <div className="detailName">{selected.label}</div>
                  <div className="detailMeta">
                    <span className="pill">Unit Cost: <strong>{money(unitCost)}</strong></span>
                  </div>
                </div>

                {selected.imageUrl ? (
                  <div className="thumbWrap">
                    <img className="thumb" src={selected.imageUrl} alt="Product or Swatch" />
                  </div>
                ) : (
                  <div className="thumbEmpty">No image</div>
                )}
              </div>

              <div className="tableWrap">
                <table className="matrix">
                  <thead>
                    <tr>
                      <th className="rowHead"></th>
                      <th className="dateCol"></th>
                      {sizes.map((s) => (
                        <th key={s}>{s}</th>
                      ))}
                      <th className="totCol">Total Units</th>
                      <th className="costCol">Total Cost</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr>
                      <td className="rowHead">Buy Units</td>
                      <td className="dateCell muted">—</td>
                      {sizes.map((s) => (
                        <td key={s} className="readCell">
                          {Number(selected.buy[s] ?? 0)}
                        </td>
                      ))}
                      <td className="readCell strong">{buyTotalUnits}</td>
                      <td className="readCell strong">{money(buyTotalCost)}</td>
                    </tr>

                    <tr>
                      <td className="rowHead">Ship Units</td>
                      <td className="dateCell">
                        <input
                          className="date"
                          type="date"
                          value={shipDate}
                          onChange={(e) => setShipDate(e.target.value)}
                        />
                      </td>
                      {sizes.map((s) => (
                        <td key={s}>
                          <input
                            className="qty"
                            inputMode="numeric"
                            value={shipEdits?.[s] ?? 0}
                            onChange={(e) => setCell("ship", s, e.target.value)}
                          />
                        </td>
                      ))}
                      <td className="readCell strong">{shipTotalUnits}</td>
                      <td className="readCell strong">{money(shipTotalCost)}</td>
                    </tr>

                    <tr>
                      <td className="rowHead">Received Units</td>
                      <td className="dateCell">
                        <input
                          className="date"
                          type="date"
                          value={delivery}
                          onChange={(e) => setDelivery(e.target.value)}
                        />
                      </td>
                      {sizes.map((s) => (
                        <td key={s}>
                          <input
                            className="qty"
                            inputMode="numeric"
                            value={recEdits?.[s] ?? 0}
                            onChange={(e) => setCell("rec", s, e.target.value)}
                          />
                        </td>
                      ))}
                      <td className="readCell strong">{recTotalUnits}</td>
                      <td className="readCell strong">{money(recTotalCost)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="actions">
                <button className="btnPrimary" onClick={onSave} disabled={loading}>
                  {loading ? "Saving…" : "Save to Airtable"}
                </button>
                <div className="actionsHint">
                  Saves <strong>Ship_*</strong>, <strong>Rec_*</strong>, <strong>Ship Date</strong>, and <strong>Delivery</strong>.
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="footer">
        Totals shown here are calculated from entered size quantities (Airtable total fields are formulas).
      </div>
    </div>
  );
}
