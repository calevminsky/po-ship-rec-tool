import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { listRecordsByPO, updateRecord } from "./airtable.js";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.join(__dirname, "public");

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/po/:po", async (req, res) => {
  try {
    const po = req.params.po;
    const records = await listRecordsByPO(po);
    res.json(records);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch("/api/record/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const result = await updateRecord(id, req.body);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(clientDist));
app.get("*", (req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server running on ${port}`));
