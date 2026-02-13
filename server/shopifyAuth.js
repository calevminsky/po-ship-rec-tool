import crypto from "crypto";
import fs from "fs";
import path from "path";

function tokenPath() {
  return process.env.SHOPIFY_TOKEN_STORE_PATH || path.join(process.cwd(), "shopify_token.json");
}

export function loadTokenFromDisk() {
  try {
    const p = tokenPath();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf8");
    const json = JSON.parse(raw);
    if (json?.access_token) return json.access_token;
    return null;
  } catch {
    return null;
  }
}

export function saveTokenToDisk(accessToken) {
  const p = tokenPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ access_token: accessToken, saved_at: new Date().toISOString() }, null, 2));
}

export function makeState() {
  return crypto.randomBytes(16).toString("hex");
}

export function buildAuthorizeUrl(state) {
  const shop = process.env.SHOPIFY_SHOP;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const scopes = process.env.SHOPIFY_SCOPES || "read_products,read_inventory,write_inventory";
  const redirectUri = process.env.SHOPIFY_REDIRECT_URI;

  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
  });

  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code) {
  const shop = process.env.SHOPIFY_SHOP;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  const resp = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(`Token exchange failed: ${resp.status} ${JSON.stringify(json)}`);
  }
  if (!json?.access_token) throw new Error("Token exchange succeeded but no access_token returned.");
  return json.access_token;
}
