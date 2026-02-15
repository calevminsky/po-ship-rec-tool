import { loadTokenFromDisk, saveTokenToDisk } from "./shopifyAuth.js";

let ACCESS_TOKEN = loadTokenFromDisk(); // memory cache

export function getShopifyAccessToken() {
  const t = ACCESS_TOKEN || loadTokenFromDisk();
  if (!t) throw new Error("Shopify not connected. Visit /api/shopify/auth first.");
  return t;
}

export function setShopifyAccessToken(token) {
  ACCESS_TOKEN = token;
  saveTokenToDisk(token);
}

export function hasShopifyAccessToken() {
  return !!(ACCESS_TOKEN || loadTokenFromDisk());
}
