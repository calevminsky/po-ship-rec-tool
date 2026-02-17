async function j(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Request failed");
  return data;
}

export async function fetchPO(po) {
  const res = await fetch(`/api/po/${encodeURIComponent(po)}`);
  return j(res);
}

export async function me() {
  const res = await fetch("/api/me");
  return j(res);
}

export async function login(username, password) {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  return j(res);
}

export async function logout() {
  const res = await fetch("/api/logout", { method: "POST" });
  return j(res);
}

export async function getLocations() {
  const res = await fetch("/api/locations");
  return j(res);
}

export async function saveShip(recordId, shipDate, shipTotals) {
  const res = await fetch(`/api/record/${encodeURIComponent(recordId)}/save-ship`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shipDate, shipTotals })
  });
  return j(res);
}

export async function saveAllocation(recordId, allocObj) {
  const res = await fetch(`/api/record/${encodeURIComponent(recordId)}/save-allocation`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allocJson: JSON.stringify(allocObj) })
  });
  return j(res);
}

export async function saveScan(recordId, scanObj, recTotals) {
  const res = await fetch(`/api/record/${encodeURIComponent(recordId)}/save-scan`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scanJson: JSON.stringify(scanObj), recTotals })
  });
  return j(res);
}

export async function shopifyByBarcode(barcode) {
  const res = await fetch(`/api/shopify/barcode/${encodeURIComponent(barcode)}`);
  return j(res);
}

export async function shopifyByProductId(productId) {
  const res = await fetch(`/api/shopify/product/${encodeURIComponent(productId)}`);
  return j(res);
}

// NEW
export async function shopifySearchByTitle(title) {
  const res = await fetch(`/api/shopify/search?title=${encodeURIComponent(title)}`);
  return j(res);
}

export async function linkShopifyProduct(recordId, productId) {
  const res = await fetch(`/api/record/${encodeURIComponent(recordId)}/link-shopify-product`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId })
  });
  return j(res);
}

export async function closeoutPdf(payload) {
  const res = await fetch("/api/closeout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || "Closeout failed");
  }

  const blob = await res.blob();
  return blob;
}
