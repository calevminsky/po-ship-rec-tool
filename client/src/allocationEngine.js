// src/allocationEngine.js

// ── Pack sequence (1–15) ─────────────────────────────────────────────────────
// This defines the distribution ORDER and RATIO of packs across locations.
// When N full packs can be made from available inventory, we look at the first
// N entries of this sequence to count how many packs each location receives.
const PACK_SEQUENCE_1_TO_15 = [
  "Cedarhurst",    // 1
  "Cedarhurst",    // 2
  "Bogota",        // 3
  "Bogota",        // 4
  "Toms River",    // 5
  "Teaneck Store", // 6
  "Cedarhurst",    // 7
  "Bogota",        // 8
  "Toms River",    // 9
  "Cedarhurst",    // 10
  "Warehouse",     // 11
  "Warehouse",     // 12
  "Bogota",        // 13
  "Cedarhurst",    // 14
  "Warehouse"      // 15
];

// ── Pack composition (units per size in one full pack) ───────────────────────
// A pack without XXS = 10 units;  with XXS = 11 units.
const PACK_NO_XXS   = { XS: 3, S: 3, M: 2, L: 1, XL: 1 };           // 10
const PACK_WITH_XXS = { XXS: 1, XS: 3, S: 3, M: 2, L: 1, XL: 1 };   // 11

// ── Allocation order ─────────────────────────────────────────────────────────
// Office is handled first (fixed 1 XS + 1 S), then stores in this order.
// Each location is filled completely before moving to the next.
const ALLOCATION_ORDER = ["Cedarhurst", "Bogota", "Toms River", "Teaneck Store", "Warehouse"];

// ── Matrix helpers ───────────────────────────────────────────────────────────
function emptyMatrix(locations, sizes) {
  const m = {};
  for (const loc of locations) {
    m[loc] = {};
    for (const s of sizes) m[loc][s] = 0;
  }
  return m;
}

function addToLoc(matrix, loc, pack) {
  const out = structuredClone(matrix);
  for (const [sz, qty] of Object.entries(pack)) {
    out[loc][sz] = Number(out?.[loc]?.[sz] ?? 0) + Number(qty ?? 0);
  }
  return out;
}

function perSizeTotalsFromMatrix(matrix, locations, sizes) {
  const t = {};
  for (const s of sizes) {
    t[s] = locations.reduce((a, loc) => a + Number(matrix?.[loc]?.[s] ?? 0), 0);
  }
  return t;
}

function capToShipTotals(built, locations, sizes, ship) {
  // Safety cap: total allocated per size must never exceed total shipped per size.
  // Remove excess from: Warehouse → Teaneck → Toms River → Bogota → Cedarhurst → Office
  const removalOrder = ["Warehouse", "Teaneck Store", "Toms River", "Bogota", "Cedarhurst", "Office"]
    .filter((l) => locations.includes(l));

  const out = structuredClone(built);

  for (const s of sizes) {
    const totalAllocated = locations.reduce((a, loc) => a + Number(out?.[loc]?.[s] ?? 0), 0);
    const cap = Number(ship?.[s] ?? 0);
    if (totalAllocated <= cap) continue;

    let excess = totalAllocated - cap;
    for (const loc of removalOrder) {
      if (excess <= 0) break;
      const have = Number(out?.[loc]?.[s] ?? 0);
      const take = Math.min(have, excess);
      if (take > 0) {
        out[loc][s] = have - take;
        excess -= take;
      }
    }
  }
  return out;
}

/**
 * Main allocation engine.
 *
 * How it works:
 *   1.  avail[s] = min(buy[s], ship[s])           — units available to pack
 *   2.  overage[s] = max(0, ship[s] − buy[s])     — extra shipped units
 *   3.  totalAvail = Σ avail[s]
 *   4.  packSize   = Σ PACK_COMPOSITION[s]         (10 normally, 11 with XXS)
 *   5.  totalPacks = floor(totalAvail / packSize)
 *   6.  Count each location's appearances in PACK_SEQUENCE[0 .. totalPacks−1]
 *       → packCounts[loc] = how many packs that location receives
 *   7.  Allocate in order:
 *         a. Office  → always gets exactly 1 XS + 1 S (if available)
 *         b. For each store (Cedarhurst → Bogota → Toms River → Teaneck → Warehouse):
 *              target[s] = packCounts[loc] × PACK_COMPOSITION[s]
 *              actual[s] = min(target[s], inv[s])
 *              Subtract actual[s] from running inventory before moving on.
 *   8.  Remaining inventory → Warehouse (sink).
 *   9.  Ship overage  → Warehouse.
 *  10.  Hard-cap: no size total may exceed total shipped for that size.
 *
 * No first-pack gating — a location receives whatever is available for each
 * size even if some sizes are fully depleted (those sizes just get 0).
 */
