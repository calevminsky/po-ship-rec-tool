export async function login(password) {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Login failed");
  }

  return res.json();
}
