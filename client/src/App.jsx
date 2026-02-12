import React, { useMemo, useState } from "react";
import { fetchPO, saveRecord } from "./api.js";
import { clampInt, sumObj } from "./sizes.js";

export default function App() {
  const [poInput, setPoInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [poData, setPoData] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [shipEdits, setShipEdits] = useState(null);
  const [recEdits, setRecEdits] = useState(null);
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

      // auto-select if only one
      const first = data.records?.[0];
      setSelectedId(first ? first.id : "");
      setShipEdits(first ? { ...first.ship } : null);
      setRecEdits(first ? { ...first.rec } : null);

      if (!data.records?.length) setStatus("No records found for that PO.");
    } catch (e) {
      setStatus(e.message);
    } finally {
      setLoading(false);
    }
  }

  function onSelect(id) {
    setSelectedId(id);
    const r = records.find((x) => x.id === id);
    setShipEdits(r ? { ...r.ship } : null);
    setRecEdits(r ? { ...r.rec } : null);
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
      setStatus("Saving...");
      await saveRecord(selectedId, { ship: shipEdits, rec: recEdits });
      setStatus("Saved ✅");
    } catch (e) {
      setStatus(`Save failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  const buyTotal = selected ? sumObj(selected.buy, sizes) : 0;
  const shipTotal = shipEdits ? sumObj(shipEdits, sizes) : 0;
  const recTotal = recEdits ? sumObj(recEdits, sizes) : 0;

  return (
    <div className="wrap">
      <header className="header">
        <h1>PO Ship/Rec Entry</h1>
        <p>Type a PO #, load the items, enter Ship/Rec by size, then Save.</p>
      </header>

      <section className="card">
        <div className="row">
          <label className="label">PO #</label>
          <input
            className="input"
            value={poInput}
            onChange={(e) => setPoInput(e.target.value)}
            placeholder='e.g. 12345'
          />
          <button className="btn" onClick={onLoadPO} disabled={loading || !poInput.trim()}>
            {loading ? "Loading..." : "Load"}
          </button>
        </div>

        {poData && (
          <div className="row" style={{ marginTop: 12 }}>
            <label className="label">Line Item</label>
            <select
              className="select"
              value={selectedId}
              onChange={(e) => onSelect(e.target.value)}
              disabled={!records.length}
            >
              {records.length === 0 && <option value="">(none)</option>}
              {records.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {status && <div className="status">{status}</div>}
      </section>

      {selected && (
        <section className="card">
          <h2 className="subtitle">{selected.label}</h2>

          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th></th>
                  {sizes.map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="rowHead">Buy</td>
                  {sizes.map((s) => (
                    <td key={s} className="cellRead">
                      {Number(selected.buy[s] ?? 0)}
                    </td>
                  ))}
                  <td className="cellRead strong">{buyTotal}</td>
                </tr>

                <tr>
                  <td className="rowHead">Ship</td>
                  {sizes.map((s) => (
                    <td key={s}>
                      <input
                        className="cellInput"
                        inputMode="numeric"
                        value={shipEdits?.[s] ?? 0}
                        onChange={(e) => setCell("ship", s, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="cellRead strong">{shipTotal}</td>
                </tr>

                <tr>
                  <td className="rowHead">Rec</td>
                  {sizes.map((s) => (
                    <td key={s}>
                      <input
                        className="cellInput"
                        inputMode="numeric"
                        value={recEdits?.[s] ?? 0}
                        onChange={(e) => setCell("rec", s, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="cellRead strong">{recTotal}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={onSave} disabled={loading}>
              {loading ? "Saving..." : "Save to Airtable"}
            </button>
          </div>
        </section>
      )}

      <footer className="footer">
        <small>
          Writes only Ship_* and Rec_* fields. Totals are calculated here (since Airtable totals are formulas).
        </small>
      </footer>
    </div>
  );
}