export function computeAllocation({ buy, ship, locations, sizes, ignoreTeaneck }) {
  let built = emptyMatrix(locations, sizes);

  // ── Step 1–2: avail & overage ─────────────────────────────────────────────
  const avail   = {};
  const overage = {};
  for (const s of sizes) {
    avail[s]   = Math.min(Number(buy?.[s] ?? 0), Number(ship?.[s] ?? 0));
    overage[s] = Math.max(0, Number(ship?.[s] ?? 0) - Number(buy?.[s] ?? 0));
  }

  // ── Step 3–5: total packs ─────────────────────────────────────────────────
  const productHasXXS = Number(buy?.XXS ?? 0) > 0 || Number(ship?.XXS ?? 0) > 0;
  const packComp      = productHasXXS ? PACK_WITH_XXS : PACK_NO_XXS;
  const packSize      = Object.values(packComp).reduce((a, b) => a + b, 0);

  const totalAvail  = sizes.reduce((a, s) => a + avail[s], 0);
  const totalPacks  = Math.floor(totalAvail / packSize);

  // ── Step 6: count packs per location from the sequence ───────────────────
  const seqLen    = Math.min(totalPacks, PACK_SEQUENCE_1_TO_15.length);
  const packCounts = {};
  for (let i = 0; i < seqLen; i++) {
    const loc = PACK_SEQUENCE_1_TO_15[i];
    packCounts[loc] = (packCounts[loc] || 0) + 1;
  }

  // Running inventory pool
  let inv = { ...avail };

  const sink = locations.includes("Warehouse") ? "Warehouse" : locations[locations.length - 1];

  // ── Step 7a: Office — always 1 XS + 1 S (if both available) ─────────────
  const officeGot = {};   // track what Office actually received
  if (locations.includes("Office") && Number(inv?.XS ?? 0) >= 1 && Number(inv?.S ?? 0) >= 1) {
    officeGot.XS = 1;
    officeGot.S  = 1;
    built = addToLoc(built, "Office", { XS: 1, S: 1 });
    inv   = { ...inv, XS: inv.XS - 1, S: inv.S - 1 };
  }

  // ── Step 7b: Stores — fill each location completely before moving on ──────
  for (const loc of ALLOCATION_ORDER) {
    // ignoreTeaneck: redirect Teaneck's packs to Warehouse
    const effectiveLoc = (ignoreTeaneck && loc === "Teaneck Store") ? "Warehouse" : loc;
    if (!locations.includes(effectiveLoc)) continue;

    const nPacks = packCounts[loc] || 0;
    if (nPacks === 0) continue; // this location doesn't appear in the sequence for this batch

    const locAlloc = {};
    for (const s of sizes) {
      let target = nPacks * (packComp[s] || 0);
      // Bogota's first pack has the Office units subtracted so that the office
      // samples effectively come out of Bogota's allocation.
      // e.g. 4 packs normally = 33211+33211+33211+33211; with office(1XS,1S)
      //      → 22211+33211+33211+33211 = total reduced by exactly officeGot.
      if (loc === "Bogota") {
        target = Math.max(0, target - Number(officeGot?.[s] ?? 0));
      }
      const actual = Math.min(target, Number(inv?.[s] ?? 0));
      if (actual > 0) locAlloc[s] = actual;
    }

    built = addToLoc(built, effectiveLoc, locAlloc);

    // Subtract from running inventory
    for (const s of sizes) {
      inv[s] = Math.max(0, Number(inv?.[s] ?? 0) - Number(locAlloc?.[s] ?? 0));
    }
  }

  // ── Step 8: Remaining inventory → Warehouse ───────────────────────────────
  for (const s of sizes) {
    built[sink][s] = Number(built?.[sink]?.[s] ?? 0) + Number(inv?.[s] ?? 0);
  }

  // ── Step 9: Ship overage → Warehouse ─────────────────────────────────────
  for (const s of sizes) {
    built[sink][s] = Number(built?.[sink]?.[s] ?? 0) + Number(overage?.[s] ?? 0);
  }

  // ── Step 10: Hard cap ─────────────────────────────────────────────────────
  built = capToShipTotals(built, locations, sizes, ship);

  const totals = perSizeTotalsFromMatrix(built, locations, sizes);
  return { allocation: built, totals };
}
