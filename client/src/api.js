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

export async function login(password) {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Login failed");
  return data;
}

export async function logout() {
  const res = await fetch("/api/logout", { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Logout failed");
  return data;
}
