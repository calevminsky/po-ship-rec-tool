export function sumObj(obj, sizes) {
  return sizes.reduce((acc, s) => acc + Number(obj?.[s] ?? 0), 0);
}

export function clampInt(v) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.floor(n));
}
