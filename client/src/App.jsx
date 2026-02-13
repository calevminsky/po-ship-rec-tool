import React, { useEffect, useMemo, useState } from "react";
import { fetchPO, saveRecord, login, logout, me } from "./api.js";

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

export default function App() {
  // --------------------
  // Auth state (Option 2)
  // --------------------
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState(null);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await me();
        setUser(r.user); // { username }
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
      const r = await login(loginUser.trim(), loginPass);
      setUser(r.user);
      setLoginPass("");
    } catch (e) {
      setAuthError(e.message || "Login failed");
    }
  }

  async function doLogout() {
    try {
      await logout();
    } finally {
      setUser(null);
      setLoginUser("");
      setLoginPass("");
      setAuthError("");
      // clear any loaded PO data on logout
      setPoInput("");
      setPoData(null);
      setSelectedId("");
      setShipEdits(null);
      setRecEdits(null);
      setShipDate("");
      setDelivery("");
      setEditMode("none");
      setStatus("");
    }
  }

  // --------------------
  // App state
  // --------------------
  const [poInput, setPoInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [poData, setPoData] = useState(null);

  const [selectedId, setSelectedId] = useState("");
  const [shipEdits, setShipEdits] = useState(null);
  const [recEdits, setRecEdits] = useState(null);
  const [shipDate, setShipDate] = useState("");
  const [delivery, setDelivery] = useState("");

  // mutually exclusive edit mode: "none" | "ship" | "received"
  const [editMode, setEditMode] = useState("none");

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

      // do NOT auto-select if multiple
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

      setEditMode("none");
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
      setEditMode("none");
      return;
    }
    setShipEdits({ ...r.ship });
    setRecEdits({ ...r.rec });
    setShipDate(fmtDateForInput(r.shipDate));
    setDelivery(fmtDateForInput(r.delivery));
    setEditMode("none");
    setStatus("");
  }

  function setCell(kind, size, value) {
    const v = clampInt(value);
    if (kind === "ship") setShipEdits((prev) => ({ ...(prev || {}), [size]: v }));
    if (kind === "rec") setRecEdits((prev) => ({ ...(prev || {}), [size]: v }));
  }

  function toggleEdit(mode) {
    setEditMode((prev) => (prev === mode ? "none" : mode));
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
      setEditMode("none");
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

  const shipEnabled = editMode === "ship";
  const recEnabled = editMode === "received";

  // --------------------
  // Auth UI
  // --------------------
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

          <input
            className="authInput"
            value={loginUser}
            onChange={(e) => setLoginUser(e.target.value)}
            placeholder="Username"
            autoComplete="username"
          />
          <input
            className="authInput"
            type="password"
            value={loginPass}
            onChange={(e) => setLoginPass(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
          />

          {authError ? <div className="authError">{authError}</div> : null}

          <button
            className="btn primary"
            onClick={doLogin}
            disabled={!loginUser.trim() || !loginPass}
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  // --------------------
  // Main App UI
  // --------------------
  return (
    <div className="app">
      <div className="shell">
        <header className="header">
          <div className="brand">
            <div className="brandTitle">Shipping & Receiving</div>
            <div className="brandSub">Load a PO → choose product → update Ship or Received.</div>
          </div>

          <div className="headerRight">
            <div className="userPill">
              Signed in as <strong>{user.username}</strong>
              <button className="linkBtn" onClick={doLogout}>
                Log out
              </button>
            </div>

            <div className="statusPill" data-show={status ? "1" : "0"}>
              {status || " "}
            </div>
          </div>
        </header>

        <div className="layout">
          {/* LEFT: Lookup */}
          <aside className="card lookup">
            <div className="cardTitle">Find</div>

            <div className="field">
              <div className="label">PO #</div>
              <div className="hstack">
                <input
                  className="input"
                  value={poInput}
                  onChange={(e) => setPoInput(e.target.value)}
                  placeholder="e.g. YB1892"
                />
                <button
                  className="btn primary"
                  onClick={onLoadPO}
                  disabled={loading || !poInput.trim()}
                >
                  {loading ? "Loading…" : "Load"}
                </button>
              </div>
            </div>

            {poData && (
              <div className="field">
                <div className="label">Product</div>
                <select
                  className="select"
                  value={selectedId}
                  onChange={(e) => onSelect(e.target.value)}
                >
                  <option value="">
                    {records.length ? "Select a product…" : "(no products found)"}
                  </option>
                  {records.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>

                {records.length > 1 && !selectedId && (
                  <div className="hint">
                    This PO has multiple products. Select one to edit Ship / Received.
                  </div>
                )}
              </div>
            )}

            <div className="divider" />

            <div className="metaGrid">
              <div className="meta">
                <div className="metaLabel">Unit Cost</div>
                <div className="metaValue">{selected ? money(unitCost) : "—"}</div>
              </div>
              <div className="meta">
                <div className="metaLabel">Edit Mode</div>
                <div className="metaValue">
                  {editMode === "none" ? "Locked" : editMode === "ship" ? "Ship" : "Received"}
                </div>
              </div>
            </div>

            <div className="footnote">
              Tip: Enable <strong>one</strong> edit row at a time to prevent accidental changes.
            </div>
          </aside>

          {/* RIGHT: Details + Table */}
          <main className="card main">
            {!selected ? (
              <div className="emptyState">
                <div className="emptyTitle">Ready when you are.</div>
                <div className="emptyText">
                  Enter a PO number on the left, then choose a product to see sizes and totals.
                </div>
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

                <div className="tableCard">
                  <table className="matrix">
                    <thead>
                      <tr>
                        <th className="c-rowlabel"></th>
                        <th className="c-edit"></th>
                        <th className="c-date"></th>
                        {sizes.map((s) => (
                          <th key={s} className="c-size">
                            {s}
                          </th>
                        ))}
                        <th className="c-total">Total Units</th>
                        <th className="c-cost">Total Cost</th>
                      </tr>
                    </thead>

                    <tbody>
                      <tr>
                        <td className="rowLabel">Buy Units</td>
                        <td className="cellMuted">—</td>
                        <td className="cellMuted">—</td>
                        {sizes.map((s) => (
                          <td key={s} className="cellRead">
                            {Number(selected.buy[s] ?? 0)}
                          </td>
                        ))}
                        <td className="cellRead strong">{buyTotalUnits}</td>
                        <td className="cellRead strong">{money(buyTotalCost)}</td>
                      </tr>

                      <tr className={shipEnabled ? "rowActive" : ""}>
                        <td className="rowLabel">Ship Units</td>
                        <td className="cellCenter">
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={shipEnabled}
                              onChange={() => toggleEdit("ship")}
                            />
                            <span />
                          </label>
                        </td>
                        <td className="cellCenter">
                          <input
                            className="date"
                            type="date"
                            value={shipDate}
                            onChange={(e) => setShipDate(e.target.value)}
                            disabled={!shipEnabled}
                          />
                        </td>
                        {sizes.map((s) => (
                          <td key={s}>
                            <input
                              className="qty"
                              inputMode="numeric"
                              value={shipEdits?.[s] ?? 0}
                              onChange={(e) => setCell("ship", s, e.target.value)}
                              disabled={!shipEnabled}
                            />
                          </td>
                        ))}
                        <td className="cellRead strong">{shipTotalUnits}</td>
                        <td className="cellRead strong">{money(shipTotalCost)}</td>
                      </tr>

                      <tr className={recEnabled ? "rowActive" : ""}>
                        <td className="rowLabel">Received Units</td>
                        <td className="cellCenter">
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={recEnabled}
                              onChange={() => toggleEdit("received")}
                            />
                            <span />
                          </label>
                        </td>
                        <td className="cellCenter">
                          <input
                            className="date"
                            type="date"
                            value={delivery}
                            onChange={(e) => setDelivery(e.target.value)}
                            disabled={!recEnabled}
                          />
                        </td>
                        {sizes.map((s) => (
                          <td key={s}>
                            <input
                              className="qty"
                              inputMode="numeric"
                              value={recEdits?.[s] ?? 0}
                              onChange={(e) => setCell("rec", s, e.target.value)}
                              disabled={!recEnabled}
                            />
                          </td>
                        ))}
                        <td className="cellRead strong">{recTotalUnits}</td>
                        <td className="cellRead strong">{money(recTotalCost)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="actions">
                  <button className="btn primary" onClick={onSave} disabled={loading || !selectedId}>
                    {loading ? "Saving…" : "Save"}
                  </button>

                  <div className="actionsNote">
                    Writes <strong>Ship_*</strong>, <strong>Rec_*</strong>, <strong>Ship Date</strong>,{" "}
                    and <strong>Delivery</strong>. Totals are calculated here.
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
