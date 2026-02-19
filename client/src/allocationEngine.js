// src/allocationEngine.js

// ── Pack distribution: how many packs each location gets in a full 15-pack cycle ──
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

// Derive target pack counts from the sequence:
// { Cedarhurst: 5, Bogota: 4, "Toms River": 2, "Teaneck Store": 1, Warehouse: 3 }
const PACKS_PER_LOC = PACK_SEQUENCE_1_TO_15.reduce((acc, loc) => {
  acc[loc] = (acc[loc] || 0) + 1;
  return acc;
}, {});

// Allocation order: fill each location completely before moving to the next.
// Office is handled separately (not pack-based).
const ALLOCATION_ORDER = ["Cedarhurst", "Bogota", "Toms River", "Teaneck Store", "Warehouse"];

const CORE_SIZES = ["XS", "S", "M", "L"];

function emptyMatrix(locations, sizes) {
  const m = {};
  for (const loc of locations) {
    m[loc] = {};
    for (const s of sizes) m[loc][s] = 0;
  }
  return m;
}

function countMissingCoreSizes(inv) {
  let missing = 0;
  for (const sz of CORE_SIZES) {
    if (Number(inv?.[sz] ?? 0) <= 0) missing += 1;
  }
  return missing;
}

function buildPackFromInventory(inv, productHasXXS) {
  // Pack target: XXS:1 (optional), XS:3, S:3, M:2, L:1, XL:1
  // Partial packs are allowed — take up to the target based on available inventory.
  const want = {
    XXS: productHasXXS ? 1 : 0,
    XS: 3,
    S: 3,
    M: 2,
    L: 1,
    XL: 1
  };

  const pack = {};
  for (const [sz, qty] of Object.entries(want)) {
    const have = Number(inv?.[sz] ?? 0);
    const take = Math.max(0, Math.min(have, qty));
    if (take > 0) pack[sz] = take;
  }
  return pack;
}

function subtractPack(inv, pack) {
  const next = { ...inv };
  for (const [sz, qty] of Object.entries(pack)) {
    next[sz] = Math.max(0, Number(next?.[sz] ?? 0) - Number(qty ?? 0));
  }
  return next;
}

function addToLoc(matrix, loc, pack) {
  const out = structuredClone(matrix);
  for (const [sz, qty] of Object.entries(pack)) {
    out[loc][sz] = Number(out?.[loc]?.[sz] ?? 0) + Number(qty ?? 0);
  }
  return out;
}

function sumPack(pack) {
  return Object.values(pack).reduce((a, v) => a + Number(v ?? 0), 0);
}

function perSizeTotalsFromMatrix(matrix, locations, sizes) {
  const t = {};
  for (const s of sizes) {
    t[s] = locations.reduce((a, loc) => a + Number(matrix?.[loc]?.[s] ?? 0), 0);
  }
  return t;
}

function capToShipTotals(built, locations, sizes, ship) {
  // Hard safety: never exceed shipped totals per size.
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
 * Main allocation engine — location-by-location fill strategy.
 *
 * Strategy:
 *   1. Office gets 1 XS + 1 S first (if available).
 *   2. For each store location in order (Cedarhurst → Bogota → Toms River →
 *      Teaneck → Warehouse), fill ALL of that location's target packs
 *      before moving on to the next.
 *   3. Remaining inventory goes to Warehouse.
 *   4. Ship overage (ship > buy) also lands in Warehouse.
 *   5. Hard-cap to shipped totals per size.
 *
 * Target packs per location (derived from the 15-pack sequence):
 *   Cedarhurst: 5 | Bogota: 4 | Toms River: 2 | Teaneck: 1 | Warehouse: 3
 *
 * First-pack gating still applies per location:
 *   - pack must contain at least 1 S
 *   - inventory must not be missing 2+ core sizes (XS/S/M/L)
 *   If gating fails, that location receives 0 packs (skipped).
 */
export function computeAllocation({ buy, ship, locations, sizes, ignoreTeaneck }) {
  let built = emptyMatrix(locations, sizes);

  // avail = min(buy, ship)
  const avail = {};
  for (const s of sizes) avail[s] = Math.min(Number(buy?.[s] ?? 0), Number(ship?.[s] ?? 0));

  // overage = ship − buy (positive only)
  const overage = {};
  for (const s of sizes) overage[s] = Math.max(0, Number(ship?.[s] ?? 0) - Number(buy?.[s] ?? 0));

  const productHasXXS = Number(buy?.XXS ?? 0) > 0 || Number(ship?.XXS ?? 0) > 0;

  let inv = { ...avail };

  const sink = locations.includes("Warehouse") ? "Warehouse" : locations[locations.length - 1];

  // ── Step 1: Office first (1 XS + 1 S) ──────────────────────────────────
  if (locations.includes("Office") && Number(inv?.XS ?? 0) >= 1 && Number(inv?.S ?? 0) >= 1) {
    built = addToLoc(built, "Office", { XS: 1, S: 1 });
    inv   = subtractPack(inv, { XS: 1, S: 1 });
  }

  // ── Step 2: Fill each store location completely before moving on ─────────
  for (const loc of ALLOCATION_ORDER) {
    // When ignoreTeaneck is on, Teaneck's allocation goes to Warehouse instead
    const effectiveLoc = (ignoreTeaneck && loc === "Teaneck Store") ? "Warehouse" : loc;
    if (!locations.includes(effectiveLoc)) continue;

    const targetPacks = PACKS_PER_LOC[loc] ?? 0;
    let packsGiven = 0;

    for (let i = 0; i < targetPacks; i++) {
      const pack = buildPackFromInventory(inv, productHasXXS);
      if (sumPack(pack) === 0) break; // no inventory left at all

      // First-pack gating (only checked for the very first pack of each location)
      if (packsGiven === 0) {
        const sCount     = Number(pack?.S ?? 0);
        const missingCore = countMissingCoreSizes(inv);
        if (sCount === 0 || missingCore >= 2) {
          break; // skip this location entirely — inventory too depleted
        }
      }

      built = addToLoc(built, effectiveLoc, pack);
      inv   = subtractPack(inv, pack);
      packsGiven++;
    }
  }

  // ── Step 3: Remaining inventory → Warehouse ──────────────────────────────
  for (const s of sizes) {
    built[sink][s] = Number(built?.[sink]?.[s] ?? 0) + Number(inv?.[s] ?? 0);
  }

  // ── Step 4: Ship overage → Warehouse ────────────────────────────────────
  for (const s of sizes) {
    built[sink][s] = Number(built?.[sink]?.[s] ?? 0) + Number(overage?.[s] ?? 0);
  }

  // ── Step 5: Hard cap per size to shipped totals ──────────────────────────
  built = capToShipTotals(built, locations, sizes, ship);

  const totals = perSizeTotalsFromMatrix(built, locations, sizes);
  return { allocation: built, totals };
}
