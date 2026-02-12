export async function fetchPO(po) {
  const res = await fetch(`/api/po/${encodeURIComponent(po)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to load PO");
  return data;
}

export async function saveRecord(recordId, payload) {
  const res = await fetch(`/api/record/${encodeURIComponent(recordId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to save");
  return data;
}
