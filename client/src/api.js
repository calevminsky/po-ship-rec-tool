export async function fetchPO(po) {
  const r = await fetch(`/api/po/${encodeURIComponent(po)}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Failed to load PO");
  return j;
}

export async function me() {
  const r = await fetch("/api/me");
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Not authenticated");
  return j;
}

export async function login(username, password) {
  const r = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Login failed");
  return j;
}

export async function logout() {
  const r = await fetch("/api/logout", { method: "POST" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Logout failed");
  return j;
}

export async function getLocations() {
  const r = await fetch("/api/locations");
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Failed to load locations");
  return j;
}

export async function saveShip(recordId, shipDate, shipTotals) {
  const r = await fetch(`/api/record/${encodeURIComponent(recordId)}/save-ship`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shipDate, shipTotals })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Failed to save shipping");
  return j;
}

export async function saveAllocation(recordId, allocMatrix) {
  const r = await fetch(`/api/record/${encodeURIComponent(recordId)}/save-allocation`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allocJson: JSON.stringify(allocMatrix) })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Failed to save allocation");
  return j;
}

export async function saveScan(recordId, scanMatrix, recTotals) {
  const r = await fetch(`/api/record/${encodeURIComponent(recordId)}/save-scan`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scanJson: JSON.stringify(scanMatrix), recTotals })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Failed to save scan");
  return j;
}

export async function shopifyByBarcode(barcode) {
  const r = await fetch(`/api/shopify/barcode/${encodeURIComponent(barcode)}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Shopify barcode lookup failed");
  return j;
}

export async function shopifyByProductId(productId) {
  const r = await fetch(`/api/shopify/product/${encodeURIComponent(productId)}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Shopify product fetch failed");
  return j;
}

// Search products by title (for manual select)
export async function shopifySearchByTitle(title) {
  const r = await fetch(`/api/shopify/search?title=${encodeURIComponent(title)}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Shopify product search failed");
  return j;
}

export async function linkShopifyProduct(recordId, productId) {
  const r = await fetch(`/api/record/${encodeURIComponent(recordId)}/link-shopify-product`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Failed to link Shopify product");
  return j;
}

export async function closeoutPdf(payload) {
  const r = await fetch("/api/closeout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!r.ok) {
    let msg = "Closeout failed";
    try {
      const j = await r.json();
      msg = j.error || msg;
    } catch {}
    throw new Error(msg);
  }

  return await r.blob();
}

export async function bulkAllocPdfs(items) {
  const r = await fetch("/api/bulk-alloc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items })
  });
  if (!r.ok) {
    let msg = "Bulk allocation failed";
    try { const j = await r.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  return await r.blob();
}

export async function submitOfficeSample(recordId, payload) {
  const r = await fetch(`/api/record/${encodeURIComponent(recordId)}/office-sample`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Office sample submit failed");
  return j;
}

export async function downloadSessionPdf(entries, reportDate) {
  const r = await fetch("/api/office-samples/session-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries, reportDate })
  });
  if (!r.ok) {
    let msg = "Session PDF failed";
    try {
      const j = await r.json();
      msg = j.error || msg;
    } catch {}
    throw new Error(msg);
  }
  return await r.blob();
}

export async function fetchRecordsByShopifyGid(gid) {
  const r = await fetch(`/api/airtable/by-shopify-gid?gid=${encodeURIComponent(gid)}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "GID lookup failed");
  return j;
}

export async function allocationPdf(payload) {
  const r = await fetch("/api/allocation-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!r.ok) {
    let msg = "Allocation PDF failed";
    try {
      const j = await r.json();
      msg = j.error || msg;
    } catch {}
    throw new Error(msg);
  }

  return await r.blob();
}
