// server/shopifyTokenStore.js
import { loadTokenFromDisk, saveTokenToDisk } from "./shopifyAuth.js";

let ACCESS_TOKEN = loadTokenFromDisk(); // memory cache

export function getShopifyAccessToken() {
  // 1) Prefer fixed token from env (no OAuth needed)
  const envToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (envToken && String(envToken).trim()) return String(envToken).trim();

  // 2) Fall back to OAuth token store (existing behavior)
  const t = ACCESS_TOKEN || loadTokenFromDisk();
  if (!t) throw new Error("Shopify not connected. Visit /api/shopify/auth first.");
  return t;
}

export function setShopifyAccessToken(token) {
  ACCESS_TOKEN = token;
  saveTokenToDisk(token);
}

export function hasShopifyAccessToken() {
  return !!(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || ACCESS_TOKEN || loadTokenFromDisk());
}
