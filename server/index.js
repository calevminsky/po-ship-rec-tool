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

// APP_USERS format: "emily:pass1,jennie:pass2,store1:pass3"
const USERS_RAW = process.env.APP_USERS || "";
const USERS = new Map(
  USERS_RAW.split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(pair => {
      const idx = pair.indexOf(":");
      if (idx === -1) return null;
      const user = pair.slice(0, idx).trim();
      const pass = pair.slice(idx + 1).trim();
      if (!user || !pass) return null;
      return [user, pass];
    })
    .filter(Boolean)
);

// If no APP_USERS configured, app is open
const AUTH_ENABLED = USERS.size > 0;

function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) return next();

  const username = req.cookies?.yb_user;
  if (!username) return res.status(401).json({ error: "Unauthorized" });
  if (!USERS.has(username)) return res.status(401).json({ error: "Unauthorized" });

  // attach user for downstream usage/logging
  req.user = { username };
  next();
}

// --- Auth endpoints ---
app.get("/api/me", (req, res) => {
  if (!AUTH_ENABLED) return res.json({ ok: true, user: { username: "guest" }, authEnabled: false });

  const username = req.cookies?.yb_user;
  if (username && USERS.has(username)) {
    return res.json({ ok: true, user: { username }, authEnabled: true });
  }
  return res.status(401).json({ error: "Unauthorized", authEnabled: true });
});

app.post("/api/login", (req, res) => {
  if (!AUTH_ENABLED) return res.json({ ok: true, user: { username: "guest" }, authEnabled: false });

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Missing username/password" });

  const expected = USERS.get(String(username));
  if (!expected || expected !== String(password)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  res.cookie("yb_user", String(username), {
    httpOnly: true,
    sameSite: "strict",
    secure: true
  });

  return res.json({ ok: true, user: { username }, authEnabled: true });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("yb_user");
  res.json({ ok: true });
});

// --- Protected API routes ---
app.get("/api/po/:po", requireAuth, async (req, res) => {
  try {
    const po = (req.params.po || "").trim();
    if (!po) return res.status(400).json({ error: "Missing PO #" });
    const data = await listRecordsByPO(po);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

app.patch("/api/record/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: "Missing record id" });

    // If you later want audit logs, req.user.username is available here
    const updated = await updateRecord(id, req.body);

    res.json({ ok: true, updated });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
});

// --- Static client ---
app.use(express.static(clientDist));
app.get("*", (req, res) => res.sendFile(path.join(clientDist, "index.html")));

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Server running on :${port}`));
