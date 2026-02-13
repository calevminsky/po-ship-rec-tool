import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import { listRecordsByPO, updateRecord } from "./airtable.js";

const app = express();
app.use(express.json());
app.use(cookieParser());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.join(__dirname, "public");

const APP_PASSWORD = process.env.APP_PASSWORD;

// ---------- AUTH MIDDLEWARE ----------
function requireAuth(req, res, next) {
  if (!APP_PASSWORD) return next(); // allow if not configured
  if (req.cookies?.auth === "true") return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// ---------- LOGIN ----------
app.post("/api/login", (req, res) => {
  const { password } = req.body;

  if (!APP_PASSWORD) {
    return res.json({ ok: true }); // no password configured
  }

  if (password === APP_PASSWORD) {
    res.cookie("auth", "true", {
      httpOnly: true,
      sameSite: "strict",
      secure: true
    });
    return res.json({ ok: true });
  }

  return res.status(401).json({ error: "Invalid password" });
});

// ---------- LOGOUT ----------
app.post("/api/logout", (req, res) => {
  res.clearCookie("auth");
  res.json({ ok: true });
});

// ---------- PROTECTED ROUTES ----------
app.get("/api/po/:po", requireAuth, async (req, res) => {
  try {
    const po = (req.params.po || "").trim();
    const data = await listRecordsByPO(po);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch("/api/record/:id", requireAuth, async (req, res) => {
  try {
    const updated = await updateRecord(req.params.id, req.body);
    res.json({ ok: true, updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- STATIC ----------
app.use(express.static(clientDist));
app.get("*", (req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server running on :${port}`));
