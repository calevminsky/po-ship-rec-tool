let cached = { token: null, expiresAt: 0, scope: "" };

function nowMs() {
  return Date.now();
}

export async function getShopifyAccessToken() {
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const client_id = process.env.SHOPIFY_CLIENT_ID;
  const client_secret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!shop || !client_id || !client_secret) {
    throw new Error("Missing Shopify env vars (SHOPIFY_STORE_DOMAIN/SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET)");
  }

  // refresh if < 2 minutes left
  if (cached.token && cached.expiresAt - nowMs() > 120_000) {
    return cached.token;
  }

  const url = `https://${shop}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id,
    client_secret
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error_description || data?.error || "Failed to get Shopify access token");
  }

  cached.token = data.access_token;
  cached.scope = data.scope || "";
  cached.expiresAt = nowMs() + (Number(data.expires_in || 0) * 1000);

  return cached.token;
}
