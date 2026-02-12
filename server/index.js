import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { config, listRecordsByPO, updateRecord } from "./airtable.js";

const app = express();
app.use(express.json());

// Render serves the built client from /client/dist.
// We'll copy it during build (see Render instructions below).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.join(__dirname, "public");

// Basic health
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// GET records for a PO
app.get("/api/po/:po", async (req, res) => {
  try {
    const po = req.params.po;
    if (!po || !String(po).trim()) return res.status(400).json({ error: "Missing PO" });

    const records = await listRecordsByPO(po);

    const normalized = records.map((r) => {
      const f = r.fields || {};
      const buy = {};
      const ship = {};
      const rec = {};

      for (const s of config.sizes) {
        buy[s] = Number(f[`Buy_${s}`] ?? 0);
        ship[s] = Number(f[`Ship_${s}`] ?? 0);
        rec[s] = Number(f[`Rec_${s}`] ?? 0);
      }

      // build a nice label for dropdown
      const parts = [];
      for (const df of config.displayFields) {
        if (f[df]) parts.push(String(f[df]));
      }
      const label = parts.length ? parts.join(" • ") : r.id;

      return {
        id: r.id,
        label,
        po: f[config.poField] ?? po,
        buy,
        ship,
        rec
      };
    });

    res.json({ po, sizes: config.sizes, records: normalized });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

// PATCH update ship/rec fields for a record
app.patch("/api/record/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { ship, rec } = req.body || {};

    if (!id) return res.status(400).json({ error: "Missing record id" });

    const fields = {};

    // Only write numeric fields; do not touch formula total fields.
    if (ship && typeof ship === "object") {
      for (const s of config.sizes) {
        if (ship[s] !== undefined) fields[`Ship_${s}`] = Number(ship[s] ?? 0);
      }
    }
    if (rec && typeof rec === "object") {
      for (const s of config.sizes) {
        if (rec[s] !== undefined) fields[`Rec_${s}`] = Number(rec[s] ?? 0);
      }
    }

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const updated = await updateRecord(id, fields);
    res.json({ ok: true, updated });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

// Static client
app.use(express.static(clientDist));
app.get("*", (req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server running on :${port}`));
